// MRR-Berechnung für HubSpot-Deals.
//
// Wir leiten den MRR aus mehreren möglichen Quellen ab — line items
// (`hs_mrr`), das AI-Agent-Paket-Pricing (auf Basis qualifizierter Minuten)
// oder dem klassischen TCV/Laufzeit-Verhältnis. Welche Quelle gewinnt, hängt
// davon ab, ob der Deal AI-Agent-Produkt enthält und ob er schon gewonnen ist.
// Siehe Kommentar in `computeDealRevenue` für die genaue Reihenfolge.

export type RevenueSource = 'line_items' | 'agents_package' | 'tcv_laufzeit' | 'none';

export interface DealMrrInput {
  angeboteneProdukte: string | undefined;
  agentsMinutenQualifiziert: string | undefined;
  agentsMinuten: string | undefined;
  hsMrr: string | undefined;
  hsNumOfAssociatedLineItems: string | undefined;
  tcv: string | undefined;
  vertragsdauer: string | undefined;
  isWonDeal: boolean;
}

// AI-Agent-Pakete: jedes Paket hat eine Inklusiv-Minutenzahl + einen
// Pro-Minute-Aufpreis für Überschreitung. Wir nehmen das günstigste Paket
// für die jeweilige Minutenzahl.
const AGENT_PACKAGES = [
  { included: 300, price: 74.95, perMinute: 0.25 },
  { included: 1000, price: 199.95, perMinute: 0.20 },
  { included: 2500, price: 449.95, perMinute: 0.18 },
  { included: 10000, price: 1499.95, perMinute: 0.15 },
] as const;

export function calculateAgentMrr(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.min(
    ...AGENT_PACKAGES.map(
      (pkg) => pkg.price + Math.max(0, minutes - pkg.included) * pkg.perMinute,
    ),
  );
}

export function getAgentMinutes(input: DealMrrInput): number {
  return (
    parseInt(input.agentsMinutenQualifiziert ?? '') ||
    parseInt(input.agentsMinuten ?? '') ||
    0
  );
}

/**
 * Liefert MRR + Quelle für einen Deal.
 *
 * Logik:
 * 1. Bei AI-Agent-Deals: wenn der Deal gewonnen ist UND es line-item-MRR
 *    gibt, wins line items (das ist das verbindliche Angebot). Sonst nehmen
 *    wir das Maximum aus Paket-MRR und line-item-MRR.
 * 2. Bei Nicht-AI-Agent-Deals: erst line-item-MRR, dann TCV/Laufzeit.
 * 3. Wenn nichts greift → 0 / 'none'.
 */
export function computeDealRevenue(
  input: DealMrrInput,
): { revenue: number; revenueSource: RevenueSource } {
  const products = input.angeboteneProdukte || '';
  const isAiAgent = products.split(';').includes('frontdesk');
  const lineItemCount = parseInt(input.hsNumOfAssociatedLineItems ?? '') || 0;
  const lineItemMrr = lineItemCount > 0 ? parseFloat(input.hsMrr ?? '') || 0 : 0;

  if (isAiAgent) {
    if (input.isWonDeal && lineItemMrr > 0) {
      return { revenue: lineItemMrr, revenueSource: 'line_items' };
    }

    const packageMrr = calculateAgentMrr(getAgentMinutes(input));
    if (packageMrr > lineItemMrr) {
      return { revenue: packageMrr, revenueSource: 'agents_package' };
    }
    if (lineItemMrr > 0) {
      return { revenue: lineItemMrr, revenueSource: 'line_items' };
    }
    return { revenue: 0, revenueSource: 'none' };
  }

  if (lineItemMrr > 0) return { revenue: lineItemMrr, revenueSource: 'line_items' };

  const tcv = parseFloat(input.tcv ?? '') || 0;
  const laufzeit = parseFloat(input.vertragsdauer ?? '') || 0;
  if (laufzeit > 0) return { revenue: tcv / laufzeit, revenueSource: 'tcv_laufzeit' };

  return { revenue: 0, revenueSource: 'none' };
}

export function isWonStageLabel(label: string): boolean {
  const l = label.toLowerCase();
  if (l.includes('closed lost')) return false;
  if (l.includes('verloren') || l.includes('lost') || l.includes('abgesagt') || l.includes('cancelled') || l.includes('storniert')) return false;
  if (l.includes('closed won')) return true;
  return l.includes('gewonnen') || l.includes('won') || l.includes('abgeschlossen') || l.includes('aktiv') || l.includes('active');
}

export function isLostStageLabel(label: string): boolean {
  const l = label.toLowerCase();
  if (l.includes('closed lost')) return true;
  return (
    l.includes('verloren') ||
    l.includes('lost') ||
    l.includes('abgesagt') ||
    l.includes('cancelled') ||
    l.includes('storniert')
  );
}
