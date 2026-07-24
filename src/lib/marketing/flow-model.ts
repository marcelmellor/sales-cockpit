// Klassifikationsmodell des Marketing-Flows (Sankey). Geteilt zwischen
// `MarketingSankey.tsx` (5-Spalten-Sankey) und `MarketingConversionOverTime.tsx`
// (Wochen-/Monats-Conversion zwischen zwei Flow-Punkten), damit Kategorien,
// Reihenfolgen, Farben und die Journey-Klassifizierung nur an EINER Stelle
// definiert sind. Beide Views lesen dieselben Werte.

import type { MarketingFunnelJourney } from '@/lib/marketing/funnel-types';
import type { Touchpoint, TouchpointAnchor } from '@/lib/amplitude/journeys';

// ── Spalten-Kategorien ──────────────────────────────────────────────────
export type Col1 = 'agent_signup' | 'pbx_signup' | 'contact_form' | 'bestandskunde' | 'andere';
export type ColPreview = 'preview_yes' | 'preview_no';
export type Col2 = 'inproduct' | 'onboarding' | 'andere';
export type Col3 = 'lead_gte_2500' | 'lead_lt_2500' | 'lead_unknown_min' | 'no_lead';
export type Col4 = 'deal_gte_450' | 'deal_lt_450' | 'deal_unknown_mrr' | 'no_deal';

export interface DealCategory {
  col1: Col1;
  colPreview: ColPreview;
  col2: Col2;
  col3: Col3;
  col4: Col4;
}

// Klassifiziert eine Journey in jede der fünf Spalten. Identische Logik wie
// zuvor inline im Sankey — earliest-wins bei Signup/Quali, Bucket-Grenzen aus
// minuteBucket/mrrBucket.
export function categorize(j: MarketingFunnelJourney): DealCategory {
  const tps = j.touchpoints;
  const earliestSignup = tps.find(
    (t: Touchpoint) =>
      t.anchor === 'signup_atlantis_frontdesk' || t.anchor === 'signup_atlantis_other_product',
  );
  const hasContactForm = tps.some((t: Touchpoint) => t.anchor === 'lead_form_submitted');
  const col1: Col1 =
    earliestSignup?.anchor === 'signup_atlantis_frontdesk'
      ? 'agent_signup'
      : earliestSignup?.anchor === 'signup_atlantis_other_product'
        ? 'pbx_signup'
        : j.customerSince
          ? 'bestandskunde'
          : hasContactForm
            ? 'contact_form'
            : 'andere';

  const colPreview: ColPreview = tps.some(
    (t: Touchpoint) => t.anchor === 'preview_trial_started',
  )
    ? 'preview_yes'
    : 'preview_no';

  const earliestQuali = tps.find(
    (t: Touchpoint) =>
      t.anchor === 'agents_qualification_onboarding' || t.anchor === 'agents_qualification_inproduct',
  );
  const col2: Col2 =
    earliestQuali?.anchor === 'agents_qualification_onboarding'
      ? 'onboarding'
      : earliestQuali?.anchor === 'agents_qualification_inproduct'
        ? 'inproduct'
        : 'andere';

  const col3: Col3 = !j.hasLead
    ? 'no_lead'
    : j.minuteBucket === 'lt_threshold'
      ? 'lead_lt_2500'
      : j.minuteBucket === 'gte_threshold'
        ? 'lead_gte_2500'
        : 'lead_unknown_min';
  const col4: Col4 = !j.hasDeal
    ? 'no_deal'
    : j.mrrBucket === 'gte_threshold'
      ? 'deal_gte_450'
      : j.mrrBucket === 'lt_threshold'
        ? 'deal_lt_450'
        : 'deal_unknown_mrr';

  return { col1, colPreview, col2, col3, col4 };
}

// ── Meta (Label + Farbe) pro Kategorie ──────────────────────────────────
export const COL1_META: Record<Col1, { label: string; color: string }> = {
  agent_signup: { label: 'Agent Signup', color: '#10b981' },
  pbx_signup: { label: 'PBX Signup', color: '#6366f1' },
  contact_form: { label: 'Contact Form', color: '#f59e0b' },
  bestandskunde: { label: 'Bestandskunde', color: '#94a3b8' },
  andere: { label: 'andere', color: '#cbd5e1' },
};
export const COL_PREVIEW_META: Record<ColPreview, { label: string; color: string }> = {
  preview_yes: { label: 'Preview gestartet', color: '#06b6d4' },
  preview_no: { label: 'keine Preview', color: '#d1d5db' },
};
export const COL2_META: Record<Col2, { label: string; color: string }> = {
  inproduct: { label: 'In-Product-Quali', color: '#f97316' },
  onboarding: { label: 'Onboarding-Quali', color: '#8b5cf6' },
  andere: { label: 'keine Quali', color: '#a3a3a3' },
};
export const COL3_META: Record<Col3, { label: string; color: string }> = {
  lead_gte_2500: { label: 'Lead ≥ 2.500 Min', color: '#2563eb' },
  lead_lt_2500: { label: 'Lead < 2.500 Min', color: '#7dd3fc' },
  lead_unknown_min: { label: 'Lead (Min unbekannt)', color: '#f472b6' },
  no_lead: { label: 'kein Lead', color: '#c4b5fd' },
};
export const COL4_META: Record<Col4, { label: string; color: string }> = {
  deal_gte_450: { label: 'Deal ≥ 450 € MRR', color: '#059669' },
  deal_lt_450: { label: 'Deal < 450 € MRR', color: '#0891b2' },
  deal_unknown_mrr: { label: 'Deal (MRR unbekannt)', color: '#d97706' },
  no_deal: { label: 'kein Deal', color: '#cbd5e1' },
};

export const COL1_ORDER: Col1[] = ['agent_signup', 'pbx_signup', 'contact_form', 'bestandskunde', 'andere'];
export const COL_PREVIEW_ORDER: ColPreview[] = ['preview_yes', 'preview_no'];
export const COL2_ORDER: Col2[] = ['onboarding', 'inproduct', 'andere'];
export const COL3_ORDER: Col3[] = ['lead_gte_2500', 'lead_lt_2500', 'lead_unknown_min', 'no_lead'];
export const COL4_ORDER: Col4[] = ['deal_gte_450', 'deal_lt_450', 'deal_unknown_mrr', 'no_deal'];

export type ColumnKey = 'col1' | 'colPreview' | 'col2' | 'col3' | 'col4';

// Spalten-Metadaten — Reihenfolge + Header-Label. Benutzt von Sankey-Layout,
// Spalten-Toggle und der Node-Auswahl in der Zeitverlauf-View.
export const COLUMN_REGISTRY: ReadonlyArray<{ key: ColumnKey; label: string }> = [
  { key: 'col1', label: 'Einstieg' },
  { key: 'colPreview', label: 'Agent Preview (Trial)' },
  { key: 'col2', label: 'Qualifizierung' },
  { key: 'col3', label: 'HubSpot Lead' },
  { key: 'col4', label: 'HubSpot Deal' },
];

// ── Node-Modell für die Zeitverlauf-View ────────────────────────────────
// Ein "Flow-Punkt" ist genau eine Kategorie in genau einer Spalte. Für die
// Wochen-Conversion braucht jeder wählbare Quell-Punkt ein Anker-Datum: den
// Zeitpunkt des Events, das die Journey in diese Kategorie einordnet (echte
// Kohorten-Analyse). Negative Kategorien (keine Preview, kein Lead, …) haben
// kein Event und können daher nur Ziel, nicht Quelle sein.

export interface FlowNode {
  id: string;         // `${col}:${category}`
  col: ColumnKey;
  colIndex: number;   // Position in COLUMN_REGISTRY (0..4)
  category: string;
  label: string;
  color: string;
  /** Anker-Datum der Journey für diesen Node (Datum des einordnenden Events),
   *  oder null wenn nicht vorhanden / für diesen Node nicht definiert. */
  anchorDate: (j: MarketingFunnelJourney) => Date | null;
  /** true wenn der Node als Quell-Kohorte taugt (hat ein Anker-Event). */
  sourceable: boolean;
}

function earliestAnchorDate(j: MarketingFunnelJourney, anchor: TouchpointAnchor): Date | null {
  let minMs: number | null = null;
  for (const t of j.touchpoints) {
    if (t.anchor !== anchor) continue;
    const ms = new Date(t.occurredAt).getTime();
    if (Number.isFinite(ms) && (minMs === null || ms < minMs)) minMs = ms;
  }
  return minMs === null ? null : new Date(minMs);
}

// Resolver für das Anker-Datum je Node. Fehlt ein Node hier, ist er nicht
// sourceable (kein Kohorten-Startpunkt).
const ANCHOR_RESOLVERS: Record<string, (j: MarketingFunnelJourney) => Date | null> = {
  'col1:agent_signup': j => earliestAnchorDate(j, 'signup_atlantis_frontdesk'),
  'col1:pbx_signup': j => earliestAnchorDate(j, 'signup_atlantis_other_product'),
  'col1:contact_form': j => earliestAnchorDate(j, 'lead_form_submitted'),
  'col1:bestandskunde': j => {
    if (j.customerSince) {
      const ms = new Date(j.customerSince).getTime();
      if (Number.isFinite(ms)) return new Date(ms);
    }
    return earliestAnchorDate(j, 'customer_since');
  },
  'colPreview:preview_yes': j => earliestAnchorDate(j, 'preview_trial_started'),
  'col2:onboarding': j => earliestAnchorDate(j, 'agents_qualification_onboarding'),
  'col2:inproduct': j => earliestAnchorDate(j, 'agents_qualification_inproduct'),
  'col3:lead_gte_2500': j => earliestAnchorDate(j, 'hubspot_lead_created'),
  'col3:lead_lt_2500': j => earliestAnchorDate(j, 'hubspot_lead_created'),
  'col3:lead_unknown_min': j => earliestAnchorDate(j, 'hubspot_lead_created'),
  'col4:deal_gte_450': j => earliestAnchorDate(j, 'hubspot_deal_created'),
  'col4:deal_lt_450': j => earliestAnchorDate(j, 'hubspot_deal_created'),
  'col4:deal_unknown_mrr': j => earliestAnchorDate(j, 'hubspot_deal_created'),
};

const COL_META_BY_KEY: Record<ColumnKey, { order: readonly string[]; meta: Record<string, { label: string; color: string }> }> = {
  col1: { order: COL1_ORDER, meta: COL1_META as Record<string, { label: string; color: string }> },
  colPreview: { order: COL_PREVIEW_ORDER, meta: COL_PREVIEW_META as Record<string, { label: string; color: string }> },
  col2: { order: COL2_ORDER, meta: COL2_META as Record<string, { label: string; color: string }> },
  col3: { order: COL3_ORDER, meta: COL3_META as Record<string, { label: string; color: string }> },
  col4: { order: COL4_ORDER, meta: COL4_META as Record<string, { label: string; color: string }> },
};

// Flache, geordnete Liste aller Flow-Nodes (alle Spalten × Kategorien).
export const FLOW_NODES: FlowNode[] = COLUMN_REGISTRY.flatMap((col, colIndex) => {
  const { order, meta } = COL_META_BY_KEY[col.key];
  return order.map(category => {
    const id = `${col.key}:${category}`;
    const resolver = ANCHOR_RESOLVERS[id];
    return {
      id,
      col: col.key,
      colIndex,
      category,
      label: meta[category].label,
      color: meta[category].color,
      anchorDate: resolver ?? (() => null),
      sourceable: Boolean(resolver),
    };
  });
});

export const FLOW_NODE_BY_ID = new Map<string, FlowNode>(FLOW_NODES.map(n => [n.id, n]));

// Category-Wert einer Journey in einer bestimmten Spalte.
export function categoryOf(cat: DealCategory, col: ColumnKey): string {
  return cat[col];
}
