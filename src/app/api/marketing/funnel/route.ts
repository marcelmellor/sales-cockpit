import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { getOrFetch } from '@/lib/server-cache';
import { getAiAgentsFunnelTop } from '@/lib/amplitude/funnel';
import { getMarketingReachFunnel } from '@/lib/amplitude/marketing-reach-funnel';
import { getTouchpointsByEmail, Touchpoint } from '@/lib/amplitude/journeys';
import { getPreSignupPageViewsByEmail } from '@/lib/amplitude/pre-signup-pageviews';
import { getMarketingAcquisitionByEmail } from '@/lib/amplitude/marketing-acquisition';
import { getAgentsQualificationByMastersipid } from '@/lib/amplitude/agents-events';
import { getCustomerCreationByMastersipid } from '@/lib/amplitude/customer-info';
import { getPreviewTrialsByMastersipid } from '@/lib/amplitude/preview-trials';
import { getActivationTotals, getPreviewTrialTotals } from '@/lib/amplitude/funnel-totals';
import { computeDealRevenue } from '@/lib/hubspot/mrr';
import {
  MINUTE_BUCKET_THRESHOLD,
  MRR_BUCKET_THRESHOLD,
  type MarketingFunnelJourney,
  type MarketingFunnelResponse,
  type MinuteBucket,
  type MrrBucket,
} from '@/lib/marketing/funnel-types';

// Phase 2 — Marketing-Tab. AI Agents only. Goal: show "how the deals came
// about" by combining two perspectives:
//   1. A global funnel of Amplitude marketing pool → trial signup → deal in
//      our pipeline → deal won. Top of funnel is independent of HubSpot.
//   2. A deal-by-deal / lead-by-lead journey: every AI-Agents-deal in the
//      HubSpot pipeline PLUS every AI-Agents-lead that hasn't progressed to a
//      deal yet. Each journey carries its full chronological touchpoint list.
//
// Cached for 30 min because Amplitude data is far less volatile than HubSpot
// deal data — we don't need 5-min freshness here.

const CACHE_TTL_SECONDS = 30 * 60;
const DEALS_PIPELINE_ID = '3576006860'; // "Sales sipgate Portfolio"
const LEAD_PIPELINE_ID = '3591532731';  // "sipgate Portfolio" auf dem Leads-Objekt

// Forms, die als HubSpot-`first_conversion_event_name` aufgefasst werden,
// aber KEIN Customer-facing Marketing-Touchpoint sind — typischerweise
// interne Sales-/SDR-Tools zum Anlegen von Leads. Substring-Match, case-
// insensitive. Weitere Forms einfach unten dazu schreiben.
const INTERNAL_LEAD_FORMS_PATTERNS = [
  'wingm Qualification Form',  // SDR-Tool zur manuellen Lead-Qualifizierung
];

function isInternalLeadForm(formName: string): boolean {
  const lower = formName.toLowerCase();
  return INTERNAL_LEAD_FORMS_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

// Types + Konstanten der Response liegen in @/lib/marketing/funnel-types —
// Next.js 16 erlaubt keine zusätzlichen Exports in einer Route-Datei neben
// den HTTP-Methods.

function isWonStage(label: string): boolean {
  const l = label.toLowerCase();
  if (l.includes('closed lost') || l.includes('verloren') || l.includes('lost')) return false;
  return l.includes('closed won') || l.includes('gewonnen') || l.includes('won');
}

function isLostStage(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes('closed lost') || l.includes('verloren') || l.includes('lost') || l.includes('abgesagt');
}

// Range-Strings wie "0-1000", "1000-2000", "2000-5000", ">5000" → numerische
// Schätzung (Midpoint für geschlossene Ranges, ">N" wird N+1000 zugeordnet).
// Akzeptiert null/leer → null.
function parseMinuteRange(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const closed = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (closed) {
    const lo = Number(closed[1]);
    const hi = Number(closed[2]);
    if (Number.isFinite(lo) && Number.isFinite(hi)) return Math.round((lo + hi) / 2);
  }
  const greater = s.match(/^>\s*(\d+)$/);
  if (greater) {
    const n = Number(greater[1]);
    if (Number.isFinite(n)) return n + 1000;
  }
  const less = s.match(/^<\s*(\d+)$/);
  if (less) {
    const n = Number(less[1]);
    if (Number.isFinite(n)) return Math.max(0, n - 500);
  }
  const plain = Number(s);
  return Number.isFinite(plain) ? plain : null;
}

function bucketize(minutes: number | null): MinuteBucket {
  if (minutes == null) return 'unknown';
  return minutes >= MINUTE_BUCKET_THRESHOLD ? 'gte_threshold' : 'lt_threshold';
}

function bucketizeMrr(mrr: number | null): MrrBucket {
  if (mrr == null || mrr <= 0) return 'unknown';
  return mrr >= MRR_BUCKET_THRESHOLD ? 'gte_threshold' : 'lt_threshold';
}

// Resolves the best-available agents-minutes signal in priority order:
// exact HubSpot value > HubSpot range > Amplitude Quali range.
function resolveAgentsMinutes(
  hubspotExact: number | null,
  hubspotRange: string | null,
  touchpoints: Touchpoint[],
): number | null {
  if (hubspotExact != null && hubspotExact > 0) return hubspotExact;
  const rangeFromHubspot = parseMinuteRange(hubspotRange);
  if (rangeFromHubspot != null) return rangeFromHubspot;
  // Letzter Quali-Event mit gesetztem inbound_value (= jüngster Wert).
  for (let i = touchpoints.length - 1; i >= 0; i--) {
    const t = touchpoints[i];
    if (t.inboundValue) {
      const fromAmpli = parseMinuteRange(t.inboundValue);
      if (fromAmpli != null) return fromAmpli;
    }
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tvSecret = searchParams.get('tvSecret');
    const isValidTvSecret = tvSecret && process.env.TV_SECRET && tvSecret === process.env.TV_SECRET;

    if (!isValidTvSecret) {
      const session = await getSession();
      if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const produkt = searchParams.get('produkt');
    if (produkt !== 'frontdesk') {
      return NextResponse.json(
        { error: 'Marketing funnel is currently only available for AI Agents (produkt=frontdesk).' },
        { status: 400 },
      );
    }

    const forceRefresh = searchParams.get('refresh') === '1';
    // Funnel-Datums-Fenster — bestimmt sowohl die Marketing-Reach-Aggregation
    // in BQ als auch den HubSpot-Side-Cohort-Schnitt. Default 90 Tage.
    const daysRaw = Number(searchParams.get('days'));
    const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 365 ? daysRaw : 90;
    const cacheKey = `marketing-funnel:frontdesk:${days}d`;
    const { data, meta } = await getOrFetch<MarketingFunnelResponse>(
      cacheKey,
      CACHE_TTL_SECONDS,
      () => buildMarketingFunnel(days),
      { forceRefresh },
    );
    return NextResponse.json({ success: true, data, cache: meta });
  } catch (error) {
    console.error('Error fetching marketing funnel:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch marketing funnel', details: errorMessage },
      { status: 500 },
    );
  }
}

async function buildMarketingFunnel(days: number): Promise<MarketingFunnelResponse> {
  const client = getHubSpotClient();

  // HubSpot: AI-Agents deals + leads in parallel. Deals bring contact assocs
  // (for email/mastersipid join with Amplitude); leads bring createdate + the
  // `leads → deals` association (HubSpot stores it only in this direction,
  // see AGENTS.md) so we know when the lead behind a given deal was created.
  const [dealsWithAssociations, leadsWithAssociations, pipelines] = await Promise.all([
    client.getDealsWithAssociations(DEALS_PIPELINE_ID, 'frontdesk'),
    client.getLeadsWithAssociations(LEAD_PIPELINE_ID, 'frontdesk'),
    client.getPipelines(),
  ]);
  const deals = dealsWithAssociations.results;
  const dealIdSet = new Set(deals.map(d => d.id));

  // Build dealId → earliest associated lead.createdate, plus identify which
  // leads are NOT yet associated with any deal in our scope (= "lead-only"
  // entries for the Sankey).
  const leadCreatedByDealId = new Map<string, string>();
  const leadOnly: Array<typeof leadsWithAssociations.results[number]> = [];
  for (const lead of leadsWithAssociations.results) {
    const created = lead.properties.hs_createdate;
    const dealAssocs = lead.associations?.deals?.results ?? [];
    const inScope = dealAssocs.some(a => dealIdSet.has(a.id));
    if (created) {
      for (const assoc of dealAssocs) {
        const existing = leadCreatedByDealId.get(assoc.id);
        if (!existing || created < existing) {
          leadCreatedByDealId.set(assoc.id, created);
        }
      }
    }
    if (!inScope) {
      leadOnly.push(lead);
    }
  }

  // Collect contact IDs from BOTH deals and lead-only entries — these are the
  // contacts we need to enrich with email/mastersipid für Amplitude-Joins.
  const contactIds = new Set<string>();
  for (const deal of deals) {
    for (const c of deal.associations?.contacts?.results ?? []) contactIds.add(c.id);
  }
  for (const lead of leadOnly) {
    for (const c of lead.associations?.contacts?.results ?? []) contactIds.add(c.id);
  }

  const contactEmailById = new Map<string, string>();
  const contactMastersipidById = new Map<string, string>();
  // HubSpot-Form-Submission-Backstop: wenn Amplitude den Form-Submit nicht
  // erfasst hat (z.B. weil die Form direkt an HubSpot submitted ohne Custom-
  // Event auszulösen), pullen wir den first_conversion_event_name +
  // first_conversion_date als Pseudo-Touchpoint. So sehen wir z.B.
  // /demo-buchen-Submits auf sipgate.ai trotz Amplitude-Lücke.
  // `hs_analytics_first_url` liefert die erste URL die der Contact besucht
  // hat — bei Cold-Traffic-Conversions ist das gleich die Form-Page, daraus
  // ziehen wir die Domain für den Chip ("Contact Form (sipgate.ai)" o.ä.).
  const contactFirstConversionById = new Map<
    string,
    { name: string; isoDate: string; pageDomain: string | null }
  >();
  if (contactIds.size > 0) {
    const contacts = await client.getContacts(Array.from(contactIds), [
      'email',
      'mastersipid',
      'first_conversion_event_name',
      'first_conversion_date',
      'hs_analytics_first_url',
    ]);
    for (const c of contacts.results) {
      const email = (c.properties.email || '').trim().toLowerCase();
      if (email) contactEmailById.set(c.id, email);
      const msid = (c.properties.mastersipid || '').trim();
      if (msid) contactMastersipidById.set(c.id, msid);
      const fcName = (c.properties.first_conversion_event_name || '').trim();
      const fcDateRaw = (c.properties.first_conversion_date || '').trim();
      // Meeting-Links (HubSpot Calendly-Style Booking-Pages, z.B.
      // "Meetings Link: honta/ai-frontdesk-rep") sind kein Marketing-Touchpoint
      // — die werden von Personen gebucht, die schon im Sales-Prozess sind.
      // Rausfiltern. Ebenso interne Sales-Forms (siehe Whitelist oben).
      const isMeetingLink = /^meetings link:/i.test(fcName);
      const isInternal = isInternalLeadForm(fcName);
      if (fcName && fcDateRaw && !isMeetingLink && !isInternal) {
        // HubSpot liefert Datums-Properties teilweise als Unix-Millis-String
        // ("1747476600000"), teilweise als ISO-String. Beides parsen.
        const parsed = /^\d+$/.test(fcDateRaw)
          ? new Date(Number(fcDateRaw))
          : new Date(fcDateRaw);
        if (!Number.isNaN(parsed.getTime())) {
          let pageDomain: string | null = null;
          const firstUrl = (c.properties.hs_analytics_first_url || '').trim();
          if (firstUrl) {
            try {
              const host = new URL(firstUrl).hostname.replace(/^www\./, '');
              // HubSpot's eigene Form-Widget-Domains (*.hsforms.com) sind kein
              // sinnvoller Marketing-Page-Hinweis — die zeigen nur dass die Form
              // als HubSpot-Embed gerendert wurde. Auf null setzen.
              if (!/\.hsforms\.com$/i.test(host)) {
                pageDomain = host;
              }
            } catch {
              // unparsebarer URL → kein Domain-Hint
            }
          }
          contactFirstConversionById.set(c.id, {
            name: fcName,
            isoDate: parsed.toISOString(),
            pageDomain,
          });
        }
      }
    }
  }

  const allEmails = Array.from(new Set(contactEmailById.values()));
  const allMastersipids = Array.from(new Set(contactMastersipidById.values()));

  // Zehn BQ queries in parallel — funnel-top, marketing-reach-cascade (Top-
  // of-Funnel-Stages), activation-totals (Signup Atlantis global),
  // preview-trial-totals (Contract Finalized global), per-email touchpoints,
  // per-email anonyme Pre-Signup-Page-Views, per-email Marketing-Acquisition
  // (UTM/Click-IDs), per-mastersipid agents-qualification events, per-
  // mastersipid customer-creation, per-mastersipid preview-trial activations.
  // Fail-safe per query so a single failure doesn't blank the whole tab.
  const [funnelTop, marketingReach, activationTotals, previewTrialTotals, touchpointsByEmail, preSignupViewsByEmail, marketingAcquisitionByEmail, qualificationByMsid, customerSinceByMsid, previewTrialsByMsid] = await Promise.all([
    getAiAgentsFunnelTop().catch(err => {
      console.error('[marketing/funnel] funnel-top failed:', err);
      return { marketingTouch: 0, trialSignup: 0 };
    }),
    getMarketingReachFunnel(days).catch(err => {
      console.error('[marketing/funnel] marketing-reach failed:', err);
      return {
        marketingTouchDevices: 0,
        marketingTouchSipgateDe: 0,
        marketingTouchSipgateAi: 0,
      };
    }),
    getActivationTotals(days).catch(err => {
      console.error('[marketing/funnel] activation-totals failed:', err);
      return { agentSignup: 0, otherSignup: 0, total: 0 };
    }),
    getPreviewTrialTotals(days).catch(err => {
      console.error('[marketing/funnel] preview-trial-totals failed:', err);
      return { total: 0, agentSignup: 0, otherSignup: 0, bestandskunde: 0 };
    }),
    allEmails.length > 0
      ? getTouchpointsByEmail(allEmails).catch(err => {
          console.error('[marketing/funnel] touchpoints failed:', err);
          return new Map<string, Touchpoint[]>();
        })
      : Promise.resolve(new Map<string, Touchpoint[]>()),
    allEmails.length > 0
      ? getPreSignupPageViewsByEmail(allEmails).catch(err => {
          console.error('[marketing/funnel] pre-signup page-views failed:', err);
          return new Map<string, Touchpoint[]>();
        })
      : Promise.resolve(new Map<string, Touchpoint[]>()),
    allEmails.length > 0
      ? getMarketingAcquisitionByEmail(allEmails).catch(err => {
          console.error('[marketing/funnel] marketing-acquisition failed:', err);
          return new Map<string, Touchpoint[]>();
        })
      : Promise.resolve(new Map<string, Touchpoint[]>()),
    allMastersipids.length > 0
      ? getAgentsQualificationByMastersipid(allMastersipids).catch(err => {
          console.error('[marketing/funnel] agents-qualification failed:', err);
          return new Map<string, Touchpoint[]>();
        })
      : Promise.resolve(new Map<string, Touchpoint[]>()),
    allMastersipids.length > 0
      ? getCustomerCreationByMastersipid(allMastersipids).catch(err => {
          console.error('[marketing/funnel] customer-creation failed:', err);
          return new Map<string, string>();
        })
      : Promise.resolve(new Map<string, string>()),
    allMastersipids.length > 0
      ? getPreviewTrialsByMastersipid(allMastersipids).catch(err => {
          console.error('[marketing/funnel] preview-trials failed:', err);
          return new Map<string, Touchpoint[]>();
        })
      : Promise.resolve(new Map<string, Touchpoint[]>()),
  ]);

  // Pipeline-Stage-Labels für Deals.
  const dealPipeline = pipelines.results.find(p => p.id === DEALS_PIPELINE_ID);
  const dealStageLabelById = new Map<string, string>();
  for (const s of dealPipeline?.stages ?? []) dealStageLabelById.set(s.id, s.label);

  // Lead-Stage-Labels — wir holen sie aus dem Lead-Pipeline-Endpoint. Schlägt
  // das fehl, fällt der `stageLabel` einfach auf die Stage-ID zurück.
  const leadStageLabelById = new Map<string, string>();
  try {
    const leadPipelinesResp = await client.getLeadPipelines();
    const lp = leadPipelinesResp.results.find(p => p.id === LEAD_PIPELINE_ID);
    for (const s of lp?.stages ?? []) leadStageLabelById.set(s.id, s.label);
  } catch (err) {
    console.error('[marketing/funnel] lead pipelines lookup failed:', err);
  }

  // Aggregator: assembles all touchpoints (Amplitude + HubSpot-Lifecycle) for
  // a given set of contact associations, deduped + chronologically sorted.
  // Per Journey: nur das FRÜHESTE `lead_form_submitted`-Event behalten — pro
  // Formular feuert Amplitude oft mehrere Events, die User wollen nur den
  // initialen Submit sehen.
  function assembleTouchpoints(
    contactAssocs: Array<{ id: string }>,
    leadCreatedAt: string | null,
    dealCreatedAt: string | null,
  ): { touchpoints: Touchpoint[]; customerSince: string | null } {
    const seen = new Set<string>();
    const merged: Touchpoint[] = [];
    let customerSince: string | null = null;
    for (const assoc of contactAssocs) {
      const email = contactEmailById.get(assoc.id);
      const msid = contactMastersipidById.get(assoc.id);
      if (msid) {
        const created = customerSinceByMsid.get(msid);
        if (created && (customerSince === null || created < customerSince)) {
          customerSince = created;
        }
      }
      const fromEmail = email ? touchpointsByEmail.get(email) ?? [] : [];
      const fromMsid = msid ? qualificationByMsid.get(msid) ?? [] : [];
      const fromPreSignup = email ? preSignupViewsByEmail.get(email) ?? [] : [];
      const fromAcquisition = email ? marketingAcquisitionByEmail.get(email) ?? [] : [];
      const fromPreviewTrial = msid ? previewTrialsByMsid.get(msid) ?? [] : [];
      for (const t of [...fromEmail, ...fromMsid, ...fromPreSignup, ...fromAcquisition, ...fromPreviewTrial]) {
        const key = `${t.eventType}|${t.occurredAt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(t);
      }
      // HubSpot-Backstop: first_conversion als pseudo-Form-Submit. Wird gleich
      // unten zusammen mit Amplitude-Form-Submits auf das früheste Event
      // dedupliziert — falls Amplitude was Früheres gefunden hat, gewinnt das.
      const fc = contactFirstConversionById.get(assoc.id);
      if (fc) {
        const key = `${fc.name}|${fc.isoDate}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push({
            eventType: fc.name,
            occurredAt: fc.isoDate,
            anchor: 'lead_form_submitted',
            leadSourceDetails: null,
            inboundValue: null,
            signupProduct: null,
            pageDomain: fc.pageDomain,
          });
        }
      }
    }
    // Deduplicate `lead_form_submitted`: nur das chronologisch erste Event
    // behalten. Wenn das früheste Event aus HubSpot kommt (= kein pageDomain),
    // aber Amplitude denselben Form-Submit auch erfasst hat (innerhalb 1h),
    // übernehmen wir die Amplitude-Domain auf das behaltene Event — so
    // bekommt der Chip "(sipgate.ai)"/"(sipgate.de)" auch wenn der bessere
    // HubSpot-Name verwendet wird.
    const formSubmits: Array<{ idx: number; tp: Touchpoint }> = [];
    for (let i = 0; i < merged.length; i++) {
      if (merged[i].anchor === 'lead_form_submitted') {
        formSubmits.push({ idx: i, tp: merged[i] });
      }
    }
    if (formSubmits.length > 0) {
      formSubmits.sort((a, b) => a.tp.occurredAt.localeCompare(b.tp.occurredAt));
      const earliest = formSubmits[0].tp;
      if (!earliest.pageDomain) {
        const earliestMs = new Date(earliest.occurredAt).getTime();
        const ampliClose = formSubmits.find(
          s =>
            s.tp.pageDomain &&
            Math.abs(new Date(s.tp.occurredAt).getTime() - earliestMs) < 60 * 60 * 1000,
        );
        if (ampliClose) {
          earliest.pageDomain = ampliClose.tp.pageDomain;
        }
      }
      const filtered: Touchpoint[] = [];
      for (const t of merged) {
        if (t.anchor === 'lead_form_submitted' && t !== earliest) continue;
        filtered.push(t);
      }
      merged.length = 0;
      merged.push(...filtered);
    }
    if (leadCreatedAt) {
      merged.push({
        eventType: 'Lead angelegt',
        occurredAt: new Date(leadCreatedAt).toISOString(),
        anchor: 'hubspot_lead_created',
        leadSourceDetails: null,
        inboundValue: null,
        signupProduct: null,
        pageDomain: null,
      });
    }
    if (dealCreatedAt) {
      merged.push({
        eventType: 'Deal angelegt',
        occurredAt: new Date(dealCreatedAt).toISOString(),
        anchor: 'hubspot_deal_created',
        leadSourceDetails: null,
        inboundValue: null,
        signupProduct: null,
        pageDomain: null,
      });
    }
    // Bestandskunde-Pseudo-Touchpoint: nur einfügen wenn (a) wir eine
    // Customer-Since-Datum haben UND (b) es KEIN Signup-Atlantis-Event in der
    // Journey gibt. Bei Self-Service-Signups ist das Signup-Event aussagekräftiger;
    // hier markieren wir nur Bestandskunden, deren Customer-Beziehung vor dem
    // Marketing-Tracking-Window begann.
    const hasSignup = merged.some(
      t =>
        t.anchor === 'signup_atlantis_frontdesk' ||
        t.anchor === 'signup_atlantis_other_product',
    );
    if (customerSince && !hasSignup) {
      const year = new Date(customerSince).getFullYear();
      merged.push({
        eventType: `Bestandskunde seit ${year}`,
        occurredAt: new Date(customerSince).toISOString(),
        anchor: 'customer_since',
        leadSourceDetails: null,
        inboundValue: null,
        signupProduct: null,
        pageDomain: null,
      });
    }
    const ANCHOR_ORDER: Record<string, number> = {
      customer_since: 0,
      marketing_acquisition: 1,
      marketing_page_sipgate_ai: 2,
      marketing_page_sipgate_de: 2,
      sipgate_ai_domain: 3,
      lead_form_submitted: 4,
      signup_atlantis_frontdesk: 5,
      signup_atlantis_other_product: 5,
      agents_qualification_onboarding: 6,
      agents_qualification_inproduct: 6,
      preview_trial_started: 7,
      hubspot_lead_created: 8,
      hubspot_deal_created: 9,
    };
    merged.sort((a, b) => {
      const timeDiff = a.occurredAt.localeCompare(b.occurredAt);
      if (timeDiff !== 0) return timeDiff;
      return (ANCHOR_ORDER[a.anchor] ?? 99) - (ANCHOR_ORDER[b.anchor] ?? 99);
    });
    return { touchpoints: merged, customerSince };
  }

  const journeys: MarketingFunnelJourney[] = [];

  // Deal-Entries: jeder AI-Agents-Deal kommt rein, unabhängig von Amplitude-
  // Attribution. Funnel-Counts werden aus dieser Liste abgeleitet (wieviele
  // haben AI-Agents-Touch).
  let dealsWonTotal = 0;
  let dealsWithTouchCount = 0;
  let wonDealsWithTouchCount = 0;
  for (const deal of deals) {
    const stageLabel = dealStageLabelById.get(deal.properties.dealstage) || deal.properties.dealstage || '';
    const won = isWonStage(stageLabel);
    const lost = isLostStage(stageLabel);
    if (won) dealsWonTotal++;

    const leadCreatedAt = leadCreatedByDealId.get(deal.id) ?? null;
    const dealCreatedAt = deal.properties.createdate ?? null;
    const { touchpoints, customerSince } = assembleTouchpoints(
      deal.associations?.contacts?.results ?? [],
      leadCreatedAt,
      dealCreatedAt,
    );

    const hasAiAgentsTouch = touchpoints.some(
      t =>
        t.anchor !== 'signup_atlantis_other_product' &&
        t.anchor !== 'hubspot_lead_created' &&
        t.anchor !== 'hubspot_deal_created',
    );
    if (hasAiAgentsTouch) {
      dealsWithTouchCount++;
      if (won) wonDealsWithTouchCount++;
    }

    // HubSpot-Minuten: bei Deals bevorzugt qualifizierte Minuten, fallback
    // auf agents_minuten. Range-Feld inbound_volumen ist auf Deals selten
    // gesetzt, daher null. Range kommt dann ggf. aus Amplitude.
    const dealMinutesExact =
      parseInt(deal.properties.agents_minuten_qualifiziert) ||
      parseInt(deal.properties.agents_minuten) ||
      null;
    const agentsMinutes = resolveAgentsMinutes(
      dealMinutesExact,
      null,
      touchpoints,
    );

    // Deal-MRR — selbe Berechnung wie in /api/deals/overview und im
    // Dashboard-Badge "MRR ≥ 450 €", reused via computeDealRevenue.
    const { revenue: dealMrr } = computeDealRevenue({
      angeboteneProdukte: deal.properties.angebotene_produkte,
      agentsMinutenQualifiziert: deal.properties.agents_minuten_qualifiziert,
      agentsMinuten: deal.properties.agents_minuten,
      hsMrr: deal.properties.hs_mrr,
      hsNumOfAssociatedLineItems: deal.properties.hs_num_of_associated_line_items,
      tcv: deal.properties.tcv,
      vertragsdauer: deal.properties.vertragsdauer,
      isWonDeal: won,
    });
    const mrr = dealMrr > 0 ? dealMrr : null;

    journeys.push({
      kind: 'deal',
      entityId: deal.id,
      companyName: deal.properties.dealname || 'Unknown',
      stageLabel,
      stageIsWon: won,
      stageIsLost: lost,
      hasLead: leadCreatedAt !== null,
      hasDeal: true,
      touchpoints,
      customerSince,
      agentsMinutes,
      minuteBucket: bucketize(agentsMinutes),
      mrr,
      mrrBucket: bucketizeMrr(mrr),
      createdate: dealCreatedAt ? new Date(dealCreatedAt).toISOString() : null,
    });
  }

  // Lead-Only-Entries: AI-Agents-Leads die nicht (noch) an einen Deal in
  // unserem Scope hängen. Für die Sankey-Pfade zeigen die, wo das Marketing
  // hinläuft ohne dass ein Deal entsteht.
  for (const lead of leadOnly) {
    const stageId = lead.properties.hs_pipeline_stage || '';
    const stageLabel = leadStageLabelById.get(stageId) || stageId || 'Lead';
    const leadCreatedAt = lead.properties.hs_createdate ?? null;
    const { touchpoints, customerSince } = assembleTouchpoints(
      lead.associations?.contacts?.results ?? [],
      leadCreatedAt,
      null,
    );

    const leadMinutesExact = lead.properties.agents_minuten
      ? Number(lead.properties.agents_minuten)
      : null;
    const agentsMinutes = resolveAgentsMinutes(
      leadMinutesExact,
      lead.properties.inbound_volumen ?? null,
      touchpoints,
    );

    journeys.push({
      kind: 'lead',
      entityId: lead.id,
      companyName: lead.properties.hs_lead_name || 'Unbenannter Lead',
      stageLabel,
      stageIsWon: false,
      stageIsLost: false,
      hasLead: true,
      hasDeal: false,
      touchpoints,
      customerSince,
      agentsMinutes,
      minuteBucket: bucketize(agentsMinutes),
      mrr: null,
      mrrBucket: 'unknown',
      createdate: leadCreatedAt ? new Date(leadCreatedAt).toISOString() : null,
    });
  }

  // Sort journeys: deals first (open → won → lost, neueste Touchpoints zuerst
  // innerhalb), dann lead-only (latest Touchpoint zuerst).
  journeys.sort((a, b) => {
    const kindOrder = (j: MarketingFunnelJourney) => (j.kind === 'deal' ? 0 : 1);
    const ka = kindOrder(a);
    const kb = kindOrder(b);
    if (ka !== kb) return ka - kb;
    if (a.kind === 'deal' && b.kind === 'deal') {
      const groupOrder = (j: MarketingFunnelJourney) => (j.stageIsLost ? 2 : j.stageIsWon ? 1 : 0);
      const ga = groupOrder(a);
      const gb = groupOrder(b);
      if (ga !== gb) return ga - gb;
    }
    const aLast = a.touchpoints[a.touchpoints.length - 1]?.occurredAt ?? '';
    const bLast = b.touchpoints[b.touchpoints.length - 1]?.occurredAt ?? '';
    return bLast.localeCompare(aLast);
  });

  // HubSpot-Stages: zählen direkt die Deals in unserer Pipeline, die einen
  // marketing_acquisition-Touchpoint haben (= ihr Contact-Device hatte
  // irgendwann in den letzten 365 Tagen ein UTM-/Click-ID-Event). Lifetime-
  // Sicht, nicht ans BQ-Date-Window gekoppelt — weil Sales-Cycles regelmäßig
  // länger sind als das Marketing-Reach-Window oben.
  //
  // Activation-Stage = Marketing-attribuierte Journey + echtes Signup-Event
  // (Agent-Signup ∨ PBX-Signup). Bestandskunden haben kein Signup — sie
  // tauchen erst in der Preview-Stage auf (dort als Subgroup). Subgroups
  // mirroren die "Activation"-Spalte im Sankey (col1). Reihenfolge:
  // agent_signup > pbx_signup. "andere" (= keine Activation) wird nicht
  // gezählt, ergibt sich in der Bar als Rest auf den Marketing-Touch-Pool.
  let activationAgent = 0;
  let activationPbx = 0;
  let activationBestand = 0;
  let previewTrialAgent = 0;
  let previewTrialPbx = 0;
  let previewTrialBestand = 0;
  let dealCreatedFromMarketing = 0;
  let dealWonFromMarketing = 0;
  for (const j of journeys) {
    const hasMarketingAttribution = j.touchpoints.some(t => t.anchor === 'marketing_acquisition');
    if (!hasMarketingAttribution) continue;

    const hasAgentSignup = j.touchpoints.some(t => t.anchor === 'signup_atlantis_frontdesk');
    const hasPbxSignup = j.touchpoints.some(t => t.anchor === 'signup_atlantis_other_product');
    const hasBestandskunde = j.touchpoints.some(t => t.anchor === 'customer_since');
    if (hasAgentSignup) activationAgent++;
    else if (hasPbxSignup) activationPbx++;
    else if (hasBestandskunde) activationBestand++;

    const hasPreviewTrial = j.touchpoints.some(t => t.anchor === 'preview_trial_started');
    if (hasPreviewTrial) {
      if (hasAgentSignup) previewTrialAgent++;
      else if (hasPbxSignup) previewTrialPbx++;
      else if (hasBestandskunde) previewTrialBestand++;
    }

    if (j.kind !== 'deal') continue;
    dealCreatedFromMarketing++;
    if (j.stageIsWon) dealWonFromMarketing++;
  }
  // Activation-Gesamtzahl für den Server-Default (= alle 3 inkl. Bestandskunde,
  // weil der Client die Stage-Sichtbarkeit von previewTrial noch nicht kennt).
  const activationTotal = activationAgent + activationPbx + activationBestand;
  const previewTrialTotal = previewTrialAgent + previewTrialPbx + previewTrialBestand;

  return {
    funnel: [
      {
        key: 'marketingTouch',
        label: 'Marketing-Touch',
        count: marketingReach.marketingTouchDevices,
        // Stacked-Bar-Aufschlüsselung nach Landing-Domain des ersten Marketing-
        // getaggten Events pro Device. Rest (sipgatetrunking, satellite, etc.)
        // ergibt sich aus count - sum(subgroups) und wird vom Renderer als
        // "andere" gezeichnet.
        subgroups: [
          {
            key: 'sipgate_de',
            label: 'sipgate.de',
            count: marketingReach.marketingTouchSipgateDe,
            color: '#a855f7',
          },
          {
            key: 'sipgate_ai',
            label: 'sipgate.ai',
            count: marketingReach.marketingTouchSipgateAi,
            color: '#7c3aed',
          },
        ],
      },
      {
        key: 'activation',
        label: 'Signup',
        count: activationTotal,
        // Subgroups mirroren die "Activation"-Spalte im Sankey. Earliest-wins-
        // Priorität: agent > pbx > bestandskunde. Farben matchen COL1_META
        // in MarketingSankey.tsx (emerald/teal/slate).
        subgroups: [
          {
            key: 'agent_signup',
            label: 'Agent Signup',
            count: activationAgent,
            color: '#10b981',
          },
          {
            key: 'pbx_signup',
            label: 'PBX Signup',
            count: activationPbx,
            color: '#14b8a6',
          },
          {
            key: 'bestandskunde',
            label: 'Bestandskunde',
            count: activationBestand,
            color: '#94a3b8',
          },
        ],
      },
      {
        key: 'previewTrial',
        label: 'Agent Preview (Trial)',
        count: previewTrialTotal,
        subgroups: [
          { key: 'agent_signup', label: 'Agent Signup', count: previewTrialAgent, color: '#10b981' },
          { key: 'pbx_signup', label: 'PBX Signup', count: previewTrialPbx, color: '#14b8a6' },
          { key: 'bestandskunde', label: 'Bestandskunde', count: previewTrialBestand, color: '#94a3b8' },
        ],
      },
      {
        key: 'dealCreated',
        label: 'Deal angelegt',
        count: dealCreatedFromMarketing,
      },
      {
        key: 'dealWon',
        label: 'Deal gewonnen',
        count: dealWonFromMarketing,
      },
    ],
    bqTotals: {
      activationAgent: activationTotals.agentSignup,
      activationOther: activationTotals.otherSignup,
      activationTotal: activationTotals.total,
      previewTrialTotal: previewTrialTotals.total,
      previewTrialAgent: previewTrialTotals.agentSignup,
      previewTrialOther: previewTrialTotals.otherSignup,
      previewTrialBestandskunde: previewTrialTotals.bestandskunde,
    },
    dealsTotal: deals.length,
    dealsWonTotal,
    journeys,
  };
}
