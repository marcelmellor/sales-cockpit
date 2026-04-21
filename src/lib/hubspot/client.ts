const HUBSPOT_API_BASE = 'https://api.hubapi.com';

// ---------------------------------------------------------------------------
// Token management
//
// The app authenticates against HubSpot via a Private App Token (pat-eu1-…)
// set in HUBSPOT_PRIVATE_APP_TOKEN. Private App tokens do not expire, so there
// is no refresh flow. See AGENTS.md → "HubSpot authentication" for why we're
// on this path and who owns the token in sipgate's HubSpot (27058496).
// ---------------------------------------------------------------------------

function getAccessToken(): string {
  const pat = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!pat) {
    throw new Error(
      'HUBSPOT_PRIVATE_APP_TOKEN is not set. Ask Phil (sipgate HubSpot admin) to issue a Private App Token — see AGENTS.md.'
    );
  }
  return pat;
}

/**
 * Creates a HubSpotClient. Reads the token lazily from env on each request.
 */
export function getHubSpotClient(): HubSpotClient {
  return new HubSpotClient();
}

export class HubSpotClient {
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = getAccessToken();

    const response = await fetch(`${HUBSPOT_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new HubSpotError(
        error.message || `HubSpot API error: ${response.status}`,
        response.status,
        error
      );
    }

    return response.json();
  }

  // Deals
  async getDeals(pipelineId?: string) {
    const properties = [
      'dealname',
      'amount',
      'tcv',
      'vertragsdauer',
      'dealstage',
      'closedate',
      'pipeline',
      'deal_po',
      'identified_pain',
      'competition_analysis',
      'canvas_situation',
      'canvas_competitors',
      'canvas_goal_leverage',
      'canvas_mrr',
      'canvas_seats',
      'canvas_product_requirements',
      'canvas_solution',
      'canvas_customizations',
      'canvas_upsell',
      'canvas_discovery',
      'canvas_poc_pilot',
      'canvas_risks_blockers',
      'canvas_next_steps',
      'canvas_roadmap',
      'canvas_next_appointment',
    ];

    // Fetch all deals with pagination (HubSpot search API returns max 100 per request)
    let allDeals: Array<{
      id: string;
      properties: Record<string, string>;
      associations?: {
        contacts?: { results: Array<{ id: string; type: string }> };
        companies?: { results: Array<{ id: string; type: string }> };
      };
    }> = [];
    let after: string | undefined;

    do {
      const searchBody: {
        properties: string[];
        filterGroups?: Array<{ filters: Array<{ propertyName: string; operator: string; value: string }> }>;
        limit: number;
        after?: string;
      } = {
        properties,
        limit: 100,
      };

      if (pipelineId) {
        searchBody.filterGroups = [{
          filters: [{ propertyName: 'pipeline', operator: 'EQ', value: pipelineId }]
        }];
      }

      if (after) {
        searchBody.after = after;
      }

      const response = await this.request<{
        results: Array<{
          id: string;
          properties: Record<string, string>;
          associations?: {
            contacts?: { results: Array<{ id: string; type: string }> };
            companies?: { results: Array<{ id: string; type: string }> };
          };
        }>;
        paging?: {
          next?: {
            after: string;
          };
        };
      }>('/crm/v3/objects/deals/search', {
        method: 'POST',
        body: JSON.stringify(searchBody),
      });

      allDeals = allDeals.concat(response.results);
      after = response.paging?.next?.after;
    } while (after);

    return { results: allDeals };
  }

  // Deals with company associations for overview
  async getDealsWithAssociations(pipelineId: string, produkt?: string) {
    const properties = [
      'dealname',
      'amount',
      'tcv',
      'vertragsdauer',
      'dealstage',
      'pipeline',
      'agents_minuten',
      'agents_minuten_qualifiziert',
      'deal_po',
      'createdate',
      'closedate',
      'angebotene_produkte',
      'hs_mrr',
      'hs_num_of_associated_line_items',
    ];

    // Fetch all deals with pagination (HubSpot search API returns max 100 per request)
    let allDeals: Array<{
      id: string;
      properties: Record<string, string>;
      associations?: {
        companies?: { results: Array<{ id: string; type: string }> };
      };
    }> = [];
    let after: string | undefined;

    do {
      const searchBody: {
        properties: string[];
        filterGroups: Array<{ filters: Array<{ propertyName: string; operator: string; value: string }> }>;
        sorts: Array<{ propertyName: string; direction: string }>;
        limit: number;
        after?: string;
      } = {
        properties,
        filterGroups: [{
          filters: [
            { propertyName: 'pipeline', operator: 'EQ', value: pipelineId },
            ...(produkt ? [{ propertyName: 'angebotene_produkte', operator: 'CONTAINS_TOKEN', value: produkt }] : []),
          ]
        }],
        // Stable sort is required for reliable pagination — without it, HubSpot's
        // search API can skip or duplicate records across pages when deals mutate.
        sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
        limit: 100,
      };

      if (after) {
        searchBody.after = after;
      }

      const response = await this.request<{
        results: Array<{
          id: string;
          properties: Record<string, string>;
          associations?: {
            companies?: { results: Array<{ id: string; type: string }> };
          };
        }>;
        paging?: {
          next?: {
            after: string;
          };
        };
      }>('/crm/v3/objects/deals/search', {
        method: 'POST',
        body: JSON.stringify(searchBody),
      });

      allDeals = allDeals.concat(response.results);
      after = response.paging?.next?.after;
    } while (after);

    const deals = { results: allDeals };

    // Use batch associations API to get all company associations
    // HubSpot batch API has a limit of 100 inputs per request
    const dealIds = deals.results.map(d => d.id);
    const associationsMap = new Map<string, Array<{ id: string; type: string }>>();

    if (dealIds.length > 0) {
      try {
        // Process in batches of 100
        const batchSize = 100;
        for (let i = 0; i < dealIds.length; i += batchSize) {
          const batchIds = dealIds.slice(i, i + batchSize);
          const batchAssociations = await this.request<{
            results: Array<{
              from: { id: string };
              to: Array<{ toObjectId: number; associationTypes: Array<{ typeId: number }> }>;
            }>;
          }>('/crm/v4/associations/deals/companies/batch/read', {
            method: 'POST',
            body: JSON.stringify({
              inputs: batchIds.map(id => ({ id })),
            }),
          });

          for (const result of batchAssociations.results) {
            // toObjectId is a number, convert to string
            const companyAssocs = result.to.map(t => ({ id: String(t.toObjectId), type: 'company' }));
            associationsMap.set(result.from.id, companyAssocs);
          }
        }
      } catch {
        // Fallback: associations will be empty
      }
    }

    // Merge associations into deals
    const dealsWithAssociations = deals.results.map(deal => ({
      ...deal,
      associations: {
        companies: { results: associationsMap.get(deal.id) || [] },
      },
    }));

    return { results: dealsWithAssociations };
  }

  // Fetch line item categories for a batch of deals.
  // `category` is HubSpot's product category on the line item (e.g. "AI Agent",
  // "Cloud Telefonanlage", "Mobilfunk"). It's the most reliable classifier —
  // more robust than SKU prefix parsing.
  // Returns a Map<dealId, string[]> of category values. Deals without line items are absent.
  async getLineItemCategoriesForDeals(dealIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (dealIds.length === 0) return result;

    // Step 1: batch-read deal → line_item associations
    const batchSize = 100;
    const dealToLineItems = new Map<string, string[]>();

    for (let i = 0; i < dealIds.length; i += batchSize) {
      const batchIds = dealIds.slice(i, i + batchSize);
      try {
        const response = await this.request<{
          results: Array<{
            from: { id: string };
            to: Array<{ toObjectId: number }>;
          }>;
        }>('/crm/v4/associations/deals/line_items/batch/read', {
          method: 'POST',
          body: JSON.stringify({
            inputs: batchIds.map(id => ({ id })),
          }),
        });
        for (const r of response.results) {
          dealToLineItems.set(r.from.id, r.to.map(t => String(t.toObjectId)));
        }
      } catch (err) {
        console.error('[getLineItemCategoriesForDeals] deal→line_item assoc batch failed:', err);
      }
    }

    // Step 2: batch-read line items to get categories
    const allLineItemIds = Array.from(new Set(Array.from(dealToLineItems.values()).flat()));
    if (allLineItemIds.length === 0) return result;

    const categoryById = new Map<string, string>();
    // Track line-item IDs for which we failed to read the category (e.g. missing
    // e-commerce scope → 403). We can't trust the category filter for deals whose
    // line items are in this set — treat them as "unknown" and keep the deal.
    const failedLineItemIds = new Set<string>();
    for (let i = 0; i < allLineItemIds.length; i += batchSize) {
      const batchIds = allLineItemIds.slice(i, i + batchSize);
      try {
        const response = await this.request<{
          results: Array<{ id: string; properties: { category?: string } }>;
        }>('/crm/v3/objects/line_items/batch/read', {
          method: 'POST',
          body: JSON.stringify({
            properties: ['category'],
            inputs: batchIds.map(id => ({ id })),
          }),
        });
        for (const li of response.results) {
          categoryById.set(li.id, li.properties.category || '');
        }
      } catch (err) {
        console.error('[getLineItemCategoriesForDeals] line_items batch read failed — keeping affected deals unfiltered:', err);
        for (const id of batchIds) failedLineItemIds.add(id);
      }
    }

    for (const [dealId, lineItemIds] of dealToLineItems.entries()) {
      // If ANY of the deal's line items failed to read, we can't reliably classify
      // the deal — skip it from the result map so the caller's `!categories` branch
      // keeps the deal rather than silently dropping it.
      const anyFailed = lineItemIds.some(id => failedLineItemIds.has(id));
      if (anyFailed) continue;
      result.set(dealId, lineItemIds.map(id => categoryById.get(id) || ''));
    }

    return result;
  }

  async getDeal(dealId: string) {
    const properties = [
      'dealname',
      'amount',
      'tcv',
      'vertragsdauer',
      'dealstage',
      'closedate',
      'createdate',
      'pipeline',
      'hubspot_owner_id',
      'deal_po',
      'identified_pain',
      'metric',
      'decision_criteria',
      'champion_name',
      'competition_analysis',
      'canvas_situation',
      'canvas_competitors',
      'canvas_solution',
      'canvas_upsell',
      'canvas_risks',
      'canvas_next_steps',
      'canvas_roadmap',
      'canvas_next_appointment',
      'frontdesk_deal_tags',
      'hs_mrr',
      'hs_num_of_associated_line_items',
    ].join(',');

    return this.request<{
      id: string;
      properties: Record<string, string>;
      associations?: {
        contacts?: { results: Array<{ id: string; type: string }> };
        companies?: { results: Array<{ id: string; type: string }> };
      };
    }>(`/crm/v3/objects/deals/${dealId}?properties=${properties}&associations=contacts,companies`);
  }

  async updateDeal(dealId: string, properties: Record<string, string | number>) {
    return this.request<{
      id: string;
      properties: Record<string, string>;
    }>(`/crm/v3/objects/deals/${dealId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    });
  }

  // Contacts
  async getContact(contactId: string) {
    return this.request<{
      id: string;
      properties: Record<string, string>;
    }>(`/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,jobtitle,phone`);
  }

  async getContacts(contactIds: string[]) {
    if (contactIds.length === 0) return { results: [] };

    // HubSpot batch API has a limit of 100 inputs per request
    const allResults: Array<{ id: string; properties: Record<string, string> }> = [];
    const batchSize = 100;

    for (let i = 0; i < contactIds.length; i += batchSize) {
      const batchIds = contactIds.slice(i, i + batchSize);
      const response = await this.request<{
        results: Array<{
          id: string;
          properties: Record<string, string>;
        }>;
      }>('/crm/v3/objects/contacts/batch/read', {
        method: 'POST',
        body: JSON.stringify({
          properties: ['firstname', 'lastname', 'email', 'jobtitle', 'phone'],
          inputs: batchIds.map(id => ({ id })),
        }),
      });
      allResults.push(...response.results);
    }

    return { results: allResults };
  }

  // Companies
  async getCompany(companyId: string) {
    return this.request<{
      id: string;
      properties: Record<string, string>;
    }>(`/crm/v3/objects/companies/${companyId}?properties=name,description,domain,industry,numberofemployees`);
  }

  async getCompanies(companyIds: string[]) {
    if (companyIds.length === 0) return { results: [] };

    // HubSpot batch API has a limit of 100 inputs per request
    const allResults: Array<{ id: string; properties: Record<string, string> }> = [];
    const batchSize = 100;

    for (let i = 0; i < companyIds.length; i += batchSize) {
      const batchIds = companyIds.slice(i, i + batchSize);
      const response = await this.request<{
        results: Array<{
          id: string;
          properties: Record<string, string>;
        }>;
      }>('/crm/v3/objects/companies/batch/read', {
        method: 'POST',
        body: JSON.stringify({
          properties: ['name'],
          inputs: batchIds.map(id => ({ id })),
        }),
      });
      allResults.push(...response.results);
    }

    return { results: allResults };
  }

  // Pipelines
  async getPipelines() {
    return this.request<{
      results: Array<{
        id: string;
        label: string;
        stages: Array<{
          id: string;
          label: string;
          metadata: {
            probability: string;
          };
        }>;
      }>;
    }>('/crm/v3/pipelines/deals');
  }

  // Meetings for a deal
  async getMeetingsForDeal(dealId: string) {
    // First get meeting IDs associated with the deal
    const associations = await this.request<{
      results: Array<{ id: string; type: string }>;
    }>(`/crm/v3/objects/deals/${dealId}/associations/meetings`);

    if (associations.results.length === 0) {
      return { results: [] };
    }

    // Then fetch meeting details
    const meetingIds = associations.results.map(m => m.id);
    return this.request<{
      results: Array<{
        id: string;
        properties: {
          hs_meeting_title?: string;
          hs_meeting_start_time?: string;
          hs_meeting_end_time?: string;
          hs_meeting_outcome?: string;
        };
      }>;
    }>('/crm/v3/objects/meetings/batch/read', {
      method: 'POST',
      body: JSON.stringify({
        properties: ['hs_meeting_title', 'hs_meeting_start_time', 'hs_meeting_end_time', 'hs_meeting_outcome'],
        inputs: meetingIds.map(id => ({ id })),
      }),
    });
  }

  // Batch-fetch meetings for many deals at once. Uses HubSpot's batch
  // association read + batch object read, so a pipeline of N deals costs 2
  // API calls (plus one extra per 100 deals/meetings for pagination) rather
  // than 2×N. This is the only way to stay inside HubSpot's ~10 req/s rate
  // limit when rendering large pipelines. Returns a map dealId → meetings[].
  async getMeetingsForDeals(dealIds: string[]): Promise<
    Map<
      string,
      Array<{
        id: string;
        properties: {
          hs_meeting_title?: string;
          hs_meeting_start_time?: string;
          hs_meeting_end_time?: string;
          hs_meeting_outcome?: string;
        };
      }>
    >
  > {
    const result = new Map<
      string,
      Array<{
        id: string;
        properties: {
          hs_meeting_title?: string;
          hs_meeting_start_time?: string;
          hs_meeting_end_time?: string;
          hs_meeting_outcome?: string;
        };
      }>
    >();
    if (dealIds.length === 0) return result;

    // Step 1: batch association read (deals → meetings), 100 deals per call.
    const dealToMeetingIds = new Map<string, string[]>();
    const allMeetingIds = new Set<string>();
    for (let i = 0; i < dealIds.length; i += 100) {
      const batch = dealIds.slice(i, i + 100);
      const resp = await this.request<{
        results: Array<{
          from: { id: string };
          to: Array<{ toObjectId: number }>;
        }>;
      }>('/crm/v4/associations/deals/meetings/batch/read', {
        method: 'POST',
        body: JSON.stringify({ inputs: batch.map(id => ({ id })) }),
      });
      for (const r of resp.results) {
        const ids = r.to.map(t => String(t.toObjectId));
        dealToMeetingIds.set(r.from.id, ids);
        ids.forEach(id => allMeetingIds.add(id));
      }
    }

    // Step 2: batch read meeting details, 100 meeting IDs per call.
    const meetingById = new Map<
      string,
      {
        id: string;
        properties: {
          hs_meeting_title?: string;
          hs_meeting_start_time?: string;
          hs_meeting_end_time?: string;
          hs_meeting_outcome?: string;
        };
      }
    >();
    const allIdsList = Array.from(allMeetingIds);
    for (let i = 0; i < allIdsList.length; i += 100) {
      const batch = allIdsList.slice(i, i + 100);
      const resp = await this.request<{
        results: Array<{
          id: string;
          properties: {
            hs_meeting_title?: string;
            hs_meeting_start_time?: string;
            hs_meeting_end_time?: string;
            hs_meeting_outcome?: string;
          };
        }>;
      }>('/crm/v3/objects/meetings/batch/read', {
        method: 'POST',
        body: JSON.stringify({
          properties: [
            'hs_meeting_title',
            'hs_meeting_start_time',
            'hs_meeting_end_time',
            'hs_meeting_outcome',
          ],
          inputs: batch.map(id => ({ id })),
        }),
      });
      for (const m of resp.results) {
        meetingById.set(m.id, m);
      }
    }

    // Step 3: assemble per-deal meeting lists. Deals without associations get
    // an empty array (they are present in the map, so callers can distinguish
    // "no meetings" from "not queried").
    for (const dealId of dealIds) {
      const ids = dealToMeetingIds.get(dealId) || [];
      result.set(
        dealId,
        ids.map(id => meetingById.get(id)).filter((m): m is NonNullable<typeof m> => m !== undefined),
      );
    }
    return result;
  }

  // Owners (internal contacts)
  async getOwners() {
    return this.request<{
      results: Array<{
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        teams: Array<{ id: string; name: string }>;
      }>;
    }>('/crm/v3/owners');
  }

  // Properties
  async getProperties() {
    return this.request<{
      results: Array<{
        name: string;
        label: string;
        type: string;
        fieldType: string;
        groupName: string;
      }>;
    }>('/crm/v3/properties/deals');
  }

  async createProperty(property: {
    name: string;
    label: string;
    type: string;
    fieldType: string;
    groupName?: string;
  }) {
    return this.request<{
      name: string;
      label: string;
      type: string;
      fieldType: string;
    }>('/crm/v3/properties/deals', {
      method: 'POST',
      body: JSON.stringify({
        ...property,
        groupName: property.groupName || 'dealinformation',
      }),
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Leads
  //
  // HubSpot's Lead object (objectType 0-136) is a separate CRM object from
  // Deal. It lives in its own pipelines. For sipgate the portfolio leads
  // pipeline is "sipgate Portfolio" (id 3591532731). Leads carry a `product`
  // property (multi-select enumeration with values neo/frontdesk/cx/trunking/
  // easy/flow) that mirrors the deals `angebotene_produkte` filter.
  // Requires the `crm.objects.leads.read` scope on the Private App Token.
  // ─────────────────────────────────────────────────────────────────────────
  async getLeadsWithAssociations(pipelineId: string, produkt?: string) {
    const properties = [
      'hs_lead_name',
      'hs_pipeline',
      'hs_pipeline_stage',
      'hubspot_owner_id',
      'hs_createdate',
      'hs_lastmodifieddate',
      'product',
      'lead_source',
      'source',
      'agents_minuten',
      'anrufvolumen',
      'inbound_volumen',
    ];

    let allLeads: Array<{
      id: string;
      properties: Record<string, string>;
    }> = [];
    let after: string | undefined;

    do {
      const searchBody: {
        properties: string[];
        filterGroups: Array<{ filters: Array<{ propertyName: string; operator: string; value: string }> }>;
        sorts: Array<{ propertyName: string; direction: string }>;
        limit: number;
        after?: string;
      } = {
        properties,
        filterGroups: [{
          filters: [
            { propertyName: 'hs_pipeline', operator: 'EQ', value: pipelineId },
            ...(produkt ? [{ propertyName: 'product', operator: 'CONTAINS_TOKEN', value: produkt }] : []),
          ],
        }],
        sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
        limit: 100,
      };

      if (after) searchBody.after = after;

      const response = await this.request<{
        results: Array<{ id: string; properties: Record<string, string> }>;
        paging?: { next?: { after: string } };
      }>('/crm/v3/objects/leads/search', {
        method: 'POST',
        body: JSON.stringify(searchBody),
      });

      allLeads = allLeads.concat(response.results);
      after = response.paging?.next?.after;
    } while (after);

    // Batch-read lead → company and lead → contact associations. Leads
    // typically associate to a primary contact and (transitively) to a
    // company. Contacts are preferred for deep-linking the lead row in the
    // UI, because HubSpot Leads have no dedicated record page — contact
    // records do.
    const leadIds = allLeads.map(l => l.id);
    const companyAssocMap = new Map<string, string[]>();
    const contactAssocMap = new Map<string, string[]>();

    const readAssoc = async (
      toObject: 'companies' | 'contacts',
      target: Map<string, string[]>,
    ) => {
      const batchSize = 100;
      for (let i = 0; i < leadIds.length; i += batchSize) {
        const batchIds = leadIds.slice(i, i + batchSize);
        try {
          const batch = await this.request<{
            results: Array<{ from: { id: string }; to: Array<{ toObjectId: number }> }>;
          }>(`/crm/v4/associations/leads/${toObject}/batch/read`, {
            method: 'POST',
            body: JSON.stringify({ inputs: batchIds.map(id => ({ id })) }),
          });
          for (const r of batch.results) {
            target.set(r.from.id, r.to.map(t => String(t.toObjectId)));
          }
        } catch (err) {
          console.error(`[getLeadsWithAssociations] leads→${toObject} batch failed:`, err);
        }
      }
    };

    if (leadIds.length > 0) {
      await Promise.all([
        readAssoc('companies', companyAssocMap),
        readAssoc('contacts', contactAssocMap),
      ]);
    }

    return {
      results: allLeads.map(l => ({
        ...l,
        associations: {
          companies: { results: (companyAssocMap.get(l.id) || []).map(id => ({ id, type: 'company' })) },
          contacts: { results: (contactAssocMap.get(l.id) || []).map(id => ({ id, type: 'contact' })) },
        },
      })),
    };
  }

  // Analog zu `getDealStageHistories`: batch-read mit
  // `propertiesWithHistory: ['hs_pipeline_stage']`, um pro Lead die
  // Stage-Wechsel-Historie zu bekommen. Damit lässt sich "Tage in aktueller
  // Stage" berechnen. Batch-Limit: 50 (HubSpot-Limit für history-Reads).
  async getLeadStageHistories(
    leadIds: string[],
  ): Promise<Map<string, Array<{ value: string; timestamp: string; sourceType: string }>>> {
    const result = new Map<
      string,
      Array<{ value: string; timestamp: string; sourceType: string }>
    >();
    if (leadIds.length === 0) return result;

    const BATCH_SIZE = 50;
    for (let i = 0; i < leadIds.length; i += BATCH_SIZE) {
      const batch = leadIds.slice(i, i + BATCH_SIZE);
      try {
        const resp = await this.request<{
          results: Array<{
            id: string;
            propertiesWithHistory?: {
              hs_pipeline_stage?: Array<{
                value: string;
                timestamp: string;
                sourceType: string;
              }>;
            };
          }>;
        }>('/crm/v3/objects/leads/batch/read', {
          method: 'POST',
          body: JSON.stringify({
            properties: ['hs_pipeline_stage'],
            propertiesWithHistory: ['hs_pipeline_stage'],
            inputs: batch.map(id => ({ id })),
          }),
        });
        for (const r of resp.results) {
          result.set(r.id, r.propertiesWithHistory?.hs_pipeline_stage || []);
        }
      } catch (err) {
        console.error('[getLeadStageHistories] batch read failed:', err);
      }
    }
    return result;
  }

  // Findet alle Kontakte, die an einem Deal in der gegebenen Pipeline mit
  // passendem `angebotene_produkte` (CONTAINS_TOKEN) hängen. Wird genutzt,
  // um in der Leads-Übersicht einen Tag "Bestehender Deal" zu setzen: wenn
  // der primäre Kontakt eines Leads bereits an einem Deal im gleichen
  // Produkt-Bucket hängt, ist das relevant fürs Sales (Duplicate/Upsell-
  // Signal). Rückgabe: Map contactId → erster passender Deal (für Link).
  async getContactsWithDealInProdukt(
    dealPipelineId: string,
    produkt: string,
  ): Promise<Map<string, { dealId: string; dealName: string }>> {
    // 1. Search deals matching pipeline + produkt
    let allDeals: Array<{ id: string; properties: Record<string, string> }> = [];
    let after: string | undefined;
    do {
      const searchBody: {
        properties: string[];
        filterGroups: Array<{ filters: Array<{ propertyName: string; operator: string; value: string }> }>;
        sorts: Array<{ propertyName: string; direction: string }>;
        limit: number;
        after?: string;
      } = {
        properties: ['dealname'],
        filterGroups: [{
          filters: [
            { propertyName: 'pipeline', operator: 'EQ', value: dealPipelineId },
            { propertyName: 'angebotene_produkte', operator: 'CONTAINS_TOKEN', value: produkt },
          ],
        }],
        sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
        limit: 100,
      };
      if (after) searchBody.after = after;
      const resp = await this.request<{
        results: Array<{ id: string; properties: Record<string, string> }>;
        paging?: { next?: { after: string } };
      }>('/crm/v3/objects/deals/search', {
        method: 'POST',
        body: JSON.stringify(searchBody),
      });
      allDeals = allDeals.concat(resp.results);
      after = resp.paging?.next?.after;
    } while (after);

    if (allDeals.length === 0) return new Map();

    // 2. Batch-read deal → contacts associations
    const dealIds = allDeals.map(d => d.id);
    const dealToContacts = new Map<string, string[]>();
    const batchSize = 100;
    for (let i = 0; i < dealIds.length; i += batchSize) {
      const batch = dealIds.slice(i, i + batchSize);
      try {
        const resp = await this.request<{
          results: Array<{ from: { id: string }; to: Array<{ toObjectId: number }> }>;
        }>('/crm/v4/associations/deals/contacts/batch/read', {
          method: 'POST',
          body: JSON.stringify({ inputs: batch.map(id => ({ id })) }),
        });
        for (const r of resp.results) {
          dealToContacts.set(r.from.id, r.to.map(t => String(t.toObjectId)));
        }
      } catch (err) {
        console.error('[getContactsWithDealInProdukt] deal→contact assoc batch failed:', err);
      }
    }

    // 3. Reverse-Map contactId → erster passender Deal (für Tag-Link)
    const result = new Map<string, { dealId: string; dealName: string }>();
    for (const deal of allDeals) {
      const contactIds = dealToContacts.get(deal.id) || [];
      for (const cid of contactIds) {
        if (!result.has(cid)) {
          result.set(cid, {
            dealId: deal.id,
            dealName: deal.properties.dealname || 'Deal',
          });
        }
      }
    }
    return result;
  }

  async getLeadPipelines() {
    return this.request<{
      results: Array<{
        id: string;
        label: string;
        stages: Array<{
          id: string;
          label: string;
          displayOrder: number;
          metadata?: { isClosed?: string; leadState?: string };
        }>;
      }>;
    }>('/crm/v3/pipelines/0-136');
  }

  // Get deal stage history to determine when deal entered current stage
  async getDealStageHistory(dealId: string) {
    return this.request<{
      id: string;
      properties: Record<string, string>;
      propertiesWithHistory: {
        dealstage: Array<{
          value: string;
          timestamp: string;
          sourceType: string;
        }>;
      };
    }>(`/crm/v3/objects/deals/${dealId}?properties=dealstage&propertiesWithHistory=dealstage`);
  }

  // Batch-fetch stage history for many deals at once. Uses HubSpot's deals
  // batch read with `propertiesWithHistory`, so a pipeline of N deals costs
  // ceil(N/100) calls (one per 100-deal batch) instead of N per-deal GETs.
  // Same motivation as `getMeetingsForDeals` — the per-deal fan-out used to
  // exceed the 10 req/s rate limit and silently cached nulls in the client.
  async getDealStageHistories(
    dealIds: string[],
  ): Promise<
    Map<
      string,
      Array<{ value: string; timestamp: string; sourceType: string }>
    >
  > {
    const result = new Map<
      string,
      Array<{ value: string; timestamp: string; sourceType: string }>
    >();
    if (dealIds.length === 0) return result;

    // HubSpot limits batch reads that include `propertiesWithHistory` to
    // 50 inputs per call (not the usual 100).
    const BATCH_SIZE = 50;
    for (let i = 0; i < dealIds.length; i += BATCH_SIZE) {
      const batch = dealIds.slice(i, i + BATCH_SIZE);
      const resp = await this.request<{
        results: Array<{
          id: string;
          propertiesWithHistory?: {
            dealstage?: Array<{
              value: string;
              timestamp: string;
              sourceType: string;
            }>;
          };
        }>;
      }>('/crm/v3/objects/deals/batch/read', {
        method: 'POST',
        body: JSON.stringify({
          properties: ['dealstage'],
          propertiesWithHistory: ['dealstage'],
          inputs: batch.map(id => ({ id })),
        }),
      });
      for (const r of resp.results) {
        result.set(r.id, r.propertiesWithHistory?.dealstage || []);
      }
    }
    return result;
  }
}

export class HubSpotError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'HubSpotError';
  }
}
