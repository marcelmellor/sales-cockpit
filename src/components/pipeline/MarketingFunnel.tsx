'use client';

import { Info } from 'lucide-react';
import type { MarketingFunnelStage } from '@/lib/marketing/funnel-types';

// Tooltip-Definitionen pro Subgroup-Key × Stage-Key. Erklärt, woher die
// Zahl kommt und was sie bedeutet.
const SUBGROUP_INFO: Record<string, Record<string, string>> = {
  marketingTouch: {
    sipgate_de: 'Unique Geräte (device_id), deren erstes Marketing-Event (UTM/Click-ID) auf sipgate.de landete. Quelle: Amplitude ampli_live_events.',
    sipgate_ai: 'Unique Geräte (device_id), deren erstes Marketing-Event (UTM/Click-ID) auf sipgate.ai landete. Quelle: Amplitude ampli_live_events.',
  },
  activation: {
    agent_signup: 'Signup Atlantis mit Produkt FRONTDESK (= AI-Agents-Trial). Quelle: Amplitude ampli_live_events, alle Events im Zeitfenster.',
    pbx_signup: 'Signup Atlantis mit anderem Produkt (PBX, Trunking, …). Quelle: Amplitude ampli_live_events, alle Events im Zeitfenster.',
  },
  previewTrial: {
    agent_signup: 'Preview mit FRONTDESK-Signup (Agent). Quelle: BQ Cross-Join exports_raw (Contract Finalized, webuser_email) → ampli_live_events (Signup Atlantis, product=FRONTDESK).',
    pbx_signup: 'Preview mit anderem Signup-Produkt (PBX, Trunking, …). Quelle: BQ Cross-Join exports_raw (webuser_email) → ampli_live_events (Signup Atlantis, product≠FRONTDESK).',
    bestandskunde: 'Preview ohne Signup oder mit Signup >90 Tage vor Preview-Aktivierung — etablierter sipgate-Kunde, kein frischer Funnel-Durchlauf. Quelle: BQ Cross-Join (webuser_email → Signup Atlantis Zeitvergleich).',
  },
  dealCreated: {
    agent_signup: 'Deal-Journey enthält einen Agent Signup (FRONTDESK). Quelle: HubSpot-Journeys.',
    pbx_signup: 'Deal-Journey enthält einen PBX Signup. Quelle: HubSpot-Journeys.',
    bestandskunde: 'Deal-Journey startet mit Bestandskunden-Status (kein Signup). Quelle: HubSpot-Journeys.',
  },
  dealWon: {
    agent_signup: 'Gewonnener Deal mit Agent Signup in der Journey. Quelle: HubSpot-Journeys.',
    pbx_signup: 'Gewonnener Deal mit PBX Signup in der Journey. Quelle: HubSpot-Journeys.',
    bestandskunde: 'Gewonnener Deal mit Bestandskunden-Start. Quelle: HubSpot-Journeys.',
  },
};
const REST_INFO: Record<string, string> = {
  previewTrial: 'Previews, deren masterSipId keinen account_id-Eintrag im Marketing-Projekt hat (kein Cross-Project-Bridge möglich). Signup-Typ daher unbekannt.',
  dealCreated: 'Deals ohne erkennbaren Signup-Typ in der Journey.',
  dealWon: 'Gewonnene Deals ohne erkennbaren Signup-Typ in der Journey.',
};

// Top-of-Funnel Conversion-Diagramm: echte Subset-Cascade von Marketing-
// Reach (anonyme Geräte mit UTM/Click-ID) runter zum gewonnenen Deal.
// Jede Stage ist eine echte Teilmenge der vorherigen — der Drop ist real.

type StageKey = MarketingFunnelStage['key'];
export type FunnelGrouping = 'marketingTouch' | 'activation';

interface Props {
  stages: MarketingFunnelStage[];
  visibleStages: readonly StageKey[];
  onToggleStage: (key: StageKey) => void;
  grouping: FunnelGrouping;
  onGroupingChange: (g: FunnelGrouping) => void;
  /** True wenn die Marketing-Funnel-Query gerade im Hintergrund neu lädt
   *  (z.B. nach Date-Preset-Wechsel). Wir zeigen kein Loading-Overlay,
   *  sondern nur einen dezenten „aktualisiere…"-Hinweis neben dem Titel. */
  isFetching?: boolean;
}

export function MarketingFunnel({ stages, visibleStages, onToggleStage, grouping, onGroupingChange, isFetching }: Props) {
  if (stages.length === 0) return null;
  // Nur sichtbare Stages rendern; Conversion-%-Berechnungen referenzieren die
  // nächste sichtbare Vorgänger-Stage. So funktioniert das Hide trotz Cascade.
  const renderedStages = stages.filter(s => visibleStages.includes(s.key));
  const maxCount = Math.max(...renderedStages.map(s => s.count), 1);
  const firstCount = renderedStages[0]?.count || 1;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-medium text-gray-900">Funnel</h2>
          {isFetching && (
            <span className="text-xs text-gray-400 italic">aktualisiere…</span>
          )}
        </div>
        <p className="text-xs text-gray-500">
          AI-Agents · Conversion über alle Amplitude-User seit 01.01.2026
        </p>
      </div>
      {/* Stage-Toggle direkt unter dem Titel — analog zum Spalten-Toggle
          im Marketing-Flow. Ausgeblendete Stages werden im Diagramm
          übersprungen, Conversion-% rechnet von der nächsten sichtbaren
          Vorgänger-Stage. */}
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Stages</span>
          <div className="flex items-center gap-1 flex-wrap">
            {stages.map(stage => {
              const isOn = visibleStages.includes(stage.key);
              return (
                <button
                  key={stage.key}
                  type="button"
                  onClick={() => onToggleStage(stage.key)}
                  className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                    isOn
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {stage.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Gruppierung</span>
          <select
            value={grouping}
            onChange={e => onGroupingChange(e.target.value as FunnelGrouping)}
            className="text-xs font-medium rounded border border-gray-200 bg-white px-2 py-0.5 text-gray-700 hover:border-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-400"
          >
            <option value="activation">Signup</option>
            <option value="marketingTouch">Marketing-Touch</option>
          </select>
        </div>
      </div>
      <div className="space-y-2">
        {renderedStages.map((stage, i) => {
          const widthPct = (stage.count / maxCount) * 100;
          const prev = i > 0 ? renderedStages[i - 1] : null;
          const stepConversion = prev && prev.count > 0 ? (stage.count / prev.count) * 100 : null;
          const overallConversion = firstCount > 0 ? (stage.count / firstCount) * 100 : 0;
          return (
            <div key={stage.key}>
              <div className="flex items-baseline justify-between text-sm mb-1">
                <div className="flex items-baseline gap-3">
                  <span className="font-medium text-gray-900">{stage.label}</span>
                  {stage.subgroups && stage.subgroups.length > 0 && (
                    <span className="text-xs text-gray-500 flex items-center gap-2">
                      {stage.subgroups.map(sg => {
                        const info = SUBGROUP_INFO[stage.key]?.[sg.key];
                        return (
                          <span key={sg.key} className="flex items-center gap-1">
                            <span
                              className="inline-block w-2 h-2 rounded-sm"
                              style={{ backgroundColor: sg.color || '#9ca3af' }}
                            />
                            {sg.label}: {sg.count.toLocaleString('de-DE')}
                            {info && (
                              <span title={info} className="cursor-help text-gray-300 hover:text-gray-500 transition-colors">
                                <Info className="w-3 h-3" />
                              </span>
                            )}
                          </span>
                        );
                      })}
                      {(() => {
                        const subgroupSum = stage.subgroups!.reduce((a, sg) => a + sg.count, 0);
                        const rest = Math.max(0, stage.count - subgroupSum);
                        if (rest === 0) return null;
                        const restInfo = REST_INFO[stage.key];
                        return (
                          <span className="flex items-center gap-1">
                            <span
                              className="inline-block w-2 h-2 rounded-sm"
                              style={{ backgroundColor: '#cbd5e1' }}
                            />
                            andere: {rest.toLocaleString('de-DE')}
                            {restInfo && (
                              <span title={restInfo} className="cursor-help text-gray-300 hover:text-gray-500 transition-colors">
                                <Info className="w-3 h-3" />
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </span>
                  )}
                </div>
                <span className="text-gray-600 tabular-nums">
                  {stage.count.toLocaleString('de-DE')}
                  {stepConversion !== null && (
                    <span className="ml-2 text-gray-400">
                      ({stepConversion.toFixed(1)}% von {prev?.label})
                    </span>
                  )}
                  {i === 0 && <span className="ml-2 text-gray-400">(100%)</span>}
                  {i > 0 && (
                    <span className="ml-2 text-gray-400">
                      · {overallConversion.toFixed(2)}% von {renderedStages[0].label}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-6 bg-gray-100 rounded overflow-hidden flex">
                {stage.subgroups && stage.subgroups.length > 0 ? (
                  <SubgroupBar stage={stage} widthPct={widthPct} dimming={i * 0.18} />
                ) : (
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${widthPct}%`, opacity: 1 - i * 0.18 }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-gray-500 leading-relaxed">
        <strong className="text-gray-700">Stages</strong> · <strong>Marketing-Touch</strong>:
        unique Geräte (anonym) mit Paid-Ads-Click-ID (gclid/fbclid) oder
        Paid-/Content-/Email-UTM, im gewählten Zeitfenster (Default 90 Tage).
        Aufgesplittet nach Landing-Domain des ersten Marketing-Hits. ·
        {' '}<strong>Signup</strong>: Marketing-attribuierte Journeys mit
        konkretem Aktivierungssignal — Agent Signup (FRONTDESK-Trial), PBX
        Signup (anderes Produkt) oder Bestandskunde (sipgate-Account vor
        Tracking-Window). Entspricht der &bdquo;Signup&ldquo;-Spalte im Flow-Chart
        unten. · <strong>Deal angelegt / gewonnen</strong>: alle Deals in der
        HubSpot-AI-Agents-Pipeline, deren Contact-Device irgendwann (innerhalb
        365 Tage) ein Marketing-UTM-/Click-ID-Event hatte. Lifetime-Sicht,
        nicht ans Date-Window oben gekoppelt — Sales-Cycles sind länger als
        das Marketing-Reach-Window. Attribution via device_id-Join — Cross-
        Device-Visits und gelöschte Cookies werden nicht erfasst, die Zahlen
        sind also konservativ.
      </p>
    </div>
  );
}

// Stacked Bar für Stages mit subgroups. Zeichnet ein Segment pro Subgroup
// plus ein "Rest"-Segment für (count - sum(subgroups)) als ausgegrautes Stück.
function SubgroupBar({
  stage,
  widthPct,
  dimming,
}: {
  stage: MarketingFunnelStage;
  widthPct: number;
  dimming: number;
}) {
  if (!stage.subgroups || stage.subgroups.length === 0) return null;
  const subgroupSum = stage.subgroups.reduce((acc, sg) => acc + sg.count, 0);
  const restCount = Math.max(0, stage.count - subgroupSum);
  const opacity = 1 - dimming;
  // Alle Breiten als % von stage.count, dann auf die gesamte Stage-Breite
  // (widthPct% des Containers) verteilen — d.h. wir bauen ein flex-Container
  // der widthPct% breit ist, mit segments im Verhältnis count/total.
  const segments = [
    ...stage.subgroups.map(sg => ({
      key: sg.key,
      flexBasis: stage.count > 0 ? (sg.count / stage.count) * 100 : 0,
      color: sg.color || '#9ca3af',
    })),
    ...(restCount > 0
      ? [{ key: '__rest__', flexBasis: (restCount / stage.count) * 100, color: '#cbd5e1' }]
      : []),
  ];
  return (
    <div
      className="h-full flex transition-all"
      style={{ width: `${widthPct}%`, opacity }}
    >
      {segments.map(seg => (
        <div
          key={seg.key}
          className="h-full"
          style={{ width: `${seg.flexBasis}%`, backgroundColor: seg.color }}
        />
      ))}
    </div>
  );
}
