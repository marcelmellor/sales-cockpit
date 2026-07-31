// Consolidation helpers for the MCP server: turn the raw overview responses
// into the aggregated figures the dashboard charts display (pipeline KPIs,
// project status counts). Pure functions — no I/O.

import type { PipelineOverviewResponse, DealOverviewItem } from '@/app/api/deals/overview/route';
import type { ProjectsOverviewResponse } from '@/app/api/projects/overview/route';
import { isWonStageLabel, isLostStageLabel } from '@/lib/hubspot/mrr';
import { MRR_BUCKET_THRESHOLD } from '@/lib/marketing/funnel-types';
import { dealTitleHasCountryFlag } from '@/components/pipeline/filters/dealFilters';

export interface PipelineFilters {
  /** Exclude deals whose title carries a non-DE country flag (dashboard default on). */
  deOnly?: boolean;
  /** Only count deals with MRR ≥ this. Dashboard default for AI Agents is 450 €. */
  minMrr?: number;
}

export interface PipelineSummary {
  pipelineId: string;
  pipelineName: string;
  produkt: string;
  filters: { deOnly: boolean; minMrr: number };
  counts: { total: number; won: number; lost: number; open: number };
  revenue: {
    /** Sum of monthly recurring revenue across won deals (€/month). */
    wonMrr: number;
    /** wonMrr × 12 (€/year). */
    wonArr: number;
    /** Sum of MRR across still-open deals (€/month). */
    openPipelineMrr: number;
    /** Average MRR of won deals (€/month). null when no won deals. */
    arpaWon: number | null;
  };
  /** Won / (Won + Lost), 0–1. null when nothing is closed. */
  winRate: number | null;
  /** Ø days from createdate to closedate across closed (won+lost) deals. */
  avgSalesCycleDays: number | null;
  byStage: Array<{
    stageId: string;
    label: string;
    displayOrder: number;
    probability: number;
    count: number;
    sumMrr: number;
  }>;
  byIcpTier: { S1: number; S2: number; S3: number; S4: number; unclassified: number };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function summarizePipeline(
  overview: PipelineOverviewResponse,
  produkt: string,
  filters: PipelineFilters = {},
): PipelineSummary {
  const deOnly = filters.deOnly ?? true;
  const minMrr = filters.minMrr ?? MRR_BUCKET_THRESHOLD;

  const deals = overview.deals.filter(d => {
    if (deOnly && dealTitleHasCountryFlag(d.dealName)) return false;
    if (minMrr > 0 && Math.round(d.revenue) < minMrr) return false;
    return true;
  });

  const won: DealOverviewItem[] = [];
  const lost: DealOverviewItem[] = [];
  const open: DealOverviewItem[] = [];
  for (const d of deals) {
    if (isWonStageLabel(d.dealStage)) won.push(d);
    else if (isLostStageLabel(d.dealStage)) lost.push(d);
    else open.push(d);
  }

  const wonMrr = won.reduce((s, d) => s + d.revenue, 0);
  const openPipelineMrr = open.reduce((s, d) => s + d.revenue, 0);
  const closed = won.length + lost.length;

  const closedWithDates = [...won, ...lost].filter(d => d.createdate && d.closedate);
  const avgSalesCycleDays = closedWithDates.length
    ? Math.round(
        closedWithDates.reduce(
          (s, d) => s + (new Date(d.closedate!).getTime() - new Date(d.createdate!).getTime()) / 86_400_000,
          0,
        ) / closedWithDates.length,
      )
    : null;

  const byStage = overview.stages
    .map(stage => {
      const inStage = deals.filter(d => d.dealStageId === stage.id);
      return {
        stageId: stage.id,
        label: stage.label,
        displayOrder: stage.displayOrder,
        probability: stage.probability,
        count: inStage.length,
        sumMrr: round2(inStage.reduce((s, d) => s + d.revenue, 0)),
      };
    })
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const byIcpTier = { S1: 0, S2: 0, S3: 0, S4: 0, unclassified: 0 };
  for (const d of deals) {
    if (d.icpTier) byIcpTier[d.icpTier]++;
    else byIcpTier.unclassified++;
  }

  return {
    pipelineId: overview.pipelineId,
    pipelineName: overview.pipelineName,
    produkt,
    filters: { deOnly, minMrr },
    counts: { total: deals.length, won: won.length, lost: lost.length, open: open.length },
    revenue: {
      wonMrr: round2(wonMrr),
      wonArr: round2(wonMrr * 12),
      openPipelineMrr: round2(openPipelineMrr),
      arpaWon: won.length ? round2(wonMrr / won.length) : null,
    },
    winRate: closed > 0 ? round2(won.length / closed) : null,
    avgSalesCycleDays,
    byStage,
    byIcpTier,
  };
}

export interface ProjectsSummary {
  produkt: string;
  counts: {
    total: number;
    open: number;
    closed: number;
    /** Deals with a JIRA story but no usable date anchor. */
    unscheduled: number;
  };
  byStatus: Array<{ status: string; count: number }>;
  byDateSource: Array<{ dateSource: string; count: number }>;
}

export function summarizeProjects(
  projects: ProjectsOverviewResponse,
  produkt: string,
): ProjectsSummary {
  const items = projects.projects;
  const open = items.filter(p => !p.projectIsClosed).length;

  const byStatusMap = new Map<string, number>();
  const byDateSourceMap = new Map<string, number>();
  for (const p of items) {
    byStatusMap.set(p.jiraStatus, (byStatusMap.get(p.jiraStatus) ?? 0) + 1);
    byDateSourceMap.set(p.dateSource, (byDateSourceMap.get(p.dateSource) ?? 0) + 1);
  }

  return {
    produkt,
    counts: {
      total: items.length,
      open,
      closed: items.length - open,
      unscheduled: projects.unscheduledCount,
    },
    byStatus: [...byStatusMap.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    byDateSource: [...byDateSourceMap.entries()].map(([dateSource, count]) => ({ dateSource, count })),
  };
}
