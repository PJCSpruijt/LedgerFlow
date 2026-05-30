import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { formatMoney } from "../lib/period";

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

type Side = "ACTIVA" | "PASSIVA" | "OVERIG";

/**
 * Standard jaarrekening presentation order (Titel 9 BW model), mapped onto RGS
 * hoofdrubrieken. RGS's own referentienummer is a coding order, not a balance
 * presentation order (it interleaves equity/provisions between the assets), so
 * we encode the conventional sequence here; unknown rubrieken fall back to the
 * RGS referentienummer and are classified activa/passiva by their D/C nature.
 */
const BALANCE_PRES: Record<string, { side: Side; order: number }> = {
  BIva: { side: "ACTIVA", order: 1 }, // Immateriële vaste activa
  BMva: { side: "ACTIVA", order: 2 }, // Materiële vaste activa
  BVas: { side: "ACTIVA", order: 3 }, // Vastgoedbeleggingen
  BFva: { side: "ACTIVA", order: 4 }, // Financiële vaste activa
  BVrd: { side: "ACTIVA", order: 10 }, // Voorraden
  BPro: { side: "ACTIVA", order: 11 }, // Onderhanden projecten
  BOnd: { side: "ACTIVA", order: 11 },
  BVor: { side: "ACTIVA", order: 12 }, // Vorderingen
  BEff: { side: "ACTIVA", order: 13 }, // Effecten
  BLim: { side: "ACTIVA", order: 14 }, // Liquide middelen
  BEiv: { side: "PASSIVA", order: 1 }, // Eigen vermogen / groepsvermogen
  BVev: { side: "PASSIVA", order: 1 },
  BAdk: { side: "PASSIVA", order: 2 }, // Aandeel derden
  BVrz: { side: "PASSIVA", order: 3 }, // Voorzieningen
  BLas: { side: "PASSIVA", order: 4 }, // Langlopende schulden
  BSch: { side: "PASSIVA", order: 5 }, // Kortlopende schulden
};

const PNL_PRES: Record<string, number> = {
  WOmz: 1, // Netto-omzet
  WWiv: 2, // Wijziging voorraden / onderhanden werk
  WGac: 3, // Geactiveerde productie
  WOvb: 4, // Overige bedrijfsopbrengsten
  WKpr: 5, // Kostprijs van de omzet
  WInk: 6, // Inkoopwaarde / uitbesteed werk
  WPer: 7, // Personeelskosten
  WAfs: 8, // Afschrijvingen
  WWvi: 9, // Bijzondere waardeverminderingen
  WBed: 10, // Overige bedrijfskosten
  WFbe: 20, // Financiële baten en lasten
  WBel: 30, // Belastingen
  WRsd: 40, // Resultaat deelnemingen
};

interface Cat {
  code: string;
  name: string;
  side: Side;
  order: number;
  lines: TbLine[];
  raw: number; // sum of balance (debit − credit)
}

const numOrder = (ref?: string | null) => {
  const n = Number.parseInt(ref ?? "", 10);
  return Number.isNaN(n) ? 9999 : n;
};

/** Sign so that revenue/assets read positive in the statement. */
const display = (balance: number, kind: "balance" | "pnl", side: Side) =>
  kind === "pnl" ? -balance : side === "PASSIVA" ? -balance : balance;

function categorize(rows: TbLine[], kind: "balance" | "pnl"): Cat[] {
  const byCode = new Map<string, Cat>();
  for (const r of rows) {
    const code = r.rgsGroupCode || "zzzz";
    const name = r.rgsGroupName || "Niet aan RGS gekoppeld";
    const c =
      byCode.get(code) ??
      ({ code, name, side: "OVERIG", order: 9999, lines: [], raw: 0 } as Cat);
    c.lines.push(r);
    c.raw += r.balance;
    byCode.set(code, c);
  }
  const cats = [...byCode.values()];
  for (const c of cats) {
    const sample = c.lines[0];
    if (code_is_unmapped(c.code)) {
      c.side = "OVERIG";
      c.order = 99999;
    } else if (kind === "balance") {
      const pres = BALANCE_PRES[c.code];
      c.side = pres?.side ?? (sample?.rgsGroupDc === "C" ? "PASSIVA" : "ACTIVA");
      c.order = pres?.order ?? 900 + numOrder(sample?.rgsGroupOrder);
    } else {
      c.side = "OVERIG";
      c.order = PNL_PRES[c.code] ?? 900 + numOrder(sample?.rgsGroupOrder);
    }
  }
  return cats.sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
}
const code_is_unmapped = (code: string) => code === "zzzz";

export function FinancialStatementsPage() {
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
  const balance = rows.filter((r) => r.accountType !== "PROFIT_LOSS");
  const result = -pnl.reduce((s, r) => s + r.balance, 0);
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

  const CatRows = ({ cats, kind }: { cats: Cat[]; kind: "balance" | "pnl" }) =>
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

  const Block = ({ label, cats, kind }: { label: string; cats: Cat[]; kind: "balance" | "pnl" }) => {
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
        {hasRgs && (
          <button className="lf-link text-xs" onClick={() => setGrouped((v) => !v)}>
            {grouped ? "Toon losse rekeningen" : "Groepeer op RGS-categorie"}
          </button>
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
