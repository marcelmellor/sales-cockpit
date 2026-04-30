'use client';

import Link from 'next/link';
import { ExternalLink, Loader2 } from 'lucide-react';
import type { DealOverviewItem } from '@/app/api/deals/overview/route';
import { getStageColor } from '@/lib/stage-colors';
import { AgeLabel } from './AgeLabel';

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;

function getHubSpotDealUrl(dealId: string): string {
  return `https://app-eu1.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-3/${dealId}`;
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

function isLostDeal(dealStage: string): boolean {
  const l = dealStage.toLowerCase();
  if (l.includes('closed lost')) return true;
  const lostKeywords = ['verloren', 'lost', 'abgesagt', 'cancelled', 'storniert'];
  return lostKeywords.some(keyword => l.includes(keyword));
}

function isWonDeal(dealStage: string): boolean {
  if (isLostDeal(dealStage)) return false;
  const l = dealStage.toLowerCase();
  if (l.includes('closed won')) return true;
  const wonKeywords = ['gewonnen', 'won'];
  return wonKeywords.some(keyword => l.includes(keyword));
}

function getDaysSinceLost(stageEnteredAt: string | null, closedate: string | null): number | null {
  // Use stageEnteredAt first (when deal entered lost stage), fallback to closedate
  const dateToUse = stageEnteredAt || closedate;
  if (!dateToUse) return null;

  const closedDate = new Date(dateToUse);
  const now = new Date();

  // Reset time for day comparison
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const closedDay = new Date(closedDate.getFullYear(), closedDate.getMonth(), closedDate.getDate());

  const diffTime = today.getTime() - closedDay.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

interface DealCardProps {
  deal: DealOverviewItem;
  pipelineId: string;
  meetingsLoading?: boolean;
  stageHistoryLoading?: boolean;
  showAgentsMinuten?: boolean;
  showStage?: boolean;
  showClosedDate?: boolean;
  closedDateLabel?: 'verloren' | 'gewonnen';
}

function formatClosedDate(stageEnteredAt: string | null, closedate: string | null): string | null {
  const dateToUse = stageEnteredAt || closedate;
  if (!dateToUse) return null;
  const date = new Date(dateToUse);
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function DealCard({ deal, pipelineId, meetingsLoading, stageHistoryLoading, showAgentsMinuten, showStage, showClosedDate }: DealCardProps) {
  const canvasUrl = `/canvas?pipeline=${pipelineId}&deal=${deal.id}`;
  const stageColors = showStage ? getStageColor(deal.dealStage) : null;
  const nowMs = new Date().getTime();

  const nextAppointmentDate = deal.nextAppointment?.date
    ? new Date(deal.nextAppointment.date)
    : null;

  const isAppointmentSoon = nextAppointmentDate
    ? nextAppointmentDate.getTime() - nowMs < 7 * 24 * 60 * 60 * 1000
    : false;

  // Check if deal is lost and recently lost
  const isDealLost = isLostDeal(deal.dealStage);
  const daysSinceLost = isDealLost ? getDaysSinceLost(deal.stageEnteredAt, deal.closedate) : null;
  const showLostBadge = isDealLost && daysSinceLost !== null && daysSinceLost >= 0 && daysSinceLost < 10;

  // Check if deal is won and recently won
  const isDealWon = isWonDeal(deal.dealStage);
  const daysSinceWon = isDealWon ? getDaysSinceLost(deal.stageEnteredAt, deal.closedate) : null;
  const showWonBadge = isDealWon && daysSinceWon !== null && daysSinceWon >= 0 && daysSinceWon < 10;

  // Check if deal itself is new (created less than 2 days ago), unabhängig von der Stage
  const isNewDeal = !isDealLost && !isDealWon && deal.dealAge >= 0 && deal.dealAge < 2;

  // Warning badge: high-revenue deals that either got stuck in a stage
  // or lack a timely next appointment. Thresholds mirror existing heuristics:
  //   - "hoher Umsatz" ≥ 1.000 EUR (matches the AI-Agent MRR quick filter in src/app/page.tsx)
  //   - "stockt"        > 45 Tage in Stage (alte Tomaten-Schwelle, siehe AgeLabel)
  //   - "kein Termin"   kein nextAppointment innerhalb der nächsten 14 Tage
  const HIGH_REVENUE_THRESHOLD = 1000;
  const STUCK_IN_STAGE_DAYS = 45;
  const TIMELY_APPOINTMENT_DAYS = 14;

  const isHighRevenue = deal.revenue >= HIGH_REVENUE_THRESHOLD;
  const isStuckInStage = deal.daysInStage > STUCK_IN_STAGE_DAYS;
  const hasTimelyAppointment = nextAppointmentDate
    ? nextAppointmentDate.getTime() - nowMs < TIMELY_APPOINTMENT_DAYS * 24 * 60 * 60 * 1000
    : false;
  const lacksTimelyAppointment = !hasTimelyAppointment;

  const showWarningBadge =
    !isDealLost &&
    !isDealWon &&
    !isNewDeal &&
    isHighRevenue &&
    (isStuckInStage || lacksTimelyAppointment);

  const warningLabel = isStuckInStage && lacksTimelyAppointment
    ? 'Stockt & kein zeitnaher Termin'
    : isStuckInStage
      ? 'Stockt in Stage'
      : 'Kein zeitnaher Termin';

  const warningTooltip = (() => {
    const parts: string[] = [];
    if (isStuckInStage) parts.push(`${deal.daysInStage} Tage in aktueller Stage`);
    if (lacksTimelyAppointment) parts.push(`kein Termin in den nächsten ${TIMELY_APPOINTMENT_DAYS} Tagen`);
    return `Wertvoller Deal (≥ ${HIGH_REVENUE_THRESHOLD.toLocaleString('de-DE')} EUR): ${parts.join(' · ')}`;
  })();

  return (
    <Link
      href={canvasUrl}
      className="block px-4 py-3 hover:bg-gray-50 transition-colors group"
    >
      <div className="flex items-center gap-4">
        {/* Company Name */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <h4 className="font-medium text-gray-900 truncate group-hover:text-blue-600 transition-colors">
            {deal.companyName}
          </h4>
          {HUBSPOT_PORTAL_ID && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(getHubSpotDealUrl(deal.id), '_blank', 'noopener,noreferrer');
              }}
              className="shrink-0 text-orange-400 hover:text-orange-600 transition-colors opacity-0 group-hover:opacity-100"
              title="In HubSpot öffnen"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.1 11.3V8.4c.6-.3 1-1 1-1.7 0-1.1-.9-2-2-2s-2 .9-2 2c0 .7.4 1.4 1 1.7v2.9c-1.2.2-2.3.8-3.1 1.6l-5.4-4.2c.1-.2.1-.4.1-.6 0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2c.4 0 .7-.1 1-.3l5.3 4.1c-.4.8-.6 1.7-.6 2.6 0 3.2 2.6 5.8 5.8 5.8s5.8-2.6 5.8-5.8c0-2.8-2-5.2-4.7-5.8l-.2.3zm-.9 9.1c-2 0-3.6-1.6-3.6-3.6s1.6-3.6 3.6-3.6 3.6 1.6 3.6 3.6-1.6 3.6-3.6 3.6z"/>
              </svg>
            </button>
          )}
        </div>

        {/* Lost Indicator */}
        {showLostBadge && daysSinceLost !== null && (
          <div className="shrink-0">
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700">
              <span aria-hidden="true">💔</span>
              Vor {daysSinceLost} Tag{daysSinceLost !== 1 ? 'en' : ''} verloren
            </span>
          </div>
        )}

        {/* Won Indicator */}
        {showWonBadge && daysSinceWon !== null && (
          <div className="shrink-0">
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700">
              <span aria-hidden="true">✅</span>
              Vor {daysSinceWon} Tag{daysSinceWon !== 1 ? 'en' : ''} gewonnen
            </span>
          </div>
        )}

        {/* New Deal Indicator */}
        {isNewDeal && (
          <div className="shrink-0">
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700">
              <span aria-hidden="true">💠</span>
              Neuer Deal
            </span>
          </div>
        )}

        {/* High-Revenue Warning Indicator */}
        {showWarningBadge && (
          <div className="shrink-0">
            <span
              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-700"
              title={warningTooltip}
            >
              <span aria-hidden="true">⚠️</span>
              {warningLabel}
            </span>
          </div>
        )}

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

          {showClosedDate ? (
            /* Closed Date (Verloren am / Gewonnen am) */
            <div className="w-[100px] text-right text-gray-600">
              {stageHistoryLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-gray-300 ml-auto" />
              ) : (
                <span>{formatClosedDate(deal.stageEnteredAt, deal.closedate) || '—'}</span>
              )}
            </div>
          ) : (
            <>
              {/* Age / Days-in-Stage */}
              {(() => {
                // In nicht nach Stage gruppierten Ansichten (showStage = true,
                // z.B. DealListView) zeigen wir das Gesamt-Alter des Deals.
                // In nach Stage gruppierten Ansichten zeigen wir die Standzeit
                // in der aktuellen Stage.
                const useDealAge = !!showStage;
                const days = useDealAge
                  ? deal.dealAge
                  : (deal.daysInStage >= 0 ? deal.daysInStage : deal.dealAge);
                const tooltip = useDealAge
                  ? `${deal.dealAge} Tag${deal.dealAge !== 1 ? 'e' : ''} Deal-Alter`
                  : (deal.daysInStage >= 0
                      ? `${deal.daysInStage} Tag${deal.daysInStage !== 1 ? 'e' : ''} in Stage\n${deal.dealAge} Tag${deal.dealAge !== 1 ? 'e' : ''} Deal-Alter`
                      : `${deal.dealAge} Tag${deal.dealAge !== 1 ? 'e' : ''} Deal-Alter`);
                const isClosedStage = deal.dealStage.toLowerCase().includes('closed')
                  || deal.dealStage.toLowerCase().includes('abgeschlossen');
                return (
                  <div className="w-[90px] flex justify-end">
                    {stageHistoryLoading && !useDealAge ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
                    ) : !isClosedStage && days >= 0 ? (
                      <AgeLabel days={days} title={tooltip} />
                    ) : null}
                  </div>
                );
              })()}

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
            </>
          )}

          {/* Link indicator */}
          <ExternalLink className="h-4 w-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
        </div>
      </div>
    </Link>
  );
}
