'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ArrowUpDown, Settings2, ExternalLink, Download } from 'lucide-react';
import type { DealOverviewItem, RevenueSource } from '@/app/api/deals/overview/route';

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;
const STORAGE_KEY = 'spreadsheet-visible-columns';

function hubspotUrl(dealId: string): string | null {
  if (!HUBSPOT_PORTAL_ID) return null;
  return `https://app-eu1.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-3/${dealId}`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ISO-8601 week: week 1 is the week containing the first Thursday of the year
// (matches Germany's DIN 1355 / what HubSpot and Google Calendar display as "KW").
function getIsoWeek(value: string | null): { week: number; year: number } | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Copy so we can mutate without affecting the caller's date
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Thursday of this week determines the ISO week-year
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon = 0 ... Sun = 6
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
  // Show "KW 17 '26" — year shortened because column width matters
  const shortYear = String(w.year).slice(-2);
  return `KW ${String(w.week).padStart(2, '0')} '${shortYear}`;
}

// Sort value: year * 100 + week so different years sort correctly.
function isoWeekSortValue(value: string | null): number | null {
  const w = getIsoWeek(value);
  return w ? w.year * 100 + w.week : null;
}

const REVENUE_SOURCE_LABEL: Record<RevenueSource, string> = {
  line_items: 'Line-Items (hs_mrr)',
  agents_package: 'AI-Agent-Paket (aus Minuten)',
  tcv_laufzeit: 'TCV / Vertragsdauer',
  none: '—',
};

type ColumnKey =
  | 'companyName'
  | 'dealStage'
  | 'revenue'
  | 'revenueSource'
  | 'agentsMinuten'
  | 'productManager'
  | 'angeboteneProdukte'
  | 'daysInStage'
  | 'dealAge'
  | 'stageEnteredAt'
  | 'createdate'
  | 'createdateWeek'
  | 'closedate'
  | 'nextAppointmentDate'
  | 'nextAppointmentTitle'
  | 'hubspotLink'
  | 'dealId';

interface ColumnDef {
  key: ColumnKey;
  label: string;
  align?: 'left' | 'right';
  sortable: boolean;
  // Used for sorting. null values sort last.
  getSortValue: (d: DealOverviewItem) => number | string | null;
  render: (d: DealOverviewItem) => React.ReactNode;
  // Plain-text representation for CSV export. Matches UI formatting so the
  // exported sheet looks like what the user sees.
  getCsvValue: (d: DealOverviewItem) => string;
}

function formatMrrForCsv(value: number): string {
  // Match UI rounding (Math.round(v/10)*10) + de-DE formatting so Excel-DE
  // reads the cell as a number.
  return (Math.round(value / 10) * 10).toLocaleString('de-DE');
}

const COLUMNS: ColumnDef[] = [
  {
    key: 'companyName',
    label: 'Firma',
    sortable: true,
    getSortValue: (d) => d.companyName.toLowerCase(),
    render: (d) => <span className="font-medium text-gray-900">{d.companyName}</span>,
    getCsvValue: (d) => d.companyName,
  },
  {
    key: 'dealStage',
    label: 'Stage',
    sortable: true,
    getSortValue: (d) => d.dealStage.toLowerCase(),
    render: (d) => <span className="text-gray-700">{d.dealStage}</span>,
    getCsvValue: (d) => d.dealStage,
  },
  {
    key: 'revenue',
    label: 'MRR',
    align: 'right',
    sortable: true,
    getSortValue: (d) => d.revenue,
    render: (d) => (
      <span className="text-gray-900 tabular-nums">
        {(Math.round(d.revenue / 10) * 10).toLocaleString('de-DE')} <span className="text-gray-400">EUR</span>
      </span>
    ),
    getCsvValue: (d) => formatMrrForCsv(d.revenue),
  },
  {
    key: 'revenueSource',
    label: 'MRR-Quelle',
    sortable: true,
    getSortValue: (d) => d.revenueSource,
    render: (d) => <span className="text-gray-600">{REVENUE_SOURCE_LABEL[d.revenueSource]}</span>,
    getCsvValue: (d) => REVENUE_SOURCE_LABEL[d.revenueSource],
  },
  {
    key: 'agentsMinuten',
    label: 'Agents Min.',
    align: 'right',
    sortable: true,
    getSortValue: (d) => d.agentsMinuten,
    render: (d) => (
      <span className={`tabular-nums ${d.agentsMinuten === 0 ? 'text-gray-400' : 'text-gray-900'}`}>
        {d.agentsMinuten === 0 ? '—' : d.agentsMinuten.toLocaleString('de-DE')}
      </span>
    ),
    getCsvValue: (d) => (d.agentsMinuten === 0 ? '' : d.agentsMinuten.toLocaleString('de-DE')),
  },
  {
    key: 'productManager',
    label: 'PM',
    sortable: true,
    getSortValue: (d) => d.productManager.toLowerCase(),
    render: (d) => <span className="text-gray-700">{d.productManager || '—'}</span>,
    getCsvValue: (d) => d.productManager,
  },
  {
    key: 'angeboteneProdukte',
    label: 'Angebotene Produkte',
    sortable: true,
    getSortValue: (d) => d.angeboteneProdukte.toLowerCase(),
    render: (d) => <span className="text-gray-600">{d.angeboteneProdukte || '—'}</span>,
    getCsvValue: (d) => d.angeboteneProdukte,
  },
  {
    key: 'daysInStage',
    label: 'In Stage (Tage)',
    align: 'right',
    sortable: true,
    getSortValue: (d) => (d.daysInStage >= 0 ? d.daysInStage : null),
    render: (d) => (
      <span className="tabular-nums text-gray-700">{d.daysInStage >= 0 ? d.daysInStage : '—'}</span>
    ),
    getCsvValue: (d) => (d.daysInStage >= 0 ? String(d.daysInStage) : ''),
  },
  {
    key: 'dealAge',
    label: 'Deal-Alter (Tage)',
    align: 'right',
    sortable: true,
    getSortValue: (d) => d.dealAge,
    render: (d) => <span className="tabular-nums text-gray-700">{d.dealAge}</span>,
    getCsvValue: (d) => String(d.dealAge),
  },
  {
    key: 'stageEnteredAt',
    label: 'In Stage seit',
    sortable: true,
    getSortValue: (d) => (d.stageEnteredAt ? new Date(d.stageEnteredAt).getTime() : null),
    render: (d) => <span className="text-gray-700">{formatDate(d.stageEnteredAt)}</span>,
    getCsvValue: (d) => {
      const v = formatDate(d.stageEnteredAt);
      return v === '—' ? '' : v;
    },
  },
  {
    key: 'createdate',
    label: 'Erstellt am',
    sortable: true,
    getSortValue: (d) => (d.createdate ? new Date(d.createdate).getTime() : null),
    render: (d) => <span className="text-gray-700">{formatDate(d.createdate)}</span>,
    getCsvValue: (d) => {
      const v = formatDate(d.createdate);
      return v === '—' ? '' : v;
    },
  },
  {
    key: 'createdateWeek',
    label: 'KW Erstellt',
    sortable: true,
    getSortValue: (d) => isoWeekSortValue(d.createdate),
    render: (d) => <span className="text-gray-700">{formatIsoWeek(d.createdate)}</span>,
    getCsvValue: (d) => {
      const v = formatIsoWeek(d.createdate);
      return v === '—' ? '' : v;
    },
  },
  {
    key: 'closedate',
    label: 'Close-Date',
    sortable: true,
    getSortValue: (d) => (d.closedate ? new Date(d.closedate).getTime() : null),
    render: (d) => <span className="text-gray-700">{formatDate(d.closedate)}</span>,
    getCsvValue: (d) => {
      const v = formatDate(d.closedate);
      return v === '—' ? '' : v;
    },
  },
  {
    key: 'nextAppointmentDate',
    label: 'Nächster Termin',
    sortable: true,
    getSortValue: (d) => (d.nextAppointment?.date ? new Date(d.nextAppointment.date).getTime() : null),
    render: (d) => <span className="text-gray-700">{formatDateTime(d.nextAppointment?.date || null)}</span>,
    getCsvValue: (d) => {
      const v = formatDateTime(d.nextAppointment?.date || null);
      return v === '—' ? '' : v;
    },
  },
  {
    key: 'nextAppointmentTitle',
    label: 'Termin-Titel',
    sortable: true,
    getSortValue: (d) => (d.nextAppointment?.title || '').toLowerCase(),
    render: (d) => <span className="text-gray-600 truncate">{d.nextAppointment?.title || '—'}</span>,
    getCsvValue: (d) => d.nextAppointment?.title || '',
  },
  {
    key: 'hubspotLink',
    label: 'HubSpot',
    sortable: false,
    getSortValue: () => null,
    render: (d) => {
      const url = hubspotUrl(d.id);
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
    getCsvValue: (d) => hubspotUrl(d.id) ?? '',
  },
  {
    key: 'dealId',
    label: 'Deal-ID',
    sortable: true,
    getSortValue: (d) => d.id,
    render: (d) => <span className="text-gray-500 font-mono text-xs">{d.id}</span>,
    getCsvValue: (d) => d.id,
  },
];

const COLUMN_MAP: Record<ColumnKey, ColumnDef> = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c]),
) as Record<ColumnKey, ColumnDef>;

// Excel-DE opens CSVs split on ';' out of the box. Quote a field only when it
// contains the separator, a quote, or a line break (RFC 4180).
function csvEscape(value: string): string {
  if (/[";\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(columns: ColumnDef[], deals: DealOverviewItem[]): string {
  const header = columns.map((c) => csvEscape(c.label)).join(';');
  const rows = deals.map((d) => columns.map((c) => csvEscape(c.getCsvValue(d))).join(';'));
  // Leading BOM so Excel picks up UTF-8 (umlauts, em dashes) without asking.
  // CRLF line endings because that's what Excel writes and some tools choke on LF.
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
  return `deals-${yyyy}${mm}${dd}-${hh}${mi}.csv`;
}

const DEFAULT_VISIBLE: ColumnKey[] = [
  'companyName',
  'dealStage',
  'revenue',
  'revenueSource',
  'productManager',
  'nextAppointmentDate',
  'hubspotLink',
];

interface SpreadsheetViewProps {
  deals: DealOverviewItem[];
}

export function SpreadsheetView({ deals }: SpreadsheetViewProps) {
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_VISIBLE);
  const [sortKey, setSortKey] = useState<ColumnKey>('revenue');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Hydrate column selection from localStorage. This intentionally runs in an
  // effect (not a lazy useState initializer) so the SSR render uses
  // DEFAULT_VISIBLE and hydration matches — the per-user saved selection is
  // applied on the first client effect tick.
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

  // Persist column selection
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(visibleColumns));
    } catch {
      // ignore quota / disabled storage
    }
  }, [visibleColumns]);

  // Close picker on outside click
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
      // numeric columns feel better desc-first, text asc-first
      const firstValue = col.getSortValue(deals[0] ?? ({} as DealOverviewItem));
      setSortDirection(typeof firstValue === 'number' ? 'desc' : 'asc');
    }
  };

  const sortedDeals = useMemo(() => {
    const col = COLUMN_MAP[sortKey];
    if (!col?.sortable) return deals;
    const mul = sortDirection === 'asc' ? 1 : -1;
    return [...deals].sort((a, b) => {
      const va = col.getSortValue(a);
      const vb = col.getSortValue(b);
      // null / undefined always sort last, regardless of direction
      if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
      return String(va).localeCompare(String(vb), 'de') * mul;
    });
  }, [deals, sortKey, sortDirection]);

  // Preserve defined column order, only include visible ones
  const columnsToRender = COLUMNS.filter((c) => visibleColumns.includes(c.key));

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-gray-900">Spreadsheet</h3>
          <span className="px-2 py-0.5 text-sm rounded-full bg-blue-100 text-blue-700">
            {sortedDeals.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => downloadCsv(buildCsv(columnsToRender, sortedDeals), csvFilename())}
            disabled={sortedDeals.length === 0 || columnsToRender.length === 0}
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
      {sortedDeals.length === 0 ? (
        <div className="px-4 py-8 text-center text-gray-400">Keine Deals vorhanden</div>
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
              {sortedDeals.map((deal) => (
                <tr key={deal.id} className="hover:bg-gray-50 transition-colors">
                  {columnsToRender.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    >
                      {col.render(deal)}
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
