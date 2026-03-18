'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { Loader2, Plus, X, Save, FolderOpen, Check, Trash2, ChevronDown, ChevronRight, Group, Eye } from 'lucide-react';
import { useDevStore } from '@/stores/dev-store';
import type { DealOverviewItem } from '@/app/api/deals/overview/route';
import type { DealStageHistoryMap } from '@/app/api/deals/overview/stage-history/route';

interface Stage {
  id: string;
  label: string;
  displayOrder: number;
}

interface DashboardViewProps {
  stages: Stage[];
  deals: DealOverviewItem[];
  isClosedStage: (label: string) => boolean;
  stageHistory: DealStageHistoryMap;
  stageHistoryLoading?: boolean;
  pipelineId?: string | null;
}

// ══════════════════════════════════════════════════════════
// ── Filter types & logic ──
// ══════════════════════════════════════════════════════════

interface FilterCriterion {
  kind: 'criterion';
  id: string;
  type: 'createdate' | 'stage_reached' | 'agents_minuten' | 'mrr';
  operator: 'after' | 'before' | 'between';
  stageId?: string;
  dateFrom: string;
  dateTo?: string;
  numberFrom?: number;
  numberTo?: number;
}

interface FilterGroup {
  kind: 'group';
  id: string;
  logic: FilterLogic;
  children: FilterNode[];
}

type FilterNode = FilterCriterion | FilterGroup;
type FilterLogic = 'AND' | 'OR';

// Root state is a group
interface FilterState {
  logic: FilterLogic;
  children: FilterNode[];
}

interface SavedFilterSet {
  id: string;
  name: string;
  filter: FilterState;
}

const FILTERSETS_KEY = 'pipeline-filtersets-';

function loadFilterSets(pipelineId: string): SavedFilterSet[] {
  try {
    const raw = localStorage.getItem(FILTERSETS_KEY + pipelineId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveFilterSets(pipelineId: string, sets: SavedFilterSet[]): void {
  try { localStorage.setItem(FILTERSETS_KEY + pipelineId, JSON.stringify(sets)); }
  catch { /* localStorage full */ }
}

function makeId(): string { return Math.random().toString(36).slice(2, 9); }

function getDefaultSinceDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
}

function makeCriterion(partial?: Partial<FilterCriterion>): FilterCriterion {
  return { kind: 'criterion', id: makeId(), type: 'createdate', operator: 'after', dateFrom: '', ...partial };
}

function makeGroup(logic: FilterLogic = 'AND'): FilterGroup {
  return { kind: 'group', id: makeId(), logic, children: [makeCriterion(), makeCriterion()] };
}

// ── Pipeline-specific default filters ──
const PIPELINE_DEFAULT_FILTERS: Record<string, () => FilterState> = {
  // AI Agents
  '2326312177': () => ({
    logic: 'AND',
    children: [
      makeCriterion({ type: 'mrr', operator: 'after', numberFrom: 450, dateFrom: '' }),
      {
        kind: 'group', id: makeId(), logic: 'OR',
        children: [
          makeCriterion({ type: 'createdate', operator: 'after', dateFrom: '2026-01-01' }),
          makeCriterion({ type: 'stage_reached', stageId: '3177741538', operator: 'after', dateFrom: '2026-01-01' }),
          makeCriterion({ type: 'stage_reached', stageId: '3177741539', operator: 'after', dateFrom: '2026-01-01' }),
        ],
      },
    ],
  }),
};

function getDefaultFilterState(pipelineId?: string): FilterState {
  if (pipelineId && PIPELINE_DEFAULT_FILTERS[pipelineId]) {
    return PIPELINE_DEFAULT_FILTERS[pipelineId]();
  }
  return {
    logic: 'AND',
    children: [makeCriterion({ dateFrom: getDefaultSinceDate() })],
  };
}

/** Migrate legacy flat FilterState (criteria[] without kind) to new tree structure */
function migrateFilterState(raw: unknown): FilterState {
  if (!raw || typeof raw !== 'object') return getDefaultFilterState();
  const obj = raw as Record<string, unknown>;

  // Already new format: has `children` array
  if (Array.isArray(obj.children)) return obj as unknown as FilterState;

  // Legacy format: has `criteria` array
  if (Array.isArray(obj.criteria)) {
    return {
      logic: (obj.logic as FilterLogic) ?? 'AND',
      children: (obj.criteria as Array<Record<string, unknown>>).map(c => ({
        ...c,
        kind: 'criterion' as const,
        id: (c.id as string) ?? makeId(),
        type: (c.type as FilterCriterion['type']) ?? 'createdate',
        operator: (c.operator as FilterCriterion['operator']) ?? 'after',
        dateFrom: (c.dateFrom as string) ?? '',
      })) as FilterCriterion[],
    };
  }

  return getDefaultFilterState();
}

// ── Helpers ──

function getDealCreateTimestamp(deal: DealOverviewItem): number | null {
  if (deal.createdate) { const t = new Date(deal.createdate).getTime(); if (!isNaN(t)) return t; }
  if (deal.dealAge > 0) return Date.now() - deal.dealAge * 86_400_000;
  return null;
}

function dateToMs(dateStr: string): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr + 'T00:00:00Z').getTime();
  return isNaN(t) ? null : t;
}

function dateToMsEnd(dateStr: string): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr + 'T23:59:59.999Z').getTime();
  return isNaN(t) ? null : t;
}

function criterionIsComplete(c: FilterCriterion): boolean {
  if (c.type === 'agents_minuten' || c.type === 'mrr') {
    if (c.operator === 'between') return c.numberFrom != null && c.numberTo != null;
    return c.numberFrom != null;
  }
  if (c.type === 'stage_reached' && !c.stageId) return false;
  if (!c.dateFrom) return false;
  if (c.operator === 'between' && !c.dateTo) return false;
  return true;
}

function matchTimestamp(ts: number, c: FilterCriterion): boolean {
  if (c.operator === 'after') {
    const from = dateToMs(c.dateFrom);
    return from !== null && ts >= from;
  }
  if (c.operator === 'before') {
    const to = dateToMsEnd(c.dateFrom);
    return to !== null && ts <= to;
  }
  const from = dateToMs(c.dateFrom);
  const to = dateToMsEnd(c.dateTo ?? '');
  if (from === null || to === null) return true;
  return ts >= from && ts <= to;
}

function matchCriterion(
  deal: DealOverviewItem, c: FilterCriterion,
  stageHistory: DealStageHistoryMap, stageHistoryLoading: boolean,
): boolean {
  if (!criterionIsComplete(c)) return true;
  if (c.type === 'agents_minuten' || c.type === 'mrr') {
    const val = c.type === 'mrr' ? Math.round(deal.revenue) : deal.agentsMinuten;
    if (c.operator === 'after') return val >= (c.numberFrom ?? 0);
    if (c.operator === 'before') return val <= (c.numberFrom ?? Infinity);
    return val >= (c.numberFrom ?? 0) && val <= (c.numberTo ?? Infinity);
  }
  if (c.type === 'createdate') {
    const created = getDealCreateTimestamp(deal);
    if (created === null) return false;
    return matchTimestamp(created, c);
  }
  if (stageHistoryLoading) return false;
  const entry = stageHistory[deal.id];
  if (!entry?.history) return false;
  // Check stage history timestamps
  const historyMatch = entry.history.some(h => {
    if (h.stageId !== c.stageId) return false;
    const ts = new Date(h.timestamp).getTime();
    if (isNaN(ts)) return false;
    return matchTimestamp(ts, c);
  });
  if (historyMatch) return true;
  // Fallback: if the deal is currently in the target stage, also check closedate.
  // Some deals are imported or created directly in the won/lost stage, so the stage
  // history timestamp reflects the import date, not the actual close date.
  if (deal.dealStageId === c.stageId && deal.closedate) {
    const closeTs = new Date(deal.closedate).getTime();
    if (!isNaN(closeTs)) return matchTimestamp(closeTs, c);
  }
  return false;
}

/** Extract the earliest 'after'/'between' date and latest 'before'/'between' date from a filter tree */
function getFilterDateRange(children: FilterNode[]): { from: Date | null; to: Date | null } {
  let fromMs: number | null = null;
  let toMs: number | null = null;

  for (const ch of children) {
    if (ch.kind === 'group') {
      const sub = getFilterDateRange(ch.children);
      if (sub.from) {
        const t = sub.from.getTime();
        if (fromMs === null || t < fromMs) fromMs = t;
      }
      if (sub.to) {
        const t = sub.to.getTime();
        if (toMs === null || t > toMs) toMs = t;
      }
    } else if ((ch.type === 'createdate' || ch.type === 'stage_reached') && criterionIsComplete(ch)) {
      if (ch.operator === 'after' || ch.operator === 'between') {
        const t = dateToMs(ch.dateFrom);
        if (t !== null && (fromMs === null || t < fromMs)) fromMs = t;
      }
      if (ch.operator === 'before') {
        const t = dateToMsEnd(ch.dateFrom);
        if (t !== null && (toMs === null || t > toMs)) toMs = t;
      }
      if (ch.operator === 'between' && ch.dateTo) {
        const t = dateToMsEnd(ch.dateTo);
        if (t !== null && (toMs === null || t > toMs)) toMs = t;
      }
    }
  }

  return {
    from: fromMs !== null ? new Date(fromMs) : null,
    to: toMs !== null ? new Date(toMs) : null,
  };
}

/** Recursively evaluate a filter node against a deal */
function matchNode(
  deal: DealOverviewItem, node: FilterNode,
  stageHistory: DealStageHistoryMap, stageHistoryLoading: boolean,
): boolean {
  if (node.kind === 'criterion') return matchCriterion(deal, node, stageHistory, stageHistoryLoading);
  // Group: evaluate children with group logic
  const completeCh = node.children.filter(ch =>
    ch.kind === 'group' ? ch.children.length > 0 : criterionIsComplete(ch),
  );
  if (completeCh.length === 0) return true;
  if (node.logic === 'AND') return completeCh.every(ch => matchNode(deal, ch, stageHistory, stageHistoryLoading));
  return completeCh.some(ch => matchNode(deal, ch, stageHistory, stageHistoryLoading));
}

function applyFilters(
  deals: DealOverviewItem[], filter: FilterState,
  stageHistory: DealStageHistoryMap, stageHistoryLoading: boolean,
): DealOverviewItem[] {
  const completeCh = filter.children.filter(ch =>
    ch.kind === 'group' ? ch.children.length > 0 : criterionIsComplete(ch),
  );
  if (completeCh.length === 0) return deals;
  return deals.filter(deal => {
    if (filter.logic === 'AND') return completeCh.every(ch => matchNode(deal, ch, stageHistory, stageHistoryLoading));
    return completeCh.some(ch => matchNode(deal, ch, stageHistory, stageHistoryLoading));
  });
}

/** Count total active criteria in tree (for collapsed summary) */
function countActiveCriteria(children: FilterNode[]): number {
  let n = 0;
  for (const ch of children) {
    if (ch.kind === 'criterion' && criterionIsComplete(ch)) n++;
    else if (ch.kind === 'group') n += countActiveCriteria(ch.children);
  }
  return n;
}

/** Check if tree contains a stage_reached criterion */
function hasStageReachedInTree(children: FilterNode[]): boolean {
  for (const ch of children) {
    if (ch.kind === 'criterion' && ch.type === 'stage_reached' && criterionIsComplete(ch)) return true;
    if (ch.kind === 'group' && hasStageReachedInTree(ch.children)) return true;
  }
  return false;
}

// ── Immutable tree update helpers ──

/** Update a node deep in the tree by id. Returns new children array. */
function updateNodeInTree(children: FilterNode[], id: string, updater: (node: FilterNode) => FilterNode | null): FilterNode[] {
  const result: FilterNode[] = [];
  for (const ch of children) {
    if (ch.id === id) {
      const updated = updater(ch);
      if (updated) result.push(updated);
      // null = remove
    } else if (ch.kind === 'group') {
      result.push({ ...ch, children: updateNodeInTree(ch.children, id, updater) });
    } else {
      result.push(ch);
    }
  }
  return result;
}

/** Add a child to a specific group by group id, or to root if groupId is null */
function addChildToGroup(children: FilterNode[], groupId: string, child: FilterNode): FilterNode[] {
  return children.map(ch => {
    if (ch.kind === 'group' && ch.id === groupId) {
      return { ...ch, children: [...ch.children, child] };
    }
    if (ch.kind === 'group') {
      return { ...ch, children: addChildToGroup(ch.children, groupId, child) };
    }
    return ch;
  });
}

// ══════════════════════════════════════════════
// ── Helpers ──
// ══════════════════════════════════════════════

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;

function getHubSpotDealUrl(dealId: string): string {
  return `https://app-eu1.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-3/${dealId}`;
}

function formatEUR(value: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

function getCalendarWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function isLostStage(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes('verloren') || l.includes('lost') || l.includes('abgesagt') || l.includes('cancelled') || l.includes('storniert');
}

function isWonStage(label: string): boolean {
  if (isLostStage(label)) return false;
  const l = label.toLowerCase();
  return l.includes('gewonnen') || l.includes('won') || l.includes('abgeschlossen') || l.includes('aktiv') || l.includes('active');
}

// ══════════════════════════════════════════════
// ── Sparkline SVG ──
// ══════════════════════════════════════════════

/** Compute nice Y-axis tick values */
function niceYTicks(maxVal: number, targetValue?: number): number[] {
  const ceil = Math.max(maxVal, targetValue ?? 0, 1);
  // Pick a nice step: 1, 2, 5, 10, 20, 50, 100, ...
  const rawStep = ceil / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const residual = rawStep / magnitude;
  let niceStep: number;
  if (residual <= 1.5) niceStep = 1 * magnitude;
  else if (residual <= 3.5) niceStep = 2 * magnitude;
  else if (residual <= 7.5) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;
  if (niceStep < 1) niceStep = 1;
  niceStep = Math.round(niceStep * 100) / 100; // avoid float weirdness

  const ticks: number[] = [0];
  let t = niceStep;
  while (t <= ceil * 1.05) {
    ticks.push(Math.round(t * 100) / 100);
    t += niceStep;
  }
  // Ensure at least the top tick covers the max
  if (ticks[ticks.length - 1] < ceil) ticks.push(Math.round((ticks[ticks.length - 1] + niceStep) * 100) / 100);
  return ticks;
}

function formatTickLabel(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}

function Sparkline({
  data, color, targetValue, targetLabel, targetColor = '#94D825', invertY = false, unit, weeks, tooltipExtra,
  bars = false, completionRate,
}: {
  data: number[]; color: string; targetValue?: number; targetLabel?: string; targetColor?: string; invertY?: boolean;
  unit?: string; weeks?: Date[]; tooltipExtra?: string[];
  bars?: boolean; completionRate?: number[];
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length === 0) return <div className="h-[120px]" />;

  const ticks = niceYTicks(Math.max(...data), targetValue);
  const maxVal = ticks[ticks.length - 1];
  const minVal = 0;
  const range = maxVal - minVal || 1;

  const totalW = 440, h = 120, padding = 6;
  const yAxisW = 32; // space for y-axis labels
  const w = totalW - yAxisW; // chart area width

  const valToY = (v: number) => invertY
    ? padding + ((v - minVal) / range) * (h - padding * 2)
    : h - padding - ((v - minVal) / range) * (h - padding * 2);

  const idxToX = (i: number) => yAxisW + (data.length === 1 ? w / 2 : (i / (data.length - 1)) * w);

  // Line chart path (used when bars=false)
  const linePath = !bars ? `M ${data.map((v, i) => `${idxToX(i)},${valToY(v)}`).join(' L ')}` : '';
  const areaPath = !bars ? `${linePath} L ${totalW},${h} L ${yAxisW},${h} Z` : '';

  // Bar chart geometry
  const barGap = 2;
  const barW = bars && data.length > 0
    ? Math.max(4, (w / data.length) - barGap)
    : 0;
  const baselineY = valToY(0);

  const targetY = targetValue != null ? valToY(targetValue) : null;

  return (
    <div className="relative h-[120px]">
      {targetLabel && targetY != null && (
        <span className="absolute right-0 text-[10px] font-medium" style={{ top: `${targetY - 14}px`, color: targetColor }}>
          {targetLabel}
        </span>
      )}
      <svg viewBox={`0 0 ${totalW} ${h}`} preserveAspectRatio="none" className="w-full h-full"
        onMouseLeave={() => setHoverIdx(null)}>
        {/* Y-axis ticks & grid lines */}
        {ticks.map(t => {
          const y = valToY(t);
          return (
            <g key={t}>
              <line x1={yAxisW} y1={y} x2={totalW} y2={y} stroke="#F0F0F0" strokeWidth="1" />
              <text x={yAxisW - 4} y={y + 1} textAnchor="end" fontSize="9" fill="#2C3333" opacity="0.35"
                dominantBaseline="middle" style={{ fontFamily: 'inherit' }}>
                {formatTickLabel(t)}{unit ? ` ${unit}` : ''}
              </text>
            </g>
          );
        })}
        {/* Target line */}
        {targetY != null && (
          <line x1={yAxisW} y1={targetY} x2={totalW} y2={targetY} stroke={targetColor} strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
        )}
        {bars ? (
          /* Bar chart - optionally stacked with baseData */
          data.map((v, i) => {
            const cx = idxToX(i);
            const barY = valToY(v);
            const totalBarH = Math.abs(baselineY - barY);
            if (totalBarH < 0.5) return null;

            const cr = completionRate?.[i] ?? 1;
            if (cr >= 1) {
              // All closed - single dark bar
              return (
                <rect key={i} x={cx - barW / 2} y={barY} width={barW} height={totalBarH}
                  fill={color} rx="1.5" />
              );
            }

            // Split bar: dark bottom (closed proportion), light top (open proportion)
            const darkH = totalBarH * cr;
            const lightH = totalBarH - darkH;
            return (
              <g key={i}>
                {/* Light segment (open deals) */}
                <rect x={cx - barW / 2} y={barY} width={barW} height={lightH}
                  fill={color} opacity="0.3" rx="1.5" />
                {/* Dark segment (closed deals) */}
                <rect x={cx - barW / 2} y={barY + lightH} width={barW} height={darkH}
                  fill={color} rx="1.5" />
              </g>
            );
          })
        ) : (
          /* Line chart */
          <>
            <path d={areaPath} fill={color} opacity="0.08" />
            <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {/* Current value dot */}
            {data.length > 0 && (() => {
              const lastX = idxToX(data.length - 1);
              const lastY = valToY(data[data.length - 1]);
              return <circle cx={lastX} cy={lastY} r="4" fill={color} />;
            })()}
          </>
        )}
        {/* Hover highlight */}
        {hoverIdx != null && (
          <>
            {bars ? (
              <rect x={idxToX(hoverIdx) - barW / 2 - 1.5} y={padding} width={barW + 3}
                height={h - padding * 2} fill={color} opacity="0.1" rx="2" />
            ) : (
              <>
                <line x1={idxToX(hoverIdx)} y1={padding} x2={idxToX(hoverIdx)} y2={h - padding} stroke={color} strokeWidth="1" opacity="0.3" />
                <circle cx={idxToX(hoverIdx)} cy={valToY(data[hoverIdx])} r="4.5" fill="white" stroke={color} strokeWidth="2" />
              </>
            )}
          </>
        )}
        {/* Invisible hover zones per data point */}
        {data.map((_, i) => {
          const x = idxToX(i);
          const sliceW = data.length === 1 ? w : w / (data.length - 1);
          return (
            <rect key={i} x={x - sliceW / 2} y={0} width={sliceW} height={h}
              fill="transparent" onMouseEnter={() => setHoverIdx(i)} />
          );
        })}
      </svg>
      {/* Tooltip */}
      {hoverIdx != null && (() => {
        const x = idxToX(hoverIdx);
        const pctLeft = (x / totalW) * 100;
        const val = data[hoverIdx];
        const dateStr = weeks && weeks[hoverIdx] ? `KW ${getCalendarWeek(weeks[hoverIdx])}` : `KW ${hoverIdx + 1}`;
        const valStr = unit ? `${val} ${unit}` : String(val);
        return (
          <div className="absolute pointer-events-none px-2 py-1 rounded bg-[#2C3333] text-white text-[11px] whitespace-nowrap shadow-lg"
            style={{
              left: `${pctLeft}%`,
              top: '-4px',
              transform: pctLeft > 75 ? 'translate(-90%, -100%)' : pctLeft < 25 ? 'translate(-10%, -100%)' : 'translate(-50%, -100%)',
            }}>
            <span className="font-medium">{valStr}</span>
            {tooltipExtra?.[hoverIdx] && <span className="opacity-60 ml-1.5">({tooltipExtra[hoverIdx]})</span>}
            <span className="opacity-60 ml-1.5">{dateStr}</span>
          </div>
        );
      })()}
    </div>
  );
}

function WeekLabels({ weeks }: { weeks: Date[] }) {
  if (weeks.length === 0) return null;
  const labels = [weeks[0], weeks[Math.floor(weeks.length / 3)], weeks[Math.floor(weeks.length * 2 / 3)], weeks[weeks.length - 1]];
  return (
    <div className="flex justify-between mt-1.5 text-[10px] opacity-35">
      {labels.map((d, i) => <span key={i}>KW {getCalendarWeek(d)}</span>)}
    </div>
  );
}

// ══════════════════════════════════════════════
// ── Criterion Row UI ──
// ══════════════════════════════════════════════

function CriterionRow({
  criterion, allStages,
  onUpdate, onRemove,
}: {
  criterion: FilterCriterion;
  allStages: Stage[];
  onUpdate: (patch: Partial<FilterCriterion>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={criterion.type}
        onChange={(e) => {
          const type = e.target.value as FilterCriterion['type'];
          const isNumeric = type === 'agents_minuten' || type === 'mrr';
          onUpdate({
            type,
            stageId: type === 'stage_reached' ? criterion.stageId : undefined,
            ...(isNumeric
              ? { dateFrom: '', dateTo: undefined, numberFrom: undefined, numberTo: undefined, operator: 'after' as const }
              : { numberFrom: undefined, numberTo: undefined }),
          });
        }}
        className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
      >
        <option value="createdate">Erstelldatum</option>
        <option value="stage_reached">Stage erreicht</option>
        <option value="agents_minuten">Agent-Minuten</option>
        <option value="mrr">MRR (€/Monat)</option>
      </select>

      {criterion.type === 'stage_reached' && (
        <select
          value={criterion.stageId ?? ''}
          onChange={(e) => onUpdate({ stageId: e.target.value || undefined })}
          className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
        >
          <option value="">Stage...</option>
          {allStages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      )}

      <select
        value={criterion.operator}
        onChange={(e) => onUpdate({ operator: e.target.value as FilterCriterion['operator'] })}
        className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
      >
        {(criterion.type === 'agents_minuten' || criterion.type === 'mrr') ? (
          <>
            <option value="after">mindestens</option>
            <option value="before">höchstens</option>
            <option value="between">zwischen</option>
          </>
        ) : (
          <>
            <option value="after">nach</option>
            <option value="before">vor</option>
            <option value="between">zwischen</option>
          </>
        )}
      </select>

      {(criterion.type === 'agents_minuten' || criterion.type === 'mrr') ? (
        <>
          <input
            type="number" value={criterion.numberFrom ?? ''}
            onChange={(e) => onUpdate({ numberFrom: e.target.value === '' ? undefined : Number(e.target.value) })}
            placeholder={criterion.type === 'mrr' ? '€' : 'Min'}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {criterion.operator === 'between' && (
            <>
              <span className="text-sm text-gray-500">und</span>
              <input
                type="number" value={criterion.numberTo ?? ''}
                onChange={(e) => onUpdate({ numberTo: e.target.value === '' ? undefined : Number(e.target.value) })}
                placeholder={criterion.type === 'mrr' ? '€' : 'Max'}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </>
          )}
          <span className="text-xs text-gray-400">{criterion.type === 'mrr' ? '€/Mo' : 'Min.'}</span>
        </>
      ) : (
        <>
          <input
            type="date" value={criterion.dateFrom}
            onChange={(e) => onUpdate({ dateFrom: e.target.value })}
            onInput={(e) => onUpdate({ dateFrom: (e.target as HTMLInputElement).value })}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {criterion.operator === 'between' && (
            <>
              <span className="text-sm text-gray-500">und</span>
              <input
                type="date" value={criterion.dateTo ?? ''}
                onChange={(e) => onUpdate({ dateTo: e.target.value })}
                onInput={(e) => onUpdate({ dateTo: (e.target as HTMLInputElement).value })}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </>
          )}
        </>
      )}

      <button onClick={onRemove} className="p-1 text-gray-400 hover:text-red-500 transition-colors" title="Filter entfernen">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════
// ── Recursive FilterNodeList UI ──
// ══════════════════════════════════════════════

function FilterNodeList({
  nodes, logic, allStages, onSetFilter, parentPath,
}: {
  nodes: FilterNode[];
  logic: FilterLogic;
  allStages: Stage[];
  onSetFilter: React.Dispatch<React.SetStateAction<FilterState>>;
  parentPath: string[]; // path of group ids to reach this level (empty = root)
}) {
  // Helper: update the children array at this level in the tree
  const updateChildren = useCallback((updater: (children: FilterNode[]) => FilterNode[]) => {
    onSetFilter(prev => {
      if (parentPath.length === 0) {
        return { ...prev, children: updater(prev.children) };
      }
      // Walk the path to find the target group and update its children
      const updateAtPath = (children: FilterNode[], path: string[]): FilterNode[] => {
        if (path.length === 0) return updater(children);
        const [head, ...rest] = path;
        return children.map(ch => {
          if (ch.kind === 'group' && ch.id === head) {
            return { ...ch, children: updateAtPath(ch.children, rest) };
          }
          return ch;
        });
      };
      return { ...prev, children: updateAtPath(prev.children, parentPath) };
    });
  }, [onSetFilter, parentPath]);

  const toggleLogicAtLevel = useCallback(() => {
    onSetFilter(prev => {
      if (parentPath.length === 0) {
        return { ...prev, logic: prev.logic === 'AND' ? 'OR' : 'AND' };
      }
      const toggleInTree = (children: FilterNode[], path: string[]): FilterNode[] => {
        if (path.length === 1) {
          return children.map(ch => {
            if (ch.kind === 'group' && ch.id === path[0]) {
              return { ...ch, logic: ch.logic === 'AND' ? 'OR' : 'AND' };
            }
            return ch;
          });
        }
        const [head, ...rest] = path;
        return children.map(ch => {
          if (ch.kind === 'group' && ch.id === head) {
            return { ...ch, children: toggleInTree(ch.children, rest) };
          }
          return ch;
        });
      };
      return { ...prev, children: toggleInTree(prev.children, parentPath) };
    });
  }, [onSetFilter, parentPath]);

  const updateCriterion = useCallback((id: string, patch: Partial<FilterCriterion>) => {
    updateChildren(children => children.map(ch =>
      ch.kind === 'criterion' && ch.id === id ? { ...ch, ...patch } : ch
    ));
  }, [updateChildren]);

  const removeNode = useCallback((id: string) => {
    updateChildren(children => children.filter(ch => ch.id !== id));
  }, [updateChildren]);

  const addCriterion = useCallback(() => {
    updateChildren(children => [...children, makeCriterion()]);
  }, [updateChildren]);

  const addGroup = useCallback(() => {
    updateChildren(children => [...children, makeGroup(logic === 'AND' ? 'OR' : 'AND')]);
  }, [updateChildren, logic]);

  return (
    <div className="space-y-1.5">
      {nodes.map((node, idx) => (
        <div key={node.id}>
          {/* Logic connector between sibling nodes */}
          {idx > 0 && nodes.length > 1 && (
            <div className="flex items-center gap-2 py-0.5">
              <button
                onClick={toggleLogicAtLevel}
                className="px-2 py-0.5 text-xs font-medium rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                title="Klicken zum Umschalten"
              >
                {logic}
              </button>
            </div>
          )}

          {node.kind === 'criterion' ? (
            <CriterionRow
              criterion={node}
              allStages={allStages}
              onUpdate={(patch) => updateCriterion(node.id, patch)}
              onRemove={() => removeNode(node.id)}
            />
          ) : (
            /* Nested group */
            <div className="border border-blue-200 bg-blue-50/30 rounded-lg px-3 py-2 relative">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-blue-600 flex items-center gap-1">
                  <Group className="h-3 w-3" />
                  Gruppe ({node.logic})
                </span>
                <button
                  onClick={() => removeNode(node.id)}
                  className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"
                  title="Gruppe entfernen"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <FilterNodeList
                nodes={node.children}
                logic={node.logic}
                allStages={allStages}
                onSetFilter={onSetFilter}
                parentPath={[...parentPath, node.id]}
              />
            </div>
          )}
        </div>
      ))}

      {/* Add buttons */}
      <div className="flex items-center gap-2 pt-0.5">
        <button onClick={addCriterion} className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-colors">
          <Plus className="h-3 w-3" /> Filter
        </button>
        <button onClick={addGroup} className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 hover:border-blue-400 transition-colors">
          <Group className="h-3 w-3" /> Gruppe
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// ── FilterBuilder UI ──
// ══════════════════════════════════════════════

function FilterBuilder({
  filter, allStages, onSetFilter,
  quickButtons, totalFiltered, totalDeals, stageHistoryLoading, hasStageReachedFilter,
  savedSets, onSaveFilterSet, onLoadFilterSet, onDeleteFilterSet, showFilterSets,
}: {
  filter: FilterState;
  allStages: Stage[];
  onSetFilter: React.Dispatch<React.SetStateAction<FilterState>>;
  quickButtons: { label: string; action: () => void }[];
  totalFiltered: number;
  totalDeals: number;
  stageHistoryLoading: boolean;
  hasStageReachedFilter: boolean;
  savedSets: SavedFilterSet[];
  onSaveFilterSet: (name: string) => void;
  onLoadFilterSet: (id: string) => void;
  onDeleteFilterSet: (id: string) => void;
  showFilterSets: boolean;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [loadDropdownOpen, setLoadDropdownOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  const activeCount = countActiveCriteria(filter.children);

  return (
    <div className="space-y-2 mb-6">
      <button
        onClick={() => setCollapsed(prev => !prev)}
        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <span className="font-medium">Filter</span>
        {collapsed && activeCount > 0 && <span className="text-xs text-gray-400">({activeCount} aktiv)</span>}
        {collapsed && <span className="text-xs text-gray-400 ml-1">{totalFiltered} von {totalDeals} Deals</span>}
      </button>

      {!collapsed && <>
        <FilterNodeList
          nodes={filter.children}
          logic={filter.logic}
          allStages={allStages}
          onSetFilter={onSetFilter}
          parentPath={[]}
        />

        {/* Bottom row: quick filters, saved sets, deal count */}
        <div className="flex items-center gap-3 flex-wrap pt-1">
          <div className="w-px h-5 bg-gray-200" />

          <div className="flex gap-1">
            {quickButtons.map((btn) => (
              <button key={btn.label} onClick={btn.action} className="px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors">
                {btn.label}
              </button>
            ))}
          </div>

          {showFilterSets && (
            <>
              <div className="w-px h-5 bg-gray-200" />

              {isSaving ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text" value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && saveName.trim()) { onSaveFilterSet(saveName); setSaveName(''); setIsSaving(false); }
                      if (e.key === 'Escape') { setSaveName(''); setIsSaving(false); }
                    }}
                    placeholder="Name..." autoFocus
                    className="border border-gray-300 rounded-md px-2 py-0.5 text-xs w-32 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    onClick={() => { if (saveName.trim()) { onSaveFilterSet(saveName); setSaveName(''); setIsSaving(false); } }}
                    disabled={!saveName.trim()}
                    className="p-1 text-green-600 hover:text-green-700 disabled:text-gray-300 transition-colors" title="Speichern"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => { setSaveName(''); setIsSaving(false); }} className="p-1 text-gray-400 hover:text-gray-600 transition-colors" title="Abbrechen">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setIsSaving(true)} className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors" title="Filter speichern">
                  <Save className="h-3 w-3" /> Speichern
                </button>
              )}

              <div className="relative">
                <button onClick={() => setLoadDropdownOpen(prev => !prev)} className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors" title="Gespeicherte Filter laden">
                  <FolderOpen className="h-3 w-3" /> Laden
                </button>
                {loadDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setLoadDropdownOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[200px]">
                      {savedSets.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-gray-400">Keine gespeicherten Filter</div>
                      ) : (
                        savedSets.map(set => (
                          <div key={set.id} className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-gray-50 group">
                            <button
                              onClick={() => { onLoadFilterSet(set.id); setLoadDropdownOpen(false); }}
                              className="text-xs text-gray-700 hover:text-gray-900 truncate flex-1 text-left"
                            >
                              {set.name}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onDeleteFilterSet(set.id); }}
                              className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shrink-0" title="Löschen"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          <span className="text-xs text-gray-400 ml-2">{totalFiltered} von {totalDeals} Deals</span>

          {stageHistoryLoading && hasStageReachedFilter && (
            <span className="flex items-center gap-1 text-xs text-blue-500 ml-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Stage-History laden...
            </span>
          )}
        </div>
      </>}
    </div>
  );
}

// ══════════════════════════════════════════════
// ── Main Component ──
// ══════════════════════════════════════════════

export function DashboardView({
  stages, deals, isClosedStage, stageHistory, stageHistoryLoading = false, pipelineId,
}: DashboardViewProps) {

  // ── Filter state ──
  const [filter, setFilter] = useState<FilterState>(() => getDefaultFilterState(pipelineId));
  const [savedSets, setSavedSets] = useState<SavedFilterSet[]>(() =>
    pipelineId ? loadFilterSets(pipelineId) : []
  );

  useEffect(() => {
    setSavedSets(pipelineId ? loadFilterSets(pipelineId) : []);
  }, [pipelineId]);

  const hasStageReached = hasStageReachedInTree(filter.children);

  const filteredDeals = useMemo(
    () => applyFilters(deals, filter, stageHistory, stageHistoryLoading),
    [deals, filter, stageHistory, stageHistoryLoading],
  );

  // ── Quick filters ──

  const setQuickFilter = useCallback((dateFrom: string) => {
    setFilter({
      logic: 'AND',
      children: dateFrom
        ? [makeCriterion({ dateFrom })]
        : [],
    });
  }, []);

  const setMonthsAgo = useCallback((months: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    setQuickFilter(d.toISOString().slice(0, 10));
  }, [setQuickFilter]);

  const quickButtons = [
    { label: '3M', action: () => setMonthsAgo(3) },
    { label: '6M', action: () => setMonthsAgo(6) },
    { label: '1J', action: () => setMonthsAgo(12) },
    { label: 'Alle', action: () => setQuickFilter('') },
  ];

  // ── Saved filter sets ──

  const handleSaveFilterSet = useCallback((name: string) => {
    if (!pipelineId || !name.trim()) return;
    setSavedSets(prev => {
      const existing = prev.find(s => s.name === name.trim());
      let next: SavedFilterSet[];
      if (existing) {
        next = prev.map(s => s.id === existing.id ? { ...s, filter: structuredClone(filter) } : s);
      } else {
        next = [...prev, { id: makeId(), name: name.trim(), filter: structuredClone(filter) }];
      }
      saveFilterSets(pipelineId, next);
      return next;
    });
  }, [pipelineId, filter]);

  const handleLoadFilterSet = useCallback((id: string) => {
    const set = savedSets.find(s => s.id === id);
    if (set) setFilter(migrateFilterState(set.filter));
  }, [savedSets]);

  const handleDeleteFilterSet = useCallback((id: string) => {
    if (!pipelineId) return;
    setSavedSets(prev => {
      const next = prev.filter(s => s.id !== id);
      saveFilterSets(pipelineId, next);
      return next;
    });
  }, [pipelineId]);

  // ── Classify filtered deals ──
  const { wonDeals, lostDeals, openDeals, pipelineStages } = useMemo(() => {
    const won: DealOverviewItem[] = [];
    const lost: DealOverviewItem[] = [];
    const open: DealOverviewItem[] = [];
    const pStages: Stage[] = [];

    for (const deal of filteredDeals) {
      if (isWonStage(deal.dealStage)) won.push(deal);
      else if (isLostStage(deal.dealStage)) lost.push(deal);
      else open.push(deal);
    }

    for (const stage of stages) {
      if (!isClosedStage(stage.label)) pStages.push(stage);
    }
    pStages.sort((a, b) => a.displayOrder - b.displayOrder);

    return { wonDeals: won, lostDeals: lost, openDeals: open, pipelineStages: pStages };
  }, [filteredDeals, stages, isClosedStage]);

  // ── Headline Metrics ──
  const mrr = useMemo(() => wonDeals.reduce((sum, d) => sum + d.revenue, 0), [wonDeals]);
  const wonCount = wonDeals.length;
  const acv = useMemo(() => {
    if (wonDeals.length === 0) return 0;
    return (wonDeals.reduce((sum, d) => sum + d.revenue, 0) / wonDeals.length) * 12;
  }, [wonDeals]);

  // ── Generate weekly date points aligned to Monday boundaries ──
  const weeks = useMemo(() => {
    const now = new Date();
    const { from: filterFrom } = getFilterDateRange(filter.children);
    const start = filterFrom ?? new Date(now.getTime() - 11 * 7 * 86400000);

    // Find first Monday on or after start
    const firstMonday = new Date(start);
    const dayOfWeek = firstMonday.getUTCDay(); // 0=Sun, 1=Mon
    const daysUntilMon = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek;
    firstMonday.setUTCDate(firstMonday.getUTCDate() + daysUntilMon);
    firstMonday.setUTCHours(0, 0, 0, 0);

    const result: Date[] = [];
    const cursor = new Date(firstMonday);
    while (cursor <= now) {
      result.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    // Always include current date as last point
    if (result.length === 0 || result[result.length - 1].getTime() < now.getTime()) {
      result.push(now);
    }
    // Minimum 4 points
    while (result.length < 4) {
      const first = result[0];
      result.unshift(new Date(first.getTime() - 7 * 86400000));
    }
    return result;
  }, [filter]);

  // ── Trends ──
  const prospectsTrend = useMemo(() => weeks.map(weekEnd => {
    const endMs = weekEnd.getTime();
    return filteredDeals.filter(d => {
      const created = d.createdate ? new Date(d.createdate).getTime() : null;
      return created != null && created <= endMs;
    }).length;
  }), [filteredDeals, weeks]);

  const wonDealsTrend = useMemo(() => weeks.map(weekEnd => {
    const endMs = weekEnd.getTime();
    return wonDeals.filter(d => {
      const closed = d.closedate ? new Date(d.closedate).getTime() : null;
      const created = d.createdate ? new Date(d.createdate).getTime() : null;
      return (closed ?? created) != null && (closed ?? created)! <= endMs;
    }).length;
  }), [wonDeals, weeks]);

  const winRateData = useMemo(() => weeks.map((weekEnd, i) => {
    const endMs = weekEnd.getTime();
    const startMs = i > 0 ? weeks[i - 1].getTime() : endMs - 7 * 86400000;
    // Kohorte: Deals, die in diesem Zeitfenster erstellt wurden
    const cohort = filteredDeals.filter(d => {
      const created = d.createdate ? new Date(d.createdate).getTime() : null;
      return created != null && created > startMs && created <= endMs;
    });
    const won = cohort.filter(d => isWonStage(d.dealStage)).length;
    const closed = cohort.filter(d => isWonStage(d.dealStage) || isLostStage(d.dealStage)).length;
    const open = cohort.length - closed;
    const rate = cohort.length > 0 ? Math.round((won / cohort.length) * 100) : 0;
    const completion = cohort.length > 0 ? closed / cohort.length : 1;
    return { rate, won, total: cohort.length, completion };
  }), [filteredDeals, weeks]);

  const winRateTrend = useMemo(() => winRateData.map(d => d.rate), [winRateData]);
  const winRateExtra = useMemo(() => winRateData.map(d => `${d.won} / ${d.total}`), [winRateData]);
  const winRateCompletion = useMemo(() => winRateData.map(d => d.completion >= 1 ? 1 : 0), [winRateData]);
  const winRateAvg = useMemo(() => {
    const totalWon = winRateData.reduce((s, d) => s + d.won, 0);
    const totalDeals = winRateData.reduce((s, d) => s + d.total, 0);
    return totalDeals > 0 ? Math.round((totalWon / totalDeals) * 100) : 0;
  }, [winRateData]);

  const closedDeals = useMemo(() => [...wonDeals, ...lostDeals], [wonDeals, lostDeals]);

  const salesCycleData = useMemo(() => {
    const now = Date.now();
    // Sales Cycle in Tagen: closed → createdate→closedate, open → createdate→now
    const cycleDays = (d: DealOverviewItem): number => {
      const created = d.createdate ? new Date(d.createdate).getTime() : null;
      if (created === null) return 0;
      const isClosed = isWonStage(d.dealStage) || isLostStage(d.dealStage);
      const end = isClosed && d.closedate ? new Date(d.closedate).getTime() : now;
      return Math.max(0, Math.floor((end - created) / 86_400_000));
    };

    return weeks.map((weekEnd, i) => {
      const endMs = weekEnd.getTime();
      const startMs = i > 0 ? weeks[i - 1].getTime() : endMs - 7 * 86400000;
      // Kohorte: Deals, die in diesem Zeitfenster erstellt wurden
      const cohort = filteredDeals.filter(d => {
        const created = d.createdate ? new Date(d.createdate).getTime() : null;
        return created != null && created > startMs && created <= endMs;
      });
      const closed = cohort.filter(d => isWonStage(d.dealStage) || isLostStage(d.dealStage));
      const open = cohort.filter(d => !isWonStage(d.dealStage) && !isLostStage(d.dealStage));
      const avgWeeks = cohort.length > 0
        ? Math.round((cohort.reduce((sum, d) => sum + cycleDays(d), 0) / cohort.length / 7) * 10) / 10
        : 0;
      const completion = cohort.length > 0 ? closed.length / cohort.length : 1;
      return { avgWeeks, created: cohort.length, closed: closed.length, open: open.length, completion };
    });
  }, [filteredDeals, weeks]);

  const salesCycleTrend = useMemo(() => salesCycleData.map(d => d.avgWeeks), [salesCycleData]);
  const salesCycleCompletion = useMemo(() => salesCycleData.map(d => d.completion), [salesCycleData]);
  const salesCycleExtra = useMemo(() => salesCycleData.map(d =>
    `${d.closed} / ${d.created} closed`
  ), [salesCycleData]);

  const currentProspects = prospectsTrend[prospectsTrend.length - 1] || 0;
  const currentWonDeals = wonDealsTrend[wonDealsTrend.length - 1] || 0;
  // Gesamtwerte über alle Kohorten (nicht nur letzte Woche)
  const currentWinRate = useMemo(() => {
    const totalWon = winRateData.reduce((s, d) => s + d.won, 0);
    const totalDeals = winRateData.reduce((s, d) => s + d.total, 0);
    return totalDeals > 0 ? Math.round((totalWon / totalDeals) * 100) : 0;
  }, [winRateData]);
  const currentSalesCycle = useMemo(() => {
    const withData = salesCycleData.filter(d => d.created > 0);
    if (withData.length === 0) return 0;
    const totalWeeks = withData.reduce((s, d) => s + d.avgWeeks * d.created, 0);
    const totalDeals = withData.reduce((s, d) => s + d.created, 0);
    return totalDeals > 0 ? Math.round((totalWeeks / totalDeals) * 10) / 10 : 0;
  }, [salesCycleData]);

  // ── Active Pipeline ──
  const pipelineFunnel = useMemo(() => {
    const result = pipelineStages.map(stage => {
      const stageDeals = openDeals.filter(d => d.dealStageId === stage.id);
      return { stage, count: stageDeals.length, deals: stageDeals };
    });
    const wonStage = stages.find(s => isWonStage(s.label));
    if (wonStage) result.push({ stage: wonStage, count: wonDeals.length, deals: wonDeals });
    return result;
  }, [pipelineStages, openDeals, wonDeals, stages]);

  const maxFunnelCount = Math.max(...pipelineFunnel.map(f => f.count), 1);

  // ── Shared filter builder props ──
  const filterBuilderProps = {
    filter, allStages: stages, onSetFilter: setFilter, quickButtons,
    totalDeals: deals.length, stageHistoryLoading, hasStageReachedFilter: hasStageReached,
    savedSets, onSaveFilterSet: handleSaveFilterSet,
    onLoadFilterSet: handleLoadFilterSet, onDeleteFilterSet: handleDeleteFilterSet,
    showFilterSets: !!pipelineId,
  };

  if (filteredDeals.length === 0) {
    return (
      <div className="max-w-[960px] mx-auto">
        <FilterBuilder {...filterBuilderProps} totalFiltered={0} />
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-gray-500">Keine Deals in diesem Zeitraum</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[960px] mx-auto">
      <FilterBuilder {...filterBuilderProps} totalFiltered={filteredDeals.length} />

      {/* Header */}
      <div className="flex justify-between items-baseline mb-10 pb-4 border-b-2 border-[#2F0D5B]">
        <h1 className="font-medium text-[22px] text-[#2F0D5B]">B2B Scaling – AI Agents</h1>
        <div className="text-sm text-[#E8AC68] font-medium">Stage 4: Find Repeatable Sales Motion</div>
      </div>

      {/* Headline Metrics */}
      <div className="grid grid-cols-3 gap-5 mb-9">
        <MetricCard label="MRR" value={formatEUR(mrr)} sub={mrr > 0 ? `${wonCount} Kunden` : '–'}
          deals={wonDeals} />
        <MetricCard label="Won Deals kumulativ" value={`${wonCount}`} unit=" / 20"
          sub={wonCount > 0 ? `${Math.round((wonCount / 20) * 100)}% vom Ziel` : '–'} subPositive={wonCount >= 10}
          deals={wonDeals} />
        <MetricCard label="ACV" value={acv > 0 ? formatEUR(acv) : '–'} unit=" ARR"
          sub="Ø über alle Won Deals" subNeutral
          deals={wonDeals} />
      </div>

      {/* Trend Charts */}
      <div className="mb-9">
        <div className="font-medium text-[13px] uppercase tracking-[0.08em] text-[#2F0D5B] mb-4">
          Trends ({weeks.length} Wochen)
        </div>
        <div className="grid grid-cols-2 gap-5">
          <ChartCard title="Prospects kumulativ" current={`${currentProspects}`} target="/ 50">
            <Sparkline data={prospectsTrend} color="#E8AC68" targetValue={50} targetLabel="Ziel: 50" weeks={weeks} />
            <WeekLabels weeks={weeks} />
          </ChartCard>
          <ChartCard title="Won Deals kumulativ" current={`${currentWonDeals}`} target="/ 20">
            <Sparkline data={wonDealsTrend} color="#2F0D5B" targetValue={20} targetLabel="Ziel: 20" weeks={weeks} />
            <WeekLabels weeks={weeks} />
          </ChartCard>
          <ChartCard title="Win Rate (Wochenkohorte)" current={`${currentWinRate} %`}>
            <Sparkline data={winRateTrend} color="#E8AC68" unit="%" weeks={weeks} tooltipExtra={winRateExtra} targetValue={winRateAvg} targetLabel={`Ø ${winRateAvg} %`} targetColor="#2C3333" bars completionRate={winRateCompletion} />
            <WeekLabels weeks={weeks} />
          </ChartCard>
          <ChartCard title="Ø Sales Cycle (Wochenkohorte)" current={`${currentSalesCycle} Wochen`}>
            <Sparkline data={salesCycleTrend} color="#2F0D5B" unit="W" weeks={weeks} tooltipExtra={salesCycleExtra} bars completionRate={salesCycleCompletion} />
            <WeekLabels weeks={weeks} />
          </ChartCard>
        </div>
      </div>

      {/* Aktive Pipeline */}
      <div className="mb-9">
        <div className="font-medium text-[13px] uppercase tracking-[0.08em] text-[#2F0D5B] mb-4">Aktive Pipeline</div>
        <div className="bg-white border border-[#e8e8e8] rounded-lg p-6">
          {pipelineFunnel.map((item, idx) => {
            const widthPercent = Math.max((item.count / maxFunnelCount) * 100, 3);
            const prevCount = idx > 0 ? pipelineFunnel[idx - 1].count : null;
            const convRate = prevCount != null && prevCount > 0 ? Math.round((item.count / prevCount) * 100) : null;
            const isWon = isWonStage(item.stage.label);
            const barColor = isWon ? '#94D825' : (idx === 0 ? '#2F0D5B' : '#E8AC68');
            return (
              <div key={item.stage.id} className="grid items-center gap-3 py-2"
                style={{ gridTemplateColumns: '120px 1fr 50px 50px', borderBottom: idx < pipelineFunnel.length - 1 ? '1px solid #F9F9F9' : 'none' }}>
                <div className="text-[13px]">{item.stage.label}</div>
                <div className="h-5 bg-[#F9F9F9] rounded overflow-hidden">
                  <div className="h-full rounded flex items-center pl-2 text-[10px] text-white font-medium" style={{ width: `${widthPercent}%`, backgroundColor: barColor }} />
                </div>
                <div className="text-[13px] font-medium text-right text-[#2F0D5B]">{item.count}</div>
                <div className="text-[11px] text-right opacity-40">{convRate != null ? `${convRate} %` : ''}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-right text-[11px] opacity-30">Datenquelle: HubSpot CRM</div>
    </div>
  );
}

// ══════════════════════════════════════════════
// ── Sub-components ──
// ══════════════════════════════════════════════

function MetricCard({ label, value, unit, sub, subPositive, subNeutral, deals }: {
  label: string; value: string; unit?: string; sub: string; subPositive?: boolean; subNeutral?: boolean;
  deals?: DealOverviewItem[];
}) {
  const { devMode } = useDevStore();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white border border-[#e8e8e8] rounded-lg p-6">
      <div className="text-xs opacity-60 mb-1">{label}</div>
      <div className="text-[32px] font-medium text-[#2F0D5B]">
        {value}{unit && <span className="text-base font-normal opacity-50">{unit}</span>}
      </div>
      <div className={`text-xs mt-1 font-medium ${subNeutral ? 'opacity-40' : subPositive ? 'text-[#94D825]' : 'opacity-40'}`}>{sub}</div>
      {devMode && deals && deals.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <button
            onClick={() => setExpanded(prev => !prev)}
            className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 transition-colors"
          >
            <Eye className="h-3 w-3" />
            {expanded ? 'Ausblenden' : `${deals.length} Kunden anzeigen`}
          </button>
          {expanded && (
            <div className="mt-2 max-h-48 overflow-y-auto space-y-0.5">
              {deals.map(d => (
                <div key={d.id} className="flex justify-between gap-2 text-xs">
                  <a
                    href={getHubSpotDealUrl(d.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-amber-700 hover:text-amber-900 hover:underline"
                  >
                    {d.companyName}
                  </a>
                  <span className="text-gray-400 shrink-0">{formatEUR(d.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, current, target, children }: {
  title: string; current: string; target?: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-[#e8e8e8] rounded-lg p-6">
      <div className="flex justify-between items-baseline mb-4">
        <span className="text-[13px] font-medium text-[#2F0D5B]">{title}</span>
        <span>
          <span className="text-[13px] text-[#E8AC68] font-medium">{current}</span>
          {target && <span className="text-[11px] opacity-40 ml-1">{target}</span>}
        </span>
      </div>
      <div className="border-b border-[#F0F0F0]">{children}</div>
    </div>
  );
}
