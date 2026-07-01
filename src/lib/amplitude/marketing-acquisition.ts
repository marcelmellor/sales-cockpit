import { runBigQueryQuery } from './client';
import type { Touchpoint } from './journeys';

// Marketing-Acquisition über UTM/Click-IDs: für jeden User finden wir die
// chronologisch früheste Berührung mit einem klar Marketing-Kanal-getaggten
// Event (Paid-Ads via gclid/fbclid oder utm_source/medium, plus Content-
// Marketing/Email). Ergebnis pro User ist EIN Touchpoint, der dann im
// Funnel als Beweis "wurde via Marketing akquiriert" zählt.
//
// Gegenüber der alten Heuristik ("hat irgendwas mit AI-Agents zu tun")
// ist das ein deutlich härteres Signal: wenn `gclid` gesetzt ist, kam der
// User definitiv über einen Google-Ad-Klick. Internes (appweb, inapp,
// website_main_menu, etc.) wird explizit NICHT als Marketing-Touch gezählt.
//
// Attribution läuft über zwei Pfade, um Cross-Device-Lücken zu schließen:
//
// 1. device_id-Join: Email → alle device_ids dieses Users → Marketing-Events
//    auf diesen Devices. Deckt den Hauptfall ab (anonymer Ad-Klick vor Signup
//    auf demselben Gerät).
//
// 2. amplitude_id-Join: Email → alle amplitude_ids dieses Users → Marketing-
//    Events auf allen Devices unter diesen amplitude_ids. Schließt den Cross-
//    Device-Gap (Ad-Klick auf Handy, Signup auf Laptop), sofern Amplitude die
//    Geräte über Identity Resolution verknüpft hat.
//
// Beide Pfade werden per UNION ALL zusammengeführt und auf den frühesten
// Marketing-Touch pro Email reduziert.

const EVENTS_TABLE = 'ff-amplitude.ampli_live_events.EVENTS_100008946';

const QUERY = `
WITH target_emails AS (
  SELECT email FROM UNNEST(@emails) AS email
),
-- Path 1: device_id bridge
device_to_email AS (
  SELECT DISTINCT
    LOWER(e.user_id) AS email,
    e.device_id
  FROM \`${EVENTS_TABLE}\` e
  JOIN target_emails t ON LOWER(e.user_id) = t.email
  WHERE e.device_id IS NOT NULL
    AND e.event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY)
),
events_via_device AS (
  SELECT
    d2e.email,
    e.event_time,
    LOWER(JSON_VALUE(e.event_properties, '$.utm_source')) AS src,
    LOWER(JSON_VALUE(e.event_properties, '$.utm_medium')) AS med,
    LOWER(JSON_VALUE(e.event_properties, '$.utm_campaign')) AS campaign,
    JSON_VALUE(e.event_properties, '$.gclid') AS gclid,
    JSON_VALUE(e.event_properties, '$.fbclid') AS fbclid
  FROM device_to_email d2e
  JOIN \`${EVENTS_TABLE}\` e
    ON e.device_id = d2e.device_id
   AND e.event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY)
),
-- Path 2: amplitude_id bridge (cross-device)
ampid_to_email AS (
  SELECT DISTINCT
    LOWER(e.user_id) AS email,
    e.amplitude_id
  FROM \`${EVENTS_TABLE}\` e
  JOIN target_emails t ON LOWER(e.user_id) = t.email
  WHERE e.amplitude_id IS NOT NULL
    AND e.event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY)
),
events_via_ampid AS (
  SELECT
    a2e.email,
    e.event_time,
    LOWER(JSON_VALUE(e.event_properties, '$.utm_source')) AS src,
    LOWER(JSON_VALUE(e.event_properties, '$.utm_medium')) AS med,
    LOWER(JSON_VALUE(e.event_properties, '$.utm_campaign')) AS campaign,
    JSON_VALUE(e.event_properties, '$.gclid') AS gclid,
    JSON_VALUE(e.event_properties, '$.fbclid') AS fbclid
  FROM ampid_to_email a2e
  JOIN \`${EVENTS_TABLE}\` e
    ON e.amplitude_id = a2e.amplitude_id
   AND e.event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY)
),
attributed_events AS (
  SELECT * FROM events_via_device
  UNION ALL
  SELECT * FROM events_via_ampid
),
classified AS (
  SELECT
    email,
    event_time,
    src,
    med,
    campaign,
    -- Klassifikation in Marketing-Kanäle. Reihenfolge wichtig: Click-ID
    -- gewinnt vor utm_source/medium, weil sie das stärkere Signal sind.
    CASE
      WHEN gclid IS NOT NULL THEN 'paid_search'
      WHEN fbclid IS NOT NULL THEN 'paid_social_meta'
      WHEN src IN ('google', 'bing') AND med IN ('paid', 'cpc') THEN 'paid_search'
      WHEN src IN ('meta', 'fb', 'ig', 'an', 'linkedin') AND med = 'paid' THEN 'paid_social'
      WHEN src = 'sipgateblog' THEN 'content_marketing'
      WHEN src IN ('email', 'newsletter') THEN 'email_marketing'
      ELSE NULL
    END AS channel
  FROM attributed_events
)
SELECT
  email,
  ARRAY_AGG(
    STRUCT(event_time, channel, src, med, campaign)
    ORDER BY event_time
    LIMIT 1
  )[OFFSET(0)] AS first_hit
FROM classified
WHERE channel IS NOT NULL
GROUP BY email
`;

interface RawRow {
  email: string;
  first_hit: {
    event_time: { value: string } | string;
    channel: string;
    src: string | null;
    med: string | null;
    campaign: string | null;
  };
}

/**
 * Returns the earliest Marketing-Acquisition touchpoint per email (paid
 * channels + content/email marketing). Emails without any matching event are
 * absent from the map.
 */
export async function getMarketingAcquisitionByEmail(
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

  const rows = await runBigQueryQuery({
    query: QUERY,
    params: { emails: normalized },
    types: { emails: ['STRING'] },
  });

  const result = new Map<string, Touchpoint[]>();
  for (const row of rows as RawRow[]) {
    const hit = row.first_hit;
    if (!hit) continue;
    const occurredAt = typeof hit.event_time === 'string' ? hit.event_time : hit.event_time.value;
    // Channel + Source/Medium zusammensetzen für den Tooltip — z.B.
    // "paid_search · google/paid · brand_de_q1_2026".
    const parts = [hit.channel];
    if (hit.src) parts.push(hit.src + (hit.med ? `/${hit.med}` : ''));
    if (hit.campaign) parts.push(hit.campaign);
    const leadSourceDetails = parts.join(' · ');
    result.set(row.email, [
      {
        eventType: '[Marketing Acquisition]',
        occurredAt,
        anchor: 'marketing_acquisition',
        leadSourceDetails,
        inboundValue: null,
        signupProduct: null,
        pageDomain: null,
      },
    ]);
  }
  return result;
}
