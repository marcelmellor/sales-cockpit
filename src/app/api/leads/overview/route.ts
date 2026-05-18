import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { getOrFetch } from '@/lib/server-cache';
import {
  AmplitudeAttribution,
  getAiAgentsAttributionByEmail,
} from '@/lib/amplitude/attribution';

const CACHE_TTL_SECONDS = 5 * 60;

class LeadPipelineNotFoundError extends Error {
  constructor(public pipelineId: string) {
    super(`Lead pipeline ${pipelineId} not found`);
    this.name = 'LeadPipelineNotFoundError';
  }
}

// HubSpot has multiple lead pipelines in sipgate 2025 — "Inbound", "Outbound",
// "Cold Calls", etc. The one tied to the sales portfolio (same logical pipeline
// as the deals pipeline "Sales sipgate Portfolio") is called "sipgate Portfolio"
// on the Leads object. We hardcode its ID because there's no runtime lookup
// path for leads today and it's a stable ID in the sipgate 2025 HubSpot.
const LEAD_PIPELINE_ID = '3591532731';

// Deal-Pipeline "Sales sipgate Portfolio" — nutzen wir, um zu prüfen, ob der
// primäre Kontakt eines Leads bereits an einem Deal im selben Produkt-Bucket
// hängt (Duplicate-/Upsell-Signal).
const DEALS_PIPELINE_ID = '3576006860';

export interface LeadOverviewItem {
  id: string;
  leadName: string;
  companyName: string | null;
  companyId: string | null;
  contactId: string | null; // primary associated contact (first one HubSpot returns)
  ownerId: string | null;
  leadStage: string;
  leadStageId: string;
  leadStageIsClosed: boolean;
  leadSource: string | null; // free-text e.g. "Rueckruf anfordern (Frontdesk)"
  source: string | null; // enum e.g. "Contact Form"
  product: string[]; // selected product keys, e.g. ["frontdesk"]
  leadAge: number; // days since creation
  daysInStage: number; // Tage in aktueller Lead-Stage (-1 wenn unbekannt)
  stageEnteredAt: string | null; // Timestamp, wann die aktuelle Stage betreten wurde
  createdate: string | null;
  agentsMinuten: number | null; // exakte Zahl, gesetzt v.a. bei qualifizierten AI-Agent-Leads
  inboundVolumen: string | null; // Range, z.B. "0-1000", "1000-5000"
  existingDealId: string | null; // Deal-ID, falls primärer Kontakt bereits an einem passenden Deal hängt
  existingDealName: string | null;
  // HubSpot-Analytics des primären Kontakts — zeigt, wie/von wo der Kontakt
  // ursprünglich reingekommen ist (Original Source + First URL).
  analyticsSource: string | null; // Rohwert, z.B. "DIRECT_TRAFFIC", "ORGANIC_SEARCH"
  analyticsFirstUrl: string | null;
  // Aus analyticsFirstUrl geparste UTM-Parameter. Virtuell: werden nicht
  // separat von HubSpot geholt, sondern direkt aus der First-URL extrahiert.
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  // Deal-IDs, mit denen dieser Lead in HubSpot direkt assoziiert ist
  // (leads → deals). Brauchen wir, um im Dashboard Deals nach Lead-Source
  // zu gruppieren — die umgekehrte Assoc (deals → leads) existiert in
  // HubSpot nicht, wir müssen den Join lead-seitig auflösen.
  associatedDealIds: string[];
  // Amplitude-Attribution: das früheste AI-Agents-flavoured Event des
  // primären Kontakts (Match über LOWER(email) = Amplitude `user_id`).
  // Phase 1 nur für `?produkt=frontdesk`. null wenn kein Match oder anderer
  // Produkt-Filter aktiv ist.
  amplitudeSource: AmplitudeAttribution | null;
}

// UTM-Parameter aus einer URL extrahieren. Akzeptiert absolute wie relative
// URLs (Dummy-Base für Relative-Parsing). Gibt überall null zurück, wenn die
// URL nicht parsebar ist oder keine UTM-Query-Params enthält.
function parseUtmParams(url: string | null): {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
} {
  const empty = {
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
  };
  if (!url) return empty;
  try {
    const u = new URL(url, 'http://_utm-parse.local/');
    return {
      utmSource: u.searchParams.get('utm_source') || null,
      utmMedium: u.searchParams.get('utm_medium') || null,
      utmCampaign: u.searchParams.get('utm_campaign') || null,
      utmTerm: u.searchParams.get('utm_term') || null,
      utmContent: u.searchParams.get('utm_content') || null,
    };
  } catch {
    return empty;
  }
}

export interface LeadsOverviewResponse {
  pipelineId: string;
  pipelineName: string;
  stages: Array<{
    id: string;
    label: string;
    displayOrder: number;
    isClosed: boolean;
  }>;
  leads: LeadOverviewItem[];
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
    const forceRefresh = searchParams.get('refresh') === '1';

    const cacheKey = `leads-overview:${produkt ?? '_all'}`;
    const { data: response, meta } = await getOrFetch<LeadsOverviewResponse>(
      cacheKey,
      CACHE_TTL_SECONDS,
      () => buildLeadsOverview(produkt),
      { forceRefresh },
    );

    return NextResponse.json({ success: true, data: response, cache: meta });
  } catch (error) {
    if (error instanceof LeadPipelineNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error('Error fetching leads overview:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch leads overview', details: errorMessage },
      { status: 500 }
    );
  }
}

async function buildLeadsOverview(produkt: string | null): Promise<LeadsOverviewResponse> {
    const client = getHubSpotClient();

    // Phase 1 — alle drei Top-Level-Calls parallel anstoßen. Die existing-
    // Deals-Lookup hängt nicht von den Leads ab und kann gleichzeitig mit
    // pipelines + leads laufen.
    const [pipelinesResp, leadsResp, existingDealsByContact] = await Promise.all([
      client.getLeadPipelines(),
      client.getLeadsWithAssociations(LEAD_PIPELINE_ID, produkt || undefined),
      produkt
        ? client.getContactsWithDealInProdukt(DEALS_PIPELINE_ID, produkt)
        : Promise.resolve(new Map<string, { dealId: string; dealName: string }>()),
    ]);

    const pipeline = pipelinesResp.results.find(p => p.id === LEAD_PIPELINE_ID);

    if (!pipeline) {
      throw new LeadPipelineNotFoundError(LEAD_PIPELINE_ID);
    }

    const stagesById = new Map(pipeline.stages.map(s => [s.id, s]));

    // IDs aus den Leads für Phase 2 sammeln.
    const companyIds = new Set<string>();
    const contactIdsForAnalytics = new Set<string>();
    for (const l of leadsResp.results) {
      const cid = l.associations?.companies?.results?.[0]?.id;
      if (cid) companyIds.add(cid);
      const contactId = l.associations?.contacts?.results?.[0]?.id;
      if (contactId) contactIdsForAnalytics.add(contactId);
    }
    const leadIds = leadsResp.results.map(l => l.id);

    // Phase 2 — Companies + StageHistory + ContactAnalytics parallel.
    // ContactAnalytics fail-safe: bricht der Batch-Read (fehlender Scope, 429,
    // ...), zeigen wir leere Spalten statt den ganzen Leads-View zu killen.
    // Bei AI-Agents-View (produkt=frontdesk) ziehen wir zusätzlich `email`,
    // um die Amplitude-Attribution per Email zu joinen.
    const wantAmplitude = produkt === 'frontdesk';
    const contactProperties = wantAmplitude
      ? ['hs_analytics_source', 'hs_analytics_first_url', 'email']
      : ['hs_analytics_source', 'hs_analytics_first_url'];
    const [companiesResp, stageHistories, contactsResp] = await Promise.all([
      companyIds.size > 0
        ? client.getCompanies(Array.from(companyIds))
        : Promise.resolve({ results: [] as Array<{ id: string; properties: { name?: string } }> }),
      client.getLeadStageHistories(leadIds),
      contactIdsForAnalytics.size > 0
        ? client.getContacts(Array.from(contactIdsForAnalytics), contactProperties).catch((err) => {
            console.error('[leads/overview] contact analytics batch failed:', err);
            return { results: [] as Array<{ id: string; properties: Record<string, string> }> };
          })
        : Promise.resolve({ results: [] as Array<{ id: string; properties: Record<string, string> }> }),
    ]);

    const companiesMap = new Map<string, { name: string }>();
    for (const c of companiesResp.results) {
      companiesMap.set(c.id, { name: c.properties.name || 'Unknown' });
    }

    const contactAnalyticsById = new Map<
      string,
      { source: string | null; firstUrl: string | null; email: string | null }
    >();
    for (const c of contactsResp.results) {
      contactAnalyticsById.set(c.id, {
        source: c.properties.hs_analytics_source || null,
        firstUrl: c.properties.hs_analytics_first_url || null,
        email: c.properties.email || null,
      });
    }

    // Amplitude-Attribution: einen einzigen BQ-Query für alle Lead-Kontakte.
    // Fail-safe — bricht BQ (fehlende Creds, IAM, Netz), liefern wir leere
    // Map und der Rest des Views funktioniert weiter ohne Amplitude-Badge.
    const amplitudeByEmail = await (async (): Promise<Map<string, AmplitudeAttribution>> => {
      if (!wantAmplitude) return new Map();
      const emails = Array.from(contactAnalyticsById.values())
        .map(c => c.email)
        .filter((e): e is string => !!e);
      if (emails.length === 0) return new Map();
      try {
        return await getAiAgentsAttributionByEmail(emails);
      } catch (err) {
        console.error('[leads/overview] amplitude attribution lookup failed:', err);
        return new Map();
      }
    })();

    const calculateLeadAge = (createdate: string | undefined): number => {
      if (!createdate) return 0;
      const created = new Date(createdate);
      const now = new Date();
      return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    };

    // Pro Lead: letzter Eintritt in die aktuelle Stage + Tage in Stage.
    // HubSpot liefert die Historie absteigend (neueste zuerst); wir suchen den
    // neuesten Eintrag, dessen Wert die aktuelle Stage ist.
    const stageInfoById = new Map<string, { daysInStage: number; stageEnteredAt: string | null }>();
    const nowMs = Date.now();
    for (const lead of leadsResp.results) {
      const currentStage = lead.properties.hs_pipeline_stage;
      const history = stageHistories.get(lead.id) || [];
      const latestEntry = history.find(h => h.value === currentStage);
      if (latestEntry?.timestamp) {
        const t = new Date(latestEntry.timestamp).getTime();
        const days = Math.floor((nowMs - t) / (1000 * 60 * 60 * 24));
        stageInfoById.set(lead.id, { daysInStage: days, stageEnteredAt: latestEntry.timestamp });
      } else {
        stageInfoById.set(lead.id, { daysInStage: -1, stageEnteredAt: null });
      }
    }

    const leads: LeadOverviewItem[] = leadsResp.results.map((lead) => {
      const companyId = lead.associations?.companies?.results?.[0]?.id;
      const contactId = lead.associations?.contacts?.results?.[0]?.id;
      const company = companyId ? companiesMap.get(companyId) : undefined;
      const stage = stagesById.get(lead.properties.hs_pipeline_stage);
      // HubSpot multi-select enums serialize as semicolon-separated strings
      const productRaw = lead.properties.product || '';
      const productList = productRaw ? productRaw.split(';').map(s => s.trim()).filter(Boolean) : [];
      const existingDeal = contactId ? existingDealsByContact.get(contactId) : undefined;
      const analytics = contactId ? contactAnalyticsById.get(contactId) : undefined;

      return {
        id: lead.id,
        leadName: lead.properties.hs_lead_name || 'Unbenannter Lead',
        companyName: company?.name || null,
        companyId: companyId || null,
        contactId: contactId || null,
        ownerId: lead.properties.hubspot_owner_id || null,
        leadStage: stage?.label || lead.properties.hs_pipeline_stage || 'Unknown',
        leadStageId: lead.properties.hs_pipeline_stage || '',
        leadStageIsClosed: stage?.metadata?.isClosed === 'true',
        leadSource: lead.properties.lead_source || null,
        source: lead.properties.source || null,
        product: productList,
        leadAge: calculateLeadAge(lead.properties.hs_createdate),
        daysInStage: stageInfoById.get(lead.id)?.daysInStage ?? -1,
        stageEnteredAt: stageInfoById.get(lead.id)?.stageEnteredAt ?? null,
        createdate: lead.properties.hs_createdate || null,
        agentsMinuten: lead.properties.agents_minuten ? Number(lead.properties.agents_minuten) : null,
        inboundVolumen: lead.properties.inbound_volumen || null,
        existingDealId: existingDeal?.dealId || null,
        existingDealName: existingDeal?.dealName || null,
        analyticsSource: analytics?.source ?? null,
        analyticsFirstUrl: analytics?.firstUrl ?? null,
        ...parseUtmParams(analytics?.firstUrl ?? null),
        associatedDealIds: (lead.associations?.deals?.results ?? []).map(a => a.id),
        amplitudeSource: analytics?.email
          ? amplitudeByEmail.get(analytics.email.toLowerCase()) ?? null
          : null,
      };
    });

    const response: LeadsOverviewResponse = {
      pipelineId: pipeline.id,
      pipelineName: pipeline.label,
      stages: pipeline.stages
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((s, idx) => ({
          id: s.id,
          label: s.label,
          displayOrder: idx,
          isClosed: s.metadata?.isClosed === 'true',
        })),
      leads,
    };

    return response;
}
