'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, status } = useSession();
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [selectedPortfolios, setSelectedPortfolios] = useState<Set<string>>(new Set());
  const [minAgentMinutes, setMinAgentMinutes] = useState<number | null>(2500);
  const [sortByStage, setSortByStage] = useState<Record<string, { field: SortField; direction: SortDirection }>>({});
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [listSortConfig, setListSortConfig] = useState<{ field: SortField; direction: SortDirection }>({ field: 'revenue', direction: 'desc' });

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

  // Auto-select "Sales Pipeline" when pipelines are loaded
  useEffect(() => {
    if (pipelinesData && !selectedPipelineId) {
      const salesPipeline = pipelinesData.find(p => p.label === 'Sales Pipeline');
      if (salesPipeline) {
        setSelectedPipelineId(salesPipeline.id);
        const cachedSort = getCachedData<Record<string, { field: SortField; direction: SortDirection }>>(`sort-${salesPipeline.id}`);
        if (cachedSort) setSortByStage(cachedSort);
      }
    }
  }, [pipelinesData, selectedPipelineId]);

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
    () => selectedPipelineId ? getCachedData<DealMeetingsMap>(`meetings-${selectedPipelineId}`) : null,
    [selectedPipelineId]
  );

  // Fetch meetings separately (slower - sequential API calls)
  const { data: meetingsData, isLoading: meetingsLoading, isFetching: meetingsFetching } = useQuery({
    queryKey: ['pipeline-meetings', selectedPipelineId, dealIds.join(',')],
    queryFn: async () => {
      if (dealIds.length === 0) return {} as DealMeetingsMap;
      const result = await fetchInBatches<DealMeetingsMap>('/api/deals/overview/meetings', dealIds);
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
      const result = await fetchInBatches<DealStageHistoryMap>('/api/deals/overview/stage-history', dealIds);
      setCachedData(`stage-history-${selectedPipelineId}`, result);
      return result;
    },
    enabled: isAuthenticated && dealIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    initialData: cachedStageHistory ?? undefined,
  });

  // Toggle portfolio selection
  const togglePortfolio = (portfolio: string) => {
    setSelectedPortfolios(prev => {
      const next = new Set(prev);
      if (next.has(portfolio)) {
        next.delete(portfolio);
      } else {
        next.add(portfolio);
      }
      return next;
    });
  };

  // Merge meetings and stage history into deals, then filter by portfolio
  const dealsWithMeetings: DealOverviewItem[] = useMemo(() => {
    if (!overviewData?.deals) return [];
    const merged = overviewData.deals.map(deal => ({
      ...deal,
      nextAppointment: meetingsData?.[deal.id] || null,
      daysInStage: stageHistoryData?.[deal.id]?.daysInStage ?? -1,
      stageEnteredAt: stageHistoryData?.[deal.id]?.stageEnteredAt ?? null,
    }));
    // Filter by selected portfolios (empty set = show all)
    if (selectedPortfolios.size === 0) return merged;
    return merged.filter(deal => {
      // angeboteneProdukte can be semicolon-separated for multi-value
      const dealProducts = deal.angeboteneProdukte ? deal.angeboteneProdukte.split(';') : [];
      return dealProducts.some(p => selectedPortfolios.has(p));
    });
  }, [overviewData?.deals, meetingsData, stageHistoryData, selectedPortfolios]);

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

  // Show Agents Minuten column when AI Agent is part of the selected portfolios (or when showing all)
  const showAgentsMinuten = selectedPortfolios.size === 0 || selectedPortfolios.has('frontdesk');

  // Show the agent minutes quick-filter only when AI Agent is the sole selected portfolio
  const showAgentQuickFilter = selectedPortfolios.size === 1 && selectedPortfolios.has('frontdesk');

  // Apply agent minutes quick-filter for Stages/List views
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
      s.label.toLowerCase().includes('closed lost') || s.label.toLowerCase().includes('verloren') || s.label.toLowerCase().includes('lost')
    );
    const gewonnenIndex = stages.findIndex(s =>
      s.label.toLowerCase().includes('closed won') || s.label.toLowerCase().includes('gewonnen') || s.label.toLowerCase().includes('won')
    );

    // If both exist and verloren comes before gewonnen, swap them
    if (verlorenIndex !== -1 && gewonnenIndex !== -1 && verlorenIndex < gewonnenIndex) {
      [stages[verlorenIndex], stages[gewonnenIndex]] = [stages[gewonnenIndex], stages[verlorenIndex]];
    }

    return stages;
  }, [overviewData?.stages]);

  // Helper to check if stage is closed (won or lost)
  const isClosedStage = useCallback((label: string): boolean => {
    const closedKeywords = ['closed won', 'closed lost', 'verloren', 'lost', 'gewonnen', 'won', 'abgesagt', 'cancelled', 'storniert'];
    return closedKeywords.some(keyword => label.toLowerCase().includes(keyword));
  }, []);

  // Group deals by stage (using dealsWithMeetings)
  // Limit closed stages (won/lost) to 20 deals
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

  // Filter open deals (exclude closed/won stages) and sort for list view
  const openDeals = useMemo(() => {
    const filtered = filteredDeals.filter(deal =>
      !deal.dealStage.toLowerCase().includes('closed won') &&
      !deal.dealStage.toLowerCase().includes('closed lost') &&
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
          <div className="flex items-center gap-2 flex-wrap">
            {/* Portfolio Filter Pills */}
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wide mr-1">Portfolio</span>
            <button
              onClick={() => setSelectedPortfolios(new Set())}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedPortfolios.size === 0
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              Alle
            </button>
            {PORTFOLIO_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => togglePortfolio(value)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedPortfolios.has(value)
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
        ) : !selectedPipelineId || overviewLoading ? (
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center justify-center gap-2 text-gray-400 py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
              Deals werden geladen...
            </div>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto px-4 space-y-6">
            {/* Pipeline Header + Tab bar */}
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <h1 className="text-lg font-semibold text-gray-900">
                  {overviewData?.pipelineName}
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
