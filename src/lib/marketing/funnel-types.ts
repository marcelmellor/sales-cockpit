// Shape und Konstanten der /api/marketing/funnel-Response. Liegen hier, nicht
// in der Route-Datei selbst, weil Next.js 16 außer den HTTP-Methods keine
// Exports in route.ts erlaubt (auch keine type-only).

import type { Touchpoint } from '@/lib/amplitude/journeys';

export interface MarketingFunnelStage {
  // Funnel-Stages für die Marketing-View. Fünf Stages:
  //   1. Marketing-Touch — unique Geräte mit UTM/Click-ID (BQ-seitig)
  //   2. Activation — Agent-Signup ∨ PBX-Signup ∨ Bestandskunde
  //   3. Preview (Trial) — AI-Agents-Preview aktiviert (Contract Finalized
  //      in Amplitude exports_raw)
  //   4. Deal angelegt — HubSpot AI-Agents-Deal mit marketing_acquisition
  //   5. Deal gewonnen — gewonnene Teilmenge
  key: 'marketingTouch' | 'activation' | 'previewTrial' | 'dealCreated' | 'dealWon';
  label: string;
  count: number;
  /** Optional: Aufschlüsselung des Balkens in Sub-Buckets (z.B. Marketing-Touch
   *  nach Landing-Domain sipgate.de/sipgate.ai/andere). Summe der subgroups-
   *  counts ≤ count (Rest = "andere" wird vom Renderer dazugerechnet). */
  subgroups?: Array<{ key: string; label: string; count: number; color?: string }>;
}

export type MarketingJourneyKind = 'deal' | 'lead';

// Bucket-Schwelle für die Minuten-Klassifizierung im Marketing-Sankey-Filter.
// Entspricht dem AI-Agents-Paket-Cutoff ("Enterprise ab 2.500 Min").
export const MINUTE_BUCKET_THRESHOLD = 2500;
export type MinuteBucket = 'lt_threshold' | 'gte_threshold' | 'unknown';

// MRR-Schwelle für die Deal-Klassifizierung. Entspricht dem System-Badge
// "MRR ≥ 450 €" im Dashboard (siehe DashboardView). 450 €/Mo ist der
// untere Cutoff für das mittlere AI-Agents-Paket.
export const MRR_BUCKET_THRESHOLD = 450;
export type MrrBucket = 'lt_threshold' | 'gte_threshold' | 'unknown';

export function isIcpRevenue(revenue: number): boolean {
  return Math.round(revenue) >= MRR_BUCKET_THRESHOLD;
}

export interface MarketingFunnelJourney {
  kind: MarketingJourneyKind;
  entityId: string;                 // dealId (kind='deal') or leadId (kind='lead')
  companyName: string;
  stageLabel: string;
  stageIsWon: boolean;              // only meaningful for deals
  stageIsLost: boolean;             // only meaningful for deals
  hasLead: boolean;                 // a HubSpot AI-Agents-Lead exists für diesen Entry
  hasDeal: boolean;                 // ein HubSpot AI-Agents-Deal existiert für diesen Entry
  touchpoints: Touchpoint[];        // Amplitude + HubSpot-Lifecycle, chronologisch
  customerSince: string | null;     // sipgate-Account-Anlage-Datum (frühester Contact)
  // Geschätzte Anzahl Inbound-Minuten pro Monat. Priorität:
  //   1. HubSpot exakter Wert (Deal: agents_minuten_qualifiziert || agents_minuten,
  //      Lead: agents_minuten)
  //   2. HubSpot Range inbound_volumen (Midpoint)
  //   3. Amplitude `inbound_value` aus dem jüngsten Quali-Event (Midpoint)
  agentsMinutes: number | null;
  minuteBucket: MinuteBucket;
  // Deal-MRR (nur für kind='deal' gesetzt). Berechnet via computeDealRevenue
  // aus den HubSpot-Properties (line items > agents-package > TCV-Fallback).
  // null für Lead-only-Entries.
  mrr: number | null;
  mrrBucket: MrrBucket;
  // HubSpot-Erstelldatum dieser Entity — für Deals `deal.createdate`, für Leads
  // `lead.hs_createdate`. Treibt den Date-Filter im Marketing-Tab.
  createdate: string | null;
}

// BQ-basierte Gesamtzahlen für Funnel-Stages, unabhängig von HubSpot.
// Werden im Client als Bar-Gesamtbreite benutzt — die Journey-basierten
// Subgroups sind die farbigen Segmente, der Rest wird als „Andere" gerendert.
export interface FunnelBqTotals {
  activationAgent: number;        // Signup Atlantis FRONTDESK
  activationOther: number;        // Signup Atlantis anderes Produkt
  activationTotal: number;        // alle Signup Atlantis
  previewTrialTotal: number;      // Contract Finalized (Preview)
  previewTrialAgent: number;      // Preview + FRONTDESK Signup (BQ cross-join)
  previewTrialOther: number;      // Preview + anderes Signup-Produkt (BQ cross-join)
  previewTrialBestandskunde: number; // Preview + Email gefunden, kein Signup
}

export interface MarketingFunnelResponse {
  funnel: MarketingFunnelStage[];
  bqTotals: FunnelBqTotals;
  dealsTotal: number;       // total AI-Agents deals in scope
  dealsWonTotal: number;    // won AI-Agents deals (regardless of Amplitude)
  journeys: MarketingFunnelJourney[];
}
