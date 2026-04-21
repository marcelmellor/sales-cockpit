import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getHubSpotClient } from '@/lib/hubspot/client';

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
      const session = await auth();
      if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const produkt = searchParams.get('produkt');

    const client = getHubSpotClient();

    const pipelinesResp = await client.getLeadPipelines();
    const pipeline = pipelinesResp.results.find(p => p.id === LEAD_PIPELINE_ID);

    if (!pipeline) {
      return NextResponse.json(
        { error: `Lead pipeline ${LEAD_PIPELINE_ID} not found` },
        { status: 404 }
      );
    }

    const stagesById = new Map(pipeline.stages.map(s => [s.id, s]));

    const leadsResp = await client.getLeadsWithAssociations(LEAD_PIPELINE_ID, produkt || undefined);

    // Batch-fetch company names
    const companyIds = new Set<string>();
    for (const l of leadsResp.results) {
      const cid = l.associations?.companies?.results?.[0]?.id;
      if (cid) companyIds.add(cid);
    }
    const companiesMap = new Map<string, { name: string }>();
    if (companyIds.size > 0) {
      const companies = await client.getCompanies(Array.from(companyIds));
      for (const c of companies.results) {
        companiesMap.set(c.id, { name: c.properties.name || 'Unknown' });
      }
    }

    const calculateLeadAge = (createdate: string | undefined): number => {
      if (!createdate) return 0;
      const created = new Date(createdate);
      const now = new Date();
      return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    };

    // Stage-Historie für alle Leads batch-lesen und daraus pro Lead den
    // letzten Eintritt in die aktuelle Stage + Tage in Stage berechnen.
    const leadIds = leadsResp.results.map(l => l.id);
    const stageHistories = await client.getLeadStageHistories(leadIds);
    const stageInfoById = new Map<string, { daysInStage: number; stageEnteredAt: string | null }>();
    const nowMs = Date.now();
    for (const lead of leadsResp.results) {
      const currentStage = lead.properties.hs_pipeline_stage;
      const history = stageHistories.get(lead.id) || [];
      // HubSpot liefert die Historie absteigend (neueste zuerst). Wir suchen
      // den neuesten Eintrag, dessen Wert die aktuelle Stage ist — das ist
      // der Zeitpunkt, an dem der Lead in die jetzige Stage gewechselt hat.
      const latestEntry = history.find(h => h.value === currentStage);
      if (latestEntry?.timestamp) {
        const t = new Date(latestEntry.timestamp).getTime();
        const days = Math.floor((nowMs - t) / (1000 * 60 * 60 * 24));
        stageInfoById.set(lead.id, { daysInStage: days, stageEnteredAt: latestEntry.timestamp });
      } else {
        stageInfoById.set(lead.id, { daysInStage: -1, stageEnteredAt: null });
      }
    }

    // Prüfen, ob der primäre Kontakt eines Leads bereits an einem Deal im
    // gleichen Produkt-Bucket hängt (nur wenn produkt-gefiltert, sonst zu
    // unspezifisch für das Tag).
    const existingDealsByContact = produkt
      ? await client.getContactsWithDealInProdukt(DEALS_PIPELINE_ID, produkt)
      : new Map<string, { dealId: string; dealName: string }>();

    const leads: LeadOverviewItem[] = leadsResp.results.map((lead) => {
      const companyId = lead.associations?.companies?.results?.[0]?.id;
      const contactId = lead.associations?.contacts?.results?.[0]?.id;
      const company = companyId ? companiesMap.get(companyId) : undefined;
      const stage = stagesById.get(lead.properties.hs_pipeline_stage);
      // HubSpot multi-select enums serialize as semicolon-separated strings
      const productRaw = lead.properties.product || '';
      const productList = productRaw ? productRaw.split(';').map(s => s.trim()).filter(Boolean) : [];
      const existingDeal = contactId ? existingDealsByContact.get(contactId) : undefined;

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

    return NextResponse.json({ success: true, data: response });
  } catch (error) {
    console.error('Error fetching leads overview:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch leads overview', details: errorMessage },
      { status: 500 }
    );
  }
}
