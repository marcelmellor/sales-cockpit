const HUBSPOT_API_BASE = 'https://api.hubapi.com';

/**
 * Creates a HubSpotClient using the private app token from environment variables.
 * Throws if the token is not configured.
 */
export function getHubSpotClient(): HubSpotClient {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    throw new Error('HUBSPOT_PRIVATE_APP_TOKEN is not configured');
  }
  return new HubSpotClient(token);
}

export class HubSpotClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${HUBSPOT_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
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
  async getDealsWithAssociations(pipelineId: string) {
    const properties = [
      'dealname',
      'amount',
      'tcv',
      'vertragsdauer',
      'dealstage',
      'pipeline',
      'agents_minuten',
      'deal_po',
      'createdate',
      'closedate',
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
        limit: number;
        after?: string;
      } = {
        properties,
        filterGroups: [{
          filters: [{ propertyName: 'pipeline', operator: 'EQ', value: pipelineId }]
        }],
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
