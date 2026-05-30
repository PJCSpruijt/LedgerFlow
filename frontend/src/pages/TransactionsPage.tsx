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
  reportingAmount?: number;
  reportingCurrency?: string;
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

type SortKey =
  | "date"
  | "amount"
  | "original"
  | "contactName"
  | "reference"
  | "documentType"
  | "description";
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
  { key: "contactName", label: "Relatie", group: "contactName" },
  { key: "reference", label: "Referentie" },
  { key: "documentType", label: "Documenttype", group: "documentType" },
  { key: "description", label: "Omschrijving" },
  { key: "original", label: "Origineel", align: "right" },
  { key: "amount", label: "Bedrag", align: "right" },
];

/** Default column widths (px). Resizable; persisted to localStorage. */
const DEFAULT_WIDTHS: Record<SortKey, number> = {
  date: 110,
  amount: 120,
  original: 120,
  contactName: 200,
  reference: 120,
  documentType: 160,
  description: 340,
};
const WIDTHS_LS = "fh_tx_col_widths";

function compareBy(key: SortKey, a: Tx, b: Tx): number {
  if (key === "amount") return (a.reportingAmount ?? a.amount) - (b.reportingAmount ?? b.amount);
  if (key === "original") return a.amount - b.amount;
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

interface Filters {
  codeFrom: string;
  codeTo: string;
  account: string;
  relation: string;
  reference: string;
  docType: string;
}
const EMPTY_FILTERS: Filters = {
  codeFrom: "",
  codeTo: "",
  account: "",
  relation: "",
  reference: "",
  docType: "",
};
const ci = (s: string | null | undefined, q: string) =>
  (s ?? "").toLowerCase().includes(q.toLowerCase());

/** True when a line passes the active filter bar. Code supports a single value
 *  (prefix/contains) or a from–to range (lexicographic). */
function matchRow(t: Tx, f: Filters): boolean {
  const code = t.glAccountCode || "";
  const lo = f.codeFrom.trim();
  const hi = f.codeTo.trim();
  if (lo && hi) {
    if (!(code >= lo && code <= hi)) return false;
  } else if (lo) {
    if (!code.startsWith(lo) && !code.includes(lo)) return false;
  } else if (hi) {
    if (!(code <= hi)) return false;
  }
  if (f.account.trim() && !ci(t.glAccountName, f.account.trim())) return false;
  if (f.relation.trim() && !ci(t.contactName, f.relation.trim())) return false;
  if (f.reference.trim() && !ci(t.reference, f.reference.trim())) return false;
  if (f.docType.trim() && !ci(t.documentType, f.docType.trim())) return false;
  return true;
}

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
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const filterActive = Object.values(filters).some((v) => v.trim());
  const [widths, setWidths] = useState<Record<SortKey, number>>(() => {
    try {
      const s = localStorage.getItem(WIDTHS_LS);
      if (s) return { ...DEFAULT_WIDTHS, ...JSON.parse(s) };
    } catch {
      /* ignore */
    }
    return DEFAULT_WIDTHS;
  });
  const pdfModal = usePdfModal();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const codeFilter = sp.get("code");
  const relationFilter = sp.get("relation");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["transactions", entity?.id, dateFrom, dateTo, currency],
    queryFn: () =>
      api<{ rows: Tx[] }>(`/api/yuki/transactions?from=${dateFrom}&to=${dateTo}&currency=${currency}`),
    enabled: !!entity,
  });

  // When arriving from General Ledger with a ?code= filter, open that group.
  useEffect(() => {
    if (codeFilter) setExpanded((prev) => new Set(prev).add(codeFilter));
  }, [codeFilter]);

  const groups = useMemo<Group[]>(() => {
    const byCode = new Map<string, Group>();
    for (const t of data?.rows ?? []) {
      if (!matchRow(t, filters)) continue;
      if (relationFilter && (t.contactName ?? "") !== relationFilter) continue;
      const code = t.glAccountCode || "—";
      const g =
        byCode.get(code) ?? { code, name: t.glAccountName || "(geen grootboekrekening)", lines: [], total: 0 };
      if (!g.name || g.name === "(geen grootboekrekening)") g.name = t.glAccountName || g.name;
      g.lines.push(t);
      g.total += t.reportingAmount ?? t.amount;
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
  }, [data, sort, filters, relationFilter]);

  const shownGroups = codeFilter ? groups.filter((g) => g.code === codeFilter) : groups;

  // When filtering by relation, open all matching groups so the lines show.
  useEffect(() => {
    if (relationFilter) setExpanded(new Set(groups.map((g) => g.code)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relationFilter, groups]);

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

  // Column resize: drag a header's right edge; min 60px; persisted on mouse-up.
  const startResize = (key: SortKey, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[key];
    const onMove = (ev: MouseEvent) =>
      setWidths((prev) => ({ ...prev, [key]: Math.max(60, startW + (ev.clientX - startX)) }));
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setWidths((prev) => {
        try {
          localStorage.setItem(WIDTHS_LS, JSON.stringify(prev));
        } catch {
          /* ignore */
        }
        return prev;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const tableWidth = COLUMNS.reduce((s, c) => s + widths[c.key], 0);

  const shownLines = shownGroups.reduce((s, g) => s + g.lines.length, 0);
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
            <button
              className={`lf-link ${filterActive ? "font-semibold" : ""}`}
              onClick={() => setShowFilters((v) => !v)}
            >
              Filters{filterActive ? " ●" : ""} {showFilters ? "▴" : "▾"}
            </button>
            <button className="lf-link" onClick={() => setExpanded(new Set(shownGroups.map((g) => g.code)))}>
              Alles uitklappen
            </button>
            <button className="lf-link" onClick={() => setExpanded(new Set())}>
              Alles inklappen
            </button>
          </div>
        )}
      </div>

      {data && showFilters && (
        <div className="lf-card flex flex-wrap items-end gap-3 text-sm">
          <div>
            <label className="lf-label">Code van</label>
            <input
              className="lf-input font-mono w-24"
              placeholder="01300"
              value={filters.codeFrom}
              onChange={(e) => setFilters({ ...filters, codeFrom: e.target.value })}
            />
          </div>
          <div>
            <label className="lf-label">tot</label>
            <input
              className="lf-input font-mono w-24"
              placeholder="01400"
              value={filters.codeTo}
              onChange={(e) => setFilters({ ...filters, codeTo: e.target.value })}
            />
          </div>
          <div>
            <label className="lf-label">Grootboekrekening</label>
            <input
              className="lf-input w-44"
              placeholder="naam bevat…"
              value={filters.account}
              onChange={(e) => setFilters({ ...filters, account: e.target.value })}
            />
          </div>
          <div>
            <label className="lf-label">Relatie</label>
            <input
              className="lf-input w-40"
              value={filters.relation}
              onChange={(e) => setFilters({ ...filters, relation: e.target.value })}
            />
          </div>
          <div>
            <label className="lf-label">Referentie</label>
            <input
              className="lf-input w-32"
              value={filters.reference}
              onChange={(e) => setFilters({ ...filters, reference: e.target.value })}
            />
          </div>
          <div>
            <label className="lf-label">Documenttype</label>
            <input
              className="lf-input w-40"
              value={filters.docType}
              onChange={(e) => setFilters({ ...filters, docType: e.target.value })}
            />
          </div>
          {filterActive && (
            <button className="lf-link" onClick={() => setFilters(EMPTY_FILTERS)}>
              Wissen
            </button>
          )}
        </div>
      )}

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

      {relationFilter && (
        <div className="lf-card py-2 px-3 text-sm flex items-center gap-2">
          <span className="text-slate-500">Gefilterd op relatie</span>
          <span className="text-slate-700 font-medium">{relationFilter}</span>
          <span className="ml-auto flex items-center gap-3">
            <button className="lf-link" onClick={() => navigate("/data/transactions")}>
              Filter wissen
            </button>
            <button className="lf-btn-secondary" onClick={() => navigate("/data/relations")}>
              ← Terug naar Relaties
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
              {shownGroups.length} grootboekrekening{shownGroups.length === 1 ? "" : "en"} ·{" "}
              {filterActive || relationFilter || codeFilter
                ? `${shownLines} van ${totalLines}`
                : totalLines}{" "}
              regels
            </span>
            <span className="text-slate-400">· bedragen in {currency}</span>
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
            <table className="text-sm border-collapse table-fixed" style={{ width: tableWidth }}>
              <colgroup>
                {COLUMNS.map((col) => (
                  <col key={col.key} style={{ width: widths[col.key] }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  {COLUMNS.map((col) => {
                    const sIdx = sort.findIndex((s) => s.key === col.key);
                    const rule = sIdx === -1 ? null : sort[sIdx];
                    const gs = groupState(col);
                    return (
                      <th
                        key={col.key}
                        className={`relative py-2 px-3 font-medium overflow-hidden whitespace-nowrap ${col.align === "right" ? "text-right" : ""}`}
                      >
                        {/* drag handle on the right edge */}
                        <span
                          onMouseDown={(e) => startResize(col.key, e)}
                          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-brand-300"
                          title="Sleep om de kolombreedte aan te passen"
                        />
                        <span className="inline-flex items-center gap-1 max-w-full">
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
        <td colSpan={COLUMNS.length - 1} className="py-2 px-3 font-medium truncate" title={`${g.code} ${g.name}`}>
          <span className="inline-block w-4 text-slate-400">{open ? "▾" : "▸"}</span>
          <span className="font-mono text-slate-500 mr-2">{g.code}</span>
          {g.name}
          <span className="ml-2 text-xs text-slate-400">({g.lines.length})</span>
        </td>
        <td className={`py-2 px-3 text-right font-semibold whitespace-nowrap ${g.total < 0 ? "text-red-600" : ""}`}>
          {formatMoney(g.total, currency)}
        </td>
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
    const subtotal = sub.reduce((s, t) => s + (t.reportingAmount ?? t.amount), 0);
    out.push(
      <tr key={`${keyPrefix}${v}#h`} className="bg-slate-50/60 border-b border-slate-100">
        <td
          colSpan={COLUMNS.length - 1}
          className="py-1.5 px-3 truncate text-slate-600"
          style={{ paddingLeft: `${indentRem(depth)}rem` }}
          title={groupLabel(field, v)}
        >
          <span className="font-medium">{groupLabel(field, v)}</span>
          <span className="ml-2 text-xs text-slate-400">({sub.length})</span>
        </td>
        <td className={`py-1.5 px-3 text-right font-medium whitespace-nowrap ${subtotal < 0 ? "text-red-600" : ""}`}>
          {formatMoney(subtotal, ctx.currency)}
        </td>
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
      <td className="py-1.5 px-3 truncate" style={{ paddingLeft: `${indentRem(level)}rem` }}>
        {t.date}
      </td>
      <td className="py-1.5 px-3 truncate" title={t.contactName ?? ""}>
        {t.contactName ?? ""}
      </td>
      <td className="py-1.5 px-3 truncate">
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
      <td className="py-1.5 px-3 truncate">
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
      <td className="py-1.5 px-3 truncate" title={t.description}>
        {t.description}
      </td>
      <td className="py-1.5 px-3 text-right whitespace-nowrap text-slate-400">
        {t.reportingCurrency && t.currency && t.reportingCurrency !== t.currency
          ? formatMoney(t.amount, t.currency)
          : ""}
      </td>
      <td className={`py-1.5 px-3 text-right whitespace-nowrap ${(t.reportingAmount ?? t.amount) < 0 ? "text-red-600" : ""}`}>
        {formatMoney(t.reportingAmount ?? t.amount, t.reportingCurrency ?? currency)}
      </td>
    </tr>
  );
}
