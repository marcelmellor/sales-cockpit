'use client';

import { ChevronDown, ChevronUp, ArrowUpDown } from 'lucide-react';
import { DealCard } from './DealCard';
import type { DealOverviewItem } from '@/app/api/deals/overview/route';
import type { SortField, SortDirection } from '@/app/pipeline/page';

interface DealListViewProps {
  deals: DealOverviewItem[];
  pipelineId: string;
  sortConfig?: {
    field: SortField;
    direction: SortDirection;
  };
  onSortChange: (field: SortField) => void;
  meetingsLoading?: boolean;
  stageHistoryLoading?: boolean;
}

export function DealListView({
  deals,
  pipelineId,
  sortConfig,
  onSortChange,
  meetingsLoading,
  stageHistoryLoading,
}: DealListViewProps) {
  const totalRevenue = deals.reduce((sum, deal) => sum + deal.revenue, 0);

  const SortableHeader = ({ field, label, className }: { field: SortField; label: string; className?: string }) => {
    const isActive = sortConfig?.field === field;
    const isAsc = sortConfig?.direction === 'asc';

    return (
      <button
        onClick={() => onSortChange(field)}
        className={`flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 transition-colors ${className || ''}`}
      >
        {label}
        {isActive ? (
          isAsc ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    );
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* List Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-gray-900">Offene Deals</h3>
          <span className="px-2 py-0.5 text-sm rounded-full bg-blue-100 text-blue-700">
            {deals.length}
          </span>
        </div>

        <div className="text-sm text-gray-600">
          <span>
            Gesamt-Umsatz: <strong>{(Math.round(totalRevenue / 10) * 10).toLocaleString('de-DE')} EUR</strong>
          </span>
        </div>
      </div>

      {/* Deals List */}
      <div>
        {deals.length > 0 ? (
          <>
            {/* Column Headers */}
            <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-4 bg-gray-50/50">
              {/* Company name column */}
              <div className="flex-1 min-w-0">
                <span className="text-xs text-gray-500">Firma</span>
              </div>

              {/* Stage column */}
              <span className="text-xs text-gray-500 w-[140px]">Stage</span>

              {/* Metrics headers */}
              <div className="flex items-center gap-6 text-sm">
                <SortableHeader field="revenue" label="Umsatz" className="min-w-[120px] justify-end" />
                <span className="text-xs text-gray-500 w-[120px]">PM</span>
                <span className="text-xs text-gray-500 w-[80px] text-right">In Stage</span>
                <SortableHeader field="nextAppointment" label="Nächster Termin" className="min-w-[140px]" />
                {/* Link indicator placeholder */}
                <div className="w-4" />
              </div>
            </div>

            {/* Deal Cards */}
            <div className="divide-y divide-gray-100">
              {deals.map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  pipelineId={pipelineId}
                  meetingsLoading={meetingsLoading}
                  stageHistoryLoading={stageHistoryLoading}
                  showStage
                />
              ))}
            </div>
          </>
        ) : (
          <div className="px-4 py-8 text-center text-gray-400">
            Keine offenen Deals vorhanden
          </div>
        )}
      </div>
    </div>
  );
}
