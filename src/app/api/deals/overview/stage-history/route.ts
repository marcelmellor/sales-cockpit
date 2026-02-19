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
    const session = await auth();

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
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

    // Fetch stage history sequentially to avoid rate limits
    // Similar to meetings: 250ms delay between requests
    const stageHistoryMap: DealStageHistoryMap = {};

    for (let i = 0; i < dealIdList.length; i++) {
      const dealId = dealIdList[i];
      try {
        const dealWithHistory = await client.getDealStageHistory(dealId);
        const history = dealWithHistory.propertiesWithHistory?.dealstage;

        if (history && history.length > 0) {
          // History is sorted newest first, so [0] is the most recent stage change
          const latestEntry = history[0];
          const stageEnteredAt = latestEntry.timestamp;
          const entered = new Date(stageEnteredAt);
          const diffTime = now.getTime() - entered.getTime();
          const daysInStage = Math.floor(diffTime / (1000 * 60 * 60 * 24));

          stageHistoryMap[dealId] = {
            stageEnteredAt,
            daysInStage,
            history: history.map(entry => ({
              stageId: entry.value,
              timestamp: entry.timestamp,
            })),
          };
        } else {
          stageHistoryMap[dealId] = null;
        }
      } catch {
        stageHistoryMap[dealId] = null;
      }

      // 250ms delay between deals to respect rate limits
      if (i < dealIdList.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 250));
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
