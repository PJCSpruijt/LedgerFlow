import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { formatMoney } from "../lib/period";
import { ExportButtons } from "../components/ExportButtons";
import { categorize, display, type Cat, type StmtLine } from "../lib/rgsPresentation";

interface EntityAmount {
  entityId: string;
  entityName: string;
  amount: number;
}
interface Leaf extends StmtLine {
  statement: "PNL" | "BALANCE";
  key: string;
  rgsCode: string | null;
  unmapped: boolean;
  total: number;
  byEntity: EntityAmount[];
}
interface ConsolResult {
  from: string;
  to: string;
  currency: string;
  rgsVersion: string;
  rgsEnabled: boolean;
  groupId: string | null;
  groupName: string | null;
  entities: { entityId: string; entityName: string; included: boolean; reason?: string }[];
  includedEntities: { id: string; name: string }[];
  leaves: {
    statement: "PNL" | "BALANCE";
    rgsGroupCode: string;
    rgsGroupName: string;
    rgsGroupDc: string | null;
    rgsGroupOrder: string | null;
    key: string;
    rgsCode: string | null;
    description: string;
    unmapped: boolean;
    total: number;
    byEntity: EntityAmount[];
  }[];
  warnings: string[];
}

/** Map a consolidation leaf onto the shared statement-line shape. */
const toLine = (l: ConsolResult["leaves"][number]): Leaf => ({
  glAccountCode: l.rgsCode ?? l.key,
  glAccountName: l.description,
  balance: l.total,
  rgsGroupCode: l.rgsGroupCode,
  rgsGroupName: l.rgsGroupName,
  rgsGroupOrder: l.rgsGroupOrder,
  rgsGroupDc: l.rgsGroupDc,
  statement: l.statement,
  key: l.key,
  rgsCode: l.rgsCode,
  unmapped: l.unmapped,
  total: l.total,
  byEntity: l.byEntity,
});

/**
 * Consolidated jaarrekening (RGS-B): one set of figures aggregated across every
 * administration in the scope (group, or whole workspace), keyed by RGS code and
 * in one reporting currency. Each leaf can be expanded to its per-entity build-up.
 * `show` selects W&V only, balans only, or both.
 */
export function ConsolidatedStatementsPage({ show = "both" }: { show?: "both" | "pnl" | "balance" }) {
  const { workspace, group, entity, dateFrom, dateTo, currency } = useScope();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [openLeaf, setOpenLeaf] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["consolidation", workspace?.id, group?.id, entity?.id, dateFrom, dateTo, currency],
    queryFn: () =>
      api<ConsolResult>(`/api/consolidation/summary?from=${dateFrom}&to=${dateTo}&currency=${currency}`),
    enabled: !!workspace,
  });

  const leaves = useMemo(() => (data?.leaves ?? []).map(toLine), [data]);
  const pnlCats = useMemo(() => categorize(leaves.filter((l) => l.statement === "PNL"), "pnl"), [leaves]);
  const balanceCats = useMemo(() => categorize(leaves.filter((l) => l.statement === "BALANCE"), "balance"), [leaves]);
  const result = -leaves.filter((l) => l.statement === "PNL").reduce((s, l) => s + l.total, 0);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, code: string) => {
    const n = new Set(set);
    n.has(code) ? n.delete(code) : n.add(code);
    setter(n);
  };

  const scopeLabel = data?.groupName ? `Groep: ${data.groupName}` : `Werkruimte: ${workspace?.name ?? "—"}`;

  const LeafRows = ({ cats, kind }: { cats: Cat<Leaf>[]; kind: "balance" | "pnl" }) =>
    cats.map((c) => {
      const isOpen = open.has(c.code + kind);
      return (
        <Fragment key={c.code + kind}>
          <tr
            className="border-b border-slate-200 bg-slate-50/70 cursor-pointer hover:bg-slate-100"
            onClick={() => toggle(open, setOpen, c.code + kind)}
          >
            <td className="py-2 pr-4 pl-2 font-medium" colSpan={2}>
              <span className="inline-block w-4 text-slate-400">{isOpen ? "▾" : "▸"}</span>
              {c.name}
              <span className="ml-2 text-xs text-slate-400">({c.lines.length})</span>
            </td>
            <td className="py-2 pr-4 text-right font-semibold whitespace-nowrap">
              {formatMoney(display(c.raw, kind, c.side), currency)}
            </td>
          </tr>
          {isOpen &&
            c.lines
              .slice()
              .sort((a, b) => a.glAccountCode.localeCompare(b.glAccountCode))
              .map((r) => {
                const leafOpen = openLeaf.has(r.key);
                return (
                  <Fragment key={r.key}>
                    <tr
                      className="border-b border-slate-50 cursor-pointer hover:bg-slate-50"
                      title="Toon opbouw per administratie"
                      onClick={() => toggle(openLeaf, setOpenLeaf, r.key)}
                    >
                      <td className="py-1.5 pr-4 pl-8 font-mono text-slate-500 w-28">
                        <span className="inline-block w-3 text-slate-300">{r.byEntity.length > 1 ? (leafOpen ? "▾" : "▸") : ""}</span>
                        {r.rgsCode ?? "—"}
                      </td>
                      <td className="py-1.5 pr-4">{r.glAccountName}</td>
                      <td className="py-1.5 pr-4 text-right whitespace-nowrap">
                        {formatMoney(display(r.total, kind, c.side), currency)}
                      </td>
                    </tr>
                    {leafOpen &&
                      r.byEntity.map((b) => (
                        <tr key={r.key + b.entityId} className="text-xs text-slate-500">
                          <td></td>
                          <td className="py-1 pr-4 pl-8">{b.entityName}</td>
                          <td className="py-1 pr-4 text-right whitespace-nowrap">
                            {formatMoney(display(b.amount, kind, c.side), currency)}
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
        </Fragment>
      );
    });

  const Block = ({ label, cats, kind }: { label: string; cats: Cat<Leaf>[]; kind: "balance" | "pnl" }) => {
    if (cats.length === 0) return null;
    const total = cats.reduce((s, c) => s + display(c.raw, kind, c.side), 0);
    return (
      <>
        <tr>
          <td colSpan={3} className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {label}
          </td>
        </tr>
        <LeafRows cats={cats} kind={kind} />
        <tr className="border-t border-slate-300 font-semibold">
          <td className="py-1.5 pr-4 pl-2" colSpan={2}>
            Totaal {label.toLowerCase()}
          </td>
          <td className="py-1.5 pr-4 text-right whitespace-nowrap">{formatMoney(total, currency)}</td>
        </tr>
      </>
    );
  };

  const title = show === "pnl" ? "Geconsolideerde winst- en verliesrekening" : show === "balance" ? "Geconsolideerde balans" : "Geconsolideerde jaarrekening";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {scopeLabel} · {dateFrom} t/m {dateTo} · {currency}
          </p>
        </div>
        {data && (
          <ExportButtons
            filename={`geconsolideerd-${dateFrom}_${dateTo}`}
            sheetName="Geconsolideerd"
            getRows={() => [
              ...pnlCats.map((c) => ({ overzicht: "Winst & verlies", zijde: c.side, rgs_code: c.code, categorie: c.name, bedrag: display(c.raw, "pnl", c.side), rekeningen: c.lines.length })),
              ...balanceCats.map((c) => ({ overzicht: "Balans", zijde: c.side, rgs_code: c.code, categorie: c.name, bedrag: display(c.raw, "balance", c.side), rekeningen: c.lines.length })),
            ]}
          />
        )}
      </div>

      {/* Entity chips: which administrations are in / left out */}
      {data && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">Administraties:</span>
          {data.entities.map((e) => (
            <span
              key={e.entityId}
              title={e.included ? "Meegeconsolideerd" : `Niet meegenomen: ${e.reason ?? "onbekend"}`}
              className={`px-2 py-0.5 rounded-full ${e.included ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-400 line-through"}`}
            >
              {e.entityName}
            </span>
          ))}
        </div>
      )}

      {!workspace && <div className="lf-card max-w-2xl">Selecteer een werkruimte in de bovenbalk.</div>}
      {workspace && isLoading && <div className="lf-card">Consolidatie laden… (administraties worden parallel opgehaald)</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">{error instanceof ApiError ? error.message : "Kon consolidatie niet laden"}</div>
      )}

      {data && data.warnings.length > 0 && (
        <div className="lf-card bg-amber-50 ring-amber-200 text-amber-900 text-sm space-y-1">
          {data.warnings.map((w, i) => (
            <div key={i}>⚠️ {w}</div>
          ))}
        </div>
      )}

      {data && data.includedEntities.length === 0 && (
        <div className="lf-card text-sm text-slate-600">Geen administraties om te consolideren in deze scope.</div>
      )}

      {data && data.includedEntities.length > 0 && (
        <div className={`grid grid-cols-1 ${show === "both" ? "lg:grid-cols-2" : ""} gap-4`}>
          {(show === "both" || show === "pnl") && (
            <div className="lf-card">
              <h2 className="text-lg font-semibold mb-2">Winst- en verliesrekening</h2>
              <table className="w-full text-sm">
                <tbody>
                  <LeafRows cats={pnlCats} kind="pnl" />
                  {pnlCats.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-3 text-slate-400">Geen posten.</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-semibold">
                    <td className="py-2 pr-4" colSpan={2}>Geconsolideerd resultaat (winst +)</td>
                    <td className="py-2 pr-4 text-right">{formatMoney(result, currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {(show === "both" || show === "balance") && (
            <div className="lf-card">
              <h2 className="text-lg font-semibold mb-2">Balans</h2>
              <table className="w-full text-sm">
                <tbody>
                  <Block label="Activa" cats={balanceCats.filter((c) => c.side === "ACTIVA")} kind="balance" />
                  <Block label="Passiva" cats={balanceCats.filter((c) => c.side === "PASSIVA")} kind="balance" />
                  <Block label="Overig" cats={balanceCats.filter((c) => c.side === "OVERIG")} kind="balance" />
                  {balanceCats.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-3 text-slate-400">Geen posten.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
