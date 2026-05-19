'use client';

import { useMemo, useState } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';
import type {
  MarketingFunnelResponse,
} from '@/app/api/marketing/funnel/route';
import type { Touchpoint } from '@/lib/amplitude/journeys';
import { formatAmplitudeEvent } from '@/lib/amplitude/format';
import { hubspotDealUrl } from '@/lib/hubspot/urls';
import { MarketingSankey, COLUMN_REGISTRY, type ColumnKey } from './MarketingSankey';
import type { MarketingFunnelJourney } from '@/app/api/marketing/funnel/route';

interface MarketingViewProps {
  data: MarketingFunnelResponse | undefined;
  isLoading: boolean;
}

// Date-Preset-Optionen für den Marketing-Filter. `null` = alle Entries seit
// HARD_FLOOR_DATE, sonst "Lead/Deal innerhalb der letzten N Tage erstellt".
type DatePresetDays = 30 | 90 | null;
const DATE_PRESETS: Array<{ key: string; label: string; days: DatePresetDays }> = [
  { key: '30', label: '30 Tage', days: 30 },
  { key: '90', label: '90 Tage', days: 90 },
  { key: 'all', label: 'seit 01.01.2026', days: null },
];

// Hartes Floor-Datum: davor existierte die AI-Agents-Lead-Pipeline in HubSpot
// quasi nicht (vereinzelte Test-Entries). Wird auf alle Date-Filter
// angewendet — auch "Alle" geht nie weiter zurück.
const HARD_FLOOR_DATE = new Date('2026-01-01T00:00:00.000Z').getTime();

export function MarketingView({ data, isLoading }: MarketingViewProps) {
  const [datePresetKey, setDatePresetKey] = useState<string>('90');
  // Sichtbare Sankey-Spalten — in-memory (kein localStorage). Default: alle 4
  // in der Registry-Reihenfolge.
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() =>
    COLUMN_REGISTRY.map(c => c.key),
  );
  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns(prev =>
      prev.includes(key)
        ? prev.filter(k => k !== key)
        // Wieder einfügen in der kanonischen Reihenfolge (Registry-Order), damit
        // die Spalten nicht plötzlich umgestellt werden.
        : COLUMN_REGISTRY.map(c => c.key).filter(k => prev.includes(k) || k === key),
    );
  };

  const filteredJourneys = useMemo(() => {
    if (!data) return [];
    const preset = DATE_PRESETS.find(p => p.key === datePresetKey) ?? DATE_PRESETS[DATE_PRESETS.length - 1];
    const presetCutoff =
      preset.days === null ? HARD_FLOOR_DATE : Date.now() - preset.days * 24 * 60 * 60 * 1000;
    // Floor immer angewendet — auch "Alle" geht nicht weiter zurück.
    const cutoff = Math.max(presetCutoff, HARD_FLOOR_DATE);
    return data.journeys.filter(j => {
      if (!j.createdate) return false;
      const t = new Date(j.createdate).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
  }, [data, datePresetKey]);

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
  // Top-of-funnel counts come from the legacy funnel array (Marketing-Touch
  // und Trial-Signup) und werden vom Sankey-Header genutzt — wir lassen sie
  // im API-Response unverändert, aber rendern keinen eigenen Funnel-Chart mehr.
  const marketingTouch = data.funnel.find(s => s.key === 'marketingTouch')?.count ?? 0;
  const trialSignup = data.funnel.find(s => s.key === 'trialSignup')?.count ?? 0;
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
      <DateFilterBar
        active={datePresetKey}
        onChange={setDatePresetKey}
        totalEntries={data.journeys.length}
        filteredEntries={filteredJourneys.length}
      />
      <ColumnToggleBar visible={visibleColumns} onToggle={toggleColumn} />
      <MarketingSankey
        journeys={filteredJourneys}
        marketingTouchTotal={marketingTouch}
        trialSignupTotal={trialSignup}
        visibleColumns={visibleColumns}
      />
      <JourneyTable journeys={tableJourneys} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date-Filter-Bar
// ---------------------------------------------------------------------------

interface DateFilterBarProps {
  active: string;
  onChange: (key: string) => void;
  totalEntries: number;
  filteredEntries: number;
}

function DateFilterBar({ active, onChange, totalEntries, filteredEntries }: DateFilterBarProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Erstellt in den letzten</span>
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
      <div className="text-xs text-gray-500 tabular-nums">
        {filteredEntries.toLocaleString('de-DE')} von {totalEntries.toLocaleString('de-DE')} Entries
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sankey-Column-Toggle-Bar
// ---------------------------------------------------------------------------

function ColumnToggleBar({
  visible,
  onToggle,
}: {
  visible: ColumnKey[];
  onToggle: (key: ColumnKey) => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap">
      <span className="text-xs text-gray-500">Sankey-Spalten</span>
      <div className="flex items-center gap-1">
        {COLUMN_REGISTRY.map(c => {
          const isOn = visible.includes(c.key);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onToggle(c.key)}
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
  );
}

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

// Lead-Form-Submit-Chip: einheitlich "Contact Form (<domain>)" — die genaue
// Form-Bezeichnung (z.B. "Jetzt Beratung vereinbaren...") wird absichtlich
// nicht im Chip gezeigt, weil sie zu lang und zu uneinheitlich ist. Volle
// Info bleibt im Tooltip via touchpoint.eventType.
function formatFormName(_raw: string, pageDomain: string | null): string {
  const shortDomain = pageDomain ? pageDomain.replace(/^www\./, '') : null;
  return shortDomain ? `Contact Form (${shortDomain})` : 'Contact Form';
}

function TouchpointChip({ touchpoint }: { touchpoint: Touchpoint }) {
  const date = new Date(touchpoint.occurredAt);
  const dateStr = date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
  const anchorClass: Record<Touchpoint['anchor'], string> = {
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
    signup_atlantis_frontdesk: 'Signup Atlantis (AI Agents)',
    signup_atlantis_other_product: 'Signup Atlantis (anderes Produkt)',
    lead_form_submitted: 'Lead-Formular abgeschickt',
    sipgate_ai_domain: 'sipgate.ai-Domain',
    agents_qualification_onboarding: 'Quali (Onboarding)',
    agents_qualification_inproduct: 'Quali (In-Product)',
    customer_since: 'sipgate-Account angelegt',
    hubspot_lead_created: 'HubSpot Lifecycle',
    hubspot_deal_created: 'HubSpot Lifecycle',
  };
  // Chip-Label: Anchor-spezifische Beschriftungen für Fälle, in denen das
  // generische Event-Label zu ungenau wäre (z.B. zwei Quali-Anchors aus dem
  // selben Roh-Event-Type). Lifecycle-Pseudo-Events nutzen ihren eventType
  // direkt, der Rest fällt auf das generische Mapping zurück.
  const chipLabel =
    touchpoint.anchor === 'signup_atlantis_frontdesk'
      ? 'Agent Signup'
      : touchpoint.anchor === 'signup_atlantis_other_product'
        ? 'PBX Signup'
        : touchpoint.anchor === 'lead_form_submitted'
          ? formatFormName(touchpoint.eventType, touchpoint.pageDomain)
          : touchpoint.anchor === 'agents_qualification_onboarding'
            ? 'Onboarding-Quali'
            : touchpoint.anchor === 'agents_qualification_inproduct'
              ? 'In-Product-Quali'
              : formatAmplitudeEvent(touchpoint.eventType);
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
