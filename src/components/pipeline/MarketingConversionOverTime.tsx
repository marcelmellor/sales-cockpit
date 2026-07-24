'use client';

import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { MarketingFunnelJourney } from '@/lib/marketing/funnel-types';
import {
  categorize,
  categoryOf,
  COLUMN_REGISTRY,
  FLOW_NODES,
  FLOW_NODE_BY_ID,
  type FlowNode,
} from '@/lib/marketing/flow-model';

// Zeitverlauf-View des Marketing-Flows: man wählt genau zwei Flow-Punkte
// (Quelle → Ziel) und sieht Woche für Woche (oder Monat für Monat) die
// Conversion. Kohorte pro Bucket = Journeys, deren Quell-Event in diesem
// Zeitraum liegt; Conversion = Anteil davon, der später den Zielpunkt erreicht.
// Rein clientseitig aus denselben Journeys wie Funnel + Sankey — dieselbe
// `categorize()`-Klassifizierung, damit die Punkte identisch definiert sind.

type Granularity = 'week' | 'month';

interface Props {
  journeys: MarketingFunnelJourney[];
  isFetching?: boolean;
  /** Baut Deep-Links auf die Deals-/Leads-Ansicht, gefiltert auf die
   *  übergebenen HubSpot-IDs (= konvertierte Deals bzw. Leads einer Kohorte). */
  buildDealsHref: (dealIds: string[]) => string;
  buildLeadsHref: (leadIds: string[]) => string;
  /** Untergrenze (ms) für das Quell-Event-Datum — spiegelt den Datums-Filter
   *  oben. Kohorten außerhalb des Fensters werden nicht gezählt. */
  cutoffMs: number;
}

interface Bucket {
  key: string;      // sortierbarer ISO-Key (YYYY-MM-DD Wochenstart / YYYY-MM)
  start: Date;
  label: string;
  total: number;    // Kohortengröße (Journeys mit Quell-Event in diesem Bucket)
  converted: number;
  convertedDealIds: string[]; // HubSpot-Deal-IDs der konvertierten Deals (kind='deal')
  convertedLeadIds: string[]; // HubSpot-Lead-IDs der konvertierten Leads (kind='lead')
}

// Montag der Woche (lokale Zeit).
function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayMon0 = (x.getDay() + 6) % 7; // Mo=0 … So=6
  x.setDate(x.getDate() - dayMon0);
  return x;
}

// ISO-Kalenderwoche (1..53).
function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Donnerstag dieser Woche
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const MONTHS_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function bucketFor(date: Date, granularity: Granularity): { key: string; start: Date; label: string } {
  if (granularity === 'month') {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const key = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}`;
    const label = `${MONTHS_DE[start.getMonth()]} ${start.getFullYear()}`;
    return { key, start, label };
  }
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const key = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`;
  const range = `${pad2(start.getDate())}.${pad2(start.getMonth() + 1)}.–${pad2(end.getDate())}.${pad2(end.getMonth() + 1)}.`;
  const label = `KW ${pad2(isoWeekNumber(start))} · ${range}`;
  return { key, start, label };
}

function fmtPct(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`;
}

export function MarketingConversionOverTime({ journeys, isFetching, buildDealsHref, buildLeadsHref, cutoffMs }: Props) {
  const sourceOptions = useMemo(() => FLOW_NODES.filter(n => n.sourceable), []);

  const [sourceId, setSourceId] = useState<string>('col1:agent_signup');
  const [targetId, setTargetId] = useState<string>('colPreview:preview_yes');
  const [granularity, setGranularity] = useState<Granularity>('week');

  const sourceNode: FlowNode = FLOW_NODE_BY_ID.get(sourceId) ?? sourceOptions[0];

  // Ziel-Kandidaten = alle Nodes in einer streng nachgelagerten Spalte.
  const targetOptions = useMemo(
    () => FLOW_NODES.filter(n => n.colIndex > sourceNode.colIndex),
    [sourceNode.colIndex],
  );
  // Falls das aktuelle Ziel nicht mehr nachgelagert ist, auf das erste valide
  // Ziel zurücksetzen.
  const effectiveTargetId = useMemo(() => {
    if (targetOptions.some(n => n.id === targetId)) return targetId;
    return targetOptions[0]?.id ?? '';
  }, [targetOptions, targetId]);
  const targetNode = FLOW_NODE_BY_ID.get(effectiveTargetId);

  const cats = useMemo(() => journeys.map(categorize), [journeys]);

  const { buckets, overallTotal, overallConverted } = useMemo(() => {
    const map = new Map<string, Bucket>();
    let total = 0;
    let converted = 0;
    if (!targetNode) return { buckets: [] as Bucket[], overallTotal: 0, overallConverted: 0 };

    journeys.forEach((j, i) => {
      const cat = cats[i];
      if (categoryOf(cat, sourceNode.col) !== sourceNode.category) return;
      const anchor = sourceNode.anchorDate(j);
      if (!anchor) return;
      // Datums-Filter (oben) wirkt auf das Quell-Event-Datum — die Achse dieser
      // View. Kohorten mit Anker vor dem Cutoff fallen raus.
      if (anchor.getTime() < cutoffMs) return;
      const isConverted = categoryOf(cat, targetNode.col) === targetNode.category;
      const b = bucketFor(anchor, granularity);
      let entry = map.get(b.key);
      if (!entry) {
        entry = { key: b.key, start: b.start, label: b.label, total: 0, converted: 0, convertedDealIds: [], convertedLeadIds: [] };
        map.set(b.key, entry);
      }
      entry.total += 1;
      total += 1;
      if (isConverted) {
        entry.converted += 1;
        converted += 1;
        // Konvertierte Deals verlinken auf die Deals-Ansicht, konvertierte
        // Leads auf die Leads-Ansicht (getrennte Tabs). Eine Kohorte kann beide
        // enthalten (z.B. Ziel „Preview gestartet").
        if (j.kind === 'deal') entry.convertedDealIds.push(j.entityId);
        else entry.convertedLeadIds.push(j.entityId);
      }
    });

    const arr = Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
    return { buckets: arr, overallTotal: total, overallConverted: converted };
  }, [journeys, cats, sourceNode, targetNode, granularity, cutoffMs]);

  const overallRate = overallTotal > 0 ? (overallConverted / overallTotal) * 100 : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-4">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-medium text-gray-900">Conversion über Zeit</h2>
          {isFetching && <span className="text-xs text-gray-400 italic">aktualisiere…</span>}
        </div>
        <p className="text-xs text-gray-500">
          Kohorte pro {granularity === 'week' ? 'Woche' : 'Monat'} = Journeys, deren Quell-Event im Zeitraum liegt
        </p>
      </div>

      {/* Punkt-Auswahl: Quelle → Ziel + Granularität */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <NodeSelect
          label="Von"
          value={sourceNode.id}
          onChange={setSourceId}
          options={sourceOptions}
        />
        <span className="text-gray-400" aria-hidden="true">→</span>
        <NodeSelect
          label="Nach"
          value={effectiveTargetId}
          onChange={setTargetId}
          options={targetOptions}
        />
        <div className="flex items-center gap-1 ml-auto">
          {(['week', 'month'] as Granularity[]).map(g => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                granularity === g
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {g === 'week' ? 'Woche' : 'Monat'}
            </button>
          ))}
        </div>
      </div>

      {/* Gesamt-Zusammenfassung */}
      <div className="flex items-baseline gap-2 mb-4 text-sm">
        <span className="font-medium text-gray-900">
          {sourceNode.label} → {targetNode?.label}
        </span>
        <span className="text-gray-500 tabular-nums">
          gesamt {overallConverted.toLocaleString('de-DE')} / {overallTotal.toLocaleString('de-DE')}
          {' '}({fmtPct(overallRate)})
        </span>
      </div>

      {buckets.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-500">
          Keine Journeys im gewählten Zeitraum mit diesem Einstiegspunkt.
        </div>
      ) : (
        <div className="space-y-1.5">
          {buckets.map(b => {
            const rate = b.total > 0 ? (b.converted / b.total) * 100 : 0;
            const dealCount = b.convertedDealIds.length;
            const leadCount = b.convertedLeadIds.length;
            return (
              <div key={b.key} className="flex items-center gap-3 text-sm">
                <span className="w-[150px] flex-shrink-0 text-xs text-gray-600 tabular-nums">
                  {b.label}
                </span>
                <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden relative">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${rate}%`,
                      backgroundColor: targetNode?.color ?? '#10b981',
                      opacity: 0.85,
                    }}
                  />
                </div>
                <span className="w-[150px] flex-shrink-0 text-right text-xs text-gray-600 tabular-nums">
                  {b.converted}/{b.total}
                  <span className="ml-1.5 text-gray-400">({fmtPct(rate)})</span>
                </span>
                <span className="w-[130px] flex-shrink-0 text-right flex items-center justify-end gap-2">
                  {dealCount > 0 && (
                    <a
                      href={buildDealsHref(b.convertedDealIds)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-cyan-700 hover:text-cyan-900"
                      title={`${dealCount} konvertierte Deal(s) dieser Kohorte in der Deals-Ansicht öffnen`}
                    >
                      {dealCount} Deal{dealCount !== 1 ? 's' : ''}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {leadCount > 0 && (
                    <a
                      href={buildLeadsHref(b.convertedLeadIds)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900"
                      title={`${leadCount} konvertierte Lead(s) dieser Kohorte in der Leads-Ansicht öffnen`}
                    >
                      {leadCount} Lead{leadCount !== 1 ? 's' : ''}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {dealCount === 0 && leadCount === 0 && (
                    <span className="text-xs text-gray-300">–</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-5 text-xs text-gray-500 leading-relaxed">
        Jede Zeile ist eine Kohorte: alle Journeys, deren <strong>Quell-Event</strong>
        {' '}({sourceNode.label}) in diesem {granularity === 'week' ? 'Woche' : 'Monat'}
        {' '}stattfand. Der Balken zeigt den Anteil davon, der später
        {' '}<strong>{targetNode?.label}</strong> erreichte — unabhängig davon, wann der
        {' '}Zielschritt passierte (nachgelagerte Schritte brauchen oft Wochen). Basis
        {' '}sind die AI-Agents-HubSpot-Journeys; bei kleinen Kohorten schwankt die
        {' '}Quote stark — die Monats-Ansicht glättet das.
      </p>
    </div>
  );
}

// Gruppiertes Node-Dropdown (optgroup pro Spalte). Nur die übergebenen Optionen
// werden angezeigt (Quelle: sourceable Nodes; Ziel: nachgelagerte Nodes).
function NodeSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: FlowNode[];
}) {
  const byColumn = COLUMN_REGISTRY.map(col => ({
    col,
    nodes: options.filter(n => n.col === col.key),
  })).filter(g => g.nodes.length > 0);

  return (
    <label className="flex items-center gap-1.5">
      <span className="text-xs text-gray-500">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="text-xs font-medium rounded border border-gray-200 bg-white px-2 py-1 text-gray-700 hover:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-400"
      >
        {byColumn.map(g => (
          <optgroup key={g.col.key} label={g.col.label}>
            {g.nodes.map(n => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
