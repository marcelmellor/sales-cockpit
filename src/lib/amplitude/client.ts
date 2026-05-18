import { BigQuery } from '@google-cloud/bigquery';

// Lazy singleton — first access constructs the client. Without this the module
// would try to authenticate at import time, which crashes in environments
// without ADCs even if the caller never queries Amplitude.
let cached: BigQuery | null = null;

const PROJECT_ID = 'ff-amplitude';

export function getBigQuery(): BigQuery {
  if (cached) return cached;

  // Auth resolution order:
  //   1. GOOGLE_APPLICATION_CREDENTIALS_JSON env var (set by Netlify in prod) —
  //      the raw service-account JSON. We parse and hand it to the SDK.
  //   2. GOOGLE_APPLICATION_CREDENTIALS (path to JSON key file) — picked up
  //      automatically by the SDK if set.
  //   3. Application Default Credentials at ~/.config/gcloud/application_default_credentials.json
  //      — used locally after `gcloud auth application-default login`.
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (credentialsJson) {
    cached = new BigQuery({
      projectId: PROJECT_ID,
      credentials: JSON.parse(credentialsJson),
    });
  } else {
    cached = new BigQuery({ projectId: PROJECT_ID });
  }
  return cached;
}
