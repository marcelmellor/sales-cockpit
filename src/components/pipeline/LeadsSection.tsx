'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import type { LeadOverviewItem } from '@/app/api/leads/overview/route';
import type { DealsGrouping } from '@/app/page';
import { AgeTomato } from './AgeTomato';

const HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;

function hubspotDealUrl(dealId: string): string | null {
  if (!HUBSPOT_PORTAL_ID) return null;
  return `https://app-eu1.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-3/${dealId}`;
}

function hubspotRecordUrl(lead: LeadOverviewItem): string | null {
  if (!HUBSPOT_PORTAL_ID) return null;
  // HubSpot Leads haben keine eigene, sinnvoll öffenbare Record-Detail-Seite —
  // sie existieren nur als Side-Panel im Prospecting Workspace. Daher
  // verlinken wir stattdessen den primären Contact (oder hilfsweise die
  // Firma), wo der eigentliche Kontext (Name, Mail, Historie) liegt.
  if (lead.contactId) {
    return `https://app-eu1.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/contact/${lead.contactId}`;
  }
  if (lead.companyId) {
    return `https://app-eu1.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/company/${lead.companyId}`;
  }
  return null;
}

interface LeadsSectionProps {
  leads: LeadOverviewItem[];
  stages: Array<{ id: string; label: string; displayOrder: number; isClosed: boolean }>;
  onlyOpen?: boolean;
  minMinuten?: number | null;
  hideWithDeal?: boolean;
  grouping?: DealsGrouping;
  loading?: boolean;
}

// Fasst die HubSpot-Stages "Kontaktversuch 1/2/3" zu einer logischen Stage
// "Kontaktversuch" zusammen. Für den Sales-Alltag ist die Nummer uninteressant —
// wichtig ist nur, dass der Lead in der Kontaktversuch-Phase steckt.
const KONTAKTVERSUCH_PATTERN = /^Kontaktversuch\s*\d+$/i;
const MERGED_KONTAKTVERSUCH_ID = 'merged:kontaktversuch';
const MERGED_KONTAKTVERSUCH_LABEL = 'Kontaktversuch';

function isKontaktversuchStage(label: string): boolean {
  return KONTAKTVERSUCH_PATTERN.test(label.trim());
}

// Liefert die untere Grenze des Range-Strings aus `inbound_volumen`,
// z.B. "0-1000" → 0, "1000-2000" → 1000, ">5000" → 5000.
// Wird vom Minuten-Quickfilter als konservative Untergrenze genutzt: ein Lead
// passiert den ≥ N Filter nur dann über `inbound_volumen`, wenn die untere
// Grenze des Ranges bereits ≥ N ist.
function inboundVolumenLowerBound(range: string | null): number | null {
  if (!range) return null;
  const m = range.match(/^(\d+)/) || range.match(/^>(\d+)/);
  return m ? Number(m[1]) : null;
}

export function LeadsSection({ leads, stages, onlyOpen = false, minMinuten = null, hideWithDeal = false, grouping = 'stage', loading }: LeadsSectionProps) {
  const visibleLeads = useMemo(() => {
    let out = leads;
    if (onlyOpen) out = out.filter(l => !l.leadStageIsClosed);
    if (minMinuten != null) {
      out = out.filter(l => {
        if (l.agentsMinuten != null) return l.agentsMinuten >= minMinuten;
        const lower = inboundVolumenLowerBound(l.inboundVolumen);
        return lower != null && lower >= minMinuten;
      });
    }
    if (hideWithDeal) {
      out = out.filter(l => !l.existingDealId);
    }
    return out;
  }, [leads, onlyOpen, minMinuten, hideWithDeal]);

  const leadsByStage = useMemo(() => {
    // Effektive Stage-Liste bauen: alle "Kontaktversuch N"-Stages werden zu
    // einer einzigen synthetischen Stage zusammengefasst.
    type EffectiveStage = { id: string; label: string; displayOrder: number; isClosed: boolean };
    const effectiveStages: EffectiveStage[] = [];
    const origIdToEffectiveId = new Map<string, string>();
    let mergedInserted = false;

    for (const stage of stages) {
      if (isKontaktversuchStage(stage.label)) {
        origIdToEffectiveId.set(stage.id, MERGED_KONTAKTVERSUCH_ID);
        if (!mergedInserted) {
          effectiveStages.push({
            id: MERGED_KONTAKTVERSUCH_ID,
            label: MERGED_KONTAKTVERSUCH_LABEL,
            displayOrder: stage.displayOrder,
            isClosed: false,
          });
          mergedInserted = true;
        }
      } else {
        origIdToEffectiveId.set(stage.id, stage.id);
        effectiveStages.push(stage);
      }
    }

    return effectiveStages
      .map(stage => ({
        stage,
        leads: visibleLeads.filter(
          l => origIdToEffectiveId.get(l.leadStageId) === stage.id
        ),
      }))
      .filter(g => g.leads.length > 0);
  }, [stages, visibleLeads]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-400">
        Leads werden geladen...
      </div>
    );
  }

  if (visibleLeads.length === 0) {
    return null;
  }

  if (grouping === 'none') {
    return (
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <ul className="divide-y divide-gray-100">
          {visibleLeads.map(lead => (
            <LeadRow key={lead.id} lead={lead} />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {leadsByStage.map(({ stage, leads: stageLeads }) => (
        <LeadStageGroup key={stage.id} stage={stage} leads={stageLeads} />
      ))}
    </div>
  );
}

function LeadStageGroup({
  stage,
  leads,
}: {
  stage: { id: string; label: string; displayOrder: number; isClosed: boolean };
  leads: LeadOverviewItem[];
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div
        className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-3 cursor-pointer hover:bg-gray-100 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronUp className="h-5 w-5 text-gray-400" />
        )}
        <h3 className="font-semibold text-gray-900">{stage.label}</h3>
        <span className="px-2 py-0.5 text-sm rounded-full bg-gray-100 text-gray-600">
          {leads.length}
        </span>
      </div>
      {isExpanded && (
        <ul className="divide-y divide-gray-100">
          {leads.map(lead => (
            <LeadRow key={lead.id} lead={lead} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LeadRow({ lead }: { lead: LeadOverviewItem }) {
  const url = hubspotRecordUrl(lead);
  const displayName = lead.companyName || lead.leadName;
  // Source steht jetzt in einer eigenen Spalte; die Subline zeigt nur noch
  // den Lead-Namen (sofern die Company in der Primärzeile steht), sonst nichts.
  const subLine = lead.companyName ? lead.leadName : '';
  // Freitext-`leadSource` ("Rueckruf anfordern (Frontdesk)") ist spezifischer
  // als der Enum-`source` ("Contact Form") — daher vorziehen, Enum als Fallback.
  const sourceDisplay = lead.leadSource || lead.source || '';

  const content = (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors group">
      <div className="flex-1 min-w-0">
        <h4 className="font-medium text-gray-900 truncate group-hover:text-purple-700 transition-colors">
          {displayName}
        </h4>
        {subLine && (
          <p className="text-xs text-gray-500 truncate mt-0.5">{subLine}</p>
        )}
      </div>

      <div className="flex items-center gap-6 text-sm">
        {lead.existingDealId && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const url = hubspotDealUrl(lead.existingDealId!);
              if (url) window.open(url, '_blank', 'noopener,noreferrer');
            }}
            className="hidden sm:inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors max-w-[180px] truncate"
            title={lead.existingDealName ? `Bestehender Deal: ${lead.existingDealName}` : 'Bestehender Deal'}
          >
            Deal: {lead.existingDealName || 'offen'}
          </button>
        )}

        {lead.product.length > 0 && (
          <div className="hidden sm:flex gap-1">
            {lead.product.map(p => (
              <span
                key={p}
                className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-purple-50 text-purple-700 border border-purple-100"
              >
                {p}
              </span>
            ))}
          </div>
        )}

        <div
          className="hidden md:block w-[180px] text-gray-500 text-xs truncate"
          title={sourceDisplay}
        >
          {sourceDisplay}
        </div>

        <div className="w-[110px] text-right text-gray-600 text-xs tabular-nums">
          {lead.agentsMinuten != null
            ? `${lead.agentsMinuten.toLocaleString('de-DE')} Min`
            : lead.inboundVolumen
              ? `${lead.inboundVolumen} Min`
              : ''}
        </div>

        <div
          className="w-[80px] flex justify-end"
          title={lead.daysInStage >= 0
            ? `${lead.daysInStage} Tag${lead.daysInStage === 1 ? '' : 'e'} in Stage\n${lead.leadAge} Tag${lead.leadAge === 1 ? '' : 'e'} Lead-Alter`
            : `${lead.leadAge} Tag${lead.leadAge === 1 ? '' : 'e'} Lead-Alter`
          }
        >
          {lead.daysInStage >= 0 && (
            <AgeTomato days={lead.daysInStage} />
          )}
        </div>

        <ExternalLink className="h-4 w-4 text-gray-300 group-hover:text-purple-500 transition-colors" />
      </div>
    </div>
  );

  if (url) {
    return (
      <li>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          {content}
        </a>
      </li>
    );
  }
  return <li>{content}</li>;
}
