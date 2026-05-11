// Issue keys look like `PROJ-123` — uppercase project prefix, dash, number.
// Project prefixes can be 2+ characters (SC, PDH, …); we don't constrain
// length. Anchored exact-match for use against a clean key.
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/;

// Same shape, unanchored, for extraction from URLs / free text.
const ISSUE_KEY_GLOBAL_RE = /[A-Z][A-Z0-9_]+-\d+/g;

export function isJiraIssueKey(value: string): boolean {
  return ISSUE_KEY_RE.test(value);
}

/**
 * Pulls the JIRA issue key out of any of the URL formats we see on HubSpot
 * deals. Returns `null` when no key is present.
 *
 * Accepts:
 *   - bare keys, e.g. `SC-123`
 *   - `https://*.atlassian.net/browse/SC-123`
 *   - `https://*.atlassian.net/browse/SC-123?atlOrigin=…`
 *   - `https://*.atlassian.net/jira/core/projects/SC/board?selectedIssue=SC-4`
 *   - any URL with `?selectedIssue=PROJ-NN` in the query string
 *
 * When a URL contains both a `selectedIssue` param and a path-encoded key
 * (rare), the path key wins — that matches user expectation when they paste
 * a board link with a different issue selected.
 */
export function extractJiraIssueKey(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (isJiraIssueKey(trimmed)) return trimmed;

  // Try as URL first — that's the dominant case in HubSpot.
  let url: URL | null = null;
  try {
    url = new URL(trimmed);
  } catch {
    url = null;
  }

  if (url) {
    // /browse/<KEY> — strip query/hash, take the segment after `/browse/`.
    const browseMatch = url.pathname.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/i);
    if (browseMatch) return browseMatch[1].toUpperCase();

    // ?selectedIssue=<KEY>
    const selected = url.searchParams.get('selectedIssue');
    if (selected && isJiraIssueKey(selected.toUpperCase())) {
      return selected.toUpperCase();
    }
  }

  // Last-resort: pick the first issue-key-looking token from the string.
  const matches = trimmed.toUpperCase().match(ISSUE_KEY_GLOBAL_RE);
  if (matches && matches.length > 0) return matches[0];

  return null;
}
