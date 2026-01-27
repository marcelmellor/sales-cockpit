'use client';

import { useState } from 'react';
import { useCanvasStore } from '@/stores/canvas-store';
import { Plus, X, Check, Circle, CheckCircle2 } from 'lucide-react';

export function NextStepsCell() {
  const { canvasData, addNextStep, removeNextStep, toggleNextStep } = useCanvasStore();
  const [newStep, setNewStep] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  if (!canvasData) return null;

  const { nextSteps } = canvasData.roadmap;

  const handleAddStep = () => {
    if (newStep.trim()) {
      addNextStep({
        title: newStep.trim(),
        completed: false,
      });
      setNewStep('');
      setIsAdding(false);
    }
  };

  return (
    <div className="relative bg-yellow-50 p-4 min-h-[120px] border border-yellow-300">
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-yellow-200">
        <h3 className="font-semibold text-sm text-gray-700">Nächste 3 Schritte</h3>
        {nextSteps.length < 3 && (
          <button
            onClick={() => setIsAdding(true)}
            className="p-1 rounded hover:bg-yellow-100 text-gray-500 hover:text-gray-700 transition-colors"
          >
            <Plus size={16} />
          </button>
        )}
      </div>
      <div className="space-y-2">
        {nextSteps.map((step) => (
          <div
            key={step.id}
            className={`
              flex items-start gap-2 p-2 rounded border
              ${step.completed ? 'bg-green-50 border-green-200' : 'bg-white border-yellow-200'}
            `}
          >
            <button
              onClick={() => toggleNextStep(step.id)}
              className="mt-0.5 text-gray-500 hover:text-green-600"
            >
              {step.completed ? (
                <CheckCircle2 size={18} className="text-green-600" />
              ) : (
                <Circle size={18} />
              )}
            </button>
            <span
              className={`flex-1 text-sm ${step.completed ? 'line-through text-gray-400' : 'text-gray-700'}`}
            >
              {step.title}
            </span>
            <button
              onClick={() => removeNextStep(step.id)}
              className="text-gray-400 hover:text-red-500"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {isAdding && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newStep}
              onChange={(e) => setNewStep(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddStep()}
              placeholder="Neuer Schritt..."
              className="flex-1 px-2 py-1 text-sm border border-yellow-300 rounded bg-white"
              autoFocus
            />
            <button
              onClick={handleAddStep}
              className="p-1 text-green-600 hover:text-green-700"
            >
              <Check size={16} />
            </button>
            <button
              onClick={() => { setIsAdding(false); setNewStep(''); }}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {nextSteps.length === 0 && !isAdding && (
          <p className="text-sm text-gray-400 italic">Keine Schritte definiert</p>
        )}
      </div>
    </div>
  );
}
