'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isWonStageLabel, isLostStageLabel } from '@/lib/hubspot/mrr';
import type { DealOverviewItem } from '@/app/api/deals/overview/route';
import { isIcpRevenue, type MarketingFunnelResponse } from '@/lib/marketing/funnel-types';
import type { PlaybookStats } from '@/lib/amplitude/playbook-stats';
import {
  DATE_PRESETS,
  getDaysForPreset,
  canShowComparison,
  type DatePresetKey,
} from '@/lib/marketing/date-presets';
import { dealTitleHasCountryFlag } from './filters/dealFilters';

// ── Data types ───────────────────────────────────────────────────────────────

type Team = 'growth' | 'onboarding' | 'sales';

interface MetricNode {
  id: string;
  label: string;
  /** Default / fallback value shown when no live data available */
  fallback: string;
  target: string;
  tooltip?: string;
  team?: Team;
  /** Value is computed from children — not directly editable */
  computed?: boolean;
  /** Value is filled from live data — not editable */
  dynamic?: boolean;
  parentIds?: string[];
  /** Visual connector to parent is dashed */
  dashed?: boolean;
  /** Muted context node — grayed out, not part of the core tree */
  muted?: boolean;
  /** Lower values are better (e.g. Sales Cycle, Onboarding-Zeit) */
  lowerIsBetter?: boolean;
}

// ── Goal sets ───────────────────────────────────────────────────────────────
// Each goal set maps metric IDs to their target strings. The active set
// overrides the static `target` on MetricNode. User-editable target overrides
// still layer on top.

type GoalSetKey = 'q2-2026' | 'q3-2026';

interface GoalSet {
  key: GoalSetKey;
  label: string;
  targets: Record<string, string>;
  coreMetrics: string[];
}

const GOAL_SETS: GoalSet[] = [
  {
    key: 'q2-2026',
    label: 'Q2 2026',
    coreMetrics: ['mrr', 'leads', 'cycle'],
    targets: {
      mrr: '4.000 €',
      arpa: '500 €',
      conversion: '20 %',
      cycle: 'verringern',
      onboarding: 'verringern',
      pql: '0',
      int: '4',
      pb: '4',
      aha: '6',
      trials: '15',
      signup: '6',
      'preview-pbx': '5',
      'preview-bestand': '5',
    },
  },
  {
    key: 'q3-2026',
    label: 'Q3 2026',
    coreMetrics: [],
    targets: {
      mrr: '20.000 €',
      arpa: '1.000 €',
      conversion: '25 %',
      cycle: 'verringern',
      onboarding: 'verringern',
      'contact-form': '10',
      int: '20',
      pb: '20',
      aha: '30',
      trials: '80',
      signup: '30',
      'preview-pbx': '25',
      'preview-bestand': '25',
    },
  },
];

// ── Static tree structure ────────────────────────────────────────────────────
// `fallback` is only used when live data is unavailable (loading, missing
// marketing data, etc.). Nodes marked `dynamic` get their value injected from
// props; nodes marked `computed` derive their value from other nodes.

const METRICS: MetricNode[] = [
  // Spine (top → down)
  { id: 'mrr', label: 'Neuer MRR / Woche', fallback: '?', target: '20.000 €', computed: true, tooltip: 'Gesamt-MRR: 20k €' },
  { id: 'arpa', label: 'ARPA', fallback: '?', target: '1.000 €', parentIds: ['mrr'], dashed: true, dynamic: true },
  { id: 'icp', label: 'Neue ICP-Kunden / Woche', fallback: '?', target: '?', parentIds: ['mrr'], dynamic: true, tooltip: '> 2.500 € / Monat' },
  { id: 'sales', label: 'Sales / Woche', fallback: '?', target: '?', parentIds: ['icp'], team: 'sales', dynamic: true },
  { id: 'conversion', label: 'Win Rate', fallback: '?', target: '25 %', parentIds: ['sales'], team: 'sales', computed: true },
  { id: 'cycle', label: 'Sales Cycle', fallback: '?', target: 'verringern', parentIds: ['conversion'], team: 'sales', dashed: true, dynamic: true, lowerIsBetter: true, tooltip: 'Ø Tage von Deal-Erstellung bis Abschluss (Won)' },
  { id: 'onboarding', label: 'Onboarding-Zeit', fallback: '30h', target: 'verringern', parentIds: ['conversion'], team: 'sales', dashed: true, lowerIsBetter: true, tooltip: 'Solution Consulting' },
  { id: 'deals', label: 'Deals / Woche', fallback: '?', target: '?', parentIds: ['conversion'], team: 'sales', dynamic: true },
  // Left column: Leads
  { id: 'leads', label: 'Leads / Woche', fallback: '?', target: '?', parentIds: ['deals'], computed: true },
  { id: 'contact-form', label: 'Contact Form (ICP) / Woche', fallback: '?', target: '10', parentIds: ['leads'], dynamic: true, computed: true, tooltip: 'ICP-Leads via Contact Form (sipgate.de + sipgate.ai)' },
  { id: 'cf-de', label: 'sipgate.de', fallback: '?', target: '?', parentIds: ['contact-form'], dynamic: true },
  { id: 'cf-ai', label: 'sipgate.ai', fallback: '?', target: '?', parentIds: ['contact-form'], dynamic: true },
  { id: 'signup-leads', label: 'In-Product-Quali (ICP) / Woche', fallback: '?', target: '?', parentIds: ['leads', 'trials'], team: 'growth', dynamic: true, tooltip: 'Preview-Leads mit In-Product-Qualifizierung und ≥ 2.500 Min/Monat' },
  { id: 'pbx-leads', label: 'PBX-Onboarding-Quali (ICP) / Woche', fallback: '?', target: '?', parentIds: ['leads'], team: 'growth', dynamic: true, tooltip: 'PBX-Kunden mit Onboarding-Qualifizierung und ≥ 2.500 Min/Monat' },
  { id: 'pbx-signups', label: 'PBX Signups / Woche', fallback: '?', target: '?', parentIds: ['pbx-leads'], dynamic: true, dashed: true, muted: true, tooltip: 'Alle PBX-Signups (Grundgesamtheit für Onboarding-Quali)' },
  // Right column: PQL path
  { id: 'pql', label: 'Product-Qualified Leads (ICP) / Woche', fallback: '[TODO]', target: '?', parentIds: ['deals', 'icp'], team: 'onboarding', tooltip: 'Nach ICP-Filter: ≥ 2.500 Min/Monat' },
  { id: 'int', label: 'Neue Kunden mit 1+ Integration / Woche', fallback: '[TODO]', target: '20', parentIds: ['pql'], team: 'onboarding' },
  { id: 'pb', label: 'Neue Kunden mit 3+ Playbooks / Woche', fallback: '?', target: '20', parentIds: ['pql'], team: 'onboarding', dynamic: true, tooltip: 'Preview-Accounts, die danach ≥ 3 Playbooks erstellt haben' },
  { id: 'aha', label: 'Aha-Moment / Woche', fallback: '[TODO]', target: '30', parentIds: ['int', 'pb'], team: 'onboarding' },
  { id: 'trials', label: 'Agent Previews / Woche', fallback: '?', target: '80', parentIds: ['aha'], team: 'growth', dynamic: true },
  { id: 'signup', label: 'Agent Signups / Woche', fallback: '?', target: '30', parentIds: ['trials'], team: 'growth', dynamic: true, tooltip: 'Paid Ads ab Juni 2026' },
  { id: 'preview-pbx', label: 'PBX Signup → Agent Preview / Woche', fallback: '?', target: '25', parentIds: ['trials', 'pbx-signups'], team: 'growth', dynamic: true, tooltip: 'PBX-Kunden, die eine Agent-Preview starten' },
  { id: 'preview-bestand', label: 'Bestandskunde → Agent Preview / Woche', fallback: '?', target: '25', parentIds: ['trials'], team: 'growth', dynamic: true, tooltip: 'Bestehende sipgate-Kunden ohne neuen Signup' },
];

// ── Props ────────────────────────────────────────────────────────────────────

interface KpiTreeViewProps {
  deals: DealOverviewItem[];
  marketingData: MarketingFunnelResponse | undefined;
  playbookStats: PlaybookStats | undefined;
  /** Marketing data for 2× the current window (for comparison period subtraction) */
  doubledMarketingData: MarketingFunnelResponse | undefined;
  /** Playbook stats for 2× the current window (for comparison period subtraction) */
  doubledPlaybookStats: PlaybookStats | undefined;
  /** Active date preset — drives the Marketing BQ query in page.tsx AND the
   *  deal rolling-window here. Both use the same range so numbers are
   *  comparable. */
  datePresetKey: DatePresetKey;
  onDatePresetChange: (key: DatePresetKey) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseNum(txt: string): number {
  if (!txt || txt === '?' || txt === '—') return NaN;
  return parseFloat(txt.replace(/[.*€%]/g, '').replace(/\./g, '').replace(',', '.').trim());
}

/** Intelligente Rundung: je größer die Zahl, desto gröber.
 *  < 1      → 2 Nachkommastellen  (0,25)
 *  1–< 5    → 1 Nachkommastelle   (3,2)
 *  5–< 100  → ganze Zahl          (7, 42)
 *  100–1000 → auf 5er             (435)
 *  ≥ 1000   → auf 10er            (1.230) */
function smartRound(n: number): number {
  const abs = Math.abs(n);
  if (abs < 1) return Math.round(n * 100) / 100;
  if (abs < 5) return Math.round(n * 10) / 10;
  if (abs < 100) return Math.round(n);
  if (abs < 1000) return Math.round(n / 5) * 5;
  return Math.round(n / 10) * 10;
}

function fmtNum(n: number): string {
  if (isNaN(n)) return '?';
  const rounded = smartRound(n);
  const decimals = Math.abs(rounded) < 1 ? 2 : Math.abs(rounded) < 5 ? 1 : 0;
  return rounded.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtTarget(n: number): string {
  if (isNaN(n)) return '?';
  const abs = Math.abs(n);
  const rounded = abs < 5 ? Math.round(n) : Math.round(n / 5) * 5;
  return rounded.toLocaleString('de-DE', { maximumFractionDigits: 0 });
}

function fmtEur(n: number): string {
  if (isNaN(n)) return '?';
  const rounded = smartRound(n);
  return rounded.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' €';
}

const TEAM_COLORS: Record<Team, string> = {
  sales: '#315DFF',
  growth: '#00BD82',
  onboarding: '#8642FE',
};

const TEAM_LABELS: Record<Team, string> = {
  sales: 'Sales & SC',
  growth: 'Product Growth',
  onboarding: 'Onboarding',
};

// ── Live data → per-week values ─────────────────────────────────────────────

interface LiveData {
  values: Map<string, string>;
  /** Dynamic tooltips showing the formula behind a value. Overrides the
   *  static `tooltip` on MetricNode when present. */
  tooltips: Map<string, string>;
}

function computeLiveValues(
  deals: DealOverviewItem[],
  marketingData: MarketingFunnelResponse | undefined,
  playbookStats: PlaybookStats | undefined,
  days: number,
  cutoffEnd: number = Date.now(),
): LiveData {
  const values = new Map<string, string>();
  const tooltips = new Map<string, string>();
  const weeks = Math.max(days / 7, 1);
  const cutoff = cutoffEnd - days * 24 * 60 * 60 * 1000;

  // ── Deal-based metrics (rolling window, ICP only: MRR ≥ threshold) ───────

  const icpDeals = deals.filter(d => isIcpRevenue(d.revenue));

  const recentCreated = icpDeals.filter(
    d => d.createdate && new Date(d.createdate).getTime() >= cutoff && new Date(d.createdate).getTime() < cutoffEnd,
  );
  const recentWon = icpDeals.filter(
    d => isWonStageLabel(d.dealStage) && d.closedate && new Date(d.closedate).getTime() >= cutoff && new Date(d.closedate).getTime() < cutoffEnd,
  );
  const recentLost = icpDeals.filter(
    d => isLostStageLabel(d.dealStage) && d.closedate && new Date(d.closedate).getTime() >= cutoff && new Date(d.closedate).getTime() < cutoffEnd,
  );
  const recentClosed = recentWon.length + recentLost.length;

  // Deals / Woche
  if (recentCreated.length > 0) {
    values.set('deals', fmtNum(recentCreated.length / weeks));
    tooltips.set('deals', `${recentCreated.length} neue Deals in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
  }

  // Sales / Woche (won deals)
  if (recentWon.length > 0) {
    values.set('sales', fmtNum(recentWon.length / weeks));
    tooltips.set('sales', `${recentWon.length} Won-Deals in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
  }

  // Conversion = Won / (Won + Lost) — nur abgeschlossene Deals
  if (recentClosed > 0) {
    const conv = recentWon.length / recentClosed;
    values.set('conversion', fmtNum(conv * 100) + ' %');
    tooltips.set('conversion', `${recentWon.length} Won / ${recentClosed} abgeschlossen (${recentWon.length} Won + ${recentLost.length} Lost) in ${days} Tagen — nach Abschlussdatum, nicht Erstelldatum`);
  }

  // Sales Cycle = Ø Tage von Erstellung bis Abschluss (Won + Lost)
  const closedWithDates = [...recentWon, ...recentLost].filter(d => d.createdate && d.closedate);
  if (closedWithDates.length > 0) {
    const openCount = recentCreated.length - recentClosed;
    const avgDays = closedWithDates.reduce((sum, d) => {
      return sum + (new Date(d.closedate!).getTime() - new Date(d.createdate!).getTime()) / (24 * 60 * 60 * 1000);
    }, 0) / closedWithDates.length;
    const rounded = Math.round(avgDays);
    values.set('cycle', `${rounded} Tage`);
    tooltips.set('cycle', `Ø ${rounded} Tage aus ${closedWithDates.length} abgeschlossenen Deals (${recentWon.length} Won + ${recentLost.length} Lost) — ${openCount} weitere Deals noch offen`);
  }

  // ICP-Kunden / Woche (won deals with ICP tier)
  const recentIcp = recentWon.filter(d => d.icpTier != null);
  if (recentWon.length > 0) {
    values.set('icp', fmtNum(recentIcp.length / weeks));
    tooltips.set('icp', `${recentIcp.length} von ${recentWon.length} Won-Deals mit ICP-Tier in ${days} Tagen`);
  }

  // ARPA (average revenue of recently won deals)
  if (recentWon.length > 0) {
    const avgRevenue = recentWon.reduce((sum, d) => sum + d.revenue, 0) / recentWon.length;
    values.set('arpa', fmtEur(avgRevenue));
    tooltips.set('arpa', `Ø MRR aus ${recentWon.length} Won-Deals`);
  }

  // ── Marketing-based metrics (BQ totals ÷ weeks in date range) ────────────

  if (marketingData) {
    const bq = marketingData.bqTotals;

    // Agent Signups / Woche (nur Frontdesk-Signup, nicht PBX)
    values.set('signup', fmtNum(bq.activationAgent / weeks));
    tooltips.set('signup', `${bq.activationAgent} Agent-Signups in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);

    // PBX Signups / Woche (alle Nicht-Frontdesk-Signups)
    values.set('pbx-signups', fmtNum(bq.activationOther / weeks));
    tooltips.set('pbx-signups', `${bq.activationOther} PBX-Signups in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);

    // Previews / Woche — Gesamt + Aufschlüsselung nach Herkunft
    values.set('trials', fmtNum(bq.previewTrialTotal / weeks));
    tooltips.set('trials', `${bq.previewTrialTotal} Previews in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
    values.set('preview-pbx', fmtNum(bq.previewTrialOther / weeks));
    tooltips.set('preview-pbx', `${bq.previewTrialOther} PBX-Previews in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
    values.set('preview-bestand', fmtNum(bq.previewTrialBestandskunde / weeks));
    tooltips.set('preview-bestand', `${bq.previewTrialBestandskunde} Bestandskunden-Previews in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);

    // ── Lead classification via Marketing Journeys ─────────────────────────
    // All three buckets require ICP (minuteBucket ≥ 2.500 Min/Monat).
    // Non-ICP leads are excluded entirely — the KPI tree tracks the ICP
    // pipeline only.
    //
    //   • signup-leads — In-Product-Quali + ICP
    //   • pbx-leads    — Onboarding-Quali + ICP
    //   • cf-de / cf-ai — Contact Form by domain + ICP

    const leadJourneys = marketingData.journeys.filter(
      j => j.kind === 'lead' && j.createdate && new Date(j.createdate).getTime() >= cutoff && new Date(j.createdate).getTime() < cutoffEnd,
    );
    if (leadJourneys.length > 0) {
      let inProductIcpLeads = 0;
      let onboardingIcpLeads = 0;
      let cfDeLeads = 0;
      let cfAiLeads = 0;

      for (const j of leadJourneys) {
        const isIcp = j.minuteBucket === 'gte_threshold';
        if (!isIcp) continue;

        const cfTouchpoint = j.touchpoints.find(t => t.anchor === 'lead_form_submitted');
        if (cfTouchpoint) {
          const domain = cfTouchpoint.pageDomain?.replace(/^www\./, '') ?? '';
          if (domain.endsWith('sipgate.ai')) cfAiLeads++;
          else cfDeLeads++;
        } else if (j.touchpoints.some(t => t.anchor === 'agents_qualification_onboarding')) {
          onboardingIcpLeads++;
        } else if (j.touchpoints.some(t => t.anchor === 'agents_qualification_inproduct')) {
          inProductIcpLeads++;
        } else {
          cfDeLeads++;
        }
      }

      values.set('signup-leads', fmtNum(inProductIcpLeads / weeks));
      tooltips.set('signup-leads', `${inProductIcpLeads} In-Product-Quali-Leads (≥ 2.500 Min) in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
      values.set('pbx-leads', fmtNum(onboardingIcpLeads / weeks));
      tooltips.set('pbx-leads', `${onboardingIcpLeads} Onboarding-Quali-Leads (≥ 2.500 Min) in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
      values.set('cf-de', fmtNum(cfDeLeads / weeks));
      tooltips.set('cf-de', `${cfDeLeads} Contact-Form-Leads sipgate.de (≥ 2.500 Min) in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
      values.set('cf-ai', fmtNum(cfAiLeads / weeks));
      tooltips.set('cf-ai', `${cfAiLeads} Contact-Form-Leads sipgate.ai (≥ 2.500 Min) in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
    }
  }

  // ── Playbook-Stats (Preview → 3+ Playbooks) ────────────────────────────────

  if (playbookStats && playbookStats.accountsWith3PlusPlaybooks != null) {
    const n3plus = playbookStats.accountsWith3PlusPlaybooks;
    const nTotal = playbookStats.previewAccountsTotal;
    values.set('pb', fmtNum(n3plus / weeks));
    tooltips.set('pb', nTotal != null
      ? `${n3plus} von ${nTotal} Preview-Accounts mit ≥ 3 Playbooks in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`
      : `${n3plus} Accounts mit ≥ 3 Playbooks in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
  }

  return { values, tooltips };
}

// ── Metric card component ───────────────────────────────────────────────────

interface MetricCardProps {
  node: MetricNode;
  values: Map<string, string>;
  targets: Map<string, string>;
  /** Dynamic tooltips from computeLiveValues — override static node.tooltip */
  dynamicTooltips: Map<string, string>;
  /** Values from the previous comparison period */
  comparisonValues?: Map<string, string>;
  /** Tooltips from the previous comparison period */
  comparisonTooltips?: Map<string, string>;
  onEditValue: (id: string) => void;
  onEditTarget: (id: string) => void;
  /** Whether this node is collapsible (has toggleable children) */
  isCollapsible?: boolean;
  /** Whether this node's children are currently collapsed */
  isCollapsed?: boolean;
  onToggleCollapse?: (id: string) => void;
  isCore?: boolean;
}

function computeDeltaPill(
  currentStr: string,
  comparisonStr: string,
  lowerIsBetter: boolean,
): { label: string; className: string; tooltip: string } | null {
  const cur = parseNum(currentStr);
  const prev = parseNum(comparisonStr);
  if (isNaN(cur) || isNaN(prev)) return null;
  const diff = cur - prev;
  if (Math.abs(diff) < 0.005) return null;
  const isUp = diff > 0;
  const isGood = lowerIsBetter ? !isUp : isUp;
  const arrow = isUp ? '↑' : '↓';
  const isPercent = currentStr.includes('%');
  const unit = currentStr.includes('€') ? ' €' : '';
  if (isPercent) {
    return {
      label: `vs ${comparisonStr}`,
      className: `kpi-delta ${isGood ? 'kpi-delta-good' : 'kpi-delta-bad'}`,
      tooltip: `Vorperiode: ${comparisonStr}`,
    };
  }
  return {
    label: `${arrow} ${fmtNum(Math.abs(diff))}${unit}`,
    className: `kpi-delta ${isGood ? 'kpi-delta-good' : 'kpi-delta-bad'}`,
    tooltip: `Vorperiode: ${comparisonStr}`,
  };
}

function MetricCard({ node, values, targets, dynamicTooltips, comparisonValues, comparisonTooltips, onEditValue, onEditTarget, isCollapsible, isCollapsed, onToggleCollapse, isCore }: MetricCardProps) {
  const val = values.get(node.id) ?? node.fallback;
  const target = targets.get(node.id) ?? '?';
  const canEditValue = !node.computed && !node.dynamic;
  const tooltip = dynamicTooltips.get(node.id) ?? node.tooltip;
  const compTooltip = comparisonTooltips?.get(node.id);
  const [showTip, setShowTip] = useState(false);
  const compVal = comparisonValues?.get(node.id);
  const delta = compVal ? computeDeltaPill(val, compVal, !!node.lowerIsBetter) : null;

  return (
    <div
      className={`kpi-metric${node.muted ? ' kpi-muted' : ''}${isCollapsible ? ' kpi-collapsible' : ''}${isCore ? ' kpi-core' : ''}`}
      data-id={node.id}
    >
      {(tooltip || compTooltip) && (
        <div
          className="kpi-info"
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
        >
          i
          {showTip && (
            <div className="kpi-tooltip">
              {tooltip}
              {tooltip && compTooltip && <hr className="kpi-tooltip-sep" />}
              {compTooltip && <span className="kpi-tooltip-comp">Vorperiode: {compTooltip}</span>}
            </div>
          )}
        </div>
      )}
      <div className="kpi-label">{node.label}</div>
      <div className={`kpi-val-row${delta ? ' has-delta' : ''}`}>
        <div className="kpi-val-spacer" />
        <div
          className={`kpi-val ${canEditValue ? 'kpi-editable' : ''}`}
          onClick={canEditValue ? () => onEditValue(node.id) : undefined}
        >
          {val}
        </div>
        <div className="kpi-delta-slot">
          {delta && <span className={delta.className} title={delta.tooltip}>{delta.label}</span>}
        </div>
      </div>
      {target && target !== '?' ? (
        <div
          className="kpi-target kpi-editable"
          onClick={() => onEditTarget(node.id)}
        >
          Ziel: <span className="kpi-target-val">{target}</span>
        </div>
      ) : (
        <div
          className="kpi-target kpi-editable kpi-target-empty"
          onClick={() => onEditTarget(node.id)}
        />
      )}
      {isCollapsible && (
        <button
          className="kpi-collapse-toggle"
          onClick={() => onToggleCollapse?.(node.id)}
          title={isCollapsed ? 'Aufklappen' : 'Einklappen'}
        >
          {isCollapsed ? '+' : '−'}
        </button>
      )}
    </div>
  );
}

// ── SVG connector drawing ───────────────────────────────────────────────────

function drawConnectors(treeEl: HTMLDivElement, svgEl: SVGSVGElement) {
  svgEl.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  const treeRect = treeEl.getBoundingClientRect();

  svgEl.setAttribute('width', String(treeEl.scrollWidth));
  svgEl.setAttribute('height', String(treeEl.scrollHeight));

  const nodes = treeEl.querySelectorAll<HTMLElement>('[data-id]');
  const map: Record<string, HTMLElement> = {};
  nodes.forEach(n => { map[n.dataset.id!] = n; });

  interface EdgeGroup {
    child: HTMLElement;
    parentIds: string[];
    isDashed: boolean;
  }

  const edgesByChild: Record<string, EdgeGroup> = {};
  nodes.forEach(child => {
    const idAttr = child.dataset.id!;
    const metric = METRICS.find(m => m.id === idAttr);
    if (!metric?.parentIds?.length) return;
    edgesByChild[idAttr] = {
      child,
      parentIds: metric.parentIds,
      isDashed: !!metric.dashed,
    };
  });

  const strokeAttr = (p: SVGPathElement) => {
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', '#d1d5db');
    p.setAttribute('stroke-width', '1.5');
  };

  for (const { child, parentIds, isDashed } of Object.values(edgesByChild)) {
    const cRect = child.getBoundingClientRect();
    const cx = cRect.left - treeRect.left + cRect.width / 2;
    const cy = cRect.top - treeRect.top;

    const parents = parentIds.map(pid => map[pid]).filter(Boolean);
    if (!parents.length) continue;

    const vertical: Array<{ el: HTMLElement; px: number; py: number }> = [];

    for (const parent of parents) {
      const pRect = parent.getBoundingClientRect();
      const overlapY = Math.min(pRect.bottom, cRect.bottom) - Math.max(pRect.top, cRect.top);
      const gapX = Math.max(0, Math.max(pRect.left, cRect.left) - Math.min(pRect.right, cRect.right));

      if (overlapY > 0) {
        // Horizontally separated, vertically overlapping — draw a horizontal line
        const midY = pRect.top - treeRect.top + pRect.height / 2;
        const leftRect = pRect.left < cRect.left ? pRect : cRect;
        const rightRect = pRect.left < cRect.left ? cRect : pRect;
        const path = document.createElementNS(ns, 'path');
        strokeAttr(path);
        path.setAttribute('d', `M${leftRect.right - treeRect.left},${midY} L${rightRect.left - treeRect.left},${midY}`);
        svgEl.appendChild(path);
      } else {
        const pR = parent.getBoundingClientRect();
        vertical.push({
          el: parent,
          px: pR.left - treeRect.left + pR.width / 2,
          py: pR.bottom - treeRect.top,
        });
      }
    }

    if (vertical.length === 0) continue;

    const siblings: typeof vertical = [];
    const outliers: typeof vertical = [];

    if (vertical.length > 1) {
      const sorted = [...vertical].sort((a, b) => a.py - b.py);
      let group = [sorted[0]];
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].py - group[0].py < 80) {
          group.push(sorted[i]);
        } else {
          if (group.length > 1) siblings.push(...group); else outliers.push(...group);
          group = [sorted[i]];
        }
      }
      if (group.length > 1) siblings.push(...group); else outliers.push(...group);
    } else {
      outliers.push(...vertical);
    }

    if (siblings.length > 1) {
      const maxPy = Math.max(...siblings.map(p => p.py));
      const midY = maxPy + (cy - maxPy) / 2;
      const minX = Math.min(...siblings.map(p => p.px));
      const maxX = Math.max(...siblings.map(p => p.px));
      for (const p of siblings) {
        const drop = document.createElementNS(ns, 'path');
        strokeAttr(drop);
        drop.setAttribute('d', `M${p.px},${p.py} L${p.px},${midY}`);
        svgEl.appendChild(drop);
      }
      const bar = document.createElementNS(ns, 'path');
      strokeAttr(bar);
      bar.setAttribute('d', `M${minX},${midY} L${maxX},${midY}`);
      svgEl.appendChild(bar);
      const stem = document.createElementNS(ns, 'path');
      strokeAttr(stem);
      stem.setAttribute('d', `M${cx},${midY} L${cx},${cy}`);
      svgEl.appendChild(stem);
    }

    for (const p of outliers) {
      const pRect = p.el.getBoundingClientRect();
      const path = document.createElementNS(ns, 'path');
      strokeAttr(path);
      const dist = cy - p.py;

      if (p.py > cy) {
        const fromX = pRect.left - treeRect.left;
        const fromY = pRect.top - treeRect.top + pRect.height / 2;
        const toX = cRect.left - treeRect.left + cRect.width / 2;
        const toY = cRect.bottom - treeRect.top;
        path.setAttribute('d', `M${fromX},${fromY} L${toX},${fromY} L${toX},${toY}`);
      } else if (dist > 300 && Math.abs(p.px - cx) < 20) {
        // Vertically aligned, large gap — straight line
        path.setAttribute('d', `M${p.px},${p.py} L${cx},${cy}`);
      } else if (dist > 300) {
        const pMidY = pRect.top - treeRect.top + pRect.height / 2;
        const pRight = pRect.right - treeRect.left;
        path.setAttribute('d', `M${cx},${cy} L${cx},${pMidY} L${pRight},${pMidY}`);
      } else {
        const midY = p.py + (cy - p.py) / 2;
        path.setAttribute('d', `M${p.px},${p.py} L${p.px},${midY} L${cx},${midY} L${cx},${cy}`);
      }
      svgEl.appendChild(path);
    }
  }
}

// ── Main component ──────────────────────────────────────────────────────────

function subtractBqTotals(
  doubled: MarketingFunnelResponse,
  current: MarketingFunnelResponse,
): MarketingFunnelResponse {
  const bq = doubled.bqTotals;
  const cur = current.bqTotals;
  return {
    ...doubled,
    bqTotals: {
      activationAgent: bq.activationAgent - cur.activationAgent,
      activationOther: bq.activationOther - cur.activationOther,
      activationTotal: bq.activationTotal - cur.activationTotal,
      previewTrialTotal: bq.previewTrialTotal - cur.previewTrialTotal,
      previewTrialAgent: bq.previewTrialAgent - cur.previewTrialAgent,
      previewTrialOther: bq.previewTrialOther - cur.previewTrialOther,
      previewTrialBestandskunde: bq.previewTrialBestandskunde - cur.previewTrialBestandskunde,
    },
  };
}

function subtractPlaybookStats(
  doubled: PlaybookStats,
  current: PlaybookStats,
): PlaybookStats {
  return {
    accountsWith3PlusPlaybooks: doubled.accountsWith3PlusPlaybooks - current.accountsWith3PlusPlaybooks,
    previewAccountsTotal: doubled.previewAccountsTotal - current.previewAccountsTotal,
  };
}

export function KpiTreeView({ deals, marketingData, playbookStats, doubledMarketingData, doubledPlaybookStats, datePresetKey, onDatePresetChange }: KpiTreeViewProps) {
  const treeRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // "Nur DE" filter — mirrors Dashboard badge, persisted in localStorage.
  const KPI_TREE_DE_ONLY_KEY = 'kpi-tree:de-only';
  const [deOnly, setDeOnly] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(KPI_TREE_DE_ONLY_KEY);
    return stored == null ? true : stored === '1';
  });
  const filteredDeals = useMemo(
    () => deOnly ? deals.filter(d => !dealTitleHasCountryFlag(d.dealName)) : deals,
    [deals, deOnly],
  );

  // Goal set selection — targets come from the active set.
  const [goalSetKey, setGoalSetKey] = useState<GoalSetKey>('q2-2026');
  const activeGoalSet = useMemo(() => GOAL_SETS.find(g => g.key === goalSetKey)!, [goalSetKey]);

  // User-editable overrides for manual nodes and all targets.
  // Target overrides are per-goal-set so switching sets resets manual edits.
  const [valueOverrides, setValueOverrides] = useState<Map<string, string>>(new Map());
  const [targetOverridesBySet, setTargetOverridesBySet] = useState<Map<GoalSetKey, Map<string, string>>>(new Map());
  const targetOverrides = useMemo(() => targetOverridesBySet.get(goalSetKey) ?? new Map<string, string>(), [targetOverridesBySet, goalSetKey]);

  // Collapsible sections — keyed by parent node ID whose children are hidden.
  const DEFAULT_COLLAPSED = useMemo(() => new Set(['contact-form', 'trials']), []);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(DEFAULT_COLLAPSED));
  const toggleCollapse = useCallback((id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Live values from props (deal stats + marketing BQ totals + journey classification).
  const days = getDaysForPreset(datePresetKey);
  const liveData = useMemo(
    () => computeLiveValues(filteredDeals, marketingData, playbookStats, days),
    [filteredDeals, marketingData, playbookStats, days],
  );

  const showComparison = canShowComparison(datePresetKey);
  const comparisonData = useMemo(() => {
    if (!showComparison) return null;
    const now = Date.now();
    const prevEnd = now - days * 24 * 60 * 60 * 1000;
    const compMkt = (doubledMarketingData && marketingData)
      ? subtractBqTotals(doubledMarketingData, marketingData)
      : undefined;
    const compPb = (doubledPlaybookStats && playbookStats)
      ? subtractPlaybookStats(doubledPlaybookStats, playbookStats)
      : undefined;
    return computeLiveValues(filteredDeals, compMkt, compPb, days, prevEnd);
  }, [showComparison, days, filteredDeals, marketingData, doubledMarketingData, playbookStats, doubledPlaybookStats]);

  // Merge: live values < user overrides (for manual nodes) < computed formulas.
  // Targets: static defaults < derived formulas < user overrides.
  const resolved = useMemo(() => {
    // Start with live values, then layer user overrides for manual nodes on top.
    const vals = new Map(liveData.values);
    const tips = new Map(liveData.tooltips);
    for (const [id, txt] of valueOverrides) {
      const node = METRICS.find(m => m.id === id);
      // Only apply overrides to non-dynamic, non-computed nodes
      if (node && !node.dynamic && !node.computed) vals.set(id, txt);
    }
    const tgts = new Map<string, string>();
    for (const [id, val] of Object.entries(activeGoalSet.targets)) tgts.set(id, val);
    for (const [id, val] of targetOverrides) tgts.set(id, val);

    // Helper: read a resolved value as number
    const v = (id: string): number => {
      const txt = vals.get(id) ?? METRICS.find(m => m.id === id)?.fallback ?? '?';
      return parseNum(txt);
    };
    const t = (id: string): number => {
      const txt = tgts.get(id) ?? METRICS.find(m => m.id === id)?.target ?? '?';
      return parseNum(txt);
    };

    // ── Computed values ──────────────────────────────────────────────────────

    // Contact Form = cf-de + cf-ai
    const cfDe = v('cf-de');
    const cfAi = v('cf-ai');
    const cfSum = [cfDe, cfAi].filter(n => !isNaN(n)).reduce((a, b) => a + b, 0);
    if (cfSum > 0) vals.set('contact-form', fmtNum(cfSum));

    // Leads = contact-form + signup-leads + pbx-leads
    const agentLeads = v('signup-leads');
    const pbxLeads = v('pbx-leads');
    const leadsSum = [cfSum, agentLeads, pbxLeads].filter(n => !isNaN(n)).reduce((a, b) => a + b, 0);
    if (leadsSum > 0) vals.set('leads', fmtNum(leadsSum));

    // Conversion is computed in computeLiveValues (Won / (Won + Lost))
    const sales = v('sales');
    const dealsVal = v('deals');
    const conv = parseNum(vals.get('conversion') ?? '?') / 100;

    // MRR = (sales + pql) × ARPA
    const arpa = v('arpa');
    const pql = v('pql');
    const icpSum = [sales, pql].filter(n => !isNaN(n)).reduce((a, b) => a + b, 0);
    vals.set('mrr', !isNaN(arpa) && icpSum > 0 ? fmtEur(icpSum * arpa) : '?');

    // ── Derived targets (marked with *) ──────────────────────────────────────

    const mrrTarget = t('mrr');
    const arpaTarget = t('arpa');
    const icpTarget = (!isNaN(mrrTarget) && !isNaN(arpaTarget) && arpaTarget > 0) ? mrrTarget / arpaTarget : NaN;
    if (!isNaN(icpTarget) && !tgts.has('icp')) tgts.set('icp', fmtTarget(icpTarget) + '*');

    // PQL / Sales split — if PQL target is set explicitly, Sales = ICP − PQL
    const PLG_RATIO = 0.3;
    const explicitPqlTarget = t('pql');
    if (isNaN(explicitPqlTarget) && !isNaN(icpTarget) && !tgts.has('pql')) {
      tgts.set('pql', fmtTarget(icpTarget * PLG_RATIO) + '*');
    }
    const pqlTargetNum = t('pql');
    const salesTarget = !isNaN(icpTarget) ? icpTarget - (isNaN(pqlTargetNum) ? 0 : pqlTargetNum) : NaN;
    if (!isNaN(salesTarget) && !tgts.has('sales')) tgts.set('sales', fmtTarget(salesTarget) + '*');

    const convTarget = t('conversion');
    const convRate = !isNaN(convTarget) ? convTarget / 100 : conv;
    const roundedSalesTarget = t('sales');
    if (!isNaN(roundedSalesTarget) && !isNaN(convRate) && convRate > 0 && !tgts.has('deals')) {
      tgts.set('deals', fmtTarget(roundedSalesTarget / convRate) + '*');
    }

    const dealsTarget = t('deals');
    if (!isNaN(dealsTarget) && !isNaN(dealsVal) && dealsVal > 0 && leadsSum > 0 && !tgts.has('leads')) {
      tgts.set('leads', fmtTarget(dealsTarget * (leadsSum / dealsVal)) + '*');
    }

    // Compute comparison resolved values (same derived formulas, no overrides/targets)
    let compVals: Map<string, string> | undefined;
    if (comparisonData) {
      const cv = new Map(comparisonData.values);
      const cvNum = (id: string): number => {
        const txt = cv.get(id) ?? METRICS.find(m => m.id === id)?.fallback ?? '?';
        return parseNum(txt);
      };
      const cvCfDe = cvNum('cf-de');
      const cvCfAi = cvNum('cf-ai');
      const cvCfSum = [cvCfDe, cvCfAi].filter(n => !isNaN(n)).reduce((a, b) => a + b, 0);
      if (cvCfSum > 0) cv.set('contact-form', fmtNum(cvCfSum));
      const cvAgentLeads = cvNum('signup-leads');
      const cvPbxLeads = cvNum('pbx-leads');
      const cvLeadsSum = [cvCfSum, cvAgentLeads, cvPbxLeads].filter(n => !isNaN(n)).reduce((a, b) => a + b, 0);
      if (cvLeadsSum > 0) cv.set('leads', fmtNum(cvLeadsSum));
      const cvArpa = cvNum('arpa');
      const cvSales = cvNum('sales');
      const cvPql = cvNum('pql');
      const cvIcpSum = [cvSales, cvPql].filter(n => !isNaN(n)).reduce((a, b) => a + b, 0);
      cv.set('mrr', !isNaN(cvArpa) && cvIcpSum > 0 ? fmtEur(cvIcpSum * cvArpa) : '?');
      compVals = cv;
    }

    return { values: vals, targets: tgts, tooltips: tips, comparisonValues: compVals, comparisonTooltips: comparisonData?.tooltips };
  }, [liveData, valueOverrides, targetOverrides, activeGoalSet, comparisonData]);

  const handleEditValue = useCallback((id: string) => {
    const node = METRICS.find(m => m.id === id);
    if (!node || node.computed || node.dynamic) return;
    const cur = resolved.values.get(id) ?? node.fallback;
    const v = prompt(`Ist-Wert für "${node.label}"`, cur === '?' ? '' : cur);
    if (v !== null) {
      setValueOverrides(prev => {
        const next = new Map(prev);
        next.set(id, v || '?');
        return next;
      });
    }
  }, [resolved.values]);

  const handleEditTarget = useCallback((id: string) => {
    const node = METRICS.find(m => m.id === id);
    if (!node) return;
    const cur = resolved.targets.get(id) ?? node.target;
    const v = prompt(`Ziel für "${node.label}"`, cur === '?' ? '' : cur);
    if (v !== null) {
      setTargetOverridesBySet(prev => {
        const next = new Map(prev);
        const setOverrides = new Map(next.get(goalSetKey) ?? new Map());
        setOverrides.set(id, v || '?');
        next.set(goalSetKey, setOverrides);
        return next;
      });
    }
  }, [resolved.targets, goalSetKey]);

  // Draw connectors on mount + resize
  useEffect(() => {
    const tree = treeRef.current;
    const svg = svgRef.current;
    if (!tree || !svg) return;

    const draw = () => {
      try {
        // 1) Position pbx-signups BEFORE drawing connectors so measurements are correct
        const previewPbx = tree.querySelector<HTMLElement>('[data-id="preview-pbx"]');
        const pbxLeads = tree.querySelector<HTMLElement>('[data-id="pbx-leads"]');
        const anchor = tree.querySelector<HTMLElement>('[data-pbx-signups-anchor]');
        const splitEl = anchor?.parentElement;
        if (anchor && splitEl && previewPbx && pbxLeads) {
          const splitRect = splitEl.getBoundingClientRect();
          const previewRect = previewPbx.getBoundingClientRect();
          const leadsRect = pbxLeads.getBoundingClientRect();
          anchor.style.left = `${leadsRect.left - splitRect.left}px`;
          anchor.style.top = `${previewRect.top - splitRect.top}px`;
          anchor.style.width = `${leadsRect.width}px`;
          // Force reflow so drawConnectors reads the updated position
          anchor.getBoundingClientRect();
        }
        // 2) Now draw connectors with correct positions
        drawConnectors(tree, svg);
      } catch (e) {
        console.error('[KpiTree] draw failed:', e);
      }
    };
    // Initial draw + redraw on data changes (setTimeout ensures RAF isn't cancelled by re-render)
    const t = setTimeout(draw, 50);
    window.addEventListener('resize', draw);
    const ro = new ResizeObserver(draw);
    ro.observe(tree);

    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', draw);
      ro.disconnect();
    };
  }, [resolved.values, collapsed]);

  const card = (id: string, collapsible?: boolean) => {
    const node = METRICS.find(m => m.id === id)!;
    return (
      <MetricCard
        key={id}
        node={node}
        values={resolved.values}
        targets={resolved.targets}
        dynamicTooltips={resolved.tooltips}
        comparisonValues={resolved.comparisonValues}
        comparisonTooltips={resolved.comparisonTooltips}
        onEditValue={handleEditValue}
        onEditTarget={handleEditTarget}
        isCollapsible={collapsible}
        isCollapsed={collapsible ? collapsed.has(id) : undefined}
        onToggleCollapse={collapsible ? toggleCollapse : undefined}
        isCore={activeGoalSet.coreMetrics.includes(id)}
      />
    );
  };

  return (
    <div className="kpi-tree-view">
      <style>{TREE_STYLES}</style>

      {/* Controls bar */}
      <div className="kpi-legend">
        <div className="kpi-legend-item">
          <span style={{ color: '#9ca3af', marginRight: 4 }}>Ziele</span>
          {GOAL_SETS.map(g => (
            <button
              key={g.key}
              onClick={() => setGoalSetKey(g.key)}
              className={`kpi-preset-btn ${g.key === goalSetKey ? 'kpi-preset-active' : ''}`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="kpi-legend-item">
          <button
            onClick={() => {
              const next = !deOnly;
              setDeOnly(next);
              localStorage.setItem(KPI_TREE_DE_ONLY_KEY, next ? '1' : '0');
            }}
            className={`kpi-preset-btn ${deOnly ? 'kpi-preset-active' : ''}`}
          >
            Nur DE
          </button>
        </div>
        <div className="kpi-legend-item" style={{ marginLeft: 'auto' }}>
          <span style={{ color: '#9ca3af', marginRight: 4 }}>Zeitraum</span>
          {DATE_PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => onDatePresetChange(p.key)}
              className={`kpi-preset-btn ${p.key === datePresetKey ? 'kpi-preset-active' : ''}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="kpi-tree" ref={treeRef}>
        <svg ref={svgRef} className="kpi-connectors" />

        {/* Spine: MRR → ICP → Sales → Conversion → Deals */}
        <div className="kpi-spine">
          {card('mrr')}

          <div className="kpi-icp-wrap">
            <div className="kpi-aside-left">{card('arpa')}</div>
            {card('icp')}
          </div>

          {card('sales')}

          <div className="kpi-conv-wrap">
            <div className="kpi-aside-left">{card('cycle')}</div>
            {card('conversion')}
            <div className="kpi-aside-right">{card('onboarding')}</div>
          </div>

          {card('deals')}
        </div>

        {/* Split: Leads path (left) + Direct (center) + PQL path (right) */}
        <div className="kpi-split" style={{ position: 'relative' }}>
          {/* Absolutely positioned — JS aligns it with preview-pbx row */}
          {!collapsed.has('trials') && (
            <div data-pbx-signups-anchor style={{ position: 'absolute', top: 0, left: 0 }}>
              {card('pbx-signups')}
            </div>
          )}

          {/* Left: Leads */}
          <div className="kpi-col">
            {card('leads')}
            <div className="kpi-row">
              <div className="kpi-col" style={{ gap: 16 }}>
                {card('contact-form', true)}
                {!collapsed.has('contact-form') && (
                  <div className="kpi-row">
                    {card('cf-de')}
                    {card('cf-ai')}
                  </div>
                )}
              </div>
              {card('pbx-leads')}
              {card('signup-leads')}
            </div>
          </div>

          {/* Right: PQL path */}
          <div className="kpi-col">
            {card('pql')}
            <div className="kpi-row">
              {card('int')}
              {card('pb')}
            </div>
            {card('aha')}
            {card('trials', true)}
            {!collapsed.has('trials') && (
              <div className="kpi-row">
                {card('preview-pbx')}
                {card('signup')}
                {card('preview-bestand')}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

// ── Scoped styles ───────────────────────────────────────────────────────────

const TREE_STYLES = `
.kpi-tree-view {
  --kpi-surface: #fff;
  --kpi-border: #e5e7eb;
  --kpi-text: #111827;
  --kpi-text-2: #6b7280;
  --kpi-text-3: #9ca3af;
}

.kpi-legend {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
}
.kpi-team-legend {
  display: flex;
  gap: 24px;
  justify-content: center;
  margin-top: 24px;
}
.kpi-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--kpi-text-2);
}
.kpi-legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.kpi-tree {
  position: relative;
  padding: 24px 0;
}
.kpi-connectors {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 0;
}

.kpi-spine {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  position: relative;
  z-index: 1;
}

.kpi-icp-wrap,
.kpi-conv-wrap {
  position: relative;
  width: fit-content;
}
.kpi-aside-left {
  position: absolute;
  right: calc(100% + 24px);
  top: 50%;
  transform: translateY(-50%);
}
.kpi-aside-right {
  position: absolute;
  left: calc(100% + 24px);
  top: 50%;
  transform: translateY(-50%);
}

.kpi-split {
  display: flex;
  gap: 80px;
  justify-content: flex-start;
  margin-top: 28px;
  position: relative;
  z-index: 1;
}
.kpi-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
}
.kpi-row {
  display: flex;
  gap: 16px;
  justify-content: center;
  align-items: flex-start;
}

/* Metric card */
.kpi-metric {
  background: var(--kpi-surface);
  border: 1px solid var(--kpi-border);
  border-radius: 8px;
  padding: 14px 24px;
  min-width: 200px;
  max-width: 320px;
  text-align: center;
  position: relative;
  z-index: 1;
  transition: box-shadow 0.15s;
}
.kpi-metric:hover {
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}
.kpi-core {
  border-width: 2px;
  border-color: #111827;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}
.kpi-core .kpi-target-val {
  font-weight: 700;
  color: #111827;
}
.kpi-muted {
  opacity: 0.45;
  border-style: dashed;
}

.kpi-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--kpi-text-2);
  margin-bottom: 4px;
  min-height: 2.6em;
  display: flex;
  align-items: center;
  justify-content: center;
}
.kpi-val-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
}
.kpi-val-row.has-delta {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  justify-items: center;
}
.kpi-val-spacer {
  display: none;
}
.has-delta .kpi-val-spacer {
  display: block;
}
.kpi-delta-slot {
  justify-self: start;
  align-self: center;
  padding-left: 6px;
}
.kpi-val {
  font-size: 24px;
  font-weight: 700;
  color: var(--kpi-text);
  line-height: 1.2;
}
.kpi-editable {
  cursor: pointer;
}
.kpi-editable:hover {
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}
.kpi-target {
  font-size: 11px;
  color: var(--kpi-text-3);
  margin-top: 3px;
}
.kpi-target-val {
  color: var(--kpi-text-2);
  font-weight: 400;
}
.kpi-delta {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 4px;
  border-radius: 3px;
  white-space: nowrap;
  line-height: 1.3;
  cursor: default;
}
.kpi-delta-good {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.1);
}
.kpi-delta-bad {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
}

/* Info icon */
.kpi-info {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid var(--kpi-border);
  font-size: 10px;
  font-weight: 700;
  color: var(--kpi-text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  background: #f9fafb;
}

/* JS Tooltip (matches Sparkline style) */
.kpi-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  padding: 4px 8px;
  border-radius: 4px;
  background: #2C3333;
  color: #fff;
  font-size: 11px;
  font-weight: 400;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  pointer-events: none;
  z-index: 10;
}
.kpi-tooltip-sep {
  border: none;
  border-top: 1px solid rgba(255,255,255,0.2);
  margin: 3px 0;
}
.kpi-tooltip-comp {
  color: rgba(255,255,255,0.7);
}

/* Collapse toggle */
.kpi-collapsible {
  cursor: default;
}
.kpi-collapse-toggle {
  position: absolute;
  bottom: -12px;
  left: 50%;
  transform: translateX(-50%);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--kpi-border);
  background: var(--kpi-surface);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  color: var(--kpi-text-3);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;
  transition: background 0.1s, color 0.1s;
}
.kpi-collapse-toggle:hover {
  background: #f3f4f6;
  color: var(--kpi-text-2);
}

/* Date-Preset Buttons */
.kpi-preset-btn {
  padding: 2px 8px;
  border-radius: 4px;
  border: none;
  font-size: 11px;
  font-weight: 500;
  color: var(--kpi-text-3);
  background: transparent;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.kpi-preset-btn:hover {
  background: #f3f4f6;
  color: var(--kpi-text-2);
}
.kpi-preset-active {
  background: #111827;
  color: #fff;
}
.kpi-preset-active:hover {
  background: #1f2937;
  color: #fff;
}
`;
