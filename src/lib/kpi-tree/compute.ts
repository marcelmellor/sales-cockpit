// KPI-tree computation: turns the live overview data (deals, leads, marketing
// BQ totals, playbook stats) into per-week metric values, and resolves the
// computed/derived nodes and targets. Pure functions — no React, no I/O — so
// they can be reused by both the React view and the MCP server.

import type { DealOverviewItem } from '@/app/api/deals/overview/route';
import type { LeadOverviewItem } from '@/app/api/leads/overview/route';
import { isIcpRevenue, type MarketingFunnelResponse } from '@/lib/marketing/funnel-types';
import { classifyLead, leadMinutes, buildJourneyMap } from '@/lib/leads/classify';
import type { PlaybookStats } from '@/lib/amplitude/playbook-stats';
import { isWonStageLabel, isLostStageLabel } from '@/lib/hubspot/mrr';
import {
  METRICS,
  fmtNum,
  fmtEur,
  fmtTarget,
  parseNum,
  type GoalSet,
} from './model';

export interface LiveData {
  values: Map<string, string>;
  /** Dynamic tooltips showing the formula behind a value. Overrides the
   *  static `tooltip` on MetricNode when present. */
  tooltips: Map<string, string>;
}

export function computeLiveValues(
  deals: DealOverviewItem[],
  leads: LeadOverviewItem[],
  marketingData: MarketingFunnelResponse | undefined,
  playbookStats: PlaybookStats | undefined,
  days: number,
  cutoffEnd: number = Date.now(),
): LiveData {
  const values = new Map<string, string>();
  const tooltips = new Map<string, string>();
  const weeks = Math.max(days / 7, 1);
  const cutoff = cutoffEnd - days * 24 * 60 * 60 * 1000;

  // ── Deal-based metrics (rolling window, ICP only: MRR ≥ threshold) ───────

  const icpDeals = deals.filter(d => isIcpRevenue(d.revenue));

  const recentCreated = icpDeals.filter(
    d => d.createdate && new Date(d.createdate).getTime() >= cutoff && new Date(d.createdate).getTime() < cutoffEnd,
  );
  const recentWon = icpDeals.filter(
    d => isWonStageLabel(d.dealStage) && d.closedate && new Date(d.closedate).getTime() >= cutoff && new Date(d.closedate).getTime() < cutoffEnd,
  );
  const recentLost = icpDeals.filter(
    d => isLostStageLabel(d.dealStage) && d.closedate && new Date(d.closedate).getTime() >= cutoff && new Date(d.closedate).getTime() < cutoffEnd,
  );
  const recentClosed = recentWon.length + recentLost.length;

  // Deals / Woche
  if (recentCreated.length > 0) {
    values.set('deals', fmtNum(recentCreated.length / weeks));
    tooltips.set('deals', `${recentCreated.length} neue Deals in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
  }

  // Sales / Woche (won deals)
  if (recentWon.length > 0) {
    values.set('sales', fmtNum(recentWon.length / weeks));
    tooltips.set('sales', `${recentWon.length} Won-Deals in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
  }

  // Conversion = Won / (Won + Lost) — nur abgeschlossene Deals
  if (recentClosed > 0) {
    const conv = recentWon.length / recentClosed;
    values.set('conversion', fmtNum(conv * 100) + ' %');
    tooltips.set('conversion', `${recentWon.length} Won / ${recentClosed} abgeschlossen (${recentWon.length} Won + ${recentLost.length} Lost) in ${days} Tagen — nach Abschlussdatum, nicht Erstelldatum`);
  }

  // Sales Cycle = Ø Tage von Erstellung bis Abschluss (Won + Lost)
  const closedWithDates = [...recentWon, ...recentLost].filter(d => d.createdate && d.closedate);
  if (closedWithDates.length > 0) {
    const openCount = recentCreated.length - recentClosed;
    const avgDays = closedWithDates.reduce((sum, d) => {
      return sum + (new Date(d.closedate!).getTime() - new Date(d.createdate!).getTime()) / (24 * 60 * 60 * 1000);
    }, 0) / closedWithDates.length;
    const rounded = Math.round(avgDays);
    values.set('cycle', `${rounded} Tage`);
    tooltips.set('cycle', `Ø ${rounded} Tage aus ${closedWithDates.length} abgeschlossenen Deals (${recentWon.length} Won + ${recentLost.length} Lost) — ${openCount} weitere Deals noch offen`);
  }

  // ICP-Kunden / Woche (won deals with ICP tier)
  const recentIcp = recentWon.filter(d => d.icpTier != null);
  if (recentWon.length > 0) {
    values.set('icp', fmtNum(recentIcp.length / weeks));
    tooltips.set('icp', `${recentIcp.length} von ${recentWon.length} Won-Deals mit ICP-Tier in ${days} Tagen`);
  }

  // ARPA (average revenue of recently won deals)
  if (recentWon.length > 0) {
    const avgRevenue = recentWon.reduce((sum, d) => sum + d.revenue, 0) / recentWon.length;
    values.set('arpa', fmtEur(avgRevenue));
    tooltips.set('arpa', `Ø MRR aus ${recentWon.length} Won-Deals`);
  }

  // ── Leads / Woche (HubSpot leads with ≥ 2.000 Min, same source as chart) ──

  const recentLeads = leads.filter(l => {
    if (!l.createdate) return false;
    const ts = new Date(l.createdate).getTime();
    if (ts < cutoff || ts >= cutoffEnd) return false;
    const mins = leadMinutes(l);
    return mins != null && mins >= 2000;
  });
  if (recentLeads.length > 0) {
    values.set('leads', fmtNum(recentLeads.length / weeks));
    tooltips.set('leads', `${recentLeads.length} Leads (≥ 2.000 Min) in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
  }

  // ── Marketing-based metrics (BQ totals ÷ weeks in date range) ────────────

  if (marketingData) {
    const bq = marketingData.bqTotals;

    // Agent Signups / Woche (nur Frontdesk-Signup, nicht PBX)
    values.set('signup', fmtNum(bq.activationAgent / weeks));
    tooltips.set('signup', `${bq.activationAgent} Agent-Signups in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);

    // PBX Signups / Woche (alle Nicht-Frontdesk-Signups)
    values.set('pbx-signups', fmtNum(bq.activationOther / weeks));
    tooltips.set('pbx-signups', `${bq.activationOther} PBX-Signups in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);

    // Previews / Woche — Gesamt + Aufschlüsselung nach Herkunft
    values.set('trials', fmtNum(bq.previewTrialTotal / weeks));
    tooltips.set('trials', `${bq.previewTrialTotal} Previews in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
    values.set('preview-pbx', fmtNum(bq.previewTrialOther / weeks));
    tooltips.set('preview-pbx', `${bq.previewTrialOther} PBX-Previews in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
    values.set('preview-bestand', fmtNum(bq.previewTrialBestandskunde / weeks));
    tooltips.set('preview-bestand', `${bq.previewTrialBestandskunde} Bestandskunden-Previews in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);

    // ── Lead classification: Amplitude touchpoints → HubSpot leadSource fallback
    const journeyByLeadId = buildJourneyMap(marketingData.journeys);

    if (recentLeads.length > 0) {
      const counts = { 'contact-form': 0, 'pbx-onboarding': 0, 'in-product': 0, 'sonstige': 0 };
      let cfDe = 0;
      let cfAi = 0;

      for (const l of recentLeads) {
        const bucket = classifyLead(l, journeyByLeadId);
        counts[bucket]++;
        if (bucket === 'contact-form') {
          const j = journeyByLeadId.get(l.id);
          const cfTp = j?.touchpoints.find(t => t.anchor === 'lead_form_submitted');
          const domain = cfTp?.pageDomain?.replace(/^www\./, '') ?? '';
          if (domain.endsWith('sipgate.ai')) cfAi++;
          else cfDe++;
        }
      }

      values.set('contact-form', fmtNum(counts['contact-form'] / weeks));
      tooltips.set('contact-form', `${counts['contact-form']} Contact-Form-Leads in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
      values.set('cf-de', fmtNum(cfDe / weeks));
      tooltips.set('cf-de', `${cfDe} Contact-Form-Leads sipgate.de in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
      values.set('cf-ai', fmtNum(cfAi / weeks));
      tooltips.set('cf-ai', `${cfAi} Contact-Form-Leads sipgate.ai in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
      values.set('pbx-leads', fmtNum(counts['pbx-onboarding'] / weeks));
      tooltips.set('pbx-leads', `${counts['pbx-onboarding']} Onboarding-Quali-Leads in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
      values.set('signup-leads', fmtNum(counts['in-product'] / weeks));
      tooltips.set('signup-leads', `${counts['in-product']} In-Product-Quali-Leads in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
      values.set('sonstige-leads', fmtNum(counts['sonstige'] / weeks));
      tooltips.set('sonstige-leads', `${counts['sonstige']} Leads ohne Zuordnung in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
    }
  }

  // ── Playbook-Stats (Preview → 3+ Playbooks) ────────────────────────────────

  if (playbookStats && playbookStats.accountsWith3PlusPlaybooks != null) {
    const n3plus = playbookStats.accountsWith3PlusPlaybooks;
    const nTotal = playbookStats.previewAccountsTotal;
    values.set('pb', fmtNum(n3plus / weeks));
    tooltips.set('pb', nTotal != null
      ? `${n3plus} von ${nTotal} Preview-Accounts mit ≥ 3 Playbooks in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`
      : `${n3plus} Accounts mit ≥ 3 Playbooks in ${days} Tagen ÷ ${fmtNum(weeks)} Wochen`);
  }

  return { values, tooltips };
}

export function subtractBqTotals(
  doubled: MarketingFunnelResponse,
  current: MarketingFunnelResponse,
): MarketingFunnelResponse {
  const bq = doubled.bqTotals;
  const cur = current.bqTotals;
  return {
    ...doubled,
    bqTotals: {
      activationAgent: bq.activationAgent - cur.activationAgent,
      activationOther: bq.activationOther - cur.activationOther,
      activationTotal: bq.activationTotal - cur.activationTotal,
      previewTrialTotal: bq.previewTrialTotal - cur.previewTrialTotal,
      previewTrialAgent: bq.previewTrialAgent - cur.previewTrialAgent,
      previewTrialOther: bq.previewTrialOther - cur.previewTrialOther,
      previewTrialBestandskunde: bq.previewTrialBestandskunde - cur.previewTrialBestandskunde,
    },
  };
}

export function subtractPlaybookStats(
  doubled: PlaybookStats,
  current: PlaybookStats,
): PlaybookStats {
  return {
    accountsWith3PlusPlaybooks: doubled.accountsWith3PlusPlaybooks - current.accountsWith3PlusPlaybooks,
    previewAccountsTotal: doubled.previewAccountsTotal - current.previewAccountsTotal,
  };
}

export interface ResolvedTree {
  values: Map<string, string>;
  targets: Map<string, string>;
  tooltips: Map<string, string>;
  comparisonValues?: Map<string, string>;
  comparisonTooltips?: Map<string, string>;
}

export interface ResolveOptions {
  /** Live values for the current period. */
  liveData: LiveData;
  /** Active goal set — supplies the static targets. */
  goalSet: GoalSet;
  /** Live values for the previous comparison period (optional). */
  comparisonData?: LiveData | null;
  /** Manual overrides for non-dynamic, non-computed node values. */
  valueOverrides?: Map<string, string>;
  /** Manual overrides for targets. */
  targetOverrides?: Map<string, string>;
}

/**
 * Resolve the KPI tree: layer overrides on top of live values, compute the
 * `computed` nodes (MRR, …) and derive the cascading targets. Mirrors the
 * `resolved` memo in KpiTreeView exactly so the rendered tree and any
 * programmatic consumer (MCP) agree.
 */
export function resolveKpiTree({
  liveData,
  goalSet,
  comparisonData,
  valueOverrides,
  targetOverrides,
}: ResolveOptions): ResolvedTree {
  // Start with live values, then layer user overrides for manual nodes on top.
  const vals = new Map(liveData.values);
  const tips = new Map(liveData.tooltips);
  if (valueOverrides) {
    for (const [id, txt] of valueOverrides) {
      const node = METRICS.find(m => m.id === id);
      // Only apply overrides to non-dynamic, non-computed nodes
      if (node && !node.dynamic && !node.computed) vals.set(id, txt);
    }
  }
  const tgts = new Map<string, string>();
  for (const [id, val] of Object.entries(goalSet.targets)) tgts.set(id, val);
  if (targetOverrides) {
    for (const [id, val] of targetOverrides) tgts.set(id, val);
  }

  // Helper: read a resolved value as number
  const v = (id: string): number => {
    const txt = vals.get(id) ?? METRICS.find(m => m.id === id)?.fallback ?? '?';
    return parseNum(txt);
  };
  const t = (id: string): number => {
    const txt = tgts.get(id) ?? METRICS.find(m => m.id === id)?.target ?? '?';
    return parseNum(txt);
  };

  // ── Computed values ──────────────────────────────────────────────────────

  // Leads / Woche + contact-form are filled directly in computeLiveValues.
  const leadsVal = v('leads');

  // Conversion is computed in computeLiveValues (Won / (Won + Lost))
  const sales = v('sales');
  const dealsVal = v('deals');
  const conv = parseNum(vals.get('conversion') ?? '?') / 100;

  // MRR = sales × ARPA (Committed Customers feed into ICP via upsell, not directly into MRR calc)
  const arpa = v('arpa');
  vals.set('mrr', !isNaN(arpa) && !isNaN(sales) && sales > 0 ? fmtEur(sales * arpa) : '?');

  // ── Derived targets (marked with *) ──────────────────────────────────────

  const mrrTarget = t('mrr');
  const arpaTarget = t('arpa');
  const icpTarget = (!isNaN(mrrTarget) && !isNaN(arpaTarget) && arpaTarget > 0) ? mrrTarget / arpaTarget : NaN;
  if (!isNaN(icpTarget) && !tgts.has('icp')) tgts.set('icp', fmtTarget(icpTarget) + '*');

  // Sales = all ICP conversions
  const salesTarget = icpTarget;
  if (!isNaN(salesTarget) && !tgts.has('sales')) tgts.set('sales', fmtTarget(salesTarget) + '*');

  // Deals = Sales / Win Rate (all deals, regardless of source)
  const convTarget = t('conversion');
  const convRate = !isNaN(convTarget) ? convTarget / 100 : conv;
  const dealsFromSales = !isNaN(salesTarget) && !isNaN(convRate) && convRate > 0 ? salesTarget / convRate : NaN;
  if (!isNaN(dealsFromSales) && !tgts.has('deals')) tgts.set('deals', fmtTarget(dealsFromSales) + '*');

  // Deals split: 70% from Leads, 30% from Kontingent-Kunden
  const PLG_DEAL_RATIO = 0.3;
  const dealsTarget = t('deals');

  // Leads target — only needs to produce 70% of deals
  const slgDeals = !isNaN(dealsTarget) ? dealsTarget * (1 - PLG_DEAL_RATIO) : NaN;
  if (!isNaN(slgDeals) && !isNaN(dealsVal) && dealsVal > 0 && !isNaN(leadsVal) && leadsVal > 0 && !tgts.has('leads')) {
    tgts.set('leads', fmtTarget(slgDeals * (leadsVal / dealsVal)) + '*');
  }

  // Kontingent-Kunden target — needs to produce 30% of deals
  const plgDeals = !isNaN(dealsTarget) ? dealsTarget * PLG_DEAL_RATIO : NaN;
  if (!isNaN(plgDeals) && !tgts.has('activated') && !goalSet.mutedMetrics.includes('activated')) {
    tgts.set('activated', fmtTarget(plgDeals) + '*');
  }

  // PLG funnel targets — derived downward from Previews target
  // Previews (80) → ×80% → Aha (64) → ×80% → Skills/Int (51)
  // Kontingent-Kunden target is set independently (not derived).
  const STEP_CONV = 0.8;
  const muted = new Set(goalSet.mutedMetrics);
  const trialsTarget = t('trials');
  if (!isNaN(trialsTarget) && !muted.has('trials')) {
    const ahaTarget = trialsTarget * STEP_CONV;
    if (!tgts.has('aha') && !muted.has('aha')) tgts.set('aha', fmtTarget(ahaTarget) + '*');
    const skillTarget = ahaTarget * STEP_CONV;
    if (!tgts.has('int') && !muted.has('int')) tgts.set('int', fmtTarget(skillTarget) + '*');
    if (!tgts.has('pb') && !muted.has('pb')) tgts.set('pb', fmtTarget(skillTarget) + '*');
  }

  // Compute comparison resolved values (same derived formulas, no overrides/targets)
  let compVals: Map<string, string> | undefined;
  if (comparisonData) {
    const cv = new Map(comparisonData.values);
    const cvNum = (id: string): number => {
      const txt = cv.get(id) ?? METRICS.find(m => m.id === id)?.fallback ?? '?';
      return parseNum(txt);
    };
    // Leads, contact-form, and sub-buckets for comparison are filled by computeLiveValues.
    const cvArpa = cvNum('arpa');
    const cvSales = cvNum('sales');
    cv.set('mrr', !isNaN(cvArpa) && !isNaN(cvSales) && cvSales > 0 ? fmtEur(cvSales * cvArpa) : '?');
    compVals = cv;
  }

  return {
    values: vals,
    targets: tgts,
    tooltips: tips,
    comparisonValues: compVals,
    comparisonTooltips: comparisonData?.tooltips,
  };
}
