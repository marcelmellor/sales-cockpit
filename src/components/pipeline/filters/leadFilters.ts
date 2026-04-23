// Lead-spezifische Feld-Konfiguration + Match-Logik. Bietet dieselbe UX wie
// der Deals-Filter, aber auf den Feldern, die ein Lead tatsächlich trägt
// (keine MRR, kein Stage-Reached-mit-Historie — stattdessen Source/Produkt/
// Minuten/Alter/In-Stage).

import type { LeadOverviewItem } from '@/app/api/leads/overview/route';
import type { FieldConfig, FieldInputKind, FilterCriterion, FilterNode } from './types';
import {
  applyFilters as applyFiltersGeneric,
  criterionIsComplete,
  matchTimestamp,
} from './engine';

export type LeadFieldType =
  | 'createdate'
  | 'stage_entered'
  | 'current_stage'
  | 'agents_minuten'
  | 'inbound_volumen'
  | 'lead_age'
  | 'days_in_stage'
  | 'has_deal'
  | 'source'
  | 'lead_source'
  | 'product'
  | 'status'
  | 'analytics_source'
  | 'analytics_first_url'
  | 'utm_source'
  | 'utm_medium'
  | 'utm_campaign'
  | 'utm_term'
  | 'utm_content';

export const LEAD_DEFAULT_FIELD: LeadFieldType = 'createdate';

export const LEAD_DATE_FIELD_TYPES: LeadFieldType[] = ['createdate', 'stage_entered'];

export function getLeadInputKind(type: LeadFieldType): FieldInputKind {
  switch (type) {
    case 'createdate':
    case 'stage_entered':
      return 'date';
    case 'current_stage':
    case 'source':
    case 'lead_source':
    case 'product':
    case 'status':
    case 'analytics_source':
    case 'analytics_first_url':
    case 'utm_source':
    case 'utm_medium':
    case 'utm_campaign':
    case 'utm_term':
    case 'utm_content':
      return 'enum';
    case 'agents_minuten':
    case 'inbound_volumen':
    case 'lead_age':
    case 'days_in_stage':
      return 'number';
    case 'has_deal':
      return 'boolean';
  }
}

// Untergrenze eines `inbound_volumen`-Ranges, z.B. "1000-2000" → 1000.
function inboundVolumenLowerBound(range: string | null): number | null {
  if (!range) return null;
  const m = range.match(/^(\d+)/) || range.match(/^>(\d+)/);
  return m ? Number(m[1]) : null;
}

// HubSpot liefert Original Source als Enum in SCREAMING_SNAKE_CASE
// ("DIRECT_TRAFFIC", …). Für das Filter-Dropdown in Title-Case umformen, damit
// das Label dem HubSpot-Sidebar entspricht. Gleiche Logik wie in der
// Spreadsheet-View, hier nochmal lokal (kein shared Helper wegen
// unterschiedlicher Module-Grenzen zwischen view und filter).
function formatAnalyticsSourceLabel(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map(w => (w.length === 0 ? '' : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

/** Aggregiert aus der aktuellen Lead-Liste die Werte für die dynamischen
 *  Enum-Felder (Source, Lead-Source, Produkt). So bleibt die Filter-Dropdown-
 *  Liste immer passend zur tatsächlich geladenen Datenmenge. */
export function buildLeadFieldConfigs(
  stages: Array<{ id: string; label: string }>,
  leads: LeadOverviewItem[],
): FieldConfig<LeadFieldType>[] {
  const sources = new Set<string>();
  const leadSources = new Set<string>();
  const products = new Set<string>();
  const analyticsSources = new Set<string>();
  const analyticsFirstUrls = new Set<string>();
  const utmSources = new Set<string>();
  const utmMediums = new Set<string>();
  const utmCampaigns = new Set<string>();
  const utmTerms = new Set<string>();
  const utmContents = new Set<string>();
  for (const l of leads) {
    if (l.source) sources.add(l.source);
    if (l.leadSource) leadSources.add(l.leadSource);
    for (const p of l.product) products.add(p);
    if (l.analyticsSource) analyticsSources.add(l.analyticsSource);
    if (l.analyticsFirstUrl) analyticsFirstUrls.add(l.analyticsFirstUrl);
    if (l.utmSource) utmSources.add(l.utmSource);
    if (l.utmMedium) utmMediums.add(l.utmMedium);
    if (l.utmCampaign) utmCampaigns.add(l.utmCampaign);
    if (l.utmTerm) utmTerms.add(l.utmTerm);
    if (l.utmContent) utmContents.add(l.utmContent);
  }

  const toOptions = (values: Iterable<string>) =>
    Array.from(values)
      .sort((a, b) => a.localeCompare(b, 'de'))
      .map(v => ({ value: v, label: v }));

  return [
    { type: 'createdate', label: 'Erstelldatum', inputKind: 'date' },
    { type: 'stage_entered', label: 'Stage betreten am', inputKind: 'date' },
    {
      type: 'current_stage',
      label: 'Stage',
      inputKind: 'enum',
      enumOptions: stages.map(s => ({ value: s.id, label: s.label })),
    },
    {
      type: 'agents_minuten',
      label: 'Agent-Minuten',
      inputKind: 'number',
      numberPlaceholderFrom: 'Min',
      numberPlaceholderTo: 'Max',
      numberUnit: 'Min.',
    },
    {
      type: 'inbound_volumen',
      label: 'Inbound-Volumen (Untergrenze)',
      inputKind: 'number',
      numberPlaceholderFrom: 'Min',
      numberPlaceholderTo: 'Max',
      numberUnit: 'Min./Mo',
    },
    {
      type: 'lead_age',
      label: 'Lead-Alter',
      inputKind: 'number',
      numberPlaceholderFrom: 'Min',
      numberPlaceholderTo: 'Max',
      numberUnit: 'Tage',
    },
    {
      type: 'days_in_stage',
      label: 'In Stage',
      inputKind: 'number',
      numberPlaceholderFrom: 'Min',
      numberPlaceholderTo: 'Max',
      numberUnit: 'Tage',
    },
    {
      type: 'has_deal',
      label: 'Bestehender Deal',
      inputKind: 'boolean',
      booleanTrueLabel: 'Mit Deal',
      booleanFalseLabel: 'Ohne Deal',
    },
    {
      type: 'source',
      label: 'Source',
      inputKind: 'enum',
      enumOptions: toOptions(sources),
    },
    {
      type: 'lead_source',
      label: 'Lead-Source',
      inputKind: 'enum',
      enumOptions: toOptions(leadSources),
    },
    {
      type: 'product',
      label: 'Produkt',
      inputKind: 'enum',
      enumOptions: toOptions(products),
    },
    {
      type: 'analytics_source',
      label: 'Original Source',
      inputKind: 'enum',
      // Value bleibt der Rohwert (DIRECT_TRAFFIC), Label ist formatiert —
      // der Match unten vergleicht über den Rohwert.
      enumOptions: Array.from(analyticsSources)
        .sort((a, b) => a.localeCompare(b, 'de'))
        .map(v => ({ value: v, label: formatAnalyticsSourceLabel(v) })),
    },
    {
      type: 'analytics_first_url',
      label: 'Erste URL',
      inputKind: 'enum',
      enumOptions: toOptions(analyticsFirstUrls),
    },
    {
      type: 'utm_source',
      label: 'UTM Source',
      inputKind: 'enum',
      enumOptions: toOptions(utmSources),
    },
    {
      type: 'utm_medium',
      label: 'UTM Medium',
      inputKind: 'enum',
      enumOptions: toOptions(utmMediums),
    },
    {
      type: 'utm_campaign',
      label: 'UTM Campaign',
      inputKind: 'enum',
      enumOptions: toOptions(utmCampaigns),
    },
    {
      type: 'utm_term',
      label: 'UTM Term',
      inputKind: 'enum',
      enumOptions: toOptions(utmTerms),
    },
    {
      type: 'utm_content',
      label: 'UTM Content',
      inputKind: 'enum',
      enumOptions: toOptions(utmContents),
    },
    {
      type: 'status',
      label: 'Status',
      inputKind: 'enum',
      enumOptions: [
        { value: 'open', label: 'Offen' },
        { value: 'closed', label: 'Abgeschlossen' },
      ],
    },
  ];
}

function matchNumeric(
  value: number | null | undefined,
  c: FilterCriterion<LeadFieldType>,
): boolean {
  if (value == null) return false;
  if (c.operator === 'after') return value >= (c.numberFrom ?? 0);
  if (c.operator === 'before') return value <= (c.numberFrom ?? Infinity);
  return value >= (c.numberFrom ?? 0) && value <= (c.numberTo ?? Infinity);
}

function matchLeadCriterion(
  lead: LeadOverviewItem,
  c: FilterCriterion<LeadFieldType>,
): boolean {
  if (!criterionIsComplete(c, getLeadInputKind(c.type))) return true;

  switch (c.type) {
    case 'createdate': {
      const ts = lead.createdate ? new Date(lead.createdate).getTime() : null;
      if (ts == null || isNaN(ts)) return false;
      return matchTimestamp(ts, c);
    }
    case 'stage_entered': {
      const ts = lead.stageEnteredAt ? new Date(lead.stageEnteredAt).getTime() : null;
      if (ts == null || isNaN(ts)) return false;
      return matchTimestamp(ts, c);
    }
    case 'current_stage':
      return lead.leadStageId === c.stringValue;
    case 'source':
      return (lead.source ?? '') === c.stringValue;
    case 'lead_source':
      return (lead.leadSource ?? '') === c.stringValue;
    case 'product':
      return lead.product.includes(c.stringValue ?? '');
    case 'agents_minuten':
      return matchNumeric(lead.agentsMinuten, c);
    case 'inbound_volumen':
      return matchNumeric(inboundVolumenLowerBound(lead.inboundVolumen), c);
    case 'lead_age':
      return matchNumeric(lead.leadAge, c);
    case 'days_in_stage':
      return matchNumeric(lead.daysInStage >= 0 ? lead.daysInStage : null, c);
    case 'has_deal':
      return c.booleanValue === true ? !!lead.existingDealId : !lead.existingDealId;
    case 'status':
      return c.stringValue === 'closed' ? lead.leadStageIsClosed : !lead.leadStageIsClosed;
    case 'analytics_source':
      return (lead.analyticsSource ?? '') === c.stringValue;
    case 'analytics_first_url':
      return (lead.analyticsFirstUrl ?? '') === c.stringValue;
    case 'utm_source':
      return (lead.utmSource ?? '') === c.stringValue;
    case 'utm_medium':
      return (lead.utmMedium ?? '') === c.stringValue;
    case 'utm_campaign':
      return (lead.utmCampaign ?? '') === c.stringValue;
    case 'utm_term':
      return (lead.utmTerm ?? '') === c.stringValue;
    case 'utm_content':
      return (lead.utmContent ?? '') === c.stringValue;
  }
}

export function applyLeadFilters(
  leads: LeadOverviewItem[],
  filter: { logic: 'AND' | 'OR'; children: FilterNode<LeadFieldType>[] },
): LeadOverviewItem[] {
  return applyFiltersGeneric<LeadFieldType, LeadOverviewItem>(
    leads,
    filter,
    matchLeadCriterion,
    getLeadInputKind,
  );
}
