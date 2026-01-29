'use client';

import { useState } from 'react';
import { useCanvasStore } from '@/stores/canvas-store';
import { Pencil, Check } from 'lucide-react';

export function RevenueCell() {
  const { canvasData, updateField, activeCell, setActiveCell } = useCanvasStore();
  const [isEditing, setIsEditing] = useState(false);
  const isActive = activeCell === 'revenue';

  if (!canvasData) return null;

  const { mrr, seats } = canvasData.header.revenue;

  const handleEdit = () => {
    setIsEditing(true);
    setActiveCell('revenue');
  };

  const handleSave = () => {
    setIsEditing(false);
    setActiveCell(null);
  };

  return (
    <div
      className={`
        relative p-4 min-h-[100px]
        ${isActive ? 'ring-2 ring-blue-500 ring-inset z-10' : ''}
      `}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium text-xs text-gray-400 uppercase tracking-wide">Umsatzerwartung</h3>
        <button
          onClick={isEditing ? handleSave : handleEdit}
          className="no-print p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
        >
          {isEditing ? <Check size={16} /> : <Pencil size={16} />}
        </button>
      </div>
      <div className="flex flex-col items-center justify-center py-4">
        {isEditing ? (
          <div className="w-full">
            <label className="block text-xs text-gray-500 mb-1">MRR (EUR)</label>
            <input
              type="number"
              value={mrr}
              onChange={(e) => updateField('header.revenue.mrr', parseFloat(e.target.value) || 0)}
              className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-lg font-bold text-center bg-white focus:ring-2 focus:ring-gray-400 focus:border-transparent outline-none"
            />
          </div>
        ) : (
          <>
            <div className="text-4xl font-bold text-gray-900 revenue-amount">
              ~{(Math.round(mrr / 10) * 10).toLocaleString('de-DE')} MRR
            </div>
            {seats > 0 && (
              <div className="text-xl font-semibold text-gray-700 mt-1">
                {seats.toLocaleString('de-DE')} Seats
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
