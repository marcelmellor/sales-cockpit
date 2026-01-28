import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { HubSpotClient } from '@/lib/hubspot/client';
import type { DealMeetingsMap } from '../route';

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

    const client = new HubSpotClient(session.accessToken);
    const now = new Date();

    // Fetch meetings sequentially to avoid rate limits
    // 10 requests per second max, getMeetingsForDeal makes 2 calls per deal
    // So we can do ~5 deals per second, use 250ms delay to be safe
    const meetingsMap: DealMeetingsMap = {};

    for (let i = 0; i < dealIdList.length; i++) {
      const dealId = dealIdList[i];
      try {
        const meetings = await client.getMeetingsForDeal(dealId);

        // Find next upcoming meeting
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
        meetingsMap[dealId] = nextMeeting
          ? {
              date: nextMeeting.properties.hs_meeting_start_time!,
              title: nextMeeting.properties.hs_meeting_title || 'Meeting',
            }
          : null;
      } catch {
        meetingsMap[dealId] = null;
      }

      // 250ms delay between deals (allows ~4 deals/sec with 2 API calls each = 8 calls/sec)
      if (i < dealIdList.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 250));
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
