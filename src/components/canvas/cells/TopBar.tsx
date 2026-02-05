'use client';

import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvas-store';
import { getStageColor } from '@/lib/stage-colors';

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;

function getHubSpotDealUrl(dealId: string): string {
  return `https://app-eu1.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-3/${dealId}`;
}

function getDealAgeIcon(dealAge: number): { src: string; alt: string } {
  if (dealAge <= 14) {
    return { src: '/tomato-fresh.svg', alt: 'Frisch' };
  } else if (dealAge <= 45) {
    return { src: '/tomato-half-fresh.svg', alt: 'Halb frisch' };
  } else {
    return { src: '/tomato-rotten.svg', alt: 'Alt' };
  }
}

export function TopBar() {
  const { canvasData } = useCanvasStore();

  if (!canvasData) return null;

  const stageColors = canvasData.topBar.dealStage
    ? getStageColor(canvasData.topBar.dealStage)
    : null;

  return (
    <div className="px-5 py-4 flex items-center justify-between">
      {/* Links: Unternehmensname und Deal Stage */}
      <div className="flex items-center gap-3">
        <h1 className="text-4xl text-gray-900 company-title" style={{ fontFamily: 'var(--font-headline)', fontWeight: 300 }}>
          {canvasData.topBar.companyName || 'Unbekanntes Unternehmen'}
        </h1>
        {HUBSPOT_PORTAL_ID && canvasData.dealId && (
          <a
            href={getHubSpotDealUrl(canvasData.dealId)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-400 hover:text-orange-600 transition-colors"
            title="In HubSpot öffnen"
          >
            <ExternalLink className="h-5 w-5" />
          </a>
        )}
        {canvasData.topBar.dealStage && stageColors && (
          <span
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
            style={{ backgroundColor: stageColors.bg, color: stageColors.text }}
          >
            {canvasData.topBar.dealStage}
          </span>
        )}
      </div>

      {/* Rechts: Deal-Alter, PM und Deal Owner */}
      <div className="flex items-center gap-6 text-sm">
        {canvasData.topBar.dealAge !== undefined && canvasData.topBar.dealAge > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-xs uppercase tracking-wide">Alter</span>
            <span className="font-medium text-gray-700">{canvasData.topBar.dealAge} Tage</span>
            {!canvasData.topBar.dealStage?.toLowerCase().includes('abgeschlossen') && (
              <Image
                src={getDealAgeIcon(canvasData.topBar.dealAge).src}
                alt={getDealAgeIcon(canvasData.topBar.dealAge).alt}
                width={24}
                height={24}
              />
            )}
          </div>
        )}
        {canvasData.topBar.productManager && (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-xs uppercase tracking-wide">PM</span>
            <span className="font-medium text-gray-700">{canvasData.topBar.productManager}</span>
          </div>
        )}
        {canvasData.topBar.dealOwner && (
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-xs uppercase tracking-wide">Owner</span>
            <span className="font-medium text-gray-700">{canvasData.topBar.dealOwner}</span>
          </div>
        )}
      </div>
    </div>
  );
}
