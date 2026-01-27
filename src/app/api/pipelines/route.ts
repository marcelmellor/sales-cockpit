import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { HubSpotClient } from '@/lib/hubspot/client';

export async function GET() {
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

    const client = new HubSpotClient(session.accessToken);
    const pipelines = await client.getPipelines();

    return NextResponse.json({
      success: true,
      data: pipelines.results,
    });
  } catch (error) {
    console.error('Error fetching pipelines:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipelines' },
      { status: 500 }
    );
  }
}
