// Internal data client for the MCP server.
//
// The MCP tools reuse the existing overview endpoints rather than re-deriving
// anything: same HubSpot batching, same server-side response cache, same
// rate-limit handling. We self-fetch the running app over HTTP and authenticate
// with the existing TV_SECRET bypass (the same one the /tv view uses), so no
// browser session is needed.

import type { PipelineOverviewResponse } from '@/app/api/deals/overview/route';
import type { LeadsOverviewResponse } from '@/app/api/leads/overview/route';
import type { ProjectsOverviewResponse } from '@/app/api/projects/overview/route';
import type { MarketingFunnelResponse } from '@/lib/marketing/funnel-types';
import type { PlaybookStats } from '@/lib/amplitude/playbook-stats';

// "Sales sipgate Portfolio" pipeline in hub 27058496 — same constant the
// dashboard uses (SALES_PIPELINE_ID in src/app/page.tsx).
export const SALES_PIPELINE_ID = '3576006860';
// Portfolio key for the AI Agents product.
export const AI_AGENTS_PRODUKT = 'frontdesk';

/** Base URL of the running app to self-fetch. Local dev runs on :3020. */
function selfBaseUrl(): string {
  const fromEnv =
    process.env.MCP_SELF_BASE_URL ||
    process.env.URL || // Netlify: canonical site URL
    process.env.DEPLOY_PRIME_URL || // Netlify: deploy preview URL
    'http://localhost:3020';
  return fromEnv.replace(/\/$/, '');
}

function getTvSecret(): string {
  const secret = process.env.TV_SECRET;
  if (!secret) {
    throw new Error(
      'TV_SECRET is not set — the MCP server needs it to authenticate its ' +
        'internal calls to the overview endpoints. Add TV_SECRET to .env.local.',
    );
  }
  return secret;
}

type ParamValue = string | number | undefined;

async function fetchOverview<T>(
  path: string,
  params: Record<string, ParamValue>,
): Promise<T> {
  const url = new URL(selfBaseUrl() + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  url.searchParams.set('tvSecret', getTvSecret());

  const res = await fetch(url.toString(), {
    headers: { accept: 'application/json' },
    // Always read through to the server cache; never the browser cache.
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET ${path} → ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`);
  }
  const json = (await res.json()) as { data?: T; error?: string };
  if (json.error) throw new Error(`GET ${path} → ${json.error}`);
  if (json.data === undefined) throw new Error(`GET ${path} → response had no "data" field`);
  return json.data;
}

export function fetchDealsOverview(produkt: string = AI_AGENTS_PRODUKT): Promise<PipelineOverviewResponse> {
  return fetchOverview<PipelineOverviewResponse>('/api/deals/overview', {
    pipelineId: SALES_PIPELINE_ID,
    produkt,
  });
}

export function fetchLeadsOverview(produkt: string = AI_AGENTS_PRODUKT): Promise<LeadsOverviewResponse> {
  return fetchOverview<LeadsOverviewResponse>('/api/leads/overview', { produkt });
}

export function fetchProjectsOverview(produkt: string = AI_AGENTS_PRODUKT): Promise<ProjectsOverviewResponse> {
  return fetchOverview<ProjectsOverviewResponse>('/api/projects/overview', { produkt });
}

export function fetchMarketingFunnel(days: number, produkt: string = AI_AGENTS_PRODUKT): Promise<MarketingFunnelResponse> {
  return fetchOverview<MarketingFunnelResponse>('/api/marketing/funnel', { produkt, days });
}

export function fetchPlaybookStats(days: number): Promise<PlaybookStats> {
  return fetchOverview<PlaybookStats>('/api/amplitude/playbook-stats', { days });
}
