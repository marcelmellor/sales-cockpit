import { formatAmplitudeEvent } from '@/lib/amplitude/format';
import type { Touchpoint, TouchpointAnchor } from '@/lib/amplitude/journeys';

// Einstiegs-Label einer Journey bestimmen — wie ist die Person in den Funnel
// gekommen? Priorität: Signup (Agent > PBX) > Bestandskunde > Contact Form.
// Gibt null zurück wenn kein Einstiegssignal erkannt wurde.
export function getActivationLabel(
  touchpoints: readonly Touchpoint[],
  customerSince?: string | null,
): string | null {
  let hasAgent = false;
  let hasPbx = false;
  let hasContactForm = false;
  for (const t of touchpoints) {
    if (t.anchor === 'signup_atlantis_frontdesk') hasAgent = true;
    else if (t.anchor === 'signup_atlantis_other_product') hasPbx = true;
    else if (t.anchor === 'lead_form_submitted') hasContactForm = true;
  }
  if (hasAgent) return 'Agent Signup';
  if (hasPbx) return 'PBX Signup';
  if (customerSince) return 'Bestandskunde';
  if (hasContactForm) return 'Contact Form';
  return null;
}

// HubSpot-Lifecycle-Pseudoevents zählen nicht als Marketing-Touchpoint —
// die werden nur dem Journey-Verlauf als Zeitanker beigemischt. Beim Suchen
// nach dem "ersten Marketing-Touchpoint" überspringen.
const LIFECYCLE_ANCHORS: ReadonlySet<TouchpointAnchor> = new Set([
  'hubspot_lead_created',
  'hubspot_deal_created',
]);

// Chronologisch ersten Marketing-Touchpoint einer Journey finden. Touchpoints
// kommen aus der /api/marketing/funnel-Route schon nach `occurredAt` sortiert
// — wir nehmen also den ersten Eintrag, der kein Lifecycle-Pseudo-Event ist.
export function findFirstMarketingTouchpoint(
  touchpoints: readonly Touchpoint[],
): Touchpoint | null {
  for (const t of touchpoints) {
    if (!LIFECYCLE_ANCHORS.has(t.anchor)) return t;
  }
  return null;
}

// Anzeige-Label für einen Touchpoint — identisch zu dem Chip-Label im
// Marketing-Tab (Deal-Journey-Tabelle). Wird sowohl dort als auch von der
// Dashboard-Chart-Gruppierung benutzt, damit ein "Agent Signup"-Chip im
// Marketing-Tab und ein "Agent Signup"-Bucket im Prospects-Chart konsistent
// bleiben.
export function formatTouchpointLabel(touchpoint: Touchpoint): string {
  switch (touchpoint.anchor) {
    case 'marketing_acquisition': {
      // leadSourceDetails ist "channel · source/medium · campaign" — wir
      // zeigen nur den Channel-Teil im Chip-Text, der Rest landet im Tooltip.
      const channel = touchpoint.leadSourceDetails?.split(' · ')[0] || 'Marketing-Akquise';
      return channel.replace(/_/g, ' ');
    }
    case 'marketing_page_sipgate_ai':
      return 'sipgate.ai besucht';
    case 'marketing_page_sipgate_de':
      return 'sipgate.de besucht';
    case 'signup_atlantis_frontdesk':
      return 'Agent Signup';
    case 'signup_atlantis_other_product':
      return 'PBX Signup';
    case 'lead_form_submitted': {
      const shortDomain = touchpoint.pageDomain
        ? touchpoint.pageDomain.replace(/^www\./, '')
        : null;
      return shortDomain ? `Contact Form (${shortDomain})` : 'Contact Form';
    }
    case 'agents_qualification_onboarding':
      return 'Onboarding-Quali';
    case 'agents_qualification_inproduct':
      return 'In-Product-Quali';
    case 'preview_trial_started':
      return 'Preview gestartet';
    default:
      return formatAmplitudeEvent(touchpoint.eventType);
  }
}
