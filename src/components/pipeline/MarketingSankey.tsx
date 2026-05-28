'use client';

import { useMemo } from 'react';
import type { MarketingFunnelJourney } from '@/lib/marketing/funnel-types';
import type { Touchpoint } from '@/lib/amplitude/journeys';

// 5-column Sankey-flow visualisation der AI-Agents-Marketing-Deals.
// Klassifiziert jeden Deal nach Activation / Preview / Quali / Lead / Outcome
// und rendert die Pfad-Flüsse als kurvige SVG-Bänder. Pure SVG ohne D3 — bei
// ~75 Deals × 14 Kategorien lohnt sich keine Lib.

type Col1 = 'agent_signup' | 'pbx_signup' | 'bestandskunde' | 'andere';
type ColPreview = 'preview_yes' | 'preview_no';
type Col2 = 'inproduct' | 'onboarding' | 'andere';
type Col3 = 'lead_gte_2500' | 'lead_lt_2500' | 'lead_unknown_min' | 'no_lead';
type Col4 = 'deal_gte_450' | 'deal_lt_450' | 'deal_unknown_mrr' | 'no_deal';

interface DealCategory {
  col1: Col1;
  colPreview: ColPreview;
  col2: Col2;
  col3: Col3;
  col4: Col4;
}

function categorize(j: MarketingFunnelJourney): DealCategory {
  const tps = j.touchpoints;
  // chronologically earliest signup wins (Agent vs PBX). Fallback chain:
  // signup → Bestandskunde (sipgate-Account vor unserem Tracking) → andere.
  const earliestSignup = tps.find(
    (t: Touchpoint) =>
      t.anchor === 'signup_atlantis_frontdesk' || t.anchor === 'signup_atlantis_other_product',
  );
  const col1: Col1 =
    earliestSignup?.anchor === 'signup_atlantis_frontdesk'
      ? 'agent_signup'
      : earliestSignup?.anchor === 'signup_atlantis_other_product'
        ? 'pbx_signup'
        : j.customerSince
          ? 'bestandskunde'
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

const COL1_META: Record<Col1, { label: string; color: string }> = {
  agent_signup: { label: 'Agent Signup', color: '#10b981' },
  pbx_signup: { label: 'PBX Signup', color: '#6366f1' },
  bestandskunde: { label: 'Bestandskunde', color: '#94a3b8' },
  andere: { label: 'andere', color: '#cbd5e1' },
};
const COL_PREVIEW_META: Record<ColPreview, { label: string; color: string }> = {
  preview_yes: { label: 'Preview gestartet', color: '#06b6d4' },
  preview_no: { label: 'keine Preview', color: '#cbd5e1' },
};
const COL2_META: Record<Col2, { label: string; color: string }> = {
  inproduct: { label: 'In-Product-Quali', color: '#f97316' },
  onboarding: { label: 'Onboarding-Quali', color: '#8b5cf6' },
  andere: { label: 'keine Quali', color: '#cbd5e1' },
};
const COL3_META: Record<Col3, { label: string; color: string }> = {
  lead_gte_2500: { label: 'Lead ≥ 2.500 Min', color: '#7c3aed' },
  lead_lt_2500: { label: 'Lead < 2.500 Min', color: '#3b82f6' },
  lead_unknown_min: { label: 'Lead (Min unbekannt)', color: '#f472b6' },
  no_lead: { label: 'kein Lead', color: '#cbd5e1' },
};
const COL4_META: Record<Col4, { label: string; color: string }> = {
  deal_gte_450: { label: 'Deal ≥ 450 € MRR', color: '#059669' },
  deal_lt_450: { label: 'Deal < 450 € MRR', color: '#0891b2' },
  deal_unknown_mrr: { label: 'Deal (MRR unbekannt)', color: '#d97706' },
  no_deal: { label: 'kein Deal', color: '#cbd5e1' },
};

const COL1_ORDER: Col1[] = ['agent_signup', 'pbx_signup', 'bestandskunde', 'andere'];
const COL_PREVIEW_ORDER: ColPreview[] = ['preview_yes', 'preview_no'];
const COL2_ORDER: Col2[] = ['onboarding', 'inproduct', 'andere'];
const COL3_ORDER: Col3[] = ['lead_gte_2500', 'lead_lt_2500', 'lead_unknown_min', 'no_lead'];
const COL4_ORDER: Col4[] = ['deal_gte_450', 'deal_lt_450', 'deal_unknown_mrr', 'no_deal'];

export type ColumnKey = 'col1' | 'colPreview' | 'col2' | 'col3' | 'col4';

// Spalten-Metadaten — wird sowohl von der Sankey-Layout-Funktion als auch
// vom MarketingView (Toolbar) benutzt, damit die Reihenfolge konsistent bleibt.
export const COLUMN_REGISTRY: ReadonlyArray<{
  key: ColumnKey;
  label: string;
}> = [
  { key: 'col1', label: 'Signup' },
  { key: 'colPreview', label: 'Agent Preview (Trial)' },
  { key: 'col2', label: 'Qualifizierung' },
  { key: 'col3', label: 'HubSpot Lead' },
  { key: 'col4', label: 'HubSpot Deal' },
];

interface NodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  count: number;
  color: string;
}

interface FlowLink {
  source: NodeBox;
  target: NodeBox;
  count: number;
  sourceY: number; // top of band at source side
  targetY: number; // top of band at target side
  thickness: number;
}

type ColDef = {
  key: ColumnKey;
  order: readonly string[];
  meta: Record<string, { label: string; color: string }>;
  getKey: (c: DealCategory) => string;
  idx: number;
};

// Sankey layout: stack node-boxes per column, then route bands between
// adjacent columns by tracking how much of each node's height has been
// "consumed" by outgoing/incoming bands.
function layout(
  cats: DealCategory[],
  visibleColumns: readonly ColumnKey[],
  width: number,
  height: number,
): { nodes: NodeBox[]; links: FlowLink[] } {
  const PADDING = 8;
  const NODE_WIDTH = 12;

  const total = cats.length;
  if (total === 0) return { nodes: [], links: [] };

  // Full registry → filter by visibility + re-index with consecutive idx.
  const ALL_COLS: ColDef[] = [
    { key: 'col1', order: COL1_ORDER, meta: COL1_META as Record<string, { label: string; color: string }>, getKey: c => c.col1, idx: 0 },
    { key: 'colPreview', order: COL_PREVIEW_ORDER, meta: COL_PREVIEW_META as Record<string, { label: string; color: string }>, getKey: c => c.colPreview, idx: 0 },
    { key: 'col2', order: COL2_ORDER, meta: COL2_META as Record<string, { label: string; color: string }>, getKey: c => c.col2, idx: 0 },
    { key: 'col3', order: COL3_ORDER, meta: COL3_META as Record<string, { label: string; color: string }>, getKey: c => c.col3, idx: 0 },
    { key: 'col4', order: COL4_ORDER, meta: COL4_META as Record<string, { label: string; color: string }>, getKey: c => c.col4, idx: 0 },
  ];
  const colDefs: ColDef[] = visibleColumns
    .map(k => ALL_COLS.find(c => c.key === k))
    .filter((c): c is ColDef => c !== undefined)
    .map((c, i) => ({ ...c, idx: i }));
  if (colDefs.length === 0) return { nodes: [], links: [] };

  const COLUMNS = colDefs.length;
  const COL_GAP =
    COLUMNS > 1 ? (width - COLUMNS * NODE_WIDTH) / (COLUMNS - 1) : 0;

  const nodes: NodeBox[] = [];
  const nodesByColAndKey = new Map<string, NodeBox>();

  for (const def of colDefs) {
    const counts = new Map<string, number>();
    for (const c of cats) {
      const k = def.getKey(c) as string;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const visible = def.order.filter(k => (counts.get(k as string) ?? 0) > 0);
    const colTotal = total; // == sum of all
    const availableHeight = height - PADDING * Math.max(0, visible.length - 1);
    let y = 0;
    for (const key of visible) {
      const count = counts.get(key as string) ?? 0;
      const h = (count / colTotal) * availableHeight;
      const node: NodeBox = {
        id: `c${def.idx}:${key}`,
        x: def.idx * (NODE_WIDTH + COL_GAP),
        y,
        width: NODE_WIDTH,
        height: h,
        label: (def.meta as Record<string, { label: string; color: string }>)[key as string].label,
        count,
        color: (def.meta as Record<string, { label: string; color: string }>)[key as string].color,
      };
      nodes.push(node);
      nodesByColAndKey.set(node.id, node);
      y += h + PADDING;
    }
  }

  // Build links between adjacent columns.
  const links: FlowLink[] = [];
  for (let colIdx = 0; colIdx < colDefs.length - 1; colIdx++) {
    const fromDef = colDefs[colIdx];
    const toDef = colDefs[colIdx + 1];
    // Count deals per (from-key, to-key).
    const pairCounts = new Map<string, number>();
    for (const c of cats) {
      const fk = (fromDef.getKey(c) as string);
      const tk = (toDef.getKey(c) as string);
      const key = `${fk}|${tk}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
    // Track running consumed-height per source and per target so we stack
    // links inside each node.
    const srcOffset = new Map<string, number>();
    const tgtOffset = new Map<string, number>();
    // Iterate in column-order so the resulting sankey has minimal crossings.
    for (const sKey of fromDef.order) {
      for (const tKey of toDef.order) {
        const count = pairCounts.get(`${sKey}|${tKey}`) ?? 0;
        if (count === 0) continue;
        const source = nodesByColAndKey.get(`c${fromDef.idx}:${sKey}`);
        const target = nodesByColAndKey.get(`c${toDef.idx}:${tKey}`);
        if (!source || !target) continue;
        const thickness = (count / total) * (height - PADDING * Math.max(0, fromDef.order.length - 1));
        const sOff = srcOffset.get(source.id) ?? 0;
        const tOff = tgtOffset.get(target.id) ?? 0;
        links.push({
          source,
          target,
          count,
          sourceY: source.y + sOff,
          targetY: target.y + tOff,
          thickness,
        });
        srcOffset.set(source.id, sOff + thickness);
        tgtOffset.set(target.id, tOff + thickness);
      }
    }
  }

  return { nodes, links };
}

interface Props {
  journeys: MarketingFunnelJourney[];
  marketingTouchTotal: number; // global Amplitude-pool size (top-of-funnel)
  signupTotal: number;         // Signup-stage des Funnels = Agent + PBX Signup
  visibleColumns: readonly ColumnKey[];
  onToggleColumn: (key: ColumnKey) => void;
}

export function MarketingSankey({
  journeys,
  marketingTouchTotal,
  signupTotal,
  visibleColumns,
  onToggleColumn,
}: Props) {
  const cats = useMemo(() => journeys.map(categorize), [journeys]);
  const VIEWBOX_WIDTH = 1000;
  const VIEWBOX_HEIGHT = 380;
  const PADDING_X = 130; // room for left/right labels
  const PADDING_Y = 12;
  const { nodes, links } = useMemo(
    () =>
      layout(
        cats,
        visibleColumns,
        VIEWBOX_WIDTH - 2 * PADDING_X,
        VIEWBOX_HEIGHT - 2 * PADDING_Y,
      ),
    [cats, visibleColumns],
  );

  const columnHeaders = visibleColumns
    .map(k => COLUMN_REGISTRY.find(c => c.key === k)?.label)
    .filter((l): l is string => !!l);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-base font-medium text-gray-900">Marketing-Flow</h2>
        <p className="text-xs text-gray-500">
          {journeys.length} AI-Agents-Journeys · Globaler Pool: {marketingTouchTotal.toLocaleString('de-DE')} Marketing-Touched,
          {' '}{signupTotal.toLocaleString('de-DE')} mit Signup
        </p>
      </div>
      {/* Spalten-Toggle direkt unter dem Titel — kompakt im Header statt
          eigene Card oben, damit's klar Teil dieses Charts ist. */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500">Spalten</span>
        <div className="flex items-center gap-1 flex-wrap">
          {COLUMN_REGISTRY.map(c => {
            const isOn = visibleColumns.includes(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => onToggleColumn(c.key)}
                className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                  isOn
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Column headers */}
        {columnHeaders.map((h, i) => {
          const x = PADDING_X + (i * (VIEWBOX_WIDTH - 2 * PADDING_X)) / Math.max(1, columnHeaders.length - 1);
          return (
            <text
              key={i}
              x={x}
              y={PADDING_Y - 2}
              fontSize="11"
              fill="#6b7280"
              fontWeight="500"
              textAnchor="middle"
            >
              {h}
            </text>
          );
        })}

        {/* Bands. Drawn before nodes so node-boxes sit on top at the edges. */}
        <g transform={`translate(${PADDING_X}, ${PADDING_Y + 8})`}>
          {links.map((l, i) => {
            const x1 = l.source.x + l.source.width;
            const x2 = l.target.x;
            const y1Top = l.sourceY;
            const y1Bot = l.sourceY + l.thickness;
            const y2Top = l.targetY;
            const y2Bot = l.targetY + l.thickness;
            const cx1 = (x1 + x2) / 2;
            // Closed bezier ribbon (top curve forward, bottom curve back).
            const d = [
              `M ${x1} ${y1Top}`,
              `C ${cx1} ${y1Top}, ${cx1} ${y2Top}, ${x2} ${y2Top}`,
              `L ${x2} ${y2Bot}`,
              `C ${cx1} ${y2Bot}, ${cx1} ${y1Bot}, ${x1} ${y1Bot}`,
              'Z',
            ].join(' ');
            return (
              <path
                key={i}
                d={d}
                fill={l.source.color}
                fillOpacity={0.28}
                stroke="none"
              >
                <title>{`${l.source.label} → ${l.target.label}: ${l.count}`}</title>
              </path>
            );
          })}
          {/* Node boxes */}
          {nodes.map(n => (
            <g key={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={n.width}
                height={n.height}
                fill={n.color}
                rx={2}
              >
                <title>{`${n.label}: ${n.count}`}</title>
              </rect>
              {/* Label outside the column extremes, inside between */}
              {(() => {
                const isLeftmost = n.x === 0;
                const isRightmost = n.x + n.width >= (VIEWBOX_WIDTH - 2 * PADDING_X) - 0.5;
                const labelX = isLeftmost ? n.x - 6 : isRightmost ? n.x + n.width + 6 : n.x + n.width + 6;
                const anchor = isLeftmost ? 'end' : 'start';
                return (
                  <text
                    x={labelX}
                    y={n.y + n.height / 2}
                    fontSize="11"
                    fill="#374151"
                    textAnchor={anchor}
                    dominantBaseline="middle"
                  >
                    {n.label} <tspan fill="#9ca3af">({n.count})</tspan>
                  </text>
                );
              })()}
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
