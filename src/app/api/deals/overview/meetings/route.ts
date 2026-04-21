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

    // Single pair of batch calls instead of 2 per deal — stays inside
    // HubSpot's 10 req/s limit even for large pipelines. Previously the
    // per-deal fan-out silently swallowed 429s and cached nulls in the
    // client, which is how "no next meeting" showed up on deals that clearly
    // had one (e.g. 497714974930 "Taxi Höhne - AI Agents").
    const meetingsPerDeal = await client.getMeetingsForDeals(dealIdList);

    const meetingsMap: DealMeetingsMap = {};
    for (const dealId of dealIdList) {
      const meetings = meetingsPerDeal.get(dealId) || [];
      const upcomingMeetings = meetings
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
