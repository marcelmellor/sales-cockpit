import type { LeadOverviewItem } from '@/app/api/leads/overview/route';
import type { MarketingFunnelJourney } from '@/lib/marketing/funnel-types';

export type LeadSourceBucket = 'contact-form' | 'pbx-onboarding' | 'in-product' | 'sonstige';

export const LEAD_SOURCE_LABELS: Record<LeadSourceBucket, string> = {
  'contact-form': 'Contact Form',
  'pbx-onboarding': 'PBX-Onboarding',
  'in-product': 'In-Product-Quali',
  'sonstige': 'Sonstige',
};

export const LEAD_SOURCE_COLORS: Record<LeadSourceBucket, string> = {
  'pbx-onboarding': '#2F0D5B',
  'contact-form': '#2E9E8E',
  'in-product': '#E8AC68',
  'sonstige': '#B8BCC2',
};

export const LEAD_SOURCE_ORDER: LeadSourceBucket[] = [
  'sonstige',
  'in-product',
  'contact-form',
  'pbx-onboarding',
];

function classifyByJourney(j: MarketingFunnelJourney): LeadSourceBucket {
  if (j.touchpoints.some(t => t.anchor === 'lead_form_submitted')) return 'contact-form';
  if (j.touchpoints.some(t => t.anchor === 'agents_qualification_onboarding')) return 'pbx-onboarding';
  if (j.touchpoints.some(t => t.anchor === 'agents_qualification_inproduct')) return 'in-product';
  return 'sonstige';
}

function classifyByHubspotSource(l: LeadOverviewItem): LeadSourceBucket {
  const src = (l.leadSource ?? l.source ?? '').trim().toLowerCase();
  if (src.includes('rueckruf') || src.includes('rückruf') || src.includes('contact form')) return 'contact-form';
  if (src === 'team_neopbx' || src === 'classic_pbx') return 'pbx-onboarding';
  if (src.includes('qualifizierung')) return 'in-product';
  return 'sonstige';
}

export function classifyLead(
  lead: LeadOverviewItem,
  journeyByLeadId: Map<string, MarketingFunnelJourney>,
): LeadSourceBucket {
  const j = journeyByLeadId.get(lead.id);
  return j ? classifyByJourney(j) : classifyByHubspotSource(lead);
}

export function leadMinutes(l: LeadOverviewItem): number | null {
  if (l.agentsMinuten != null) return l.agentsMinuten;
  if (l.inboundVolumen) {
    const m = l.inboundVolumen.match(/^(\d+)/) || l.inboundVolumen.match(/^>(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

export function buildJourneyMap(
  journeys: MarketingFunnelJourney[],
): Map<string, MarketingFunnelJourney> {
  const map = new Map<string, MarketingFunnelJourney>();
  for (const j of journeys) {
    if (j.kind === 'lead') map.set(j.entityId, j);
  }
  return map;
}
