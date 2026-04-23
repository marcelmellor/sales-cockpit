// Generisches Filter-Modell für Pipeline-Ansichten (Dashboard, Deals, Leads).
// Der `type`-Diskriminator ist bewusst ein freier String, damit verschiedene
// Entitäten (Deals, Leads, …) eigene Felder registrieren können, ohne das
// Kernmodell anzufassen.

export type FilterLogic = 'AND' | 'OR';
// `after` / `before` / `between` werden für Datums- und Zahlenfelder genutzt.
// `equals` / `startsWith` / `contains` werden für Textfelder (`inputKind:
// 'text'`) genutzt — z.B. URL- oder UTM-Felder, wo nicht nur exakter Match,
// sondern auch Präfix- und Teilstring-Suche sinnvoll ist.
export type FilterOperator =
  | 'after'
  | 'before'
  | 'between'
  | 'equals'
  | 'startsWith'
  | 'contains';

export interface FilterCriterion<TType extends string = string> {
  kind: 'criterion';
  id: string;
  type: TType;
  operator: FilterOperator;
  // Feldspezifische Payload — pro Kriterium wird nur die zum InputKind
  // passende Teilmenge genutzt (der Rest bleibt undefined).
  stageId?: string;
  dateFrom: string;
  dateTo?: string;
  numberFrom?: number;
  numberTo?: number;
  stringValue?: string;
  booleanValue?: boolean;
}

export interface FilterGroup<TType extends string = string> {
  kind: 'group';
  id: string;
  logic: FilterLogic;
  children: FilterNode<TType>[];
}

export type FilterNode<TType extends string = string> =
  | FilterCriterion<TType>
  | FilterGroup<TType>;

export interface FilterState<TType extends string = string> {
  logic: FilterLogic;
  children: FilterNode<TType>[];
}

export interface SavedFilterSet<TType extends string = string> {
  id: string;
  name: string;
  filter: FilterState<TType>;
}

// Toggleable Filter-Baustein, der neben dem manuellen Kriterienbaum liegt und
// per Klick aktiv/inaktiv geschaltet wird. Wird für zwei Use-Cases verwendet:
//  1) System-Badges, die fest in der App definiert sind (z.B. "Nur offene
//     Deals", "MRR ≥ 450 €") und standardmäßig aktiv oder inaktiv starten.
//  2) Vom Nutzer gespeicherte Filter-Sets, die aus dem manuellen Baum erzeugt
//     und in localStorage persistiert werden.
// Beim Matchen werden alle aktiven Badges mit dem manuellen Baum AND-verknüpft
// — jedes Badge wird als eigene Gruppe eingehängt.
export interface FilterBadge<TType extends string = string> {
  id: string;
  label: string;
  filter: FilterState<TType>;
  /** true = System-Badge (nicht löschbar). */
  system?: boolean;
  /** Nur für System-Badges relevant: startet default-aktiv, wenn der Nutzer
   *  noch keine Badge-Auswahl im localStorage hat. */
  defaultActive?: boolean;
  /** Badges derselben `orGroup` werden untereinander mit OR kombiniert
   *  (statt dem Default-AND). Für mutuell exklusive Werte einer Dimension
   *  (z.B. ICP-Tier S1/S2/S3/S4), damit Mehrfachauswahl "S1 oder S2" bedeutet
   *  und nicht "S1 und S2" → leere Ergebnismenge. Badges ohne `orGroup` werden
   *  wie bisher alle mit AND an den manuellen Baum gehängt. */
  orGroup?: string;
}

// Welche Art von Eingabefeld die CriterionRow für dieses Feld rendert.
// `stageDate` = Stage-Auswahl + Datum (wie "Stage erreicht" im Deals-Dashboard).
export type FieldInputKind =
  | 'date'
  | 'number'
  | 'stageDate'
  | 'enum'
  | 'boolean'
  | 'text';

export interface FieldStageOption {
  id: string;
  label: string;
}

export interface FieldEnumOption {
  value: string;
  label: string;
}

export interface FieldConfig<TType extends string = string> {
  type: TType;
  label: string;
  inputKind: FieldInputKind;
  // Für inputKind === 'number'
  numberUnit?: string;
  numberPlaceholderFrom?: string;
  numberPlaceholderTo?: string;
  // Für inputKind === 'stageDate'
  stages?: FieldStageOption[];
  // Für inputKind === 'enum'
  enumOptions?: FieldEnumOption[];
  // Für inputKind === 'boolean' — Label-Paar für true/false-Option
  booleanTrueLabel?: string;
  booleanFalseLabel?: string;
  // Für inputKind === 'text' — vorgeschlagene Werte (Autocomplete via
  // <datalist>). Der Benutzer kann aus der Liste wählen oder frei tippen.
  textSuggestions?: string[];
  textPlaceholder?: string;
}
