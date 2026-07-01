import { runBigQueryQuery } from './client';

// Top-of-funnel counts across the *entire* AI-Agents-flavoured Amplitude
// audience (not filtered by deal). Used by the Marketing tab to show how
// big the marketing pool is upstream of our HubSpot pipeline.
//
// Internal sipgate emails are excluded so the counts reflect real prospects.

export interface FunnelTopCounts {
  marketingTouch: number; // unique emails with ANY AI-Agents touchpoint
  trialSignup: number;    // subset with a `Signup Atlantis` event tagged FRONTDESK
}

const EVENTS_TABLE = 'ff-amplitude.ampli_live_events.EVENTS_100008946';

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
  'su5_registration',
  'su4_form_submit',
];

// AI-Agents-Anchor: dieselben drei Signaltypen wie in journeys.ts —
// Signup Atlantis FRONTDESK, Form-Submitted: Contact Form (Lead-Formular)
// oder Marketing-Site sipgate.ai.
// Hard-Floor 2026-01-01 — vorher gab es die AI-Agents-Lead-Pipeline kaum,
// und die In-Product-Quali ging erst im Januar live. Zahlen davor verzerren.
const QUERY = `
WITH per_user AS (
  SELECT
    LOWER(user_id) AS email,
    LOGICAL_OR(
      event_type = 'Signup Atlantis'
      AND JSON_VALUE(event_properties, '$.product') = 'FRONTDESK'
    ) AS had_signup,
    LOGICAL_OR(
      CASE
        WHEN event_type = 'Signup Atlantis' AND JSON_VALUE(event_properties, '$.product') = 'FRONTDESK' THEN TRUE
        WHEN event_type = 'Form Submitted: Contact Form' THEN TRUE
        WHEN TO_JSON_STRING(event_properties) LIKE '%sipgate.ai%' THEN TRUE
        ELSE FALSE
      END
    ) AS had_ai_agents_touch
  FROM \`${EVENTS_TABLE}\`
  WHERE event_time >= TIMESTAMP('2026-01-01')
    AND user_id IS NOT NULL
    AND user_id LIKE '%@%'
    AND LOWER(user_id) NOT LIKE '%@sipgate.de'
    AND event_type IN UNNEST(@event_types)
  GROUP BY email
)
SELECT
  COUNTIF(had_ai_agents_touch) AS marketing_touch,
  COUNTIF(had_signup) AS trial_signup
FROM per_user
`;

interface RawRow {
  marketing_touch: number | string;
  trial_signup: number | string;
}

/**
 * Returns the unique-email counts for the global AI-Agents marketing audience
 * (top of funnel). Independent of which deals exist in HubSpot.
 */
export async function getAiAgentsFunnelTop(): Promise<FunnelTopCounts> {
  const rows = await runBigQueryQuery({
    query: QUERY,
    params: { event_types: TOUCHPOINT_EVENT_TYPES },
    types: { event_types: ['STRING'] },
  });
  const row = (rows as RawRow[])[0];
  if (!row) {
    return { marketingTouch: 0, trialSignup: 0 };
  }
  return {
    marketingTouch: Number(row.marketing_touch) || 0,
    trialSignup: Number(row.trial_signup) || 0,
  };
}
