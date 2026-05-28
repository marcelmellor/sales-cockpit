import { getBigQuery } from './client';
import type { Touchpoint } from './journeys';

// AI-Agents Preview/Trial activations from the in-product Amplitude project
// (`exports_raw`). The event is `Contract Finalized` with
// `product_name = 'ai_assistant_frontdesk_preview'`, fired by the backend
// whenever a customer activates the AI Agents free preview — regardless of
// entry point (PBX signup, Agent standalone signup, or existing customer).
//
// This event has been reliably tracked since mid-February 2026. Before that,
// `Frontdesk Trial Started` (in `ampli_live_events`) served a similar purpose
// but is now dead (last events early March 2026).
//
// Identity resolution: `account_id` in user_properties is populated for ~80%
// of events (requires prior frontend session). `webuser_id` (format
// `{masterSipId}w{n}`) is present on 100% of events and is the reliable join
// key. We extract the masterSipId via regex from `webuser_id`, with
// `account_id` as a fallback.

const EVENTS_TABLE = 'ff-amplitude.exports_raw.EVENTS_100022886';

const QUERY = `
SELECT
  COALESCE(
    CAST(JSON_VALUE(user_properties, '$.account_id') AS STRING),
    REGEXP_EXTRACT(JSON_VALUE(user_properties, '$.webuser_id'), r'^(\\d+)')
  ) AS master_sip_id,
  event_time
FROM \`${EVENTS_TABLE}\`
WHERE event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY)
  AND event_type = 'Contract Finalized'
  AND JSON_VALUE(event_properties, '$.product_name') = 'ai_assistant_frontdesk_preview'
  AND COALESCE(
    CAST(JSON_VALUE(user_properties, '$.account_id') AS STRING),
    REGEXP_EXTRACT(JSON_VALUE(user_properties, '$.webuser_id'), r'^(\\d+)')
  ) IN UNNEST(@mastersipids)
ORDER BY master_sip_id, event_time
`;

interface RawRow {
  master_sip_id: string;
  event_time: { value: string } | string;
}

/**
 * Returns AI-Agents preview/trial activation touchpoints keyed by masterSipId.
 * Each mastersipid gets at most one touchpoint (the earliest activation).
 * MasterSipIds with no preview event are absent from the map.
 *
 * Empty input → empty Map (no BQ call).
 */
export async function getPreviewTrialsByMastersipid(
  mastersipids: readonly string[],
): Promise<Map<string, Touchpoint[]>> {
  const normalized = Array.from(
    new Set(
      mastersipids
        .map(m => String(m).trim())
        .filter(m => m.length > 0 && /^\d+$/.test(m)),
    ),
  );
  if (normalized.length === 0) {
    return new Map();
  }

  const bq = getBigQuery();
  const [rows] = await bq.query({
    query: QUERY,
    params: { mastersipids: normalized },
    types: { mastersipids: ['STRING'] },
  });

  // Deduplicate: keep only the earliest event per mastersipid (a customer
  // might re-activate a preview after expiry, but the funnel cares about
  // the first activation).
  const result = new Map<string, Touchpoint[]>();
  for (const row of rows as RawRow[]) {
    if (result.has(row.master_sip_id)) continue; // rows are ORDER BY event_time
    const occurredAt =
      typeof row.event_time === 'string' ? row.event_time : row.event_time.value;
    result.set(row.master_sip_id, [
      {
        eventType: 'Preview gestartet',
        occurredAt,
        anchor: 'preview_trial_started',
        leadSourceDetails: null,
        inboundValue: null,
        signupProduct: null,
        pageDomain: null,
      },
    ]);
  }
  return result;
}
