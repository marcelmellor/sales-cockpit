import { getBigQuery } from './client';

// sipgate-Customer-Stammdaten aus dem kuratierten `amplitude.user_properties`-
// Snapshot. Wir nutzen das im Marketing-Tab nur für eine Sache: die "Bestands-
// kunde seit JJJJ"-Badge. Source-of-truth ist `webuser_creation_date` (STRING
// im ISO-Format), gemappt per `account_id` = sipgate `mastersipid`.

const TABLE = 'ff-amplitude.amplitude.user_properties';

const QUERY = `
SELECT
  CAST(account_id AS STRING) AS master_sip_id,
  MIN(webuser_creation_date) AS first_creation
FROM \`${TABLE}\`
WHERE account_id IN UNNEST(@mastersipids)
  AND webuser_creation_date IS NOT NULL
GROUP BY account_id
`;

interface RawRow {
  master_sip_id: string;
  first_creation: string;
}

/**
 * Returns the earliest sipgate-account creation date per mastersipid (ISO
 * date string). Mastersipids without a record are absent from the map.
 */
export async function getCustomerCreationByMastersipid(
  mastersipids: readonly string[],
): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(
      mastersipids
        .map(m => String(m).trim())
        .filter(m => /^\d+$/.test(m))
        .map(m => Number(m)),
    ),
  );
  if (ids.length === 0) {
    return new Map();
  }

  const bq = getBigQuery();
  const [rows] = await bq.query({
    query: QUERY,
    params: { mastersipids: ids },
    types: { mastersipids: ['INT64'] },
  });

  const result = new Map<string, string>();
  for (const row of rows as RawRow[]) {
    if (row.first_creation) {
      result.set(row.master_sip_id, row.first_creation);
    }
  }
  return result;
}
