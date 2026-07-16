// Single source of truth for WHICH aggregated responses the cache-warmer keeps
// hot, and the logic to (re)build them into the shared server-side cache.
//
// Why this exists: `buildLeadsOverview` and `buildMarketingFunnel` take
// 34–50s on a cold cache (heavy HubSpot fan-out + Amplitude BigQuery). Netlify
// kills a synchronous function at ~26s, so the user-facing routes can never
// build these themselves without 502ing — and because the cache is only
// written after a *successful* build, it would never warm. The warmer runs in
// a Netlify **background function** (15-min budget) instead, so the slow build
// happens off the request path and the routes only ever read a warm cache.
//
// Imported by:
//   - netlify/functions/warm-overview-cache-background.mts (does the work)
//   - the leads/marketing routes (to know their own cache key/TTL)

import {
  buildLeadsOverview,
  leadsCacheKey,
  LEADS_CACHE_TTL_SECONDS,
} from './leads';
import {
  buildMarketingFunnel,
  marketingFunnelCacheKey,
  MARKETING_FUNNEL_CACHE_TTL_SECONDS,
} from './marketing-funnel';
import { DATE_PRESETS, getDaysForPreset } from '@/lib/marketing/date-presets';
import { writeCacheEntry } from '@/lib/server-cache';

export interface WarmTarget {
  key: string;
  ttlSeconds: number;
  build: () => Promise<unknown>;
}

// The set of cache entries the dashboard hits on load for the AI-Agents
// (frontdesk) portfolio — the only product whose leads/funnel endpoints are
// slow enough to time out:
//   - leads-overview:frontdesk (Amplitude attribution join makes it slow)
//   - marketing-funnel:frontdesk:{30,90,all}d — the three date presets the
//     Marketing tab loads + background-prefetches. `all` drifts by one day per
//     day (getDaysForPreset uses Date.now()); the warmer recomputes it every
//     run so its key tracks the same value the client sends.
//
// NOT warmed: the comparison windows (days*2 → 60/180) used only in the
// KPI-tree comparison view. Those fall back to the cold-start path (see
// serveWarmBacked) — acceptable because they are a rarely-used secondary view.
export function getWarmTargets(): WarmTarget[] {
  const funnelDays = Array.from(
    new Set(DATE_PRESETS.map((p) => getDaysForPreset(p.key))),
  );
  return [
    {
      key: leadsCacheKey('frontdesk'),
      ttlSeconds: LEADS_CACHE_TTL_SECONDS,
      build: () => buildLeadsOverview('frontdesk'),
    },
    ...funnelDays.map((days) => ({
      key: marketingFunnelCacheKey(days),
      ttlSeconds: MARKETING_FUNNEL_CACHE_TTL_SECONDS,
      build: () => buildMarketingFunnel(days),
    })),
  ];
}

export interface WarmResult {
  key: string;
  ok: boolean;
  ms: number;
  error?: string;
}

// ⛔ EMERGENCY KILL SWITCH — warmer fully disabled 2026-07-16.
//
// The warmer rebuilt ALL targets on EVERY invocation, ignoring the cache TTL
// entirely: the cron fires every 4 min (see warm-overview-cache-scheduled.mts)
// and each run re-ran ~40 Amplitude BigQuery queries regardless of how fresh
// the cached entry was → ~1000 $/day of BigQuery cost from the 2026-07-15
// deploy onwards. Warmer completely disabled to stop the bleed immediately.
//
// Effect while disabled: `serveWarmBacked` keeps serving the last cached entry
// (Netlify Blobs persist across deploys), so the leads/marketing endpoints
// stay up but their data freezes — no new BigQuery spend. This is the single
// choke point: in production the routes never build inline, so a no-op here
// guarantees zero warmer-driven BigQuery usage even if a trigger still fires.
//
// TODO(re-enable): the proper fix is to honour the TTL — only rebuild a target
// whose cached entry is actually stale (reuse getOrFetch's age check) instead
// of unconditionally rebuilding. Do NOT just delete this guard.
const WARMER_DISABLED: boolean = true;

// Rebuilds every warm target and writes it to the shared cache. Runs the
// targets **sequentially** on purpose: each build already fans out heavily
// against HubSpot (rate-limited to 4 concurrent) and BigQuery, so running them
// in parallel would multiply the pressure and trip 429s. Sequential total is
// ~3 min, well inside the 15-min background-function budget. A single failing
// target is logged and skipped — it must not abort the others.
export async function warmAllTargets(): Promise<WarmResult[]> {
  if (WARMER_DISABLED) {
    console.warn(
      '[warm-cache] warmer is DISABLED (emergency kill switch) — skipping all builds, no BigQuery usage',
    );
    return [];
  }
  const results: WarmResult[] = [];
  for (const target of getWarmTargets()) {
    const start = Date.now();
    try {
      const data = await target.build();
      await writeCacheEntry(target.key, data);
      results.push({ key: target.key, ok: true, ms: Date.now() - start });
    } catch (err) {
      results.push({
        key: target.key,
        ok: false,
        ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
