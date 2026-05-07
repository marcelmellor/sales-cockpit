// HubSpot Hub `27058496` (sipgate 2025) ist die feste Authentifizierungs-
// Quelle dieser App (siehe AGENTS.md → "HubSpot authentication"). Ohne
// gesetzte Env-Var fallen die Deep-Links auf diesen Default zurück, sodass
// die Live-Umgebung nicht von `NEXT_PUBLIC_HUBSPOT_PORTAL_ID` abhängt.
export const HUBSPOT_PORTAL_ID =
  process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || '27058496';

export function hubspotDealUrl(dealId: string): string {
  return `https://app-eu1.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/record/0-3/${dealId}`;
}

export function hubspotContactUrl(contactId: string): string {
  return `https://app-eu1.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/contact/${contactId}`;
}

export function hubspotCompanyUrl(companyId: string): string {
  return `https://app-eu1.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/company/${companyId}`;
}
