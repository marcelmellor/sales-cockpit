// MCP server for the Sales Cockpit — Streamable HTTP transport at /api/mcp.
//
// Optimised for the AI Agents (frontdesk) product: every tool defaults to that
// portfolio. Tools reuse the existing overview endpoints (HubSpot batching +
// server-side response cache + rate-limit handling) and the shared KPI-tree
// logic, so the numbers an agent reads here are exactly the ones the dashboard
// charts render.
//
// Auth: a static bearer token in MCP_SECRET. Send it as
//   Authorization: Bearer <MCP_SECRET>
// (or, as a fallback, ?mcpSecret=<MCP_SECRET>). Configure it in .mcp.json.

import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

import {
  fetchDealsOverview,
  fetchLeadsOverview,
  fetchProjectsOverview,
  fetchMarketingFunnel,
  fetchPlaybookStats,
  AI_AGENTS_PRODUKT,
} from '@/lib/mcp/data';
import { summarizePipeline, summarizeProjects } from '@/lib/mcp/consolidate';
import { buildKpiTree } from '@/lib/kpi-tree/build';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GOAL_SET_VALUES = ['q2-2026', 'q3-2026'] as const;

/** Pretty-printed JSON as the single text content block. */
function ok(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

const handler = createMcpHandler(
  server => {
    // ── KPI tree (structured) ──────────────────────────────────────────────
    server.registerTool(
      'get_kpi_tree',
      {
        title: 'Get KPI tree',
        description:
          'The full Sales-Cockpit KPI tree for AI Agents as structured data: a ' +
          'flat list of metric nodes (MRR spine, lead funnel, PLG/onboarding ' +
          'funnel) each with its resolved current value ("Ist"), target ("Ziel", ' +
          'trailing * = derived), owning team, parent links and the formula behind ' +
          'the number. Numbers are per-week over a rolling window and identical to ' +
          'what the KPI-tree view renders.',
        inputSchema: {
          days: z
            .number()
            .int()
            .min(1)
            .max(365)
            .optional()
            .describe('Rolling window in days for the per-week values. Default 30.'),
          goalSet: z
            .enum(GOAL_SET_VALUES)
            .optional()
            .describe('Which goal set supplies the targets. Default q2-2026 (UI default).'),
          deOnly: z
            .boolean()
            .optional()
            .describe('Exclude deals whose title carries a non-DE country flag (DACH view). Default true.'),
        },
      },
      async ({ days = 30, goalSet = 'q2-2026', deOnly = true }) => {
        const [deals, leads, marketingData, playbookStats] = await Promise.all([
          fetchDealsOverview(),
          fetchLeadsOverview(),
          fetchMarketingFunnel(days),
          fetchPlaybookStats(days),
        ]);
        const tree = buildKpiTree({
          deals: deals.deals,
          leads: leads.leads,
          marketingData,
          playbookStats,
          days,
          goalSetKey: goalSet,
          deOnly,
        });
        return ok(tree);
      },
    );

    // ── Consolidated metrics (everything in the charts) ────────────────────
    server.registerTool(
      'get_consolidated_metrics',
      {
        title: 'Get consolidated metrics',
        description:
          'All consolidated numbers behind the AI Agents charts in one call: ' +
          'pipeline KPIs (deal counts, won/lost/open, MRR/ARR, win rate, sales ' +
          'cycle, per-stage and per-ICP-tier breakdown), the marketing funnel ' +
          '(five stages + BigQuery signup/preview totals), playbook adoption, and ' +
          'project status counts.',
        inputSchema: {
          days: z
            .number()
            .int()
            .min(1)
            .max(365)
            .optional()
            .describe('Rolling window in days for the marketing funnel + playbook stats. Default 30.'),
          deOnly: z
            .boolean()
            .optional()
            .describe('Pipeline: exclude non-DE-flagged deal titles. Default true.'),
          minMrr: z
            .number()
            .min(0)
            .optional()
            .describe('Pipeline: only count deals with MRR ≥ this (€/month). Default 450 (dashboard default for AI Agents).'),
        },
      },
      async ({ days = 30, deOnly = true, minMrr }) => {
        const [deals, marketingData, playbookStats, projects] = await Promise.all([
          fetchDealsOverview(),
          fetchMarketingFunnel(days),
          fetchPlaybookStats(days),
          fetchProjectsOverview(),
        ]);
        return ok({
          produkt: AI_AGENTS_PRODUKT,
          windowDays: days,
          pipeline: summarizePipeline(deals, AI_AGENTS_PRODUKT, { deOnly, minMrr }),
          marketingFunnel: {
            stages: marketingData.funnel,
            bqTotals: marketingData.bqTotals,
            dealsTotal: marketingData.dealsTotal,
            dealsWonTotal: marketingData.dealsWonTotal,
          },
          playbook: playbookStats,
          projects: summarizeProjects(projects, AI_AGENTS_PRODUKT),
        });
      },
    );

    // ── Pipeline summary (granular) ────────────────────────────────────────
    server.registerTool(
      'get_pipeline_summary',
      {
        title: 'Get pipeline summary',
        description:
          'Consolidated HubSpot pipeline KPIs for one product: deal counts ' +
          '(won/lost/open), won MRR/ARR, open-pipeline MRR, ARPA, win rate, ' +
          'average sales cycle, and breakdowns per stage and per ICP tier.',
        inputSchema: {
          produkt: z
            .string()
            .optional()
            .describe('Portfolio key. Default "frontdesk" (AI Agents).'),
          deOnly: z.boolean().optional().describe('Exclude non-DE-flagged deal titles. Default true.'),
          minMrr: z
            .number()
            .min(0)
            .optional()
            .describe('Only count deals with MRR ≥ this (€/month). Default 450.'),
        },
      },
      async ({ produkt = AI_AGENTS_PRODUKT, deOnly = true, minMrr }) => {
        const deals = await fetchDealsOverview(produkt);
        return ok(summarizePipeline(deals, produkt, { deOnly, minMrr }));
      },
    );

    // ── Marketing funnel (granular) ────────────────────────────────────────
    server.registerTool(
      'get_marketing_funnel',
      {
        title: 'Get marketing funnel',
        description:
          'The AI Agents marketing funnel: five stages (marketing touch → ' +
          'activation → preview → deal created → deal won) plus the BigQuery ' +
          'signup/preview totals (Agent vs PBX vs Bestandskunde) over a rolling window.',
        inputSchema: {
          days: z
            .number()
            .int()
            .min(1)
            .max(365)
            .optional()
            .describe('Rolling window in days. Default 30.'),
        },
      },
      async ({ days = 30 }) => {
        const data = await fetchMarketingFunnel(days);
        return ok({
          windowDays: days,
          stages: data.funnel,
          bqTotals: data.bqTotals,
          dealsTotal: data.dealsTotal,
          dealsWonTotal: data.dealsWonTotal,
        });
      },
    );

    // ── Playbook adoption (granular) ───────────────────────────────────────
    server.registerTool(
      'get_playbook_stats',
      {
        title: 'Get playbook stats',
        description:
          'Preview → playbook adoption for AI Agents: how many preview accounts ' +
          'were created in the window and how many went on to create ≥ 3 playbooks.',
        inputSchema: {
          days: z
            .number()
            .int()
            .min(1)
            .max(365)
            .optional()
            .describe('Rolling window in days. Default 30.'),
        },
      },
      async ({ days = 30 }) => {
        const stats = await fetchPlaybookStats(days);
        return ok({ windowDays: days, ...stats });
      },
    );

    // ── Projects summary (granular) ────────────────────────────────────────
    server.registerTool(
      'get_projects_summary',
      {
        title: 'Get projects summary',
        description:
          'Status of AI Agents onboarding/implementation projects (HubSpot deal ↔ ' +
          'JIRA story): total/open/closed counts, deals without a usable date anchor, ' +
          'and breakdowns by JIRA status and date source.',
        inputSchema: {
          produkt: z.string().optional().describe('Portfolio key. Default "frontdesk".'),
        },
      },
      async ({ produkt = AI_AGENTS_PRODUKT }) => {
        const projects = await fetchProjectsOverview(produkt);
        return ok(summarizeProjects(projects, produkt));
      },
    );
  },
  {},
  { basePath: '/api', maxDuration: 60, verboseLogs: process.env.NODE_ENV !== 'production' },
);

// ── Static bearer-token auth ──────────────────────────────────────────────

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'WWW-Authenticate': 'Bearer' },
  });
}

function withAuth(h: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const expected = process.env.MCP_SECRET;
    if (!expected) {
      return new Response(
        JSON.stringify({ error: 'MCP server not configured: MCP_SECRET is not set.' }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      );
    }
    const authHeader = req.headers.get('authorization') ?? '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const fromQuery = new URL(req.url).searchParams.get('mcpSecret') ?? '';
    const provided = bearer || fromQuery;
    if (provided !== expected) return unauthorized('Invalid or missing MCP token.');
    return h(req);
  };
}

const authed = withAuth(handler);

export { authed as GET, authed as POST, authed as DELETE };
