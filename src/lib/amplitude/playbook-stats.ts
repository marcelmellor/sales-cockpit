import { runBigQueryQuery } from './client';

// Playbook-Adoption nach Preview-Aktivierung.
//
// Zählt Accounts, die im Zeitraum eine AI-Agents-Preview aktiviert haben
// (Contract Finalized, product_name = 'ai_assistant_frontdesk_preview') und
// danach ≥ 3 distinct Playbooks besucht haben.
//
// Es gibt kein dediziertes "Playbook Created"-Event. Proxy: Page Views auf
// `/frontdesks/:uuid/topics/view/:uuid` — die zweite UUID identifiziert das
// Playbook. Nur Views NACH dem Preview-Start des jeweiligen Accounts werden
// gezählt, damit Pre-Preview-Aktivität nicht reinrauscht.

const EVENTS_TABLE = 'ff-amplitude.exports_raw.EVENTS_100022886';

export interface PlaybookStats {
  /** Accounts, die im Zeitraum eine Preview aktiviert und danach ≥ 3 Playbooks erstellt haben */
  accountsWith3PlusPlaybooks: number;
  /** Accounts, die im Zeitraum eine Preview aktiviert haben (Basis) */
  previewAccountsTotal: number;
}

/**
 * Preview-Accounts mit Playbook-Adoption im angegebenen Zeitraum.
 * @param days — Rolling window in Tagen (z.B. 30, 90)
 */
export async function getPlaybookStats(days: number): Promise<PlaybookStats> {

  const query = `
    -- 1. Accounts, die im Zeitraum eine Preview aktiviert haben
    WITH previews AS (
      SELECT
        COALESCE(
          CAST(JSON_VALUE(user_properties, '$.account_id') AS STRING),
          REGEXP_EXTRACT(JSON_VALUE(user_properties, '$.webuser_id'), r'^(\\d+)')
        ) AS master_sip_id,
        MIN(event_time) AS preview_started_at
      FROM \`${EVENTS_TABLE}\`
      WHERE event_type = 'Contract Finalized'
        AND JSON_VALUE(event_properties, '$.product_name') = 'ai_assistant_frontdesk_preview'
        AND event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
      GROUP BY master_sip_id
    ),
    -- 2. Playbook-Views (alle, nicht zeitgefiltert — der Join auf previews
    --    stellt sicher, dass nur Post-Preview-Views zählen)
    playbook_views AS (
      SELECT
        COALESCE(
          CAST(JSON_VALUE(user_properties, '$.account_id') AS STRING),
          REGEXP_EXTRACT(JSON_VALUE(user_properties, '$.webuser_id'), r'^(\\d+)')
        ) AS master_sip_id,
        event_time,
        REGEXP_EXTRACT(
          JSON_VALUE(event_properties, '$."[Amplitude] Page Path"'),
          r'/topics/view/([^/]+)'
        ) AS playbook_uuid
      FROM \`${EVENTS_TABLE}\`
      WHERE event_type = '[Amplitude] Page Viewed'
        AND event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
        AND JSON_VALUE(event_properties, '$."[Amplitude] Page Path"') LIKE '%/topics/view/%'
    ),
    -- 3. Join: nur Playbook-Views NACH Preview-Start des Accounts
    post_preview_playbooks AS (
      SELECT
        p.master_sip_id,
        COUNT(DISTINCT pv.playbook_uuid) AS playbook_count
      FROM previews p
      JOIN playbook_views pv
        ON pv.master_sip_id = p.master_sip_id
        AND pv.event_time >= p.preview_started_at
      WHERE pv.playbook_uuid IS NOT NULL
      GROUP BY p.master_sip_id
    )
    SELECT
      (SELECT COUNT(*) FROM previews WHERE master_sip_id IS NOT NULL) AS preview_total,
      (SELECT COUNTIF(playbook_count >= 3) FROM post_preview_playbooks) AS accounts_3plus
  `;

  const rows = await runBigQueryQuery({
    query,
    params: { days },
    types: { days: 'INT64' },
  });

  const row = (rows as Array<{ preview_total: number; accounts_3plus: number }>)[0];
  return {
    accountsWith3PlusPlaybooks: row?.accounts_3plus ?? 0,
    previewAccountsTotal: row?.preview_total ?? 0,
  };
}
