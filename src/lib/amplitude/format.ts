// Amplitude-Event-Name → kurzes, lesbares Label. Die Roh-Namen sind teilweise
// sehr lang ("Form Submitted: Signup Modal") oder kryptisch ("su5_registration")
// — wir mappen die häufigsten auf etwas das in eine Tabellen-Spalte passt.
const AMPLITUDE_EVENT_LABELS: Record<string, string> = {
  'Signup Atlantis': 'Signup',
  'su5_registration': 'Signup',
  'su4_form_submit': 'Signup-Step',
  'Form Submitted: Signup Form': 'Signup-Form',
  'Form Submitted: Signup Modal': 'Signup-Modal',
  'Form Submitted: Contact Form': 'Kontaktform',
  'Lead Completed': 'Lead-Formular',
  'lead_form_all': 'Lead-Formular',
  'Click Demo buchen': 'Demo-Klick',
  'Click Kostenlos testen': 'Trial-Klick',
  'plan_select': 'Plan gewählt',
  'pricing_view': 'Pricing-View',
  'Agents Lead Qualification Submitted': 'Quali-Submit',
  'Lead angelegt': 'Lead angelegt',
  'Deal angelegt': 'Deal angelegt',
};

export function formatAmplitudeEvent(eventType: string): string {
  return AMPLITUDE_EVENT_LABELS[eventType] ?? eventType;
}

export function formatAmplitudeMonth(occurredAt: string): string {
  const d = new Date(occurredAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
}
