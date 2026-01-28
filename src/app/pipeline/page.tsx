'use client';

import { Suspense, useEffect, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserMenu } from '@/components/UserMenu';
import { Autosuggest } from '@/components/ui/Autosuggest';
import { DealStageGroup } from '@/components/pipeline/DealStageGroup';
import { Loader2, LayoutGrid, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import type { PipelineOverviewResponse, DealOverviewItem, DealMeetingsMap } from '@/app/api/deals/overview/route';
import { getCachedData, setCachedData, clearPipelineCache } from '@/lib/pipeline-cache';

interface Pipeline {
  id: string;
  label: string;
  stages: Array<{
    id: string;
    label: string;
  }>;
}

export type SortField = 'revenue' | 'agentsMinuten' | 'dealAge' | 'nextAppointment';
export type SortDirection = 'asc' | 'desc';

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

  // Merge meetings into deals
  const dealsWithMeetings: DealOverviewItem[] = useMemo(() => {
    if (!overviewData?.deals) return [];
    return overviewData.deals.map(deal => ({
      ...deal,
      nextAppointment: meetingsData?.[deal.id] || null,
    }));
  }, [overviewData?.deals, meetingsData]);

  // Refresh all data (clears localStorage cache and React Query cache)
  const handleRefresh = () => {
    if (selectedPipelineId) {
      clearPipelineCache(selectedPipelineId);
    }
    queryClient.invalidateQueries({ queryKey: ['pipeline-overview', selectedPipelineId] });
    queryClient.invalidateQueries({ queryKey: ['pipeline-meetings', selectedPipelineId] });
  };

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
    const sortConfig = sortByStage[stageId];
    if (!sortConfig) return deals;

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
      }

      return direction === 'asc' ? comparison : -comparison;
    });
  };

  // Group deals by stage (using dealsWithMeetings)
  const dealsByStage = overviewData?.stages.map(stage => ({
    stage,
    deals: sortDeals(
      dealsWithMeetings.filter(deal => deal.dealStageId === stage.id),
      stage.id
    ),
  })) || [];

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

            {(overviewLoading || meetingsFetching) && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {meetingsFetching && !overviewLoading ? 'Termine laden...' : 'Laden...'}
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
                  {meetingsLoading && (
                    <span className="ml-2 text-blue-500">
                      <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
                      Termine werden geladen...
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={handleRefresh}
                disabled={overviewLoading || meetingsFetching}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Daten neu laden"
              >
                <RefreshCw className={`h-4 w-4 ${meetingsFetching || overviewLoading ? 'animate-spin' : ''}`} />
                Aktualisieren
              </button>
            </div>

            {/* Stage Groups */}
            {dealsByStage.map(({ stage, deals }) => (
              <DealStageGroup
                key={stage.id}
                stage={stage}
                deals={deals}
                pipelineId={selectedPipelineId}
                pipelineName={overviewData?.pipelineName}
                sortConfig={sortByStage[stage.id]}
                onSortChange={(field) => handleSortChange(stage.id, field)}
                meetingsLoading={meetingsLoading}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
