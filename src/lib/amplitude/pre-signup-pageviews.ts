import { getBigQuery } from './client';
import type { Touchpoint } from './journeys';

// Anonyme Pre-Signup-Page-Views auf den Marketing-Sites (sipgate.ai /
// sipgate.de) finden und an die User attribuieren, die sich später bei uns
// einloggen. Das geht über einen zweistufigen Join:
//
//   1. Pro Email alle `device_id`s sammeln, die jemals zusammen mit dem
//      `user_id = email` gesehen wurden.
//   2. Für jede dieser device_ids die anonymen Events (kein user_id gesetzt)
//      finden, die VOR dem frühesten identifizierten Event lagen.
//
// Caveat: device_id ist nicht zwischen Geräten/Browsern stabil und kann
// durch Cookie-Löschen verlorengehen. Wir sehen also nicht 100% der
// Pre-Signup-Touches, eher 20–40% — trotzdem deutlich besser als nichts.

const EVENTS_TABLE = 'ff-amplitude.ampli_live_events.EVENTS_100008946';

// Welche Page-Domain mappt auf welchen Touchpoint-Anchor. Nur Top-Level-
// Marketing-Domains — Funnel-/App-Subdomains (signup.*, custom-plans.*,
// app.*, etc.) sind keine "Erstkontakt"-Marketing-Touches.
const DOMAIN_TO_ANCHOR: Record<string, 'marketing_page_sipgate_ai' | 'marketing_page_sipgate_de'> = {
  'sipgate.ai': 'marketing_page_sipgate_ai',
  'www.sipgate.ai': 'marketing_page_sipgate_ai',
  'sipgate.de': 'marketing_page_sipgate_de',
  'www.sipgate.de': 'marketing_page_sipgate_de',
};

const TRACKED_DOMAINS = Object.keys(DOMAIN_TO_ANCHOR);

const QUERY = `
WITH target_emails AS (
  SELECT email FROM UNNEST(@emails) AS email
),
device_to_email AS (
  SELECT DISTINCT
    LOWER(e.user_id) AS email,
    e.device_id
  FROM \`${EVENTS_TABLE}\` e
  JOIN target_emails t ON LOWER(e.user_id) = t.email
  WHERE e.device_id IS NOT NULL
    AND e.event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY)
),
earliest_identified AS (
  SELECT
    LOWER(e.user_id) AS email,
    MIN(e.event_time) AS earliest_identified_time
  FROM \`${EVENTS_TABLE}\` e
  JOIN target_emails t ON LOWER(e.user_id) = t.email
  WHERE e.event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY)
  GROUP BY 1
),
anon_views AS (
  SELECT
    d2e.email,
    e.event_time,
    REGEXP_EXTRACT(TO_JSON_STRING(e.event_properties), r'Page Domain":"([^"]+)"') AS page_domain
  FROM device_to_email d2e
  JOIN earliest_identified ei ON d2e.email = ei.email
  JOIN \`${EVENTS_TABLE}\` e
    ON e.device_id = d2e.device_id
   AND e.event_time < ei.earliest_identified_time
   AND e.event_time >= TIMESTAMP_SUB(ei.earliest_identified_time, INTERVAL 90 DAY)
  WHERE e.event_type = '[Amplitude] Page Viewed'
)
SELECT
  email,
  page_domain,
  MIN(event_time) AS first_view_time
FROM anon_views
WHERE page_domain IN UNNEST(@domains)
GROUP BY email, page_domain
ORDER BY email, first_view_time
`;

interface RawRow {
  email: string;
  page_domain: string;
  first_view_time: { value: string } | string;
}

/**
 * Returns anonymous pre-signup Marketing-Site touchpoints per email. Each
 * (email, domain) is collapsed to its earliest page view.
 */
export async function getPreSignupPageViewsByEmail(
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
    params: { emails: normalized, domains: TRACKED_DOMAINS },
    types: { emails: ['STRING'], domains: ['STRING'] },
  });

  const result = new Map<string, Touchpoint[]>();
  for (const row of rows as RawRow[]) {
    const occurredAt =
      typeof row.first_view_time === 'string'
        ? row.first_view_time
        : row.first_view_time.value;
    const anchor = DOMAIN_TO_ANCHOR[row.page_domain];
    if (!anchor) continue;
    const list = result.get(row.email) ?? [];
    list.push({
      eventType: '[Amplitude] Page Viewed',
      occurredAt,
      anchor,
      leadSourceDetails: null,
      inboundValue: null,
      signupProduct: null,
      pageDomain: row.page_domain,
    });
    result.set(row.email, list);
  }
  return result;
}
