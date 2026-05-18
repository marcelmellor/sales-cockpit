import { getBigQuery } from './client';

// Phase 1: AI Agents only. The HubSpot tag for AI Agents is `frontdesk` — that's
// what `?produkt=frontdesk` selects across leads/deals overview routes. Inside
// Amplitude the same product appears as `event_properties.product = 'FRONTDESK'`
// on Signup-Atlantis events, as a lead_source_details substring "frontdesk" on
// Lead-Completed events, or as the page domain `www.sipgate.ai` on the
// AI-Agents marketing site events. We anchor on those three signals to be sure
// we don't attribute, say, a Team-Telefonanlage signup to an AI-Agents deal
// just because the same person has both pipelines.

export interface AmplitudeAttribution {
  email: string;
  eventType: string;
  occurredAt: string; // ISO timestamp
  anchor: 'signup_atlantis_frontdesk' | 'lead_completed_frontdesk' | 'sipgate_ai_domain';
}

const EVENTS_TABLE = 'ff-amplitude.ampli_live_events.EVENTS_100008946';

// First-touch attribution: earliest event in the user's journey that matches
// one of the AI-Agents anchors. Priority is only a tiebreaker for events at the
// exact same timestamp (rare-to-never).
const QUERY = `
WITH events AS (
  SELECT
    LOWER(user_id) AS email,
    event_type,
    event_time,
    JSON_VALUE(event_properties, '$.product') AS ev_product,
    JSON_VALUE(event_properties, '$.lead_source_details') AS lead_source_details,
    TO_JSON_STRING(event_properties) AS props_string
  FROM \`${EVENTS_TABLE}\`
  WHERE event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY)
    AND user_id IS NOT NULL
    AND LOWER(user_id) IN UNNEST(@emails)
    AND event_type IN (
      'Click Demo buchen', 'Click Kostenlos testen', 'plan_select', 'pricing_view',
      'Form Submitted: Contact Form', 'Form Submitted: Signup Form', 'Form Submitted: Signup Modal',
      'Signup Atlantis', 'Lead Completed', 'lead_form_all', 'su5_registration', 'su4_form_submit'
    )
),
anchored AS (
  SELECT
    email,
    event_type,
    event_time,
    CASE
      WHEN event_type = 'Signup Atlantis' AND ev_product = 'FRONTDESK'
        THEN 'signup_atlantis_frontdesk'
      WHEN event_type = 'Lead Completed' AND (
        LOWER(IFNULL(lead_source_details, '')) LIKE '%frontdesk%'
        OR lead_source_details = 'Agent Qualifizierungsfragen im Produkt'
      ) THEN 'lead_completed_frontdesk'
      WHEN props_string LIKE '%sipgate.ai%'
        THEN 'sipgate_ai_domain'
      ELSE NULL
    END AS anchor,
    CASE event_type
      WHEN 'plan_select' THEN 1
      WHEN 'pricing_view' THEN 2
      WHEN 'Click Demo buchen' THEN 3
      WHEN 'Click Kostenlos testen' THEN 4
      WHEN 'Form Submitted: Contact Form' THEN 5
      WHEN 'Signup Atlantis' THEN 6
      WHEN 'su5_registration' THEN 7
      WHEN 'Lead Completed' THEN 8
      WHEN 'Form Submitted: Signup Form' THEN 9
      WHEN 'Form Submitted: Signup Modal' THEN 10
      WHEN 'su4_form_submit' THEN 11
      WHEN 'lead_form_all' THEN 12
      ELSE 99
    END AS tiebreak
  FROM events
)
SELECT email, event_type, event_time, anchor
FROM anchored
WHERE anchor IS NOT NULL
QUALIFY ROW_NUMBER() OVER (PARTITION BY email ORDER BY event_time ASC, tiebreak ASC) = 1
`;

interface RawRow {
  email: string;
  event_type: string;
  event_time: { value: string } | string;
  anchor: AmplitudeAttribution['anchor'];
}

/**
 * Look up the AI-Agents attribution event (first touch) for each email.
 * Returns a Map keyed by lowercased email — emails with no matching event are
 * simply absent from the map.
 *
 * Empty input → empty Map (skips the BQ call). The caller is expected to
 * deduplicate and lowercase the email list before passing it in, but we
 * normalize defensively here too.
 */
export async function getAiAgentsAttributionByEmail(
  emails: readonly string[],
): Promise<Map<string, AmplitudeAttribution>> {
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
    params: { emails: normalized },
    types: { emails: ['STRING'] },
  });

  const result = new Map<string, AmplitudeAttribution>();
  for (const row of rows as RawRow[]) {
    const occurredAt =
      typeof row.event_time === 'string' ? row.event_time : row.event_time.value;
    result.set(row.email, {
      email: row.email,
      eventType: row.event_type,
      occurredAt,
      anchor: row.anchor,
    });
  }
  return result;
}
