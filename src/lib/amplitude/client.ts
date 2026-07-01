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
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new BigQueryTimeoutError(timeoutMs)), timeoutMs);
  });
  const [rows] = await Promise.race([bq.query(query), timeout]);
  return rows as T[];
}
