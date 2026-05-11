import { getJiraIssueUrl } from './urls';
import type {
  JiraApiIssue,
  JiraEpicWithChildren,
  JiraIssue,
} from './types';

// ---------------------------------------------------------------------------
// JIRA Cloud REST API v3 client
//
// Auth: Basic (email + API token, base64). Token is created at
//   https://id.atlassian.com/manage-profile/security/api-tokens
// and lives in JIRA_API_TOKEN. Email lives in JIRA_EMAIL. Base URL in
// JIRA_BASE_URL (https://sipgatede.atlassian.net for sipgate). See
// AGENTS.md → "JIRA authentication" for the why.
//
// We use:
//   - GET  /rest/api/3/issue/{key}            — single issue
//   - POST /rest/api/3/search/jql             — JQL search (replaces the
//                                              deprecated GET /search)
//
// We deliberately do NOT cache here. Caching belongs in the API route layer
// or via React Query on the client, not in the SDK.
// ---------------------------------------------------------------------------

// Story-point custom field IDs vary per JIRA portal. We probe a few known IDs
// in priority order and use the first one that's set. Sipgate's portal uses
// `customfield_10016` at the time of writing; the others are common fallbacks
// kept here so this works if/when admins reorganise custom fields.
const STORY_POINT_FIELD_CANDIDATES = [
  'customfield_10016',
  'customfield_10026',
  'customfield_10004',
] as const;

// "Ende der Testphase" — sipgate-specific date custom field on the SC project
// (project id 11325). See AGENTS.md → "JIRA authentication".
const TEST_PHASE_END_FIELD = 'customfield_11758';

const ISSUE_FIELDS = [
  'summary',
  'status',
  'issuetype',
  'assignee',
  'reporter',
  'priority',
  'parent',
  'created',
  'updated',
  'resolutiondate',
  // Issue-Links nutzen wir zur Erkennung von "is a parent of"-Kindern. Im
  // SC-Projekt wird die Hierarchie überwiegend hierüber abgebildet, nicht
  // über das parent-Field.
  'issuelinks',
  TEST_PHASE_END_FIELD,
  ...STORY_POINT_FIELD_CANDIDATES,
];

// Issue-Link-Shape (subset). JIRA liefert pro Issue eine Liste von Links;
// jeder Link hat einen Typ und genau ein `inwardIssue` ODER `outwardIssue`,
// abhängig davon, ob dieses Issue auf der linken oder rechten Seite des
// Link-Typs steht. Für „Parent" gilt: das Eltern-Issue hat `inwardIssue`
// (= Kind), das Kind-Issue hat `outwardIssue` (= Elternteil).
type JiraIssueLink = {
  type: { name: string; inward: string; outward: string };
  inwardIssue?: { key: string };
  outwardIssue?: { key: string };
};

function getBaseUrl(): string {
  const base = process.env.JIRA_BASE_URL;
  if (!base) {
    throw new Error('JIRA_BASE_URL is not set. See AGENTS.md → "JIRA authentication".');
  }
  return base.replace(/\/+$/, '');
}

function getAuthHeader(): string {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) {
    throw new Error(
      'JIRA_EMAIL and JIRA_API_TOKEN must both be set. Create a token at ' +
        'https://id.atlassian.com/manage-profile/security/api-tokens and add it to .env.local. ' +
        'See AGENTS.md → "JIRA authentication".'
    );
  }
  const encoded = Buffer.from(`${email}:${token}`).toString('base64');
  return `Basic ${encoded}`;
}

export class JiraError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'JiraError';
    this.status = status;
    this.body = body;
  }
}

export function getJiraClient(): JiraClient {
  return new JiraClient();
}

export class JiraClient {
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${getBaseUrl()}${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: getAuthHeader(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new JiraError(
        `JIRA API ${response.status} on ${path}`,
        response.status,
        body,
      );
    }

    // Some endpoints (rarely) return 204; we don't hit those, but be defensive.
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  /**
   * Fetch a single issue and project it onto our minimal `JiraIssue` shape.
   */
  async getIssue(issueKey: string): Promise<JiraIssue> {
    const raw = await this.request<JiraApiIssue>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${encodeURIComponent(ISSUE_FIELDS.join(','))}`,
    );
    return mapIssue(raw);
  }

  /**
   * Fetch many issues in a single JQL search. JIRA caps `key in (...)` at
   * a few thousand keys; we chunk at 100 to stay well clear and avoid URL
   * length issues since the request body remains small. Order of returned
   * issues is not guaranteed — callers should index by key.
   *
   * Issues that don't exist (or that the token can't see) are simply absent
   * from the result; no error is thrown.
   */
  async getIssuesByKeys(issueKeys: string[]): Promise<JiraIssue[]> {
    if (issueKeys.length === 0) return [];
    const unique = Array.from(new Set(issueKeys));

    const CHUNK = 100;
    const all: JiraApiIssue[] = [];

    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const jql = `key in (${chunk.map((k) => `"${k}"`).join(',')})`;

      let nextPageToken: string | undefined;
      let safety = 0;
      do {
        const body: Record<string, unknown> = {
          jql,
          fields: ISSUE_FIELDS,
          maxResults: 100,
        };
        if (nextPageToken) body.nextPageToken = nextPageToken;

        const page = await this.request<{
          issues: JiraApiIssue[];
          nextPageToken?: string;
          isLast?: boolean;
        }>('/rest/api/3/search/jql', {
          method: 'POST',
          body: JSON.stringify(body),
        });

        all.push(...(page.issues ?? []));
        nextPageToken = page.isLast ? undefined : page.nextPageToken;
        safety += 1;
        if (safety > 20) break;
      } while (nextPageToken);
    }

    return all.map(mapIssue);
  }

  /**
   * Returns child issues for many parents in one (or few) JQL search calls.
   * Result is indexed by parent key. Parents without children get an empty
   * array. Useful when you have N "epic-like" issues and want to count their
   * sub-tasks without fanning out N requests.
   */
  async getChildrenForParents(parentKeys: string[]): Promise<Map<string, JiraIssue[]>> {
    const result = new Map<string, JiraIssue[]>();
    if (parentKeys.length === 0) return result;
    const unique = Array.from(new Set(parentKeys));
    for (const k of unique) result.set(k, []);

    const CHUNK = 50; // konservativ — JQL-Strings sollten kurz bleiben
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const jql = `parent in (${chunk.map((k) => `"${k}"`).join(',')}) ORDER BY parent ASC, created ASC`;

      let nextPageToken: string | undefined;
      let safety = 0;
      do {
        const body: Record<string, unknown> = {
          jql,
          fields: ISSUE_FIELDS,
          maxResults: 100,
        };
        if (nextPageToken) body.nextPageToken = nextPageToken;

        const page = await this.request<{
          issues: JiraApiIssue[];
          nextPageToken?: string;
          isLast?: boolean;
        }>('/rest/api/3/search/jql', {
          method: 'POST',
          body: JSON.stringify(body),
        });

        for (const raw of page.issues ?? []) {
          const issue = mapIssue(raw);
          if (issue.parentKey && result.has(issue.parentKey)) {
            result.get(issue.parentKey)!.push(issue);
          }
        }

        nextPageToken = page.isLast ? undefined : page.nextPageToken;
        safety += 1;
        if (safety > 50) break;
      } while (nextPageToken);
    }

    return result;
  }

  /**
   * Returns the children of an epic.
   *
   * In team-managed projects, child issues use the `parent` field. In
   * company-managed projects, the legacy "Epic Link" custom field is used.
   * The JQL `parent = X` works in both cases on modern JIRA Cloud, so we
   * only issue one query.
   */
  async getEpicChildren(epicKey: string): Promise<JiraIssue[]> {
    const all: JiraApiIssue[] = [];
    let nextPageToken: string | undefined;
    let safety = 0;

    do {
      // Newer pagination: `nextPageToken`. Older deployments accept
      // startAt/maxResults; the new endpoint requires nextPageToken.
      const body: Record<string, unknown> = {
        jql: `parent = "${epicKey}" ORDER BY created ASC`,
        fields: ISSUE_FIELDS,
        maxResults: 100,
      };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      const page = await this.request<{
        issues: JiraApiIssue[];
        nextPageToken?: string;
        isLast?: boolean;
      }>('/rest/api/3/search/jql', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      all.push(...(page.issues ?? []));
      nextPageToken = page.isLast ? undefined : page.nextPageToken;
      safety += 1;
      if (safety > 50) break; // hard cap — a single epic with >5000 children is a bug
    } while (nextPageToken);

    return all.map(mapIssue);
  }

  /**
   * Convenience: fetch the epic itself plus all its children in two calls.
   */
  async getEpicWithChildren(epicKey: string): Promise<JiraEpicWithChildren> {
    const [epic, children] = await Promise.all([
      this.getIssue(epicKey),
      this.getEpicChildren(epicKey),
    ]);
    return { epic, children };
  }
}

function mapIssue(raw: JiraApiIssue): JiraIssue {
  const fields = raw.fields;
  let storyPoints: number | null = null;
  for (const candidate of STORY_POINT_FIELD_CANDIDATES) {
    const value = fields[candidate];
    if (typeof value === 'number') {
      storyPoints = value;
      break;
    }
  }

  const rawTestPhaseEnd = fields[TEST_PHASE_END_FIELD];
  const testPhaseEnd = typeof rawTestPhaseEnd === 'string' ? rawTestPhaseEnd : null;

  // Issue-Links auswerten: nur Typ „Parent" (Name oder inward-Text), und nur
  // inwardIssue (= das aktuelle Issue ist Elternteil, der inwardIssue ist
  // Kind). Robust gegenüber Lokalisierung: wir prüfen sowohl type.name als
  // auch type.inward textuell.
  const rawLinks = (fields as { issuelinks?: JiraIssueLink[] }).issuelinks ?? [];
  const linkedChildKeys: string[] = [];
  for (const link of rawLinks) {
    if (!link.inwardIssue?.key) continue;
    const typeName = (link.type?.name ?? '').toLowerCase();
    const inwardText = (link.type?.inward ?? '').toLowerCase();
    const isParentLink =
      typeName === 'parent' ||
      inwardText.includes('parent of') ||
      inwardText.includes('elternteil von');
    if (isParentLink) linkedChildKeys.push(link.inwardIssue.key);
  }

  return {
    id: raw.id,
    key: raw.key,
    url: getJiraIssueUrl(raw.key),
    summary: fields.summary,
    status: fields.status,
    issueType: fields.issuetype,
    assignee: fields.assignee,
    reporter: fields.reporter,
    priority: fields.priority,
    storyPoints,
    parentKey: fields.parent?.key ?? null,
    created: fields.created,
    updated: fields.updated,
    resolutionDate: fields.resolutiondate,
    testPhaseEnd,
    linkedChildKeys,
  };
}
