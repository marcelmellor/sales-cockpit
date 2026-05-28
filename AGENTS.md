# Agent Instructions

## sipgate product model — suite with multiple entry points

sipgate is a **product suite**, not a single product. Customers can enter
through different products (PBX, AI Agents / Frontdesk, etc.) and then
add more products to their account.

Key distinction for analytics: **Signup ≠ Trial/Preview.**

- **Signup** (`Signup Atlantis` in Amplitude) = creating a sipgate account,
  with a `product` property indicating the entry point (`FRONTDESK`,
  `PBX`, etc.).
- **Trial / Preview** = activating a time-limited test of a specific
  product (e.g. AI Agents). This is a separate step that can happen
  *after* any signup type — a PBX customer can start an AI Agent preview
  just as well as someone who signed up directly for Agents.

This means `Signup Atlantis` with `product='FRONTDESK'` does **not**
equal "AI Agent Preview started". The preview/trial activation is tracked
elsewhere (PBX provisioning system), not as an Amplitude event. When
comparing funnel data, do not conflate the two.

## Git workflow — NO WORKTREES, EVER

**Absolute rule: all development happens in the main checkout at `/Users/mellor/Development/sales-cockpit` on the `main` branch. Never use a git worktree. Never create a feature branch.**

Why: the user's local dev server runs out of the main checkout. A worktree is a separate directory on disk with its own checkout — any file you edit there is invisible to the running app. Every time an agent works in a worktree, the user ends up looking at stale UI and wondering why fixes don't land. This has happened repeatedly. Do not let it happen again.

If a session starts and `pwd` is inside `.claude/worktrees/`:

1. Stop immediately. Do not run any task.
2. Tell the user to restart Claude Code from `/Users/mellor/Development/sales-cockpit` without worktree isolation.
3. End the session.

This is enforced by hooks in `.claude/settings.json`:
- `SessionStart` aborts with a policy message if cwd is a worktree.
- `PreToolUse` on Edit/Write/MultiEdit/NotebookEdit blocks file changes under `.claude/worktrees/`.

If a hook blocks you, the rule has been correctly applied — do not try to work around it.

Commit directly on `main`. No PR workflow, no feature branches, no long-running side branches. Small commits, often.

## HubSpot authentication — Private App Token in sipgate 2025 (27058496)

**TL;DR:** The app authenticates against HubSpot with a **Private App Token**
stored in `HUBSPOT_PRIVATE_APP_TOKEN` (`.env.local`). No OAuth, no refresh
flow, no Connected App install. The token is created by a HubSpot admin
(Phil) inside the sipgate 2025 HubSpot portal. That's it — everything below
is history, reasoning, and procedures so the next agent doesn't repeat the
painful path we took to get here.

### The two sipgate HubSpot accounts (do not confuse)

| Hub ID | Name | Role |
|---|---|---|
| `2610461` | sipgate GmbH | **HubSpot Developer portal** (legacy CRM data too, but not where our deals live). This is where the old `sales-canvas-auth` / `sales-canvas-clean` Projects apps are defined. |
| `27058496` | sipgate 2025 | **The real CRM.** The pipeline `3576006860` ("Sales sipgate Portfolio") and all current deals (e.g. `495181833409` "2.500 P24 - Anton Herzog") live here. This is the account the Private App Token is issued from. |

If you query HubSpot with the token and don't see the expected deal/pipeline,
you're almost certainly pointing at the wrong hub. Verify by calling
`/oauth/v1/access-tokens/{token}` (for OAuth tokens) or by reading a known
deal ID directly.

### The token

- **Env var:** `HUBSPOT_PRIVATE_APP_TOKEN`
- **Format:** `pat-eu1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- **Expiry:** None. Private App Tokens do not expire unless revoked.
- **Issued by:** a HubSpot admin in hub `27058496`. In practice: **Phil** at
  sipgate. `mellor@sipgate.de` does *not* have the "Private Apps" permission
  in that hub and cannot create or rotate the token himself.
- **Read path in code:** `src/lib/hubspot/client.ts` → `getAccessToken()`.
  There is no caching, no refresh, no retry on 401. Just send the token.

### Required scopes on the Private App

All of these must be checked when the token is created. Missing any of them
silently breaks parts of the pipeline view (see "fail-safe" note below).

- `crm.objects.deals.read`
- `crm.objects.deals.write`
- `crm.objects.contacts.read`
- `crm.objects.companies.read`
- `crm.objects.owners.read`
- `crm.objects.line_items.read`   *(needed for line-item batch read)*
- `crm.schemas.deals.read`
- `e-commerce`                    *(also needed for line-item batch read —
  `crm.objects.line_items.read` alone is not enough)*

### Ready-to-send message template for Phil

> Hey Phil, können wir für das Sales Cockpit einen Private App Token in unserem HubSpot (Account 27058496, "sipgate 2025") einrichten?
>
> Was ich brauche:
>
> 1. Settings → Integrations → **Private Apps** → *Create a private app*
> 2. Name: z.B. "Sales Cockpit"
> 3. Unter **Scopes** diese 8 aktivieren:
>    - `crm.objects.deals.read`
>    - `crm.objects.deals.write`
>    - `crm.objects.contacts.read`
>    - `crm.objects.companies.read`
>    - `crm.objects.owners.read`
>    - `crm.objects.line_items.read`
>    - `crm.schemas.deals.read`
>    - `e-commerce`
> 4. Create → den Access Token kopieren (beginnt mit `pat-eu1-…`)
>
> Schick mir den Token dann bitte verschlüsselt (z.B. per 1Password, signierte Nachricht o.ä.) zu. Ich trag ihn lokal in `.env.local` ein.

### Things that do NOT work — do not try them

These are dead ends we already walked. Do not suggest them to the user again.

1. **"Go to Settings → Private Apps in sipgate 2025 HubSpot and create a token yourself."**
   The user (`mellor@sipgate.de`) lacks the following permissions in hub
   `27058496`: *App Marketplace access*, *Products → Delete*, *Edit property
   settings*. The Private Apps screen refuses with "You don't have permission
   to access private apps". Only admins (Phil) can do this.

2. **"Install the HubSpot Projects app in the sipgate 2025 account."**
   The existing Connected App `sales-canvas-auth-Application` (App ID
   `29591037`, defined in the developer portal `2610461`, distribution
   `marketplace`) used to be reachable via the install URL
   `/connected-apps/27058496/installed/basic/29950502/overview` but blocks
   new installs with *"The app could not be installed because the app
   developer has not signed the acceptable use policy"* until the AUP is
   signed via the "Begin publishing your HubSpot app" wizard.

3. **"Change the app's distribution from `marketplace` to `private`."**
   HubSpot rejects this upload: *"You cannot change the app's distribution
   type from 'marketplace' to 'private'."* The distribution is immutable
   after the first deploy.

4. **"Create a new `distribution: private` HubSpot Projects app and install
   that in 27058496 instead."**
   Private-distribution apps cannot be installed in a production account
   they don't belong to — the target account appears grayed out with
   *"Dieser Account kommt nicht für die Installation in Frage"*. There was
   a short-lived `sales-cockpit-internal` project that tried this and was
   abandoned; its directory has been removed from the repo. If you see it
   reappear in a git history, know that it is a dead branch of the problem.

5. **Using OAuth refresh tokens (`HUBSPOT_REFRESH_TOKEN` + `HUBSPOT_CLIENT_ID`
   + `HUBSPOT_CLIENT_SECRET`).**
   The code used to support this but it's now removed. If the three env
   vars are present in someone's `.env.local` from an earlier setup, they
   are just noise — the client reads `HUBSPOT_PRIVATE_APP_TOKEN` only.
   Remove them to avoid confusion.

### The `sales-canvas-clean` project directory

`hubspot-app/sales-canvas-clean/` is still in the repo but is **dormant**.
It defines the old `sales-canvas-auth-Application` (App ID `29591037`,
marketplace distribution, AUP-signed, installed in `27058496`). We no
longer authenticate through it. Keep it around as reference — do not
delete without a cleanup commit and a note that the OAuth path is gone.

### Line-item scope — the specific failure mode we hit repeatedly

The AI Agent pipeline filters deals by line-item `category`. If the token
is missing either `crm.objects.line_items.read` or `e-commerce`:

- `getDealsWithAssociations` returns all deals (no problem).
- `/crm/v3/objects/line_items/batch/read` throws 403
  *"This app hasn't been granted all required scopes"*.
- Deals that have line items get silently dropped from the AI Agent view
  because the category filter returns empty strings.

`getLineItemCategoriesForDeals` is written fail-safe: when the batch read
fails, it *skips* affected deals from the returned map so the caller's
`!categories` branch treats them as "keep, unknown category" rather than
"drop". **Fix the scope — don't paper over this in code.**

### Rate limits

HubSpot enforces a per-second (~10 req/s) and a 10-secondly (~100 req/10s)
limit per Private App. On page load, `/api/deals/overview`,
`/api/leads/overview` and `/api/projects/overview` fire in parallel and each
fans out 4–8 batch reads, which used to blow past the secondly limit and
break the whole UI with 500s ("You have reached your secondly limit.").

`src/lib/hubspot/client.ts` now handles this at the transport layer:

- **Module-level semaphore** caps in-flight HubSpot requests at
  `MAX_CONCURRENT_HUBSPOT_REQUESTS = 4`. One Node process = one bucket,
  so this implicitly throttles all three overview endpoints together.
- **429 retry** in `HubSpotClient.request`: up to `MAX_429_RETRIES = 5`,
  honouring the `Retry-After` header (clamped to 10 s) with small jitter.
  The semaphore slot is held during the backoff so the queue
  back-pressures instead of stampeding on retry.

Do not paper over residual 429s in callers — fix the limits here. If
HubSpot pressure changes, tune the constants at the top of `client.ts`.

### Never fan out per deal — always batch

Rule: **any endpoint that processes a list of deals must use HubSpot's
batch endpoints, not a loop of per-deal calls**. HubSpot offers
`/crm/v4/associations/{from}/{to}/batch/read` for associations and
`/crm/v3/objects/{type}/batch/read` for object details — both take up to
100 inputs per call. A 150-deal pipeline should cost 2–4 HubSpot calls,
never 300.

Why this matters: per-deal fan-out at `BATCH_SIZE=4` with a 300 ms pause
is ~28 req/s — 3× the 10 req/s limit. Rate-limited calls return 429 and
get `try/catch`'d to `null`, indistinguishable from "no result". That
null then lands in the `pipeline-cache-*` localStorage entry and sticks
around — refresh doesn't help because the next fetch hits the same
ceiling. This bit us on the meetings endpoint (deal 497714974930 "Taxi
Höhne" showing no next appointment despite having one). Fix:
`HubSpotClient.getMeetingsForDeals(dealIds)` — 2 batch calls total,
independent of pipeline size.

Checklist when writing a new endpoint that touches N deals:

1. Is there a `/batch/read` endpoint for what you need? Use it.
2. Do not swallow API errors into `null`. At minimum log + rethrow so the
   request fails loudly; the client can retry the whole query.
3. Never persist an error-derived `null` into the localStorage cache.
   Only cache responses from successful, complete fetches.

### Lead ↔ Deal association is one-directional

HubSpot in `27058496` only stores the association in the `leads → deals`
direction (typically with type `Primary`, typeId 582). The reverse call
`/crm/v4/associations/deals/leads/batch/read` returns
`NO_ASSOCIATIONS_FOUND` for every deal — even ones that clearly came
from a lead. Endpoints that need to join a deal to its originating lead
must fetch `leads → deals` for the lead set and invert the map locally;
see `getLeadsWithAssociations` and `LeadOverviewItem.associatedDealIds`.

## Server-side response cache (Netlify Blobs)

To keep HubSpot quota usage flat regardless of how many users hit the
app, the five HubSpot-backed overview endpoints write their aggregated
response into a shared, server-side TTL cache before returning it to the
client. The browser still keeps its own `localStorage` cache (see
`src/lib/pipeline-cache.ts`) on top — the server cache exists for
*cross-user* and *cross-tab* hits, not for replacing the browser cache.

### Cached endpoints

| Route | Cache key | TTL |
|---|---|---|
| `GET /api/deals/overview` | `deals-overview:<pipelineId>:<produkt>` | 5 min |
| `GET /api/leads/overview` | `leads-overview:<produkt>` | 5 min |
| `GET /api/projects/overview` | `projects-overview:<produkt>` | 5 min |
| `GET /api/deals/overview/meetings` | `deal-meetings:<sha1(dealIds)>` | 5 min |
| `GET /api/deals/overview/stage-history` | `deal-stage-history:<sha1(dealIds)>` | 5 min |

Each response now includes a `cache: { hit, cachedAt, ageMs, ttlSeconds }`
field next to `data` so the client can tell stale-from-cache apart from
fresh-from-HubSpot.

### Storage backend

`src/lib/server-cache.ts` picks the backend at runtime:

- **Production (Netlify Functions, `NETLIFY=true`):** `@netlify/blobs`
  store named `hubspot-cache`. Provisioned automatically by the
  `@netlify/plugin-nextjs` runtime — no setup, no env vars.
- **Local dev (`next dev`, no Netlify context):** file-system fallback
  in `.cache/blobs/` (gitignored). Without this fallback, `getStore()`
  would throw because there are no Netlify credentials in the dev
  process. We do not require `netlify dev` because the project's
  `scripts/dev-prep.sh` runs `next dev` directly.

Read/write errors are logged and swallowed — a broken cache must never
break the request path. A cache miss simply re-fetches from HubSpot.

### Bypass for user-initiated refresh

Every cached endpoint accepts `?refresh=1`, which skips the read step
and forces a fresh fetch (the result is still written back to the
cache). The frontend wires this through the dashboard's refresh button:

- `src/app/page.tsx` keeps a `pendingServerRefresh` ref keyed by
  endpoint (`overview` / `leads` / `projects` / `meetings` /
  `stageHistory`).
- `handleRefresh()` sets all five to `true`, then invalidates the
  matching React Query queries.
- Each `queryFn` reads its flag via `takeRefreshFlag(key)` and resets
  it after consuming it. Background refetches (window focus, network
  reconnect, etc.) therefore never set `?refresh=1` and continue to hit
  the server cache as intended.

If you add a new HubSpot-backed endpoint, wrap it with `getOrFetch()`
and — if the dashboard's refresh button should bust it — extend the
`pendingServerRefresh` map and pass the flag into the `queryFn`'s
fetch URL.

### When to remove this layer

This is a stopgap until the planned BigQuery replication is online.
Once HubSpot data flows into BigQuery and the API routes read from
there, both this cache and `src/lib/pipeline-cache.ts` can go. Swap the
`fetcher` argument to `getOrFetch()` for a BigQuery query (or remove
the wrapper entirely if BQ is already fast enough) and delete the
browser-side counterpart.

## JIRA authentication — sipgate Atlassian Cloud (sipgatede.atlassian.net)

**TL;DR:** The app reads JIRA via a personal **Atlassian Cloud API token**,
sent as HTTP Basic Auth (`email:token`, base64). Three env vars in
`.env.local`:

```
JIRA_BASE_URL=https://sipgatede.atlassian.net
JIRA_EMAIL=<the sipgate mail you log into JIRA with>
JIRA_API_TOKEN=<the token from id.atlassian.com>
```

Read-only — Phase 1 does not write to JIRA.

### Where the token comes from

Create at https://id.atlassian.com/manage-profile/security/api-tokens.
**Use the left button "Create API token"**, NOT the right one ("Create API
token with scopes"). The scoped variant is OAuth-2.0-flavored and would
require a different auth mechanism (Bearer against
`api.atlassian.com/ex/jira/{cloudId}/...` instead of Basic against the
tenant URL). Both token types share the `ATATT3xFf…=CHECKSUM` shape, so
you cannot tell them apart from the value alone — only by which button
was clicked. If `/rest/api/3/myself` returns 401 with "Client must be
authenticated" despite a freshly minted token, you almost certainly used
the wrong button. Revoke and recreate.

### Where JIRA is linked to a deal

HubSpot deal property: **`jira_story`** (label "Jira Story", description
"CS Agents (Nils)"). Single-line URL field. The URL format varies — we
have seen all of:

- `https://sipgatede.atlassian.net/browse/PDH-322`
- `https://sipgatede.atlassian.net/browse/SC-12?atlOrigin=…`
- `https://sipgatede.atlassian.net/jira/core/projects/SC/board?selectedIssue=SC-4`

Project keys are not constrained to one project (`SC`, `PDH`, …). Use
`extractJiraIssueKey()` from `src/lib/jira/parse.ts` — it handles all
three shapes plus bare keys.

The HubSpot field is also misnamed: despite "story", it can point at any
issue type. SC-167 for example is a Developer Task, not an Epic. Code
that consumes it must not assume hierarchy — `getEpicChildren` simply
returns an empty array when the issue has no children, which is the
correct read for a non-epic issue.

### What the client offers (`src/lib/jira/client.ts`)

- `getIssue(key)` — single issue projected onto a minimal `JiraIssue`
  shape (summary, status, assignee, story points, parent, timestamps).
- `getEpicChildren(key)` — JQL `parent = "<key>"` paginated via the new
  `/rest/api/3/search/jql` POST endpoint. Returns an array.
- `getEpicWithChildren(key)` — convenience wrapper that fans both calls
  out in parallel.
- `getIssuesByKeys(keys)` — JQL `key in (...)` batch, chunked at 100.
- `getChildrenForParents(keys)` — JQL `parent in (...)` batch, returns a
  `Map<parentKey, JiraIssue[]>`.

### Sub-Task hierarchy: parent-field vs. issue-links

In the sipgate SC project, child issues are almost always linked to their
parent via a JIRA **issue-link of type "Parent"** (inward "is a parent of"),
not via the `parent` field. Concrete example: SC-53 (DER SPIEGEL) has
SC-60 and SC-61 as children — both linked exclusively via issue-links,
their `parent` field is empty.

That means `getChildrenForParents()` alone is not enough — it only finds
parent-field children. The full picture requires also reading `issuelinks`
from the parent issue (now part of `ISSUE_FIELDS`) and extracting all
inward "is a parent of" links. `JiraIssue.linkedChildKeys` carries those
keys. The `/api/projects/overview` route merges both sources to compute
the sub-task dot counts.

Filter on `type.name === 'Parent'` OR `type.inward` containing "parent of"
(robust against German localisation). Other link types ("blocks",
"relates to", …) must NOT be treated as parent-child.

We use the **new** `/rest/api/3/search/jql` endpoint, not the deprecated
`GET /rest/api/3/search`. Pagination is via `nextPageToken`, with a
50-iteration safety cap (5000 child issues per epic).

### Story points custom field

JIRA story-point custom field IDs vary per portal. The client probes
`customfield_10016` → `customfield_10026` → `customfield_10004` in
order and uses the first one that has a numeric value. sipgate's portal
uses `customfield_10016` at the time of writing.

### API routes

- `GET /api/jira/issue/<KEY>` — `JiraIssue`.
- `GET /api/jira/epic/<KEY>` — `{ epic: JiraIssue, children: JiraIssue[] }`.
- `GET /api/projects/overview?produkt=frontdesk` — feeds the **Projekte**
  tab in the UI. Walks all frontdesk-deals with `jira_story`, resolves
  each to a JIRA issue, plus children (via parent-field AND issue-links).

  Each `ProjectOverviewItem` carries a `dateSource`:
  - `jira-test-phase` — JIRA `customfield_11758` ("Ende der Testphase")
    is set; bar runs `end - 27d` to `end`.
  - `deal-won-fallback` — JIRA date is missing but the HubSpot deal is
    won; bar runs from `closedate` to `closedate + 27d`. Rendered hatched
    in the UI to signal the missing JIRA data.

  Deals where neither anchor is available end up in `unscheduledCount`.

The first two routes validate the key with `isJiraIssueKey()` and return
400 on garbage, 404 if JIRA returns 404, 502 on other JIRA errors.
