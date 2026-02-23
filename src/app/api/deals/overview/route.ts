import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getHubSpotClient } from '@/lib/hubspot/client';

export interface DealOverviewItem {
  id: string;
  companyName: string;
  revenue: number;
  agentsMinuten: number;
  productManager: string;
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
    const session = await auth();

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const pipelineId = searchParams.get('pipelineId');

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

    // Fetch deals with associations
    const dealsWithAssociations = await client.getDealsWithAssociations(pipelineId);

    // Collect all company IDs
    const companyIds = new Set<string>();
    for (const deal of dealsWithAssociations.results) {
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

    // Build the overview items (without meetings - those are loaded separately)
    const deals: DealOverviewItem[] = dealsWithAssociations.results.map((deal) => {
      const companyId = deal.associations?.companies?.results?.[0]?.id;
      const company = companyId ? companiesMap.get(companyId) : undefined;

      return {
        id: deal.id,
        companyName: company?.name || deal.properties.dealname || 'Unknown',
        revenue: (() => {
          const tcv = parseFloat(deal.properties.tcv) || 0;
          const laufzeit = parseFloat(deal.properties.vertragsdauer) || 0;
          return laufzeit > 0 ? tcv / laufzeit : 0;
        })(),
        agentsMinuten: parseInt(deal.properties.agents_minuten) || 0,
        productManager: deal.properties.deal_po || '',
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
