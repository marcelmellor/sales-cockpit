// Generische Filter-Engine: Tree-Manipulation, Vollständigkeits-Check,
// Timestamp-Matching. Keine Entitäts-Logik — die matchCriterion-Funktion
// wird vom aufrufenden Modul (Deals / Leads) gestellt.

import type {
  FieldInputKind,
  FilterCriterion,
  FilterGroup,
  FilterLogic,
  FilterNode,
  FilterState,
  SavedFilterSet,
} from './types';
import type { FilterBadge } from './types';

export function makeId(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function makeCriterion<T extends string>(partial?: Partial<FilterCriterion<T>> & { type: T }): FilterCriterion<T> {
  return {
    kind: 'criterion',
    id: makeId(),
    operator: 'after',
    dateFrom: '',
    ...(partial ?? ({} as Partial<FilterCriterion<T>> & { type: T })),
  } as FilterCriterion<T>;
}

export function makeGroup<T extends string>(
  logic: FilterLogic,
  defaultType: T,
): FilterGroup<T> {
  return {
    kind: 'group',
    id: makeId(),
    logic,
    children: [
      makeCriterion<T>({ type: defaultType }),
      makeCriterion<T>({ type: defaultType }),
    ],
  };
}

export function getDefaultFilterState<T extends string>(): FilterState<T> {
  return { logic: 'AND', children: [] };
}

// Legacy-Formate (älteres DashboardView-Schema mit `criteria[]` ohne `kind`)
// möglichst verlustfrei in die neue Baumstruktur überführen.
export function migrateFilterState<T extends string>(
  raw: unknown,
  defaultType: T,
): FilterState<T> {
  if (!raw || typeof raw !== 'object') return getDefaultFilterState<T>();
  const obj = raw as Record<string, unknown>;

  if (Array.isArray(obj.children)) return obj as unknown as FilterState<T>;

  if (Array.isArray(obj.criteria)) {
    return {
      logic: (obj.logic as FilterLogic) ?? 'AND',
      children: (obj.criteria as Array<Record<string, unknown>>).map(c => ({
        ...c,
        kind: 'criterion' as const,
        id: (c.id as string) ?? makeId(),
        type: (c.type as T) ?? defaultType,
        operator: (c.operator as FilterCriterion<T>['operator']) ?? 'after',
        dateFrom: (c.dateFrom as string) ?? '',
      })) as FilterCriterion<T>[],
    };
  }

  return getDefaultFilterState<T>();
}

export function dateToMs(dateStr: string): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr + 'T00:00:00Z').getTime();
  return isNaN(t) ? null : t;
}

export function dateToMsEnd(dateStr: string): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr + 'T23:59:59.999Z').getTime();
  return isNaN(t) ? null : t;
}

export function matchTimestamp<T extends string>(
  ts: number,
  c: FilterCriterion<T>,
): boolean {
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

// Prüft, ob ein Kriterium eingabe-vollständig ist (sonst wird es beim Matchen
// übergangen, damit halb ausgefüllte Zeilen nicht die ganze Liste leeren).
export function criterionIsComplete<T extends string>(
  c: FilterCriterion<T>,
  inputKind: FieldInputKind,
): boolean {
  if (inputKind === 'number') {
    if (c.operator === 'between') return c.numberFrom != null && c.numberTo != null;
    return c.numberFrom != null;
  }
  if (inputKind === 'enum') return !!c.stringValue;
  if (inputKind === 'boolean') return c.booleanValue != null;
  if (inputKind === 'stageDate' && !c.stageId) return false;
  if (!c.dateFrom) return false;
  if (c.operator === 'between' && !c.dateTo) return false;
  return true;
}

// ── Tree-Navigation & -Mutation ──────────────────────────────────────────

/** Zähler für die kollabierte Filter-Zusammenfassung ("3 aktiv"). */
export function countActiveCriteria<T extends string>(
  children: FilterNode<T>[],
  getInputKind: (type: T) => FieldInputKind,
): number {
  let n = 0;
  for (const ch of children) {
    if (ch.kind === 'criterion' && criterionIsComplete(ch, getInputKind(ch.type))) n++;
    else if (ch.kind === 'group') n += countActiveCriteria(ch.children, getInputKind);
  }
  return n;
}

/** Liefert die früheste "after/between"-Untergrenze und späteste "before/between"-Obergrenze
 * aus dem Filterbaum — für Chart-Achsen, die den sichtbaren Zeitraum brauchen. */
export function getFilterDateRange<T extends string>(
  children: FilterNode<T>[],
  dateFieldTypes: T[],
  getInputKind: (type: T) => FieldInputKind,
): { from: Date | null; to: Date | null } {
  let fromMs: number | null = null;
  let toMs: number | null = null;

  for (const ch of children) {
    if (ch.kind === 'group') {
      const sub = getFilterDateRange(ch.children, dateFieldTypes, getInputKind);
      if (sub.from) {
        const t = sub.from.getTime();
        if (fromMs === null || t < fromMs) fromMs = t;
      }
      if (sub.to) {
        const t = sub.to.getTime();
        if (toMs === null || t > toMs) toMs = t;
      }
    } else if (
      dateFieldTypes.includes(ch.type) &&
      criterionIsComplete(ch, getInputKind(ch.type))
    ) {
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

/** Liefert true, wenn irgendwo im Baum mindestens ein Kriterium mit einem
 * der angegebenen Typen aktiv (vollständig) ist. */
export function hasCriterionOfTypes<T extends string>(
  children: FilterNode<T>[],
  types: T[],
  getInputKind: (type: T) => FieldInputKind,
): boolean {
  for (const ch of children) {
    if (
      ch.kind === 'criterion' &&
      types.includes(ch.type) &&
      criterionIsComplete(ch, getInputKind(ch.type))
    )
      return true;
    if (ch.kind === 'group' && hasCriterionOfTypes(ch.children, types, getInputKind)) return true;
  }
  return false;
}

// ── Generisches Matching: Baum rekursiv auswerten ────────────────────────

export function matchNode<TType extends string, TItem>(
  item: TItem,
  node: FilterNode<TType>,
  matchCriterion: (item: TItem, c: FilterCriterion<TType>) => boolean,
  getInputKind: (type: TType) => FieldInputKind,
): boolean {
  if (node.kind === 'criterion') {
    if (!criterionIsComplete(node, getInputKind(node.type))) return true;
    return matchCriterion(item, node);
  }
  const completeCh = node.children.filter(ch =>
    ch.kind === 'group' ? ch.children.length > 0 : criterionIsComplete(ch, getInputKind(ch.type)),
  );
  if (completeCh.length === 0) return true;
  if (node.logic === 'AND')
    return completeCh.every(ch => matchNode(item, ch, matchCriterion, getInputKind));
  return completeCh.some(ch => matchNode(item, ch, matchCriterion, getInputKind));
}

export function applyFilters<TType extends string, TItem>(
  items: TItem[],
  filter: FilterState<TType>,
  matchCriterion: (item: TItem, c: FilterCriterion<TType>) => boolean,
  getInputKind: (type: TType) => FieldInputKind,
): TItem[] {
  const completeCh = filter.children.filter(ch =>
    ch.kind === 'group' ? ch.children.length > 0 : criterionIsComplete(ch, getInputKind(ch.type)),
  );
  if (completeCh.length === 0) return items;
  return items.filter(item => {
    if (filter.logic === 'AND')
      return completeCh.every(ch => matchNode(item, ch, matchCriterion, getInputKind));
    return completeCh.some(ch => matchNode(item, ch, matchCriterion, getInputKind));
  });
}

// ── LocalStorage für gespeicherte Filter-Sets ────────────────────────────

export function loadFilterSets<T extends string>(storageKey: string): SavedFilterSet<T>[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveFilterSets<T extends string>(
  storageKey: string,
  sets: SavedFilterSet<T>[],
): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(sets));
  } catch {
    /* localStorage full / disabled */
  }
}

// ── Badges: aktive Badges mit manuellem Filterbaum AND-kombinieren ───────

/** Baut aus dem manuellen Filterbaum plus den aktiven Badges einen
 *  zusammengesetzten Effekt-Filter. Jeder Badge-Filter wird als eigene Gruppe
 *  an den Root AND-verknüpft — die interne Logik des Badges (AND/OR) bleibt
 *  erhalten. Der bisherige manuelle Baum wird ebenfalls in eine Gruppe
 *  verpackt, damit seine OR-Logik nicht vom äußeren AND zerdrückt wird. */
export function combineFilterWithBadges<T extends string>(
  base: FilterState<T>,
  badges: Array<FilterBadge<T>>,
): FilterState<T> {
  if (badges.length === 0) return base;
  const baseGroup: FilterGroup<T> = {
    kind: 'group',
    id: 'base',
    logic: base.logic,
    children: base.children,
  };

  // Badges ohne orGroup werden wie bisher jeweils als eigene AND-verknüpfte
  // Gruppe angehängt. Badges mit gleicher orGroup landen zusammen in einer
  // OR-Gruppe — für mutuell exklusive Dimensionen wie ICP-Tier, wo
  // Mehrfachauswahl "S1 oder S2" bedeuten soll.
  const singletonGroups: FilterGroup<T>[] = [];
  const orGroups = new Map<string, FilterGroup<T>[]>();
  for (const b of badges) {
    const badgeGroup: FilterGroup<T> = {
      kind: 'group',
      id: `badge:${b.id}`,
      logic: b.filter.logic,
      children: b.filter.children,
    };
    if (b.orGroup) {
      const arr = orGroups.get(b.orGroup) ?? [];
      arr.push(badgeGroup);
      orGroups.set(b.orGroup, arr);
    } else {
      singletonGroups.push(badgeGroup);
    }
  }

  const mergedOrGroups: FilterGroup<T>[] = Array.from(orGroups.entries()).map(
    ([key, groups]) =>
      groups.length === 1
        ? groups[0]
        : {
            kind: 'group',
            id: `badge-or:${key}`,
            logic: 'OR',
            children: groups,
          },
  );

  return {
    logic: 'AND',
    children: [baseGroup, ...singletonGroups, ...mergedOrGroups],
  };
}

export function loadActiveBadgeIds(storageKey: string): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

export function saveActiveBadgeIds(storageKey: string, ids: string[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(ids));
  } catch {
    /* localStorage full / disabled */
  }
}
