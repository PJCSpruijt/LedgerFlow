export const LAB_STATUSES = ["NEW", "UNDER_REVIEW", "PLANNED", "IN_PROGRESS", "BETA", "RELEASED", "DECLINED", "DUPLICATE"] as const;
export type LabStatus = (typeof LAB_STATUSES)[number];
export const LAB_CATEGORIES = ["CONNECTORS", "CONSOLIDATION", "REPORTING", "RGS_MAPPING", "NOTIFICATIONS", "API", "EXPORTS", "AI", "PERFORMANCE", "UX", "SECURITY", "INTEGRATIONS", "OTHER"] as const;
export type LabCategory = (typeof LAB_CATEGORIES)[number];

export const STATUS_LABEL: Record<string, string> = {
  NEW: "Nieuw", UNDER_REVIEW: "In beoordeling", PLANNED: "Gepland", IN_PROGRESS: "In ontwikkeling",
  BETA: "Bèta", RELEASED: "Uitgebracht", DECLINED: "Afgewezen", DUPLICATE: "Duplicaat",
};
export const STATUS_CLS: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-600 ring-slate-200",
  UNDER_REVIEW: "bg-amber-50 text-amber-800 ring-amber-200",
  PLANNED: "bg-blue-50 text-blue-700 ring-blue-200",
  IN_PROGRESS: "bg-violet-50 text-violet-700 ring-violet-200",
  BETA: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  RELEASED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  DECLINED: "bg-slate-50 text-slate-400 ring-slate-200",
  DUPLICATE: "bg-slate-50 text-slate-400 ring-slate-200",
};
export const CATEGORY_LABEL: Record<string, string> = {
  CONNECTORS: "Connectors", CONSOLIDATION: "Consolidatie", REPORTING: "Rapportage", RGS_MAPPING: "RGS & toewijzing",
  NOTIFICATIONS: "Meldingen", API: "API", EXPORTS: "Exports", AI: "AI", PERFORMANCE: "Performance",
  UX: "UX/UI", SECURITY: "Beveiliging", INTEGRATIONS: "Integraties", OTHER: "Overig",
};
