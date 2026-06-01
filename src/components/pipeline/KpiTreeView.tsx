'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isWonStageLabel, isLostStageLabel } from '@/lib/hubspot/mrr';
import type { DealOverviewItem } from '@/app/api/deals/overview/route';
import type { MarketingFunnelResponse } from '@/lib/marketing/funnel-types';
import type { PlaybookStats } from '@/lib/amplitude/playbook-stats';
import {
  DATE_PRESETS,
  getDaysForPreset,
  type DatePresetKey,
} from '@/lib/marketing/date-presets';

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
}

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
  { id: 'conversion', label: 'Conversion', fallback: '?', target: '25 %', parentIds: ['sales'], team: 'sales', computed: true },
  { id: 'onboarding', label: 'Onboarding-Zeit', fallback: '30h', target: 'verringern', parentIds: ['conversion'], team: 'sales', dashed: true, tooltip: 'Solution Consulting' },
  { id: 'deals', label: 'Deals / Woche', fallback: '?', target: '?', parentIds: ['conversion'], team: 'sales', dynamic: true },
  // Left column: Leads
  { id: 'leads', label: 'Leads / Woche', fallback: '?', target: '?', parentIds: ['deals'], computed: true },
  { id: 'demo', label: 'Demo-Buchungen (ICP) / Woche', fallback: '?', target: '10', parentIds: ['leads'], dynamic: true, tooltip: 'Paid Ads ab Juni 2026' },
  { id: 'signup-leads', label: 'In-Product-Quali (ICP) / Woche', fallback: '?', target: '?', parentIds: ['leads', 'trials'], team: 'growth', dynamic: true, tooltip: 'Preview-Leads mit In-Product-Qualifizierung und ≥ 2.500 Min/Monat' },
  { id: 'pbx-leads', label: 'PBX-Onboarding-Quali (ICP) / Woche', fallback: '?', target: '?', parentIds: ['leads'], team: 'growth', dynamic: true, tooltip: 'PBX-Kunden mit Onboarding-Qualifizierung und ≥ 2.500 Min/Monat' },
  // Middle column: Direct deals (no lead)
  { id: 'direct', label: 'Direktdeals / Woche', fallback: '?', target: '?', parentIds: ['deals'], team: 'sales', computed: true, tooltip: 'Deals ohne vorherigen Lead (Outbound, Upsell, Empfehlung)' },
  // Right column: PQL path
  { id: 'pql', label: 'Product-Qualified Leads (ICP) / Woche', fallback: '[TODO]', target: '?', parentIds: ['deals', 'icp'], team: 'onboarding', tooltip: 'Nach ICP-Filter: ≥ 2.500 Min/Monat' },
  { id: 'int', label: 'Neue Kunden mit 1+ Integration / Woche', fallback: '[TODO]', target: '20', parentIds: ['pql'], team: 'onboarding' },
  { id: 'pb', label: 'Neue Kunden mit 3+ Playbooks / Woche', fallback: '?', target: '20', parentIds: ['pql'], team: 'onboarding', dynamic: true, tooltip: 'Preview-Accounts, die danach ≥ 3 Playbooks erstellt haben' },
  { id: 'aha', label: 'Aha-Moment / Woche', fallback: '[TODO]', target: '30', parentIds: ['int', 'pb'], team: 'onboarding' },
  { id: 'trials', label: 'Agent Previews / Woche', fallback: '?', target: '80', parentIds: ['aha'], team: 'growth', dynamic: true },
  { id: 'signup', label: 'Agent Signups / Woche', fallback: '?', target: '30', parentIds: ['trials'], team: 'growth', dynamic: true, tooltip: 'Paid Ads ab Juni 2026' },
  { id: 'preview-pbx', label: 'PBX Signup → Agent Preview / Woche', fallback: '?', target: '25', parentIds: ['trials'], team: 'growth', dynamic: true, tooltip: 'PBX-Kunden, die eine Agent-Preview starten' },
  { id: 'preview-bestand', label: 'Bestandskunde → Agent Preview / Woche', fallback: '?', target: '25', parentIds: ['trials'], team: 'growth', dynamic: true, tooltip: 'Bestehende sipgate-Kunden ohne neuen Signup' },
];

// ── Props ────────────────────────────────────────────────────────────────────

interface KpiTreeViewProps {
  deals: DealOverviewItem[];
  marketingData: MarketingFunnelResponse | undefined;
  playbookStats: PlaybookStats | undefined;
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
): LiveData {
  const values = new Map<string, string>();
  const tooltips = new Map<string, string>();
  const weeks = Math.max(days / 7, 1);
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;

  // ── Deal-based metrics (rolling window) ──────────────────────────────────

  const recentCreated = deals.filter(
    d => d.createdate && new Date(d.createdate).getTime() >= cutoff,
  );
  const recentWon = deals.filter(
    d => isWonStageLabel(d.dealStage) && d.closedate && new Date(d.closedate).getTime() >= cutoff,
  );
  const recentLost = deals.filter(
    d => isLostStageLabel(d.dealStage) && d.closedate && new Date(d.closedate).getTime() >= cutoff,
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
    //   • demo         — ICP catch-all (neither quali type matched)

    const leadJourneys = marketingData.journeys.filter(
      j => j.kind === 'lead' && j.createdate && new Date(j.createdate).getTime() >= cutoff,
    );
    if (leadJourneys.length > 0) {
      let inProductIcpLeads = 0;
      let onboardingIcpLeads = 0;
      let demoIcpLeads = 0;

      for (const j of leadJourneys) {
        const isIcp = j.minuteBucket === 'gte_threshold';
        if (!isIcp) continue; // nur ICP-Leads zählen

        const hasInProductQuali = j.touchpoints.some(
          t => t.anchor === 'agents_qualification_inproduct',
        );
        const hasOnboardingQuali = j.touchpoints.some(
          t => t.anchor === 'agents_qualification_onboarding',
        );

        if (hasInProductQuali) inProductIcpLeads++;
        else if (hasOnboardingQuali) onboardingIcpLeads++;
        else demoIcpLeads++;
      }

      values.set('signup-leads', fmtNum(inProductIcpLeads / weeks));
      tooltips.set('signup-leads', `${inProductIcpLeads} In-Product-Quali-Leads (≥ 2.500 Min) in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
      values.set('pbx-leads', fmtNum(onboardingIcpLeads / weeks));
      tooltips.set('pbx-leads', `${onboardingIcpLeads} Onboarding-Quali-Leads (≥ 2.500 Min) in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
      values.set('demo', fmtNum(demoIcpLeads / weeks));
      tooltips.set('demo', `${demoIcpLeads} sonstige ICP-Leads in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
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
  onEditValue: (id: string) => void;
  onEditTarget: (id: string) => void;
}

function MetricCard({ node, values, targets, dynamicTooltips, onEditValue, onEditTarget }: MetricCardProps) {
  const val = values.get(node.id) ?? node.fallback;
  const target = targets.get(node.id) ?? node.target;
  const canEditValue = !node.computed && !node.dynamic;
  const tooltip = dynamicTooltips.get(node.id) ?? node.tooltip;
  const [showTip, setShowTip] = useState(false);

  return (
    <div
      className="kpi-metric"
      data-id={node.id}
      style={node.team ? { borderLeftColor: TEAM_COLORS[node.team], borderLeftWidth: 3 } : undefined}
    >
      {tooltip && (
        <div
          className="kpi-info"
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
        >
          i
          {showTip && <div className="kpi-tooltip">{tooltip}</div>}
        </div>
      )}
      <div className="kpi-label">{node.label}</div>
      <div
        className={`kpi-val ${canEditValue ? 'kpi-editable' : ''}`}
        onClick={canEditValue ? () => onEditValue(node.id) : undefined}
      >
        {val}
      </div>
      <div
        className="kpi-target kpi-editable"
        onClick={() => onEditTarget(node.id)}
      >
        Ziel: <span className="kpi-target-val">{target}</span>
      </div>
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

      if (overlapY > 0 && gapX < 80) {
        const midY = pRect.top - treeRect.top + pRect.height / 2;
        const leftRect = pRect.left < cRect.left ? pRect : cRect;
        const rightRect = pRect.left < cRect.left ? cRect : pRect;
        const path = document.createElementNS(ns, 'path');
        strokeAttr(path);
        if (isDashed) path.setAttribute('stroke-dasharray', '6 4');
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

export function KpiTreeView({ deals, marketingData, playbookStats, datePresetKey, onDatePresetChange }: KpiTreeViewProps) {
  const treeRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // User-editable overrides for manual nodes and all targets.
  const [valueOverrides, setValueOverrides] = useState<Map<string, string>>(new Map());
  const [targetOverrides, setTargetOverrides] = useState<Map<string, string>>(new Map());

  // Live values from props (deal stats + marketing BQ totals + journey classification).
  const liveData = useMemo(
    () => computeLiveValues(deals, marketingData, playbookStats, getDaysForPreset(datePresetKey)),
    [deals, marketingData, playbookStats, datePresetKey],
  );

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
    const tgts = new Map(targetOverrides);

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

    // Leads = demo + signup-leads + pbx-leads
    const demo = v('demo');
    const agentLeads = v('signup-leads');
    const pbxLeads = v('pbx-leads');
    const leadsSum = [demo, agentLeads, pbxLeads].filter(n => !isNaN(n)).reduce((a, b) => a + b, 0);
    if (leadsSum > 0) vals.set('leads', fmtNum(leadsSum));

    // Direktdeals = Deals - Leads (remainder without lead source)
    const dealsRaw = v('deals');
    if (!isNaN(dealsRaw) && leadsSum > 0) {
      const direct = Math.max(0, dealsRaw - leadsSum);
      vals.set('direct', fmtNum(direct));
      tips.set('direct', `${fmtNum(dealsRaw)} Deals/Woche − ${fmtNum(leadsSum)} Leads/Woche = ${fmtNum(direct)} ohne Lead-Quelle`);
    }

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

    // 30% Product-Led (PQL) / 70% Sales-Led
    const PLG_RATIO = 0.3;
    const pqlTarget = !isNaN(icpTarget) ? icpTarget * PLG_RATIO : NaN;
    if (!isNaN(pqlTarget) && !tgts.has('pql')) tgts.set('pql', fmtTarget(pqlTarget) + '*');

    const salesTarget = !isNaN(icpTarget) ? icpTarget * (1 - PLG_RATIO) : NaN;
    if (!isNaN(salesTarget) && !tgts.has('sales')) tgts.set('sales', fmtTarget(salesTarget) + '*');

    const convTarget = t('conversion');
    const convRate = !isNaN(convTarget) ? convTarget / 100 : conv;
    if (!isNaN(salesTarget) && !isNaN(convRate) && convRate > 0 && !tgts.has('deals')) {
      tgts.set('deals', fmtTarget(salesTarget / convRate) + '*');
    }

    const dealsTarget = t('deals');
    if (!isNaN(dealsTarget) && !isNaN(dealsVal) && dealsVal > 0 && leadsSum > 0 && !tgts.has('leads')) {
      tgts.set('leads', fmtTarget(dealsTarget * (leadsSum / dealsVal)) + '*');
    }

    return { values: vals, targets: tgts, tooltips: tips };
  }, [liveData, valueOverrides, targetOverrides]);

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
      setTargetOverrides(prev => {
        const next = new Map(prev);
        next.set(id, v || '?');
        return next;
      });
    }
  }, [resolved.targets]);

  // Draw connectors on mount + resize
  useEffect(() => {
    const tree = treeRef.current;
    const svg = svgRef.current;
    if (!tree || !svg) return;

    const draw = () => drawConnectors(tree, svg);
    const raf = requestAnimationFrame(draw);
    window.addEventListener('resize', draw);
    const ro = new ResizeObserver(draw);
    ro.observe(tree);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', draw);
      ro.disconnect();
    };
  }, []);

  const card = (id: string) => {
    const node = METRICS.find(m => m.id === id)!;
    return (
      <MetricCard
        key={id}
        node={node}
        values={resolved.values}
        targets={resolved.targets}
        dynamicTooltips={resolved.tooltips}
        onEditValue={handleEditValue}
        onEditTarget={handleEditTarget}
      />
    );
  };

  return (
    <div className="kpi-tree-view">
      <style>{TREE_STYLES}</style>

      {/* Legend */}
      <div className="kpi-legend">
        {(Object.entries(TEAM_LABELS) as [Team, string][]).map(([team, label]) => (
          <div key={team} className="kpi-legend-item">
            <div className="kpi-legend-dot" style={{ background: TEAM_COLORS[team] }} />
            {label}
          </div>
        ))}
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
            {card('conversion')}
            <div className="kpi-aside-right">{card('onboarding')}</div>
          </div>

          {card('deals')}
        </div>

        {/* Split: Leads path (left) + Direct (center) + PQL path (right) */}
        <div className="kpi-split">
          {/* Left: Leads */}
          <div className="kpi-col">
            {card('leads')}
            <div className="kpi-row">
              {card('demo')}
              {card('signup-leads')}
              {card('pbx-leads')}
            </div>
          </div>

          {/* Center: Direct deals */}
          <div className="kpi-col">
            {card('direct')}
          </div>

          {/* Right: PQL path */}
          <div className="kpi-col">
            {card('pql')}
            <div className="kpi-row">
              {card('int')}
              {card('pb')}
            </div>
            {card('aha')}
            {card('trials')}
            <div className="kpi-row">
              {card('signup')}
              {card('preview-pbx')}
              {card('preview-bestand')}
            </div>
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
  justify-content: center;
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
}

/* Metric card */
.kpi-metric {
  background: var(--kpi-surface);
  border: 1px solid var(--kpi-border);
  border-radius: 8px;
  padding: 14px 24px;
  min-width: 160px;
  max-width: 260px;
  text-align: center;
  position: relative;
  z-index: 1;
  transition: box-shadow 0.15s;
}
.kpi-metric:hover {
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}

.kpi-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--kpi-text-2);
  margin-bottom: 4px;
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
