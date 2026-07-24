'use client';

import { useMemo, useState } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';
import type {
  MarketingFunnelResponse,
  MarketingFunnelJourney,
  MarketingFunnelStage,
} from '@/lib/marketing/funnel-types';
import type { Touchpoint } from '@/lib/amplitude/journeys';
import { formatTouchpointLabel } from '@/lib/marketing/touchpoint-label';
import { hubspotDealUrl } from '@/lib/hubspot/urls';
import { MarketingSankey } from './MarketingSankey';
import { COLUMN_REGISTRY, type ColumnKey } from '@/lib/marketing/flow-model';
import { MarketingFunnel } from './MarketingFunnel';
import { MarketingConversionOverTime } from './MarketingConversionOverTime';
import {
  DATE_PRESETS,
  HARD_FLOOR_DATE_MS as HARD_FLOOR_DATE,
  type DatePresetKey,
} from '@/lib/marketing/date-presets';

interface MarketingViewProps {
  data: MarketingFunnelResponse | undefined;
  isLoading: boolean;
  /** True wenn React Query gerade ein Background-Refetch macht (z.B. nach
   *  Preset-Wechsel). UI bleibt sichtbar, aber wir zeigen einen kleinen
   *  „aktualisiere"-Hinweis im Funnel-Header. */
  isFetching: boolean;
  /** Datum-Preset wird in page.tsx gehalten, weil die Marketing-Funnel-
   *  Query (BQ) das Window braucht — bei Toggle dort die Query neu fetchen. */
  datePresetKey: DatePresetKey;
  onDatePresetChange: (key: DatePresetKey) => void;
  /** Baut Deep-Links auf die Deals-/Leads-Ansicht, gefiltert auf die
   *  übergebenen HubSpot-IDs. Von page.tsx durchgereicht (kennt Router + URL). */
  buildDealsHref: (dealIds: string[]) => string;
  buildLeadsHref: (leadIds: string[]) => string;
}

export function MarketingView({
  data,
  isLoading,
  isFetching,
  datePresetKey,
  onDatePresetChange,
  buildDealsHref,
  buildLeadsHref,
}: MarketingViewProps) {
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() =>
    COLUMN_REGISTRY.map(c => c.key).filter(k => k !== 'colPreview'),
  );
  const EXCLUSIVE_PAIR: ColumnKey[] = ['colPreview', 'col2'];
  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns(prev => {
      if (prev.includes(key)) return prev.filter(k => k !== key);
      const rival = EXCLUSIVE_PAIR.find(k => k !== key && EXCLUSIVE_PAIR.includes(key));
      const base = rival ? prev.filter(k => k !== rival) : prev;
      return COLUMN_REGISTRY.map(c => c.key).filter(k => base.includes(k) || k === key);
    });
  };

  // Sichtbare Funnel-Stages — analog zum Sankey-Spalten-Toggle. Default:
  // alles an. State ist in-memory (kein localStorage).
  type FunnelStageKey = MarketingFunnelStage['key'];
  const [visibleFunnelStages, setVisibleFunnelStages] = useState<FunnelStageKey[]>(() =>
    ['marketingTouch', 'activation', 'previewTrial', 'dealCreated', 'dealWon'],
  );
  const toggleFunnelStage = (key: FunnelStageKey) => {
    setVisibleFunnelStages(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    );
  };

  // Gruppierungsmodus: bestimmt die farbigen Subgroups in den Funnel-Balken.
  // - 'marketingTouch': Marketing-Touch nach Landing-Domain (sipgate.de/ai/andere)
  // - 'activation': alle Stages nach Activation-Typ (Agent/PBX/Bestandskunde)
  type FunnelGrouping = 'marketingTouch' | 'activation';
  const [funnelGrouping, setFunnelGrouping] = useState<FunnelGrouping>('activation');

  // Unteransicht des Marketing-Tabs: 'flow' = Funnel + Sankey + Journey-Tabelle,
  // 'timeline' = Wochen-/Monats-Conversion zwischen zwei Flow-Punkten. Beide
  // teilen sich denselben Date-Filter (filteredJourneys).
  type SubView = 'flow' | 'timeline';
  const [subView, setSubView] = useState<SubView>('flow');

  // Datums-Cutoff (ms) des aktiven Presets — Floor immer angewendet. Wird für
  // den Flow (createdate-Filter) UND für die Zeitverlauf-View (Quell-Event-
  // Filter) benutzt, damit der Datums-Filter in beiden Ansichten greift.
  const cutoffMs = useMemo(() => {
    const preset = DATE_PRESETS.find(p => p.key === datePresetKey) ?? DATE_PRESETS[DATE_PRESETS.length - 1];
    const presetCutoff =
      preset.days === null ? HARD_FLOOR_DATE : +new Date() - preset.days * 24 * 60 * 60 * 1000;
    return Math.max(presetCutoff, HARD_FLOOR_DATE);
  }, [datePresetKey]);

  const filteredJourneys = useMemo(() => {
    if (!data) return [];
    return data.journeys.filter(j => {
      if (!j.createdate) return false;
      const t = new Date(j.createdate).getTime();
      return Number.isFinite(t) && t >= cutoffMs;
    });
  }, [data, cutoffMs]);

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="py-20 text-center text-gray-500">
        Keine Marketing-Daten verfügbar.
      </div>
    );
  }
  // Sankey-Header-Kennzahlen — Marketing-Touch kommt jetzt aus dem Funnel
  // (globale Device-Reach im Default-Window), "mit Signup" rechnen wir
  // clientseitig aus den Journeys (Agent + PBX Signup).
  const marketingTouch = data.funnel.find(s => s.key === 'marketingTouch')?.count ?? 0;
  const signup = data.journeys.filter(j =>
    j.touchpoints.some(
      t =>
        t.anchor === 'signup_atlantis_frontdesk' ||
        t.anchor === 'signup_atlantis_other_product',
    ),
  ).length;

  // Funnel-Stages dynamisch rechnen. Jede Stage hat zwei Zahlen:
  //   1. BQ-Total = Gesamtbreite des Balkens (aus Amplitude, unabhängig von HubSpot)
  //   2. Journey-basierte Subgroups = farbige Segmente im Balken
  // Der Rest (BQ-Total - Summe Subgroups) wird als „Andere" (grau) gerendert.
  //
  // Upstream-Kaskade: wenn eine vorgelagerte Stage sichtbar ist, werden nur
  // Journeys gezählt, die auch den Upstream-Filter erfüllen. So zeigt z.B.
  // „Preview" bei sichtbarem „Marketing-Touch" nur preview-Journeys MIT
  // Marketing-Attribution, ohne Marketing-Touch alle Previews.
  const STAGE_ORDER: FunnelStageKey[] = ['marketingTouch', 'activation', 'previewTrial', 'dealCreated', 'dealWon'];
  const stagePredicate = (key: FunnelStageKey) => (j: MarketingFunnelJourney): boolean => {
    switch (key) {
      case 'marketingTouch':
        return j.touchpoints.some(t => t.anchor === 'marketing_acquisition');
      case 'activation':
        return j.touchpoints.some(
          t =>
            t.anchor === 'signup_atlantis_frontdesk' ||
            t.anchor === 'signup_atlantis_other_product' ||
            t.anchor === 'customer_since',
        );
      case 'previewTrial':
        return j.touchpoints.some(t => t.anchor === 'preview_trial_started');
      case 'dealCreated':
        return j.kind === 'deal';
      case 'dealWon':
        return j.kind === 'deal' && j.stageIsWon;
    }
  };

  // Activation-Subgroups aus einer Journey-Liste berechnen (Agent/PBX/Bestandskunde).
  // Bestandskunde = Account-Erstellung oder Signup liegt >6 Monate vor Deal-/
  // Lead-Erstellung. So fallen nur wirklich etablierte Kunden in diesen Bucket,
  // nicht jeder Account mit einem mastersipid.
  const BESTANDSKUNDE_MS = 180 * 24 * 60 * 60 * 1000; // 6 Monate in ms
  function computeActivationSubgroups(js: MarketingFunnelJourney[]) {
    let agent = 0, pbx = 0, bestand = 0;
    for (const j of js) {
      const refDate = j.createdate ? new Date(j.createdate).getTime() : null;

      const agentTp = j.touchpoints.find(t => t.anchor === 'signup_atlantis_frontdesk');
      const pbxTp = j.touchpoints.find(t => t.anchor === 'signup_atlantis_other_product');
      const bestandTp = j.touchpoints.find(t => t.anchor === 'customer_since');

      // Signup-Zeitpunkt: frühester Signup (Agent oder PBX)
      const signupTp = agentTp || pbxTp;
      const signupMs = signupTp ? new Date(signupTp.occurredAt).getTime() : null;

      // Bestandskunde-Prüfung: Signup oder Account-Erstellung >6 Monate vor Entity-Erstellung
      const isOldSignup = refDate != null && signupMs != null && (refDate - signupMs) > BESTANDSKUNDE_MS;
      const bestandMs = bestandTp ? new Date(bestandTp.occurredAt).getTime() : null;
      const isOldAccount = refDate != null && bestandMs != null && (refDate - bestandMs) > BESTANDSKUNDE_MS;

      if (isOldSignup || isOldAccount) {
        bestand++;
      } else if (agentTp) {
        agent++;
      } else if (pbxTp) {
        pbx++;
      } else if (bestandTp && refDate == null) {
        // Kein createdate → können wir nicht zeitlich einordnen → Bestandskunde
        bestand++;
      }
      // Alles andere (kein Signup, kein customer_since, oder Account zu jung) → „andere"
    }
    return [
      { key: 'agent_signup', label: 'Agent Signup', count: agent, color: '#10b981' },
      { key: 'pbx_signup', label: 'PBX Signup', count: pbx, color: '#6366f1' },
      { key: 'bestandskunde', label: 'Bestandskunde', count: bestand, color: '#94a3b8' },
    ];
  }

  const bq: import('@/lib/marketing/funnel-types').FunnelBqTotals = data.bqTotals ?? {
    activationAgent: 0,
    activationOther: 0,
    activationTotal: 0,
    previewTrialTotal: 0,
    previewTrialAgent: 0,
    previewTrialOther: 0,
    previewTrialBestandskunde: 0,
  };

  const dynamicFunnel: MarketingFunnelStage[] = data.funnel.map(stage => {
    // Upstream-Filter: nur Journeys zählen, die alle sichtbaren vorgelagerten
    // Stage-Predicates erfüllen.
    const stageIdx = STAGE_ORDER.indexOf(stage.key);
    const upstreamVisible = STAGE_ORDER.slice(0, stageIdx).filter(s =>
      visibleFunnelStages.includes(s),
    );
    const upstreamPredicates = upstreamVisible.map(stagePredicate);
    const ownPredicate = stagePredicate(stage.key);
    const matching = filteredJourneys.filter(
      j => upstreamPredicates.every(p => p(j)) && ownPredicate(j),
    );

    // ── Marketing-Touch ──────────────────────────────────────────────
    if (stage.key === 'marketingTouch') {
      // BQ-Total als Balkenbreite. Subgroups nur bei Marketing-Touch-Gruppierung.
      if (funnelGrouping === 'marketingTouch') return stage; // Server hat Domain-Subgroups
      return { ...stage, subgroups: undefined }; // Bei Activation-Gruppierung: ungegruppiert
    }

    // ── Activation ───────────────────────────────────────────────────
    if (stage.key === 'activation') {
      // BQ-Total = alle Signups aus Amplitude (unabhängig von HubSpot).
      // Subgroups ebenfalls aus BQ — jedes Signup-Event hat ein Produkt,
      // daher kein „andere"-Rest. Bestandskunde hat kein Signup-Event
      // und taucht hier nicht auf.
      const subgroups = funnelGrouping === 'activation'
        ? [
            { key: 'agent_signup', label: 'Agent Signup', count: bq.activationAgent, color: '#10b981' },
            { key: 'pbx_signup', label: 'PBX Signup', count: bq.activationOther, color: '#6366f1' },
          ]
        : undefined;
      return { ...stage, count: bq.activationTotal, subgroups };
    }

    // ── Preview (Trial) ──────────────────────────────────────────────
    // BQ-Total UND BQ-Subgroups (Cross-Project-Join exports_raw →
    // ampli_live_events via account_id). Kein HubSpot-Fallback nötig.
    if (stage.key === 'previewTrial') {
      const subgroups = funnelGrouping === 'activation'
        ? [
            { key: 'agent_signup', label: 'Agent Signup', count: bq.previewTrialAgent, color: '#10b981' },
            { key: 'pbx_signup', label: 'PBX Signup', count: bq.previewTrialOther, color: '#6366f1' },
            { key: 'bestandskunde', label: 'Bestandskunde', count: bq.previewTrialBestandskunde, color: '#94a3b8' },
          ]
        : undefined;
      return { ...stage, count: bq.previewTrialTotal, subgroups };
    }

    // ── Deal angelegt / gewonnen ─────────────────────────────────────
    // Alle Deals in der AI-Agents-Pipeline, ohne Marketing-Attribution-
    // oder Upstream-Cascade-Filter. Date-Filter greift weiterhin (über
    // filteredJourneys). Subgroups zeigen Activation-Aufschlüsselung,
    // „andere" = kein Activation-Typ erkennbar.
    const allDeals = filteredJourneys.filter(j => ownPredicate(j));
    const subgroups = funnelGrouping === 'activation'
      ? computeActivationSubgroups(allDeals)
      : undefined;
    return { ...stage, count: allDeals.length, subgroups };
  });
  // Journey-Tabelle: nur Deals mit AI-Agents-Touch zeigen. Lead-only- und
  // Deals-ohne-Amplitude-Spur Entries gehören nur ins Sankey, nicht in die
  // detail-orientierte Tabelle (sonst wird's überfüllt).
  const tableJourneys = filteredJourneys.filter(
    j =>
      j.kind === 'deal' &&
      j.touchpoints.some(
        t =>
          t.anchor !== 'signup_atlantis_other_product' &&
          t.anchor !== 'hubspot_lead_created' &&
          t.anchor !== 'hubspot_deal_created',
      ),
  );
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SubViewToggle active={subView} onChange={setSubView} />
      </div>
      <DateFilterBar
        active={datePresetKey}
        onChange={onDatePresetChange}
        totalEntries={data.journeys.length}
        filteredEntries={filteredJourneys.length}
        leadingLabel={subView === 'timeline' ? 'Quell-Event in den letzten' : 'Erstellt in den letzten'}
        showCount={subView === 'flow'}
      />
      {subView === 'flow' ? (
        <>
          <MarketingFunnel
            stages={dynamicFunnel}
            visibleStages={visibleFunnelStages}
            onToggleStage={toggleFunnelStage}
            grouping={funnelGrouping}
            onGroupingChange={setFunnelGrouping}
            isFetching={isFetching}
          />
          <MarketingSankey
            journeys={filteredJourneys}
            marketingTouchTotal={marketingTouch}
            signupTotal={signup}
            visibleColumns={visibleColumns}
            onToggleColumn={toggleColumn}
          />
          <JourneyTable journeys={tableJourneys} />
        </>
      ) : (
        <MarketingConversionOverTime
          journeys={data.journeys}
          cutoffMs={cutoffMs}
          isFetching={isFetching}
          buildDealsHref={buildDealsHref}
          buildLeadsHref={buildLeadsHref}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-View-Toggle (Flow ↔ Zeitverlauf)
// ---------------------------------------------------------------------------

function SubViewToggle({
  active,
  onChange,
}: {
  active: 'flow' | 'timeline';
  onChange: (v: 'flow' | 'timeline') => void;
}) {
  const items: Array<{ key: 'flow' | 'timeline'; label: string }> = [
    { key: 'flow', label: 'Flow' },
    { key: 'timeline', label: 'Conversion über Zeit' },
  ];
  return (
    <div className="inline-flex items-center gap-1 bg-gray-100 rounded-lg p-1">
      {items.map(it => (
        <button
          key={it.key}
          type="button"
          onClick={() => onChange(it.key)}
          className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
            active === it.key
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date-Filter-Bar
// ---------------------------------------------------------------------------

interface DateFilterBarProps {
  active: DatePresetKey;
  onChange: (key: DatePresetKey) => void;
  totalEntries: number;
  filteredEntries: number;
  /** Führender Text vor den Presets. Flow: „Erstellt in den letzten",
   *  Zeitverlauf: „Quell-Event in den letzten" (dort greift der Filter auf
   *  das Anker-Datum, nicht auf createdate). */
  leadingLabel: string;
  /** Entry-Zähler rechts einblenden (nur sinnvoll im Flow, wo die createdate-
   *  gefilterte Journey-Menge die Basis ist). */
  showCount: boolean;
}

function DateFilterBar({ active, onChange, totalEntries, filteredEntries, leadingLabel, showCount }: DateFilterBarProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">{leadingLabel}</span>
        <div className="flex items-center gap-1">
          {DATE_PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(p.key)}
              className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                active === p.key
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {showCount && (
        <div className="text-xs text-gray-500 tabular-nums">
          {filteredEntries.toLocaleString('de-DE')} von {totalEntries.toLocaleString('de-DE')} Entries
        </div>
      )}
    </div>
  );
}

// Sankey-Column-Toggle ist jetzt direkt im MarketingSankey-Header integriert
// (unter dem "Marketing-Flow"-Titel) — siehe MarketingSankey.tsx.

// ---------------------------------------------------------------------------
// Journey Table
// ---------------------------------------------------------------------------

interface JourneyTableProps {
  journeys: MarketingFunnelJourney[];
}

function JourneyTable({ journeys }: JourneyTableProps) {
  if (journeys.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-500">
        Kein Deal hat einen Amplitude-Touchpoint.
      </div>
    );
  }
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-baseline justify-between">
        <h2 className="text-base font-medium text-gray-900">Deal-Journeys</h2>
        <p className="text-xs text-gray-500">
          {journeys.length} Deals mit Amplitude-Spur · chronologisch von links (älteste) nach rechts (jüngste)
        </p>
      </div>
      <div className="divide-y divide-gray-100">
        {journeys.map((j) => (
          <div key={j.entityId} className="px-6 py-3 flex items-start gap-4 hover:bg-gray-50">
            <div className="w-[260px] flex-shrink-0">
              <a
                href={hubspotDealUrl(j.entityId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-gray-900 hover:text-blue-600 inline-flex items-center gap-1"
              >
                {j.companyName}
                <ExternalLink className="h-3 w-3 text-gray-400" />
              </a>
              <div className="mt-1">
                <StageBadge
                  label={j.stageLabel}
                  isWon={j.stageIsWon}
                  isLost={j.stageIsLost}
                />
              </div>
            </div>
            <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1">
              {j.touchpoints.map((t, i) => (
                <span key={`${t.eventType}-${t.occurredAt}-${i}`} className="inline-flex items-center">
                  <TouchpointChip touchpoint={t} />
                  {i < j.touchpoints.length - 1 && (
                    <span className="mx-1 text-gray-300" aria-hidden="true">→</span>
                  )}
                </span>
              ))}
            </div>
            <div className="w-[100px] flex-shrink-0 text-right text-xs text-gray-500 tabular-nums">
              {j.touchpoints.length} TP
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StageBadge({ label, isWon, isLost }: { label: string; isWon: boolean; isLost: boolean }) {
  const cls = isWon
    ? 'bg-green-50 text-green-700 border-green-200'
    : isLost
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-gray-50 text-gray-600 border-gray-200';
  return (
    <span className={`inline-block px-2 py-0.5 text-xs rounded-full border ${cls}`} title={label}>
      {label}
    </span>
  );
}

function TouchpointChip({ touchpoint }: { touchpoint: Touchpoint }) {
  const date = new Date(touchpoint.occurredAt);
  const dateStr = date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
  const anchorClass: Record<Touchpoint['anchor'], string> = {
    marketing_acquisition: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
    marketing_page_sipgate_ai: 'bg-violet-50 text-violet-700 border-violet-200',
    marketing_page_sipgate_de: 'bg-purple-50 text-purple-700 border-purple-200',
    signup_atlantis_frontdesk: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    // PBX-Signup bleibt in der Signup-Familie (grün), aber als Teal-Variante
    // optisch unterscheidbar vom AI-Agents-spezifischen Emerald.
    signup_atlantis_other_product: 'bg-teal-50 text-teal-700 border-teal-200',
    lead_form_submitted: 'bg-blue-50 text-blue-700 border-blue-200',
    sipgate_ai_domain: 'bg-violet-50 text-violet-700 border-violet-200',
    agents_qualification_onboarding: 'bg-amber-50 text-amber-700 border-amber-200',
    agents_qualification_inproduct: 'bg-orange-50 text-orange-700 border-orange-200',
    // Bestandskunde: dezent slate, kein Marketing-Touch sondern Journey-
    // Startpunkt für Customer ohne Signup-Event.
    customer_since: 'bg-slate-50 text-slate-600 border-slate-200',
    // Preview/Trial: eigenes Cyan — zwischen Signup (emerald/teal) und Deal
    // (grau), signalisiert den Aktivierungsschritt.
    preview_trial_started: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    // HubSpot-Lifecycle bewusst dezent (grau, dashed border) — keine Marketing-
    // Touchpoints, nur Zeitanker damit man die Lücken zwischen Marketing-Event
    // und HubSpot-Schritt lesen kann.
    hubspot_lead_created: 'bg-gray-50 text-gray-600 border-gray-300 border-dashed',
    hubspot_deal_created: 'bg-gray-100 text-gray-700 border-gray-400 border-dashed',
  };
  // Anchor-Label im Tooltip — die zwei Quali-Anchors brauchen einen lesbaren
  // Kurz-Namen, weil der Tooltip die einzige Stelle ist, an der die Sub-Variante
  // sichtbar wird (im Chip steht nur "Quali-Submit").
  const anchorLabel: Record<Touchpoint['anchor'], string> = {
    marketing_acquisition: 'Marketing-Akquise (UTM/Click-ID, via device_id)',
    marketing_page_sipgate_ai: 'Marketing-Site sipgate.ai (Pre-Signup, via device_id)',
    marketing_page_sipgate_de: 'Marketing-Site sipgate.de (Pre-Signup, via device_id)',
    signup_atlantis_frontdesk: 'Signup Atlantis (AI Agents)',
    signup_atlantis_other_product: 'Signup Atlantis (anderes Produkt)',
    lead_form_submitted: 'Lead-Formular abgeschickt',
    sipgate_ai_domain: 'sipgate.ai-Domain',
    agents_qualification_onboarding: 'Quali (Onboarding)',
    agents_qualification_inproduct: 'Quali (In-Product)',
    customer_since: 'sipgate-Account angelegt',
    preview_trial_started: 'AI-Agents Preview/Trial aktiviert (Contract Finalized)',
    hubspot_lead_created: 'HubSpot Lifecycle',
    hubspot_deal_created: 'HubSpot Lifecycle',
  };
  const chipLabel = formatTouchpointLabel(touchpoint);
  const extras = [
    touchpoint.leadSourceDetails ? `Source: ${touchpoint.leadSourceDetails}` : null,
    touchpoint.inboundValue ? `Inbound: ${touchpoint.inboundValue}` : null,
    touchpoint.signupProduct ? `Produkt: ${touchpoint.signupProduct}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${anchorClass[touchpoint.anchor]}`}
      title={`${touchpoint.eventType} · ${anchorLabel[touchpoint.anchor]} · ${date.toLocaleString('de-DE')}${extras ? ` · ${extras}` : ''}`}
    >
      {chipLabel}
      <span className="text-current opacity-60 tabular-nums">{dateStr}</span>
    </span>
  );
}
