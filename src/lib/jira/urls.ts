function getBaseUrl(): string {
  const base = process.env.JIRA_BASE_URL;
  if (!base) {
    throw new Error('JIRA_BASE_URL is not set. See AGENTS.md → "JIRA authentication".');
  }
  return base.replace(/\/+$/, '');
}

export function getJiraIssueUrl(issueKey: string): string {
  return `${getBaseUrl()}/browse/${encodeURIComponent(issueKey)}`;
}
