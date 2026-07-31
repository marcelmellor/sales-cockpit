'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import type { DealOverviewItem } from '@/app/api/deals/overview/route';
import type { LeadOverviewItem } from '@/app/api/leads/overview/route';
import type { MarketingFunnelResponse } from '@/lib/marketing/funnel-types';
import type { PlaybookStats } from '@/lib/amplitude/playbook-stats';
import {
  DATE_PRESETS,
  getDaysForPreset,
  canShowComparison,
  type DatePresetKey,
} from '@/lib/marketing/date-presets';
import { dealTitleHasCountryFlag } from './filters/dealFilters';
import {
  METRICS,
  GOAL_SETS,
  parseNum,
  fmtNum,
  type MetricNode,
  type GoalSetKey,
} from '@/lib/kpi-tree/model';
import {
  computeLiveValues,
  subtractBqTotals,
  subtractPlaybookStats,
  resolveKpiTree,
} from '@/lib/kpi-tree/compute';

// ── Props ────────────────────────────────────────────────────────────────────

interface KpiTreeViewProps {
  deals: DealOverviewItem[];
  leads: LeadOverviewItem[];
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

// ── Metric card component ───────────────────────────────────────────────────

type ViewMode = 'ist' | 'ziel';

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
  isMuted?: boolean;
  viewMode: ViewMode;
}

function computeDeltaPill(
  currentStr: string,
  comparisonStr: string,
  node: MetricNode,
): { label: string; className: string; tooltip: string } | null {
  const cur = parseNum(currentStr);
  const prev = parseNum(comparisonStr);
  if (isNaN(cur) || isNaN(prev)) return null;
  const diff = cur - prev;
  if (Math.abs(diff) < 0.005) return null;
  const isUp = diff > 0;
  const isGood = node.lowerIsBetter ? !isUp : isUp;
  const fmt = node.deltaFormat ?? 'delta';
  let label: string;
  if (fmt === 'vs') {
    label = `vs ${comparisonStr}`;
  } else {
    const arrow = isUp ? '↑' : '↓';
    const unit = currentStr.includes('€') ? ' €' : '';
    label = `${arrow} ${fmtNum(Math.abs(diff))}${unit}`;
  }
  return {
    label,
    className: `kpi-delta ${isGood ? 'kpi-delta-good' : 'kpi-delta-bad'}`,
    tooltip: `Vorperiode: ${comparisonStr}`,
  };
}

function MetricCard({ node, values, targets, dynamicTooltips, comparisonValues, comparisonTooltips, onEditValue, onEditTarget, isCollapsible, isCollapsed, onToggleCollapse, isCore, isMuted, viewMode }: MetricCardProps) {
  const val = values.get(node.id) ?? node.fallback;
  const target = targets.get(node.id) ?? '?';
  const canEditValue = !node.computed && !node.dynamic;
  const tooltip = dynamicTooltips.get(node.id) ?? node.tooltip;
  const compTooltip = comparisonTooltips?.get(node.id);
  const [showTip, setShowTip] = useState(false);
  const compVal = comparisonValues?.get(node.id);
  const isZiel = viewMode === 'ziel';
  const delta = !isZiel && compVal && !node.hideComparison ? computeDeltaPill(val, compVal, node) : null;
  const muted = isMuted || node.muted;
  const hasTarget = target && target !== '?';

  return (
    <div
      className={`kpi-metric${muted ? ' kpi-muted' : ''}${isCollapsible ? ' kpi-collapsible' : ''}${isCore ? ' kpi-core' : ''}`}
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

      {isZiel ? (
        <>
          <div className="kpi-val-row">
            <div
              className={`kpi-val kpi-editable`}
              onClick={() => onEditTarget(node.id)}
            >
              {hasTarget ? target : '–'}
            </div>
          </div>
          <div
            className={`kpi-ist ${canEditValue ? 'kpi-editable' : ''}`}
            onClick={canEditValue ? () => onEditValue(node.id) : undefined}
          >
            Ist: <span className="kpi-ist-val">{val}</span>
          </div>
        </>
      ) : (
        <>
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
          {hasTarget ? (
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
        </>
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

export function KpiTreeView({ deals, leads, marketingData, playbookStats, doubledMarketingData, doubledPlaybookStats, datePresetKey, onDatePresetChange }: KpiTreeViewProps) {
  const treeRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // View mode toggle: "ist" = current values large, "ziel" = targets large.
  const KPI_TREE_VIEW_MODE_KEY = 'kpi-tree:view-mode';
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'ist';
    return (localStorage.getItem(KPI_TREE_VIEW_MODE_KEY) as ViewMode) || 'ist';
  });

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
    () => computeLiveValues(filteredDeals, leads, marketingData, playbookStats, days),
    [filteredDeals, leads, marketingData, playbookStats, days],
  );

  const showComparison = canShowComparison(datePresetKey);
  // Stable cutoffEnd for the comparison period. We snapshot Date.now() into a
  // ref so it doesn't change on every render (which would bust the memo and
  // trigger the react-hooks/purity lint). The ref updates when the deps that
  // actually matter change (preset, data arrivals).
  const compCutoffRef = useRef(0);
  if (showComparison) {
    const candidate = Date.now() - days * 24 * 60 * 60 * 1000;
    // Only update when the value drifts by more than 1 minute — prevents
    // unnecessary memo invalidation from sub-second re-renders.
    if (Math.abs(candidate - compCutoffRef.current) > 60_000) {
      compCutoffRef.current = candidate;
    }
  }
  const comparisonData = useMemo(() => {
    if (!showComparison) return null;
    const compMkt = (doubledMarketingData && marketingData)
      ? subtractBqTotals(doubledMarketingData, marketingData)
      : undefined;
    const compPb = (doubledPlaybookStats && playbookStats)
      ? subtractPlaybookStats(doubledPlaybookStats, playbookStats)
      : undefined;
    return computeLiveValues(filteredDeals, leads, compMkt, compPb, days, compCutoffRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showComparison, days, filteredDeals, leads, marketingData, doubledMarketingData, playbookStats, doubledPlaybookStats]);

  // Merge: live values < user overrides (for manual nodes) < computed formulas.
  // Targets: static defaults < derived formulas < user overrides.
  // The actual merge + computed-node + cascading-target logic lives in
  // resolveKpiTree (shared with the MCP server) so the rendered tree and any
  // programmatic consumer agree on every number.
  const resolved = useMemo(
    () => resolveKpiTree({
      liveData,
      goalSet: activeGoalSet,
      comparisonData,
      valueOverrides,
      targetOverrides,
    }),
    [liveData, valueOverrides, targetOverrides, activeGoalSet, comparisonData],
  );

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

  const [exporting, setExporting] = useState(false);
  const handleExportPng = useCallback(async () => {
    const el = treeRef.current;
    if (!el || exporting) return;
    setExporting(true);
    try {
      const w = el.scrollWidth;
      const h = el.scrollHeight;
      const bg = '#f3f4f6';
      const rawUrl = await toPng(el, {
        backgroundColor: bg,
        pixelRatio: 2,
        width: w,
        height: h,
        style: { width: `${w}px`, height: `${h}px`, overflow: 'visible' },
      });
      const pad = 48;
      const img = new Image();
      img.src = rawUrl;
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; });
      const canvas = document.createElement('canvas');
      canvas.width = (w + pad * 2) * 2;
      canvas.height = (h + pad * 2) * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(2, 2);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w + pad * 2, h + pad * 2);
      ctx.drawImage(img, pad, pad, w, h);
      const link = document.createElement('a');
      link.download = `kpi-tree-${activeGoalSet.label.replace(/\s+/g, '-').toLowerCase()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('[KpiTree] PNG export failed:', e);
    } finally {
      setExporting(false);
    }
  }, [exporting, activeGoalSet.label]);

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
        isMuted={activeGoalSet.mutedMetrics.includes(id)}
        viewMode={viewMode}
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
          <span style={{ color: '#9ca3af', marginRight: 4 }}>Ansicht</span>
          <button
            onClick={() => { setViewMode('ist'); localStorage.setItem(KPI_TREE_VIEW_MODE_KEY, 'ist'); }}
            className={`kpi-preset-btn ${viewMode === 'ist' ? 'kpi-preset-active' : ''}`}
          >
            Ist
          </button>
          <button
            onClick={() => { setViewMode('ziel'); localStorage.setItem(KPI_TREE_VIEW_MODE_KEY, 'ziel'); }}
            className={`kpi-preset-btn ${viewMode === 'ziel' ? 'kpi-preset-active' : ''}`}
          >
            Ziel
          </button>
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
        <button
          className="kpi-preset-btn kpi-export-btn"
          onClick={handleExportPng}
          disabled={exporting}
          title="Als PNG exportieren"
        >
          {exporting ? '...' : 'PNG'}
        </button>
      </div>

      <div className="kpi-tree" ref={treeRef}>
        <svg ref={svgRef} className="kpi-connectors" />

        {/* Spine: MRR → ICP → Sales → Conversion → Deals */}
        <div className="kpi-spine">
          {card('mrr')}

          <div className="kpi-icp-wrap">
            <div className="kpi-aside-left">{card('arpa')}</div>
            {card('sales')}
          </div>

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
              {card('sonstige-leads')}
            </div>
          </div>

          {/* Right: Committed path */}
          <div className="kpi-col">
            {card('activated')}
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
  box-shadow: 0 4px 20px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08);
  transform: scale(1.03);
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

/* Ziel-mode: Ist annotation below the big target */
.kpi-ist {
  margin-top: 3px;
  font-size: 11px;
  color: var(--kpi-text-3);
}
.kpi-ist-val {
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
.kpi-export-btn {
  margin-left: 8px;
  border: 1px solid var(--kpi-border);
  padding: 2px 10px;
}
.kpi-export-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}
`;
