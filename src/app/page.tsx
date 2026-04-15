'use client';

import { Suspense, useCallback, useEffect, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserMenu } from '@/components/UserMenu';
import { DealStageGroup } from '@/components/pipeline/DealStageGroup';
import { DealListView } from '@/components/pipeline/DealListView';
import { DashboardView } from '@/components/pipeline/DashboardView';
import { Loader2, LayoutGrid, RefreshCw, List, BarChart3 } from 'lucide-react';
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

const PORTFOLIO_OPTIONS = [
  { value: 'neo', label: 'Cloud PBX' },
  { value: 'frontdesk', label: 'AI Agents' },
  { value: 'flow', label: 'AI Flow' },
  { value: 'cx', label: 'Contact Center' },
  { value: 'trunking', label: 'Trunking' },
  { value: 'easy', label: 'satellite Business' },
] as const;

export type SortField = 'revenue' | 'agentsMinuten' | 'dealAge' | 'nextAppointment' | 'closedDate';
export type SortDirection = 'asc' | 'desc';
export type ViewMode = 'stages' | 'list' | 'dashboard';

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
  const [selectedProdukt, setSelectedProdukt] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [minAgentMinutes, setMinAgentMinutes] = useState<number | null>(2500);
  const [sortByStage, setSortByStage] = useState<Record<string, { field: SortField; direction: SortDirection }>>({});
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [listSortConfig, setListSortConfig] = useState<{ field: SortField; direction: SortDirection }>({ field: 'revenue', direction: 'desc' });

  const isAuthenticated = status === 'authenticated';

  // Initialize from URL params
  useEffect(() => {
    if (isInitialized) return;
    const produktFromUrl = searchParams.get('produkt');
    if (produktFromUrl && PORTFOLIO_OPTIONS.some(o => o.value === produktFromUrl)) {
      setSelectedProdukt(produktFromUrl);
    } else {
      // Default to first option
      setSelectedProdukt(PORTFOLIO_OPTIONS[0].value);
    }
    setIsInitialized(true);
  }, [searchParams, isInitialized]);

  // Fetch pipelines to find Sales Pipeline ID
  const { data: pipelinesData } = useQuery({
    queryKey: ['pipelines'],
    queryFn: async () => {
      const response = await fetch('/api/pipelines');
      if (!response.ok) throw new Error('Failed to fetch pipelines');
      const data = await response.json();
      return data.data as Pipeline[];
    },
    enabled: isAuthenticated,
  });

  // Auto-select "Sales Pipeline"
  useEffect(() => {
    if (pipelinesData && !selectedPipelineId) {
      const salesPipeline = pipelinesData.find(p => p.label === 'Sales sipgate Portfolio');
      if (salesPipeline) {
        setSelectedPipelineId(salesPipeline.id);
      }
    }
  }, [pipelinesData, selectedPipelineId]);

  // Handle product change
  const handleProduktChange = (produkt: string) => {
    setSelectedProdukt(produkt);
    router.replace(`/?produkt=${produkt}`, { scroll: false });
  };

  // Cache key includes product for separate caching per product group
  const cacheKey = selectedPipelineId && selectedProdukt ? `${selectedPipelineId}-${selectedProdukt}` : null;

  // Get cached data for initial render
  const cachedOverview = useMemo(
    () => cacheKey ? getCachedData<PipelineOverviewResponse>(`overview-${cacheKey}`) : null,
    [cacheKey]
  );

  // Fetch pipeline overview filtered by product (server-side)
  const { data: overviewData, isLoading: overviewLoading, error: overviewError } = useQuery({
    queryKey: ['pipeline-overview', selectedPipelineId, selectedProdukt],
    queryFn: async () => {
      const response = await fetch(`/api/deals/overview?pipelineId=${selectedPipelineId}&produkt=${selectedProdukt}`);
      if (!response.ok) throw new Error('Failed to fetch pipeline overview');
      const data = await response.json();
      const result = data.data as PipelineOverviewResponse;
      if (cacheKey) setCachedData(`overview-${cacheKey}`, result);
      return result;
    },
    enabled: isAuthenticated && !!selectedPipelineId && !!selectedProdukt,
    staleTime: 5 * 60 * 1000,
    initialData: cachedOverview ?? undefined,
  });

  // Extract deal IDs for meetings query
  const dealIds = useMemo(() => overviewData?.deals.map(d => d.id) || [], [overviewData]);

  // Helper: fetch in batches to avoid URI Too Long (414) errors
  async function fetchInBatches<T extends Record<string, unknown>>(
    endpoint: string,
    ids: string[],
    batchSize = 100,
  ): Promise<T> {
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += batchSize) {
      batches.push(ids.slice(i, i + batchSize));
    }
    const results = await Promise.all(
      batches.map(async (batch) => {
        const response = await fetch(`${endpoint}?dealIds=${batch.join(',')}`);
        if (!response.ok) throw new Error(`Failed to fetch ${endpoint}`);
        const data = await response.json();
        return data.data as T;
      })
    );
    return Object.assign({}, ...results) as T;
  }

  // Get cached meetings data
  const cachedMeetings = useMemo(
    () => cacheKey ? getCachedData<DealMeetingsMap>(`meetings-${cacheKey}`) : null,
    [cacheKey]
  );

  // Fetch meetings separately
  const { data: meetingsData, isLoading: meetingsLoading, isFetching: meetingsFetching } = useQuery({
    queryKey: ['pipeline-meetings', selectedPipelineId, selectedProdukt, dealIds.join(',')],
    queryFn: async () => {
      if (dealIds.length === 0) return {} as DealMeetingsMap;
      const result = await fetchInBatches<DealMeetingsMap>('/api/deals/overview/meetings', dealIds);
      if (cacheKey) setCachedData(`meetings-${cacheKey}`, result);
      return result;
    },
    enabled: isAuthenticated && dealIds.length > 0,
    staleTime: 5 * 60 * 1000,
    initialData: cachedMeetings ?? undefined,
  });

  // Get cached stage history data
  const cachedStageHistory = useMemo(
    () => cacheKey ? getCachedData<DealStageHistoryMap>(`stage-history-${cacheKey}`) : null,
    [cacheKey]
  );

  // Fetch stage history separately
  const { data: stageHistoryData, isLoading: stageHistoryLoading, isFetching: stageHistoryFetching } = useQuery({
    queryKey: ['pipeline-stage-history', selectedPipelineId, selectedProdukt, dealIds.join(',')],
    queryFn: async () => {
      if (dealIds.length === 0) return {} as DealStageHistoryMap;
      const result = await fetchInBatches<DealStageHistoryMap>('/api/deals/overview/stage-history', dealIds);
      if (cacheKey) setCachedData(`stage-history-${cacheKey}`, result);
      return result;
    },
    enabled: isAuthenticated && dealIds.length > 0,
    staleTime: 5 * 60 * 1000,
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

  // Refresh all data
  const handleRefresh = () => {
    if (cacheKey) {
      clearPipelineCache(cacheKey);
    }
    queryClient.invalidateQueries({ queryKey: ['pipeline-overview', selectedPipelineId, selectedProdukt] });
    queryClient.invalidateQueries({ queryKey: ['pipeline-meetings', selectedPipelineId, selectedProdukt] });
    queryClient.invalidateQueries({ queryKey: ['pipeline-stage-history', selectedPipelineId, selectedProdukt] });
  };

  // Combined loading state for secondary data
  const secondaryDataLoading = meetingsFetching || stageHistoryFetching;

  // Show Agents Minuten column when AI Agent is selected
  const showAgentsMinuten = selectedProdukt === 'frontdesk';

  // Show the agent minutes quick-filter only for AI Agents
  const showAgentQuickFilter = selectedProdukt === 'frontdesk';

  // Portfolio set for DashboardView (single selection)
  const selectedPortfolios = useMemo(() => selectedProdukt ? new Set([selectedProdukt]) : new Set<string>(), [selectedProdukt]);

  // Apply agent minutes quick-filter
  const filteredDeals = useMemo(() => {
    if (!showAgentQuickFilter || minAgentMinutes === null) return dealsWithMeetings;
    return dealsWithMeetings.filter(deal => deal.agentsMinuten >= minAgentMinutes);
  }, [dealsWithMeetings, showAgentQuickFilter, minAgentMinutes]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const handleSortChange = (stageId: string, field: SortField) => {
    setSortByStage(prev => {
      const current = prev[stageId];
      let newSort: Record<string, { field: SortField; direction: SortDirection }>;

      if (current?.field === field) {
        newSort = {
          ...prev,
          [stageId]: {
            field,
            direction: current.direction === 'asc' ? 'desc' : 'asc',
          },
        };
      } else {
        newSort = {
          ...prev,
          [stageId]: {
            field,
            direction: field === 'nextAppointment' ? 'asc' : 'desc',
          },
        };
      }

      if (cacheKey) {
        setCachedData(`sort-${cacheKey}`, newSort);
      }

      return newSort;
    });
  };

  const sortDeals = (deals: DealOverviewItem[], stageId: string): DealOverviewItem[] => {
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

  // Reorder stages: swap "Verloren" and "Gewonnen"
  const reorderedStages = useMemo(() => {
    if (!overviewData?.stages) return [];
    const stages = [...overviewData.stages];

    const verlorenIndex = stages.findIndex(s =>
      s.label.toLowerCase().includes('closed lost') || s.label.toLowerCase().includes('verloren') || s.label.toLowerCase().includes('lost')
    );
    const gewonnenIndex = stages.findIndex(s =>
      s.label.toLowerCase().includes('closed won') || s.label.toLowerCase().includes('gewonnen') || s.label.toLowerCase().includes('won')
    );

    if (verlorenIndex !== -1 && gewonnenIndex !== -1 && verlorenIndex < gewonnenIndex) {
      [stages[verlorenIndex], stages[gewonnenIndex]] = [stages[gewonnenIndex], stages[verlorenIndex]];
    }

    return stages;
  }, [overviewData?.stages]);

  // Helper to check if stage is closed
  const isClosedStage = useCallback((label: string): boolean => {
    const closedKeywords = ['closed won', 'closed lost', 'verloren', 'lost', 'gewonnen', 'won', 'abgesagt', 'cancelled', 'storniert'];
    return closedKeywords.some(keyword => label.toLowerCase().includes(keyword));
  }, []);

  // Group deals by stage
  const dealsByStage = reorderedStages.map(stage => {
    const sortedDeals = sortDeals(
      filteredDeals.filter(deal => deal.dealStageId === stage.id),
      stage.id
    );
    const isClosed = isClosedStage(stage.label);
    return {
      stage,
      deals: isClosed ? sortedDeals.slice(0, 20) : sortedDeals,
      totalCount: sortedDeals.length,
    };
  }) || [];

  // Filter open deals and sort for list view
  const openDeals = useMemo(() => {
    const filtered = filteredDeals.filter(deal =>
      !deal.dealStage.toLowerCase().includes('closed won') &&
      !deal.dealStage.toLowerCase().includes('closed lost') &&
      !deal.dealStage.toLowerCase().includes('abgeschlossen') &&
      !deal.dealStage.toLowerCase().includes('closed')
    );

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
  }, [filteredDeals, listSortConfig]);

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

  const currentLabel = PORTFOLIO_OPTIONS.find(o => o.value === selectedProdukt)?.label || '';

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Portfolio Selection Pills (single select, no "Alle") */}
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide mr-1">Portfolio</span>
            {PORTFOLIO_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => handleProduktChange(value)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedProdukt === value
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}

            {(overviewLoading || secondaryDataLoading) && (
              <div className="flex items-center gap-2 text-sm text-gray-500 ml-2">
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
        ) : !selectedPipelineId || !selectedProdukt || overviewLoading ? (
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center justify-center gap-2 text-gray-400 py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
              Deals werden geladen...
            </div>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto px-4 space-y-6">
            {/* Header + Tab bar */}
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <h1 className="text-lg font-semibold text-gray-900">
                  {currentLabel}
                  <span className="ml-2 text-sm font-normal text-gray-400">
                    {filteredDeals.length} Deal{filteredDeals.length !== 1 ? 's' : ''}
                    {(meetingsLoading || stageHistoryLoading) && (
                      <Loader2 className="h-3 w-3 animate-spin inline ml-1.5 text-blue-500" />
                    )}
                  </span>
                </h1>
                <button
                  onClick={handleRefresh}
                  disabled={overviewLoading || secondaryDataLoading}
                  className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                  title="Daten neu laden"
                >
                  <RefreshCw className={`h-4 w-4 ${secondaryDataLoading || overviewLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="flex items-center justify-between border-b border-gray-200">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setViewMode('dashboard')}
                    className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                      viewMode === 'dashboard'
                        ? 'border-gray-900 text-gray-900 font-medium'
                        : 'border-transparent text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    <BarChart3 className="h-3.5 w-3.5" />
                    Dashboard
                  </button>
                  <button
                    onClick={() => setViewMode('stages')}
                    className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                      viewMode === 'stages'
                        ? 'border-gray-900 text-gray-900 font-medium'
                        : 'border-transparent text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Stages
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                      viewMode === 'list'
                        ? 'border-gray-900 text-gray-900 font-medium'
                        : 'border-transparent text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    <List className="h-3.5 w-3.5" />
                    Offen
                  </button>
                </div>
                {showAgentQuickFilter && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-400">Minuten</span>
                    <button
                      onClick={() => setMinAgentMinutes(2500)}
                      className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                        minAgentMinutes === 2500
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      ≥ 2.500
                    </button>
                    <button
                      onClick={() => setMinAgentMinutes(null)}
                      className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                        minAgentMinutes === null
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      Alle
                    </button>
                  </div>
                )}
              </div>
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
                  showAgentsMinuten={showAgentsMinuten}
                  sortConfig={sortByStage[stage.id]}
                  onSortChange={(field) => handleSortChange(stage.id, field)}
                  meetingsLoading={meetingsLoading}
                  stageHistoryLoading={stageHistoryLoading}
                />
              ))
            ) : viewMode === 'dashboard' ? (
              /* Dashboard View */
              <DashboardView
                stages={reorderedStages}
                deals={filteredDeals}
                isClosedStage={isClosedStage}
                stageHistory={stageHistoryData ?? {}}
                stageHistoryLoading={stageHistoryLoading}
                pipelineId={selectedPipelineId}
                selectedPortfolios={selectedPortfolios}
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
