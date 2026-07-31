// Structured KPI-tree builder for programmatic consumers (the MCP server).
//
// Takes the same live overview data the dashboard fetches and produces a
// fully-resolved, structured tree: a flat list of nodes (each with its
// resolved Ist value, Ziel/target, team, parents and the formula behind the
// number) plus light metadata. The numbers are byte-for-byte the ones the
// KPI-tree view renders, because both go through computeLiveValues +
// resolveKpiTree.

import type { DealOverviewItem } from '@/app/api/deals/overview/route';
import type { LeadOverviewItem } from '@/app/api/leads/overview/route';
import type { MarketingFunnelResponse } from '@/lib/marketing/funnel-types';
import type { PlaybookStats } from '@/lib/amplitude/playbook-stats';
import { dealTitleHasCountryFlag } from '@/components/pipeline/filters/dealFilters';
import {
  METRICS,
  GOAL_SETS,
  TEAM_LABELS,
  DEFAULT_GOAL_SET_KEY,
  type GoalSetKey,
  type Team,
} from './model';
import { computeLiveValues, resolveKpiTree } from './compute';

export interface KpiTreeNode {
  id: string;
  label: string;
  /** Resolved current ("Ist") value, as shown in the tree. '?' when unknown. */
  value: string;
  /** Resolved target ("Ziel"). A trailing '*' marks a derived target. */
  target: string;
  /** Team that owns this metric, if any. */
  team: Team | null;
  teamLabel: string | null;
  /** Parent node IDs (the tree is a DAG — a node can roll up to several). */
  parentIds: string[];
  /** Explanation / formula behind the value (dynamic tooltip wins over the
   *  static one). null when there is nothing to explain. */
  explanation: string | null;
  /** Value is derived from other nodes (e.g. MRR = Sales × ARPA). */
  computed: boolean;
  /** Value comes straight from live data. */
  dynamic: boolean;
  /** Lower is better (Sales Cycle, Onboarding-Zeit). */
  lowerIsBetter: boolean;
  /** Context node, grayed out in the UI / not part of the active core path. */
  muted: boolean;
}

export interface KpiTreeResult {
  goalSet: { key: GoalSetKey; label: string };
  /** Rolling window in days the per-week values were computed over. */
  windowDays: number;
  /** Whether deals with a country flag in their title were excluded (DACH view). */
  deOnly: boolean;
  /** Snapshot of inputs so the consumer can sanity-check coverage. */
  inputs: {
    deals: number;
    dealsAfterDeOnly: number;
    leads: number;
    hasMarketingData: boolean;
    hasPlaybookStats: boolean;
  };
  /** Root metric of the spine (Neuer MRR / Woche). */
  rootId: string;
  nodes: KpiTreeNode[];
}

export interface BuildKpiTreeInput {
  deals: DealOverviewItem[];
  leads: LeadOverviewItem[];
  marketingData?: MarketingFunnelResponse;
  playbookStats?: PlaybookStats;
  /** Rolling window in days (matches the dashboard's date preset). Default 30. */
  days?: number;
  /** Goal set whose targets to resolve against. Default matches the UI. */
  goalSetKey?: GoalSetKey;
  /** Exclude deals whose title carries a non-DE country flag (UI default on). */
  deOnly?: boolean;
}

/**
 * Build the structured, fully-resolved KPI tree. Pure — give it the data, get
 * the tree. No I/O.
 */
export function buildKpiTree(input: BuildKpiTreeInput): KpiTreeResult {
  const {
    deals,
    leads,
    marketingData,
    playbookStats,
    days = 30,
    goalSetKey = DEFAULT_GOAL_SET_KEY,
    deOnly = true,
  } = input;

  const goalSet = GOAL_SETS.find(g => g.key === goalSetKey) ?? GOAL_SETS[0];
  const filteredDeals = deOnly
    ? deals.filter(d => !dealTitleHasCountryFlag(d.dealName))
    : deals;

  const liveData = computeLiveValues(filteredDeals, leads, marketingData, playbookStats, days);
  const resolved = resolveKpiTree({ liveData, goalSet });

  const nodes: KpiTreeNode[] = METRICS.map(node => {
    const value = resolved.values.get(node.id) ?? node.fallback;
    const target = resolved.targets.get(node.id) ?? node.target;
    const explanation = resolved.tooltips.get(node.id) ?? node.tooltip ?? null;
    return {
      id: node.id,
      label: node.label,
      value,
      target,
      team: node.team ?? null,
      teamLabel: node.team ? TEAM_LABELS[node.team] : null,
      parentIds: node.parentIds ?? [],
      explanation,
      computed: !!node.computed,
      dynamic: !!node.dynamic,
      lowerIsBetter: !!node.lowerIsBetter,
      muted: !!node.muted || goalSet.mutedMetrics.includes(node.id),
    };
  });

  return {
    goalSet: { key: goalSet.key, label: goalSet.label },
    windowDays: days,
    deOnly,
    inputs: {
      deals: deals.length,
      dealsAfterDeOnly: filteredDeals.length,
      leads: leads.length,
      hasMarketingData: !!marketingData,
      hasPlaybookStats: !!playbookStats,
    },
    rootId: 'mrr',
    nodes,
  };
}
