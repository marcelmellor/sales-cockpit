'use client';

import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Eye } from 'lucide-react';
import { useDevStore } from '@/stores/dev-store';
import type { DealOverviewItem } from '@/app/api/deals/overview/route';
import type { DealStageHistoryMap } from '@/app/api/deals/overview/stage-history/route';
import type { LeadOverviewItem } from '@/app/api/leads/overview/route';
import { hubspotDealUrl } from '@/lib/hubspot/urls';
import {
  FilterBuilder,
  Sparkline,
  WeekLabels,
  startOfIsoWeek,
  endOfIsoWeek,
  getDefaultFilterState,
  makeCriterion,
  makeId,
  loadFilterSets,
  saveFilterSets,
  getFilterDateRange,
  combineFilterWithBadges,
  loadActiveBadgeIds,
  saveActiveBadgeIds,
} from '@sipgate/revop-ui';
import type { FilterBadge, FilterState, SavedFilterSet } from '@sipgate/revop-ui';
import {
  DEAL_DEFAULT_FIELD,
  DEAL_DATE_FIELD_TYPES,
  buildDealFieldConfigs,
  getDealInputKind,
  applyDealFilters,
  hasStageReachedInDealTree,
} from './filters/dealFilters';
import type { DealFieldType } from './filters/dealFilters';

const FILTERSETS_KEY = 'pipeline-filtersets-';
const ACTIVE_BADGES_KEY = 'pipeline-active-badges-';

interface Stage {
  id: string;
  label: string;
  displayOrder: number;
}

// Map old pipeline stage IDs to new Sales Pipeline stage IDs
const STAGE_ID_MAP: Record<string, string> = {
  // Old AI Agents pipeline
  '3177741533': '4897329341', // Demo Termin vereinbart → Demo / Business Case
  '3983818954': '4897329342', // Onboarding Termin vereinbart → PoC / Pitch
  '3177741537': '4897329343', // Negotiation → Commercial Negotiation
  '3177741538': '4897329344', // Abgeschlossen und gewonnen → Closed won
  '3177741539': '4897329345', // Abgeschlossen und verloren → Closed lost
  // Old Sales pipeline
  '164471537': '4897329340',  // Discovery → Discovery scheduled
  '699747530': '4897329341',  // Demo / Business Case → Demo / Business Case
  '699747531': '4897329342',  // PoC / Pitch → PoC / Pitch
  '699747532': '4897329343',  // Closing → Commercial Negotiation
  '699747533': '4897329344',  // Closed won → Closed won
  '699747534': '4897329345',  // Closed lost → Closed lost
  // Old pipeline 3
  '1340330225': '4897329340', // Erstkontakt AE → Discovery scheduled
  '1340330226': '4897329341', // Demo → Demo / Business Case
  '1340330227': '4897329343', // Negotiation → Commercial Negotiation
  '1340330228': '4897329343', // Closing → Commercial Negotiation
  '1340330230': '4897329344', // Closed won → Closed won
  '1340330231': '4897329345', // Closed lost → Closed lost
};
const mapStageId = (id: string): string => STAGE_ID_MAP[id] || id;

interface DashboardViewProps {
  stages: Stage[];
  deals: DealOverviewItem[];
  isClosedStage: (label: string) => boolean;
  stageHistory: DealStageHistoryMap;
  stageHistoryLoading?: boolean;
  pipelineId?: string | null;
  // Produkt-Kontext — entscheidet, ob das "MRR ≥ 450 €" System-Badge angezeigt
  // wird (nur bei AI Agents sinnvoll, dort entspricht 450 € einem Agents-Paket).
  produkt?: string | null;
  leads?: LeadOverviewItem[];
  // dealId → Label des chronologisch ersten Marketing-Touchpoints (aus dem
  // Marketing-Funnel-Endpoint, identisch zum ersten Chip in der Deal-Journey-
  // Tabelle). Treibt die Prospects-Chart-Gruppierung — wenn ein Eintrag
  // vorliegt, gewinnt er gegen das Lead-Source-Feld. Bei Nicht-AI-Agents-
  // Produkten leer.
  dealFirstTouchpointLabel?: Map<string, string>;
}

// System-Badge-IDs — fest codiert, damit localStorage-Einträge stabil bleiben.
const DASHBOARD_SYSTEM_BADGE_MIN_MRR = 'system:dashboard-min-mrr-450';
const DASHBOARD_SYSTEM_BADGE_ICP_S1 = 'system:dashboard-icp-s1';
const DASHBOARD_SYSTEM_BADGE_ICP_S2 = 'system:dashboard-icp-s2';
const DASHBOARD_SYSTEM_BADGE_ICP_S3 = 'system:dashboard-icp-s3';
const DASHBOARD_SYSTEM_BADGE_ICP_S4 = 'system:dashboard-icp-s4';
const DASHBOARD_SYSTEM_BADGE_PURE_FRONTDESK = 'system:dashboard-pure-frontdesk';
const DASHBOARD_SYSTEM_BADGE_COUNTRY_DE = 'system:dashboard-country-de';

// Filter-Typen/Engine sind in ./filters/ ausgelagert.

// ══════════════════════════════════════════════
// ── Helpers ──
// ══════════════════════════════════════════════


function formatEUR(value: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const CHART_MAX_AGE_MS = 26 * MS_PER_WEEK; // ~6 Monate

function isLostStage(label: string): boolean {
  const l = label.toLowerCase();
  if (l.includes('closed lost')) return true;
  return l.includes('verloren') || l.includes('lost') || l.includes('abgesagt') || l.includes('cancelled') || l.includes('storniert');
}

function isWonStage(label: string): boolean {
  if (isLostStage(label)) return false;
  const l = label.toLowerCase();
  if (l.includes('closed won')) return true;
  return l.includes('gewonnen') || l.includes('won') || l.includes('abgeschlossen') || l.includes('aktiv') || l.includes('active');
}

// Sparkline, WeekLabels und die zugehörigen Date-/Tick-Helpers leben jetzt
// in @sipgate/revop-ui (siehe Imports oben). Verschoben in v0.1.0.



// ══════════════════════════════════════════════
// ── Main Component ──
// ══════════════════════════════════════════════

// Palette für die Source-Stacks (Leads/Woche, Gruppierung "nach Source"):
// bewusst hue-verschiedene Farben, damit benachbarte Segmente im Balken
// unterscheidbar bleiben. Purple/Orange führen (Brand), dann Teal + Pink
// als kontrastreiche Ergänzungen, Grau für den "Andere"-Sammel-Bucket.
// Modul-scope, damit useMemo-Deps stabil bleiben.
const LEAD_SOURCE_COLORS = ['#2F0D5B', '#E8AC68', '#2E9E8E', '#C44569', '#B8BCC2'];

export function DashboardView({
  stages, deals, isClosedStage, stageHistory, stageHistoryLoading = false, pipelineId, produkt = null, leads = [], dealFirstTouchpointLabel,
}: DashboardViewProps) {
  // ── Filter state ──
  const [filter, setFilter] = useState<FilterState<DealFieldType>>(() => getDefaultFilterState<DealFieldType>());
  const [savedSets, setSavedSets] = useState<SavedFilterSet<DealFieldType>[]>(() =>
    pipelineId ? loadFilterSets<DealFieldType>(FILTERSETS_KEY + pipelineId) : []
  );
  // Badge-Aktivierung ist pipeline+produkt-scoped, damit z.B. "MRR ≥ 450 € default
  // aktiv" nur für AI Agents greift und die User-Wahl pro Produkt erhalten bleibt.
  const badgesStorageKey = pipelineId
    ? `${ACTIVE_BADGES_KEY}${pipelineId}:${produkt ?? 'all'}`
    : null;
  const [activeBadgeIds, setActiveBadgeIds] = useState<string[]>(() => {
    if (!badgesStorageKey) return [];
    const stored = loadActiveBadgeIds(badgesStorageKey);
    // Kein gespeicherter Zustand: Defaults aus den System-Badges übernehmen.
    // "Nur DE" ist immer default-aktiv (DACH-Sales-Sicht), "MRR ≥ 450 €" nur
    // bei AI Agents.
    if (stored == null) {
      const defaults: string[] = [DASHBOARD_SYSTEM_BADGE_COUNTRY_DE];
      if (produkt === 'frontdesk') defaults.push(DASHBOARD_SYSTEM_BADGE_MIN_MRR);
      return defaults;
    }
    return stored;
  });
  const fieldConfigs = useMemo(() => buildDealFieldConfigs(stages), [stages]);

  // System-Badges für das Dashboard: "MRR ≥ 450 €" nur für AI Agents (default
  // aktiv, damit die Headline-Metriken standardmäßig das Agents-Paket-Segment
  // zeigen). ICP-Tier-Badges S1–S4 immer verfügbar, nicht default-aktiv;
  // teilen `orGroup: 'icp_tier'`, damit Mehrfachauswahl als OR wirkt.
  const systemBadges: FilterBadge<DealFieldType>[] = useMemo(() => {
    const badges: FilterBadge<DealFieldType>[] = [];
    if (produkt === 'frontdesk') {
      badges.push({
        id: DASHBOARD_SYSTEM_BADGE_MIN_MRR,
        label: 'MRR ≥ 450 €',
        system: true,
        defaultActive: true,
        filter: {
          logic: 'AND',
          children: [{
            kind: 'criterion',
            id: 'sys-dash-mrr',
            type: 'mrr',
            operator: 'after',
            dateFrom: '',
            numberFrom: 449,
          }],
        },
      });
      badges.push({
        id: DASHBOARD_SYSTEM_BADGE_PURE_FRONTDESK,
        label: 'Nur AI Agents',
        system: true,
        filter: {
          logic: 'AND',
          children: [{
            kind: 'criterion',
            id: 'sys-dash-pure-frontdesk',
            type: 'produkt_pur',
            operator: 'after',
            dateFrom: '',
            stringValue: 'frontdesk',
          }],
        },
      });
    }
    const icpBadges: Array<{ id: string; value: 'S1' | 'S2' | 'S3' | 'S4' }> = [
      { id: DASHBOARD_SYSTEM_BADGE_ICP_S1, value: 'S1' },
      { id: DASHBOARD_SYSTEM_BADGE_ICP_S2, value: 'S2' },
      { id: DASHBOARD_SYSTEM_BADGE_ICP_S3, value: 'S3' },
      { id: DASHBOARD_SYSTEM_BADGE_ICP_S4, value: 'S4' },
    ];
    for (const b of icpBadges) {
      badges.push({
        id: b.id,
        label: b.value,
        system: true,
        orGroup: 'icp_tier',
        filter: {
          logic: 'AND',
          children: [{
            kind: 'criterion',
            id: `sys-dash-icp-${b.value}`,
            type: 'icp_tier',
            operator: 'after',
            dateFrom: '',
            stringValue: b.value,
          }],
        },
      });
    }
    // Country-Filter: "Nur DE" entfernt Deals mit Landesflagge im Titel.
    // Inaktiv = "Alle". Pendant zum Deals-Tab-Badge in src/app/page.tsx —
    // default an, damit das Dashboard standardmäßig den DACH-Blick zeigt.
    badges.push({
      id: DASHBOARD_SYSTEM_BADGE_COUNTRY_DE,
      label: 'Nur DE',
      system: true,
      defaultActive: true,
      filter: {
        logic: 'AND',
        children: [{
          kind: 'criterion',
          id: 'sys-dash-country-de',
          type: 'country',
          operator: 'after',
          dateFrom: '',
          stringValue: 'DE',
        }],
      },
    });
    return badges;
  }, [produkt]);
  // Gruppierung für das "Leads / Woche"-Chart: entweder nach Minuten-Bucket
  // (Default — zeigt Qualifizierungs-Stärke) oder nach Source (zeigt Kanal-Mix).
  const [leadsChartGrouping, setLeadsChartGrouping] = useState<'minutes' | 'source'>('minutes');

  const hasStageReached = hasStageReachedInDealTree(filter.children);

  // Aktive Badges in echte FilterBadge-Objekte auflösen: System-Badges +
  // gespeicherte Sets, in dieser Reihenfolge, damit System-Badges links stehen.
  const activeBadges: FilterBadge<DealFieldType>[] = useMemo(() => {
    const system = systemBadges.filter(b => activeBadgeIds.includes(b.id));
    const saved = savedSets
      .filter(s => activeBadgeIds.includes(s.id))
      .map(s => ({ id: s.id, label: s.name, filter: s.filter }));
    return [...system, ...saved];
  }, [systemBadges, savedSets, activeBadgeIds]);

  const effectiveFilter = useMemo(
    () => combineFilterWithBadges<DealFieldType>(filter, activeBadges),
    [filter, activeBadges],
  );

  const filteredDeals = useMemo(
    () => applyDealFilters(deals, effectiveFilter, stageHistory, stageHistoryLoading),
    [deals, effectiveFilter, stageHistory, stageHistoryLoading],
  );

  // ── Quick filters ──

  const setQuickFilter = useCallback((dateFrom: string) => {
    setFilter({
      logic: 'AND',
      children: dateFrom
        ? [makeCriterion<DealFieldType>({ type: 'createdate', dateFrom })]
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
      let next: SavedFilterSet<DealFieldType>[];
      if (existing) {
        next = prev.map(s => s.id === existing.id ? { ...s, filter: structuredClone(filter) } : s);
      } else {
        next = [...prev, { id: makeId(), name: name.trim(), filter: structuredClone(filter) }];
      }
      saveFilterSets<DealFieldType>(FILTERSETS_KEY + pipelineId, next);
      return next;
    });
  }, [pipelineId, filter]);

  const handleDeleteFilterSet = useCallback((id: string) => {
    if (!pipelineId) return;
    setSavedSets(prev => {
      const next = prev.filter(s => s.id !== id);
      saveFilterSets<DealFieldType>(FILTERSETS_KEY + pipelineId, next);
      return next;
    });
    // Gelöschtes Set aus der Aktiv-Liste entfernen, damit kein "Geister-Badge"
    // übrig bleibt.
    setActiveBadgeIds(prev => {
      if (!prev.includes(id)) return prev;
      const next = prev.filter(x => x !== id);
      if (badgesStorageKey) saveActiveBadgeIds(badgesStorageKey, next);
      return next;
    });
  }, [pipelineId, badgesStorageKey]);

  const handleToggleBadge = useCallback((id: string) => {
    setActiveBadgeIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      if (badgesStorageKey) saveActiveBadgeIds(badgesStorageKey, next);
      return next;
    });
  }, [badgesStorageKey]);

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

  // ── Generate weekly date points aligned to calendar-week ends ──
  const weeks = useMemo(() => {
    const now = new Date();
    const { from: filterFrom } = getFilterDateRange<DealFieldType>(filter.children, DEAL_DATE_FIELD_TYPES, getDealInputKind);
    // Fallback: frühestes Erstelldatum der gefilterten Deals
    const earliestDeal = filterFrom ? null : filteredDeals.reduce<Date | null>((earliest, d) => {
      if (!d.createdate) return earliest;
      const dt = new Date(d.createdate);
      return !earliest || dt < earliest ? dt : earliest;
    }, null);
    const floor = new Date(now.getTime() - CHART_MAX_AGE_MS);
    const raw = filterFrom ?? earliestDeal ?? new Date(now.getTime() - 11 * MS_PER_WEEK);
    const start = raw < floor ? floor : raw;

    const firstWeekStart = startOfIsoWeek(start);
    const currentWeekStart = startOfIsoWeek(now);
    const result: Date[] = [];
    const cursor = new Date(firstWeekStart);
    while (cursor < currentWeekStart) {
      result.push(endOfIsoWeek(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }

    // Die laufende Kalenderwoche endet im Chart bei "jetzt", nicht erst am
    // kommenden Sonntag. Sonst würden zukünftige close dates mitzählen.
    result.push(now);

    // Minimum 4 points
    while (result.length < 4) {
      const first = result[0];
      result.unshift(endOfIsoWeek(new Date(first.getTime() - MS_PER_WEEK)));
    }
    return result;
  }, [filter, filteredDeals]);

  const referenceNow = weeks[weeks.length - 1]?.getTime() ?? 0;

  // ── Trends ──
  // Gruppier-Schlüssel für die Prospects-Chart-Stacks. Nutzt das Einstiegs-
  // Label aus dem Marketing-Flow (Agent Signup / PBX Signup / Bestandskunde /
  // Contact Form). Deals ohne Marketing-Journey landen in "Unbekannt".
  const dealSourceKey = useCallback((d: DealOverviewItem): string => {
    return dealFirstTouchpointLabel?.get(d.id)?.toLowerCase() ?? 'unbekannt';
  }, [dealFirstTouchpointLabel]);
  const dealSourceLabel = useCallback((d: DealOverviewItem): string => {
    return dealFirstTouchpointLabel?.get(d.id) ?? 'Unbekannt';
  }, [dealFirstTouchpointLabel]);

  // Pro Woche: alle Deals, die in dieser Woche erstellt wurden.
  const prospectsPerWeekDeals = useMemo(() => weeks.map((weekEnd, i) => {
    const endMs = weekEnd.getTime();
    const startMs = i > 0 ? weeks[i - 1].getTime() : endMs - MS_PER_WEEK;
    return filteredDeals.filter(d => {
      const created = d.createdate ? new Date(d.createdate).getTime() : null;
      return created != null && created > startMs && created <= endMs;
    });
  }), [filteredDeals, weeks]);

  const prospectsTrend = useMemo(
    () => prospectsPerWeekDeals.map(ds => ds.length),
    [prospectsPerWeekDeals],
  );

  const prospectsTooltip = useMemo(
    () => prospectsTrend.map(v => `${v} Deal${v === 1 ? '' : 's'}`),
    [prospectsTrend],
  );

  const prospectsAvg = useMemo(() => {
    if (prospectsTrend.length === 0) return 0;
    return Math.round(
      (prospectsTrend.reduce((sum, v) => sum + v, 0) / prospectsTrend.length) * 10,
    ) / 10;
  }, [prospectsTrend]);

  // Top-4 Sources über alle Wochen summiert + "Andere"-Bucket. Identische
  // Logik zur Leads-Overview (case-insensitive-Konsolidierung, häufigste
  // Schreibweise gewinnt als Label).
  const { topProspectSources, prospectSourceLabelByKey } = useMemo(() => {
    const totals = new Map<string, number>();
    const casingCounts = new Map<string, Map<string, number>>();
    for (const ds of prospectsPerWeekDeals) {
      for (const d of ds) {
        const key = dealSourceKey(d);
        const display = dealSourceLabel(d);
        totals.set(key, (totals.get(key) || 0) + 1);
        if (!casingCounts.has(key)) casingCounts.set(key, new Map());
        const cm = casingCounts.get(key)!;
        cm.set(display, (cm.get(display) || 0) + 1);
      }
    }
    const labelByKey = new Map<string, string>();
    for (const [key, cm] of casingCounts) {
      const best = Array.from(cm.entries()).sort((a, b) => b[1] - a[1])[0];
      labelByKey.set(key, best ? best[0] : key);
    }
    const top = Array.from(totals.entries())
      .filter(([key]) => key !== 'unbekannt')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([key]) => key);
    return { topProspectSources: top, prospectSourceLabelByKey: labelByKey };
  }, [prospectsPerWeekDeals, dealSourceKey, dealSourceLabel]);

  const prospectsBySource = useMemo(() => {
    const displayKeys = [
      ...topProspectSources.map(k => prospectSourceLabelByKey.get(k) || k),
      'Andere',
    ];
    const perWeek: Record<string, number[]> = {};
    for (const k of displayKeys) perWeek[k] = new Array(prospectsPerWeekDeals.length).fill(0);
    const topSet = new Set(topProspectSources);
    prospectsPerWeekDeals.forEach((ds, wi) => {
      for (const d of ds) {
        const key = dealSourceKey(d);
        const bucket = topSet.has(key) ? (prospectSourceLabelByKey.get(key) || key) : 'Andere';
        perWeek[bucket][wi]++;
      }
    });
    return { keys: displayKeys, perWeek };
  }, [prospectsPerWeekDeals, topProspectSources, prospectSourceLabelByKey, dealSourceKey]);

  const prospectsSourceStacks = useMemo(
    () => prospectsBySource.keys.map((k, i) => ({
      key: k,
      color: LEAD_SOURCE_COLORS[i] || '#D4D4D4',
      values: prospectsBySource.perWeek[k],
    })),
    [prospectsBySource],
  );

  const prospectTooltipLines = useMemo(() => {
    const topSet = new Set(topProspectSources);
    const sourceKeys = prospectsBySource.keys;
    return prospectsPerWeekDeals.map(ds => {
      if (ds.length === 0) return ['Keine neuen Deals'];
      const groups = new Map<string, string[]>();
      for (const k of sourceKeys) groups.set(k, []);
      for (const d of ds) {
        const key = dealSourceKey(d);
        const bucket = topSet.has(key) ? (prospectSourceLabelByKey.get(key) || key) : 'Andere';
        groups.get(bucket)?.push(d.companyName);
      }
      const lines: string[] = [];
      let shown = 0;
      const MAX_DEALS = 20;
      for (const [source, names] of groups) {
        if (names.length === 0) continue;
        const remaining = MAX_DEALS - shown;
        if (remaining <= 0) break;
        if (lines.length > 0) lines.push('');
        lines.push(`${source} (${names.length})`);
        const visible = names.slice(0, remaining);
        for (const n of visible) lines.push(`· ${n}`);
        shown += visible.length;
        if (names.length > visible.length) {
          lines.push(`  +${names.length - visible.length} weitere`);
        }
      }
      if (shown < ds.length && !lines.some(l => l.startsWith('  +'))) {
        lines.push(`+${ds.length - shown} weitere`);
      }
      return lines;
    });
  }, [prospectsPerWeekDeals, topProspectSources, prospectsBySource.keys, prospectSourceLabelByKey, dealSourceKey]);

  const wonDealsTrend = useMemo(() => weeks.map(weekEnd => {
    const endMs = weekEnd.getTime();
    return wonDeals.filter(d => {
      const closed = d.closedate ? new Date(d.closedate).getTime() : null;
      const created = d.createdate ? new Date(d.createdate).getTime() : null;
      return (closed ?? created) != null && (closed ?? created)! <= endMs;
    }).length;
  }), [wonDeals, weeks]);

  const wonDealsDeltas = useMemo(() => wonDealsTrend.map((v, i) => {
    const delta = i === 0 ? v : v - wonDealsTrend[i - 1];
    return `+${delta}`;
  }), [wonDealsTrend]);

  const wonDealsTooltipLines = useMemo(() => {
    return weeks.map((weekEnd, i) => {
      const endMs = weekEnd.getTime();
      const startMs = i > 0 ? weeks[i - 1].getTime() : null;
      const dealsInRange = wonDeals
        .filter(d => {
          const closed = d.closedate ? new Date(d.closedate).getTime() : null;
          const created = d.createdate ? new Date(d.createdate).getTime() : null;
          const ts = closed ?? created;
          if (ts == null) return false;
          return startMs == null ? ts <= endMs : ts > startMs && ts <= endMs;
        })
        .sort((a, b) => {
          const aTs = (a.closedate ? new Date(a.closedate).getTime() : null) ?? (a.createdate ? new Date(a.createdate).getTime() : 0);
          const bTs = (b.closedate ? new Date(b.closedate).getTime() : null) ?? (b.createdate ? new Date(b.createdate).getTime() : 0);
          return aTs - bTs;
        });

      if (dealsInRange.length === 0) return ['Keine neuen Won Deals'];

      const visibleDeals = dealsInRange.slice(0, 6).map(d => d.companyName);
      if (dealsInRange.length > 6) {
        visibleDeals.push(`+${dealsInRange.length - 6} weitere`);
      }
      return visibleDeals;
    });
  }, [wonDeals, weeks]);

  const newArrData = useMemo(() => weeks.map((weekEnd, i) => {
    const endMs = weekEnd.getTime();
    const startMs = i > 0 ? weeks[i - 1].getTime() : endMs - MS_PER_WEEK;
    const wonThisWeek = wonDeals.filter(d => {
      const closed = d.closedate ? new Date(d.closedate).getTime() : null;
      const created = d.createdate ? new Date(d.createdate).getTime() : null;
      const wonAt = closed ?? created;
      return wonAt != null && wonAt > startMs && wonAt <= endMs;
    });
    const arr = wonThisWeek.reduce((sum, deal) => sum + deal.revenue * 12, 0);
    return { arr, wonCount: wonThisWeek.length };
  }), [wonDeals, weeks]);

  const newArrTrend = useMemo(() => newArrData.map(d => d.arr), [newArrData]);
  const newArrTooltip = useMemo(() => newArrData.map(d => d.arr > 0 ? formatEUR(d.arr) : '0 €'), [newArrData]);
  const newArrExtra = useMemo(() => newArrData.map(d => `${d.wonCount} Won Deal${d.wonCount === 1 ? '' : 's'}`), [newArrData]);
  const newArrAvg = useMemo(() => {
    if (newArrTrend.length === 0) return 0;
    return Math.round(newArrTrend.reduce((sum, value) => sum + value, 0) / newArrTrend.length);
  }, [newArrTrend]);

  const winRateData = useMemo(() => weeks.map((weekEnd, i) => {
    const endMs = weekEnd.getTime();
    const startMs = i > 0 ? weeks[i - 1].getTime() : endMs - MS_PER_WEEK;
    // Kohorte: Deals, die in diesem Zeitfenster erstellt wurden
    const cohort = filteredDeals.filter(d => {
      const created = d.createdate ? new Date(d.createdate).getTime() : null;
      return created != null && created > startMs && created <= endMs;
    });
    const won = cohort.filter(d => isWonStage(d.dealStage)).length;
    const closed = cohort.filter(d => isWonStage(d.dealStage) || isLostStage(d.dealStage)).length;
    const open = cohort.length - closed;
    const realRate = cohort.length > 0 ? Math.round((won / cohort.length) * 100) : 0;
    // Show a minimal bar for 0%-cohorts that actually have deals, so they're
    // visually distinguishable from empty weeks (which show no bar at all).
    const rate = cohort.length > 0 && realRate === 0 ? 1 : realRate;
    const completion = cohort.length > 0 ? closed / cohort.length : 1;
    return { rate, won, total: cohort.length, completion };
  }), [filteredDeals, weeks]);

  const winRateTrend = useMemo(() => winRateData.map(d => d.rate), [winRateData]);
  const winRateTooltip = useMemo(() => winRateData.map(d =>
    d.total > 0 && d.won === 0 ? '0 %' : `${d.rate} %`
  ), [winRateData]);
  const winRateExtra = useMemo(() => winRateData.map(d => `${d.won} / ${d.total}`), [winRateData]);
  const winRateCompletion = useMemo(() => winRateData.map(d => d.completion >= 1 ? 1 : 0), [winRateData]);
  const winRateAvg = useMemo(() => {
    const totalWon = winRateData.reduce((s, d) => s + d.won, 0);
    const totalDeals = winRateData.reduce((s, d) => s + d.total, 0);
    return totalDeals > 0 ? Math.round((totalWon / totalDeals) * 100) : 0;
  }, [winRateData]);

  const closedDeals = useMemo(() => [...wonDeals, ...lostDeals], [wonDeals, lostDeals]);

  const salesCycleData = useMemo(() => {
    const now = referenceNow;
    // Sales Cycle in Tagen: closed → createdate→closedate, open → createdate→now
    const cycleDays = (d: DealOverviewItem): number => {
      const created = d.createdate ? new Date(d.createdate).getTime() : null;
      if (created === null) return 0;
      const isClosed = isWonStage(d.dealStage) || isLostStage(d.dealStage);
      const end = isClosed && d.closedate ? new Date(d.closedate).getTime() : now;
      return Math.max(0, Math.floor((end - created) / MS_PER_DAY));
    };

    return weeks.map((weekEnd, i) => {
      const endMs = weekEnd.getTime();
      const startMs = i > 0 ? weeks[i - 1].getTime() : endMs - MS_PER_WEEK;
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
  }, [filteredDeals, weeks, referenceNow]);

  const salesCycleTrend = useMemo(() => salesCycleData.map(d => d.avgWeeks), [salesCycleData]);
  const salesCycleCompletion = useMemo(() => salesCycleData.map(d => d.completion), [salesCycleData]);
  const salesCycleExtra = useMemo(() => salesCycleData.map(d =>
    `${d.closed} / ${d.created} closed`
  ), [salesCycleData]);

  const currentProspects = prospectsTrend[prospectsTrend.length - 1] || 0;
  const currentWonDeals = wonDealsTrend[wonDealsTrend.length - 1] || 0;

  // ── Active Pipeline ──
  const pipelineFunnel = useMemo(() => {
    const result = pipelineStages.map(stage => {
      const stageDeals = openDeals.filter(d => d.dealStageId === stage.id);
      const mrr = stageDeals.reduce((sum, d) => sum + d.revenue, 0);
      return { stage, count: stageDeals.length, mrr, deals: stageDeals };
    });
    const wonStage = stages.find(s => isWonStage(s.label));
    if (wonStage) {
      const mrr = wonDeals.reduce((sum, d) => sum + d.revenue, 0);
      result.push({ stage: wonStage, count: wonDeals.length, mrr, deals: wonDeals });
    }
    return result;
  }, [pipelineStages, openDeals, wonDeals, stages]);

  const maxFunnelCount = Math.max(...pipelineFunnel.map(f => f.count), 1);

  // ── Displayed active stages (non-won with open deals) + won stage ──
  const activeStages = useMemo(() =>
    pipelineFunnel.filter(f => !isWonStage(f.stage.label) && f.count > 0),
    [pipelineFunnel],
  );

  // ── Stage conversion rates (based on stage history of filtered deals) ──
  const { stageConversionRates, stageReachedCounts, stageConvCounts } = useMemo(() => {
    // Only count stage history entries for stages that exist in the current pipeline
    const validStageIds = new Set(pipelineFunnel.map(f => f.stage.id));

    // Per-deal: collect the set of (mapped) stages each deal reached
    const dealReachedMap = new Map<string, Set<string>>();
    const reachedCount: Record<string, number> = {};

    for (const deal of filteredDeals) {
      const reachedStages = new Set<string>();

      const entry = stageHistory[deal.id];
      if (entry?.history) {
        for (const h of entry.history) {
          const mapped = mapStageId(h.stageId);
          if (validStageIds.has(mapped)) {
            reachedStages.add(mapped);
          }
        }
      }

      const mappedCurrent = mapStageId(deal.dealStageId);
      if (validStageIds.has(mappedCurrent)) {
        reachedStages.add(mappedCurrent);
      }

      dealReachedMap.set(deal.id, reachedStages);
      for (const sid of reachedStages) {
        reachedCount[sid] = (reachedCount[sid] || 0) + 1;
      }
    }

    // Build displayed stage sequence: active (non-won, count>0) stages + won stage
    const wonStage = pipelineFunnel.find(f => isWonStage(f.stage.label));
    const displayedStageIds = [
      ...activeStages.map(f => f.stage.id),
      ...(wonStage ? [wonStage.stage.id] : []),
    ];

    // Conversion A→B: of deals that reached A, how many also reached B?
    // Computed between consecutive DISPLAYED stages so the rate matches
    // what the user sees, regardless of hidden intermediate stages.
    const rates: Record<string, number | null> = {};
    const convCounts: Record<string, { reached: number; fromPrev: number }> = {};
    for (let i = 0; i < displayedStageIds.length; i++) {
      if (i === 0) { rates[displayedStageIds[i]] = null; continue; }
      const prevId = displayedStageIds[i - 1];
      const currId = displayedStageIds[i];
      let reachedPrev = 0;
      let reachedBoth = 0;
      for (const stages of dealReachedMap.values()) {
        if (stages.has(prevId)) {
          reachedPrev++;
          if (stages.has(currId)) reachedBoth++;
        }
      }
      rates[currId] = reachedPrev > 0 ? Math.round((reachedBoth / reachedPrev) * 100) : null;
      convCounts[currId] = { reached: reachedBoth, fromPrev: reachedPrev };
    }
    return { stageConversionRates: rates, stageReachedCounts: reachedCount, stageConvCounts: convCounts };
  }, [filteredDeals, stageHistory, pipelineFunnel, activeStages]);

  // ── Average dwell time per stage (in days) ──
  const avgDaysInStage = useMemo(() => {
    const totalDays: Record<string, number> = {};
    const count: Record<string, number> = {};
    const now = referenceNow;
    for (const deal of filteredDeals) {
      const entry = stageHistory[deal.id];
      if (!entry?.history || entry.history.length === 0) continue;
      // History is newest-first, reverse to chronological
      const sorted = [...entry.history].sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      for (let i = 0; i < sorted.length; i++) {
        const stageId = mapStageId(sorted[i].stageId);
        const enteredAt = new Date(sorted[i].timestamp).getTime();
        const exitedAt = i < sorted.length - 1
          ? new Date(sorted[i + 1].timestamp).getTime()
          : now;
        const days = (exitedAt - enteredAt) / (1000 * 60 * 60 * 24);
        totalDays[stageId] = (totalDays[stageId] || 0) + days;
        count[stageId] = (count[stageId] || 0) + 1;
      }
    }
    const avg: Record<string, number> = {};
    for (const sid of Object.keys(totalDays)) {
      avg[sid] = Math.round(totalDays[sid] / count[sid]);
    }
    return avg;
  }, [filteredDeals, stageHistory, referenceNow]);

  // ── Leads pro Woche (Bar-Chart, gestapelt nach Minutensegment) ──
  // Eigener Zeitraum für das Leads-Chart, damit Deal-Filter (z.B. "Nur DE")
  // die Leads-Buckets nicht verschieben.
  const leadsWeeks = useMemo(() => {
    const now = new Date();
    const earliestLead = leads.reduce<Date | null>((earliest, l) => {
      if (!l.createdate) return earliest;
      const dt = new Date(l.createdate);
      return !earliest || dt < earliest ? dt : earliest;
    }, null);
    const floor = new Date(now.getTime() - CHART_MAX_AGE_MS);
    const raw = earliestLead ?? new Date(now.getTime() - 11 * MS_PER_WEEK);
    const start = raw < floor ? floor : raw;
    const firstWeekStart = startOfIsoWeek(start);
    const currentWeekStart = startOfIsoWeek(now);
    const result: Date[] = [];
    const cursor = new Date(firstWeekStart);
    while (cursor < currentWeekStart) {
      result.push(endOfIsoWeek(cursor));
      cursor.setDate(cursor.getDate() + 7);
    }
    result.push(now);
    while (result.length < 4) {
      const first = result[0];
      result.unshift(endOfIsoWeek(new Date(first.getTime() - MS_PER_WEEK)));
    }
    return result;
  }, [leads]);
  // Bucket-Logik pro Lead:
  //   minutes = agentsMinuten ?? Untergrenze(inboundVolumen) ?? null
  //   minutes >= 2000   → "large"   (Enterprise-Potenzial)
  //   minutes >= 1000   → "mid"
  //   minutes <  1000   → "small"
  //   minutes == null   → "unknown" (weder agents_minuten noch parsebares Range)
  const leadsMinutesBucket = useCallback((l: LeadOverviewItem): 'small' | 'mid' | 'large' | 'unknown' => {
    let mins: number | null = null;
    if (l.agentsMinuten != null) {
      mins = l.agentsMinuten;
    } else if (l.inboundVolumen) {
      const m = l.inboundVolumen.match(/^(\d+)/) || l.inboundVolumen.match(/^>(\d+)/);
      mins = m ? Number(m[1]) : null;
    }
    if (mins == null) return 'unknown';
    if (mins >= 2000) return 'large';
    if (mins >= 1000) return 'mid';
    return 'small';
  }, []);

  const leadsPerWeekData = useMemo(() => leadsWeeks.map((weekEnd, i) => {
    const endMs = weekEnd.getTime();
    const startMs = i > 0 ? leadsWeeks[i - 1].getTime() : endMs - MS_PER_WEEK;
    const inRange = leads.filter(l => {
      const ts = l.createdate ? new Date(l.createdate).getTime() : null;
      return ts != null && ts > startMs && ts <= endMs;
    });
    let small = 0, mid = 0, large = 0, unknown = 0;
    for (const l of inRange) {
      const b = leadsMinutesBucket(l);
      if (b === 'large') large++;
      else if (b === 'mid') mid++;
      else if (b === 'small') small++;
      else unknown++;
    }
    return { count: inRange.length, leads: inRange, small, mid, large, unknown };
  }), [leads, leadsWeeks, leadsMinutesBucket]);

  const leadsPerWeekTrend = useMemo(() => leadsPerWeekData.map(d => d.count), [leadsPerWeekData]);
  const leadsPerWeekUnknown = useMemo(() => leadsPerWeekData.map(d => d.unknown), [leadsPerWeekData]);
  const leadsPerWeekSmall = useMemo(() => leadsPerWeekData.map(d => d.small), [leadsPerWeekData]);
  const leadsPerWeekMid = useMemo(() => leadsPerWeekData.map(d => d.mid), [leadsPerWeekData]);
  const leadsPerWeekLarge = useMemo(() => leadsPerWeekData.map(d => d.large), [leadsPerWeekData]);

  // Source-Gruppierung: Top-4 häufigste Sources (über alle Wochen summiert)
  // bekommen eine eigene Farbe; alles darunter landet in "Andere". Verhindert,
  // dass das Chart bei 15+ Sources in ein unleserliches Farbchaos kippt.
  //
  // Case-Insensitive-Konsolidierung: "TEAM_NEOPBX" und "team_neopbx" zählen
  // als derselbe Bucket (lowercase-key). Als Anzeige-Label gewinnt die
  // häufigste Schreibweise — so bleibt "Agent Qualifizierungsfragen …" schön
  // kapitalisiert, ohne dass die beiden team_neopbx-Varianten doppelt kippen.
  const leadSourceKey = useCallback((l: LeadOverviewItem): string => {
    const raw = (l.leadSource || l.source || '').trim();
    return raw ? raw.toLowerCase() : 'unbekannt';
  }, []);

  const { topLeadSources, sourceLabelByKey } = useMemo(() => {
    // key → total count; key → { casing → count } (um Anzeige-Label zu wählen)
    const totals = new Map<string, number>();
    const casingCounts = new Map<string, Map<string, number>>();
    for (const d of leadsPerWeekData) {
      for (const l of d.leads) {
        const key = leadSourceKey(l);
        const display = ((l.leadSource || l.source || '').trim()) || 'Unbekannt';
        totals.set(key, (totals.get(key) || 0) + 1);
        if (!casingCounts.has(key)) casingCounts.set(key, new Map());
        const cm = casingCounts.get(key)!;
        cm.set(display, (cm.get(display) || 0) + 1);
      }
    }
    const labelByKey = new Map<string, string>();
    for (const [key, cm] of casingCounts) {
      const best = Array.from(cm.entries()).sort((a, b) => b[1] - a[1])[0];
      labelByKey.set(key, best ? best[0] : key);
    }
    const top = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([key]) => key);
    return { topLeadSources: top, sourceLabelByKey: labelByKey };
  }, [leadsPerWeekData, leadSourceKey]);


  const leadsPerWeekBySource = useMemo(() => {
    const displayKeys = [
      ...topLeadSources.map(k => sourceLabelByKey.get(k) || k),
      'Andere',
    ];
    const perWeek: Record<string, number[]> = {};
    for (const k of displayKeys) perWeek[k] = new Array(leadsPerWeekData.length).fill(0);
    const topSet = new Set(topLeadSources);
    leadsPerWeekData.forEach((d, wi) => {
      for (const l of d.leads) {
        const key = leadSourceKey(l);
        const bucket = topSet.has(key) ? (sourceLabelByKey.get(key) || key) : 'Andere';
        perWeek[bucket][wi]++;
      }
    });
    return { keys: displayKeys, perWeek };
  }, [leadsPerWeekData, topLeadSources, sourceLabelByKey, leadSourceKey]);

  const leadsPerWeekSourceStacks = useMemo(
    () => leadsPerWeekBySource.keys.map((k, i) => ({
      key: k,
      color: LEAD_SOURCE_COLORS[i] || '#D4D4D4',
      values: leadsPerWeekBySource.perWeek[k],
    })),
    [leadsPerWeekBySource],
  );

  const leadsPerWeekTooltip = useMemo(
    () => leadsPerWeekData.map(d => `${d.count} Lead${d.count === 1 ? '' : 's'}`),
    [leadsPerWeekData],
  );
  const leadsPerWeekTooltipLinesMinutes = useMemo(() => leadsPerWeekData.map(d => {
    if (d.count === 0) return ['Keine neuen Leads'];
    const lines: string[] = [];
    if (d.large > 0) lines.push(`≥ 2000 Min: ${d.large}`);
    if (d.mid > 0) lines.push(`1000-2000 Min: ${d.mid}`);
    if (d.small > 0) lines.push(`< 1000 Min: ${d.small}`);
    if (d.unknown > 0) lines.push(`Unbekannt: ${d.unknown}`);
    return lines;
  }), [leadsPerWeekData]);
  const leadsPerWeekTooltipLinesSource = useMemo(() => leadsPerWeekData.map((d, wi) => {
    if (d.count === 0) return ['Keine neuen Leads'];
    // Top-Source-Reihenfolge beibehalten, nur nicht-leere Einträge zeigen
    return leadsPerWeekSourceStacks
      .map(s => ({ key: s.key, n: s.values[wi] }))
      .filter(x => x.n > 0)
      .map(x => `${x.key}: ${x.n}`);
  }), [leadsPerWeekData, leadsPerWeekSourceStacks]);
  const leadsPerWeekTooltipLines = leadsChartGrouping === 'source'
    ? leadsPerWeekTooltipLinesSource
    : leadsPerWeekTooltipLinesMinutes;
  const leadsPerWeekAvg = useMemo(() => {
    if (leadsPerWeekTrend.length === 0) return 0;
    return Math.round(leadsPerWeekTrend.reduce((sum, v) => sum + v, 0) / leadsPerWeekTrend.length);
  }, [leadsPerWeekTrend]);

  // ── Shared filter builder props ──
  const filterBuilderProps = {
    filter,
    onSetFilter: setFilter,
    fieldConfigs,
    defaultType: DEAL_DEFAULT_FIELD,
    getInputKind: getDealInputKind,
    quickButtons,
    totalItems: deals.length,
    itemLabel: 'Deals',
    pendingDataLabel: hasStageReached ? 'Stage-History laden...' : null,
    pendingDataLoading: stageHistoryLoading && hasStageReached,
    savedSets,
    onSaveFilterSet: handleSaveFilterSet,
    onDeleteFilterSet: handleDeleteFilterSet,
    showFilterSets: !!pipelineId,
    systemBadges,
    activeBadgeIds,
    onToggleBadge: handleToggleBadge,
  };

  if (filteredDeals.length === 0) {
    return (
      <div className="w-full">
        <FilterBuilder {...filterBuilderProps} totalFiltered={0} />
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-gray-500">Keine Deals in diesem Zeitraum</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <FilterBuilder {...filterBuilderProps} totalFiltered={filteredDeals.length} />

      {/* Headline Metrics */}
      <div className="grid grid-cols-3 gap-5 mb-9">
        <MetricCard label="MRR" value={formatEUR(mrr)} sub={mrr > 0 ? `${wonCount} Kunden` : '–'}
          deals={wonDeals} />
        <MetricCard label="Won Deals kumulativ" value={`${wonCount}`} unit=" / 25"
          sub={wonCount > 0 ? `${Math.round((wonCount / 25) * 100)}% vom Ziel` : '–'} subPositive={wonCount >= 10}
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
          <ChartCard title="Deals / Woche" current={`${currentProspects}`}>
            <Sparkline
              data={prospectsTrend}
              color="#E8AC68"
              weeks={weeks}
              tooltipOverride={prospectsTooltip}
              tooltipLines={prospectTooltipLines}
              bars
              targetValue={prospectsAvg}
              targetLabel={`Ø ${prospectsAvg}`}
              targetColor="#2C3333"
              stacks={prospectsSourceStacks.map(s => ({ values: s.values, color: s.color }))}
            />
            <WeekLabels weeks={weeks} />
            <div className="flex items-center gap-3 mt-2 text-[10px] flex-wrap">
              {prospectsSourceStacks.map(s => (
                <span key={s.key} className="flex items-center gap-1" title={s.key}>
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ background: s.color }} />
                  <span className="max-w-[140px] truncate text-gray-500">{s.key}</span>
                </span>
              ))}
            </div>
          </ChartCard>
          <ChartCard title="Won Deals kumulativ" current={`${currentWonDeals}`} target="/ 25">
            <Sparkline
              data={wonDealsTrend}
              color="#2F0D5B"
              weeks={weeks}
              tooltipOverride={wonDealsDeltas}
              tooltipLines={wonDealsTooltipLines}
              dashLast
            />
            <WeekLabels weeks={weeks} />
          </ChartCard>
          <ChartCard title="New ARR / Woche">
            <Sparkline data={newArrTrend} color="#94D825" weeks={weeks} tooltipOverride={newArrTooltip} tooltipExtra={newArrExtra} bars targetValue={newArrAvg} targetLabel={`Ø ${formatEUR(newArrAvg)}`} targetColor="#2C3333" />
            <WeekLabels weeks={weeks} />
          </ChartCard>
          <ChartCard title="Win Rate (Wochenkohorte)">
            <Sparkline data={winRateTrend} color="#E8AC68" unit="%" weeks={weeks} tooltipOverride={winRateTooltip} tooltipExtra={winRateExtra} targetValue={winRateAvg} targetLabel={`Ø ${winRateAvg} %`} targetColor="#2C3333" bars completionRate={winRateCompletion} />
            <WeekLabels weeks={weeks} />
          </ChartCard>
          <ChartCard title="Ø Sales Cycle (Wochenkohorte)">
            <Sparkline data={salesCycleTrend} color="#2F0D5B" unit="W" weeks={weeks} tooltipExtra={salesCycleExtra} bars completionRate={salesCycleCompletion} />
            <WeekLabels weeks={weeks} />
          </ChartCard>
          <ChartCard
            title="Leads / Woche"
            headerExtra={
              <select
                value={leadsChartGrouping}
                onChange={e => setLeadsChartGrouping(e.target.value as 'minutes' | 'source')}
                className="text-[11px] border border-[#e8e8e8] rounded px-2 py-0.5 bg-white text-[#2F0D5B] focus:outline-none focus:ring-1 focus:ring-[#2F0D5B]"
                title="Gruppierung"
              >
                <option value="minutes">nach Minuten</option>
                <option value="source">nach Source</option>
              </select>
            }
          >
            <Sparkline
              data={leadsPerWeekTrend}
              color="#2F0D5B"
              weeks={leadsWeeks}
              tooltipOverride={leadsPerWeekTooltip}
              tooltipLines={leadsPerWeekTooltipLines}
              targetValue={leadsPerWeekAvg}
              targetLabel={`Ø ${leadsPerWeekAvg}`}
              targetColor="#2C3333"
              bars
              stacks={leadsChartGrouping === 'source'
                ? leadsPerWeekSourceStacks.map(s => ({ values: s.values, color: s.color }))
                : [
                    { values: leadsPerWeekUnknown, color: '#B8BCC2' },
                    { values: leadsPerWeekSmall, color: '#2E9E8E' },
                    { values: leadsPerWeekMid, color: '#E8AC68' },
                    { values: leadsPerWeekLarge, color: '#2F0D5B' },
                  ]
              }
            />
            <WeekLabels weeks={leadsWeeks} />
            {leadsChartGrouping === 'source' ? (
              <div className="flex items-center gap-3 mt-2 text-[10px] flex-wrap">
                {leadsPerWeekSourceStacks.map(s => (
                  <span key={s.key} className="flex items-center gap-1" title={s.key}>
                    <span className="inline-block w-2 h-2 rounded-sm" style={{ background: s.color }} />
                    <span className="max-w-[140px] truncate text-gray-500">{s.key}</span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-3 mt-2 text-[10px] flex-wrap">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#2F0D5B' }} />
                  <span className="text-gray-500">≥ 2000 Min</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#E8AC68' }} />
                  <span className="text-gray-500">1000-2000 Min</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#2E9E8E' }} />
                  <span className="text-gray-500">&lt; 1000 Min</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#B8BCC2' }} />
                  <span className="text-gray-500">Unbekannt</span>
                </span>
              </div>
            )}
          </ChartCard>
        </div>
      </div>

      {/* Aktive Pipeline */}
      <div className="mb-9">
        <div className="font-medium text-[13px] uppercase tracking-[0.08em] text-[#2F0D5B] mb-4">Aktive Pipeline</div>
        <div className="bg-white border border-[#e8e8e8] rounded-lg p-6">
          {activeStages.map((item, idx) => {
            const maxActive = Math.max(...activeStages.map(f => f.count), 1);
            const widthPercent = Math.max((item.count / maxActive) * 100, 3);
            const convRate = stageConversionRates[item.stage.id];
            const t = activeStages.length > 1 ? idx / (activeStages.length - 1) : 0;
            const opacity = Math.round(100 - t * 60);
            const barColor = `color-mix(in srgb, #2F0D5B ${opacity}%, white)`;
            const prevStageId = idx > 0 ? activeStages[idx - 1].stage.id : null;
            const conv = stageConvCounts[item.stage.id];
            const convTooltip = convRate != null && conv
              ? `${conv.reached} von ${conv.fromPrev} Deals`
              : undefined;
            return (
              <div key={item.stage.id}>
                {convRate != null && (
                  <div className="flex items-center gap-2 py-1 pl-[132px] cursor-default relative group/conv">
                    <div className="text-[11px] text-[#2F0D5B] opacity-30">↓ Ø {convRate} %</div>
                    {convTooltip && (
                      <div className="absolute left-[132px] top-full mt-1 px-2 py-1 rounded bg-[#2C3333] text-white text-[11px] whitespace-nowrap shadow-lg opacity-0 group-hover/conv:opacity-100 pointer-events-none transition-opacity z-20">
                        {convTooltip}
                      </div>
                    )}
                  </div>
                )}
                <div className="grid items-center gap-3 py-2"
                  style={{ gridTemplateColumns: '120px 1fr 50px 60px' }}>
                  <div className="text-[13px]">{item.stage.label}</div>
                  <div className="h-7 bg-[#F9F9F9] rounded overflow-hidden relative">
                    <div className="h-full rounded" style={{ width: `${widthPercent}%`, backgroundColor: barColor }} />
                    {item.mrr > 0 && (
                      <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-[12px] font-medium" style={{ color: widthPercent > 20 ? '#fff' : '#2F0D5B' }}>
                        {formatEUR(item.mrr)}
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] font-medium text-right text-[#2F0D5B]">{item.count}</div>
                  <div className="text-[11px] text-right opacity-30">
                    {avgDaysInStage[item.stage.id] != null ? `Ø ${avgDaysInStage[item.stage.id]} d` : ''}
                  </div>
                </div>
              </div>
            );
          })}
          {(() => {
            const wonStageItem = pipelineFunnel.find(f => isWonStage(f.stage.label));
            const wonConv = wonStageItem ? stageConvCounts[wonStageItem.stage.id] : null;
            const winRate = wonConv && wonConv.fromPrev > 0 ? Math.round((wonConv.reached / wonConv.fromPrev) * 100) : null;
            const winTooltip = wonConv
              ? `${wonConv.reached} von ${wonConv.fromPrev} Deals`
              : undefined;
            return winRate != null ? (
              <div className="flex items-center gap-2 py-1 pl-[132px] cursor-default relative group/win">
                <div className="text-[11px] text-[#2F0D5B] opacity-30">↓ Ø {winRate} % Win Rate</div>
                {winTooltip && (
                  <div className="absolute left-[132px] top-full mt-1 px-2 py-1 rounded bg-[#2C3333] text-white text-[11px] whitespace-nowrap shadow-lg opacity-0 group-hover/win:opacity-100 pointer-events-none transition-opacity z-20">
                    {winTooltip}
                  </div>
                )}
              </div>
            ) : null;
          })()}
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
                    href={hubspotDealUrl(d.id)}
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

function ChartCard({ title, current, target, headerExtra, children }: {
  title: string; current?: string; target?: string; headerExtra?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-[#e8e8e8] rounded-lg p-6">
      <div className="flex justify-between items-baseline mb-4">
        <span className="text-[13px] font-medium text-[#2F0D5B]">{title}</span>
        {headerExtra ? (
          headerExtra
        ) : (current || target) ? (
          <span>
            {current && <span className="text-[13px] text-[#E8AC68] font-medium">{current}</span>}
            {target && <span className="text-[11px] opacity-40 ml-1">{target}</span>}
          </span>
        ) : null}
      </div>
      <div className="border-b border-[#F0F0F0]">{children}</div>
    </div>
  );
}
