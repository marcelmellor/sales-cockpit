'use client';

import Link from 'next/link';
import Image from 'next/image';
import { ExternalLink, Loader2 } from 'lucide-react';
import type { DealOverviewItem } from '@/app/api/deals/overview/route';
import { getStageColor } from '@/lib/stage-colors';

function getStageAgeIcon(daysInStage: number): { src: string; alt: string } {
  if (daysInStage <= 14) {
    return { src: '/tomato-fresh.svg', alt: 'Frisch' };
  } else if (daysInStage <= 45) {
    return { src: '/tomato-half-fresh.svg', alt: 'Halb frisch' };
  } else {
    return { src: '/tomato-rotten.svg', alt: 'Alt' };
  }
}

function formatRelativeDate(date: Date): { relative: string; absolute: string } {
  const now = new Date();
  const appointmentDate = new Date(date);

  // Reset time for day comparison
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(appointmentDate.getFullYear(), appointmentDate.getMonth(), appointmentDate.getDate());

  const diffTime = targetDay.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  const absolute = appointmentDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  let relative: string;
  if (diffDays < 0) {
    relative = `Vor ${Math.abs(diffDays)} Tag${Math.abs(diffDays) === 1 ? '' : 'en'}`;
  } else if (diffDays === 0) {
    relative = 'Heute';
  } else if (diffDays === 1) {
    relative = 'Morgen';
  } else if (diffDays === 2) {
    relative = 'Übermorgen';
  } else if (diffDays < 7) {
    relative = `In ${diffDays} Tagen`;
  } else if (diffDays < 14) {
    relative = 'Nächste Woche';
  } else {
    const weeks = Math.floor(diffDays / 7);
    relative = `In ${weeks} Wochen`;
  }

  return { relative, absolute };
}

interface DealCardProps {
  deal: DealOverviewItem;
  pipelineId: string;
  meetingsLoading?: boolean;
  stageHistoryLoading?: boolean;
  showAgentsMinuten?: boolean;
  showStage?: boolean;
}

export function DealCard({ deal, pipelineId, meetingsLoading, stageHistoryLoading, showAgentsMinuten, showStage }: DealCardProps) {
  const canvasUrl = `/?pipeline=${pipelineId}&deal=${deal.id}`;
  const stageColors = showStage ? getStageColor(deal.dealStage) : null;

  const nextAppointmentDate = deal.nextAppointment?.date
    ? new Date(deal.nextAppointment.date)
    : null;

  const isAppointmentSoon = nextAppointmentDate
    ? nextAppointmentDate.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
    : false;

  return (
    <Link
      href={canvasUrl}
      className="block px-4 py-3 hover:bg-gray-50 transition-colors group"
    >
      <div className="flex items-center gap-4">
        {/* Company Name */}
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-gray-900 truncate group-hover:text-blue-600 transition-colors">
            {deal.companyName}
          </h4>
        </div>

        {/* Stage Tag */}
        {showStage && stageColors && (
          <div className="w-[140px]">
            <span
              className="inline-block px-2 py-0.5 text-xs font-medium rounded-full truncate max-w-full"
              style={{ backgroundColor: stageColors.bg, color: stageColors.text }}
              title={deal.dealStage}
            >
              {deal.dealStage}
            </span>
          </div>
        )}

        {/* Metrics */}
        <div className="flex items-center gap-6 text-sm">
          {/* Revenue */}
          <div className="min-w-[120px] text-right text-gray-900">
            <span className="font-medium">{(Math.round(deal.revenue / 10) * 10).toLocaleString('de-DE')}</span>
            <span className="text-gray-400 ml-1">EUR</span>
          </div>

          {/* Agents Minuten */}
          {showAgentsMinuten && (
            <div className="min-w-[100px] text-right text-gray-900">
              <span className={`font-medium ${deal.agentsMinuten === 0 ? 'text-gray-400' : ''}`}>
                {deal.agentsMinuten === 0 ? '?' : deal.agentsMinuten.toLocaleString('de-DE')}
              </span>
            </div>
          )}

          {/* Product Manager */}
          <div className="w-[120px] text-gray-600 truncate" title={deal.productManager || undefined}>
            {deal.productManager || '—'}
          </div>

          {/* Days in Stage (Tomato Icon) */}
          <div
            className="w-[80px] flex justify-end"
            title={deal.daysInStage >= 0
              ? `${deal.daysInStage} Tag${deal.daysInStage !== 1 ? 'e' : ''} in Stage\n${deal.dealAge} Tag${deal.dealAge !== 1 ? 'e' : ''} Deal-Alter`
              : `${deal.dealAge} Tag${deal.dealAge !== 1 ? 'e' : ''} Deal-Alter`
            }
          >
            {stageHistoryLoading ? (
              <Loader2 className="h-7 w-7 animate-spin text-gray-300" />
            ) : !deal.dealStage.toLowerCase().includes('abgeschlossen') && (
              <Image
                src={deal.daysInStage >= 0
                  ? getStageAgeIcon(deal.daysInStage).src
                  : '/tomato-fresh.svg'
                }
                alt={deal.daysInStage >= 0
                  ? getStageAgeIcon(deal.daysInStage).alt
                  : 'Unbekannt'
                }
                width={28}
                height={28}
              />
            )}
          </div>

          {/* Next Appointment */}
          <div className={`min-w-[140px] ${
            nextAppointmentDate
              ? isAppointmentSoon
                ? 'text-amber-600'
                : 'text-gray-900'
              : 'text-gray-400'
          }`}>
            {meetingsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
            ) : nextAppointmentDate ? (
              (() => {
                const { relative, absolute } = formatRelativeDate(nextAppointmentDate);
                return (
                  <span className="font-medium cursor-default" title={absolute}>
                    {relative}
                  </span>
                );
              })()
            ) : (
              <span>—</span>
            )}
          </div>

          {/* Link indicator */}
          <ExternalLink className="h-4 w-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
        </div>
      </div>
    </Link>
  );
}
