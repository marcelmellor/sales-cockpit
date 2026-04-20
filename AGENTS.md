# Agent Instructions

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

### Rate limits (known, not yet hardened)

The endpoint `/api/deals/overview` can hit HubSpot's `ten_secondly_rolling`
limit (~100 req/10s) because it fans out batch reads for deals,
associations, line items, and owners. We currently rely on the client
retrying on the next request. Hardening (concurrency cap, 429 backoff with
`Retry-After`, short-TTL caches on pipelines/owners) is a deferred task.
