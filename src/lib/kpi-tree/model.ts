// Static KPI-tree model: node structure, goal sets and number formatting.
//
// This is the single source of truth for the KPI tree. Both the React view
// (`KpiTreeView.tsx`) and the MCP server (`/api/mcp`) import from here so the
// numbers an AI agent reads are computed by the exact same code that renders
// the tree on screen.

export type Team = 'growth' | 'onboarding' | 'sales';

export interface MetricNode {
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
  /** Muted context node — grayed out, not part of the core tree */
  muted?: boolean;
  /** Lower values are better (e.g. Sales Cycle, Onboarding-Zeit) */
  lowerIsBetter?: boolean;
  /** How to display the comparison delta pill:
   *  - 'delta' — arrow + absolute difference (↑ 40 €, ↓ 9)
   *  - 'vs'    — previous period's value (vs 33 %, vs 1,9)
   *  Default: 'delta' */
  deltaFormat?: 'delta' | 'vs';
  /** Suppress the comparison delta pill entirely */
  hideComparison?: boolean;
}

// ── Goal sets ───────────────────────────────────────────────────────────────
// Each goal set maps metric IDs to their target strings. The active set
// overrides the static `target` on MetricNode. User-editable target overrides
// still layer on top.

export type GoalSetKey = 'q2-2026' | 'q3-2026';

export interface GoalSet {
  key: GoalSetKey;
  label: string;
  targets: Record<string, string>;
  coreMetrics: string[];
  mutedMetrics: string[];
}

export const GOAL_SETS: GoalSet[] = [
  {
    key: 'q2-2026',
    label: 'Q2 2026',
    coreMetrics: ['mrr', 'leads', 'cycle'],
    mutedMetrics: ['activated', 'int', 'pb', 'aha', 'trials', 'signup', 'preview-pbx', 'preview-bestand', 'pbx-signups'],
    targets: {
      mrr: '4.000 €',
      arpa: '500 €',
      conversion: '20 %',
      cycle: 'verringern',
      onboarding: 'verringern',
      leads: '50',
    },
  },
  {
    key: 'q3-2026',
    label: 'Q3 2026',
    coreMetrics: ['mrr', 'leads', 'activated'],
    mutedMetrics: [],
    targets: {
      mrr: '20.000 €',
      arpa: '700 €',
      conversion: '25 %',
      cycle: 'verringern',
      onboarding: 'verringern',
      'contact-form': '10',
      trials: '80',
      signup: '30',
      'preview-pbx': '25',
      'preview-bestand': '25',
      activated: '10.000+',
    },
  },
];

export const DEFAULT_GOAL_SET_KEY: GoalSetKey = 'q2-2026';

// ── Static tree structure ────────────────────────────────────────────────────
// `fallback` is only used when live data is unavailable (loading, missing
// marketing data, etc.). Nodes marked `dynamic` get their value injected from
// props; nodes marked `computed` derive their value from other nodes.

export const METRICS: MetricNode[] = [
  // Spine (top → down)
  { id: 'mrr', label: 'Neuer MRR / Woche', fallback: '?', target: '20.000 €', computed: true, deltaFormat: 'delta', tooltip: 'Gesamt-MRR: 20k €' },
  { id: 'arpa', label: 'ARPA', fallback: '?', target: '700 €', parentIds: ['mrr'], dashed: true, dynamic: true, deltaFormat: 'delta' },
  { id: 'icp', label: 'Neue ICP-Kunden / Woche', fallback: '?', target: '?', parentIds: ['mrr'], dynamic: true, deltaFormat: 'vs', tooltip: '> 2.500 € / Monat' },
  { id: 'sales', label: 'Sales / Woche', fallback: '?', target: '?', parentIds: ['icp'], team: 'sales', dynamic: true, deltaFormat: 'vs' },
  { id: 'conversion', label: 'Win Rate', fallback: '?', target: '25 %', parentIds: ['sales'], team: 'sales', computed: true, deltaFormat: 'vs' },
  { id: 'cycle', label: 'Sales Cycle', fallback: '?', target: 'verringern', parentIds: ['conversion'], team: 'sales', dashed: true, dynamic: true, lowerIsBetter: true, deltaFormat: 'delta', tooltip: 'Ø Tage von Deal-Erstellung bis Abschluss (Won)' },
  { id: 'onboarding', label: 'Onboarding-Zeit', fallback: '30h', target: 'verringern', parentIds: ['conversion'], team: 'sales', dashed: true, lowerIsBetter: true, deltaFormat: 'delta', tooltip: 'Solution Consulting' },
  { id: 'deals', label: 'Deals / Woche', fallback: '?', target: '?', parentIds: ['conversion'], team: 'sales', dynamic: true, deltaFormat: 'delta' },
  // Left column: Leads
  { id: 'leads', label: 'Leads / Woche', fallback: '?', target: '?', parentIds: ['deals'], dynamic: true, deltaFormat: 'delta', tooltip: 'HubSpot-Leads mit ≥ 2.000 Min/Monat' },
  { id: 'contact-form', label: 'Contact Form (ICP) / Woche', fallback: '?', target: '10', parentIds: ['leads'], dynamic: true, deltaFormat: 'delta', tooltip: 'ICP-Leads via Contact Form (sipgate.de + sipgate.ai)' },
  { id: 'cf-de', label: 'sipgate.de', fallback: '?', target: '?', parentIds: ['contact-form'], dynamic: true, deltaFormat: 'vs' },
  { id: 'cf-ai', label: 'sipgate.ai', fallback: '?', target: '?', parentIds: ['contact-form'], dynamic: true, deltaFormat: 'vs' },
  { id: 'signup-leads', label: 'In-Product-Quali (ICP) / Woche', fallback: '?', target: '?', parentIds: ['leads', 'trials'], team: 'growth', dynamic: true, deltaFormat: 'vs', tooltip: 'Preview-Leads mit In-Product-Qualifizierung und ≥ 2.000 Min/Monat' },
  { id: 'pbx-leads', label: 'PBX-Onboarding-Quali (ICP) / Woche', fallback: '?', target: '?', parentIds: ['leads'], team: 'growth', dynamic: true, deltaFormat: 'vs', tooltip: 'PBX-Kunden mit Onboarding-Qualifizierung und ≥ 2.000 Min/Monat' },
  { id: 'sonstige-leads', label: 'Sonstige / Woche', fallback: '?', target: '?', parentIds: ['leads'], dynamic: true, hideComparison: true, tooltip: 'Leads ≥ 2.000 Min ohne BQ-Journey-Zuordnung' },
  { id: 'pbx-signups', label: 'PBX Signups / Woche', fallback: '?', target: '?', parentIds: ['pbx-leads'], dynamic: true, dashed: true, muted: true, deltaFormat: 'vs', tooltip: 'Alle PBX-Signups (Grundgesamtheit für Onboarding-Quali)' },
  // Right column: Committed path
  { id: 'activated', label: 'Aktive Agents', fallback: '?', target: '10.000+', parentIds: ['deals'], team: 'onboarding', dashed: true, deltaFormat: 'vs', tooltip: 'Bestand aktiver Agents: ≥ 1 Integration & ≥ 1 Playbook (Free + Paid). Speist ~30 % der Deals / Woche (Kontingent-/Upsell-Pfad). Noch keine Datenanbindung (Produkt-DB), daher Ist offen.' },
  { id: 'int', label: 'Neue Kunden mit 1+ Integration / Woche', fallback: '🚧', target: '20', parentIds: ['activated'], team: 'onboarding', deltaFormat: 'delta' },
  { id: 'pb', label: 'Neue Kunden mit 3+ Playbooks / Woche', fallback: '?', target: '20', parentIds: ['activated'], team: 'onboarding', dynamic: true, deltaFormat: 'delta', tooltip: 'Preview-Accounts, die danach ≥ 3 Playbooks erstellt haben' },
  { id: 'aha', label: 'Aha-Moment / Woche', fallback: '🚧', target: '30', parentIds: ['int', 'pb'], team: 'onboarding', deltaFormat: 'delta' },
  { id: 'trials', label: 'Agent Previews / Woche', fallback: '?', target: '80', parentIds: ['aha'], team: 'growth', dynamic: true, deltaFormat: 'delta' },
  { id: 'signup', label: 'Agent Signups / Woche', fallback: '?', target: '30', parentIds: ['trials'], team: 'growth', dynamic: true, deltaFormat: 'delta', tooltip: 'Paid Ads ab Juni 2026' },
  { id: 'preview-pbx', label: 'PBX Signup → Agent Preview / Woche', fallback: '?', target: '25', parentIds: ['trials', 'pbx-signups'], team: 'growth', dynamic: true, deltaFormat: 'delta', tooltip: 'PBX-Kunden, die eine Agent-Preview starten' },
  { id: 'preview-bestand', label: 'Bestandskunde → Agent Preview / Woche', fallback: '?', target: '25', parentIds: ['trials'], team: 'growth', dynamic: true, deltaFormat: 'delta', tooltip: 'Bestehende sipgate-Kunden ohne neuen Signup' },
];

export const TEAM_COLORS: Record<Team, string> = {
  sales: '#315DFF',
  growth: '#00BD82',
  onboarding: '#8642FE',
};

export const TEAM_LABELS: Record<Team, string> = {
  sales: 'Sales & SC',
  growth: 'Product Growth',
  onboarding: 'Onboarding',
};

// ── Number formatting helpers ────────────────────────────────────────────────

export function parseNum(txt: string): number {
  if (!txt || txt === '?' || txt === '—') return NaN;
  return parseFloat(txt.replace(/[.*€%]/g, '').replace(/\./g, '').replace(',', '.').trim());
}

/** Intelligente Rundung: je größer die Zahl, desto gröber.
 *  < 1      → 2 Nachkommastellen  (0,25)
 *  1–< 5    → 1 Nachkommastelle   (3,2)
 *  5–< 100  → ganze Zahl          (7, 42)
 *  100–1000 → auf 5er             (435)
 *  ≥ 1000   → auf 10er            (1.230) */
export function smartRound(n: number): number {
  const abs = Math.abs(n);
  if (abs < 1) return Math.round(n * 100) / 100;
  if (abs < 5) return Math.round(n * 10) / 10;
  if (abs < 100) return Math.round(n);
  if (abs < 1000) return Math.round(n / 5) * 5;
  return Math.round(n / 10) * 10;
}

export function fmtNum(n: number): string {
  if (isNaN(n)) return '?';
  const rounded = smartRound(n);
  const decimals = Math.abs(rounded) < 1 ? 2 : Math.abs(rounded) < 5 ? 1 : 0;
  return rounded.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtTarget(n: number): string {
  if (isNaN(n)) return '?';
  const abs = Math.abs(n);
  const rounded = abs < 5 ? Math.round(n) : Math.round(n / 5) * 5;
  return rounded.toLocaleString('de-DE', { maximumFractionDigits: 0 });
}

export function fmtEur(n: number): string {
  if (isNaN(n)) return '?';
  const rounded = smartRound(n);
  return rounded.toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' €';
}
