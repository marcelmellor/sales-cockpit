'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, ExternalLink } from 'lucide-react';
import type {
  ProjectsOverviewResponse,
  ProjectOverviewItem,
} from '@/app/api/projects/overview/route';

// Wochenansicht für AI-Agent-Projekte. Jeder JIRA-Issue mit gesetztem
// "Ende der Testphase" wird als 4-Wochen-Balken über die Wochen verteilt.
// Über jeder Woche steht die Anzahl der gerade laufenden Projekte.

const WEEKS_BEFORE = 1;  // letzte Woche zum Kontext
const WEEKS_AFTER = 10;  // ~2,5 Monate Ausblick
const TOTAL_WEEKS = WEEKS_BEFORE + 1 + WEEKS_AFTER;

const COMPANY_COL_WIDTH = 220; // px
const WEEK_MIN_WIDTH = 88;     // px

type Week = {
  weekNumber: number;
  year: number;
  start: Date; // Montag, 00:00 lokal
  end: Date;   // Sonntag, 23:59:59.999 lokal
  isCurrent: boolean;
};

function getIsoWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

function startOfIsoWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay() || 7;
  if (day !== 1) d.setDate(d.getDate() - (day - 1));
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function buildWeeks(now: Date): Week[] {
  const currentMonday = startOfIsoWeek(now);
  const firstMonday = addDays(currentMonday, -7 * WEEKS_BEFORE);
  const weeks: Week[] = [];
  for (let i = 0; i < TOTAL_WEEKS; i++) {
    const start = addDays(firstMonday, i * 7);
    const end = addDays(start, 7);
    end.setMilliseconds(end.getMilliseconds() - 1);
    const { week, year } = getIsoWeek(start);
    weeks.push({
      weekNumber: week,
      year,
      start,
      end,
      isCurrent: start.getTime() === currentMonday.getTime(),
    });
  }
  return weeks;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDeDate(date: Date): string {
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

// Effektives Bar-Ende. Drei Modi:
//  - completed: Issue im JIRA resolved → Balken endet am resolution-Tag.
//  - overdue: Testphase-Ende liegt in der Vergangenheit, Issue aber nicht
//    resolved → Balken läuft bis HEUTE.
//  - active: Testphase-Ende in der Zukunft → Balken endet dort.
function endOfCurrentIsoWeek(now: Date): Date {
  const start = startOfIsoWeek(now);
  const end = addDays(start, 7);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return end;
}

// Effektives Ende des Balkens:
//  - resolved (actualEndDate) → fix bis dorthin.
//  - sonst offen → Balken läuft mindestens bis ans Ende der aktuellen
//    Kalenderwoche. Liegt das geplante Ende dahinter, gilt das geplante
//    Ende. So sieht man bei laufenden Projekten immer einen Balken, der
//    bis in die aktuelle Woche reicht — auch wenn das geplante Test-Ende
//    schon abgelaufen ist.
function effectiveBarEnd(project: ProjectOverviewItem, now: Date): Date {
  if (project.actualEndDate) {
    const d = parseIsoDate(project.actualEndDate);
    d.setHours(23, 59, 59, 999);
    return d;
  }
  const planned = parseIsoDate(project.endDate);
  planned.setHours(23, 59, 59, 999);
  const weekEnd = endOfCurrentIsoWeek(now);
  return planned.getTime() < weekEnd.getTime() ? weekEnd : planned;
}

function isProjectActiveInWeek(project: ProjectOverviewItem, week: Week, now: Date): boolean {
  const projStart = parseIsoDate(project.startDate);
  const projEnd = effectiveBarEnd(project, now);
  return projStart.getTime() <= week.end.getTime() && projEnd.getTime() >= week.start.getTime();
}

type Props = {
  data: ProjectsOverviewResponse | undefined;
  isLoading: boolean;
};

export function ProjectsView({ data, isLoading }: Props) {
  const now = useMemo(() => new Date(), []);
  const weeks = useMemo(() => buildWeeks(now), [now]);

  // Filter-Badges. Beide standardmäßig aktiv: das ist der "was läuft gerade"-
  // Default. Wenn der User die Badges deaktiviert, fließen Lost-Deals bzw.
  // abgeschlossene Projekte mit ein.
  const [filterWonOpenDeals, setFilterWonOpenDeals] = useState(true);
  const [filterOpenProjects, setFilterOpenProjects] = useState(true);

  const allProjects = useMemo(() => data?.projects ?? [], [data]);

  const filteredProjects = useMemo(() => {
    return allProjects.filter((p) => {
      // "Gewonnen / Offene Deals" schließt sowohl Lost-Deals als auch reine
      // Negotiation-Projektionen aus — letztere sind noch keine Verbindlichkeit.
      if (filterWonOpenDeals && (p.dealIsLost || p.dateSource === 'negotiation-projected')) {
        return false;
      }
      if (filterOpenProjects && p.projectIsClosed) return false;
      return true;
    });
  }, [allProjects, filterWonOpenDeals, filterOpenProjects]);

  const visibleProjects = useMemo(() => {
    if (filteredProjects.length === 0) return [];
    const firstWeekStart = weeks[0].start;
    const lastWeekEnd = weeks[weeks.length - 1].end;
    return filteredProjects.filter((p) => {
      const start = parseIsoDate(p.startDate);
      const end = effectiveBarEnd(p, now);
      return start.getTime() <= lastWeekEnd.getTime() && end.getTime() >= firstWeekStart.getTime();
    });
  }, [filteredProjects, weeks, now]);

  const countsByWeek = useMemo(
    () => weeks.map((week) => visibleProjects.filter((p) => isProjectActiveInWeek(p, week, now)).length),
    [weeks, visibleProjects, now],
  );

  // Counts pro Badge — als kleine Zahl neben dem Label.
  const wonOpenDealsCount = useMemo(
    () => allProjects.filter((p) => !p.dealIsLost && p.dateSource !== 'negotiation-projected').length,
    [allProjects],
  );
  const openProjectsCount = useMemo(
    () => allProjects.filter((p) => !p.projectIsClosed).length,
    [allProjects],
  );

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Projekte werden geladen…
      </div>
    );
  }

  const filterBar = (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 text-xs">
      <span className="text-gray-400 uppercase tracking-wide mr-1">Filter</span>
      <FilterBadge
        active={filterWonOpenDeals}
        onClick={() => setFilterWonOpenDeals((v) => !v)}
        label="Gewonnen / Offene Deals"
        count={wonOpenDealsCount}
        totalCount={allProjects.length}
      />
      <FilterBadge
        active={filterOpenProjects}
        onClick={() => setFilterOpenProjects((v) => !v)}
        label="Offene Projekte"
        count={openProjectsCount}
        totalCount={allProjects.length}
      />
    </div>
  );

  if (visibleProjects.length === 0) {
    return (
      <>
        {filterBar}
        <div className="py-12 text-center text-gray-400 text-sm">
          Keine AI-Agent-Projekte im sichtbaren Zeitraum.
          {data && data.unscheduledCount > 0 && (
            <div className="mt-2 text-xs text-gray-400">
              {data.unscheduledCount} Deal{data.unscheduledCount === 1 ? '' : 's'} ohne nutzbares Datum
              (weder &bdquo;Ende der Testphase&ldquo; im JIRA noch Won-Datum).
            </div>
          )}
        </div>
      </>
    );
  }

  // Layout: zwei Spalten — links Firmenname (fixed width), rechts Wochen-Track
  // (flex-1 mit eigenem inneren Grid). Diese Trennung macht das Bar-Overlay
  // einfach: das Bar liegt absolut über dem Wochen-Track, links/breite per
  // Prozent von der Track-Breite.
  const totalWeeks = weeks.length;

  return (
    <div>
      {filterBar}
      <div className="overflow-x-auto">
        <div className="min-w-max">
        {/* Header */}
        <div className="flex border-b border-gray-200 sticky top-0 bg-white z-10">
          <div
            className="flex-shrink-0 px-3 py-2 text-xs font-medium text-gray-500"
            style={{ width: COMPANY_COL_WIDTH }}
          >
            {visibleProjects.length} Projekt{visibleProjects.length === 1 ? '' : 'e'}
          </div>
          <div
            className="grid flex-1"
            style={{
              gridTemplateColumns: `repeat(${totalWeeks}, minmax(${WEEK_MIN_WIDTH}px, 1fr))`,
            }}
          >
            {weeks.map((week, idx) => {
              const count = countsByWeek[idx];
              return (
                <div
                  key={`${week.year}-W${week.weekNumber}`}
                  className={`px-2 py-2 text-center border-l border-gray-100 ${
                    week.isCurrent ? 'bg-amber-50' : ''
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-wide text-gray-400">
                    KW {week.weekNumber}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    {formatDeDate(week.start)}
                  </div>
                  <div
                    className={`mt-1 text-sm font-semibold ${
                      count > 0 ? 'text-gray-900' : 'text-gray-300'
                    }`}
                  >
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Zeilen */}
        {visibleProjects.map((project) => {
          // Tag-genaue Bar-Position auf dem Wochen-Track. Wir rechnen in
          // Millisekunden gegen `trackStart`/`trackEnd` und clampen an die
          // sichtbare Range.
          const trackStartMs = weeks[0].start.getTime();
          const trackEndMs = weeks[weeks.length - 1].end.getTime() + 1;
          const trackSpanMs = trackEndMs - trackStartMs;
          const pct = (date: Date): number => {
            const ms = date.getTime() - trackStartMs;
            return Math.max(0, Math.min(100, (ms / trackSpanMs) * 100));
          };

          const projStart = parseIsoDate(project.startDate);
          const plannedEnd = parseIsoDate(project.endDate);
          plannedEnd.setHours(23, 59, 59, 999);
          const barEnd = effectiveBarEnd(project, now);

          const isCompleted = !!project.actualEndDate;
          const isInferred = project.dateSource === 'deal-won-fallback';
          const isOverdue = !isCompleted && plannedEnd.getTime() < now.getTime();

          // Sub-Balken. Drei Kinds:
          //   normal    = alles, was nicht akut überfällig oder bloß
          //               projektiert ist (gelb).
          //   late      = offen, plannedEnd liegt in der Vergangenheit, ab
          //               plannedEnd bis ans Ende der aktuellen Woche (rot).
          //   projected = potenzielles Projekt aus einem Negotiation-Deal,
          //               start = heute (grau).
          // Schraffur ist orthogonal: gilt für alle Segmente, wenn das Datum
          // aus dem Won-Fallback abgeleitet ist (`isInferred`) UND das
          // Projekt noch nicht abgeschlossen ist.
          const segments: Array<{
            left: number;
            width: number;
            kind: 'normal' | 'late' | 'projected';
          }> = [];
          const isProjected = project.dateSource === 'negotiation-projected';
          const hatched = isInferred && !isCompleted;

          if (isProjected) {
            // Potenzielles Projekt aus Negotiation-Deal: kompletter Balken grau.
            const left = pct(projStart);
            const right = pct(barEnd);
            if (right > left) segments.push({ left, width: right - left, kind: 'projected' });
          } else if (isCompleted) {
            // Resolved → Balken bis zum tatsächlichen Ende.
            const left = pct(projStart);
            const right = pct(barEnd);
            if (right > left) segments.push({ left, width: right - left, kind: 'normal' });
          } else if (isOverdue) {
            // Offen + überfällig: normaler Bereich bis plannedEnd, danach
            // roter Late-Bereich bis ans Ende der aktuellen Woche.
            const lStart = pct(projStart);
            const lPlanned = pct(plannedEnd);
            const lEnd = pct(barEnd);
            if (lPlanned > lStart) segments.push({ left: lStart, width: lPlanned - lStart, kind: 'normal' });
            if (lEnd > lPlanned) segments.push({ left: lPlanned, width: lEnd - lPlanned, kind: 'late' });
          } else {
            // Offen + Test-Ende in der Zukunft: Balken nur bis plannedEnd,
            // nicht darüber hinaus. (Explizit `plannedEnd` statt `barEnd`,
            // damit kein Verlängerungs-Fallback aus `effectiveBarEnd` greift.)
            const left = pct(projStart);
            const right = pct(plannedEnd);
            if (right > left) segments.push({ left, width: right - left, kind: 'normal' });
          }

          const tooltipBase = `${project.jiraKey} · ${project.jiraSummary} · ${formatDeDate(projStart)}–${formatDeDate(plannedEnd)} · ${project.jiraStatus}`;
          const tooltipExtra = isCompleted
            ? `\n\nAbgeschlossen am ${formatDeDate(barEnd)}.`
            : isOverdue
              ? `\n\nTestphase abgelaufen — JIRA-Status weiterhin offen.`
              : '';
          const tooltipInferred = isInferred
            ? `\n\n⚠️ JIRA-Feld „Ende der Testphase" fehlt — Zeitraum ist aus dem HubSpot-Won-Datum abgeleitet.`
            : '';
          const fullTooltip = tooltipBase + tooltipExtra + tooltipInferred;

          // Meilenstein "Ende der Testphase" — sichtbar gemacht als kleiner
          // Diamant über dem Balken am plannedEnd-Datum. Auch wenn das Projekt
          // schon resolved oder überfällig ist, zeigt der Marker das ursprünglich
          // geplante Ende an. Nur ausblenden, wenn das geplante Ende außerhalb
          // der sichtbaren Track-Range liegt.
          const milestonePct = pct(plannedEnd);
          const milestoneVisible =
            plannedEnd.getTime() >= trackStartMs && plannedEnd.getTime() <= trackEndMs;

          return (
            <div
              key={project.dealId}
              className="flex items-stretch border-b border-gray-100 hover:bg-gray-50"
            >
              <div
                className="flex-shrink-0 px-3 py-1.5 min-w-0 flex items-center gap-2"
                style={{ width: COMPANY_COL_WIDTH }}
              >
                <Link
                  href={project.hubspotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-gray-900 hover:text-gray-600 truncate"
                  title={project.dealName}
                >
                  {project.companyName}
                </Link>
                <ChildTaskDots
                  open={project.childTasks.open}
                  done={project.childTasks.done}
                />
                {project.jiraKey && project.jiraUrl ? (
                  <a
                    href={project.jiraUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-gray-400 hover:text-gray-600 inline-flex items-center gap-0.5 flex-shrink-0"
                    title={project.jiraSummary}
                  >
                    {project.jiraKey}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                ) : (
                  <span
                    className="text-[11px] text-gray-300 flex-shrink-0"
                    title="Kein JIRA-Issue verlinkt"
                  >
                    kein JIRA
                  </span>
                )}
              </div>

              <div className="flex-1 relative">
                {/* Wochen-Hintergrund */}
                <div
                  className="grid h-full"
                  style={{
                    gridTemplateColumns: `repeat(${totalWeeks}, minmax(${WEEK_MIN_WIDTH}px, 1fr))`,
                  }}
                >
                  {weeks.map((week) => (
                    <div
                      key={`${project.dealId}-${week.year}-W${week.weekNumber}`}
                      className={`h-9 border-l border-gray-100 ${week.isCurrent ? 'bg-amber-50/50' : ''}`}
                    />
                  ))}
                </div>

                {/* Balken-Segmente. Bei overdue stehen "active" (grün)
                    und "late" (rot) direkt aneinander, ohne Lücke. */}
                {segments.map((seg, i) => {
                  const isFirst = i === 0;
                  const isLast = i === segments.length - 1;
                  // Drei-Farben-Schema:
                  //   late      → rot (offen + Test-Ende in der Vergangenheit)
                  //   projected → grau (potenzielles Projekt aus Negotiation-Deal)
                  //   normal    → gelb (alles andere — inkl. abgeschlossen, läuft, in der Zukunft).
                  // Die Schraffur (hatched, won-fallback) bleibt unabhängig
                  // erhalten und liegt über dem gelben Untergrund.
                  const cls =
                    seg.kind === 'late'
                      ? 'bg-red-200 border-red-300'
                      : seg.kind === 'projected'
                        ? 'bg-gray-200 border-gray-300'
                        : 'bg-amber-200 border-amber-300';
                  const radius =
                    isFirst && isLast
                      ? 'rounded'
                      : isFirst
                        ? 'rounded-l'
                        : isLast
                          ? 'rounded-r'
                          : '';
                  const hatchStyle = hatched
                    ? {
                        backgroundImage:
                          'repeating-linear-gradient(-45deg, rgba(180,83,9,0.22), rgba(180,83,9,0.22) 4px, transparent 4px, transparent 8px)',
                      }
                    : undefined;

                  return (
                    <div
                      key={i}
                      className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                      style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
                    >
                      <div
                        className={`pointer-events-auto h-4 border ${cls} ${radius}`}
                        style={hatchStyle}
                        title={fullTooltip}
                      />
                    </div>
                  );
                })}

                {/* Meilenstein "Ende der Testphase". Vertikaler Strich plus
                    Diamant darüber. Liegt über den Balken-Segmenten. */}
                {milestoneVisible && (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none"
                    style={{ left: `${milestonePct}%`, width: 0 }}
                  >
                    <div
                      className="absolute top-0 bottom-0 w-px bg-gray-700/70 left-0 -translate-x-1/2"
                      title={`Geplantes Testphasen-Ende: ${formatDeDate(plannedEnd)}`}
                    />
                    <div
                      className="absolute top-1/2 left-0 w-2 h-2 bg-gray-800 rotate-45 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
                      title={`Geplantes Testphasen-Ende: ${formatDeDate(plannedEnd)}`}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}

type FilterBadgeProps = {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  totalCount: number;
};

type ChildTaskDotsProps = {
  open: number;
  done: number;
};

// Zeigt Sub-Tasks als kleine Punkte: grün = erledigt, rot = offen.
// Render-Reihenfolge: erst alle erledigten, dann offene — so sieht man auf
// einen Blick den Fortschritt von links nach rechts.
function ChildTaskDots({ open, done }: ChildTaskDotsProps) {
  const total = open + done;
  if (total === 0) return null;
  // Hard cap, damit lange Reihen das Layout nicht sprengen. Über 12 Tasks
  // werden die Reste kollabiert auf "+N".
  const MAX = 12;
  const visibleDone = Math.min(done, MAX);
  const remainingAfterDone = MAX - visibleDone;
  const visibleOpen = Math.min(open, remainingAfterDone);
  const overflow = total - visibleDone - visibleOpen;

  return (
    <span
      className="inline-flex items-center gap-0.5 flex-shrink-0"
      title={`${done} erledigt · ${open} offen`}
    >
      {Array.from({ length: visibleDone }).map((_, i) => (
        <span key={`d-${i}`} className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      ))}
      {Array.from({ length: visibleOpen }).map((_, i) => (
        <span key={`o-${i}`} className="w-1.5 h-1.5 rounded-full bg-red-500" />
      ))}
      {overflow > 0 && (
        <span className="text-[9px] text-gray-400 leading-none ml-0.5">+{overflow}</span>
      )}
    </span>
  );
}

function FilterBadge({ active, onClick, label, count, totalCount }: FilterBadgeProps) {
  // Hidden count = was wegfällt, wenn der Badge aktiv ist. Wird nur als
  // schwacher Hinweis daneben gezeigt, damit klar wird, dass es noch mehr
  // Daten gibt, die der Filter ausblendet.
  const hidden = totalCount - count;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
        active
          ? 'bg-gray-900 text-white hover:bg-gray-800'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      }`}
      title={active ? `Filter aktiv — ${hidden} ausgeblendet` : 'Filter inaktiv — alle anzeigen'}
    >
      <span>{label}</span>
      <span className={`text-[10px] ${active ? 'text-white/70' : 'text-gray-400'}`}>
        {active ? count : `${count}/${totalCount}`}
      </span>
    </button>
  );
}
