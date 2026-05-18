import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { getOrFetch } from '@/lib/server-cache';
import { getAiAgentsFunnelTop } from '@/lib/amplitude/funnel';
import { getTouchpointsByEmail, Touchpoint } from '@/lib/amplitude/journeys';
import { getAgentsQualificationByMastersipid } from '@/lib/amplitude/agents-events';
import { getCustomerCreationByMastersipid } from '@/lib/amplitude/customer-info';

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

export interface MarketingFunnelStage {
  key: 'marketingTouch' | 'trialSignup' | 'dealCreated' | 'dealWon';
  label: string;
  count: number;
}

export type MarketingJourneyKind = 'deal' | 'lead';

export interface MarketingFunnelJourney {
  kind: MarketingJourneyKind;
  entityId: string;                 // dealId (kind='deal') or leadId (kind='lead')
  companyName: string;
  stageLabel: string;
  stageIsWon: boolean;              // only meaningful for deals
  stageIsLost: boolean;             // only meaningful for deals
  hasLead: boolean;                 // a HubSpot AI-Agents-Lead exists für diesen Entry
  hasDeal: boolean;                 // ein HubSpot AI-Agents-Deal existiert für diesen Entry
  touchpoints: Touchpoint[];        // Amplitude + HubSpot-Lifecycle, chronologisch
  customerSince: string | null;     // sipgate-Account-Anlage-Datum (frühester Contact)
}

export interface MarketingFunnelResponse {
  funnel: MarketingFunnelStage[];
  dealsTotal: number;       // total AI-Agents deals in scope
  dealsWonTotal: number;    // won AI-Agents deals (regardless of Amplitude)
  journeys: MarketingFunnelJourney[];
}

function isWonStage(label: string): boolean {
  const l = label.toLowerCase();
  if (l.includes('closed lost') || l.includes('verloren') || l.includes('lost')) return false;
  return l.includes('closed won') || l.includes('gewonnen') || l.includes('won');
}

function isLostStage(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes('closed lost') || l.includes('verloren') || l.includes('lost') || l.includes('abgesagt');
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
    const cacheKey = 'marketing-funnel:frontdesk';
    const { data, meta } = await getOrFetch<MarketingFunnelResponse>(
      cacheKey,
      CACHE_TTL_SECONDS,
      buildMarketingFunnel,
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

async function buildMarketingFunnel(): Promise<MarketingFunnelResponse> {
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
  if (contactIds.size > 0) {
    const contacts = await client.getContacts(Array.from(contactIds), ['email', 'mastersipid']);
    for (const c of contacts.results) {
      const email = (c.properties.email || '').trim().toLowerCase();
      if (email) contactEmailById.set(c.id, email);
      const msid = (c.properties.mastersipid || '').trim();
      if (msid) contactMastersipidById.set(c.id, msid);
    }
  }

  const allEmails = Array.from(new Set(contactEmailById.values()));
  const allMastersipids = Array.from(new Set(contactMastersipidById.values()));

  // Four BQ queries in parallel — funnel-top (independent), per-email
  // touchpoints (Marketing-Site + Signup-Atlantis + Lead-Form), per-
  // mastersipid agents-qualification events (in-product), and per-mastersipid
  // customer-creation lookup (für die "Bestandskunde seit JJJJ"-Badge).
  // Fail-safe per query so a single failure doesn't blank the whole tab.
  const [funnelTop, touchpointsByEmail, qualificationByMsid, customerSinceByMsid] = await Promise.all([
    getAiAgentsFunnelTop().catch(err => {
      console.error('[marketing/funnel] funnel-top failed:', err);
      return { marketingTouch: 0, trialSignup: 0 };
    }),
    allEmails.length > 0
      ? getTouchpointsByEmail(allEmails).catch(err => {
          console.error('[marketing/funnel] touchpoints failed:', err);
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
      for (const t of [...fromEmail, ...fromMsid]) {
        const key = `${t.eventType}|${t.occurredAt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(t);
      }
    }
    if (leadCreatedAt) {
      merged.push({
        eventType: 'Lead angelegt',
        occurredAt: new Date(leadCreatedAt).toISOString(),
        anchor: 'hubspot_lead_created',
        leadSourceDetails: null,
        inboundValue: null,
        signupProduct: null,
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
      });
    }
    merged.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
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

  return {
    funnel: [
      { key: 'marketingTouch', label: 'Marketing-Touch', count: funnelTop.marketingTouch },
      { key: 'trialSignup', label: 'Trial-Signup', count: funnelTop.trialSignup },
      { key: 'dealCreated', label: 'Deal angelegt', count: dealsWithTouchCount },
      { key: 'dealWon', label: 'Deal gewonnen', count: wonDealsWithTouchCount },
    ],
    dealsTotal: deals.length,
    dealsWonTotal,
    journeys,
  };
}
