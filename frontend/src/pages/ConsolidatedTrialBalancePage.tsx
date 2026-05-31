import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { formatMoney } from "../lib/period";
import { ExportButtons } from "../components/ExportButtons";

interface EntityAmount {
  entityId: string;
  entityName: string;
  amount: number;
}
interface Leaf {
  statement: "PNL" | "BALANCE";
  rgsGroupCode: string;
  rgsGroupName: string;
  rgsGroupOrder: string | null;
  key: string;
  rgsCode: string | null;
  description: string;
  unmapped: boolean;
  total: number;
  byEntity: EntityAmount[];
}
interface Imbalance {
  fromEntityName: string;
  toEntityName: string;
  receivable: number;
  payable: number;
  diff: number;
}
interface ConsolResult {
  from: string;
  to: string;
  currency: string;
  rgsVersion: string;
  groupId: string | null;
  groupName: string | null;
  entities: { entityId: string; entityName: string; included: boolean; reason?: string }[];
  includedEntities: { id: string; name: string }[];
  leaves: Leaf[];
  eliminations: Leaf[];
  imbalances: Imbalance[];
  intercompanyConfigured: boolean;
  warnings: string[];
}

const numOrder = (ref?: string | null) => {
  const n = Number.parseInt(ref ?? "", 10);
  return Number.isNaN(n) ? 9999 : n;
};

interface GroupBlock {
  code: string;
  name: string;
  statement: "PNL" | "BALANCE";
  order: number;
  leaves: Leaf[];
}

/**
 * Consolidated trial balance — the consolidation worksheet. Per RGS leaf: a
 * column for each administration, an intercompany Eliminatie column, and the
 * consolidated total (administraties + eliminatie). The administration columns
 * can be folded into one consolidated view, and the eliminatie column hidden.
 */
export function ConsolidatedTrialBalancePage() {
  const { workspace, group, entity, dateFrom, dateTo, currency } = useScope();
  const [showElim, setShowElim] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["consolidation", workspace?.id, group?.id, entity?.id, dateFrom, dateTo, currency, true],
    queryFn: () =>
      api<ConsolResult>(`/api/consolidation/summary?from=${dateFrom}&to=${dateTo}&currency=${currency}&eliminate=1`),
    enabled: !!workspace,
  });

  const cols = data?.includedEntities ?? [];
  const showEntityCols = !collapsed && cols.length > 0;

  const blocks = useMemo<GroupBlock[]>(() => {
    const byGroup = new Map<string, GroupBlock>();
    for (const l of data?.leaves ?? []) {
      const b =
        byGroup.get(l.rgsGroupCode) ??
        ({ code: l.rgsGroupCode, name: l.rgsGroupName, statement: l.statement, order: 900 + numOrder(l.rgsGroupOrder), leaves: [] } as GroupBlock);
      if (l.rgsGroupCode === "zzzz") b.order = 99999;
      b.leaves.push(l);
      byGroup.set(l.rgsGroupCode, b);
    }
    return [...byGroup.values()].sort((a, b) => a.statement.localeCompare(b.statement) || a.order - b.order || a.code.localeCompare(b.code));
  }, [data]);

  // Intercompany elimination per RGS hoofdrubriek (group-level journal).
  const elimByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data?.eliminations ?? []) m.set(e.rgsGroupCode, (m.get(e.rgsGroupCode) ?? 0) + e.total);
    return m;
  }, [data]);
  const totalElim = [...elimByGroup.values()].reduce((s, v) => s + v, 0);

  const amountFor = (l: Leaf, entityId: string) => l.byEntity.find((b) => b.entityId === entityId)?.amount ?? 0;
  const colTotal = (entityId: string) => (data?.leaves ?? []).reduce((s, l) => s + amountFor(l, entityId), 0);
  const grossTotal = (data?.leaves ?? []).reduce((s, l) => s + l.total, 0);
  const groupGross = (b: GroupBlock) => b.leaves.reduce((s, l) => s + l.total, 0);
  const groupElim = (b: GroupBlock) => (showElim ? elimByGroup.get(b.code) ?? 0 : 0);

  // Number of trailing value columns besides per-entity ones (Eliminatie?, Geconsolideerd/Totaal).
  const consolidatedLabel = showElim ? "Geconsolideerd" : "Totaal";

  const scopeLabel = data?.groupName ? `Groep: ${data.groupName}` : `Werkruimte: ${workspace?.name ?? "—"}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Geconsolideerde proefbalans</h1>
          <p className="text-sm text-slate-500 mt-1">
            {scopeLabel} · {dateFrom} t/m {dateTo} · {currency}
          </p>
        </div>
        <div className="flex items-center gap-3 no-print">
          {data && cols.length > 0 && (
            <button className="lf-link text-xs" onClick={() => setCollapsed((v) => !v)}>
              {collapsed ? "Toon administraties" : "Vouw samen tot geconsolideerd"}
            </button>
          )}
          {data && (
            <button className="lf-link text-xs" onClick={() => setShowElim((v) => !v)}>
              {showElim ? "Verberg eliminatiekolom" : "Toon eliminatiekolom"}
            </button>
          )}
          {data && (
            <ExportButtons
              filename={`geconsolideerde-proefbalans-${dateFrom}_${dateTo}`}
              sheetName="Proefbalans"
              getRows={() =>
                (data.leaves ?? []).map((l) => {
                  const row: Record<string, unknown> = {
                    overzicht: l.statement === "PNL" ? "W&V" : "Balans",
                    rgs_hoofdrubriek: l.rgsGroupName,
                    rgs_code: l.rgsCode ?? "",
                    omschrijving: l.description,
                  };
                  if (showEntityCols) for (const c of cols) row[c.name] = amountFor(l, c.id);
                  if (showElim) row["Eliminatie"] = 0;
                  row[consolidatedLabel] = l.total;
                  return row;
                })
              }
            />
          )}
        </div>
      </div>

      {!workspace && <div className="lf-card max-w-2xl">Selecteer een werkruimte in de bovenbalk.</div>}
      {workspace && isLoading && <div className="lf-card">Consolidatie laden…</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">{error instanceof ApiError ? error.message : "Kon consolidatie niet laden"}</div>
      )}

      {data && showElim && data.imbalances.length > 0 && (
        <div className="lf-card bg-rose-50 ring-rose-200 text-rose-900 text-sm space-y-1">
          <div className="font-medium">Intercompany niet in evenwicht:</div>
          {data.imbalances.map((im, i) => (
            <div key={i}>
              ⚠️ {im.fromEntityName} → {im.toEntityName}: vordering {formatMoney(im.receivable, currency)} vs schuld{" "}
              {formatMoney(im.payable, currency)} (verschil {formatMoney(im.diff, currency)})
            </div>
          ))}
        </div>
      )}

      {data && showElim && !data.intercompanyConfigured && (
        <div className="text-xs text-slate-500">
          Nog geen intercompany-relaties gekoppeld — de eliminatiekolom blijft leeg. Stel ze in via Consolidatie →
          Intercompany-matching.
        </div>
      )}

      {data && data.warnings.length > 0 && (
        <div className="lf-card bg-amber-50 ring-amber-200 text-amber-900 text-sm space-y-1">
          {data.warnings.map((w, i) => (
            <div key={i}>⚠️ {w}</div>
          ))}
        </div>
      )}

      {data && cols.length > 0 && (
        <div className="lf-card overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-300 text-left">
                <th className="py-2 pr-4 font-mono">RGS</th>
                <th className="py-2 pr-4">Omschrijving</th>
                {showEntityCols &&
                  cols.map((c) => (
                    <th key={c.id} className="py-2 px-3 text-right whitespace-nowrap">{c.name}</th>
                  ))}
                {showElim && <th className="py-2 px-3 text-right whitespace-nowrap text-rose-700">Eliminatie</th>}
                <th className="py-2 pl-3 text-right whitespace-nowrap">{consolidatedLabel}</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => {
                const gGross = groupGross(b);
                const gElim = groupElim(b);
                return (
                  <Fragment key={b.code}>
                    <tr className="bg-slate-50/70 border-b border-slate-200">
                      <td className="py-1.5 pr-4 font-medium" colSpan={2}>
                        <span className="text-xs text-slate-400 mr-2">{b.statement === "PNL" ? "W&V" : "Balans"}</span>
                        {b.name}
                      </td>
                      {showEntityCols &&
                        cols.map((c) => (
                          <td key={c.id} className="py-1.5 px-3 text-right font-semibold whitespace-nowrap">
                            {formatMoney(b.leaves.reduce((s, l) => s + amountFor(l, c.id), 0), currency)}
                          </td>
                        ))}
                      {showElim && (
                        <td className={`py-1.5 px-3 text-right font-semibold whitespace-nowrap ${gElim ? "text-rose-700" : "text-slate-300"}`}>
                          {gElim ? formatMoney(gElim, currency) : "·"}
                        </td>
                      )}
                      <td className="py-1.5 pl-3 text-right font-semibold whitespace-nowrap">{formatMoney(gGross + gElim, currency)}</td>
                    </tr>
                    {b.leaves
                      .slice()
                      .sort((x, y) => (x.rgsCode ?? "").localeCompare(y.rgsCode ?? "") || x.description.localeCompare(y.description))
                      .map((l) => (
                        <tr key={l.key} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="py-1 pr-4 pl-4 font-mono text-slate-500 whitespace-nowrap">{l.rgsCode ?? "—"}</td>
                          <td className="py-1 pr-4">{l.description}</td>
                          {showEntityCols &&
                            cols.map((c) => {
                              const v = amountFor(l, c.id);
                              return (
                                <td key={c.id} className={`py-1 px-3 text-right whitespace-nowrap ${v === 0 ? "text-slate-300" : ""}`}>
                                  {v === 0 ? "·" : formatMoney(v, currency)}
                                </td>
                              );
                            })}
                          {showElim && <td className="py-1 px-3 text-right whitespace-nowrap text-slate-300">·</td>}
                          <td className="py-1 pl-3 text-right whitespace-nowrap font-medium">{formatMoney(l.total, currency)}</td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="py-2 pr-4" colSpan={2}>Totaal (debet − credit)</td>
                {showEntityCols &&
                  cols.map((c) => (
                    <td key={c.id} className="py-2 px-3 text-right whitespace-nowrap">{formatMoney(colTotal(c.id), currency)}</td>
                  ))}
                {showElim && (
                  <td className={`py-2 px-3 text-right whitespace-nowrap ${totalElim ? "text-rose-700" : "text-slate-300"}`}>
                    {totalElim ? formatMoney(totalElim, currency) : "·"}
                  </td>
                )}
                <td className="py-2 pl-3 text-right whitespace-nowrap">{formatMoney(grossTotal + (showElim ? totalElim : 0), currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
