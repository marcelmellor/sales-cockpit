'use client';

import { Suspense, useCallback, useEffect, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserMenu } from '@/components/UserMenu';
import { Autosuggest } from '@/components/ui/Autosuggest';
import { DealStageGroup } from '@/components/pipeline/DealStageGroup';
import { DealListView } from '@/components/pipeline/DealListView';
import { FunnelView } from '@/components/pipeline/FunnelView';
import { Loader2, LayoutGrid, RefreshCw, List, Filter } from 'lucide-react';
import Link from 'next/link';
import type { PipelineOverviewResponse, DealOverviewItem, DealMeetingsMap } from '@/app/api/deals/overview/route';
import type { DealStageHistoryMap } from '@/app/api/deals/overview/stage-history/route';
import { getCachedData, setCachedData, clearPipelineCache } from '@/lib/pipeline-cache';

interface Pipeline {
  id: string;
  label: string;
  stages: Array<{
    id: string;
    label: string;
  }>;
}

export type SortField = 'revenue' | 'agentsMinuten' | 'dealAge' | 'nextAppointment' | 'closedDate';
export type SortDirection = 'asc' | 'desc';
export type ViewMode = 'stages' | 'list' | 'funnel';

export default function PipelineOverview() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    }>
      <PipelineOverviewContent />
    </Suspense>
  );
}

function PipelineOverviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { data: session, status } = useSession();
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [sortByStage, setSortByStage] = useState<Record<string, { field: SortField; direction: SortDirection }>>({});
  const [viewMode, setViewMode] = useState<ViewMode>('stages');
  const [listSortConfig, setListSortConfig] = useState<{ field: SortField; direction: SortDirection }>({ field: 'revenue', direction: 'desc' });

  // Initialize from URL params
  useEffect(() => {
    if (isInitialized) return;
    const pipelineFromUrl = searchParams.get('id');
    if (pipelineFromUrl) {
      setSelectedPipelineId(pipelineFromUrl);
      // Load cached sort settings for this pipeline
      const cachedSort = getCachedData<Record<string, { field: SortField; direction: SortDirection }>>(`sort-${pipelineFromUrl}`);
      if (cachedSort) {
        setSortByStage(cachedSort);
      }
    }
    setIsInitialized(true);
  }, [searchParams, isInitialized]);

  const isAuthenticated = status === 'authenticated';

  // Fetch pipelines
  const { data: pipelinesData, isLoading: pipelinesLoading } = useQuery({
    queryKey: ['pipelines'],
    queryFn: async () => {
      const response = await fetch('/api/pipelines');
      if (!response.ok) throw new Error('Failed to fetch pipelines');
      const data = await response.json();
      return data.data as Pipeline[];
    },
    enabled: isAuthenticated,
  });

  // Get cached data for initial render
  const cachedOverview = useMemo(
    () => selectedPipelineId ? getCachedData<PipelineOverviewResponse>(`overview-${selectedPipelineId}`) : null,
    [selectedPipelineId]
  );

  // Fetch pipeline overview (fast - no meetings)
  const { data: overviewData, isLoading: overviewLoading, error: overviewError } = useQuery({
    queryKey: ['pipeline-overview', selectedPipelineId],
    queryFn: async () => {
      const response = await fetch(`/api/deals/overview?pipelineId=${selectedPipelineId}`);
      if (!response.ok) throw new Error('Failed to fetch pipeline overview');
      const data = await response.json();
      const result = data.data as PipelineOverviewResponse;
      // Save to localStorage cache
      setCachedData(`overview-${selectedPipelineId}`, result);
      return result;
    },
    enabled: isAuthenticated && !!selectedPipelineId,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    initialData: cachedOverview ?? undefined,
  });

  // Extract deal IDs for meetings query
  const dealIds = useMemo(() => overviewData?.deals.map(d => d.id) || [], [overviewData]);

  // Get cached meetings data
  const cachedMeetings = useMemo(
    () => selectedPipelineId ? getCachedData<DealMeetingsMap>(`meetings-${selectedPipelineId}`) : null,
    [selectedPipelineId]
  );

  // Fetch meetings separately (slower - sequential API calls)
  const { data: meetingsData, isLoading: meetingsLoading, isFetching: meetingsFetching } = useQuery({
    queryKey: ['pipeline-meetings', selectedPipelineId, dealIds.join(',')],
    queryFn: async () => {
      if (dealIds.length === 0) return {} as DealMeetingsMap;
      const response = await fetch(`/api/deals/overview/meetings?dealIds=${dealIds.join(',')}`);
      if (!response.ok) throw new Error('Failed to fetch meetings');
      const data = await response.json();
      const result = data.data as DealMeetingsMap;
      // Save to localStorage cache
      setCachedData(`meetings-${selectedPipelineId}`, result);
      return result;
    },
    enabled: isAuthenticated && dealIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    initialData: cachedMeetings ?? undefined,
  });

  // Get cached stage history data
  const cachedStageHistory = useMemo(
    () => selectedPipelineId ? getCachedData<DealStageHistoryMap>(`stage-history-${selectedPipelineId}`) : null,
    [selectedPipelineId]
  );

  // Fetch stage history separately (slower - sequential API calls)
  const { data: stageHistoryData, isLoading: stageHistoryLoading, isFetching: stageHistoryFetching } = useQuery({
    queryKey: ['pipeline-stage-history', selectedPipelineId, dealIds.join(',')],
    queryFn: async () => {
      if (dealIds.length === 0) return {} as DealStageHistoryMap;
      const response = await fetch(`/api/deals/overview/stage-history?dealIds=${dealIds.join(',')}`);
      if (!response.ok) throw new Error('Failed to fetch stage history');
      const data = await response.json();
      const result = data.data as DealStageHistoryMap;
      // Save to localStorage cache
      setCachedData(`stage-history-${selectedPipelineId}`, result);
      return result;
    },
    enabled: isAuthenticated && dealIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    initialData: cachedStageHistory ?? undefined,
  });

  // Merge meetings and stage history into deals
  const dealsWithMeetings: DealOverviewItem[] = useMemo(() => {
    if (!overviewData?.deals) return [];
    return overviewData.deals.map(deal => ({
      ...deal,
      nextAppointment: meetingsData?.[deal.id] || null,
      daysInStage: stageHistoryData?.[deal.id]?.daysInStage ?? -1,
      stageEnteredAt: stageHistoryData?.[deal.id]?.stageEnteredAt ?? null,
    }));
  }, [overviewData?.deals, meetingsData, stageHistoryData]);

  // Refresh all data (clears localStorage cache and React Query cache)
  const handleRefresh = () => {
    if (selectedPipelineId) {
      clearPipelineCache(selectedPipelineId);
    }
    queryClient.invalidateQueries({ queryKey: ['pipeline-overview', selectedPipelineId] });
    queryClient.invalidateQueries({ queryKey: ['pipeline-meetings', selectedPipelineId] });
    queryClient.invalidateQueries({ queryKey: ['pipeline-stage-history', selectedPipelineId] });
  };

  // Combined loading state for secondary data
  const secondaryDataLoading = meetingsFetching || stageHistoryFetching;

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const handlePipelineChange = (pipelineId: string | null) => {
    setSelectedPipelineId(pipelineId);
    if (pipelineId) {
      // Load cached sort settings for this pipeline
      const cachedSort = getCachedData<Record<string, { field: SortField; direction: SortDirection }>>(`sort-${pipelineId}`);
      setSortByStage(cachedSort || {});
      router.replace(`/pipeline?id=${pipelineId}`, { scroll: false });
    } else {
      setSortByStage({});
      router.replace('/pipeline', { scroll: false });
    }
  };

  const handleSortChange = (stageId: string, field: SortField) => {
    setSortByStage(prev => {
      const current = prev[stageId];
      let newSort: Record<string, { field: SortField; direction: SortDirection }>;

      if (current?.field === field) {
        // Toggle direction
        newSort = {
          ...prev,
          [stageId]: {
            field,
            direction: current.direction === 'asc' ? 'desc' : 'asc',
          },
        };
      } else {
        // New field, default to descending for revenue/seats, ascending for date
        newSort = {
          ...prev,
          [stageId]: {
            field,
            direction: field === 'nextAppointment' ? 'asc' : 'desc',
          },
        };
      }

      // Save to cache
      if (selectedPipelineId) {
        setCachedData(`sort-${selectedPipelineId}`, newSort);
      }

      return newSort;
    });
  };

  const sortDeals = (deals: DealOverviewItem[], stageId: string): DealOverviewItem[] => {
    // Default: sort by revenue descending
    const sortConfig = sortByStage[stageId] || { field: 'revenue' as SortField, direction: 'desc' as SortDirection };

    return [...deals].sort((a, b) => {
      const { field, direction } = sortConfig;
      let comparison = 0;

      if (field === 'revenue') {
        comparison = a.revenue - b.revenue;
      } else if (field === 'agentsMinuten') {
        comparison = a.agentsMinuten - b.agentsMinuten;
      } else if (field === 'dealAge') {
        comparison = a.dealAge - b.dealAge;
      } else if (field === 'nextAppointment') {
        const aDate = a.nextAppointment?.date ? new Date(a.nextAppointment.date).getTime() : Infinity;
        const bDate = b.nextAppointment?.date ? new Date(b.nextAppointment.date).getTime() : Infinity;
        comparison = aDate - bDate;
      } else if (field === 'closedDate') {
        const aDate = a.stageEnteredAt ? new Date(a.stageEnteredAt).getTime() : (a.closedate ? new Date(a.closedate).getTime() : Infinity);
        const bDate = b.stageEnteredAt ? new Date(b.stageEnteredAt).getTime() : (b.closedate ? new Date(b.closedate).getTime() : Infinity);
        comparison = aDate - bDate;
      }

      return direction === 'asc' ? comparison : -comparison;
    });
  };

  // Reorder stages: swap "Verloren" and "Gewonnen" (Gewonnen should come before Verloren)
  const reorderedStages = useMemo(() => {
    if (!overviewData?.stages) return [];
    const stages = [...overviewData.stages];

    // Find the indices of "verloren" and "gewonnen" stages
    const verlorenIndex = stages.findIndex(s =>
      s.label.toLowerCase().includes('verloren') || s.label.toLowerCase().includes('lost')
    );
    const gewonnenIndex = stages.findIndex(s =>
      s.label.toLowerCase().includes('gewonnen') || s.label.toLowerCase().includes('won')
    );

    // If both exist and verloren comes before gewonnen, swap them
    if (verlorenIndex !== -1 && gewonnenIndex !== -1 && verlorenIndex < gewonnenIndex) {
      [stages[verlorenIndex], stages[gewonnenIndex]] = [stages[gewonnenIndex], stages[verlorenIndex]];
    }

    return stages;
  }, [overviewData?.stages]);

  // Helper to check if stage is closed (won or lost)
  const isClosedStage = useCallback((label: string): boolean => {
    const closedKeywords = ['verloren', 'lost', 'gewonnen', 'won', 'abgesagt', 'cancelled', 'storniert'];
    return closedKeywords.some(keyword => label.toLowerCase().includes(keyword));
  }, []);

  // Group deals by stage (using dealsWithMeetings)
  // Limit closed stages (won/lost) to 20 deals
  const dealsByStage = reorderedStages.map(stage => {
    const sortedDeals = sortDeals(
      dealsWithMeetings.filter(deal => deal.dealStageId === stage.id),
      stage.id
    );
    const isClosed = isClosedStage(stage.label);
    return {
      stage,
      deals: isClosed ? sortedDeals.slice(0, 20) : sortedDeals,
      totalCount: sortedDeals.length,
    };
  }) || [];

  // Filter open deals (exclude closed/won stages) and sort for list view
  const openDeals = useMemo(() => {
    const filtered = dealsWithMeetings.filter(deal =>
      !deal.dealStage.toLowerCase().includes('abgeschlossen') &&
      !deal.dealStage.toLowerCase().includes('closed')
    );

    // Sort by listSortConfig
    return [...filtered].sort((a, b) => {
      const { field, direction } = listSortConfig;
      let comparison = 0;

      if (field === 'revenue') {
        comparison = a.revenue - b.revenue;
      } else if (field === 'agentsMinuten') {
        comparison = a.agentsMinuten - b.agentsMinuten;
      } else if (field === 'dealAge') {
        comparison = a.dealAge - b.dealAge;
      } else if (field === 'nextAppointment') {
        const aDate = a.nextAppointment?.date ? new Date(a.nextAppointment.date).getTime() : Infinity;
        const bDate = b.nextAppointment?.date ? new Date(b.nextAppointment.date).getTime() : Infinity;
        comparison = aDate - bDate;
      }

      return direction === 'asc' ? comparison : -comparison;
    });
  }, [dealsWithMeetings, listSortConfig]);

  // Handler for list view sort
  const handleListSortChange = (field: SortField) => {
    setListSortConfig(prev => {
      if (prev.field === field) {
        return { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { field, direction: field === 'nextAppointment' ? 'asc' : 'desc' };
    });
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return null;
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-xl font-bold text-gray-900 hover:text-gray-700 transition-colors">
              Sales Canvas
            </Link>

            <nav className="flex items-center gap-2">
              <Link
                href="/"
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
              >
                Canvas
              </Link>
              <span className="px-3 py-1.5 text-sm font-medium text-gray-900 bg-gray-100 rounded-md flex items-center gap-1.5">
                <LayoutGrid className="h-4 w-4" />
                Pipeline
              </span>
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
              placeholder="Pipeline auswählen..."
              disabled={pipelinesLoading}
              isLoading={pipelinesLoading}
              className="min-w-[200px]"
            />

            {/* View Mode Toggle */}
            {selectedPipelineId && (
              <div className="flex items-center bg-gray-100 rounded-md p-0.5">
                <button
                  onClick={() => setViewMode('stages')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors ${
                    viewMode === 'stages'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="Nach Stages gruppiert"
                >
                  <LayoutGrid className="h-4 w-4" />
                  Stages
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors ${
                    viewMode === 'list'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="Offene Deals als Liste"
                >
                  <List className="h-4 w-4" />
                  Offen
                </button>
                <button
                  onClick={() => setViewMode('funnel')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors ${
                    viewMode === 'funnel'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="Funnel-Ansicht"
                >
                  <Filter className="h-4 w-4" />
                  Funnel
                </button>
              </div>
            )}

            {(overviewLoading || secondaryDataLoading) && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {secondaryDataLoading && !overviewLoading ? 'Termine laden...' : 'Laden...'}
              </div>
            )}
          </div>
          <UserMenu />
        </div>
      </header>

      {/* Main Content */}
      <main className="py-6">
        {overviewError ? (
          <div className="max-w-7xl mx-auto px-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
              <p className="text-red-700">
                Fehler beim Laden der Daten. Bitte versuchen Sie es erneut.
              </p>
            </div>
          </div>
        ) : !selectedPipelineId ? (
          <div className="max-w-7xl mx-auto px-4">
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
              <LayoutGrid className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-700 mb-2">
                Pipeline-Übersicht
              </h2>
              <p className="text-gray-500 mb-4">
                Wählen Sie eine Pipeline aus, um alle Deals nach Stage gruppiert zu sehen.
              </p>
              {pipelinesLoading ? (
                <div className="flex items-center justify-center gap-2 text-gray-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Pipelines werden geladen...
                </div>
              ) : (
                <p className="text-sm text-gray-400">
                  {pipelinesData?.length} Pipeline{pipelinesData?.length !== 1 ? 's' : ''} verfügbar
                </p>
              )}
            </div>
          </div>
        ) : overviewLoading ? (
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center justify-center gap-2 text-gray-400 py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
              Deals werden geladen...
            </div>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto px-4 space-y-6">
            {/* Pipeline Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">
                  {overviewData?.pipelineName}
                </h1>
                <p className="text-gray-500 mt-1">
                  {dealsWithMeetings.length} Deal{dealsWithMeetings.length !== 1 ? 's' : ''} in {overviewData?.stages.length} Stages
                  {(meetingsLoading || stageHistoryLoading) && (
                    <span className="ml-2 text-blue-500">
                      <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
                      {stageHistoryLoading ? 'Stage-Daten werden geladen...' : 'Termine werden geladen...'}
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={handleRefresh}
                disabled={overviewLoading || secondaryDataLoading}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Daten neu laden"
              >
                <RefreshCw className={`h-4 w-4 ${secondaryDataLoading || overviewLoading ? 'animate-spin' : ''}`} />
                Aktualisieren
              </button>
            </div>

            {/* View Content */}
            {viewMode === 'stages' ? (
              /* Stage Groups */
              dealsByStage.map(({ stage, deals, totalCount }) => (
                <DealStageGroup
                  key={stage.id}
                  stage={stage}
                  deals={deals}
                  totalCount={totalCount}
                  pipelineId={selectedPipelineId}
                  pipelineName={overviewData?.pipelineName}
                  sortConfig={sortByStage[stage.id]}
                  onSortChange={(field) => handleSortChange(stage.id, field)}
                  meetingsLoading={meetingsLoading}
                  stageHistoryLoading={stageHistoryLoading}
                />
              ))
            ) : viewMode === 'funnel' ? (
              /* Funnel View — uses overviewData.deals directly (no meetings/stage-history needed) */
              <FunnelView
                stages={reorderedStages}
                deals={overviewData?.deals ?? []}
                isClosedStage={isClosedStage}
                stageHistory={stageHistoryData ?? {}}
                stageHistoryLoading={stageHistoryLoading || stageHistoryFetching}
                pipelineId={selectedPipelineId}
              />
            ) : (
              /* Open Deals List */
              <DealListView
                deals={openDeals}
                pipelineId={selectedPipelineId}
                sortConfig={listSortConfig}
                onSortChange={handleListSortChange}
                meetingsLoading={meetingsLoading}
                stageHistoryLoading={stageHistoryLoading}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
