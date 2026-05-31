import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { formatMoney } from "../lib/period";
import { ExportButtons } from "../components/ExportButtons";
import { categorize, display, type Cat, type Side } from "../lib/rgsPresentation";
import { ConsolidatedStatementsPage } from "./ConsolidatedStatementsPage";

interface TbLine {
  glAccountCode: string;
  glAccountName: string;
  accountType: "BALANCE" | "PROFIT_LOSS" | "UNKNOWN";
  debit: number;
  credit: number;
  balance: number;
  currency: string;
  rgsGroupCode?: string | null;
  rgsGroupName?: string | null;
  rgsGroupOrder?: string | null;
  rgsGroupDc?: string | null;
}

export function FinancialStatementsPage() {
  const { view } = useScope();
  // "Geconsolideerd" / eliminatie-weergaven in de bovenbalk → geconsolideerde
  // jaarrekening over de groep/werkruimte i.p.v. één administratie. Switch op de
  // componentgrens zodat geen tak voorwaardelijk hooks aanroept.
  if (view === "consolidated" || view === "after_eliminations" || view === "eliminations_only")
    return <ConsolidatedStatementsPage show="both" />;
  return <SingleEntityStatements />;
}

function SingleEntityStatements() {
  const { entity, dateFrom, dateTo, currency } = useScope();
  const navigate = useNavigate();
  const range = { from: dateFrom, to: dateTo };
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [grouped, setGrouped] = useState(true);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["trial-balance", entity?.id, range.from, range.to],
    queryFn: () =>
      api<{ rows: TbLine[] }>(`/api/yuki/trial-balance?from=${range.from}&to=${range.to}`),
    enabled: !!entity,
  });

  const rows = data?.rows ?? [];
  const hasRgs = rows.some((r) => r.rgsGroupCode);
  const useGroups = hasRgs && grouped;
  const pnl = rows.filter((r) => r.accountType === "PROFIT_LOSS");
  const rawBalance = rows.filter((r) => r.accountType !== "PROFIT_LOSS");
  const pnlSum = pnl.reduce((s, r) => s + r.balance, 0);
  const result = -pnlSum;
  // Book the result for the year as a separate equity line so the balance sheet
  // actually balances (the P&L result isn't appropriated to equity until close).
  const balance = useMemo<TbLine[]>(() => {
    if (Math.abs(pnlSum) < 0.005) return rawBalance;
    const resultLine: TbLine = {
      glAccountCode: "RESULTAAT",
      glAccountName: "Resultaat boekjaar",
      accountType: "BALANCE",
      debit: 0,
      credit: 0,
      balance: pnlSum,
      currency,
      rgsGroupCode: "BEiv",
      rgsGroupName: "Eigen vermogen",
      rgsGroupOrder: null,
      rgsGroupDc: "C",
    };
    return [...rawBalance, resultLine];
  }, [rawBalance, pnlSum, currency]);
  const balanceTotal = balance.reduce((s, r) => s + r.balance, 0);

  const toggle = (code: string) =>
    setOpen((p) => {
      const n = new Set(p);
      n.has(code) ? n.delete(code) : n.add(code);
      return n;
    });

  const Account = ({ r, kind, side }: { r: TbLine; kind: "balance" | "pnl"; side: Side }) => (
    <tr
      className="border-b border-slate-50 cursor-pointer hover:bg-slate-50"
      title="Bekijk transacties van deze grootboekrekening"
      onClick={() => navigate(`/data/transactions?code=${encodeURIComponent(r.glAccountCode)}`)}
    >
      <td className="py-1.5 pr-4 pl-8 font-mono text-slate-500 w-24">{r.glAccountCode}</td>
      <td className="py-1.5 pr-4">{r.glAccountName}</td>
      <td className="py-1.5 pr-4 text-right whitespace-nowrap">
        {formatMoney(useGroups ? display(r.balance, kind, side) : r.balance, currency)}
      </td>
    </tr>
  );

  const CatRows = ({ cats, kind }: { cats: Cat<TbLine>[]; kind: "balance" | "pnl" }) =>
    cats.map((c) => {
      const isOpen = open.has(c.code);
      return (
        <Fragment key={c.code}>
          <tr
            className="border-b border-slate-200 bg-slate-50/70 cursor-pointer hover:bg-slate-100"
            onClick={() => toggle(c.code)}
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
              .map((r, i) => <Account key={i} r={r} kind={kind} side={c.side} />)}
        </Fragment>
      );
    });

  const Block = ({ label, cats, kind }: { label: string; cats: Cat<TbLine>[]; kind: "balance" | "pnl" }) => {
    if (cats.length === 0) return null;
    const total = cats.reduce((s, c) => s + display(c.raw, kind, c.side), 0);
    return (
      <>
        <tr>
          <td colSpan={3} className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {label}
          </td>
        </tr>
        <CatRows cats={cats} kind={kind} />
        <tr className="border-t border-slate-300 font-semibold">
          <td className="py-1.5 pr-4 pl-2" colSpan={2}>
            Totaal {label.toLowerCase()}
          </td>
          <td className="py-1.5 pr-4 text-right whitespace-nowrap">{formatMoney(total, currency)}</td>
        </tr>
      </>
    );
  };

  const balanceCats = useMemo(() => categorize(balance, "balance"), [balance]);
  const pnlCats = useMemo(() => categorize(pnl, "pnl"), [pnl]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Jaarrekening</h1>
          <p className="text-sm text-slate-500 mt-1">
            {entity ? `${entity.name} · ${range.from} t/m ${range.to}` : "Selecteer een administratie"}
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-3">
            {hasRgs && (
              <button className="lf-link text-xs" onClick={() => setGrouped((v) => !v)}>
                {grouped ? "Toon losse rekeningen" : "Groepeer op RGS-categorie"}
              </button>
            )}
            <ExportButtons
              filename={`jaarrekening-${range.from}_${range.to}`}
              sheetName="Jaarrekening"
              getRows={() => [
                ...pnlCats.map((c) => ({
                  overzicht: "Winst & verlies",
                  zijde: c.side,
                  rgs_code: c.code,
                  categorie: c.name,
                  bedrag: display(c.raw, "pnl", c.side),
                  rekeningen: c.lines.length,
                })),
                ...balanceCats.map((c) => ({
                  overzicht: "Balans",
                  zijde: c.side,
                  rgs_code: c.code,
                  categorie: c.name,
                  bedrag: display(c.raw, "balance", c.side),
                  rekeningen: c.lines.length,
                })),
              ]}
            />
          </div>
        )}
      </div>

      {!entity && <div className="lf-card max-w-2xl">Selecteer een administratie in de bovenbalk.</div>}
      {entity && isLoading && <div className="lf-card">Jaarrekening laden…</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">
          {error instanceof ApiError ? error.message : "Kon jaarrekening niet laden"}
        </div>
      )}

      {entity && data && !hasRgs && (
        <div className="lf-card bg-blue-50 ring-blue-200 text-blue-900 text-sm">
          Tip: schakel RGS in (Instellingen → RGS / normalisatie) en koppel de rekeningen om de
          jaarrekening te groeperen op standaard categorieën (Vaste activa, Vorderingen, Eigen
          vermogen, Schulden, Netto-omzet, Personeelskosten…).
        </div>
      )}

      {entity && data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Winst- en verliesrekening */}
          <div className="lf-card">
            <h2 className="text-lg font-semibold mb-2">Winst- en verliesrekening</h2>
            <table className="w-full text-sm">
              <tbody>
                {useGroups ? (
                  <CatRows cats={pnlCats} kind="pnl" />
                ) : (
                  pnl.map((r, i) => <Account key={i} r={r} kind="pnl" side="OVERIG" />)
                )}
                {pnl.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-3 text-slate-400">
                      Geen posten.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <td className="py-2 pr-4" colSpan={2}>
                    Resultaat (winst +)
                  </td>
                  <td className="py-2 pr-4 text-right">{formatMoney(result, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Balans */}
          <div className="lf-card">
            <h2 className="text-lg font-semibold mb-2">Balans</h2>
            <table className="w-full text-sm">
              <tbody>
                {useGroups ? (
                  <>
                    <Block label="Activa" cats={balanceCats.filter((c) => c.side === "ACTIVA")} kind="balance" />
                    <Block label="Passiva" cats={balanceCats.filter((c) => c.side === "PASSIVA")} kind="balance" />
                    <Block label="Overig" cats={balanceCats.filter((c) => c.side === "OVERIG")} kind="balance" />
                  </>
                ) : (
                  balance.map((r, i) => <Account key={i} r={r} kind="balance" side="OVERIG" />)
                )}
                {balance.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-3 text-slate-400">
                      Geen posten.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <td className="py-2 pr-4" colSpan={2}>
                    Balansverschil (debet − credit)
                  </td>
                  <td className="py-2 pr-4 text-right">{formatMoney(balanceTotal, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
