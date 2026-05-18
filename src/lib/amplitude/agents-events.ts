import { getBigQuery } from './client';
import type { Touchpoint } from './journeys';

// In-product AI-Agents-Qualifizierungs-Events. Liegen in einem ANDEREN
// Amplitude-Project als der Marketing-/Signup-Funnel (`exports_raw` statt
// `ampli_live_events`) und identifizieren User nicht per Email sondern per
// `event_properties.master_sip_id`. Die HubSpot-Contacts in sipgate 2025
// haben die `mastersipid`-Property gefüllt, daher können wir hier sauber
// matchen.
//
// Zwei Anchor-Klassen (Heuristik: Zeit zwischen Event und User's allererstem
// Amplitude-Event in diesem Project):
//   - agents_qualification_onboarding: ≤60 min — Self-Service-Pfad direkt nach
//     Erstanmeldung. Die Quali-Fragen sind in die Onboarding-Sequenz
//     (Accountverwaltung, Address Verification, Startseite) eingebettet.
//   - agents_qualification_inproduct: >60 min — Bestandskunde navigiert aktiv
//     zur AI-Agents-Setup-Seite ("Wie möchten Sie...?" / "Wie hoch ist das
//     monatliche Volumen...?") und triggert Cross-/Upsell-Quali.

const EVENTS_TABLE = 'ff-amplitude.exports_raw.EVENTS_100022886';
const ONBOARDING_WINDOW_MINUTES = 60;

const QUERY = `
WITH per_user_first AS (
  SELECT amplitude_id, MIN(event_time) AS first_seen
  FROM \`${EVENTS_TABLE}\`
  WHERE event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY)
  GROUP BY amplitude_id
),
qual AS (
  SELECT
    JSON_VALUE(event_properties, '$.master_sip_id') AS master_sip_id,
    event_type,
    event_time,
    amplitude_id,
    JSON_VALUE(event_properties, '$.inbound_value') AS inbound_value
  FROM \`${EVENTS_TABLE}\`
  WHERE event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 365 DAY)
    AND event_type = 'Agents Lead Qualification Submitted'
    AND JSON_VALUE(event_properties, '$.master_sip_id') IS NOT NULL
    AND JSON_VALUE(event_properties, '$.master_sip_id') IN UNNEST(@mastersipids)
)
SELECT
  q.master_sip_id,
  q.event_type,
  q.event_time,
  q.inbound_value,
  CASE
    WHEN f.first_seen IS NULL THEN 'agents_qualification_inproduct'
    WHEN TIMESTAMP_DIFF(q.event_time, f.first_seen, MINUTE) <= ${ONBOARDING_WINDOW_MINUTES}
      THEN 'agents_qualification_onboarding'
    ELSE 'agents_qualification_inproduct'
  END AS anchor
FROM qual q
LEFT JOIN per_user_first f USING (amplitude_id)
ORDER BY master_sip_id, event_time
`;

interface RawRow {
  master_sip_id: string;
  event_type: string;
  event_time: { value: string } | string;
  inbound_value: string | null;
  anchor: 'agents_qualification_onboarding' | 'agents_qualification_inproduct';
}

/**
 * Returns AI-Agents-Qualifizierungs-Touchpoints keyed by mastersipid.
 * Mastersipids with no events are absent from the map.
 *
 * Empty input → empty Map (no BQ call).
 */
export async function getAgentsQualificationByMastersipid(
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

  const result = new Map<string, Touchpoint[]>();
  for (const row of rows as RawRow[]) {
    const occurredAt =
      typeof row.event_time === 'string' ? row.event_time : row.event_time.value;
    const list = result.get(row.master_sip_id) ?? [];
    list.push({
      eventType: row.event_type,
      occurredAt,
      anchor: row.anchor,
      leadSourceDetails: null,
      inboundValue: row.inbound_value,
      signupProduct: null,
    });
    result.set(row.master_sip_id, list);
  }
  return result;
}
