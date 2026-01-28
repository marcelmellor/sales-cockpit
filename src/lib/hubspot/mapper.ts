import type { CanvasData, Milestone, NextStep } from '@/types/canvas';

interface HubSpotDealData {
  id: string;
  properties: Record<string, string>;
  contacts?: Array<{ id: string; properties: Record<string, string> }>;
  company?: { id: string; properties: Record<string, string> };
  owners?: Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  }>;
  meetings?: Array<{
    id: string;
    properties: {
      hs_meeting_title?: string;
      hs_meeting_start_time?: string;
      hs_meeting_end_time?: string;
    };
  }>;
  stageLabel?: string;
}

export function mapHubSpotToCanvas(data: HubSpotDealData): CanvasData {
  const { properties, company, owners = [], meetings = [] } = data;

  // Parse JSON fields safely
  const parseJson = <T>(value: string | undefined, fallback: T): T => {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  };

  // Convert plain text with line breaks to HTML paragraphs
  const textToHtml = (text: string | undefined): string => {
    if (!text) return '';
    const lines = text.split(/\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return '';
    return lines
      .map(line => {
        const escaped = line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<p>${escaped}</p>`;
      })
      .join('');
  };

  // Deal owner from HubSpot - find by hubspot_owner_id
  const ownerId = properties.hubspot_owner_id;
  const owner = ownerId ? owners.find(o => o.id === ownerId) : undefined;
  const dealOwner = owner
    ? [owner.firstName, owner.lastName].filter(Boolean).join(' ')
    : '';

  // Find next upcoming meeting
  const now = new Date();
  const upcomingMeetings = meetings
    .filter(m => {
      const startTime = m.properties.hs_meeting_start_time;
      return startTime && new Date(startTime) > now;
    })
    .sort((a, b) => {
      const aTime = new Date(a.properties.hs_meeting_start_time!).getTime();
      const bTime = new Date(b.properties.hs_meeting_start_time!).getTime();
      return aTime - bTime;
    });
  const nextMeeting = upcomingMeetings[0];

  // Parse next steps
  const nextSteps = parseJson<NextStep[]>(properties.canvas_next_steps, []);

  // Parse roadmap milestones
  const roadmapData = parseJson<{ milestones: Milestone[]; startDate: string; endDate: string }>(
    properties.canvas_roadmap,
    { milestones: [], startDate: new Date().toISOString(), endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() }
  );

  // Calculate deal age in days
  const calculateDealAge = (createdate: string | undefined): number => {
    if (!createdate) return 0;
    const created = new Date(createdate);
    const now = new Date();
    const diffTime = now.getTime() - created.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  };

  return {
    dealId: data.id,
    topBar: {
      companyName: company?.properties.name || properties.dealname || 'Unknown Company',
      companyLogo: company?.properties.domain ? `https://logo.clearbit.com/${company.properties.domain}` : undefined,
      productManager: properties.deal_po || '',
      dealOwner,
      dealStage: data.stageLabel,
      dealAge: calculateDealAge(properties.createdate),
    },
    header: {
      companyDescription: textToHtml(company?.properties.description),
      revenue: {
        mrr: parseFloat(properties.amount) || 0,
        seats: parseInt(properties.canvas_seats) || 0,
        currency: 'EUR',
      },
      nextAppointment: nextMeeting
        ? {
            date: new Date(nextMeeting.properties.hs_meeting_start_time!),
            title: nextMeeting.properties.hs_meeting_title || 'Meeting',
            description: '',
          }
        : null,
    },
    problemValue: {
      situation: textToHtml(properties.identified_pain || properties.canvas_situation),
      metrics: textToHtml(properties.metric),
    },
    solution: {
      solution: textToHtml(properties.canvas_solution),
      upsell: textToHtml(properties.canvas_upsell),
    },
    decision: {
      requirements: textToHtml(properties.decision_criteria || properties.canvas_product_requirements),
      champion: textToHtml(properties.champion_name),
      competitors: textToHtml(properties.competition_analysis || properties.canvas_competitors),
      risks: textToHtml(properties.canvas_risks || properties.canvas_risks_blockers),
      showStoppers: properties.frontdesk_deal_tags
        ? properties.frontdesk_deal_tags.split(';').map(tag => tag.trim()).filter(Boolean)
        : [],
    },
    roadmap: {
      milestones: roadmapData.milestones.map(m => ({
        ...m,
        date: new Date(m.date),
      })),
      nextSteps,
      startDate: new Date(roadmapData.startDate),
      endDate: new Date(roadmapData.endDate),
    },
    isDirty: false,
  };
}

// Convert HTML back to plain text with line breaks
function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/p>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

export function mapCanvasToHubSpot(canvas: CanvasData): Record<string, string | number> {
  // Only push fields that exist in HubSpot and are editable
  return {
    // Situation / Pain
    identified_pain: htmlToText(canvas.problemValue.situation),
    // Metrics
    metric: htmlToText(canvas.problemValue.metrics),
    // Anforderungen
    decision_criteria: htmlToText(canvas.decision.requirements),
    // Umsatzerwartung (MRR)
    amount: canvas.header.revenue.mrr,
  };
}
