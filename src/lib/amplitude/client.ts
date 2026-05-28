import { BigQuery } from '@google-cloud/bigquery';
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
