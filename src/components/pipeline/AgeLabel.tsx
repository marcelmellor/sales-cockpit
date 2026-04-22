// Einheitliche Alters-/Standzeit-Anzeige für Deals und Leads.
// Ersetzt die frühere Tomaten-Logik (fresh/half-fresh/rotten SVGs).
//
// Smarte Textformatierung:
//   < 2 Tage    → "Neu"
//   2–13 Tage   → "X Tage"
//   14–59 Tage  → "X Wochen" (gerundet)
//   ≥ 60 Tage   → "X Monate" (gerundet)
//
// Die Farbstufen folgen den bisherigen Schwellen (≤ 14 frisch, ≤ 45 mittel,
// sonst alt), damit auf einen Blick trotzdem der "Freshness"-Eindruck bleibt.

export function formatAgeLabel(days: number): string {
  if (days < 0) return '';
  if (days < 2) return 'Neu';
  if (days < 14) return `${days} Tage`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `${weeks} Wochen`;
  }
  const months = Math.round(days / 30);
  return `${months} Monate`;
}

function getAgeTone(days: number): { text: string; bg: string } {
  if (days < 2) return { text: 'text-blue-700', bg: 'bg-blue-50' };
  if (days <= 14) return { text: 'text-emerald-700', bg: 'bg-emerald-50' };
  if (days <= 45) return { text: 'text-amber-700', bg: 'bg-amber-50' };
  return { text: 'text-rose-700', bg: 'bg-rose-50' };
}

interface AgeLabelProps {
  days: number;
  /** Erklärender Tooltip (z.B. "3 Tage in Stage" vs. "12 Tage Lead-Alter"). */
  title?: string;
}

export function AgeLabel({ days, title }: AgeLabelProps) {
  if (days < 0) return null;
  const label = formatAgeLabel(days);
  const tone = getAgeTone(days);
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full tabular-nums ${tone.bg} ${tone.text}`}
      title={title}
    >
      {label}
    </span>
  );
}
