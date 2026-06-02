import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getPlaybookStats, type PlaybookStats } from '@/lib/amplitude/playbook-stats';
import { getOrFetch } from '@/lib/server-cache';

const CACHE_TTL_SECONDS = 30 * 60;

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const daysRaw = Number(searchParams.get('days'));
    const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 365 ? daysRaw : 90;
    const forceRefresh = searchParams.get('refresh') === '1';

    const { data, meta } = await getOrFetch<PlaybookStats>(
      `playbook-stats:${days}d`,
      CACHE_TTL_SECONDS,
      () => getPlaybookStats(days),
      { forceRefresh },
    );
    return NextResponse.json({ success: true, data, cache: meta });
  } catch (err) {
    console.error('[playbook-stats]', err);
    return NextResponse.json(
      { error: 'Failed to fetch playbook stats' },
      { status: 500 },
    );
  }
}
