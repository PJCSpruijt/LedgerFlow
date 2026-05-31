/**
 * Dashboard widget catalogue. The user can enable/disable each widget in
 * Instellingen; preferences are stored server-side as a list of DISABLED keys
 * (so newly added widgets are visible by default).
 */
export interface WidgetDef {
  key: string;
  label: string;
  description: string;
}

export const DASHBOARD_WIDGETS: WidgetDef[] = [
  { key: "revenue", label: "Omzetontwikkeling", description: "Omzet per maand (12 maanden) met voorgaand jaar" },
  { key: "cash", label: "Cashpositie", description: "Liquide middelen" },
  { key: "workingCapital", label: "Werkkapitaal", description: "Kortlopende vorderingen − schulden" },
  { key: "receivables", label: "Openstaande debiteuren", description: "Debiteurensaldo (netto intercompany)" },
  { key: "payables", label: "Openstaande crediteuren", description: "Crediteurensaldo (netto intercompany)" },
  { key: "unmappedRgs", label: "Nog toe te kennen RGS", description: "Rekeningen zonder RGS-koppeling" },
  { key: "unmappedVat", label: "Nog toe te kennen BTW", description: "BTW-codes die nog een koppeling vereisen" },
];

/** A widget is visible unless its key is in the user's disabled list. */
export const isWidgetEnabled = (disabled: string[] | undefined, key: string): boolean =>
  !(disabled ?? []).includes(key);
