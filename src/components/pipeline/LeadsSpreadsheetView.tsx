'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ArrowUpDown, Settings2, ExternalLink, Download, Search, X } from 'lucide-react';
import type { LeadOverviewItem } from '@/app/api/leads/overview/route';

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;
const STORAGE_KEY = 'leads-spreadsheet-visible-columns';

function hubspotContactUrl(contactId: string | null): string | null {
  if (!HUBSPOT_PORTAL_ID || !contactId) return null;
  return `https://app-eu1.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/contact/${contactId}`;
}

function hubspotCompanyUrl(companyId: string | null): string | null {
  if (!HUBSPOT_PORTAL_ID || !companyId) return null;
  return `https://app-eu1.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/company/${companyId}`;
}

function hubspotDealUrl(dealId: string | null): string | null {
  if (!HUBSPOT_PORTAL_ID || !dealId) return null;
  return `https://app-eu1.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-3/${dealId}`;
}

// Leads haben keine eigene Detailseite — wir linken primär auf den
// verknüpften Kontakt (mit der eigentlichen History), sonst auf die Firma.
function hubspotLeadRecordUrl(lead: LeadOverviewItem): string | null {
  return hubspotContactUrl(lead.contactId) || hubspotCompanyUrl(lead.companyId);
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ISO-8601 week — gleiche Logik wie im Deals-Spreadsheet.
function getIsoWeek(value: string | null): { week: number; year: number } | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  const diffDays = Math.round((target.getTime() - firstThursday.getTime()) / 86400000);
  const week = 1 + Math.floor(diffDays / 7);
  return { week, year: target.getUTCFullYear() };
}

function formatIsoWeek(value: string | null): string {
  const w = getIsoWeek(value);
  if (!w) return '—';
  const shortYear = String(w.year).slice(-2);
  return `KW ${String(w.week).padStart(2, '0')} '${shortYear}`;
}

function isoWeekSortValue(value: string | null): number | null {
  const w = getIsoWeek(value);
  return w ? w.year * 100 + w.week : null;
}

// Liefert die untere Grenze des Range-Strings aus `inbound_volumen`,
// z.B. "0-1000" → 0, "1000-2000" → 1000, ">5000" → 5000.
function inboundVolumenLowerBound(range: string | null): number | null {
  if (!range) return null;
  const m = range.match(/^(\d+)/) || range.match(/^>(\d+)/);
  return m ? Number(m[1]) : null;
}

// Zahl für Sortierung: exakte agentsMinuten bevorzugen, sonst Untergrenze
// des inboundVolumen-Ranges als konservative Näherung.
function minutenSortValue(lead: LeadOverviewItem): number | null {
  if (lead.agentsMinuten != null) return lead.agentsMinuten;
  const lower = inboundVolumenLowerBound(lead.inboundVolumen);
  return lower;
}

function minutenDisplay(lead: LeadOverviewItem): string {
  if (lead.agentsMinuten != null) return `${lead.agentsMinuten.toLocaleString('de-DE')}`;
  if (lead.inboundVolumen) return lead.inboundVolumen;
  return '—';
}

// HubSpot liefert Original Source als Enum in SCREAMING_SNAKE_CASE
// ("DIRECT_TRAFFIC", "ORGANIC_SEARCH", …). Für die Anzeige in Title-Case
// umformen, damit es wie im HubSpot-Sidebar aussieht ("Direct Traffic").
function formatAnalyticsSource(value: string | null): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split('_')
    .map(w => (w.length === 0 ? '' : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

type ColumnKey =
  | 'companyName'
  | 'leadName'
  | 'leadStage'
  | 'source'
  | 'leadSource'
  | 'product'
  | 'minuten'
  | 'inboundVolumen'
  | 'daysInStage'
  | 'leadAge'
  | 'stageEnteredAt'
  | 'createdate'
  | 'createdateWeek'
  | 'existingDeal'
  | 'analyticsSource'
  | 'analyticsFirstUrl'
  | 'utmSource'
  | 'utmMedium'
  | 'utmCampaign'
  | 'utmTerm'
  | 'utmContent'
  | 'hubspotLink'
  | 'leadId';

interface ColumnDef {
  key: ColumnKey;
  label: string;
  align?: 'left' | 'right';
  sortable: boolean;
  getSortValue: (l: LeadOverviewItem) => number | string | null;
  render: (l: LeadOverviewItem) => React.ReactNode;
  getCsvValue: (l: LeadOverviewItem) => string;
}

const COLUMNS: ColumnDef[] = [
  {
    key: 'companyName',
    label: 'Firma',
    sortable: true,
    getSortValue: (l) => (l.companyName || l.leadName || '').toLowerCase(),
    render: (l) => (
      <span className="font-medium text-gray-900">{l.companyName || l.leadName}</span>
    ),
    getCsvValue: (l) => l.companyName || l.leadName || '',
  },
  {
    key: 'leadName',
    label: 'Lead-Name',
    sortable: true,
    getSortValue: (l) => (l.leadName || '').toLowerCase(),
    render: (l) => <span className="text-gray-700">{l.leadName || '—'}</span>,
    getCsvValue: (l) => l.leadName || '',
  },
  {
    key: 'leadStage',
    label: 'Stage',
    sortable: true,
    getSortValue: (l) => l.leadStage.toLowerCase(),
    render: (l) => <span className="text-gray-700">{l.leadStage}</span>,
    getCsvValue: (l) => l.leadStage,
  },
  {
    key: 'source',
    label: 'Source (Enum)',
    sortable: true,
    getSortValue: (l) => (l.source || '').toLowerCase(),
    render: (l) => <span className="text-gray-600">{l.source || '—'}</span>,
    getCsvValue: (l) => l.source || '',
  },
  {
    key: 'leadSource',
    label: 'Lead-Source (Freitext)',
    sortable: true,
    getSortValue: (l) => (l.leadSource || '').toLowerCase(),
    render: (l) => <span className="text-gray-600">{l.leadSource || '—'}</span>,
    getCsvValue: (l) => l.leadSource || '',
  },
  {
    key: 'product',
    label: 'Produkte',
    sortable: true,
    getSortValue: (l) => l.product.join(', ').toLowerCase(),
    render: (l) =>
      l.product.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {l.product.map((p) => (
            <span
              key={p}
              className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-purple-50 text-purple-700 border border-purple-100"
            >
              {p}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-gray-400">—</span>
      ),
    getCsvValue: (l) => l.product.join(', '),
  },
  {
    key: 'minuten',
    label: 'Minuten',
    align: 'right',
    sortable: true,
    getSortValue: (l) => minutenSortValue(l),
    render: (l) => (
      <span className={`tabular-nums ${minutenSortValue(l) == null ? 'text-gray-400' : 'text-gray-900'}`}>
        {minutenDisplay(l)}
      </span>
    ),
    getCsvValue: (l) => {
      const v = minutenDisplay(l);
      return v === '—' ? '' : v;
    },
  },
  {
    key: 'inboundVolumen',
    label: 'Inbound-Volumen',
    sortable: true,
    getSortValue: (l) => inboundVolumenLowerBound(l.inboundVolumen),
    render: (l) => <span className="text-gray-700">{l.inboundVolumen || '—'}</span>,
    getCsvValue: (l) => l.inboundVolumen || '',
  },
  {
    key: 'daysInStage',
    label: 'In Stage (Tage)',
    align: 'right',
    sortable: true,
    getSortValue: (l) => (l.daysInStage >= 0 ? l.daysInStage : null),
    render: (l) => (
      <span className="tabular-nums text-gray-700">{l.daysInStage >= 0 ? l.daysInStage : '—'}</span>
    ),
    getCsvValue: (l) => (l.daysInStage >= 0 ? String(l.daysInStage) : ''),
  },
  {
    key: 'leadAge',
    label: 'Lead-Alter (Tage)',
    align: 'right',
    sortable: true,
    getSortValue: (l) => l.leadAge,
    render: (l) => <span className="tabular-nums text-gray-700">{l.leadAge}</span>,
    getCsvValue: (l) => String(l.leadAge),
  },
  {
    key: 'stageEnteredAt',
    label: 'In Stage seit',
    sortable: true,
    getSortValue: (l) => (l.stageEnteredAt ? new Date(l.stageEnteredAt).getTime() : null),
    render: (l) => <span className="text-gray-700">{formatDate(l.stageEnteredAt)}</span>,
    getCsvValue: (l) => {
      const v = formatDate(l.stageEnteredAt);
      return v === '—' ? '' : v;
    },
  },
  {
    key: 'createdate',
    label: 'Erstellt am',
    sortable: true,
    getSortValue: (l) => (l.createdate ? new Date(l.createdate).getTime() : null),
    render: (l) => <span className="text-gray-700">{formatDate(l.createdate)}</span>,
    getCsvValue: (l) => {
      const v = formatDate(l.createdate);
      return v === '—' ? '' : v;
    },
  },
  {
    key: 'createdateWeek',
    label: 'KW Erstellt',
    sortable: true,
    getSortValue: (l) => isoWeekSortValue(l.createdate),
    render: (l) => <span className="text-gray-700">{formatIsoWeek(l.createdate)}</span>,
    getCsvValue: (l) => {
      const v = formatIsoWeek(l.createdate);
      return v === '—' ? '' : v;
    },
  },
  {
    key: 'existingDeal',
    label: 'Bestehender Deal',
    sortable: true,
    getSortValue: (l) => (l.existingDealName || '').toLowerCase(),
    render: (l) => {
      if (!l.existingDealId) return <span className="text-gray-400">—</span>;
      const url = hubspotDealUrl(l.existingDealId);
      const label = l.existingDealName || 'offen';
      if (!url) return <span className="text-amber-700">{label}</span>;
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-800"
          onClick={(e) => e.stopPropagation()}
          title={`Bestehender Deal: ${label}`}
        >
          {label}
          <ExternalLink className="h-3 w-3" />
        </a>
      );
    },
    getCsvValue: (l) => l.existingDealName || (l.existingDealId ? 'offen' : ''),
  },
  {
    key: 'analyticsSource',
    label: 'Original Source',
    sortable: true,
    getSortValue: (l) => (l.analyticsSource || '').toLowerCase(),
    render: (l) => (
      <span className={l.analyticsSource ? 'text-gray-700' : 'text-gray-400'}>
        {formatAnalyticsSource(l.analyticsSource)}
      </span>
    ),
    getCsvValue: (l) => {
      const v = formatAnalyticsSource(l.analyticsSource);
      return v === '—' ? '' : v;
    },
  },
  {
    key: 'analyticsFirstUrl',
    label: 'Erste URL',
    sortable: true,
    getSortValue: (l) => (l.analyticsFirstUrl || '').toLowerCase(),
    render: (l) => {
      if (!l.analyticsFirstUrl) return <span className="text-gray-400">—</span>;
      // Nur externe http(s)-URLs sind sinnvoll als Link; lokale/dev-Pfade
      // (file://, /users/…) klickbar zu machen wäre irreführend.
      const isExternal = /^https?:\/\//i.test(l.analyticsFirstUrl);
      if (isExternal) {
        return (
          <a
            href={l.analyticsFirstUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 max-w-xs truncate"
            onClick={(e) => e.stopPropagation()}
            title={l.analyticsFirstUrl}
          >
            <span className="truncate">{l.analyticsFirstUrl}</span>
            <ExternalLink className="h-3 w-3 flex-shrink-0" />
          </a>
        );
      }
      return (
        <span className="text-gray-700 max-w-xs truncate inline-block" title={l.analyticsFirstUrl}>
          {l.analyticsFirstUrl}
        </span>
      );
    },
    getCsvValue: (l) => l.analyticsFirstUrl || '',
  },
  // UTM-Parameter — alle fünf gleich gebaut, ausgeblendet als
   // truncated Text mit vollem Wert im Tooltip.
  ...(
    [
      ['utmSource', 'UTM Source', (l: LeadOverviewItem) => l.utmSource],
      ['utmMedium', 'UTM Medium', (l: LeadOverviewItem) => l.utmMedium],
      ['utmCampaign', 'UTM Campaign', (l: LeadOverviewItem) => l.utmCampaign],
      ['utmTerm', 'UTM Term', (l: LeadOverviewItem) => l.utmTerm],
      ['utmContent', 'UTM Content', (l: LeadOverviewItem) => l.utmContent],
    ] as const
  ).map(([key, label, get]): ColumnDef => ({
    key: key as ColumnKey,
    label,
    sortable: true,
    getSortValue: (l) => (get(l) || '').toLowerCase(),
    render: (l) => {
      const v = get(l);
      if (!v) return <span className="text-gray-400">—</span>;
      return (
        <span className="text-gray-700 max-w-xs truncate inline-block" title={v}>
          {v}
        </span>
      );
    },
    getCsvValue: (l) => get(l) || '',
  })),
  {
    key: 'hubspotLink',
    label: 'HubSpot',
    sortable: false,
    getSortValue: () => null,
    render: (l) => {
      const url = hubspotLeadRecordUrl(l);
      if (!url) return <span className="text-gray-400">—</span>;
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700"
          onClick={(e) => e.stopPropagation()}
        >
          Öffnen
          <ExternalLink className="h-3 w-3" />
        </a>
      );
    },
    getCsvValue: (l) => hubspotLeadRecordUrl(l) ?? '',
  },
  {
    key: 'leadId',
    label: 'Lead-ID',
    sortable: true,
    getSortValue: (l) => l.id,
    render: (l) => <span className="text-gray-500 font-mono text-xs">{l.id}</span>,
    getCsvValue: (l) => l.id,
  },
];

const COLUMN_MAP: Record<ColumnKey, ColumnDef> = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c]),
) as Record<ColumnKey, ColumnDef>;

function csvEscape(value: string): string {
  if (/[";\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(columns: ColumnDef[], leads: LeadOverviewItem[]): string {
  const header = columns.map((c) => csvEscape(c.label)).join(';');
  const rows = leads.map((l) => columns.map((c) => csvEscape(c.getCsvValue(l))).join(';'));
  return '\ufeff' + [header, ...rows].join('\r\n');
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvFilename(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `leads-${yyyy}${mm}${dd}-${hh}${mi}.csv`;
}

const DEFAULT_VISIBLE: ColumnKey[] = [
  'companyName',
  'leadStage',
  'leadSource',
  'product',
  'minuten',
  'leadAge',
  'existingDeal',
  'hubspotLink',
];

interface LeadsSpreadsheetViewProps {
  leads: LeadOverviewItem[];
}

export function LeadsSpreadsheetView({ leads }: LeadsSpreadsheetViewProps) {
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_VISIBLE);
  const [sortKey, setSortKey] = useState<ColumnKey>('minuten');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  // Spaltenwahl aus localStorage hydraten (siehe SpreadsheetView für das
  // Rationale: läuft bewusst im Effect damit SSR = DEFAULT_VISIBLE).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter((k): k is ColumnKey => typeof k === 'string' && k in COLUMN_MAP);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (valid.length > 0) setVisibleColumns(valid);
    } catch {
      // ignore corrupt storage
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(visibleColumns));
    } catch {
      // ignore quota / disabled storage
    }
  }, [visibleColumns]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [pickerOpen]);

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleSort = (key: ColumnKey) => {
    const col = COLUMN_MAP[key];
    if (!col.sortable) return;
    if (sortKey === key) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      const firstValue = col.getSortValue(leads[0] ?? ({} as LeadOverviewItem));
      setSortDirection(typeof firstValue === 'number' ? 'desc' : 'asc');
    }
  };

  // Filter (case-insensitive substring over textual columns) and sort in one
  // pass. Count badge matches the visible rows because filtering happens before
  // sorting.
  const sortedLeads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = !q
      ? leads
      : leads.filter((l) => {
          const haystack = [
            l.companyName || '',
            l.leadName || '',
            l.leadStage,
            l.source || '',
            l.leadSource || '',
            l.product.join(' '),
            l.existingDealName || '',
            l.inboundVolumen || '',
            l.analyticsSource || '',
            formatAnalyticsSource(l.analyticsSource),
            l.analyticsFirstUrl || '',
            l.utmSource || '',
            l.utmMedium || '',
            l.utmCampaign || '',
            l.utmTerm || '',
            l.utmContent || '',
            l.id,
          ]
            .join(' ')
            .toLowerCase();
          return haystack.includes(q);
        });
    const col = COLUMN_MAP[sortKey];
    if (!col?.sortable) return filtered;
    const mul = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.getSortValue(a);
      const vb = col.getSortValue(b);
      if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
      return String(va).localeCompare(String(vb), 'de') * mul;
    });
  }, [leads, searchQuery, sortKey, sortDirection]);

  const columnsToRender = COLUMNS.filter((c) => visibleColumns.includes(c.key));

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 whitespace-nowrap">Leads-Spreadsheet</h3>
          <span className="px-2 py-0.5 text-sm rounded-full bg-blue-100 text-blue-700 whitespace-nowrap">
            {sortedLeads.length}
            {searchQuery.trim() && leads.length !== sortedLeads.length ? (
              <span className="text-blue-500"> / {leads.length}</span>
            ) : null}
          </span>
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Suchen…"
              className="w-full pl-7 pr-7 py-1 text-xs bg-white border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-700"
                title="Suche zurücksetzen"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => downloadCsv(buildCsv(columnsToRender, sortedLeads), csvFilename())}
            disabled={sortedLeads.length === 0 || columnsToRender.length === 0}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="CSV mit aktuellen Spalten, Filtern und Sortierung exportieren"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
          <div className="relative" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Spalten ({visibleColumns.length})
            </button>
            {pickerOpen && (
              <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 max-h-96 overflow-y-auto">
                {COLUMNS.map((col) => (
                  <label
                    key={col.key}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={visibleColumns.includes(col.key)}
                      onChange={() => toggleColumn(col.key)}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                    />
                    {col.label}
                  </label>
                ))}
                <div className="border-t border-gray-100 mt-1 pt-1 flex items-center justify-between px-3 py-1.5">
                  <button
                    type="button"
                    onClick={() => setVisibleColumns(DEFAULT_VISIBLE)}
                    className="text-xs text-gray-500 hover:text-gray-900"
                  >
                    Zurücksetzen
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleColumns(COLUMNS.map((c) => c.key))}
                    className="text-xs text-gray-500 hover:text-gray-900"
                  >
                    Alle auswählen
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      {sortedLeads.length === 0 ? (
        <div className="px-4 py-8 text-center text-gray-400">
          {searchQuery.trim() ? `Keine Treffer für „${searchQuery.trim()}"` : 'Keine Leads vorhanden'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50/50">
              <tr className="border-b border-gray-100">
                {columnsToRender.map((col) => {
                  const isActive = sortKey === col.key;
                  const isAsc = sortDirection === 'asc';
                  return (
                    <th
                      key={col.key}
                      className={`px-3 py-2 text-xs font-normal text-gray-500 whitespace-nowrap ${
                        col.align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {col.sortable ? (
                        <button
                          type="button"
                          onClick={() => handleSort(col.key)}
                          className={`inline-flex items-center gap-1 hover:text-gray-900 transition-colors ${
                            col.align === 'right' ? 'flex-row-reverse' : ''
                          }`}
                        >
                          {col.label}
                          {isActive ? (
                            isAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        col.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedLeads.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                  {columnsToRender.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    >
                      {col.render(lead)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
