// Deal-spezifische Feld-Konfiguration + Match-Logik für den generischen
// FilterBuilder. Deckt die vier Dashboard-Kriterien ab:
//   - createdate         (Erstelldatum, Datum)
//   - stage_reached      (Stage + Datum — braucht stageHistory)
//   - agents_minuten     (Zahl)
//   - mrr                (Zahl)

import type { DealOverviewItem } from '@/app/api/deals/overview/route';
import type { DealStageHistoryMap } from '@/app/api/deals/overview/stage-history/route';
import type { FieldConfig, FieldInputKind, FilterCriterion, FilterNode } from './types';
import {
  applyFilters as applyFiltersGeneric,
  criterionIsComplete,
  hasCriterionOfTypes,
  matchTimestamp,
} from './engine';

export type DealFieldType =
  | 'createdate'
  | 'stage_reached'
  | 'agents_minuten'
  | 'mrr'
  | 'status'
  | 'icp_tier';

export const DEAL_DEFAULT_FIELD: DealFieldType = 'createdate';

// Abgeschlossen = Closed Won / Closed Lost / ähnliche Endzustände. Keyword-
// basiert, weil Pipelines bei sipgate unterschiedlich benannt sind.
const CLOSED_STAGE_KEYWORDS = [
  'closed won',
  'closed lost',
  'closedwon',
  'closedlost',
  'verloren',
  'lost',
  'gewonnen',
  'won',
  'abgesagt',
  'cancelled',
  'storniert',
];

export function isDealClosed(stageLabel: string | null | undefined): boolean {
  if (!stageLabel) return false;
  const s = stageLabel.toLowerCase();
  return CLOSED_STAGE_KEYWORDS.some(kw => s.includes(kw));
}

export function buildDealFieldConfigs(
  stages: Array<{ id: string; label: string }>,
): FieldConfig<DealFieldType>[] {
  return [
    {
      type: 'createdate',
      label: 'Erstelldatum',
      inputKind: 'date',
    },
    {
      type: 'stage_reached',
      label: 'Stage erreicht',
      inputKind: 'stageDate',
      stages,
    },
    {
      type: 'agents_minuten',
      label: 'Agent-Minuten',
      inputKind: 'number',
      numberPlaceholderFrom: 'Min',
      numberPlaceholderTo: 'Max',
      numberUnit: 'Min.',
    },
    {
      type: 'mrr',
      label: 'MRR (€/Monat)',
      inputKind: 'number',
      numberPlaceholderFrom: '€',
      numberPlaceholderTo: '€',
      numberUnit: '€/Mo',
    },
    {
      type: 'status',
      label: 'Status',
      inputKind: 'enum',
      enumOptions: [
        { value: 'open', label: 'Offen' },
        { value: 'closed', label: 'Abgeschlossen' },
      ],
    },
    {
      type: 'icp_tier',
      label: 'ICP Tier',
      inputKind: 'enum',
      enumOptions: [
        { value: 'S1', label: 'S1' },
        { value: 'S2', label: 'S2' },
        { value: 'S3', label: 'S3' },
        { value: 'S4', label: 'S4' },
      ],
    },
  ];
}

export function getDealInputKind(type: DealFieldType): FieldInputKind {
  switch (type) {
    case 'createdate':
      return 'date';
    case 'stage_reached':
      return 'stageDate';
    case 'agents_minuten':
    case 'mrr':
      return 'number';
    case 'status':
    case 'icp_tier':
      return 'enum';
  }
}

function getDealCreateTimestamp(deal: DealOverviewItem): number | null {
  if (deal.createdate) {
    const t = new Date(deal.createdate).getTime();
    if (!isNaN(t)) return t;
  }
  if (deal.dealAge > 0) return Date.now() - deal.dealAge * 86_400_000;
  return null;
}

function matchDealCriterion(
  deal: DealOverviewItem,
  c: FilterCriterion<DealFieldType>,
  stageHistory: DealStageHistoryMap,
  stageHistoryLoading: boolean,
): boolean {
  if (!criterionIsComplete(c, getDealInputKind(c.type))) return true;

  if (c.type === 'agents_minuten' || c.type === 'mrr') {
    const val = c.type === 'mrr' ? Math.round(deal.revenue) : deal.agentsMinuten;
    if (c.operator === 'after') return val >= (c.numberFrom ?? 0);
    if (c.operator === 'before') return val <= (c.numberFrom ?? Infinity);
    return val >= (c.numberFrom ?? 0) && val <= (c.numberTo ?? Infinity);
  }

  if (c.type === 'status') {
    const closed = isDealClosed(deal.dealStage);
    return c.stringValue === 'closed' ? closed : !closed;
  }

  if (c.type === 'icp_tier') {
    return deal.icpTier === c.stringValue;
  }

  if (c.type === 'createdate') {
    const created = getDealCreateTimestamp(deal);
    if (created === null) return false;
    return matchTimestamp(created, c);
  }

  // stage_reached — Stage-Historie auswerten
  if (stageHistoryLoading) return true;
  const entry = stageHistory[deal.id];
  if (!entry?.history) return false;

  const historyMatch = entry.history.some(h => {
    if (h.stageId !== c.stageId) return false;
    const ts = new Date(h.timestamp).getTime();
    if (isNaN(ts)) return false;
    return matchTimestamp(ts, c);
  });
  if (historyMatch) return true;

  // Fallback: Deals, die direkt in einer Closed-Stage erstellt wurden, haben
  // in der Historie oft nur den Import-Zeitpunkt — closedate ist dann präziser.
  if (deal.dealStageId === c.stageId && deal.closedate) {
    const closeTs = new Date(deal.closedate).getTime();
    if (!isNaN(closeTs)) return matchTimestamp(closeTs, c);
  }
  return false;
}

export function applyDealFilters(
  deals: DealOverviewItem[],
  filter: { logic: 'AND' | 'OR'; children: FilterNode<DealFieldType>[] },
  stageHistory: DealStageHistoryMap,
  stageHistoryLoading: boolean,
): DealOverviewItem[] {
  return applyFiltersGeneric<DealFieldType, DealOverviewItem>(
    deals,
    filter,
    (d, c) => matchDealCriterion(d, c, stageHistory, stageHistoryLoading),
    getDealInputKind,
  );
}

export function hasStageReachedInDealTree(children: FilterNode<DealFieldType>[]): boolean {
  return hasCriterionOfTypes<DealFieldType>(children, ['stage_reached'], getDealInputKind);
}

export const DEAL_DATE_FIELD_TYPES: DealFieldType[] = ['createdate', 'stage_reached'];
