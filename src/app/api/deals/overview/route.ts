import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { HubSpotClient } from '@/lib/hubspot/client';

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

    if (!session?.accessToken) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (session.error === 'RefreshAccessTokenError') {
      return NextResponse.json(
        { error: 'Session expired', code: 'REFRESH_ERROR' },
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

    const client = new HubSpotClient(session.accessToken);

    // Fetch pipeline info
    const pipelines = await client.getPipelines();
    const pipeline = pipelines.results.find(p => p.id === pipelineId);

    if (!pipeline) {
      return NextResponse.json(
        { error: 'Pipeline not found' },
        { status: 404 }
      );
    }

    // Extract stage IDs for fetching stage entry dates
    const stageIds = pipeline.stages.map(s => s.id);
    console.log('[DaysInStage] Stage IDs:', stageIds);

    // Fetch deals with associations and stage entry dates
    const dealsWithAssociations = await client.getDealsWithAssociations(pipelineId, stageIds);

    // Debug: Log first deal's properties to see what HubSpot returns
    if (dealsWithAssociations.results.length > 0) {
      const firstDeal = dealsWithAssociations.results[0];
      const hsDateProps = Object.entries(firstDeal.properties)
        .filter(([key]) => key.startsWith('hs_date_entered'))
        .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
      console.log('[DaysInStage] First deal hs_date_entered_* properties:', hsDateProps);
    }

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

    // Helper to calculate days in current stage
    // Returns -1 if no stage entry date is available (to distinguish from "0 days")
    const calculateDaysInStage = (
      dealstageId: string | undefined,
      properties: Record<string, string>,
      dealName?: string
    ): number => {
      if (!dealstageId) return -1;
      const propertyKey = `hs_date_entered_${dealstageId}`;
      const stageEnteredDate = properties[propertyKey];

      // Debug logging
      console.log(`[DaysInStage] Deal: ${dealName}, StageId: ${dealstageId}, Property: ${propertyKey}, Value: ${stageEnteredDate}`);

      if (!stageEnteredDate) return -1;
      const entered = new Date(stageEnteredDate);
      const now = new Date();
      const diffTime = now.getTime() - entered.getTime();
      const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      console.log(`[DaysInStage] -> Calculated ${days} days in stage`);
      return days;
    };

    // Build the overview items (without meetings - those are loaded separately)
    const deals: DealOverviewItem[] = dealsWithAssociations.results.map((deal) => {
      const companyId = deal.associations?.companies?.results?.[0]?.id;
      const company = companyId ? companiesMap.get(companyId) : undefined;

      return {
        id: deal.id,
        companyName: company?.name || deal.properties.dealname || 'Unknown',
        revenue: parseFloat(deal.properties.amount) || 0,
        agentsMinuten: parseInt(deal.properties.agents_minuten) || 0,
        productManager: deal.properties.deal_po || '',
        dealStage: pipeline.stages.find(s => s.id === deal.properties.dealstage)?.label || deal.properties.dealstage || 'Unknown',
        dealStageId: deal.properties.dealstage || '',
        dealAge: calculateDealAge(deal.properties.createdate),
        daysInStage: calculateDaysInStage(deal.properties.dealstage, deal.properties, deal.properties.dealname),
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
