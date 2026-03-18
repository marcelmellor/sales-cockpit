import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getHubSpotClient } from '@/lib/hubspot/client';
import type { DealMeetingsMap } from '../route';

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
    // HubSpot rate limit: 10 req/s. getMeetingsForDeal makes 2 calls per deal.
    // Batch of 4 = 8 API calls, then 300ms pause ≈ 30 deals/sec capacity
    const BATCH_SIZE = 4;
    const BATCH_DELAY = 300;
    const meetingsMap: DealMeetingsMap = {};

    for (let i = 0; i < dealIdList.length; i += BATCH_SIZE) {
      const batch = dealIdList.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (dealId) => {
          try {
            const meetings = await client.getMeetingsForDeal(dealId);
            const upcomingMeetings = meetings.results
              .filter(m => {
                const startTime = m.properties.hs_meeting_start_time;
                return startTime && new Date(startTime) > now;
              })
              .sort((a, b) => {
                const aTime = new Date(a.properties.hs_meeting_start_time!).getTime();
                const bTime = new Date(b.properties.hs_meeting_start_time!).getTime();
                return aTime - bTime;
              });
            const nextMeeting = upcomingMeetings[0];
            return {
              dealId,
              value: nextMeeting
                ? { date: nextMeeting.properties.hs_meeting_start_time!, title: nextMeeting.properties.hs_meeting_title || 'Meeting' }
                : null,
            };
          } catch {
            return { dealId, value: null };
          }
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          meetingsMap[result.value.dealId] = result.value.value;
        }
      }

      if (i + BATCH_SIZE < dealIdList.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    }

    return NextResponse.json({
      success: true,
      data: meetingsMap,
    });
  } catch (error) {
    console.error('Error fetching meetings:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch meetings', details: errorMessage },
      { status: 500 }
    );
  }
}
