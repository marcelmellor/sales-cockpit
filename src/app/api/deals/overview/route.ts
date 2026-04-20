import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getHubSpotClient } from '@/lib/hubspot/client';

export interface DealOverviewItem {
  id: string;
  companyName: string;
  revenue: number;
  agentsMinuten: number;
  productManager: string;
  angeboteneProdukte: string;
  dealStage: string;
  dealStageId: string;
  dealAge: number; // Alter des Deals in Tagen
  daysInStage: number; // Tage in aktueller Stage
  stageEnteredAt: string | null; // Datum, an dem der Deal in die aktuelle Stage verschoben wurde
  createdate: string | null; // Datum, an dem der Deal erstellt wurde
  closedate: string | null; // Datum, an dem der Deal geschlossen wurde
  nextAppointment: {
    date: string;
    title: string;
  } | null;
}

export interface PipelineOverviewResponse {
  pipelineId: string;
  pipelineName: string;
  stages: Array<{
    id: string;
    label: string;
    displayOrder: number;
    probability: number;
  }>;
  deals: DealOverviewItem[];
}

// Meeting data returned by the separate meetings endpoint
export interface DealMeetingsMap {
  [dealId: string]: {
    date: string;
    title: string;
  } | null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tvSecret = searchParams.get('tvSecret');
    const isValidTvSecret = tvSecret && process.env.TV_SECRET && tvSecret === process.env.TV_SECRET;

    if (!isValidTvSecret) {
      const session = await auth();
      if (!session) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
    }

    const pipelineId = searchParams.get('pipelineId');
    const produkt = searchParams.get('produkt');

    if (!pipelineId) {
      return NextResponse.json(
        { error: 'pipelineId is required' },
        { status: 400 }
      );
    }

    const client = getHubSpotClient();

    // Fetch pipeline info
    const pipelines = await client.getPipelines();
    const pipeline = pipelines.results.find(p => p.id === pipelineId);

    if (!pipeline) {
      return NextResponse.json(
        { error: 'Pipeline not found' },
        { status: 404 }
      );
    }

    // Fetch deals with associations (filtered by product if specified)
    const dealsWithAssociations = await client.getDealsWithAssociations(pipelineId, produkt || undefined);

    // For deals with line items, fetch the HubSpot product `category` so we can
    // verify the actual product mix. Line items are the source of truth;
    // `angebotene_produkte` may be stale. Using `category` is robust against
    // SKU renames (e.g. "AI Agent – Enterprise ab 2.500 Min" → "Enterprise ab 2.500 Min").
    const dealsWithLineItems = dealsWithAssociations.results.filter(
      d => (parseInt(d.properties.hs_num_of_associated_line_items) || 0) > 0
    );
    const lineItemCategoriesByDeal = await client.getLineItemCategoriesForDeals(
      dealsWithLineItems.map(d => d.id)
    );

    // Filter: if product filter is active, drop deals that have line items but none
    // of them match the selected product. Mapping from portfolio key → category value.
    const PRODUCT_CATEGORY: Record<string, string> = {
      frontdesk: 'AI Agent',
    };
    const requiredCategory = produkt ? PRODUCT_CATEGORY[produkt] : undefined;
    const filteredDeals = requiredCategory
      ? dealsWithAssociations.results.filter(deal => {
          const categories = lineItemCategoriesByDeal.get(deal.id);
          if (!categories) return true; // no line items → keep (legacy field was enough)
          return categories.some(cat => cat === requiredCategory);
        })
      : dealsWithAssociations.results;

    // Collect all company IDs
    const companyIds = new Set<string>();
    for (const deal of filteredDeals) {
      const companyAssoc = deal.associations?.companies?.results?.[0];
      if (companyAssoc) {
        companyIds.add(companyAssoc.id);
      }
    }

    // Batch fetch companies
    const companiesMap = new Map<string, { name: string }>();
    if (companyIds.size > 0) {
      const companies = await client.getCompanies(Array.from(companyIds));
      for (const company of companies.results) {
        companiesMap.set(company.id, {
          name: company.properties.name || 'Unknown',
        });
      }
    }

    // Helper to calculate deal age in days
    const calculateDealAge = (createdate: string | undefined): number => {
      if (!createdate) return 0;
      const created = new Date(createdate);
      const now = new Date();
      const diffTime = now.getTime() - created.getTime();
      return Math.floor(diffTime / (1000 * 60 * 60 * 24));
    };

    // Calculate AI Agent MRR from agent minutes using package pricing
    // Each package has included minutes + a per-minute rate for overage
    // Pick the cheapest package for the given minute volume
    function calculateAgentMrr(minutes: number): number {
      if (minutes <= 0) return 0;

      const packages = [
        { included: 300, price: 74.95, perMinute: 0.25 },
        { included: 1000, price: 199.95, perMinute: 0.20 },
        { included: 2500, price: 449.95, perMinute: 0.18 },
        { included: 10000, price: 1499.95, perMinute: 0.15 },
      ];

      return Math.min(
        ...packages.map(pkg =>
          pkg.price + Math.max(0, minutes - pkg.included) * pkg.perMinute
        )
      );
    }

    // Build the overview items (without meetings - those are loaded separately)
    const deals: DealOverviewItem[] = filteredDeals.map((deal) => {
      const companyId = deal.associations?.companies?.results?.[0]?.id;
      const company = companyId ? companiesMap.get(companyId) : undefined;

      // Prefer qualified minutes, fall back to old field
      const agentMinuten = parseInt(deal.properties.agents_minuten_qualifiziert) || parseInt(deal.properties.agents_minuten) || 0;

      return {
        id: deal.id,
        companyName: company?.name || deal.properties.dealname || 'Unknown',
        revenue: (() => {
          // We compute MRR from whichever signal is available — line items
          // (hs_mrr) and agent minutes can each be incomplete for a given
          // deal:
          //  - hs_mrr is 0 if the line items aren't marked recurring or the
          //    property is simply unset
          //  - agents_minuten_qualifiziert is 0 if the deal predates that
          //    qualification step
          // So for AI Agent deals we take the max of both (either signal is
          // better than dropping the deal to 0). For non-AI-Agent deals we
          // fall back to TCV/Laufzeit only when there's no line-item MRR.
          const products = deal.properties.angebotene_produkte || '';
          const isAiAgent = products.split(';').includes('frontdesk');
          const lineItemCount = parseInt(deal.properties.hs_num_of_associated_line_items) || 0;
          const lineItemMrr = lineItemCount > 0 ? (parseFloat(deal.properties.hs_mrr) || 0) : 0;

          if (isAiAgent) {
            return Math.max(lineItemMrr, calculateAgentMrr(agentMinuten));
          }

          if (lineItemMrr > 0) return lineItemMrr;

          const tcv = parseFloat(deal.properties.tcv) || 0;
          const laufzeit = parseFloat(deal.properties.vertragsdauer) || 0;
          return laufzeit > 0 ? tcv / laufzeit : 0;
        })(),
        agentsMinuten: agentMinuten,
        productManager: deal.properties.deal_po || '',
        angeboteneProdukte: deal.properties.angebotene_produkte || '',
        dealStage: pipeline.stages.find(s => s.id === deal.properties.dealstage)?.label || deal.properties.dealstage || 'Unknown',
        dealStageId: deal.properties.dealstage || '',
        dealAge: calculateDealAge(deal.properties.createdate),
        daysInStage: -1, // Loaded separately via /api/deals/overview/stage-history
        stageEnteredAt: null, // Loaded separately via /api/deals/overview/stage-history
        createdate: deal.properties.createdate || null,
        closedate: deal.properties.closedate || null,
        nextAppointment: null, // Loaded separately via /api/deals/overview/meetings
      };
    });

    const response: PipelineOverviewResponse = {
      pipelineId: pipeline.id,
      pipelineName: pipeline.label,
      stages: pipeline.stages.map((stage, index) => ({
        id: stage.id,
        label: stage.label,
        displayOrder: index,
        probability: parseFloat(stage.metadata?.probability || '0'),
      })),
      deals,
    };

    return NextResponse.json({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('Error fetching pipeline overview:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch pipeline overview', details: errorMessage },
      { status: 500 }
    );
  }
}
