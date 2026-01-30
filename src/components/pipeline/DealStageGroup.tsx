'use client';

import { ChevronDown, ChevronUp, ArrowUpDown } from 'lucide-react';
import { useState } from 'react';
import { DealCard } from './DealCard';
import { getStageColor } from '@/lib/stage-colors';
import type { DealOverviewItem } from '@/app/api/deals/overview/route';
import type { SortField, SortDirection } from '@/app/pipeline/page';

interface DealStageGroupProps {
  stage: {
    id: string;
    label: string;
    probability: number;
  };
  deals: DealOverviewItem[];
  pipelineId: string;
  pipelineName?: string;
  sortConfig?: {
    field: SortField;
    direction: SortDirection;
  };
  onSortChange: (field: SortField) => void;
  meetingsLoading?: boolean;
  stageHistoryLoading?: boolean;
}

export function DealStageGroup({
  stage,
  deals,
  pipelineId,
  pipelineName,
  sortConfig,
  onSortChange,
  meetingsLoading,
  stageHistoryLoading,
}: DealStageGroupProps) {
  const showAgentsMinuten = pipelineName === 'AI Agents';
  const [isExpanded, setIsExpanded] = useState(true);
  const stageColors = getStageColor(stage.label);

  const totalRevenue = deals.reduce((sum, deal) => sum + deal.revenue, 0);
  const weightedRevenue = totalRevenue * stage.probability;

  const SortableHeader = ({ field, label, className }: { field: SortField; label: string; className?: string }) => {
    const isActive = sortConfig?.field === field;
    const isAsc = sortConfig?.direction === 'asc';

    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSortChange(field);
        }}
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
      {/* Stage Header */}
      <div
        className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between cursor-pointer hover:bg-gray-100 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          )}
          <h3 className="font-semibold text-gray-900">{stage.label}</h3>
          <span
            className="px-2 py-0.5 text-sm rounded-full"
            style={{ backgroundColor: stageColors.bg, color: stageColors.text }}
          >
            {deals.length}
          </span>
        </div>

        <div className="text-sm text-gray-600" title={`Ungewichtet: ${(Math.round(totalRevenue / 10) * 10).toLocaleString('de-DE')} EUR`}>
          <span>
            Umsatz: <strong>{(Math.round(weightedRevenue / 10) * 10).toLocaleString('de-DE')} EUR</strong>
            <span className="text-gray-400 ml-1">({Math.round(stage.probability * 100)}%)</span>
          </span>
        </div>
      </div>

      {/* Deals List */}
      {isExpanded && (
        <div>
          {deals.length > 0 ? (
            <>
              {/* Column Headers */}
              <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-4 bg-gray-50/50">
                {/* Company name column */}
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-gray-500">Firma</span>
                </div>

                {/* Metrics headers */}
                <div className="flex items-center gap-6 text-sm">
                  <SortableHeader field="revenue" label="Umsatz" className="min-w-[120px] justify-end" />
                  {showAgentsMinuten && (
                    <SortableHeader field="agentsMinuten" label="Agents Min" className="min-w-[100px] justify-end" />
                  )}
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
                    showAgentsMinuten={showAgentsMinuten}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="px-4 py-8 text-center text-gray-400">
              Keine Deals in dieser Stage
            </div>
          )}
        </div>
      )}
    </div>
  );
}
