// ⛔ EMERGENCY KILL SWITCH — cron disabled 2026-07-16.
//
// This function used to fire the background warmer every 4 minutes. The warmer
// ignored the cache TTL and re-ran ~40 Amplitude BigQuery queries on every tick
// → ~1000 $/day of BigQuery cost from the 2026-07-15 deploy onwards. The
// `config.schedule` below is removed so Netlify no longer registers a cron, and
// the handler is a no-op as a second line of defence. The background warmer
// (warmAllTargets) is ALSO short-circuited — see src/lib/overview/warm-targets.ts.
//
// TODO(re-enable): restore `config.schedule` only together with the TTL-aware
// rebuild fix in warm-targets.ts, never before.

import type { Config } from '@netlify/functions';

const handler = async (): Promise<void> => {
  console.warn('[warm-scheduled] disabled (emergency kill switch) — no-op');
};

export default handler;

// No `schedule` on purpose — the cron is disabled. Kept as a plain (un-invoked)
// function so re-enabling is a one-line change once the TTL fix lands.
export const config: Config = {};
