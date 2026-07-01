import { runBigQueryQuery } from './client';
import { getLostPreviewOverridesInWindow } from './lost-preview-overrides';

// Globale BQ-Counts für Funnel-Stages, unabhängig von HubSpot. Jede Stage
// bekommt ihren Gesamtwert direkt aus Amplitude — die HubSpot-Journey-
// basierte Zählung liefert dann die farbigen Subgroups, der Rest wird als
// „Andere" (grau) gerendert.

const MARKETING_TABLE = 'ff-amplitude.ampli_live_events.EVENTS_100008946';
const INPRODUCT_TABLE = 'ff-amplitude.exports_raw.EVENTS_100022886';

// ── Activation: Signup Atlantis ──────────────────────────────────────────
// Unique user_ids mit Signup-Event im Zeitfenster. Interne sipgate-Mails
// ausgeschlossen. Aufschlüsselung nach Produkt: FRONTDESK (= Agent Signup)
// vs. alles andere (= PBX/Trunking/… Signup).

const ACTIVATION_QUERY = `
SELECT
  COUNTIF(product = 'FRONTDESK') AS agent_signup,
  COUNTIF(product != 'FRONTDESK') AS other_signup,
  COUNT(*) AS total
FROM (
  SELECT
    LOWER(user_id) AS email,
    JSON_VALUE(event_properties, '$.product') AS product
  FROM \`${MARKETING_TABLE}\`
  WHERE event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    AND event_type = 'Signup Atlantis'
    AND user_id IS NOT NULL
    AND LOWER(user_id) NOT LIKE '%@sipgate.de'
  GROUP BY email, product
)
`;

export interface ActivationTotals {
  agentSignup: number;
  otherSignup: number;
  total: number;
}

export async function getActivationTotals(days: number): Promise<ActivationTotals> {
  const rows = await runBigQueryQuery({
    query: ACTIVATION_QUERY,
    params: { days },
    types: { days: 'INT64' },
  });
  const row = rows[0] as {
    agent_signup: number | string;
    other_signup: number | string;
    total: number | string;
  } | undefined;
  if (!row) return { agentSignup: 0, otherSignup: 0, total: 0 };
  return {
    agentSignup: Number(row.agent_signup) || 0,
    otherSignup: Number(row.other_signup) || 0,
    total: Number(row.total) || 0,
  };
}

// ── Preview (Trial): Contract Finalized ──────────────────────────────────
// Unique masterSipIds mit AI-Agents-Preview im Zeitfenster, aufgeschlüsselt
// nach Signup-Typ (Agent/PBX/Bestandskunde). Cross-Project-Join über Email:
//   1. exports_raw (In-Product): Contract Finalized → masterSipId + webuser_email
//   2. ampli_live_events (Marketing): Email → Signup Atlantis product + Zeitpunkt
// webuser_email hat ~100% Coverage in exports_raw (Backend-Event, immer gesetzt).
// Bestandskunde = kein Signup getrackt ODER Signup liegt >90 Tage vor der
// Preview-Aktivierung (= etablierter Kunde, kein frischer Funnel-Durchlauf).

const BESTANDSKUNDE_DAYS = 90; // Signup älter als 3 Monate → Bestandskunde

// Built dynamically by buildPreviewQuery() to inject static overrides.
// The override accounts get their email resolved from any in-product event
// so the signup-type classification cross-join works identically.
function buildPreviewQuery(overrides: { accountId: string; createdAt: string }[]): string {
  const overrideCte = overrides.length > 0
    ? `,
override_emails AS (
  SELECT
    COALESCE(
      CAST(JSON_VALUE(user_properties, '$.account_id') AS STRING),
      REGEXP_EXTRACT(JSON_VALUE(user_properties, '$.webuser_id'), r'^(\\d+)')
    ) AS master_sip_id,
    LOWER(JSON_VALUE(user_properties, '$.webuser_email')) AS email
  FROM \`${INPRODUCT_TABLE}\`
  WHERE COALESCE(
      CAST(JSON_VALUE(user_properties, '$.account_id') AS STRING),
      REGEXP_EXTRACT(JSON_VALUE(user_properties, '$.webuser_id'), r'^(\\d+)')
    ) IN (${overrides.map(o => `'${o.accountId}'`).join(',')})
    AND JSON_VALUE(user_properties, '$.webuser_email') IS NOT NULL
    AND LOWER(JSON_VALUE(user_properties, '$.webuser_email')) NOT LIKE '%@sipgate.de'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY COALESCE(
      CAST(JSON_VALUE(user_properties, '$.account_id') AS STRING),
      REGEXP_EXTRACT(JSON_VALUE(user_properties, '$.webuser_id'), r'^(\\d+)')
    )
    ORDER BY event_time DESC
  ) = 1
),
override_previews AS (
  SELECT
    o.master_sip_id,
    COALESCE(oe.email, '') AS email,
    o.preview_time
  FROM UNNEST([${overrides.map(o => `STRUCT('${o.accountId}' AS master_sip_id, TIMESTAMP '${o.createdAt}' AS preview_time)`).join(',')}]) o
  LEFT JOIN override_emails oe ON o.master_sip_id = oe.master_sip_id
)`
    : '';

  const unionClause = overrides.length > 0
    ? `
  UNION ALL
  SELECT master_sip_id, email, preview_time
  FROM override_previews
  WHERE master_sip_id NOT IN (SELECT master_sip_id FROM tracked_previews)`
    : '';

  return `
WITH tracked_previews AS (
  SELECT
    COALESCE(
      CAST(JSON_VALUE(user_properties, '$.account_id') AS STRING),
      REGEXP_EXTRACT(JSON_VALUE(user_properties, '$.webuser_id'), r'^(\\d+)')
    ) AS master_sip_id,
    LOWER(JSON_VALUE(user_properties, '$.webuser_email')) AS email,
    event_time AS preview_time
  FROM \`${INPRODUCT_TABLE}\`
  WHERE event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    AND event_type = 'Contract Finalized'
    AND JSON_VALUE(event_properties, '$.product_name') = 'ai_assistant_frontdesk_preview'
    AND JSON_VALUE(user_properties, '$.webuser_email') IS NOT NULL
    AND LOWER(JSON_VALUE(user_properties, '$.webuser_email')) NOT LIKE '%@sipgate.de'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY COALESCE(
      CAST(JSON_VALUE(user_properties, '$.account_id') AS STRING),
      REGEXP_EXTRACT(JSON_VALUE(user_properties, '$.webuser_id'), r'^(\\d+)')
    )
    ORDER BY event_time ASC
  ) = 1
)${overrideCte},
preview_unique AS (
  SELECT * FROM tracked_previews${unionClause}
),
signup_product AS (
  SELECT
    LOWER(user_id) AS email,
    ARRAY_AGG(
      JSON_VALUE(event_properties, '$.product') ORDER BY event_time ASC LIMIT 1
    )[OFFSET(0)] AS product,
    MIN(event_time) AS signup_time
  FROM \`${MARKETING_TABLE}\`
  WHERE event_type = 'Signup Atlantis'
    AND user_id IS NOT NULL
    AND LOWER(user_id) NOT LIKE '%@sipgate.de'
  GROUP BY email
),
preview_classified AS (
  SELECT
    p.master_sip_id,
    CASE
      WHEN sp.product = 'FRONTDESK'
           AND sp.signup_time >= TIMESTAMP_SUB(p.preview_time, INTERVAL ${BESTANDSKUNDE_DAYS} DAY)
        THEN 'agent'
      WHEN sp.product IS NOT NULL
           AND sp.signup_time >= TIMESTAMP_SUB(p.preview_time, INTERVAL ${BESTANDSKUNDE_DAYS} DAY)
        THEN 'other'
      ELSE 'bestandskunde'
    END AS signup_type
  FROM preview_unique p
  LEFT JOIN signup_product sp ON p.email = sp.email
)
SELECT
  COUNT(*) AS total,
  COUNTIF(signup_type = 'agent') AS agent_signup,
  COUNTIF(signup_type = 'other') AS other_signup,
  COUNTIF(signup_type = 'bestandskunde') AS bestandskunde
FROM preview_classified
WHERE master_sip_id IS NOT NULL
`;
}

export interface PreviewTrialTotals {
  total: number;
  agentSignup: number;
  otherSignup: number;
  bestandskunde: number;
}

export async function getPreviewTrialTotals(days: number): Promise<PreviewTrialTotals> {
  const overrides = getLostPreviewOverridesInWindow(days);
  const query = buildPreviewQuery(overrides);
  const rows = await runBigQueryQuery({
    query,
    params: { days },
    types: { days: 'INT64' },
  });
  const row = rows[0] as {
    total: number | string;
    agent_signup: number | string;
    other_signup: number | string;
    bestandskunde: number | string;
  } | undefined;
  if (!row) return { total: 0, agentSignup: 0, otherSignup: 0, bestandskunde: 0 };
  return {
    total: Number(row.total) || 0,
    agentSignup: Number(row.agent_signup) || 0,
    otherSignup: Number(row.other_signup) || 0,
    bestandskunde: Number(row.bestandskunde) || 0,
  };
}
