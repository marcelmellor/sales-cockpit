'use client';

import { useState } from 'react';
import { useCanvasStore } from '@/stores/canvas-store';
import { Plus, X, Calendar } from 'lucide-react';
import { format, differenceInDays, startOfMonth, endOfMonth, eachMonthOfInterval } from 'date-fns';
import { de } from 'date-fns/locale';

export function RoadmapTimeline() {
  const { canvasData, addMilestone, removeMilestone, updateMilestone } = useCanvasStore();
  const [isAdding, setIsAdding] = useState(false);
  const [newMilestone, setNewMilestone] = useState({ title: '', date: '' });

  if (!canvasData) return null;

  const { milestones, startDate, endDate } = canvasData.roadmap;

  const totalDays = differenceInDays(endDate, startDate);
  const months = eachMonthOfInterval({ start: startDate, end: endDate });

  const getPosition = (date: Date): number => {
    const days = differenceInDays(date, startDate);
    return (days / totalDays) * 100;
  };

  const handleAddMilestone = () => {
    if (newMilestone.title && newMilestone.date) {
      addMilestone({
        title: newMilestone.title,
        date: new Date(newMilestone.date),
        color: '#DEFF00',
      });
      setNewMilestone({ title: '', date: '' });
      setIsAdding(false);
    }
  };

  return (
    <div className="relative p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-xs text-gray-400 uppercase tracking-wide">Milestones</h3>
        <button
          onClick={() => setIsAdding(true)}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <Plus size={16} />
        </button>
      </div>

      {isAdding && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-gray-50 rounded-xl">
          <input
            type="text"
            value={newMilestone.title}
            onChange={(e) => setNewMilestone({ ...newMilestone, title: e.target.value })}
            placeholder="Milestone-Titel..."
            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-transparent outline-none"
          />
          <input
            type="date"
            value={newMilestone.date}
            onChange={(e) => setNewMilestone({ ...newMilestone, date: e.target.value })}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-transparent outline-none"
          />
          <button
            onClick={handleAddMilestone}
            className="px-4 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors"
          >
            Hinzufügen
          </button>
          <button
            onClick={() => { setIsAdding(false); setNewMilestone({ title: '', date: '' }); }}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div className="relative h-40 mt-4">
        {/* Timeline track */}
        <div className="absolute bottom-8 left-0 right-0 h-0.5 bg-gray-300" />

        {/* Month markers */}
        {months.map((month) => {
          const position = getPosition(startOfMonth(month));
          if (position < 0 || position > 100) return null;

          return (
            <div
              key={month.toISOString()}
              className="absolute bottom-0 transform -translate-x-1/2"
              style={{ left: `${position}%` }}
            >
              <div className="h-3 w-px bg-gray-300 mb-1" />
              <span className="text-xs text-gray-500 whitespace-nowrap">
                {format(month, 'MMMM', { locale: de })}
              </span>
            </div>
          );
        })}

        {/* Milestones */}
        {milestones.map((milestone) => {
          const position = getPosition(milestone.date);
          if (position < 0 || position > 100) return null;

          return (
            <div
              key={milestone.id}
              className="absolute transform -translate-x-1/2 cursor-pointer group"
              style={{
                left: `${position}%`,
                bottom: '2.5rem',
              }}
            >
              <div
                className="px-3 py-2 rounded-lg shadow-sm hover:shadow-md transition-shadow border border-gray-200"
                style={{ backgroundColor: '#DEFF00' }}
              >
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-gray-700" />
                  <span className="text-sm font-medium text-gray-900 whitespace-nowrap">
                    {milestone.title}
                  </span>
                  <button
                    onClick={() => removeMilestone(milestone.id)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-red-600 transition-opacity"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="text-xs text-gray-700 mt-1">
                  {format(milestone.date, 'd. MMMM', { locale: de })}
                </div>
              </div>
              {/* Connector line */}
              <div className="absolute left-1/2 transform -translate-x-1/2 w-px h-4 -bottom-4" style={{ backgroundColor: '#DEFF00' }} />
              <div className="absolute left-1/2 transform -translate-x-1/2 w-2 h-2 rounded-full -bottom-5" style={{ backgroundColor: '#DEFF00' }} />
            </div>
          );
        })}

        {milestones.length === 0 && !isAdding && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
            Keine Milestones definiert. Klicken Sie auf + um einen hinzuzufügen.
          </div>
        )}
      </div>
    </div>
  );
}
