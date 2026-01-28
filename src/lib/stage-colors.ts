/**
 * Deal Stage Color Utility
 * Maps deal stages to colors from the Neo color scheme for consistent styling
 */

export interface StageColorScheme {
  bg: string;
  text: string;
  border?: string;
}

// Semantic stage colors based on stage meaning/position in funnel
const STAGE_COLOR_MAP: Record<string, StageColorScheme> = {
  // Early stages - Cornflower (blue)
  'neu': { bg: 'var(--cornflower-light-3)', text: 'var(--cornflower-light-12)' },
  'new': { bg: 'var(--cornflower-light-3)', text: 'var(--cornflower-light-12)' },
  'lead': { bg: 'var(--cornflower-light-3)', text: 'var(--cornflower-light-12)' },
  'incoming': { bg: 'var(--cornflower-light-3)', text: 'var(--cornflower-light-12)' },
  'eingehend': { bg: 'var(--cornflower-light-3)', text: 'var(--cornflower-light-12)' },

  // Qualification - Lavender (purple)
  'qualifiziert': { bg: 'var(--lavender-light-3)', text: 'var(--lavender-light-12)' },
  'qualified': { bg: 'var(--lavender-light-3)', text: 'var(--lavender-light-12)' },
  'qualification': { bg: 'var(--lavender-light-3)', text: 'var(--lavender-light-12)' },
  'qualifikation': { bg: 'var(--lavender-light-3)', text: 'var(--lavender-light-12)' },
  'discovery': { bg: 'var(--lavender-light-3)', text: 'var(--lavender-light-12)' },

  // Meeting/Appointment - Clementine (orange)
  'termin': { bg: 'var(--clementine-light-3)', text: 'var(--clementine-light-12)' },
  'meeting': { bg: 'var(--clementine-light-3)', text: 'var(--clementine-light-12)' },
  'appointment': { bg: 'var(--clementine-light-3)', text: 'var(--clementine-light-12)' },
  'demo': { bg: 'var(--clementine-light-3)', text: 'var(--clementine-light-12)' },
  'präsentation': { bg: 'var(--clementine-light-3)', text: 'var(--clementine-light-12)' },
  'presentation': { bg: 'var(--clementine-light-3)', text: 'var(--clementine-light-12)' },

  // Proposal/Negotiation - Orange (yellow-orange)
  'angebot': { bg: 'var(--orange-light-3)', text: 'var(--orange-light-12)' },
  'proposal': { bg: 'var(--orange-light-3)', text: 'var(--orange-light-12)' },
  'verhandlung': { bg: 'var(--orange-light-3)', text: 'var(--orange-light-12)' },
  'negotiation': { bg: 'var(--orange-light-3)', text: 'var(--orange-light-12)' },
  'contract': { bg: 'var(--orange-light-3)', text: 'var(--orange-light-12)' },
  'vertrag': { bg: 'var(--orange-light-3)', text: 'var(--orange-light-12)' },

  // Decision - Electric Lime (accent green-yellow)
  'entscheidung': { bg: 'var(--electric-lime-light-3)', text: 'var(--electric-lime-light-12)' },
  'decision': { bg: 'var(--electric-lime-light-3)', text: 'var(--electric-lime-light-12)' },
  'closing': { bg: 'var(--electric-lime-light-3)', text: 'var(--electric-lime-light-12)' },
  'abschluss': { bg: 'var(--electric-lime-light-3)', text: 'var(--electric-lime-light-12)' },

  // Won - Green
  'gewonnen': { bg: 'var(--green-light-3)', text: 'var(--green-light-12)' },
  'won': { bg: 'var(--green-light-3)', text: 'var(--green-light-12)' },
  'closed won': { bg: 'var(--green-light-3)', text: 'var(--green-light-12)' },
  'abgeschlossen': { bg: 'var(--green-light-3)', text: 'var(--green-light-12)' },
  'kunde': { bg: 'var(--green-light-3)', text: 'var(--green-light-12)' },
  'customer': { bg: 'var(--green-light-3)', text: 'var(--green-light-12)' },
  'aktiv': { bg: 'var(--green-light-3)', text: 'var(--green-light-12)' },
  'active': { bg: 'var(--green-light-3)', text: 'var(--green-light-12)' },

  // Lost - Red
  'verloren': { bg: 'var(--red-light-3)', text: 'var(--red-light-12)' },
  'lost': { bg: 'var(--red-light-3)', text: 'var(--red-light-12)' },
  'closed lost': { bg: 'var(--red-light-3)', text: 'var(--red-light-12)' },
  'abgesagt': { bg: 'var(--red-light-3)', text: 'var(--red-light-12)' },
  'cancelled': { bg: 'var(--red-light-3)', text: 'var(--red-light-12)' },
  'storniert': { bg: 'var(--red-light-3)', text: 'var(--red-light-12)' },

  // On Hold/Paused - Gray
  'pausiert': { bg: 'var(--gray-light-3)', text: 'var(--gray-light-12)' },
  'paused': { bg: 'var(--gray-light-3)', text: 'var(--gray-light-12)' },
  'on hold': { bg: 'var(--gray-light-3)', text: 'var(--gray-light-12)' },
  'wartend': { bg: 'var(--gray-light-3)', text: 'var(--gray-light-12)' },
  'waiting': { bg: 'var(--gray-light-3)', text: 'var(--gray-light-12)' },

  // Mint - for renewal/upsell stages
  'renewal': { bg: 'var(--mint-light-3)', text: 'var(--mint-light-12)' },
  'verlängerung': { bg: 'var(--mint-light-3)', text: 'var(--mint-light-12)' },
  'upsell': { bg: 'var(--mint-light-3)', text: 'var(--mint-light-12)' },
  'expansion': { bg: 'var(--mint-light-3)', text: 'var(--mint-light-12)' },
};

// Fallback colors for unknown stages - cycle through these
const FALLBACK_COLORS: StageColorScheme[] = [
  { bg: 'var(--cornflower-light-3)', text: 'var(--cornflower-light-12)' },
  { bg: 'var(--lavender-light-3)', text: 'var(--lavender-light-12)' },
  { bg: 'var(--clementine-light-3)', text: 'var(--clementine-light-12)' },
  { bg: 'var(--orange-light-3)', text: 'var(--orange-light-12)' },
  { bg: 'var(--electric-lime-light-3)', text: 'var(--electric-lime-light-12)' },
  { bg: 'var(--mint-light-3)', text: 'var(--mint-light-12)' },
  { bg: 'var(--green-light-3)', text: 'var(--green-light-12)' },
];

// Simple hash function for consistent color assignment
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Get color scheme for a deal stage
 * Matches against known stage names (case-insensitive, partial match)
 * Falls back to consistent hash-based color for unknown stages
 */
export function getStageColor(stageName: string): StageColorScheme {
  const normalizedName = stageName.toLowerCase().trim();

  // Direct match
  if (STAGE_COLOR_MAP[normalizedName]) {
    return STAGE_COLOR_MAP[normalizedName];
  }

  // Partial match - check if stage name contains any known keyword
  for (const [keyword, colors] of Object.entries(STAGE_COLOR_MAP)) {
    if (normalizedName.includes(keyword) || keyword.includes(normalizedName)) {
      return colors;
    }
  }

  // Fallback: use hash for consistent color assignment
  const colorIndex = hashString(normalizedName) % FALLBACK_COLORS.length;
  return FALLBACK_COLORS[colorIndex];
}

/**
 * Get color scheme for a stage by its position in the pipeline
 * Useful when you want colors based on funnel position rather than name
 */
export function getStageColorByPosition(
  position: number,
  totalStages: number,
  isWon?: boolean,
  isLost?: boolean
): StageColorScheme {
  if (isWon) {
    return { bg: 'var(--green-light-3)', text: 'var(--green-light-12)' };
  }
  if (isLost) {
    return { bg: 'var(--red-light-3)', text: 'var(--red-light-12)' };
  }

  // Map position to color gradient through the funnel
  const progress = position / Math.max(totalStages - 1, 1);

  if (progress < 0.2) {
    return { bg: 'var(--cornflower-light-3)', text: 'var(--cornflower-light-12)' };
  } else if (progress < 0.4) {
    return { bg: 'var(--lavender-light-3)', text: 'var(--lavender-light-12)' };
  } else if (progress < 0.6) {
    return { bg: 'var(--clementine-light-3)', text: 'var(--clementine-light-12)' };
  } else if (progress < 0.8) {
    return { bg: 'var(--orange-light-3)', text: 'var(--orange-light-12)' };
  } else {
    return { bg: 'var(--electric-lime-light-3)', text: 'var(--electric-lime-light-12)' };
  }
}
