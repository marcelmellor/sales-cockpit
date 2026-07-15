// Read-side companion to warm-targets.ts. The slow overview endpoints
// (leads/overview, marketing/funnel) use `serveWarmBacked` instead of
// `getOrFetch` so that on Netlify they NEVER build synchronously (a 34–50s
// build always exceeds the ~26s function timeout → 502). Instead:
//
//   - Steady state: a cache entry exists and is kept fresh by the background
//     warmer (see netlify/functions/warm-overview-cache-*). We serve it. Fast.
//   - Stale / user refresh: we still serve the existing entry immediately and
//     only *nudge* the background warmer to refresh it out-of-band.
//   - True cold start (no entry at all, e.g. right after a deploy before the
//     first cron tick): we can't build in-band, so we trigger the warmer and
//     return null. The route turns that into a 503 "warming" and the client
//     retries until the warmer has populated the cache (~50s–4min).
//
// Local dev (no Netlify runtime, no background functions) falls back to the
// old synchronous `getOrFetch` behaviour so `next dev` keeps working.

import {
  getOrFetch,
  readCacheEntry,
  isProdRuntime,
  cacheBackend,
  type CacheMeta,
} from '@/lib/server-cache';

export interface WarmBackedResult<T> {
  data: T;
  meta: CacheMeta;
}

// Fire-and-forget nudge to the background warmer. No-op off Netlify (dev) or
// when we can't resolve our own base URL. Guarded by TV_SECRET so the public
// `/.netlify/functions/...` endpoint can't be used to burn HubSpot/BQ quota.
export function triggerWarm(): void {
  if (!isProdRuntime()) return;
  const base = process.env.DEPLOY_PRIME_URL || process.env.URL;
  const secret = process.env.TV_SECRET;
  if (!base || !secret) return;
  // Background function replies 202 immediately; we don't await the actual work.
  void fetch(`${base}/.netlify/functions/warm-overview-cache-background`, {
    method: 'POST',
    headers: { 'x-warm-secret': secret },
  }).catch(() => {
    /* best-effort: a missed nudge is covered by the cron schedule */
  });
}

/**
 * Serve `key` from the warm cache without ever running the (slow) `builder`
 * synchronously on Netlify. Returns null only on a true cold miss — the caller
 * should then respond 503 "warming". `builder` is used exclusively for the
 * local-dev inline fallback.
 */
export async function serveWarmBacked<T>(
  key: string,
  ttlSeconds: number,
  builder: () => Promise<T>,
  opts: { forceRefresh?: boolean } = {},
): Promise<WarmBackedResult<T> | null> {
  // Local dev: no warmer infrastructure → behave like before (build inline).
  // Gated on NODE_ENV (not Blobs availability): even if Blobs were somehow
  // unreachable in production we must still NOT build synchronously there — a
  // 50s build would blow the function timeout → 502. Better a 503 "warming".
  if (!isProdRuntime()) {
    return getOrFetch<T>(key, ttlSeconds, builder, opts);
  }

  const entry = await readCacheEntry<T>(key);
  if (entry) {
    const ageMs = Date.now() - entry.timestamp;
    const stale = ageMs > ttlSeconds * 1000;
    // Refresh out-of-band when stale or when the user explicitly hit refresh —
    // but serve what we have right now either way (never block, never 502).
    if (stale || opts.forceRefresh) triggerWarm();
    return {
      data: entry.data,
      meta: { hit: true, cachedAt: entry.timestamp, ageMs, ttlSeconds, backend: cacheBackend() },
    };
  }

  // Cold miss: nothing to serve and we mustn't build in-band. Kick the warmer
  // and let the client retry.
  triggerWarm();
  return null;
}
