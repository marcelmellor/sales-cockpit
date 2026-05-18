import { getBigQuery } from './client';

// Phase 2: full marketing-touchpoint journey for AI Agents (= frontdesk).
// Unlike `getAiAgentsAttributionByEmail` which returns only the earliest
// matching event per user, this returns ALL whitelisted touchpoints in
// chronological order. The Marketing-Tab uses these to render per-deal
// journey timelines and aggregate funnel counts.
//
// The AI-Agents anchor filter is identical to the one in attribution.ts —
// only events that can be safely tied to AI Agents are returned. Other
// products' signups (TEAM_NEOPBX, TRUNKING, …) are excluded.

export type TouchpointAnchor =
  | 'signup_atlantis_frontdesk'        // Self-service Trial-Signup mit Produkt-Wahl AI Agents
  | 'signup_atlantis_other_product'    // Signup Atlantis mit anderem Produkt (TEAM_NEOPBX, TRUNKING …) — Cross-Sell-Kontext, kein AI-Agents-Marketing-Touchpoint
  | 'lead_completed_frontdesk'         // Lead-Form submission mit Frontdesk-Source
  | 'sipgate_ai_domain'                // Marketing-Site sipgate.ai (Demo-/Trial-Klick, Form-Submit)
  | 'agents_qualification_onboarding'  // Quali-Submit innerhalb 60min nach Erstanmeldung (Self-Service-Pfad)
  | 'agents_qualification_inproduct'   // Quali-Submit von Bestandskunde aus dem sipgate-App-Portal (Cross-/Upsell)
  | 'hubspot_lead_created'             // HubSpot Lifecycle: assoziierter Lead wurde in HubSpot angelegt
  | 'hubspot_deal_created';            // HubSpot Lifecycle: dieser Deal wurde in HubSpot angelegt

export interface Touchpoint {
  eventType: string;
  occurredAt: string; // ISO timestamp
  anchor: TouchpointAnchor;
  leadSourceDetails: string | null;
  inboundValue: string | null;   // nur bei agents_qualification_* gesetzt (z.B. "0-1000")
  signupProduct: string | null;  // nur bei signup_atlantis_* gesetzt (z.B. "FRONTDESK", "TEAM_NEOPBX")
}

const EVENTS_TABLE = 'ff-amplitude.ampli_live_events.EVENTS_100008946';

// Whitelist + Phase-2 additions (pricing_view, feature_view). Lead Completed is
// kept in here even though it overlaps with the HubSpot Lead Created event —
// it carries `lead_source_details` which is useful for the journey timeline.
const TOUCHPOINT_EVENT_TYPES = [
  'Click Demo buchen',
  'Click Kostenlos testen',
  'plan_select',
  'pricing_view',
  'feature_view',
  'Form Submitted: Contact Form',
  'Form Submitted: Signup Form',
  'Form Submitted: Signup Modal',
  'Signup Atlantis',
  'Lead Completed',
  'lead_form_all',
  'su5_registration',
  'su4_form_submit',
];

const QUERY = `
SELECT * FROM (
  SELECT
    LOWER(user_id) AS email,
    event_type,
    event_time,
    CASE
      WHEN event_type = 'Signup Atlantis' AND JSON_VALUE(event_properties, '$.product') = 'FRONTDESK'
        THEN 'signup_atlantis_frontdesk'
      WHEN event_type = 'Signup Atlantis' AND JSON_VALUE(event_properties, '$.product') IS NOT NULL
        AND JSON_VALUE(event_properties, '$.product') != 'FRONTDESK'
        THEN 'signup_atlantis_other_product'
      WHEN event_type = 'Lead Completed' AND (
        LOWER(IFNULL(JSON_VALUE(event_properties, '$.lead_source_details'), '')) LIKE '%frontdesk%'
        OR JSON_VALUE(event_properties, '$.lead_source_details') = 'Agent Qualifizierungsfragen im Produkt'
      ) THEN 'lead_completed_frontdesk'
      WHEN TO_JSON_STRING(event_properties) LIKE '%sipgate.ai%'
        THEN 'sipgate_ai_domain'
      ELSE NULL
    END AS anchor,
    JSON_VALUE(event_properties, '$.lead_source_details') AS lead_source_details,
    JSON_VALUE(event_properties, '$.product') AS signup_product
  FROM \`${EVENTS_TABLE}\`
  WHERE event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY)
    AND user_id IS NOT NULL
    AND LOWER(user_id) IN UNNEST(@emails)
    AND event_type IN UNNEST(@event_types)
)
WHERE anchor IS NOT NULL
ORDER BY email, event_time
`;

interface RawRow {
  email: string;
  event_type: string;
  event_time: { value: string } | string;
  anchor: TouchpointAnchor;
  lead_source_details: string | null;
  signup_product: string | null;
}

/**
 * Returns ALL AI-Agents marketing touchpoints per email, chronologically
 * ordered (oldest first). Emails with no touchpoints are absent from the map.
 */
export async function getTouchpointsByEmail(
  emails: readonly string[],
): Promise<Map<string, Touchpoint[]>> {
  const normalized = Array.from(
    new Set(
      emails
        .map(e => e.trim().toLowerCase())
        .filter(e => e.length > 0 && e.includes('@')),
    ),
  );
  if (normalized.length === 0) {
    return new Map();
  }

  const bq = getBigQuery();
  const [rows] = await bq.query({
    query: QUERY,
    params: { emails: normalized, event_types: TOUCHPOINT_EVENT_TYPES },
    types: { emails: ['STRING'], event_types: ['STRING'] },
  });

  const result = new Map<string, Touchpoint[]>();
  for (const row of rows as RawRow[]) {
    const occurredAt =
      typeof row.event_time === 'string' ? row.event_time : row.event_time.value;
    const list = result.get(row.email) ?? [];
    list.push({
      eventType: row.event_type,
      occurredAt,
      anchor: row.anchor,
      leadSourceDetails: row.lead_source_details,
      inboundValue: null,
      signupProduct: row.signup_product,
    });
    result.set(row.email, list);
  }
  return result;
}
