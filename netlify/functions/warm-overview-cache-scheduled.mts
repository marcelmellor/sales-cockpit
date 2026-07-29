// Cron intentionally DISABLED — the overview cache is kept warm ON-DEMAND only.
//
// Design decision after the 2026-07-15 cost incident: there is no wall-clock
// cron driving rebuilds. Instead the cache is refreshed lazily — when a user
// actually opens leads/marketing, `serveWarmBacked` serves the cached entry and
// nudges the background warmer (`triggerWarm()` → warm-overview-cache-background)
// if the entry is stale/missing. So BigQuery cost scales with real usage, not
// with the clock, and there is no autonomous loop that can run away.
//
// The background warmer is additionally TTL-gated (it only rebuilds targets
// whose cached entry actually expired — see src/lib/overview/warm-targets.ts),
// and hard-capped by the per-query `maximumBytesBilled` limit + the GCP
// project-level daily bytes quota.
//
// This file is kept as a no-schedule no-op so that, IF a periodic safety-net is
// ever wanted, re-enabling is a one-line `config.schedule` change — but only
// ever with the TTL-gate in place. Emergency off-switch for the whole warmer:
// set `WARMER_DISABLED=true` in the Netlify env.

import type { Config } from '@netlify/functions';

const handler = async (): Promise<void> => {
  console.warn('[warm-scheduled] no cron — cache is warmed on-demand only');
};

export default handler;

// No `schedule` on purpose — on-demand warming only (see header).
export const config: Config = {};
