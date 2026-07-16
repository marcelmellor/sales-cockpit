import { BigQuery, Query } from '@google-cloud/bigquery';
import { readFileSync } from 'fs';

let cached: BigQuery | null = null;

const PROJECT_ID = 'ff-amplitude';

export function getBigQuery(): BigQuery {
  if (cached) return cached;

  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (credentialsJson) {
    cached = new BigQuery({
      projectId: PROJECT_ID,
      credentials: JSON.parse(credentialsJson),
    });
  } else if (credentialsPath) {
    cached = new BigQuery({
      projectId: PROJECT_ID,
      credentials: JSON.parse(readFileSync(credentialsPath, 'utf-8')),
    });
  } else {
    cached = new BigQuery({ projectId: PROJECT_ID });
  }
  return cached;
}

const DEFAULT_QUERY_TIMEOUT_MS = 10_000;

// Per-query blast-radius cap. BigQuery rejects (bills 0 for) any query whose
// estimate exceeds `maximumBytesBilled`, so this bounds the damage of a SINGLE
// pathological query — a dropped `WHERE`, a lost `event_type` cluster filter,
// an accidental `SELECT *` — before it runs. Concretely, on the 816 GiB
// `exports_raw` events table a full-column `all`-window scan is ~493 GiB and a
// full-table scan ~816 GiB; both trip this cap and fail loudly in the logs
// instead of billing silently.
//
// What it does NOT catch: aggregate spend from many *individually cheap*
// queries run too often. That is exactly the class that caused the 2026-07-15
// warmer incident (~$1000/day = 360 cron runs/day × ~$3, each query only
// ~10 GiB). That frequency class is handled elsewhere — by the TTL-aware
// warmer and by the GCP project-level *daily* bytes quota. Don't mistake this
// per-query cap for a spend ceiling; it is one layer of defence-in-depth.
//
// Sizing: the heaviest *legitimate* query measured is playbook-stats over the
// `all` window at ~74 GiB (it scans the high-volume `[Amplitude] Page Viewed`
// cluster); the warmer's own queries are ≤ ~10 GiB. Default 300 GiB ≈ 4× the
// legit max for growth headroom (the `all` window grows ~1 day/day), while
// still far below the 493/816 GiB runaway scans. Override via
// `BIGQUERY_MAX_BYTES_BILLED` (raw bytes) to retune without a deploy.
const DEFAULT_MAX_BYTES_BILLED = 300 * 1024 ** 3; // 300 GiB

function maxBytesBilled(): string {
  const raw = Number(process.env.BIGQUERY_MAX_BYTES_BILLED);
  const bytes = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_BYTES_BILLED;
  return String(bytes);
}

export class BigQueryTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`BigQuery query timed out after ${timeoutMs}ms`);
    this.name = 'BigQueryTimeoutError';
  }
}

// Observed in production (Netlify Functions): bq.query() can hang
// indefinitely with no error and no console output, exhausting the whole
// function's execution budget (~40s) and taking down unrelated work in the
// same route with it. Race every query against a hard timeout so callers'
// existing `.catch()` fallbacks actually run instead of the platform killing
// the function first. All amplitude/*.ts modules must call this instead of
// `getBigQuery().query()` directly.
export async function runBigQueryQuery<T = unknown>(
  query: Query,
  timeoutMs: number = DEFAULT_QUERY_TIMEOUT_MS,
): Promise<T[]> {
  const bq = getBigQuery();
  // Apply the cost cap unless the caller set one explicitly.
  const cappedQuery: Query = {
    ...query,
    maximumBytesBilled: query.maximumBytesBilled ?? maxBytesBilled(),
  };
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new BigQueryTimeoutError(timeoutMs)), timeoutMs);
  });
  const [rows] = await Promise.race([bq.query(cappedQuery), timeout]);
  return rows as T[];
}
