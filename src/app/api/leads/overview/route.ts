import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { serveWarmBacked } from '@/lib/overview/warm-cache';
import {
  buildLeadsOverview,
  leadsCacheKey,
  LEADS_CACHE_TTL_SECONDS,
  LeadPipelineNotFoundError,
} from '@/lib/overview/leads';

export type { LeadOverviewItem, LeadsOverviewResponse } from '@/lib/overview/leads';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tvSecret = searchParams.get('tvSecret');
    const isValidTvSecret = tvSecret && process.env.TV_SECRET && tvSecret === process.env.TV_SECRET;

    if (!isValidTvSecret) {
      const session = await getSession();
      if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const produkt = searchParams.get('produkt');
    const forceRefresh = searchParams.get('refresh') === '1';

    const result = await serveWarmBacked(
      leadsCacheKey(produkt),
      LEADS_CACHE_TTL_SECONDS,
      () => buildLeadsOverview(produkt),
      { forceRefresh },
    );

    // Cold cache in production: the background warmer was nudged but there is
    // nothing to serve yet. Never build synchronously here (would blow the
    // Netlify function timeout → 502). Ask the client to retry shortly.
    if (!result) {
      return NextResponse.json(
        { success: false, warming: true, error: 'Cache is warming up, retry shortly.' },
        { status: 503, headers: { 'Retry-After': '10' } },
      );
    }

    return NextResponse.json({ success: true, data: result.data, cache: result.meta });
  } catch (error) {
    if (error instanceof LeadPipelineNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error('Error fetching leads overview:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch leads overview', details: errorMessage },
      { status: 500 }
    );
  }
}
