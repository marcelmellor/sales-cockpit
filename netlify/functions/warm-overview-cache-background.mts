// Background function (15-min budget) that rebuilds the slow AI-Agents overview
// responses and writes them into the shared `hubspot-cache` Netlify Blobs store.
// This is the ONLY place the 34–50s builds run in production — the user-facing
// Next.js routes only read the warm cache (see src/lib/overview/warm-cache.ts).
//
// Invoked by:
//   - netlify/functions/warm-overview-cache-scheduled.mts (cron, every 4 min)
//   - src/lib/overview/warm-cache.ts triggerWarm() (on stale/cold reads)
//
// Guarded by TV_SECRET (header `x-warm-secret`) so the public function URL
// can't be abused to burn HubSpot/BigQuery quota.

import type { Config } from '@netlify/functions';
import { warmAllTargets } from '../../src/lib/overview/warm-targets';

const handler = async (req: Request): Promise<Response> => {
  const provided =
    req.headers.get('x-warm-secret') ??
    new URL(req.url).searchParams.get('secret');
  if (!process.env.TV_SECRET || provided !== process.env.TV_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  const startedAt = Date.now();
  const results = await warmAllTargets();
  const ok = results.filter((r) => r.ok).length;
  console.log(
    `[warm-cache] warmed ${ok}/${results.length} targets in ${
      Date.now() - startedAt
    }ms`,
    JSON.stringify(results),
  );

  // Background functions ignore the response body, but returning one keeps
  // manual/CLI invocations debuggable.
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export default handler;

export const config: Config = {
  background: true,
};
