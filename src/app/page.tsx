'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { SalesCanvas } from '@/components/canvas/SalesCanvas';
import { ExportButton } from '@/components/canvas/ExportButton';
import { UserMenu } from '@/components/UserMenu';
import { Autosuggest } from '@/components/ui/Autosuggest';
import { useCanvasStore } from '@/stores/canvas-store';
import { Loader2, FileText, LayoutGrid } from 'lucide-react';
import Link from 'next/link';
import type { CanvasData } from '@/types/canvas';

interface Deal {
  id: string;
  properties: {
    dealname: string;
    amount?: string;
    dealstage?: string;
  };
}

interface Pipeline {
  id: string;
  label: string;
  stages: Array<{
    id: string;
    label: string;
  }>;
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useSession();
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const { setCanvasData, clearCanvasData, canvasData, setSaving, markClean } = useCanvasStore();

  // Update URL when selection changes
  const updateUrl = useCallback((pipelineId: string | null, dealId: string | null) => {
    const params = new URLSearchParams();
    if (pipelineId) params.set('pipeline', pipelineId);
    if (dealId) params.set('deal', dealId);
    const queryString = params.toString();
    router.replace(queryString ? `?${queryString}` : '/', { scroll: false });
  }, [router]);

  // Initialize from URL params on mount
  useEffect(() => {
    if (isInitialized) return;

    const pipelineFromUrl = searchParams.get('pipeline');
    const dealFromUrl = searchParams.get('deal');

    if (pipelineFromUrl) {
      setSelectedPipelineId(pipelineFromUrl);
      if (dealFromUrl) {
        setSelectedDealId(dealFromUrl);
      }
    }
    setIsInitialized(true);
  }, [searchParams, isInitialized]);

  const isAuthenticated = status === 'authenticated';

  // Fetch pipelines - only when authenticated
  const { data: pipelinesData, isLoading: pipelinesLoading, error: pipelinesError } = useQuery({
    queryKey: ['pipelines'],
    queryFn: async () => {
      const response = await fetch('/api/pipelines');
      if (!response.ok) throw new Error('Failed to fetch pipelines');
      const data = await response.json();
      return data.data as Pipeline[];
    },
    enabled: isAuthenticated,
  });

  // Fetch deals for selected pipeline
  const { data: dealsData, isLoading: dealsLoading, error: dealsError } = useQuery({
    queryKey: ['deals', selectedPipelineId],
    queryFn: async () => {
      const url = selectedPipelineId
        ? `/api/deals?pipelineId=${selectedPipelineId}`
        : '/api/deals';
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch deals');
      const data = await response.json();
      return data.data as Deal[];
    },
    enabled: isAuthenticated && !!selectedPipelineId,
  });

  // Fetch selected deal canvas data
  const { data: dealData, isLoading: dealLoading } = useQuery({
    queryKey: ['deal', selectedDealId],
    queryFn: async () => {
      const response = await fetch(`/api/deals/${selectedDealId}`);
      if (!response.ok) throw new Error('Failed to fetch deal');
      const data = await response.json();
      return data.data as CanvasData;
    },
    enabled: isAuthenticated && !!selectedDealId,
  });

  // Update canvas store when deal data changes
  useEffect(() => {
    // Only set data if it matches the currently selected deal
    if (dealData && dealData.dealId === selectedDealId) {
      const processedData: CanvasData = {
        ...dealData,
        lastSaved: dealData.lastSaved ? new Date(dealData.lastSaved) : undefined,
        header: {
          ...dealData.header,
          nextAppointment: dealData.header.nextAppointment
            ? {
                ...dealData.header.nextAppointment,
                date: new Date(dealData.header.nextAppointment.date),
              }
            : null,
        },
        roadmap: {
          ...dealData.roadmap,
          startDate: new Date(dealData.roadmap.startDate),
          endDate: new Date(dealData.roadmap.endDate),
          milestones: dealData.roadmap.milestones.map((m) => ({
            ...m,
            date: new Date(m.date),
          })),
        },
      };
      setCanvasData(processedData);
    }
  }, [dealData, selectedDealId, setCanvasData]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Reset deal selection when pipeline changes
  const handlePipelineChange = (pipelineId: string | null) => {
    setSelectedPipelineId(pipelineId);
    setSelectedDealId(null);
    updateUrl(pipelineId, null);
  };

  // Handle deal selection
  const handleDealChange = (dealId: string | null) => {
    clearCanvasData(); // Clear old data immediately to show empty state
    setSelectedDealId(dealId);
    updateUrl(selectedPipelineId, dealId);
  };

  // Show loading while checking auth
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // Don't render if not authenticated
  if (status === 'unauthenticated') {
    return null;
  }

  // Save handler
  const handleSave = async () => {
    if (!selectedDealId || !canvasData) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/deals/${selectedDealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(canvasData),
      });

      if (!response.ok) throw new Error('Failed to save');

      markClean();
    } catch (error) {
      console.error('Save error:', error);
      alert('Speichern fehlgeschlagen. Bitte versuchen Sie es erneut.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold text-gray-900">Sales Canvas</h1>

            <nav className="flex items-center gap-2">
              <span className="px-3 py-1.5 text-sm font-medium text-gray-900 bg-gray-100 rounded-md flex items-center gap-1.5">
                <FileText className="h-4 w-4" />
                Canvas
              </span>
              <Link
                href={selectedPipelineId ? `/pipeline?id=${selectedPipelineId}` : '/pipeline'}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors flex items-center gap-1.5"
              >
                <LayoutGrid className="h-4 w-4" />
                Pipeline
              </Link>
            </nav>

            <div className="h-6 w-px bg-gray-200" />

            {/* Pipeline Selector */}
            <Autosuggest
              options={pipelinesData?.map((pipeline) => ({
                id: pipeline.id,
                label: pipeline.label,
              })) || []}
              value={selectedPipelineId}
              onChange={handlePipelineChange}
              placeholder="Pipeline suchen..."
              disabled={pipelinesLoading}
              isLoading={pipelinesLoading}
              className="min-w-[200px]"
            />

            {/* Deal Selector */}
            <Autosuggest
              options={dealsData?.map((deal) => ({
                id: deal.id,
                label: deal.properties.dealname,
                sublabel: deal.properties.amount
                  ? `${parseFloat(deal.properties.amount).toLocaleString('de-DE')} EUR`
                  : undefined,
              })) || []}
              value={selectedDealId}
              onChange={handleDealChange}
              placeholder="Deal suchen..."
              disabled={!selectedPipelineId || dealsLoading}
              isLoading={dealsLoading}
              className="min-w-[250px]"
            />

            {dealLoading && (
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <ExportButton disabled={!selectedDealId} />
            <UserMenu />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="py-6">
        {pipelinesError || dealsError ? (
          <div className="max-w-7xl mx-auto px-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
              <p className="text-red-700">
                Fehler beim Laden der Daten. Bitte versuchen Sie es erneut oder melden Sie sich neu an.
              </p>
            </div>
          </div>
        ) : selectedDealId && canvasData && canvasData.dealId === selectedDealId ? (
          <SalesCanvas onSave={handleSave} />
        ) : selectedDealId ? (
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center justify-center gap-2 text-gray-400 py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
              Deal wird geladen...
            </div>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto px-4">
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
              <h2 className="text-xl font-semibold text-gray-700 mb-2">
                Willkommen beim Sales Canvas
              </h2>
              <p className="text-gray-500 mb-6">
                {!selectedPipelineId
                  ? 'Wählen Sie zuerst eine Pipeline aus, um die verfügbaren Deals zu sehen.'
                  : 'Wählen Sie einen Deal aus der Liste oben aus, um das Canvas anzuzeigen.'}
              </p>
              {pipelinesLoading ? (
                <div className="flex items-center justify-center gap-2 text-gray-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Pipelines werden geladen...
                </div>
              ) : dealsLoading ? (
                <div className="flex items-center justify-center gap-2 text-gray-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Deals werden geladen...
                </div>
              ) : selectedPipelineId && dealsData?.length === 0 ? (
                <p className="text-gray-400">
                  Keine Deals in dieser Pipeline gefunden.
                </p>
              ) : selectedPipelineId ? (
                <p className="text-sm text-gray-400">
                  {dealsData?.length} Deal{dealsData?.length !== 1 ? 's' : ''} in dieser Pipeline
                </p>
              ) : (
                <p className="text-sm text-gray-400">
                  {pipelinesData?.length} Pipeline{pipelinesData?.length !== 1 ? 's' : ''} verfügbar
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
