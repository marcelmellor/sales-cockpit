import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { HubSpotClient } from '@/lib/hubspot/client';

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
    const pipelineId = searchParams.get('pipelineId') || undefined;

    const client = new HubSpotClient(session.accessToken);
    const deals = await client.getDeals(pipelineId);

    return NextResponse.json({
      success: true,
      data: deals.results,
    });
  } catch (error) {
    console.error('Error fetching deals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch deals' },
      { status: 500 }
    );
  }
}
