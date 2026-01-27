export interface CanvasData {
  dealId: string;
  topBar: TopBarSection;
  header: HeaderSection;
  problemValue: ProblemValueSection;
  solution: SolutionSection;
  decision: DecisionSection;
  roadmap: RoadmapSection;
  lastSaved?: Date;
  isDirty: boolean;
}

// Dachzeile
export interface TopBarSection {
  companyName: string;
  companyLogo?: string;
  productManager: string;
  dealOwner: string;
  dealStage?: string;
}

// Header: Profil, Umsatz, Termin
export interface HeaderSection {
  companyDescription: string;
  revenue: RevenueData;
  nextAppointment: Appointment | null;
}

// Problem & Wert
export interface ProblemValueSection {
  situation: string;  // Pain
  metrics: string;    // Erfolgskennzahlen
}

// Lösung
export interface SolutionSection {
  solution: string;
  upsell: string;
}

// Decision (4 Unterkacheln)
export interface DecisionSection {
  requirements: string;  // Anforderungen
  champion: string;
  competitors: string;   // Wettbewerber
  risks: string;         // Risiken
}

// Roadmap mit Nächste Schritte
export interface RoadmapSection {
  milestones: Milestone[];
  nextSteps: NextStep[];
  startDate: Date;
  endDate: Date;
}

export interface Milestone {
  id: string;
  title: string;
  description?: string;
  date: Date;
  color?: string;
}

export interface RevenueData {
  mrr: number;
  seats: number;
  currency: string;
}

export interface Appointment {
  date: Date;
  title: string;
  description?: string;
}

export interface NextStep {
  id: string;
  title: string;
  dueDate?: Date;
  completed: boolean;
}

export interface HubSpotDeal {
  id: string;
  properties: {
    dealname: string;
    amount?: string;
    dealstage?: string;
    closedate?: string;
    pipeline?: string;
    [key: string]: string | undefined;
  };
  associations?: {
    contacts?: { results: Array<{ id: string }> };
    companies?: { results: Array<{ id: string }> };
  };
}

export interface HubSpotContact {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    jobtitle?: string;
    [key: string]: string | undefined;
  };
}

export interface HubSpotCompany {
  id: string;
  properties: {
    name?: string;
    description?: string;
    domain?: string;
    [key: string]: string | undefined;
  };
}
