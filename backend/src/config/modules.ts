/**
 * The catalog of feature modules a subscription plan can grant.
 *
 * Modules are CODE-DEFINED, not data-defined: each key here corresponds to a real
 * capability that backend middleware (`requireModule`) and the frontend gate on.
 * A plan stores a subset of these keys in `Plan.modules`; the admin UI renders a
 * checkbox per entry below. Adding a module = adding an entry here AND wiring the
 * `requireModule("KEY")` guard onto the feature it protects.
 *
 * Do NOT remove a key that historical plans may still reference without a
 * migration — an unknown key on a plan simply grants nothing, but the label/
 * description disappears from the admin UI.
 */
export interface ModuleDefinition {
  key: string;
  label: string;
  description: string;
}

export const MODULES = [
  {
    key: "EXPORTS",
    label: "Excel-exports",
    description: "Proefbalans- en mutaties-exports naar Excel.",
  },
  {
    key: "YUKI_SYNC",
    label: "Yuki-synchronisatie",
    description: "Live ophalen van proefbalans en mutaties uit Yuki.",
  },
  {
    key: "MULTI_ADMIN",
    label: "Multi-administratie",
    description: "Meerdere administraties combineren in één export of werkruimte.",
  },
  {
    key: "CONSOLIDATION",
    label: "Consolidatie",
    description: "Consolideren over meerdere administraties heen.",
  },
  {
    key: "RGS",
    label: "RGS-normalisatie",
    description:
      "Bronrekeningen koppelen aan het Referentie Grootboekschema (RGS) + FIN-categorieën.",
  },
  {
    key: "AI_INSIGHTS",
    label: "AI-commentaar",
    description: "AI-gegenereerde toelichting bij cijfers (beta).",
  },
  {
    key: "API_ACCESS",
    label: "API-toegang",
    description: "Toegang tot de publieke LedgerFlow API.",
  },
] as const satisfies readonly ModuleDefinition[];

export type ModuleKey = (typeof MODULES)[number]["key"];

export const MODULE_KEYS: ModuleKey[] = MODULES.map((m) => m.key);

const MODULE_KEY_SET: ReadonlySet<string> = new Set(MODULE_KEYS);

export function isModuleKey(value: string): value is ModuleKey {
  return MODULE_KEY_SET.has(value);
}

const LABELS: Record<string, string> = Object.fromEntries(MODULES.map((m) => [m.key, m.label]));

/** Map a list of module keys to their human labels, dropping any unknown keys. */
export function moduleLabels(keys: readonly string[]): string[] {
  return keys.filter(isModuleKey).map((k) => LABELS[k]!);
}
