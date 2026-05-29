import type { ReactElement } from "react";
import { DashboardPage } from "../pages/DashboardPage";
import { YukiPage } from "../pages/YukiPage";
import { ExportsPage } from "../pages/ExportsPage";
import { VatMappingPage } from "../pages/VatMappingPage";
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
      { path: "overview", label: "Overview", element: <DashboardPage /> },
      { path: "sync-status", label: "Sync Status", element: soon("Sync Status") },
      { path: "data-quality", label: "Data Quality", element: soon("Data Quality") },
      { path: "tasks", label: "Tasks & Warnings", element: soon("Tasks & Warnings") },
      { path: "activity", label: "Recent Activity", element: soon("Recent Activity") },
    ],
  },
  {
    key: "data",
    label: "Data",
    basePath: "/data",
    icon: "🗄️",
    subpages: [
      { path: "connectors", label: "Connectors", element: <YukiPage /> },
      { path: "entities", label: "Entities", element: soon("Entities") },
      { path: "transactions", label: "Transactions", element: soon("Transactions") },
      { path: "general-ledger", label: "General Ledger", element: soon("General Ledger") },
      { path: "receivables", label: "Receivables", element: soon("Receivables") },
      { path: "payables", label: "Payables", element: soon("Payables") },
      { path: "relations", label: "Relations", element: soon("Relations") },
      { path: "source-documents", label: "Source Documents", element: soon("Source Documents") },
      { path: "sync-history", label: "Sync History", element: soon("Sync History") },
      { path: "raw-explorer", label: "Raw Data Explorer", element: soon("Raw Data Explorer") },
    ],
  },
  {
    key: "mappings",
    label: "Mappings",
    basePath: "/mappings",
    icon: "🔀",
    subpages: [
      { path: "account-tax", label: "Account & Tax Mappings", element: <VatMappingPage /> },
      { path: "universal-coa", label: "Universal Chart of Accounts", element: soon("Universal Chart of Accounts") },
      { path: "relations", label: "Relation Mappings", element: soon("Relation Mappings") },
      { path: "cashflow", label: "Cashflow Mappings", element: soon("Cashflow Mappings") },
      { path: "reporting-structures", label: "Reporting Structures", element: soon("Reporting Structures") },
      { path: "templates", label: "Default Templates", element: soon("Default Templates") },
      { path: "overrides", label: "Entity Overrides", element: soon("Entity Overrides") },
      { path: "import-export", label: "Import / Export", element: soon("Import / Export") },
      { path: "audit", label: "Mapping Audit Trail", element: soon("Mapping Audit Trail") },
    ],
  },
  {
    key: "consolidation",
    label: "Consolidation",
    basePath: "/consolidation",
    icon: "🧮",
    subpages: [
      { path: "runs", label: "Consolidation Runs", element: soon("Consolidation Runs") },
      { path: "trial-balance", label: "Consolidated Trial Balance", element: soon("Consolidated Trial Balance") },
      { path: "pnl", label: "Consolidated P&L", element: soon("Consolidated P&L") },
      { path: "balance-sheet", label: "Consolidated Balance Sheet", element: soon("Consolidated Balance Sheet") },
      { path: "intercompany", label: "Intercompany Matching", element: soon("Intercompany Matching") },
      { path: "elimination-rules", label: "Elimination Rules", element: soon("Elimination Rules") },
      { path: "elimination-entries", label: "Elimination Entries", element: soon("Elimination Entries") },
      { path: "adjustments", label: "Consolidation Adjustments", element: soon("Consolidation Adjustments") },
      { path: "currency-translation", label: "Currency Translation", element: soon("Currency Translation") },
      { path: "audit", label: "Consolidation Audit", element: soon("Consolidation Audit") },
    ],
  },
  {
    key: "reporting",
    label: "Reporting",
    basePath: "/reporting",
    icon: "📊",
    subpages: [
      { path: "downloads", label: "Downloads", element: <ExportsPage /> },
      { path: "financial-statements", label: "Financial Statements", element: soon("Financial Statements") },
      { path: "management", label: "Management Reports", element: soon("Management Reports") },
      { path: "cashflow", label: "Cashflow", element: soon("Cashflow") },
      { path: "kpi", label: "KPI Dashboards", element: soon("KPI Dashboards") },
      { path: "aging", label: "Aging Analysis", element: soon("Aging Analysis") },
      { path: "intercompany", label: "Intercompany Reports", element: soon("Intercompany Reports") },
      { path: "audit", label: "Audit Reports", element: soon("Audit Reports") },
      { path: "scheduled", label: "Scheduled Exports", element: soon("Scheduled Exports") },
      { path: "api", label: "API Access", element: soon("API Access") },
    ],
  },
  {
    key: "administration",
    label: "Administration",
    basePath: "/administration",
    icon: "⚙️",
    subpages: [
      { path: "settings", label: "Settings", element: <SettingsPage /> },
      { path: "billing", label: "Billing & Subscription", element: <BillingPage /> },
      { path: "notifications", label: "Notifications", element: soon("Notifications") },
      { path: "security", label: "Security", element: soon("Security") },
    ],
  },
  {
    key: "platform",
    label: "Platform Admin",
    basePath: "/platform",
    icon: "🛡️",
    platformAdminOnly: true,
    subpages: [
      { path: "overview", label: "Workspaces & Tenants", element: <AdminPage /> },
      { path: "users", label: "Global Users", element: <AdminUsersPage /> },
      { path: "plans", label: "Plans & Licensing", element: <AdminPlansPage /> },
      { path: "usage", label: "Statistics & API Usage", element: <AdminStatsPage /> },
      { path: "connector-registry", label: "Connector Registry", element: soon("Connector Registry") },
      { path: "connector-health", label: "Connector Health", element: soon("Connector Health") },
      { path: "jobs", label: "Background Jobs", element: soon("Background Jobs") },
      { path: "feature-flags", label: "Feature Flags", element: soon("Feature Flags") },
      { path: "system-logs", label: "System Logs", element: soon("System Logs") },
    ],
  },
];

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
