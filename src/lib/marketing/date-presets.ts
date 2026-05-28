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
  { key: 'all', label: 'seit 01.01.2026', days: null },
];

// Hartes Floor-Datum: davor existierte die AI-Agents-Lead-Pipeline in HubSpot
// quasi nicht (vereinzelte Test-Entries). Wird auf alle Date-Filter
// angewendet — auch "Alle" geht nie weiter zurück.
export const HARD_FLOOR_DATE_STRING = '2026-01-01T00:00:00.000Z';
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
