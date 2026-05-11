import { NextResponse } from 'next/server';
import { getJiraClient, JiraError } from '@/lib/jira/client';
import { isJiraIssueKey } from '@/lib/jira/parse';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ issueKey: string }> },
) {
  const { issueKey: rawKey } = await context.params;
  const issueKey = decodeURIComponent(rawKey).toUpperCase();

  if (!isJiraIssueKey(issueKey)) {
    return NextResponse.json(
      { error: `"${issueKey}" is not a valid JIRA issue key (expected PROJ-123 form).` },
      { status: 400 },
    );
  }

  try {
    const client = getJiraClient();
    const result = await client.getEpicWithChildren(issueKey);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof JiraError) {
      return NextResponse.json(
        { error: error.message, status: error.status, body: error.body },
        { status: error.status === 404 ? 404 : 502 },
      );
    }
    const message = error instanceof Error ? error.message : 'Unknown JIRA error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
