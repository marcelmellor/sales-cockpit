import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getHubSpotClient } from '@/lib/hubspot/client';

export interface DealStageHistoryEntry {
  stageId: string;
  timestamp: string;
}

export interface DealStageHistoryMap {
  [dealId: string]: {
    stageEnteredAt: string;
    daysInStage: number;
    history: DealStageHistoryEntry[];
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

    const dealIds = searchParams.get('dealIds');

    if (!dealIds) {
      return NextResponse.json(
        { error: 'dealIds is required' },
        { status: 400 }
      );
    }

    const dealIdList = dealIds.split(',').filter(Boolean);
    if (dealIdList.length === 0) {
      return NextResponse.json({
        success: true,
        data: {},
      });
    }

    const client = getHubSpotClient();
    const now = new Date();

    // Process deals in parallel batches to stay within Netlify timeout
    // HubSpot rate limit: 10 req/s. getDealStageHistory makes 1 call per deal.
    // Batch of 8 = 8 API calls, then 300ms pause
    const BATCH_SIZE = 8;
    const BATCH_DELAY = 300;
    const stageHistoryMap: DealStageHistoryMap = {};

    for (let i = 0; i < dealIdList.length; i += BATCH_SIZE) {
      const batch = dealIdList.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (dealId) => {
          try {
            const dealWithHistory = await client.getDealStageHistory(dealId);
            const history = dealWithHistory.propertiesWithHistory?.dealstage;

            if (history && history.length > 0) {
              const latestEntry = history[0];
              const stageEnteredAt = latestEntry.timestamp;
              const entered = new Date(stageEnteredAt);
              const diffTime = now.getTime() - entered.getTime();
              const daysInStage = Math.floor(diffTime / (1000 * 60 * 60 * 24));

              return {
                dealId,
                value: {
                  stageEnteredAt,
                  daysInStage,
                  history: history.map(entry => ({
                    stageId: entry.value,
                    timestamp: entry.timestamp,
                  })),
                } as DealStageHistoryMap[string],
              };
            }
            return { dealId, value: null };
          } catch {
            return { dealId, value: null };
          }
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          stageHistoryMap[result.value.dealId] = result.value.value;
        }
      }

      if (i + BATCH_SIZE < dealIdList.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    }

    return NextResponse.json({
      success: true,
      data: stageHistoryMap,
    });
  } catch (error) {
    console.error('Error fetching stage history:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch stage history', details: errorMessage },
      { status: 500 }
    );
  }
}
