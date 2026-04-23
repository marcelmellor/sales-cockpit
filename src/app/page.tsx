'use client';

import { Suspense, useCallback, useEffect, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserMenu } from '@/components/UserMenu';
import { DealStageGroup } from '@/components/pipeline/DealStageGroup';
import { DealListView } from '@/components/pipeline/DealListView';
import { DashboardView } from '@/components/pipeline/DashboardView';
import { SpreadsheetView } from '@/components/pipeline/SpreadsheetView';
import { LeadsSection } from '@/components/pipeline/LeadsSection';
import { LeadsSpreadsheetView } from '@/components/pipeline/LeadsSpreadsheetView';
import { FilterBuilder } from '@/components/pipeline/filters/FilterBuilder';
import {
  getDefaultFilterState,
  loadFilterSets,
  saveFilterSets,
  makeId,
  combineFilterWithBadges,
  loadActiveBadgeIds,
  saveActiveBadgeIds,
} from '@/components/pipeline/filters/engine';
import type {
  FilterBadge,
  FilterState,
  SavedFilterSet,
} from '@/components/pipeline/filters/types';
import {
  DEAL_DEFAULT_FIELD,
  buildDealFieldConfigs,
  getDealInputKind,
  applyDealFilters,
} from '@/components/pipeline/filters/dealFilters';
import type { DealFieldType } from '@/components/pipeline/filters/dealFilters';
import {
  LEAD_DEFAULT_FIELD,
  buildLeadFieldConfigs,
  getLeadInputKind,
  applyLeadFilters,
} from '@/components/pipeline/filters/leadFilters';
import type { LeadFieldType } from '@/components/pipeline/filters/leadFilters';
import { Loader2, LayoutGrid, RefreshCw, BarChart3, Table2, Users } from 'lucide-react';
import type { PipelineOverviewResponse, DealOverviewItem, DealMeetingsMap } from '@/app/api/deals/overview/route';
import type { DealStageHistoryMap } from '@/app/api/deals/overview/stage-history/route';
import type { LeadsOverviewResponse, LeadOverviewItem } from '@/app/api/leads/overview/route';
import { getCachedData, setCachedData, clearPipelineCache } from '@/lib/pipeline-cache';

// localStorage-Prefixe für die pro-Tab gespeicherten Filter-Sets und die
// aktiv geschalteten Badges. Pipeline/Produkt fließen mit ein, damit jeder
// Portfolio-Tab seine eigenen Sets und Badge-Zustände behält.
const DEALS_TAB_FILTERSETS_PREFIX = 'deals-tab-filtersets-';
const LEADS_TAB_FILTERSETS_PREFIX = 'leads-tab-filtersets-';
const DEALS_TAB_ACTIVE_BADGES_PREFIX = 'deals-tab-active-badges-';
const LEADS_TAB_ACTIVE_BADGES_PREFIX = 'leads-tab-active-badges-';

// IDs der System-Badges. Müssen konstant bleiben, damit ein einmal aktiv
// geschaltetes System-Badge nach Reload wieder aktiv ist.
const DEAL_SYSTEM_BADGE_OPEN = 'system:deals-open';
const DEAL_SYSTEM_BADGE_MIN_MRR = 'system:deals-min-mrr-450';
const DEAL_SYSTEM_BADGE_ICP_S1 = 'system:deals-icp-s1';
const DEAL_SYSTEM_BADGE_ICP_S2 = 'system:deals-icp-s2';
const DEAL_SYSTEM_BADGE_ICP_S3 = 'system:deals-icp-s3';
const DEAL_SYSTEM_BADGE_ICP_S4 = 'system:deals-icp-s4';
const LEAD_SYSTEM_BADGE_OPEN = 'system:leads-open';
const LEAD_SYSTEM_BADGE_MIN_1000 = 'system:leads-min-1000';
const LEAD_SYSTEM_BADGE_MIN_2000 = 'system:leads-min-2000';
const LEAD_SYSTEM_BADGE_NO_DEAL = 'system:leads-no-deal';

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

export type SortField = 'revenue' | 'agentsMinuten' | 'dealAge' | 'daysInStage' | 'nextAppointment' | 'closedDate';
export type SortDirection = 'asc' | 'desc';
export type ViewMode = 'deals' | 'dashboard' | 'leads';
// Sub-Modus innerhalb Deals- und Leads-Tab: Sales-Sicht (Kachel-/Listenansicht
// mit Story) oder Sheet (tabellarisch, mit CSV-Export). Wird pro Tab separat
// gehalten, damit ein Wechsel zwischen Deals und Leads die gewählte Sicht nicht
// zurücksetzt.
export type ContentMode = 'sales' | 'sheet';
export type DealsGrouping = 'stage' | 'none';

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
  const [sortByStage, setSortByStage] = useState<Record<string, { field: SortField; direction: SortDirection }>>({});
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  // Getrennte Sub-View-States für Deals und Leads — so merkt sich jeder Tab
  // seine zuletzt gewählte Sicht (Sales vs. Sheet) auch beim Hin- und
  // Herspringen zwischen den Tabs.
  const [dealsSubView, setDealsSubView] = useState<ContentMode>('sales');
  const [leadsSubView, setLeadsSubView] = useState<ContentMode>('sales');
  const [grouping, setGrouping] = useState<DealsGrouping>('stage');
  const [listSortConfig, setListSortConfig] = useState<{ field: SortField; direction: SortDirection }>({ field: 'revenue', direction: 'desc' });

  // Deals-Tab- und Leads-Tab-Filter (dasselbe Modell wie der Dashboard-Filter,
  // nur pro Tab eigene State-Instanzen + eigene gespeicherte Filter-Sets).
  const [dealsFilter, setDealsFilter] = useState<FilterState<DealFieldType>>(() => getDefaultFilterState<DealFieldType>());
  const [dealsSavedSets, setDealsSavedSets] = useState<SavedFilterSet<DealFieldType>[]>([]);
  const [leadsFilter, setLeadsFilter] = useState<FilterState<LeadFieldType>>(() => getDefaultFilterState<LeadFieldType>());
  const [leadsSavedSets, setLeadsSavedSets] = useState<SavedFilterSet<LeadFieldType>[]>([]);

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

  // Fetch leads for the selected portfolio (separate CRM object, own pipeline).
  // Wird analog zu Deals auch in localStorage gecached, damit nach einem Reload
  // sofort Inhalte dastehen. Cache-Key nur nach Produkt, weil der Leads-Endpoint
  // keine Pipeline-Auswahl kennt (fix auf LEAD_PIPELINE_ID im Route-Handler).
  const leadsCacheKey = selectedProdukt ? `leads-overview-${selectedProdukt}` : null;
  const cachedLeads = useMemo(
    () => leadsCacheKey ? getCachedData<LeadsOverviewResponse>(leadsCacheKey) : null,
    [leadsCacheKey]
  );

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ['pipeline-leads', selectedProdukt],
    queryFn: async () => {
      const response = await fetch(`/api/leads/overview?produkt=${selectedProdukt}`);
      if (!response.ok) throw new Error('Failed to fetch leads overview');
      const data = await response.json();
      const result = data.data as LeadsOverviewResponse;
      if (leadsCacheKey) setCachedData(leadsCacheKey, result);
      return result;
    },
    enabled: isAuthenticated && !!selectedProdukt,
    staleTime: 5 * 60 * 1000,
    initialData: cachedLeads ?? undefined,
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
      clearPipelineCache(cacheKey, selectedProdukt ?? undefined);
    }
    queryClient.invalidateQueries({ queryKey: ['pipeline-overview', selectedPipelineId, selectedProdukt] });
    queryClient.invalidateQueries({ queryKey: ['pipeline-meetings', selectedPipelineId, selectedProdukt] });
    queryClient.invalidateQueries({ queryKey: ['pipeline-stage-history', selectedPipelineId, selectedProdukt] });
    queryClient.invalidateQueries({ queryKey: ['pipeline-leads', selectedProdukt] });
  };

  // Combined loading state for secondary data
  const secondaryDataLoading = meetingsFetching || stageHistoryFetching;

  // Show Agents Minuten column when AI Agent is selected
  const showAgentsMinuten = selectedProdukt === 'frontdesk';

  // Show the MRR ≥ 450 € System-Badge standardmäßig nur für AI Agents, weil
  // dort diese Heuristik sinnvoll ist (andere Portfolios haben andere Preise).
  const showAgentMrrBadge = selectedProdukt === 'frontdesk';

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
      } else if (field === 'daysInStage') {
        // -1 bedeutet "unbekannt" (Stage-History noch nicht geladen). Solche
        // Deals ans Ende sortieren, damit sie nicht fälschlich als "am
        // längsten in Stage" oben landen.
        const aDays = a.daysInStage >= 0 ? a.daysInStage : Infinity;
        const bDays = b.daysInStage >= 0 ? b.daysInStage : Infinity;
        comparison = aDays - bDays;
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

  // ── Deals-/Leads-Tab Advanced-Filter ────────────────────────────────────
  // Storage-Keys (pro Pipeline+Produkt / pro Produkt). Nicht-nullable nur,
  // wenn beide Parameter gesetzt sind — sonst haben wir nichts zum Trennen.
  const dealsFiltersetsKey = selectedPipelineId && selectedProdukt
    ? `${DEALS_TAB_FILTERSETS_PREFIX}${selectedPipelineId}-${selectedProdukt}`
    : null;
  const leadsFiltersetsKey = selectedProdukt ? `${LEADS_TAB_FILTERSETS_PREFIX}${selectedProdukt}` : null;
  const dealsActiveBadgesKey = selectedPipelineId && selectedProdukt
    ? `${DEALS_TAB_ACTIVE_BADGES_PREFIX}${selectedPipelineId}-${selectedProdukt}`
    : null;
  const leadsActiveBadgesKey = selectedProdukt ? `${LEADS_TAB_ACTIVE_BADGES_PREFIX}${selectedProdukt}` : null;

  // Aktive Badges pro Tab. Default-Aktiv-Logik (für System-Badges wie
  // "MRR ≥ 450 €") wird unten beim ersten Laden via defaultActive angewendet.
  const [activeDealsBadgeIds, setActiveDealsBadgeIds] = useState<string[]>([]);
  const [activeLeadsBadgeIds, setActiveLeadsBadgeIds] = useState<string[]>([]);

  // Gespeicherte Filter-Sets aus localStorage laden, sobald der Kontext
  // (Pipeline/Produkt) steht oder sich ändert. Bewusst cascading-rerender,
  // weil die Sets an einen externen Store (localStorage) gekoppelt sind.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDealsSavedSets(dealsFiltersetsKey ? loadFilterSets<DealFieldType>(dealsFiltersetsKey) : []);
  }, [dealsFiltersetsKey]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLeadsSavedSets(leadsFiltersetsKey ? loadFilterSets<LeadFieldType>(leadsFiltersetsKey) : []);
  }, [leadsFiltersetsKey]);

  // Aktive Badge-IDs laden. Wenn noch keine Auswahl persistiert ist, werden
  // die `defaultActive: true`-System-Badges standardmäßig aktiv geschaltet.
  useEffect(() => {
    if (!dealsActiveBadgesKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveDealsBadgeIds([]);
      return;
    }
    const stored = loadActiveBadgeIds(dealsActiveBadgesKey);
    setActiveDealsBadgeIds(stored ?? (selectedProdukt === 'frontdesk' ? [DEAL_SYSTEM_BADGE_MIN_MRR] : []));
  }, [dealsActiveBadgesKey, selectedProdukt]);
  useEffect(() => {
    if (!leadsActiveBadgesKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveLeadsBadgeIds([]);
      return;
    }
    const stored = loadActiveBadgeIds(leadsActiveBadgesKey);
    setActiveLeadsBadgeIds(stored ?? [LEAD_SYSTEM_BADGE_MIN_1000, LEAD_SYSTEM_BADGE_NO_DEAL]);
  }, [leadsActiveBadgesKey]);

  const dealsFieldConfigs = useMemo(() => buildDealFieldConfigs(reorderedStages), [reorderedStages]);
  const leadsFieldConfigs = useMemo(
    () => buildLeadFieldConfigs(leadsData?.stages ?? [], leadsData?.leads ?? []),
    [leadsData?.stages, leadsData?.leads],
  );

  // System-Badges für den Deals-Tab: "Nur offene Deals" immer verfügbar,
  // "MRR ≥ 450 €" nur für AI Agents. Beide Badges sind fest im Code definiert
  // und werden als Badge (nicht als Header-Quickfilter) dargestellt.
  const dealsSystemBadges: FilterBadge<DealFieldType>[] = useMemo(() => {
    const badges: FilterBadge<DealFieldType>[] = [
      {
        id: DEAL_SYSTEM_BADGE_OPEN,
        label: 'Nur offene Deals',
        system: true,
        filter: {
          logic: 'AND',
          children: [{
            kind: 'criterion',
            id: 'sys-open',
            type: 'status',
            operator: 'after',
            dateFrom: '',
            stringValue: 'open',
          }],
        },
      },
    ];
    if (showAgentMrrBadge) {
      badges.push({
        id: DEAL_SYSTEM_BADGE_MIN_MRR,
        label: 'MRR ≥ 450 €',
        system: true,
        defaultActive: true,
        filter: {
          logic: 'AND',
          children: [{
            kind: 'criterion',
            id: 'sys-mrr',
            type: 'mrr',
            operator: 'after',
            dateFrom: '',
            numberFrom: 449,
          }],
        },
      });
    }
    // ICP-Tier-Badges (S1–S4). Teilen sich die `orGroup: 'icp_tier'`, damit
    // Mehrfachauswahl als OR ausgewertet wird (S1 oder S2 …). Pro Deal ist
    // genau ein Tier gesetzt; ohne orGroup würde "S1 und S2 aktiv" alles
    // ausfiltern.
    const icpBadges: Array<{ id: string; value: 'S1' | 'S2' | 'S3' | 'S4' }> = [
      { id: DEAL_SYSTEM_BADGE_ICP_S1, value: 'S1' },
      { id: DEAL_SYSTEM_BADGE_ICP_S2, value: 'S2' },
      { id: DEAL_SYSTEM_BADGE_ICP_S3, value: 'S3' },
      { id: DEAL_SYSTEM_BADGE_ICP_S4, value: 'S4' },
    ];
    for (const b of icpBadges) {
      badges.push({
        id: b.id,
        label: b.value,
        system: true,
        orGroup: 'icp_tier',
        filter: {
          logic: 'AND',
          children: [{
            kind: 'criterion',
            id: `sys-icp-${b.value}`,
            type: 'icp_tier',
            operator: 'after',
            dateFrom: '',
            stringValue: b.value,
          }],
        },
      });
    }
    return badges;
  }, [showAgentMrrBadge]);

  // System-Badges für den Leads-Tab. Die Minuten-Badges verwenden eine
  // OR-Gruppe mit agents_minuten + inbound_volumen, damit Leads, die (noch)
  // keine Agent-Minuten haben, über ihr Inbound-Volumen matchen können.
  const leadsSystemBadges: FilterBadge<LeadFieldType>[] = useMemo(() => {
    const minMinutenFilter = (threshold: number): FilterState<LeadFieldType> => ({
      logic: 'AND',
      children: [{
        kind: 'group',
        id: `sys-lead-min-${threshold}-grp`,
        logic: 'OR',
        children: [
          {
            kind: 'criterion',
            id: `sys-lead-min-${threshold}-am`,
            type: 'agents_minuten',
            operator: 'after',
            dateFrom: '',
            numberFrom: threshold,
          },
          {
            kind: 'criterion',
            id: `sys-lead-min-${threshold}-iv`,
            type: 'inbound_volumen',
            operator: 'after',
            dateFrom: '',
            numberFrom: threshold,
          },
        ],
      }],
    });

    return [
      {
        id: LEAD_SYSTEM_BADGE_OPEN,
        label: 'Nur offene Leads',
        system: true,
        filter: {
          logic: 'AND',
          children: [{
            kind: 'criterion',
            id: 'sys-lead-open',
            type: 'status',
            operator: 'after',
            dateFrom: '',
            stringValue: 'open',
          }],
        },
      },
      {
        id: LEAD_SYSTEM_BADGE_MIN_1000,
        label: '≥ 1000 Min.',
        system: true,
        defaultActive: true,
        filter: minMinutenFilter(1000),
      },
      {
        id: LEAD_SYSTEM_BADGE_MIN_2000,
        label: '≥ 2000 Min.',
        system: true,
        filter: minMinutenFilter(2000),
      },
      {
        id: LEAD_SYSTEM_BADGE_NO_DEAL,
        label: 'Ohne Deal',
        system: true,
        defaultActive: true,
        filter: {
          logic: 'AND',
          children: [{
            kind: 'criterion',
            id: 'sys-lead-no-deal',
            type: 'has_deal',
            operator: 'after',
            dateFrom: '',
            booleanValue: false,
          }],
        },
      },
    ];
  }, []);

  // Aktive Badges (System + gespeicherte Sets) in ausführbare Filter auflösen.
  const activeDealsBadges: FilterBadge<DealFieldType>[] = useMemo(() => {
    const system = dealsSystemBadges.filter(b => activeDealsBadgeIds.includes(b.id));
    const saved = dealsSavedSets
      .filter(s => activeDealsBadgeIds.includes(s.id))
      .map(s => ({ id: s.id, label: s.name, filter: s.filter }));
    return [...system, ...saved];
  }, [dealsSystemBadges, dealsSavedSets, activeDealsBadgeIds]);

  const activeLeadsBadges: FilterBadge<LeadFieldType>[] = useMemo(() => {
    const system = leadsSystemBadges.filter(b => activeLeadsBadgeIds.includes(b.id));
    const saved = leadsSavedSets
      .filter(s => activeLeadsBadgeIds.includes(s.id))
      .map(s => ({ id: s.id, label: s.name, filter: s.filter }));
    return [...system, ...saved];
  }, [leadsSystemBadges, leadsSavedSets, activeLeadsBadgeIds]);

  const effectiveDealsFilter = useMemo(
    () => combineFilterWithBadges<DealFieldType>(dealsFilter, activeDealsBadges),
    [dealsFilter, activeDealsBadges],
  );
  const effectiveLeadsFilter = useMemo(
    () => combineFilterWithBadges<LeadFieldType>(leadsFilter, activeLeadsBadges),
    [leadsFilter, activeLeadsBadges],
  );

  // Den effektiven Filterbaum (manuell + aktive Badges) auf die Deals anwenden.
  const dealsForDealsTab = useMemo(
    () => applyDealFilters(dealsWithMeetings, effectiveDealsFilter, stageHistoryData ?? {}, stageHistoryLoading),
    [dealsWithMeetings, effectiveDealsFilter, stageHistoryData, stageHistoryLoading],
  );

  // Leads-Basis: rohe Liste — alle Quickfilter sind jetzt System-Badges und
  // fließen über effectiveLeadsFilter in applyLeadFilters ein.
  const leadsBase: LeadOverviewItem[] = useMemo(
    () => leadsData?.leads ?? [],
    [leadsData?.leads],
  );

  const leadsForLeadsTab = useMemo(
    () => applyLeadFilters(leadsBase, effectiveLeadsFilter),
    [leadsBase, effectiveLeadsFilter],
  );

  // Filter-Set Handler: Deals-Tab
  const handleSaveDealsFilterSet = useCallback((name: string) => {
    if (!dealsFiltersetsKey || !name.trim()) return;
    setDealsSavedSets(prev => {
      const existing = prev.find(s => s.name === name.trim());
      const next: SavedFilterSet<DealFieldType>[] = existing
        ? prev.map(s => s.id === existing.id ? { ...s, filter: structuredClone(dealsFilter) } : s)
        : [...prev, { id: makeId(), name: name.trim(), filter: structuredClone(dealsFilter) }];
      saveFilterSets<DealFieldType>(dealsFiltersetsKey, next);
      return next;
    });
  }, [dealsFiltersetsKey, dealsFilter]);
  const handleDeleteDealsFilterSet = useCallback((id: string) => {
    if (!dealsFiltersetsKey) return;
    setDealsSavedSets(prev => {
      const next = prev.filter(s => s.id !== id);
      saveFilterSets<DealFieldType>(dealsFiltersetsKey, next);
      return next;
    });
    setActiveDealsBadgeIds(prev => {
      if (!prev.includes(id)) return prev;
      const next = prev.filter(x => x !== id);
      if (dealsActiveBadgesKey) saveActiveBadgeIds(dealsActiveBadgesKey, next);
      return next;
    });
  }, [dealsFiltersetsKey, dealsActiveBadgesKey]);
  const handleToggleDealsBadge = useCallback((id: string) => {
    setActiveDealsBadgeIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      if (dealsActiveBadgesKey) saveActiveBadgeIds(dealsActiveBadgesKey, next);
      return next;
    });
  }, [dealsActiveBadgesKey]);

  // Filter-Set Handler: Leads-Tab
  const handleSaveLeadsFilterSet = useCallback((name: string) => {
    if (!leadsFiltersetsKey || !name.trim()) return;
    setLeadsSavedSets(prev => {
      const existing = prev.find(s => s.name === name.trim());
      const next: SavedFilterSet<LeadFieldType>[] = existing
        ? prev.map(s => s.id === existing.id ? { ...s, filter: structuredClone(leadsFilter) } : s)
        : [...prev, { id: makeId(), name: name.trim(), filter: structuredClone(leadsFilter) }];
      saveFilterSets<LeadFieldType>(leadsFiltersetsKey, next);
      return next;
    });
  }, [leadsFiltersetsKey, leadsFilter]);
  const handleDeleteLeadsFilterSet = useCallback((id: string) => {
    if (!leadsFiltersetsKey) return;
    setLeadsSavedSets(prev => {
      const next = prev.filter(s => s.id !== id);
      saveFilterSets<LeadFieldType>(leadsFiltersetsKey, next);
      return next;
    });
    setActiveLeadsBadgeIds(prev => {
      if (!prev.includes(id)) return prev;
      const next = prev.filter(x => x !== id);
      if (leadsActiveBadgesKey) saveActiveBadgeIds(leadsActiveBadgesKey, next);
      return next;
    });
  }, [leadsFiltersetsKey, leadsActiveBadgesKey]);
  const handleToggleLeadsBadge = useCallback((id: string) => {
    setActiveLeadsBadgeIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      if (leadsActiveBadgesKey) saveActiveBadgeIds(leadsActiveBadgesKey, next);
      return next;
    });
  }, [leadsActiveBadgesKey]);

  // Group deals by stage
  const dealsByStage = reorderedStages.map(stage => {
    const sortedDeals = sortDeals(
      dealsForDealsTab.filter(deal => deal.dealStageId === stage.id),
      stage.id
    );
    const isClosed = isClosedStage(stage.label);
    return {
      stage,
      deals: isClosed ? sortedDeals.slice(0, 20) : sortedDeals,
      totalCount: sortedDeals.length,
    };
  }) || [];

  // Flat list for grouping="none" — globally sorted
  const flatSortedDeals = useMemo(() => {
    return [...dealsForDealsTab].sort((a, b) => {
      const { field, direction } = listSortConfig;
      let comparison = 0;

      if (field === 'revenue') {
        comparison = a.revenue - b.revenue;
      } else if (field === 'agentsMinuten') {
        comparison = a.agentsMinuten - b.agentsMinuten;
      } else if (field === 'dealAge') {
        comparison = a.dealAge - b.dealAge;
      } else if (field === 'daysInStage') {
        const aDays = a.daysInStage >= 0 ? a.daysInStage : Infinity;
        const bDays = b.daysInStage >= 0 ? b.daysInStage : Infinity;
        comparison = aDays - bDays;
      } else if (field === 'nextAppointment') {
        const aDate = a.nextAppointment?.date ? new Date(a.nextAppointment.date).getTime() : Infinity;
        const bDate = b.nextAppointment?.date ? new Date(b.nextAppointment.date).getTime() : Infinity;
        comparison = aDate - bDate;
      }

      return direction === 'asc' ? comparison : -comparison;
    });
  }, [dealsForDealsTab, listSortConfig]);

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
                    {viewMode === 'leads' ? (
                      <>
                        {(leadsData?.leads.length ?? 0)} Lead{(leadsData?.leads.length ?? 0) !== 1 ? 's' : ''}
                        {leadsLoading && (
                          <Loader2 className="h-3 w-3 animate-spin inline ml-1.5 text-blue-500" />
                        )}
                      </>
                    ) : (
                      <>
                        {dealsWithMeetings.length} Deal{dealsWithMeetings.length !== 1 ? 's' : ''}
                        {(meetingsLoading || stageHistoryLoading) && (
                          <Loader2 className="h-3 w-3 animate-spin inline ml-1.5 text-blue-500" />
                        )}
                      </>
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
                    onClick={() => setViewMode('deals')}
                    className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                      viewMode === 'deals'
                        ? 'border-gray-900 text-gray-900 font-medium'
                        : 'border-transparent text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Deals
                  </button>
                  <button
                    onClick={() => setViewMode('leads')}
                    className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                      viewMode === 'leads'
                        ? 'border-gray-900 text-gray-900 font-medium'
                        : 'border-transparent text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    <Users className="h-3.5 w-3.5" />
                    Leads
                    {leadsData && (
                      <span className="ml-0.5 text-xs text-gray-400">
                        ({leadsData.leads.filter(l => !l.leadStageIsClosed).length})
                      </span>
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-4">
                  {(viewMode === 'deals' || viewMode === 'leads') && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() =>
                          viewMode === 'deals' ? setDealsSubView('sales') : setLeadsSubView('sales')
                        }
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          (viewMode === 'deals' ? dealsSubView : leadsSubView) === 'sales'
                            ? 'bg-gray-900 text-white'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        <LayoutGrid className="h-3 w-3" />
                        Sales
                      </button>
                      <button
                        onClick={() =>
                          viewMode === 'deals' ? setDealsSubView('sheet') : setLeadsSubView('sheet')
                        }
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          (viewMode === 'deals' ? dealsSubView : leadsSubView) === 'sheet'
                            ? 'bg-gray-900 text-white'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        <Table2 className="h-3 w-3" />
                        Sheet
                      </button>
                    </div>
                  )}
                  {((viewMode === 'deals' && dealsSubView === 'sales') ||
                    (viewMode === 'leads' && leadsSubView === 'sales')) && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400">Gruppierung</span>
                      <button
                        onClick={() => setGrouping('stage')}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          grouping === 'stage'
                            ? 'bg-gray-900 text-white'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        Nach Stage
                      </button>
                      <button
                        onClick={() => setGrouping('none')}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          grouping === 'none'
                            ? 'bg-gray-900 text-white'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        Keine
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* View Content */}
            {viewMode === 'dashboard' ? (
              /* Dashboard View */
              <DashboardView
                key={`${selectedPipelineId ?? 'none'}-${selectedProdukt ?? 'none'}`}
                stages={reorderedStages}
                deals={dealsWithMeetings}
                isClosedStage={isClosedStage}
                stageHistory={stageHistoryData ?? {}}
                stageHistoryLoading={stageHistoryLoading}
                pipelineId={selectedPipelineId}
                produkt={selectedProdukt}
                leads={leadsData?.leads ?? []}
              />
            ) : viewMode === 'leads' ? (
              /* Leads-Tab: Sales- oder Sheet-Sicht */
              <>
                <FilterBuilder<LeadFieldType>
                  filter={leadsFilter}
                  onSetFilter={setLeadsFilter}
                  fieldConfigs={leadsFieldConfigs}
                  defaultType={LEAD_DEFAULT_FIELD}
                  getInputKind={getLeadInputKind}
                  totalFiltered={leadsForLeadsTab.length}
                  totalItems={leadsBase.length}
                  itemLabel="Leads"
                  savedSets={leadsSavedSets}
                  onSaveFilterSet={handleSaveLeadsFilterSet}
                  onDeleteFilterSet={handleDeleteLeadsFilterSet}
                  showFilterSets={!!leadsFiltersetsKey}
                  systemBadges={leadsSystemBadges}
                  activeBadgeIds={activeLeadsBadgeIds}
                  onToggleBadge={handleToggleLeadsBadge}
                />
                {leadsSubView === 'sheet' ? (
                  <LeadsSpreadsheetView leads={leadsForLeadsTab} />
                ) : (
                  <LeadsSection
                    leads={leadsForLeadsTab}
                    stages={leadsData?.stages ?? []}
                    grouping={grouping}
                    loading={leadsLoading}
                  />
                )}
              </>
            ) : (
              <>
                <FilterBuilder<DealFieldType>
                  filter={dealsFilter}
                  onSetFilter={setDealsFilter}
                  fieldConfigs={dealsFieldConfigs}
                  defaultType={DEAL_DEFAULT_FIELD}
                  getInputKind={getDealInputKind}
                  totalFiltered={dealsForDealsTab.length}
                  totalItems={dealsWithMeetings.length}
                  itemLabel="Deals"
                  pendingDataLabel={stageHistoryLoading ? 'Stage-History laden...' : null}
                  pendingDataLoading={stageHistoryLoading}
                  savedSets={dealsSavedSets}
                  onSaveFilterSet={handleSaveDealsFilterSet}
                  onDeleteFilterSet={handleDeleteDealsFilterSet}
                  showFilterSets={!!dealsFiltersetsKey}
                  systemBadges={dealsSystemBadges}
                  activeBadgeIds={activeDealsBadgeIds}
                  onToggleBadge={handleToggleDealsBadge}
                />
                {dealsSubView === 'sheet' ? (
                  /* Deals-Tab, Sheet-Sicht */
                  <SpreadsheetView deals={dealsForDealsTab} />
                ) : grouping === 'stage' ? (
                  /* Deals, grouped by stage */
                  <>
                    {dealsByStage.map(({ stage, deals, totalCount }) => (
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
                    ))}
                  </>
                ) : (
                  /* Deals, flat list */
                  <DealListView
                    deals={flatSortedDeals}
                    pipelineId={selectedPipelineId}
                    onlyOpen={activeDealsBadgeIds.includes(DEAL_SYSTEM_BADGE_OPEN)}
                    sortConfig={listSortConfig}
                    onSortChange={handleListSortChange}
                    meetingsLoading={meetingsLoading}
                    stageHistoryLoading={stageHistoryLoading}
                  />
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
