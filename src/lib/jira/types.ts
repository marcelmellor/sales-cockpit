// Subset of the JIRA Cloud REST API v3 fields we actually use. We intentionally
// type only what we read — JIRA returns a lot more, and pulling it all into
// types only makes refactors painful.

export type JiraUser = {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
};

export type JiraStatus = {
  id: string;
  name: string;
  statusCategory: {
    key: 'new' | 'indeterminate' | 'done' | string;
    name: string;
  };
};

export type JiraIssueType = {
  id: string;
  name: string;
  iconUrl?: string;
  hierarchyLevel?: number;
};

export type JiraPriority = {
  id: string;
  name: string;
  iconUrl?: string;
};

// Minimal issue shape — only the fields we expose.
export type JiraIssue = {
  id: string;
  key: string;
  url: string;
  summary: string;
  status: JiraStatus;
  issueType: JiraIssueType;
  assignee: JiraUser | null;
  reporter: JiraUser | null;
  priority: JiraPriority | null;
  storyPoints: number | null;
  parentKey: string | null;
  created: string;
  updated: string;
  resolutionDate: string | null;
  // sipgate-specific custom field "Ende der Testphase" (customfield_11758,
  // datepicker, scoped to project 11325 / SC). ISO date string `YYYY-MM-DD`
  // or null when not set. Used by the Projekte tab to compute project span.
  testPhaseEnd: string | null;
  // Keys von Issues, die per Issue-Link-Typ "Parent" (inward "is a parent of")
  // als Kinder dieses Issues markiert sind. Ergänzt das parent-Field, weil
  // im sipgate-SC-Projekt die Hierarchie überwiegend über Issue-Links statt
  // über das parent-Field abgebildet wird.
  linkedChildKeys: string[];
};

export type JiraEpicWithChildren = {
  epic: JiraIssue;
  children: JiraIssue[];
};

// Raw shapes returned by the REST API. Only the bits we actually parse.
export type JiraApiIssue = {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    status: JiraStatus;
    issuetype: JiraIssueType;
    assignee: JiraUser | null;
    reporter: JiraUser | null;
    priority: JiraPriority | null;
    created: string;
    updated: string;
    resolutiondate: string | null;
    parent?: { key: string };
    // Story points live on a custom field whose ID is portal-specific. JIRA
    // Cloud has been migrating to `customfield_10016`, but older portals use
    // `customfield_10026`. We probe both at the client layer.
    [customField: string]: unknown;
  };
};
