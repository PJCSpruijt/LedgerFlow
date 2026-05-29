import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { formatMoney } from "../lib/period";
import { usePdfModal } from "../components/PdfModal";

interface Tx {
  date: string;
  glAccountCode: string;
  glAccountName: string;
  amount: number;
  contactName: string | null;
  reference: string | null;
  documentType: string | null;
  documentId?: string | null;
  description: string;
  currency: string;
  generatedByConnector?: boolean;
  vatCode?: string | null;
  mappingConfidence?: "EXACT" | "INFERRED" | "REQUIRED";
}

interface Group {
  code: string;
  name: string;
  lines: Tx[];
  total: number;
}

type SortKey = "date" | "amount" | "contactName" | "reference" | "documentType" | "description";
type SortDir = "asc" | "desc";
interface SortRule {
  key: SortKey;
  dir: SortDir;
}

/** Secondary grouping fields, nested under the grootboekrekening grouping. */
type GroupField = "contactName" | "documentType" | "month" | "day";

const MONTHS_NL = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

interface ColumnDef {
  key: SortKey;
  label: string;
  align?: "right";
  /** Grouping handle for this column. "date" cycles month → day → off. */
  group?: "contactName" | "documentType" | "date";
}

const COLUMNS: ColumnDef[] = [
  { key: "date", label: "Datum", group: "date" },
  { key: "amount", label: "Bedrag", align: "right" },
  { key: "contactName", label: "Relatie", group: "contactName" },
  { key: "reference", label: "Referentie" },
  { key: "documentType", label: "Documenttype", group: "documentType" },
  { key: "description", label: "Omschrijving" },
];

function compareBy(key: SortKey, a: Tx, b: Tx): number {
  if (key === "amount") return a.amount - b.amount;
  if (key === "date") return a.date.localeCompare(b.date);
  const av = (a[key] ?? "") as string;
  const bv = (b[key] ?? "") as string;
  return av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
}

function groupValue(field: GroupField, t: Tx): string {
  switch (field) {
    case "contactName":
      return t.contactName?.trim() || "(geen relatie)";
    case "documentType":
      return t.documentType?.trim() || "(geen type)";
    case "month":
      return t.date.slice(0, 7);
    case "day":
      return t.date;
  }
}

function groupLabel(field: GroupField, value: string): string {
  if (field === "month") {
    const [y, m] = value.split("-").map(Number);
    return m ? `${MONTHS_NL[m - 1]} ${y}` : value;
  }
  return value;
}

/** Left padding (rem) for a row at a given tree level. Grootboekrekening = -1. */
const indentRem = (level: number) => 0.75 + (level + 1) * 1.1;

function ConfidenceBadge({ c }: { c?: "EXACT" | "INFERRED" | "REQUIRED" }) {
  if (!c) return null;
  const map = {
    EXACT: "bg-emerald-100 text-emerald-800",
    INFERRED: "bg-blue-100 text-blue-800",
    REQUIRED: "bg-amber-100 text-amber-800",
  } as const;
  const label = { EXACT: "mapping", INFERRED: "afgeleid", REQUIRED: "mapping vereist" }[c];
  return <span className={`lf-pill ${map[c]}`}>{label}</span>;
}

export function TransactionsPage() {
  const { entity, dateFrom, dateTo, currency } = useScope();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortRule[]>([]);
  const [groupBy, setGroupBy] = useState<GroupField[]>([]);
  const pdfModal = usePdfModal();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const codeFilter = sp.get("code");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["transactions", entity?.id, dateFrom, dateTo],
    queryFn: () => api<{ rows: Tx[] }>(`/api/yuki/transactions?from=${dateFrom}&to=${dateTo}`),
    enabled: !!entity,
  });

  // When arriving from General Ledger with a ?code= filter, open that group.
  useEffect(() => {
    if (codeFilter) setExpanded((prev) => new Set(prev).add(codeFilter));
  }, [codeFilter]);

  const groups = useMemo<Group[]>(() => {
    const byCode = new Map<string, Group>();
    for (const t of data?.rows ?? []) {
      const code = t.glAccountCode || "—";
      const g =
        byCode.get(code) ?? { code, name: t.glAccountName || "(geen grootboekrekening)", lines: [], total: 0 };
      if (!g.name || g.name === "(geen grootboekrekening)") g.name = t.glAccountName || g.name;
      g.lines.push(t);
      g.total += t.amount;
      byCode.set(code, g);
    }
    // Sort lines within each subgroup by the user's column-priority order.
    if (sort.length) {
      const cmp = (a: Tx, b: Tx) => {
        for (const { key, dir } of sort) {
          const c = compareBy(key, a, b);
          if (c !== 0) return dir === "asc" ? c : -c;
        }
        return 0;
      };
      for (const g of byCode.values()) g.lines.sort(cmp);
    }
    return [...byCode.values()].sort((a, b) =>
      a.code === "—" ? 1 : b.code === "—" ? -1 : a.code.localeCompare(b.code),
    );
  }, [data, sort]);

  const shownGroups = codeFilter ? groups.filter((g) => g.code === codeFilter) : groups;

  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });

  // Click a header: toggle its direction if already sorted, else append it as
  // the lowest-priority sort key (so the first column you click sorts first).
  const onHeaderClick = (key: SortKey) =>
    setSort((prev) => {
      const i = prev.findIndex((s) => s.key === key);
      if (i === -1) return [...prev, { key, dir: "asc" }];
      const next = prev.slice();
      next[i] = { key, dir: next[i].dir === "asc" ? "desc" : "asc" };
      return next;
    });
  const removeSort = (key: SortKey) => setSort((prev) => prev.filter((s) => s.key !== key));

  // Click a column's group handle. Relatie/Documenttype toggle on/off; the
  // Datum handle cycles maand → dag → uit (only one date level at a time).
  const toggleGroup = (col: ColumnDef) =>
    setGroupBy((prev) => {
      if (col.group === "date") {
        if (prev.includes("month")) return prev.map((f) => (f === "month" ? "day" : f));
        if (prev.includes("day")) return prev.filter((f) => f !== "day");
        return [...prev, "month"];
      }
      const field = col.group as GroupField;
      return prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field];
    });

  /** Active grouping field for a column, plus its 1-based nesting order. */
  const groupState = (col: ColumnDef): { field: GroupField; order: number; isDay?: boolean } | null => {
    if (!col.group) return null;
    if (col.group === "date") {
      const i = groupBy.findIndex((f) => f === "month" || f === "day");
      return i === -1 ? null : { field: groupBy[i], order: i + 1, isDay: groupBy[i] === "day" };
    }
    const i = groupBy.indexOf(col.group as GroupField);
    return i === -1 ? null : { field: col.group as GroupField, order: i + 1 };
  };

  const totalLines = data?.rows.length ?? 0;
  const filteredName = codeFilter ? groups.find((g) => g.code === codeFilter)?.name : null;

  return (
    <div className="space-y-4">
      {pdfModal.element}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Transacties</h1>
          <p className="text-sm text-slate-500 mt-1">
            {entity ? `${entity.name} · ${dateFrom} t/m ${dateTo}` : "Selecteer een administratie"}
          </p>
        </div>
        {data && (
          <div className="flex gap-3 text-xs items-center">
            <button className="lf-link" onClick={() => setExpanded(new Set(shownGroups.map((g) => g.code)))}>
              Alles uitklappen
            </button>
            <button className="lf-link" onClick={() => setExpanded(new Set())}>
              Alles inklappen
            </button>
          </div>
        )}
      </div>

      {codeFilter && (
        <div className="lf-card py-2 px-3 text-sm flex items-center gap-2">
          <span className="text-slate-500">Gefilterd op grootboekrekening</span>
          <span className="font-mono">{codeFilter}</span>
          {filteredName && <span className="text-slate-700">{filteredName}</span>}
          <span className="ml-auto flex items-center gap-3">
            <button className="lf-link" onClick={() => navigate("/data/transactions")}>
              Filter wissen
            </button>
            <button className="lf-btn-secondary" onClick={() => navigate("/data/general-ledger")}>
              ← Terug naar Grootboek
            </button>
          </span>
        </div>
      )}

      {!entity && <div className="lf-card max-w-2xl">Selecteer een administratie in de bovenbalk.</div>}
      {entity && isLoading && <div className="lf-card">Transacties laden…</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">
          {error instanceof ApiError ? error.message : "Kon transacties niet laden"}
        </div>
      )}

      {entity && data && (
        <div className="lf-card p-0">
          <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-100 flex items-center gap-3">
            <span>
              {shownGroups.length} grootboekrekening{shownGroups.length === 1 ? "" : "en"} · {totalLines} regels
            </span>
            {groupBy.length > 0 && (
              <span className="text-slate-400">
                · Subtotalen per {groupBy.map((f) => GROUP_FIELD_LABEL[f]).join(" › ")}
              </span>
            )}
            <span className="ml-auto flex items-center gap-3">
              {groupBy.length > 0 && (
                <button className="lf-link" onClick={() => setGroupBy([])}>
                  Groepering wissen
                </button>
              )}
              {sort.length > 0 && (
                <button className="lf-link" onClick={() => setSort([])}>
                  Sortering wissen
                </button>
              )}
            </span>
          </div>
          {/* Scroll within the frame; top + side menu stay fixed. Sticky header. */}
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  {COLUMNS.map((col) => {
                    const sIdx = sort.findIndex((s) => s.key === col.key);
                    const rule = sIdx === -1 ? null : sort[sIdx];
                    const gs = groupState(col);
                    return (
                      <th
                        key={col.key}
                        className={`py-2 px-3 font-medium whitespace-nowrap ${col.align === "right" ? "text-right" : ""}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          <button
                            className="select-none hover:text-slate-700 cursor-pointer"
                            onClick={() => onHeaderClick(col.key)}
                            title="Klik om te sorteren"
                          >
                            {col.label}
                          </button>
                          {rule && (
                            <span className="text-slate-400">
                              {rule.dir === "asc" ? "▲" : "▼"}
                              {sort.length > 1 && <span className="text-[10px] align-super">{sIdx + 1}</span>}
                              <button
                                className="ml-0.5 text-slate-300 hover:text-red-500"
                                title="Verwijder uit sortering"
                                onClick={() => removeSort(col.key)}
                              >
                                ✕
                              </button>
                            </span>
                          )}
                          {col.group && (
                            <button
                              className={`ml-0.5 rounded px-1 leading-none ${
                                gs ? "bg-brand-100 text-brand-700" : "text-slate-300 hover:text-slate-600"
                              }`}
                              title={
                                col.group === "date"
                                  ? "Groeperen op datum (maand → dag → uit)"
                                  : "Groeperen op deze kolom"
                              }
                              onClick={() => toggleGroup(col)}
                            >
                              ⊞
                              {gs && (
                                <span className="text-[10px] align-super ml-0.5">
                                  {gs.isDay ? "D" : col.group === "date" ? "M" : ""}
                                  {groupBy.length > 1 ? gs.order : ""}
                                </span>
                              )}
                            </button>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {shownGroups.map((g) => (
                  <GroupBlock
                    key={g.code}
                    g={g}
                    open={expanded.has(g.code)}
                    onToggle={() => toggle(g.code)}
                    currency={currency}
                    onOpenPdf={pdfModal.open}
                    groupBy={groupBy}
                  />
                ))}
                {shownGroups.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} className="py-3 px-3 text-slate-400">
                      Geen transacties in deze periode.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const GROUP_FIELD_LABEL: Record<GroupField, string> = {
  contactName: "relatie",
  documentType: "documenttype",
  month: "maand",
  day: "dag",
};

function GroupBlock({
  g,
  open,
  onToggle,
  currency,
  onOpenPdf,
  groupBy,
}: {
  g: Group;
  open: boolean;
  onToggle: () => void;
  currency: string;
  onOpenPdf: (ref: string, name: string) => void;
  groupBy: GroupField[];
}) {
  return (
    <>
      <tr className="bg-white border-b border-slate-200 cursor-pointer hover:bg-slate-50" onClick={onToggle}>
        <td className="py-2 px-3 font-medium whitespace-nowrap">
          <span className="inline-block w-4 text-slate-400">{open ? "▾" : "▸"}</span>
          <span className="font-mono text-slate-500 mr-2">{g.code}</span>
          {g.name}
          <span className="ml-2 text-xs text-slate-400">({g.lines.length})</span>
        </td>
        <td className={`py-2 px-3 text-right font-semibold whitespace-nowrap ${g.total < 0 ? "text-red-600" : ""}`}>
          {formatMoney(g.total, currency)}
        </td>
        <td colSpan={COLUMNS.length - 2} />
      </tr>
      {open && buildRows(g.lines, groupBy, 0, groupBy.length, { currency, onOpenPdf }, `${g.code}/`)}
    </>
  );
}

/** Recursively render subtotal header rows + leaf lines for one grootboekrekening. */
function buildRows(
  lines: Tx[],
  fields: GroupField[],
  depth: number,
  leafLevel: number,
  ctx: { currency: string; onOpenPdf: (ref: string, name: string) => void },
  keyPrefix: string,
): ReactNode[] {
  if (fields.length === 0) {
    return lines.map((t, i) => (
      <LineRow key={`${keyPrefix}${i}`} t={t} level={leafLevel} currency={ctx.currency} onOpenPdf={ctx.onOpenPdf} />
    ));
  }
  const [field, ...rest] = fields;
  const byVal = new Map<string, Tx[]>();
  for (const t of lines) {
    const v = groupValue(field, t);
    if (!byVal.has(v)) byVal.set(v, []);
    byVal.get(v)!.push(t);
  }
  const entries = [...byVal.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { numeric: true }),
  );
  const out: ReactNode[] = [];
  for (const [v, sub] of entries) {
    const subtotal = sub.reduce((s, t) => s + t.amount, 0);
    out.push(
      <tr key={`${keyPrefix}${v}#h`} className="bg-slate-50/60 border-b border-slate-100">
        <td className="py-1.5 px-3 whitespace-nowrap text-slate-600" style={{ paddingLeft: `${indentRem(depth)}rem` }}>
          <span className="font-medium">{groupLabel(field, v)}</span>
          <span className="ml-2 text-xs text-slate-400">({sub.length})</span>
        </td>
        <td className={`py-1.5 px-3 text-right font-medium whitespace-nowrap ${subtotal < 0 ? "text-red-600" : ""}`}>
          {formatMoney(subtotal, ctx.currency)}
        </td>
        <td colSpan={COLUMNS.length - 2} />
      </tr>,
    );
    out.push(...buildRows(sub, rest, depth + 1, leafLevel, ctx, `${keyPrefix}${v}/`));
  }
  return out;
}

function LineRow({
  t,
  level,
  currency,
  onOpenPdf,
}: {
  t: Tx;
  level: number;
  currency: string;
  onOpenPdf: (ref: string, name: string) => void;
}) {
  return (
    <tr className="border-b border-slate-50 text-slate-700">
      <td className="py-1.5 px-3 whitespace-nowrap" style={{ paddingLeft: `${indentRem(level)}rem` }}>
        {t.date}
      </td>
      <td className={`py-1.5 px-3 text-right whitespace-nowrap ${t.amount < 0 ? "text-red-600" : ""}`}>
        {formatMoney(t.amount, t.currency || currency)}
      </td>
      <td className="py-1.5 px-3 whitespace-nowrap">{t.contactName ?? ""}</td>
      <td className="py-1.5 px-3 whitespace-nowrap">
        {t.documentId ? (
          <button
            className="lf-link"
            title="Bekijk factuur (PDF)"
            onClick={() => onOpenPdf(t.documentId!, t.reference ?? t.documentType ?? "factuur")}
          >
            {t.reference ?? "factuur"}
          </button>
        ) : (
          (t.reference ?? "")
        )}
      </td>
      <td className="py-1.5 px-3 whitespace-nowrap">
        {t.documentId ? (
          <button
            className="lf-link"
            title="Bekijk factuur (PDF)"
            onClick={() => onOpenPdf(t.documentId!, t.reference ?? t.documentType ?? "factuur")}
          >
            {t.documentType ?? "factuur"}
          </button>
        ) : (
          (t.documentType ?? "")
        )}
        {t.generatedByConnector && (
          <span className="ml-2">
            <ConfidenceBadge c={t.mappingConfidence} />
          </span>
        )}
      </td>
      <td className="py-1.5 px-3 whitespace-nowrap">{t.description}</td>
    </tr>
  );
}
