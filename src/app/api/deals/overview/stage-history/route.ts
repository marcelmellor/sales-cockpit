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

    // Single batch read with `propertiesWithHistory` instead of one GET per
    // deal — same reasoning as the meetings endpoint. See AGENTS.md "Never
    // fan out per deal — always batch".
    const historiesByDeal = await client.getDealStageHistories(dealIdList);

    const stageHistoryMap: DealStageHistoryMap = {};
    for (const dealId of dealIdList) {
      const history = historiesByDeal.get(dealId);
      if (history && history.length > 0) {
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
