// Date-Preset-Optionen für den Marketing-Tab. Werden sowohl vom Datums-
// Filter im UI verwendet (clientseitige Journey-Cohort-Filterung) als auch
// von der page.tsx-Query zum Server (für die BQ-Marketing-Reach-Window-Berechnung).

export type DatePresetKey = '30' | '90' | 'all';

export interface DatePresetOption {
  key: DatePresetKey;
  label: string;
  /** null = "alle seit HARD_FLOOR_DATE", sonst rolling N Tage. */
  days: number | null;
}

export const DATE_PRESETS: ReadonlyArray<DatePresetOption> = [
  { key: '30', label: '30 Tage', days: 30 },
  { key: '90', label: '90 Tage', days: 90 },
  { key: 'all', label: 'seit 01.02.2026', days: null },
];

// Hartes Floor-Datum: vor Mitte Februar 2026 wurde das Preview-Event
// (Contract Finalized) in Amplitude nicht getrackt — Daten davor sind
// unvollständig.
export const HARD_FLOOR_DATE_STRING = '2026-02-01T00:00:00.000Z';
export const HARD_FLOOR_DATE_MS = new Date(HARD_FLOOR_DATE_STRING).getTime();

/**
 * Anzahl Tage rückwärts ab heute für die BQ-Query-Window-Berechnung.
 * Bei "alle" wird der Abstand zum HARD_FLOOR_DATE genommen, sodass die
 * BQ-Window genau dem clientseitig sichtbaren Floor entspricht.
 */
export function getDaysForPreset(key: DatePresetKey): number {
  const preset = DATE_PRESETS.find(p => p.key === key);
  if (preset?.days != null) return preset.days;
  const diffMs = Date.now() - HARD_FLOOR_DATE_MS;
  return Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

export function canShowComparison(key: DatePresetKey): boolean {
  if (key === 'all') return false;
  const days = getDaysForPreset(key);
  const comparisonStartMs = Date.now() - days * 2 * 24 * 60 * 60 * 1000;
  return comparisonStartMs >= HARD_FLOOR_DATE_MS;
}
