import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { serveWarmBacked } from '@/lib/overview/warm-cache';
import {
  buildMarketingFunnel,
  marketingFunnelCacheKey,
  MARKETING_FUNNEL_CACHE_TTL_SECONDS,
} from '@/lib/overview/marketing-funnel';
import { type MarketingFunnelResponse } from '@/lib/marketing/funnel-types';

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
    if (produkt !== 'frontdesk') {
      return NextResponse.json(
        { error: 'Marketing funnel is currently only available for AI Agents (produkt=frontdesk).' },
        { status: 400 },
      );
    }

    const forceRefresh = searchParams.get('refresh') === '1';
    // Funnel-Datums-Fenster — bestimmt sowohl die Marketing-Reach-Aggregation
    // in BQ als auch den HubSpot-Side-Cohort-Schnitt. Default 90 Tage.
    const daysRaw = Number(searchParams.get('days'));
    const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 365 ? daysRaw : 90;
    const result = await serveWarmBacked<MarketingFunnelResponse>(
      marketingFunnelCacheKey(days),
      MARKETING_FUNNEL_CACHE_TTL_SECONDS,
      () => buildMarketingFunnel(days),
      { forceRefresh },
    );

    // Cold cache in production: warmer nudged, nothing to serve yet. Never
    // build synchronously here (50s build → Netlify timeout → 502). Retry.
    if (!result) {
      return NextResponse.json(
        { success: false, warming: true, error: 'Cache is warming up, retry shortly.' },
        { status: 503, headers: { 'Retry-After': '10' } },
      );
    }

    return NextResponse.json({ success: true, data: result.data, cache: result.meta });
  } catch (error) {
    console.error('Error fetching marketing funnel:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch marketing funnel', details: errorMessage },
      { status: 500 },
    );
  }
}
