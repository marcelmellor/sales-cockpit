import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { getJiraClient, JiraError } from '@/lib/jira/client';
import { extractJiraIssueKey } from '@/lib/jira/parse';
import { isWonStageLabel, isLostStageLabel } from '@/lib/hubspot/mrr';

// Length of a project in days. The project is anchored to its end date
// (JIRA "Ende der Testphase") and runs for 4 weeks before that — so
// `start = end - 27 days` (inclusive on both ends → 28 calendar days).
const PROJECT_LENGTH_DAYS = 28;

const SALES_PIPELINE_ID = '3576006860';

// Woher kommt das Datum eines Projekt-Balkens?
// - jira-test-phase: JIRA-Custom-Field "Ende der Testphase" ist gesetzt — der
//   verbindliche Fall.
// - deal-won-fallback: JIRA-Feld leer, aber der HubSpot-Deal ist gewonnen,
//   also leiten wir den 4-Wochen-Block aus dem Won-Datum ab. Das ist eine
//   Annahme, die im Frontend schraffiert dargestellt wird, damit klar ist:
//   im JIRA fehlt das Datum.
export type ProjectDateSource = 'jira-test-phase' | 'deal-won-fallback';

export interface ProjectOverviewItem {
  dealId: string;
  dealName: string;
  hubspotUrl: string;
  companyName: string;
  jiraKey: string;
  jiraUrl: string;
  jiraSummary: string;
  jiraStatus: string;
  jiraIssueType: string;
  // Geplantes Ende der Testphase (ISO `YYYY-MM-DD`, end inclusive). Bei
  // `dateSource='jira-test-phase'` aus JIRA `customfield_11758`, sonst
  // abgeleitet aus dem Won-Datum + 27d. Der grüne Balken endet hier.
  endDate: string;
  startDate: string;
  // Tatsächliches Ende, wenn das JIRA-Issue resolved ist (Status
  // "Abgeschlossen" / "Kunde verloren" → JIRA setzt `resolutiondate`).
  // Wenn gesetzt, läuft der Balken nur bis hierher und ist grau (Projekt
  // beendet). null, solange das Projekt offen ist.
  actualEndDate: string | null;
  dateSource: ProjectDateSource;
  // HubSpot-Deal-Stage Label (z.B. "Closed lost", "Closed won",
  // "In Implementation"). Wird im Frontend für die Filter-Badge
  // "Gewonnen/Offene Deals" benutzt.
  dealStage: string;
  // Convenience flag: ist der HubSpot-Deal Closed Lost?
  dealIsLost: boolean;
  // Convenience flag: ist das JIRA-Issue abgeschlossen oder Kunde verloren?
  // Im Code identisch zur Frontend-`isCompleted`-Logik, aber serverseitig
  // berechnet, damit die Filter konsistent zählen.
  projectIsClosed: boolean;
  // Aggregierte Sub-Task-Counts (alle direkten Children des Customer-Journey-
  // Issues). Frontend rendert die als Punkte zwischen Firmenname und JIRA-Link.
  childTasks: {
    open: number;
    done: number;
  };
}

export interface ProjectsOverviewResponse {
  projects: ProjectOverviewItem[];
  // Issues we found a HubSpot deal for, but neither JIRA nor the deal won-date
  // gave us a usable anchor. Useful for the UI to surface "X Deals haben kein
  // Datum, das wir verwenden können".
  unscheduledCount: number;
}

function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tvSecret = searchParams.get('tvSecret');
    const isValidTvSecret = tvSecret && process.env.TV_SECRET && tvSecret === process.env.TV_SECRET;

    if (!isValidTvSecret) {
      const session = await getSession();
      if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Phase 1 is AI-Agents-only — keep the route product-aware so we can lift
    // this restriction later without an API break.
    const produkt = searchParams.get('produkt') ?? 'frontdesk';
    if (produkt !== 'frontdesk') {
      return NextResponse.json(
        { error: 'Projects view is currently only available for AI Agents (produkt=frontdesk).' },
        { status: 400 },
      );
    }

    const hubspot = getHubSpotClient();

    // Pipeline-Stages für den Won-Stage-Lookup (Fallback, wenn JIRA kein
    // "Ende der Testphase" hat — dann nutzen wir das Deal-Won-Datum).
    const pipelines = await hubspot.getPipelines();
    const pipeline = pipelines.results.find((p) => p.id === SALES_PIPELINE_ID);
    const stageLabelById = new Map<string, string>();
    for (const stage of pipeline?.stages ?? []) {
      stageLabelById.set(stage.id, stage.label);
    }

    const dealsWithAssociations = await hubspot.getDealsWithAssociations(
      SALES_PIPELINE_ID,
      produkt,
    );

    // We only care about deals that already point at a JIRA issue.
    const dealsWithJira = dealsWithAssociations.results
      .map((deal) => ({
        deal,
        jiraKey: extractJiraIssueKey(deal.properties.jira_story ?? null),
      }))
      .filter((entry): entry is { deal: typeof entry.deal; jiraKey: string } => !!entry.jiraKey);

    if (dealsWithJira.length === 0) {
      const empty: ProjectsOverviewResponse = { projects: [], unscheduledCount: 0 };
      return NextResponse.json({ data: empty });
    }

    // Resolve company names. Same pattern as /api/deals/overview, but kept
    // intentionally simpler (no sipgate-account-mastersipid fallback) — the
    // Projekte tab only shows already-active projects, so the noisier company
    // disambiguation logic isn't needed.
    const companyIds = new Set<string>();
    for (const { deal } of dealsWithJira) {
      const companyAssoc = deal.associations?.companies?.results?.[0];
      if (companyAssoc) companyIds.add(companyAssoc.id);
    }

    const companiesMap = new Map<string, { name: string }>();
    if (companyIds.size > 0) {
      const companies = await hubspot.getCompanies(Array.from(companyIds));
      for (const company of companies.results) {
        companiesMap.set(company.id, { name: company.properties.name || 'Unknown' });
      }
    }

    // Fetch all linked JIRA issues in one batch, plus their direct children
    // (Sub-Tasks). Children kommen aus zwei Quellen:
    //  - Klassisches `parent`-Field (JQL `parent in (...)`).
    //  - Issue-Links vom Typ „Parent" (im SC-Projekt der dominante Weg).
    // Beide Quellen werden gemerged.
    const jiraClient = getJiraClient();
    const issueKeys = dealsWithJira.map((e) => e.jiraKey);
    const [issues, childrenViaParentField] = await Promise.all([
      jiraClient.getIssuesByKeys(issueKeys),
      jiraClient.getChildrenForParents(issueKeys),
    ]);
    const issuesByKey = new Map(issues.map((issue) => [issue.key, issue]));

    // Issue-Link-Children: aus dem geladenen Parent-Issue selbst (linkedChildKeys)
    // ergeben sich die child-keys. Diese laden wir gesammelt nach und mappen sie
    // zurück auf den jeweiligen Parent.
    const linkChildKeyToParent = new Map<string, string>();
    for (const parent of issues) {
      for (const childKey of parent.linkedChildKeys) {
        // Erst-Eintrag gewinnt, falls ein Kind doppelt referenziert wäre.
        if (!linkChildKeyToParent.has(childKey)) {
          linkChildKeyToParent.set(childKey, parent.key);
        }
      }
    }
    const allLinkChildKeys = Array.from(linkChildKeyToParent.keys());
    const linkChildIssues = allLinkChildKeys.length > 0
      ? await jiraClient.getIssuesByKeys(allLinkChildKeys)
      : [];

    // Final: parent-key → JiraIssue[] (deduped per child-key, beide Quellen)
    const childrenByParent = new Map<string, typeof linkChildIssues>();
    for (const [parentKey, children] of childrenViaParentField.entries()) {
      childrenByParent.set(parentKey, [...children]);
    }
    for (const child of linkChildIssues) {
      const parentKey = linkChildKeyToParent.get(child.key);
      if (!parentKey) continue;
      const list = childrenByParent.get(parentKey) ?? [];
      if (!list.some((c) => c.key === child.key)) {
        list.push(child);
      }
      childrenByParent.set(parentKey, list);
    }

    const projects: ProjectOverviewItem[] = [];
    let unscheduledCount = 0;

    for (const { deal, jiraKey } of dealsWithJira) {
      const issue = issuesByKey.get(jiraKey);
      if (!issue) {
        // Linked issue missing or inaccessible — count, but don't fail the whole response.
        unscheduledCount += 1;
        continue;
      }

      // Anker bestimmen: bevorzugt JIRA "Ende der Testphase". Fallback: wenn
      // der Deal gewonnen ist, nehmen wir das Won-Datum als Projektstart und
      // setzen Ende auf +27d. So fällt der Balken trotzdem in die Wochen-
      // ansicht — schraffiert, damit klar ist, dass das JIRA-Datum fehlt.
      let startDate: string;
      let endDate: string;
      let dateSource: ProjectDateSource;

      if (issue.testPhaseEnd) {
        endDate = issue.testPhaseEnd;
        startDate = shiftIsoDate(endDate, -(PROJECT_LENGTH_DAYS - 1));
        dateSource = 'jira-test-phase';
      } else {
        const closedateRaw = deal.properties.closedate;
        const stageLabel = stageLabelById.get(deal.properties.dealstage ?? '') ?? '';
        const isWon = isWonStageLabel(stageLabel);
        if (!closedateRaw || !isWon) {
          unscheduledCount += 1;
          continue;
        }
        // closedate kommt als ISO-Timestamp (`2026-04-29T11:33:59.867Z`).
        // Wir nehmen den Datumsteil — der Won-Tag ist die Konvention für den
        // Beginn der 4-wöchigen Implementation/Testphase.
        const closeDay = closedateRaw.slice(0, 10);
        startDate = closeDay;
        endDate = shiftIsoDate(closeDay, PROJECT_LENGTH_DAYS - 1);
        dateSource = 'deal-won-fallback';
      }

      const companyId = deal.associations?.companies?.results?.[0]?.id;
      const companyName =
        (companyId ? companiesMap.get(companyId)?.name : undefined) ||
        deal.properties.dealname ||
        'Unknown';

      // resolutiondate kommt als ISO-Timestamp; wir nehmen den Datumsteil.
      const actualEndDate = issue.resolutionDate ? issue.resolutionDate.slice(0, 10) : null;

      // Flags für die Frontend-Filter-Badges berechnen wir serverseitig, damit
      // UI und API dieselbe Klassifizierung verwenden.
      const dealStageLabel = stageLabelById.get(deal.properties.dealstage ?? '') ?? '';
      const dealIsLost = isLostStageLabel(dealStageLabel);
      const jiraStatusLower = issue.status.name.toLowerCase();
      const projectIsClosed =
        !!issue.resolutionDate ||
        jiraStatusLower.includes('fertig') ||
        jiraStatusLower.includes('done') ||
        jiraStatusLower.includes('closed') ||
        jiraStatusLower.includes('abgeschlossen') ||
        jiraStatusLower.includes('kunde verloren');

      // Sub-Tasks (Children) auszählen — "done" wenn JIRA Status-Kategorie
      // "done" liefert (deckt "Fertig", "Abgeschlossen", "Done" usw. ab) oder
      // resolutiondate gesetzt ist; sonst "open".
      const childIssues = childrenByParent.get(issue.key) ?? [];
      let childOpen = 0;
      let childDone = 0;
      for (const c of childIssues) {
        const done = c.resolutionDate || c.status.statusCategory?.key === 'done';
        if (done) childDone += 1;
        else childOpen += 1;
      }

      projects.push({
        dealId: deal.id,
        dealName: deal.properties.dealname || 'Unknown',
        hubspotUrl: `https://app.hubspot.com/contacts/27058496/record/0-3/${deal.id}`,
        companyName,
        jiraKey: issue.key,
        jiraUrl: issue.url,
        jiraSummary: issue.summary,
        jiraStatus: issue.status.name,
        jiraIssueType: issue.issueType.name,
        endDate,
        startDate,
        actualEndDate,
        dateSource,
        dealStage: dealStageLabel,
        dealIsLost,
        projectIsClosed,
        childTasks: { open: childOpen, done: childDone },
      });
    }

    // Sort by start date so the UI gets a stable, chronologically meaningful order.
    projects.sort((a, b) => a.startDate.localeCompare(b.startDate));

    const response: ProjectsOverviewResponse = { projects, unscheduledCount };
    return NextResponse.json({ data: response });
  } catch (error) {
    if (error instanceof JiraError) {
      return NextResponse.json(
        { error: error.message, status: error.status },
        { status: 502 },
      );
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
