import type { ReactElement } from "react";
import { DashboardPage } from "../pages/DashboardPage";
import { YukiPage } from "../pages/YukiPage";
import { ExportsPage } from "../pages/ExportsPage";
import { VatMappingPage } from "../pages/VatMappingPage";
import { RgsMappingPage } from "../pages/RgsMappingPage";
import { RgsTaxonomyPage } from "../pages/RgsTaxonomyPage";
import { RgsSettingsPage } from "../pages/RgsSettingsPage";
import { UniversalChartPage } from "../pages/UniversalChartPage";
import { FinCategoriesPage } from "../pages/FinCategoriesPage";
import { TransactionsPage } from "../pages/TransactionsPage";
import { GeneralLedgerPage } from "../pages/GeneralLedgerPage";
import { RelationsView } from "../pages/RelationsPage";
import { OutstandingView } from "../pages/OutstandingView";
import { FinancialStatementsPage } from "../pages/FinancialStatementsPage";
import { BillingPage } from "../pages/BillingPage";
import { SettingsPage } from "../pages/SettingsPage";
import { AdminPage } from "../pages/AdminPage";
import { AdminUsersPage } from "../pages/AdminUsersPage";
import { AdminPlansPage } from "../pages/AdminPlansPage";
import { AdminStatsPage } from "../pages/AdminStatsPage";
import { Placeholder } from "../pages/Placeholder";

/**
 * Single source of truth for the FIN//HUB module navigation. The router, the
 * module sidebar and the per-module sub-navigation are all generated from this.
 * Real pages are wired where they exist; everything else is a scaffold so the
 * information architecture is complete and future modules slot in cleanly.
 * UI labels are Dutch throughout; route paths stay English (stable URLs).
 */
export interface SubPage {
  path: string;
  label: string;
  element: ReactElement;
}

export interface ModuleDef {
  key: string;
  label: string;
  /** Absolute base path, e.g. "/data". The first subpage is the module index. */
  basePath: string;
  /** Emoji icon placeholder until a proper icon set is wired. */
  icon: string;
  platformAdminOnly?: boolean;
  /** Hidden from the main sidebar (reached via the user menu instead). */
  hideFromSidebar?: boolean;
  /** Pinned to the bottom of the sidebar (e.g. Platform Admin). */
  pinBottom?: boolean;
  subpages: SubPage[];
}

const soon = (title: string): ReactElement => <Placeholder title={title} />;

export const MODULES: ModuleDef[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    basePath: "/dashboard",
    icon: "🏠",
    subpages: [
      { path: "overview", label: "Overzicht", element: <DashboardPage /> },
      { path: "sync-status", label: "Synchronisatiestatus", element: soon("Synchronisatiestatus") },
      { path: "data-quality", label: "Datakwaliteit", element: soon("Datakwaliteit") },
      { path: "tasks", label: "Taken & waarschuwingen", element: soon("Taken & waarschuwingen") },
      { path: "activity", label: "Recente activiteit", element: soon("Recente activiteit") },
    ],
  },
  {
    key: "data",
    label: "Gegevens",
    basePath: "/data",
    icon: "🗄️",
    subpages: [
      { path: "connectors", label: "Koppelingen", element: <YukiPage /> },
      { path: "entities", label: "Administraties", element: soon("Administraties") },
      { path: "transactions", label: "Transacties", element: <TransactionsPage /> },
      { path: "general-ledger", label: "Grootboek", element: <GeneralLedgerPage /> },
      { path: "receivables", label: "Debiteuren", element: <OutstandingView kind="debtor" /> },
      { path: "payables", label: "Crediteuren", element: <OutstandingView kind="creditor" /> },
      { path: "relations", label: "Relaties", element: <RelationsView mode="all" /> },
      { path: "source-documents", label: "Brondocumenten", element: soon("Brondocumenten") },
      { path: "sync-history", label: "Synchronisatiegeschiedenis", element: soon("Synchronisatiegeschiedenis") },
      { path: "raw-explorer", label: "Ruwe data", element: soon("Ruwe data") },
    ],
  },
  {
    key: "mappings",
    label: "Toewijzingen",
    basePath: "/mappings",
    icon: "🔀",
    subpages: [
      { path: "account-tax", label: "Grootboek & btw", element: <VatMappingPage /> },
      { path: "rgs", label: "Rekeningkoppelingen (RGS)", element: <RgsMappingPage /> },
      { path: "fin-categories", label: "FIN-categorieën", element: <FinCategoriesPage /> },
      { path: "universal-coa", label: "Universeel rekeningschema", element: <UniversalChartPage /> },
      { path: "relations", label: "Relatiekoppelingen", element: soon("Relatiekoppelingen") },
      { path: "cashflow", label: "Kasstroomkoppelingen", element: soon("Kasstroomkoppelingen") },
      { path: "reporting-structures", label: "Rapportagestructuren", element: soon("Rapportagestructuren") },
      { path: "templates", label: "Standaardsjablonen", element: soon("Standaardsjablonen") },
      { path: "overrides", label: "Administratie-uitzonderingen", element: soon("Administratie-uitzonderingen") },
      { path: "import-export", label: "Import / export", element: soon("Import / export") },
      { path: "audit", label: "Wijzigingslog", element: soon("Wijzigingslog") },
    ],
  },
  {
    key: "consolidation",
    label: "Consolidatie",
    basePath: "/consolidation",
    icon: "🧮",
    subpages: [
      { path: "runs", label: "Consolidatieruns", element: soon("Consolidatieruns") },
      { path: "trial-balance", label: "Geconsolideerde proefbalans", element: soon("Geconsolideerde proefbalans") },
      { path: "pnl", label: "Geconsolideerde W&V", element: soon("Geconsolideerde W&V") },
      { path: "balance-sheet", label: "Geconsolideerde balans", element: soon("Geconsolideerde balans") },
      { path: "intercompany", label: "Intercompany-matching", element: soon("Intercompany-matching") },
      { path: "elimination-rules", label: "Eliminatieregels", element: soon("Eliminatieregels") },
      { path: "elimination-entries", label: "Eliminatieboekingen", element: soon("Eliminatieboekingen") },
      { path: "adjustments", label: "Consolidatiecorrecties", element: soon("Consolidatiecorrecties") },
      { path: "currency-translation", label: "Valutaomrekening", element: soon("Valutaomrekening") },
      { path: "audit", label: "Consolidatie-audit", element: soon("Consolidatie-audit") },
    ],
  },
  {
    key: "reporting",
    label: "Rapportage",
    basePath: "/reporting",
    icon: "📊",
    subpages: [
      { path: "downloads", label: "Downloads", element: <ExportsPage /> },
      { path: "financial-statements", label: "Jaarrekening", element: <FinancialStatementsPage /> },
      { path: "management", label: "Managementrapportages", element: soon("Managementrapportages") },
      { path: "cashflow", label: "Kasstroom", element: soon("Kasstroom") },
      { path: "kpi", label: "KPI-dashboards", element: soon("KPI-dashboards") },
      { path: "aging", label: "Ouderdomsanalyse", element: soon("Ouderdomsanalyse") },
      { path: "intercompany", label: "Intercompany-rapportages", element: soon("Intercompany-rapportages") },
      { path: "audit", label: "Auditrapportages", element: soon("Auditrapportages") },
      { path: "scheduled", label: "Geplande exports", element: soon("Geplande exports") },
      { path: "api", label: "API-toegang", element: soon("API-toegang") },
    ],
  },
  {
    // Reached via the user menu ("Instellingen"), not the module sidebar.
    key: "administration",
    label: "Instellingen",
    basePath: "/administration",
    icon: "⚙️",
    hideFromSidebar: true,
    subpages: [
      { path: "settings", label: "Algemeen", element: <SettingsPage /> },
      { path: "rgs", label: "RGS / normalisatie", element: <RgsSettingsPage /> },
      { path: "billing", label: "Facturatie & abonnement", element: <BillingPage /> },
      { path: "notifications", label: "Meldingen", element: soon("Meldingen") },
      { path: "security", label: "Beveiliging", element: soon("Beveiliging") },
    ],
  },
  {
    key: "platform",
    label: "Platformbeheer",
    basePath: "/platform",
    icon: "🛡️",
    platformAdminOnly: true,
    pinBottom: true,
    subpages: [
      { path: "overview", label: "Werkruimtes & tenants", element: <AdminPage /> },
      { path: "users", label: "Gebruikers", element: <AdminUsersPage /> },
      { path: "plans", label: "Plannen & licenties", element: <AdminPlansPage /> },
      { path: "usage", label: "Statistieken & API-gebruik", element: <AdminStatsPage /> },
      { path: "rgs", label: "RGS-taxonomie", element: <RgsTaxonomyPage /> },
      { path: "connector-registry", label: "Connector-register", element: soon("Connector-register") },
      { path: "connector-health", label: "Connector-status", element: soon("Connector-status") },
      { path: "jobs", label: "Achtergrondtaken", element: soon("Achtergrondtaken") },
      { path: "feature-flags", label: "Feature-flags", element: soon("Feature-flags") },
      { path: "system-logs", label: "Systeemlogs", element: soon("Systeemlogs") },
    ],
  },
];

/** The settings module, reached via the user menu. */
export const SETTINGS_MODULE = MODULES.find((m) => m.key === "administration")!;

/** Legacy → new path redirects so existing links/bookmarks keep working. */
export const LEGACY_REDIRECTS: Record<string, string> = {
  "/yuki": "/data/connectors",
  "/exports": "/reporting/downloads",
  "/vat-mapping": "/mappings/account-tax",
  "/billing": "/administration/billing",
  "/settings": "/administration/settings",
  "/admin": "/platform/overview",
  "/admin/users": "/platform/users",
  "/admin/plans": "/platform/plans",
  "/admin/stats": "/platform/usage",
};
