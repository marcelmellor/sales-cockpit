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
import { readCacheEntry, writeCacheEntry } from '@/lib/server-cache';

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
  /** True when the target was still fresh and no rebuild ran (TTL-gate hit). */
  skipped?: boolean;
  error?: string;
}

// Emergency kill switch, env-controlled so ops can disable the warmer WITHOUT a
// code change if it ever misbehaves again (set `WARMER_DISABLED=true` in the
// Netlify env). Defaults to ENABLED. History: the warmer was hard-disabled in
// code on 2026-07-16 after it caused ~1000 $/day of BigQuery cost — see the
// TTL-gate below for the actual fix that made re-enabling safe.
function warmerDisabled(): boolean {
  return process.env.WARMER_DISABLED === 'true';
}

// Rebuilds every STALE warm target and writes it to the shared cache. Runs the
// targets **sequentially** on purpose: each build already fans out heavily
// against HubSpot (rate-limited to 4 concurrent) and BigQuery, so running them
// in parallel would multiply the pressure and trip 429s. Sequential total is
// ~3 min, well inside the 15-min background-function budget. A single failing
// target is logged and skipped — it must not abort the others.
//
// TTL-gate — the core fix for the 2026-07-15 cost incident: the warmer used to
// rebuild ALL targets on EVERY invocation, re-running ~40 Amplitude BigQuery
// queries every 4 min regardless of cache freshness (~1000 $/day). Now a run
// only rebuilds a target whose cached entry is actually missing or older than
// its TTL. Cost is therefore bounded by the TTL (how often an entry can go
// stale), NOT by how often the warmer is invoked — so the cron cadence and the
// on-read `triggerWarm()` nudges can no longer stack into a runaway. Backstops
// underneath: the per-query `maximumBytesBilled` cap and the GCP project-level
// daily bytes quota.
export async function warmAllTargets(): Promise<WarmResult[]> {
  if (warmerDisabled()) {
    console.warn(
      '[warm-cache] warmer is DISABLED via WARMER_DISABLED env — skipping all builds',
    );
    return [];
  }
  const results: WarmResult[] = [];
  for (const target of getWarmTargets()) {
    const start = Date.now();
    try {
      // Skip targets whose cached entry is still within its TTL — this is what
      // bounds cost. Only rebuild what actually expired.
      const existing = await readCacheEntry<unknown>(target.key);
      if (existing && Date.now() - existing.timestamp <= target.ttlSeconds * 1000) {
        results.push({ key: target.key, ok: true, ms: 0, skipped: true });
        continue;
      }
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
