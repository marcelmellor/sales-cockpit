'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { getStageColor } from '@/lib/stage-colors';
import { Loader2, Plus, X, Save, FolderOpen, Check, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import type { DealOverviewItem } from '@/app/api/deals/overview/route';
import type { DealStageHistoryMap } from '@/app/api/deals/overview/stage-history/route';

interface Stage {
  id: string;
  label: string;
  displayOrder: number;
}

// ── Filter types ──

interface FilterCriterion {
  id: string;
  type: 'createdate' | 'stage_reached';
  operator: 'after' | 'before' | 'between';
  stageId?: string;
  dateFrom: string; // YYYY-MM-DD
  dateTo?: string;  // only for 'between'
}

type FilterLogic = 'AND' | 'OR';

interface FilterState {
  logic: FilterLogic;
  criteria: FilterCriterion[];
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
  } catch {
    return [];
  }
}

function saveFilterSets(pipelineId: string, sets: SavedFilterSet[]): void {
  try {
    localStorage.setItem(FILTERSETS_KEY + pipelineId, JSON.stringify(sets));
  } catch {
    // localStorage full – silently ignore
  }
}

interface FunnelViewProps {
  stages: Stage[];
  deals: DealOverviewItem[];
  isClosedStage: (label: string) => boolean;
  stageHistory: DealStageHistoryMap;
  stageHistoryLoading?: boolean;
  pipelineId?: string | null;
}

// ── Helpers ──

function formatEUR(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

function getDefaultSinceDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function getDefaultFilterState(): FilterState {
  return {
    logic: 'AND',
    criteria: [
      {
        id: makeId(),
        type: 'createdate',
        operator: 'after',
        dateFrom: getDefaultSinceDate(),
      },
    ],
  };
}

/** Parse a deal's creation date as epoch ms. Returns null if unavailable. */
function getDealCreateTimestamp(deal: DealOverviewItem): number | null {
  if (deal.createdate) {
    const t = new Date(deal.createdate).getTime();
    if (!isNaN(t)) return t;
  }
  if (deal.dealAge > 0) {
    return Date.now() - deal.dealAge * 86_400_000;
  }
  return null;
}

/** Convert YYYY-MM-DD to epoch ms at start of day (UTC). */
function dateToMs(dateStr: string): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr + 'T00:00:00Z').getTime();
  return isNaN(t) ? null : t;
}

/** Convert YYYY-MM-DD to epoch ms at end of day (UTC). */
function dateToMsEnd(dateStr: string): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr + 'T23:59:59.999Z').getTime();
  return isNaN(t) ? null : t;
}

// ── Filter date range helper ──

function getFilterDateRange(filter: FilterState): { from: number; to: number } | null {
  const active = filter.criteria.filter(criterionIsComplete);
  if (active.length === 0) return null;

  const froms: number[] = [];
  const tos: number[] = [];

  for (const c of active) {
    const f = dateToMs(c.dateFrom);
    if (f !== null) froms.push(f);
    if (c.operator === 'between' && c.dateTo) {
      const t = dateToMsEnd(c.dateTo);
      if (t !== null) tos.push(t);
    }
  }

  if (froms.length === 0) return null;

  const from = Math.min(...froms);
  const to = tos.length > 0 ? Math.max(...tos) : Date.now();

  return to > from ? { from, to } : null;
}

// ── Filter logic ──

function criterionIsComplete(c: FilterCriterion): boolean {
  if (c.type === 'stage_reached' && !c.stageId) return false;
  if (!c.dateFrom) return false;
  if (c.operator === 'between' && !c.dateTo) return false;
  return true;
}

function matchCriterion(
  deal: DealOverviewItem,
  c: FilterCriterion,
  stageHistory: DealStageHistoryMap,
  stageHistoryLoading: boolean,
): boolean {
  if (!criterionIsComplete(c)) return true; // incomplete = pass-through

  if (c.type === 'createdate') {
    const created = getDealCreateTimestamp(deal);
    if (created === null) return false;
    return matchTimestamp(created, c);
  }

  // stage_reached
  if (stageHistoryLoading) return false; // not yet loaded

  const entry = stageHistory[deal.id];
  if (!entry?.history) return false;

  return entry.history.some(h => {
    if (h.stageId !== c.stageId) return false;
    const ts = new Date(h.timestamp).getTime();
    if (isNaN(ts)) return false;
    return matchTimestamp(ts, c);
  });
}

function matchTimestamp(ts: number, c: FilterCriterion): boolean {
  if (c.operator === 'after') {
    const from = dateToMs(c.dateFrom);
    return from !== null && ts >= from;
  }
  if (c.operator === 'before') {
    const to = dateToMsEnd(c.dateFrom); // "before" uses dateFrom as the upper bound
    return to !== null && ts <= to;
  }
  // between
  const from = dateToMs(c.dateFrom);
  const to = dateToMsEnd(c.dateTo ?? '');
  if (from === null || to === null) return true;
  return ts >= from && ts <= to;
}

function applyFilters(
  deals: DealOverviewItem[],
  filter: FilterState,
  stageHistory: DealStageHistoryMap,
  stageHistoryLoading: boolean,
): DealOverviewItem[] {
  const active = filter.criteria.filter(criterionIsComplete);
  if (active.length === 0) return deals;

  return deals.filter(deal => {
    if (filter.logic === 'AND') {
      return active.every(c => matchCriterion(deal, c, stageHistory, stageHistoryLoading));
    }
    return active.some(c => matchCriterion(deal, c, stageHistory, stageHistoryLoading));
  });
}

// ── Funnel data types ──

interface FunnelStageData {
  stage: Stage;
  count: number;
  revenue: number;
  ratio: number;
  deals: DealOverviewItem[];
  currentCount: number;
  currentRevenue: number;
  currentDeals: DealOverviewItem[];
  perWeek: number | null;
  avgDaysInStage: number | null;
}

interface FunnelClosedData {
  stage: Stage;
  count: number;
  revenue: number;
  deals: DealOverviewItem[];
  currentCount: number;
  currentRevenue: number;
  perWeek: number | null;
}

// ── Main component ──

export function FunnelView({ stages, deals, isClosedStage, stageHistory, stageHistoryLoading = false, pipelineId }: FunnelViewProps) {
  const [filter, setFilter] = useState<FilterState>(getDefaultFilterState);
  const [savedSets, setSavedSets] = useState<SavedFilterSet[]>(() =>
    pipelineId ? loadFilterSets(pipelineId) : []
  );

  // Reload saved sets when pipeline changes
  useEffect(() => {
    setSavedSets(pipelineId ? loadFilterSets(pipelineId) : []);
  }, [pipelineId]);

  const hasStageReachedFilter = filter.criteria.some(c => c.type === 'stage_reached' && criterionIsComplete(c));

  // All stages (including closed) for the stage-reached selector
  const allStages = stages;

  const filteredDeals = useMemo(
    () => applyFilters(deals, filter, stageHistory, stageHistoryLoading),
    [deals, filter, stageHistory, stageHistoryLoading],
  );

  const { pipelineStages, closedStages } = useMemo(() => {
    const pipeline: Stage[] = [];
    const closed: Stage[] = [];
    for (const stage of stages) {
      if (isClosedStage(stage.label)) {
        closed.push(stage);
      } else {
        pipeline.push(stage);
      }
    }
    pipeline.sort((a, b) => a.displayOrder - b.displayOrder);
    return { pipelineStages: pipeline, closedStages: closed };
  }, [stages, isClosedStage]);

  const stageIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    pipelineStages.forEach((s, i) => map.set(s.id, i));
    return map;
  }, [pipelineStages]);

  // Compute funnel data
  const funnelData = useMemo(() => {
    const filtered = filteredDeals;

    const stageDealSets: Set<DealOverviewItem>[] = pipelineStages.map(() => new Set());
    const closedDealSets: Record<string, Set<DealOverviewItem>> = {};
    for (const cs of closedStages) {
      closedDealSets[cs.id] = new Set();
    }

    for (const deal of filtered) {
      const pipelineIdx = stageIndexMap.get(deal.dealStageId);

      if (pipelineIdx !== undefined) {
        for (let i = 0; i <= pipelineIdx; i++) {
          stageDealSets[i].add(deal);
        }
      } else {
        const closedStage = closedStages.find(s => s.id === deal.dealStageId);
        if (closedStage) {
          for (let i = 0; i < pipelineStages.length; i++) {
            stageDealSets[i].add(deal);
          }
          closedDealSets[closedStage.id].add(deal);
        }
      }
    }

    const counts = stageDealSets.map(s => s.size);
    const maxCount = Math.max(...counts, 1);

    // ── Per-week from filter date range ──
    const dateRange = getFilterDateRange(filter);
    const filterWeeks = dateRange
      ? (dateRange.to - dateRange.from) / (7 * 24 * 60 * 60 * 1000)
      : 0;

    // Average dwell time per pipeline stage (from filtered deals + stage history)
    const avgDwellPerStage = pipelineStages.map((stage) => {
      const durations: number[] = [];
      for (const deal of filtered) {
        const entry = stageHistory[deal.id];
        if (!entry?.history?.length) continue;
        const sorted = [...entry.history].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
        const idx = sorted.findIndex(h => h.stageId === stage.id);
        if (idx === -1) continue;
        const enteredAt = new Date(sorted[idx].timestamp).getTime();
        const exitedAt = idx < sorted.length - 1
          ? new Date(sorted[idx + 1].timestamp).getTime()
          : Date.now();
        const days = (exitedAt - enteredAt) / 86_400_000;
        if (days >= 0) durations.push(days);
      }
      return durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null;
    });

    const pipelineData: FunnelStageData[] = pipelineStages.map((stage, i) => {
      const stageDeals = Array.from(stageDealSets[i]);
      const currentDeals = deals.filter(d => d.dealStageId === stage.id);
      return {
        stage,
        count: stageDeals.length,
        revenue: stageDeals.reduce((sum, d) => sum + d.revenue, 0),
        ratio: stageDeals.length / maxCount,
        deals: stageDeals,
        currentCount: currentDeals.length,
        currentRevenue: currentDeals.reduce((sum, d) => sum + d.revenue, 0),
        currentDeals,
        perWeek: filterWeeks >= 1 ? Math.round((stageDeals.length / filterWeeks) * 10) / 10 : null,
        avgDaysInStage: avgDwellPerStage[i],
      };
    });

    const closedData: FunnelClosedData[] = closedStages.map(stage => {
      const stageDeals = Array.from(closedDealSets[stage.id]);
      const currentDeals = deals.filter(d => d.dealStageId === stage.id);
      return {
        stage,
        count: stageDeals.length,
        revenue: stageDeals.reduce((sum, d) => sum + d.revenue, 0),
        deals: stageDeals,
        currentCount: currentDeals.length,
        currentRevenue: currentDeals.reduce((sum, d) => sum + d.revenue, 0),
        perWeek: filterWeeks >= 1 ? Math.round((stageDeals.length / filterWeeks) * 10) / 10 : null,
      };
    });

    return { pipelineData, closedData, totalFiltered: filtered.length, totalDeals: deals.length };
  }, [filteredDeals, deals, pipelineStages, closedStages, stageIndexMap, stageHistory, filter]);

  // ── Filter mutations ──

  const updateCriterion = useCallback((id: string, patch: Partial<FilterCriterion>) => {
    setFilter(prev => ({
      ...prev,
      criteria: prev.criteria.map(c => c.id === id ? { ...c, ...patch } : c),
    }));
  }, []);

  const removeCriterion = useCallback((id: string) => {
    setFilter(prev => ({
      ...prev,
      criteria: prev.criteria.filter(c => c.id !== id),
    }));
  }, []);

  const addCriterion = useCallback(() => {
    setFilter(prev => ({
      ...prev,
      criteria: [
        ...prev.criteria,
        { id: makeId(), type: 'createdate', operator: 'after', dateFrom: '' },
      ],
    }));
  }, []);

  const toggleLogic = useCallback(() => {
    setFilter(prev => ({ ...prev, logic: prev.logic === 'AND' ? 'OR' : 'AND' }));
  }, []);

  // Quick-select buttons reset to a single createdate criterion
  const setQuickFilter = useCallback((dateFrom: string) => {
    setFilter({
      logic: 'AND',
      criteria: dateFrom
        ? [{ id: makeId(), type: 'createdate', operator: 'after', dateFrom }]
        : [], // "Alle" = no filter
    });
  }, []);

  const setMonthsAgo = useCallback((months: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    setQuickFilter(d.toISOString().slice(0, 10));
  }, [setQuickFilter]);

  const quickButtons: { label: string; action: () => void }[] = [
    { label: '3M', action: () => setMonthsAgo(3) },
    { label: '6M', action: () => setMonthsAgo(6) },
    { label: '1J', action: () => setMonthsAgo(12) },
    { label: 'Alle', action: () => setQuickFilter('') },
  ];

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
    if (set) {
      setFilter(structuredClone(set.filter));
    }
  }, [savedSets]);

  const handleDeleteFilterSet = useCallback((id: string) => {
    if (!pipelineId) return;
    setSavedSets(prev => {
      const next = prev.filter(s => s.id !== id);
      saveFilterSets(pipelineId, next);
      return next;
    });
  }, [pipelineId]);

  const isWonStage = (label: string) => {
    const l = label.toLowerCase();
    return l.includes('gewonnen') || l.includes('won') || l.includes('abgeschlossen') || l.includes('aktiv') || l.includes('active');
  };

  /** Shorten closed-stage labels and return a clean name for color lookup */
  const closedStageLabel = (label: string): string => {
    const l = label.toLowerCase();
    if (l.includes('verloren') || l.includes('lost')) return 'Verloren';
    if (l.includes('gewonnen') || l.includes('won') || l.includes('abgeschlossen') || l.includes('aktiv')) return 'Gewonnen';
    return label;
  };

  // ── Render ──

  const filterHeader = (
    <FilterBuilder
      filter={filter}
      allStages={allStages}
      onUpdateCriterion={updateCriterion}
      onRemoveCriterion={removeCriterion}
      onAddCriterion={addCriterion}
      onToggleLogic={toggleLogic}
      quickButtons={quickButtons}
      totalFiltered={funnelData.totalFiltered}
      totalDeals={funnelData.totalDeals}
      stageHistoryLoading={stageHistoryLoading}
      hasStageReachedFilter={hasStageReachedFilter}
      savedSets={savedSets}
      onSaveFilterSet={handleSaveFilterSet}
      onLoadFilterSet={handleLoadFilterSet}
      onDeleteFilterSet={handleDeleteFilterSet}
      showFilterSets={!!pipelineId}
    />
  );

  if (funnelData.totalFiltered === 0) {
    return (
      <div className="space-y-4">
        {filterHeader}
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-gray-500">Keine Deals in diesem Zeitraum</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {filterHeader}

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        {/* Pipeline Stages Funnel */}
        <div>
          {/* Entry rate before first bar */}
          {funnelData.pipelineData[0]?.perWeek !== null && (
            <div className="flex items-center gap-3 h-12 mb-1">
              <div className="w-52 shrink-0" />
              <div className="flex-1 flex justify-center items-center relative h-full">
                <div className="absolute left-1/2 top-1/2 bottom-0 w-px bg-gray-800 -translate-x-1/2" />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-gray-800" />
                <span className="relative z-10 text-xs text-gray-800 bg-white px-2">
                  Ø {funnelData.pipelineData[0].perWeek} Deals/Wo
                </span>
              </div>
              <div className="w-16 shrink-0" />
            </div>
          )}
          {funnelData.pipelineData.map((item, idx) => {
            const colors = getStageColor(item.stage.label);
            const prevCount = idx > 0 ? funnelData.pipelineData[idx - 1].count : null;
            const conversionRate = prevCount && prevCount > 0
              ? Math.round((item.count / prevCount) * 100)
              : null;

            return (
              <div key={item.stage.id}>
                {/* Arrow connector between stages */}
                {conversionRate !== null && (
                  <div className="flex items-center gap-3 h-12">
                    <div className="w-52 shrink-0" />
                    <div className="flex-1 flex justify-center items-center relative h-full">
                      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-800 -translate-x-1/2" />
                      <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-gray-800" />
                      <span className="relative z-10 text-xs text-gray-800 bg-white px-2">
                        {conversionRate}%{item.perWeek !== null && ` · Ø ${item.perWeek}/Wo`}
                      </span>
                    </div>
                    <div className="w-16 shrink-0" />
                  </div>
                )}

                {/* Stage bar row */}
                <div className="flex items-center gap-3">
                  <div className="w-52 text-right text-base font-medium text-gray-900 shrink-0" title={item.stage.label}>
                    {item.stage.label}
                  </div>
                  <div className="flex-1 flex justify-center">
                    {(() => {
                      const t = funnelData.pipelineData.length > 1 ? idx / (funnelData.pipelineData.length - 1) : 0;
                      return (
                        <DealCountBar
                          currentCount={item.currentCount}
                          currentRevenue={item.currentRevenue}
                          deals={item.currentDeals}
                          bgColor={colors.bg}
                          textColor={colors.text}
                          widthPercent={Math.max(item.ratio * 75, 8)}
                          height={40 + t * 24}
                          fontSize={14 + t * 4}
                        />
                      );
                    })()}
                  </div>
                  <div className="w-16 text-sm text-gray-800 shrink-0 text-right" title="Ø Verweildauer">
                    {item.avgDaysInStage !== null && (
                      <>Ø {item.avgDaysInStage < 1 ? '< 1' : item.avgDaysInStage}T</>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Fork to Closed Stages */}
        {funnelData.closedData.length > 0 && (() => {
          const lastCount = funnelData.pipelineData.at(-1)?.count ?? 0;
          const n = funnelData.closedData.length;
          const svgW = n * 220;
          const svgH = 56;
          const cx = svgW / 2;
          const midY = svgH * 0.45;

          return (
            <div className="mt-4">
              {/* Offset to align with bar center area */}
              <div className="flex items-start gap-3">
                <div className="w-52 shrink-0" />
                <div className="flex-1 flex flex-col items-center">
                  {/* Stem from last pipeline stage */}
                  <div className="h-5 bg-gray-800" style={{ width: '2px' }} />

                  {/* Container for SVG + cards at same width */}
                  <div style={{ width: `${svgW}px`, maxWidth: '100%' }}>
                    {/* SVG curved fork */}
                    <svg
                      viewBox={`0 0 ${svgW} ${svgH}`}
                      preserveAspectRatio="none"
                      className="w-full block"
                      style={{ height: `${svgH}px` }}
                    >
                      {funnelData.closedData.map((_, idx) => {
                        const tx = ((idx + 0.5) / n) * svgW;
                        return (
                          <path
                            key={idx}
                            d={`M${cx},0 C${cx},${midY} ${tx},${midY} ${tx},${svgH}`}
                            stroke="#1f2937"
                            strokeWidth="2"
                            fill="none"
                            vectorEffect="non-scaling-stroke"
                          />
                        );
                      })}
                    </svg>

                    {/* Arrowheads + labels + cards */}
                    <div className="flex">
                      {funnelData.closedData.map((item) => {
                        const shortLabel = closedStageLabel(item.stage.label);
                        const colors = getStageColor(shortLabel);
                        const rate = lastCount > 0
                          ? Math.round((item.count / lastCount) * 100)
                          : null;

                        return (
                          <div key={item.stage.id} className="flex-1 flex flex-col items-center px-3">
                            {/* Arrowhead */}
                            <svg width="10" height="6" viewBox="0 0 10 6" className="text-gray-800 -mt-px shrink-0">
                              <polygon points="0,0 10,0 5,6" fill="currentColor" />
                            </svg>

                            {/* Conversion label */}
                            <span className="text-xs text-gray-800 mt-1.5 mb-3">
                              {rate !== null && <>{rate}%</>}
                              {item.perWeek !== null && <> · Ø {item.perWeek}/Wo</>}
                            </span>

                            {/* Card */}
                            <div
                              className="rounded-lg p-5 text-center min-w-[170px]"
                              style={{ backgroundColor: colors.bg, color: colors.text }}
                            >
                              <div className="text-base font-medium mb-1">{shortLabel}</div>
                              <DealCountTooltip count={item.count} deals={item.deals}>
                                <div className="text-3xl font-bold cursor-default">{item.count}</div>
                              </DealCountTooltip>
                              <div className="text-base mt-1">{formatEUR(item.revenue)}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="w-14 shrink-0" />
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── FilterBuilder ──

function FilterBuilder({
  filter,
  allStages,
  onUpdateCriterion,
  onRemoveCriterion,
  onAddCriterion,
  onToggleLogic,
  quickButtons,
  totalFiltered,
  totalDeals,
  stageHistoryLoading,
  hasStageReachedFilter,
  savedSets,
  onSaveFilterSet,
  onLoadFilterSet,
  onDeleteFilterSet,
  showFilterSets,
}: {
  filter: FilterState;
  allStages: Stage[];
  onUpdateCriterion: (id: string, patch: Partial<FilterCriterion>) => void;
  onRemoveCriterion: (id: string) => void;
  onAddCriterion: () => void;
  onToggleLogic: () => void;
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
  const [collapsed, setCollapsed] = useState(false);

  const activeCount = filter.criteria.filter(criterionIsComplete).length;

  return (
    <div className="space-y-2">
      {/* Collapse toggle header */}
      <button
        onClick={() => setCollapsed(prev => !prev)}
        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <span className="font-medium">Filter</span>
        {collapsed && activeCount > 0 && (
          <span className="text-xs text-gray-400">({activeCount} aktiv)</span>
        )}
        {collapsed && (
          <span className="text-xs text-gray-400 ml-1">
            {totalFiltered} von {totalDeals} Deals
          </span>
        )}
      </button>

      {!collapsed && <>
      {/* Filter rows */}
      {filter.criteria.map((criterion, idx) => (
        <div key={criterion.id}>
          {/* Logic connector between rows */}
          {idx > 0 && (
            <div className="flex items-center gap-2 py-1">
              {filter.criteria.length > 1 ? (
                <button
                  onClick={onToggleLogic}
                  className="px-2 py-0.5 text-xs font-medium rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                  title="Klicken zum Umschalten"
                >
                  {filter.logic}
                </button>
              ) : null}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {/* Type select */}
            <select
              value={criterion.type}
              onChange={(e) => {
                const type = e.target.value as FilterCriterion['type'];
                onUpdateCriterion(criterion.id, {
                  type,
                  stageId: type === 'createdate' ? undefined : criterion.stageId,
                });
              }}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="createdate">Erstelldatum</option>
              <option value="stage_reached">Stage erreicht</option>
            </select>

            {/* Stage select (only for stage_reached) */}
            {criterion.type === 'stage_reached' && (
              <select
                value={criterion.stageId ?? ''}
                onChange={(e) => onUpdateCriterion(criterion.id, { stageId: e.target.value || undefined })}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                <option value="">Stage...</option>
                {allStages.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            )}

            {/* Operator select */}
            <select
              value={criterion.operator}
              onChange={(e) => onUpdateCriterion(criterion.id, { operator: e.target.value as FilterCriterion['operator'] })}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="after">nach</option>
              <option value="before">vor</option>
              <option value="between">zwischen</option>
            </select>

            {/* Date inputs */}
            <input
              type="date"
              value={criterion.dateFrom}
              onChange={(e) => onUpdateCriterion(criterion.id, { dateFrom: e.target.value })}
              onInput={(e) => onUpdateCriterion(criterion.id, { dateFrom: (e.target as HTMLInputElement).value })}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />

            {criterion.operator === 'between' && (
              <>
                <span className="text-sm text-gray-500">und</span>
                <input
                  type="date"
                  value={criterion.dateTo ?? ''}
                  onChange={(e) => onUpdateCriterion(criterion.id, { dateTo: e.target.value })}
                  onInput={(e) => onUpdateCriterion(criterion.id, { dateTo: (e.target as HTMLInputElement).value })}
                  className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </>
            )}

            {/* Remove button */}
            <button
              onClick={() => onRemoveCriterion(criterion.id)}
              className="p-1 text-gray-400 hover:text-red-500 transition-colors"
              title="Filter entfernen"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}

      {/* Bottom row: add button, quick filters, deal count */}
      <div className="flex items-center gap-3 flex-wrap pt-1">
        <button
          onClick={onAddCriterion}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Filter
        </button>

        <div className="w-px h-5 bg-gray-200" />

        <div className="flex gap-1">
          {quickButtons.map((btn) => (
            <button
              key={btn.label}
              onClick={btn.action}
              className="px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
            >
              {btn.label}
            </button>
          ))}
        </div>

        {showFilterSets && (
          <>
            <div className="w-px h-5 bg-gray-200" />

            {/* Save filter set */}
            {isSaving ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && saveName.trim()) {
                      onSaveFilterSet(saveName);
                      setSaveName('');
                      setIsSaving(false);
                    }
                    if (e.key === 'Escape') {
                      setSaveName('');
                      setIsSaving(false);
                    }
                  }}
                  placeholder="Name..."
                  autoFocus
                  className="border border-gray-300 rounded-md px-2 py-0.5 text-xs w-32 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button
                  onClick={() => {
                    if (saveName.trim()) {
                      onSaveFilterSet(saveName);
                      setSaveName('');
                      setIsSaving(false);
                    }
                  }}
                  disabled={!saveName.trim()}
                  className="p-1 text-green-600 hover:text-green-700 disabled:text-gray-300 transition-colors"
                  title="Speichern"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => { setSaveName(''); setIsSaving(false); }}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                  title="Abbrechen"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsSaving(true)}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
                title="Filter speichern"
              >
                <Save className="h-3 w-3" />
                Speichern
              </button>
            )}

            {/* Load filter set */}
            <div className="relative">
              <button
                onClick={() => setLoadDropdownOpen(prev => !prev)}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
                title="Gespeicherte Filter laden"
              >
                <FolderOpen className="h-3 w-3" />
                Laden
              </button>

              {loadDropdownOpen && (
                <>
                  {/* Backdrop to close dropdown */}
                  <div className="fixed inset-0 z-40" onClick={() => setLoadDropdownOpen(false)} />
                  <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[200px]">
                    {savedSets.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-gray-400">Keine gespeicherten Filter</div>
                    ) : (
                      savedSets.map(set => (
                        <div
                          key={set.id}
                          className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-gray-50 group"
                        >
                          <button
                            onClick={() => {
                              onLoadFilterSet(set.id);
                              setLoadDropdownOpen(false);
                            }}
                            className="text-xs text-gray-700 hover:text-gray-900 truncate flex-1 text-left"
                          >
                            {set.name}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteFilterSet(set.id);
                            }}
                            className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                            title="Löschen"
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

        <span className="text-xs text-gray-400 ml-2">
          {totalFiltered} von {totalDeals} Deals
        </span>

        {stageHistoryLoading && hasStageReachedFilter && (
          <span className="flex items-center gap-1 text-xs text-blue-500 ml-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Stage-History laden...
          </span>
        )}
      </div>
      </>}
    </div>
  );
}

// ── Funnel bar & tooltip components ──

/** Funnel bar with built-in hover tooltip listing the deals */
function DealCountBar({
  currentCount,
  currentRevenue,
  deals,
  bgColor,
  textColor,
  widthPercent,
  height = 48,
  fontSize = 16,
}: {
  currentCount: number;
  currentRevenue: number;
  deals: DealOverviewItem[];
  bgColor: string;
  textColor: string;
  widthPercent: number;
  height?: number;
  fontSize?: number;
}) {
  return (
    <div className="relative group" style={{ width: `${widthPercent}%`, minWidth: '80px' }}>
      <div
        className="rounded-md flex items-center justify-center px-4 transition-all duration-300 cursor-default"
        style={{ backgroundColor: bgColor, color: textColor, height: `${height}px` }}
      >
        <span className="font-semibold whitespace-nowrap" style={{ fontSize: `${fontSize}px` }}>
          {currentCount} Deal{currentCount !== 1 ? 's' : ''} · {formatEUR(currentRevenue)}
        </span>
      </div>

      {/* Tooltip */}
      {deals.length > 0 && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 hidden group-hover:block">
          <div className="bg-gray-900 text-white text-xs rounded-lg shadow-lg py-2 px-3 max-h-64 overflow-y-auto w-max max-w-xs">
            {deals.slice(0, 30).map(deal => (
              <div key={deal.id} className="flex justify-between gap-4 py-0.5">
                <span className="truncate">{deal.companyName}</span>
                <span className="text-gray-300 shrink-0">{formatEUR(deal.revenue)}</span>
              </div>
            ))}
            {deals.length > 30 && (
              <div className="text-gray-400 pt-1 border-t border-gray-700 mt-1">
                +{deals.length - 30} weitere
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Inline tooltip wrapper for closed-stage deal counts */
function DealCountTooltip({
  count,
  deals,
  children,
}: {
  count: number;
  deals: DealOverviewItem[];
  children: React.ReactNode;
}) {
  if (count === 0) return <>{children}</>;

  return (
    <div className="relative group inline-block">
      {children}
      <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 hidden group-hover:block">
        <div className="bg-gray-900 text-white text-xs rounded-lg shadow-lg py-2 px-3 max-h-64 overflow-y-auto w-max max-w-xs">
          {deals.slice(0, 30).map(deal => (
            <div key={deal.id} className="flex justify-between gap-4 py-0.5">
              <span className="truncate">{deal.companyName}</span>
              <span className="text-gray-300 shrink-0">{formatEUR(deal.revenue)}</span>
            </div>
          ))}
          {deals.length > 30 && (
            <div className="text-gray-400 pt-1 border-t border-gray-700 mt-1">
              +{deals.length - 30} weitere
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
