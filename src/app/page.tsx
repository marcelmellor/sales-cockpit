'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { SalesCanvas } from '@/components/canvas/SalesCanvas';
import { UserMenu } from '@/components/UserMenu';
import { useCanvasStore } from '@/stores/canvas-store';
import { ChevronDown, Loader2 } from 'lucide-react';
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const { setCanvasData, canvasData, setSaving, markClean } = useCanvasStore();

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
    if (dealData) {
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
  }, [dealData, setCanvasData]);

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

            {/* Pipeline Selector */}
            <div className="relative">
              <select
                value={selectedPipelineId || ''}
                onChange={(e) => handlePipelineChange(e.target.value || null)}
                disabled={pipelinesLoading}
                className="appearance-none bg-gray-50 border border-gray-300 rounded-lg px-4 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
              >
                <option value="">Pipeline auswählen...</option>
                {pipelinesData?.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>
                    {pipeline.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
            </div>

            {/* Deal Selector */}
            <div className="relative">
              <select
                value={selectedDealId || ''}
                onChange={(e) => handleDealChange(e.target.value || null)}
                disabled={!selectedPipelineId || dealsLoading}
                className="appearance-none bg-gray-50 border border-gray-300 rounded-lg px-4 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[250px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">Deal auswählen...</option>
                {dealsData?.map((deal) => (
                  <option key={deal.id} value={deal.id}>
                    {deal.properties.dealname}
                    {deal.properties.amount && ` - ${parseFloat(deal.properties.amount).toLocaleString('de-DE')} EUR`}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
            </div>

            {dealLoading && (
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            )}
          </div>
          <UserMenu />
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
        ) : selectedDealId ? (
          <SalesCanvas onSave={handleSave} />
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
