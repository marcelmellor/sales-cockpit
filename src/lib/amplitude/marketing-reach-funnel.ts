import { getBigQuery } from './client';

// Globaler Top-of-Funnel: Anzahl unique device_ids im Zeitfenster, die ein
// Marketing-getaggtes Event hatten (Paid-Ads via gclid/fbclid, Paid-/Content-/
// Email-UTM-Source). Plus eine Aufschlüsselung nach Landing-Domain des ersten
// Marketing-Events pro Device (sipgate.de vs sipgate.ai vs andere).
//
// Die früheren Stages (Identified User, Trial-Signup, AI-Agents-Signup) sind
// bewusst entfernt — sales-cycle-bedingt sind die Kohorten nicht sauber mit
// den HubSpot-Pipeline-Outcomes (Deal angelegt/gewonnen) verbunden. Können
// später optional zurückkommen wenn wir z.B. den Funnel über mehrere Zeit-
// Fenster splitten.

const EVENTS_TABLE = 'ff-amplitude.ampli_live_events.EVENTS_100008946';

const QUERY = `
WITH marketing_events AS (
  SELECT
    device_id,
    event_time,
    REGEXP_EXTRACT(TO_JSON_STRING(event_properties), r'Page Domain":"([^"]+)"') AS page_domain
  FROM \`${EVENTS_TABLE}\`
  WHERE event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    AND device_id IS NOT NULL
    AND (
      JSON_VALUE(event_properties, '$.gclid') IS NOT NULL
      OR JSON_VALUE(event_properties, '$.fbclid') IS NOT NULL
      OR (LOWER(JSON_VALUE(event_properties, '$.utm_source')) IN ('google', 'bing')
          AND LOWER(JSON_VALUE(event_properties, '$.utm_medium')) IN ('paid', 'cpc'))
      OR (LOWER(JSON_VALUE(event_properties, '$.utm_source')) IN ('meta', 'fb', 'ig', 'an', 'linkedin')
          AND LOWER(JSON_VALUE(event_properties, '$.utm_medium')) = 'paid')
      OR LOWER(JSON_VALUE(event_properties, '$.utm_source')) = 'sipgateblog'
      OR LOWER(JSON_VALUE(event_properties, '$.utm_source')) IN ('email', 'newsletter')
    )
),
marketing_devices_with_domain AS (
  SELECT
    device_id,
    COALESCE(
      ARRAY_AGG(
        IF(page_domain IS NOT NULL, page_domain, NULL)
        IGNORE NULLS ORDER BY event_time LIMIT 1
      )[SAFE_OFFSET(0)],
      '(none)'
    ) AS first_domain
  FROM marketing_events
  GROUP BY device_id
)
SELECT
  (SELECT COUNT(*) FROM marketing_devices_with_domain) AS marketing_touch_devices,
  (SELECT COUNT(*) FROM marketing_devices_with_domain
   WHERE first_domain IN ('www.sipgate.de', 'sipgate.de')) AS marketing_touch_sipgate_de,
  (SELECT COUNT(*) FROM marketing_devices_with_domain
   WHERE first_domain IN ('www.sipgate.ai', 'sipgate.ai')) AS marketing_touch_sipgate_ai
`;

export interface MarketingReachFunnelCounts {
  marketingTouchDevices: number;
  marketingTouchSipgateDe: number;
  marketingTouchSipgateAi: number;
}

export async function getMarketingReachFunnel(days: number): Promise<MarketingReachFunnelCounts> {
  const bq = getBigQuery();
  const [rows] = await bq.query({
    query: QUERY,
    params: { days },
    types: { days: 'INT64' },
  });
  const row = rows[0] as {
    marketing_touch_devices: number | string;
    marketing_touch_sipgate_de: number | string;
    marketing_touch_sipgate_ai: number | string;
  } | undefined;
  if (!row) {
    return {
      marketingTouchDevices: 0,
      marketingTouchSipgateDe: 0,
      marketingTouchSipgateAi: 0,
    };
  }
  return {
    marketingTouchDevices: Number(row.marketing_touch_devices) || 0,
    marketingTouchSipgateDe: Number(row.marketing_touch_sipgate_de) || 0,
    marketingTouchSipgateAi: Number(row.marketing_touch_sipgate_ai) || 0,
  };
}
