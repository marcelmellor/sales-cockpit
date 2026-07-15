// Scheduled function (cron) that keeps the AI-Agents overview cache warm.
//
// Scheduled functions have only a 30s budget — too short for the 34–50s builds
// themselves — so this function does NOT build anything. It just fires the
// background warmer (15-min budget), which returns 202 immediately. Runs every
// 4 minutes so the cache (5-min / 30-min TTLs) is refreshed well before the
// user-facing routes would consider it stale.
//
// Only runs on published production deploys (Netlify does not schedule Deploy
// Previews or branch deploys).

import type { Config } from '@netlify/functions';

const handler = async (): Promise<void> => {
  const base = process.env.DEPLOY_PRIME_URL || process.env.URL;
  const secret = process.env.TV_SECRET;
  if (!base || !secret) {
    console.warn('[warm-scheduled] missing URL or TV_SECRET — skipping');
    return;
  }
  try {
    const res = await fetch(
      `${base}/.netlify/functions/warm-overview-cache-background`,
      { method: 'POST', headers: { 'x-warm-secret': secret } },
    );
    console.log(`[warm-scheduled] triggered background warmer: ${res.status}`);
  } catch (err) {
    console.error('[warm-scheduled] trigger failed:', err);
  }
};

export default handler;

export const config: Config = {
  schedule: '*/4 * * * *',
};
