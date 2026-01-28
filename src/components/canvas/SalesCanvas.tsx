'use client';

import { useState } from 'react';
import { useCanvasStore } from '@/stores/canvas-store';
import { CanvasCell } from './CanvasCell';
import { RevenueCell } from './cells/RevenueCell';
import { RoadmapTimeline } from './RoadmapTimeline';
import { TopBar } from './cells/TopBar';
import { Save, RotateCcw, Loader2 } from 'lucide-react';

interface SalesCanvasProps {
  onSave?: () => Promise<void>;
}

function formatRelativeDate(date: Date): { relative: string; absolute: string; time: string } {
  const now = new Date();
  const appointmentDate = new Date(date);

  // Reset time for day comparison
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(appointmentDate.getFullYear(), appointmentDate.getMonth(), appointmentDate.getDate());

  const diffTime = targetDay.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  const time = appointmentDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const absolute = appointmentDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  let relative: string;
  if (diffDays === 0) {
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

  return { relative, absolute, time };
}

export function SalesCanvas({ onSave }: SalesCanvasProps) {
  const { canvasData, isSaving, resetChanges } = useCanvasStore();
  const [isSituationExpanded, setIsSituationExpanded] = useState(false);
  const [isMetricsExpanded, setIsMetricsExpanded] = useState(false);
  const [isSolutionExpanded, setIsSolutionExpanded] = useState(false);
  const [isUpsellExpanded, setIsUpsellExpanded] = useState(false);
  const [isDecisionExpanded, setIsDecisionExpanded] = useState(false);

  // Block-level expansion (if any cell in block is expanded)
  const isProblemWertExpanded = isSituationExpanded || isMetricsExpanded;
  const isLoesungExpanded = isSolutionExpanded || isUpsellExpanded;

  if (!canvasData) {
    return (
      <div className="flex items-center justify-center h-96 text-gray-500">
        Kein Deal ausgewählt
      </div>
    );
  }

  const handleSave = async () => {
    if (onSave) {
      await onSave();
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      {/* Save Bar */}
      {canvasData.isDirty && (
        <div className="no-print sticky top-0 z-20 mb-4 p-3 rounded-xl flex items-center justify-between shadow-sm" style={{ backgroundColor: '#DEFF00' }}>
          <span className="text-sm font-medium text-gray-900">
            Ungespeicherte Änderungen
          </span>
          <div className="flex gap-2">
            <button
              onClick={resetChanges}
              disabled={isSaving}
              className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900 flex items-center gap-1"
            >
              <RotateCcw size={14} />
              Zurücksetzen
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded-lg hover:bg-black flex items-center gap-2 disabled:opacity-50"
            >
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Speichern
            </button>
          </div>
        </div>
      )}

      {/* Last Saved */}
      {canvasData.lastSaved && (
        <div className="no-print text-xs text-gray-400 mb-2 text-right">
          Zuletzt gespeichert: {canvasData.lastSaved.toLocaleString('de-DE')}
        </div>
      )}

      {/* Canvas Grid */}
      <div className="space-y-4">

        {/* Dachzeile */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <TopBar />
        </div>

        {/* Header Row: Profil, Termin, Umsatz */}
        <div className="grid grid-cols-2 gap-4">
          {/* Unternehmensprofil - read-only (from Company object) */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <CanvasCell
              id="companyDescription"
              title="Unternehmensprofil"
              fieldPath="header.companyDescription"
              textContent={canvasData.header.companyDescription}
              placeholder="Keine Unternehmensbeschreibung"
              editable={false}
            />
          </div>

          {/* Termin + Umsatz */}
          <div className="grid grid-cols-[1fr_1.4fr] gap-4">
            {/* Nächster Termin */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Nächster Termin</h3>
              {canvasData.header.nextAppointment ? (
                (() => {
                  const { relative, absolute, time } = formatRelativeDate(new Date(canvasData.header.nextAppointment.date));
                  return (
                    <div className="space-y-1">
                      <div
                        className="text-lg font-bold text-gray-900 cursor-default"
                        title={`${absolute}, ${time} Uhr`}
                      >
                        {relative}
                      </div>
                      <div className="text-xs text-gray-500 truncate" title={canvasData.header.nextAppointment.title}>
                        {canvasData.header.nextAppointment.title}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="text-sm text-gray-400 italic">Kein Termin geplant</div>
              )}
            </div>

            {/* Umsatz */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <RevenueCell />
            </div>
          </div>
        </div>

        {/* Problem & Wert | Lösung */}
        <div className="grid grid-cols-2 gap-4">
          {/* Problem & Wert Block */}
          <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col ${isProblemWertExpanded ? 'min-h-[300px]' : 'h-[300px]'}`}>
            <div className="px-4 py-2 border-b border-gray-100 shrink-0">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Problem & Wert</h2>
            </div>
            <div className="grid grid-cols-2 divide-x divide-gray-100 flex-1 min-h-0">
              <CanvasCell
                id="situation"
                title="Situation / Pain"
                fieldPath="problemValue.situation"
                textContent={canvasData.problemValue.situation}
                placeholder="Aktuelle Situation und Herausforderungen..."
                onExpandChange={setIsSituationExpanded}
              />
              <CanvasCell
                id="metrics"
                title="Metrics"
                fieldPath="problemValue.metrics"
                textContent={canvasData.problemValue.metrics}
                placeholder="Messbare Ziele und KPIs des Kunden..."
                onExpandChange={setIsMetricsExpanded}
              />
            </div>
          </div>

          {/* Lösung Block - read-only */}
          <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col ${isLoesungExpanded ? 'min-h-[300px]' : 'h-[300px]'}`}>
            <div className="px-4 py-2 border-b border-gray-100 shrink-0">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lösung</h2>
            </div>
            <div className="grid grid-cols-2 divide-x divide-gray-100 flex-1 min-h-0">
              <CanvasCell
                id="solution"
                title="Unsere Lösung"
                fieldPath="solution.solution"
                textContent={canvasData.solution.solution}
                placeholder="Was ist unsere Lösung?"
                editable={false}
                onExpandChange={setIsSolutionExpanded}
              />
              <CanvasCell
                id="upsell"
                title="Upsell Opportunities"
                fieldPath="solution.upsell"
                textContent={canvasData.solution.upsell}
                placeholder="Welche Upsell-Möglichkeiten gibt es?"
                editable={false}
                onExpandChange={setIsUpsellExpanded}
              />
            </div>
          </div>
        </div>

        {/* Decision Block */}
        <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col ${isDecisionExpanded ? 'min-h-[300px]' : 'h-[300px]'}`}>
          <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Decision</h2>
              {canvasData.decision.champion && (
                <div className="text-sm text-gray-700">
                  <span className="font-medium text-gray-500">Champion:</span>{' '}
                  <span className="text-gray-900">{canvasData.decision.champion.replace(/<[^>]+>/g, '')}</span>
                </div>
              )}
            </div>
            {canvasData.decision.showStoppers && canvasData.decision.showStoppers.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-red-600 uppercase">Potentielle Show Stopper:</span>
                <div className="flex gap-1">
                  {canvasData.decision.showStoppers.map((tag, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <CanvasCell
            id="requirements"
            title="Anforderungen"
            fieldPath="decision.requirements"
            textContent={canvasData.decision.requirements}
            placeholder="Kundenanforderungen..."
            columns={2}
            className="flex-1"
            hideTitle
            onExpandChange={setIsDecisionExpanded}
          />
        </div>

        {/* Roadmap Block */}
        <div className="no-print bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Roadmap</h2>
          </div>
          <RoadmapTimeline />
        </div>
      </div>
    </div>
  );
}
