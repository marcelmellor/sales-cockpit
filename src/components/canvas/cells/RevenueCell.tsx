'use client';

import { useCanvasStore } from '@/stores/canvas-store';

export function RevenueCell() {
  const { canvasData } = useCanvasStore();

  if (!canvasData) return null;

  const { mrr, seats } = canvasData.header.revenue;

  return (
    <div className="relative p-4 min-h-[100px]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium text-xs text-gray-400 uppercase tracking-wide">Umsatzerwartung</h3>
      </div>
      <div className="flex flex-col items-center justify-center py-4">
        <div className="text-4xl font-bold text-gray-900 revenue-amount">
          ~{(Math.round(mrr / 10) * 10).toLocaleString('de-DE')} MRR
        </div>
        {seats > 0 && (
          <div className="text-xl font-semibold text-gray-700 mt-1">
            {seats.toLocaleString('de-DE')} Seats
          </div>
        )}
      </div>
    </div>
  );
}
