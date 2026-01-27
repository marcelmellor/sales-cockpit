'use client';

import { useCanvasStore } from '@/stores/canvas-store';

export function TopBar() {
  const { canvasData } = useCanvasStore();

  if (!canvasData) return null;

  return (
    <div className="px-5 py-4 flex items-center justify-between">
      {/* Links: Unternehmensname und Deal Stage */}
      <div className="flex items-center gap-3">
        <h1 className="text-4xl text-gray-900" style={{ fontFamily: 'var(--font-headline)', fontWeight: 300 }}>
          {canvasData.topBar.companyName || 'Unbekanntes Unternehmen'}
        </h1>
        {canvasData.topBar.dealStage && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            {canvasData.topBar.dealStage}
          </span>
        )}
      </div>

      {/* Rechts: PM und Deal Owner */}
      <div className="flex items-center gap-6 text-sm">
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
