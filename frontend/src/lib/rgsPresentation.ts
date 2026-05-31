/**
 * Shared jaarrekening presentation logic (Titel 9 BW model) mapped onto RGS
 * hoofdrubrieken. RGS's own referentienummer is a coding order, not a balance
 * presentation order (it interleaves equity/provisions between the assets), so
 * the conventional sequence is encoded here; unknown rubrieken fall back to the
 * RGS referentienummer and are classified activa/passiva by their D/C nature.
 *
 * Used by both the single-entity jaarrekening and the consolidated statements,
 * so the two always present identically.
 */

export type Side = "ACTIVA" | "PASSIVA" | "OVERIG";

/** Minimal line shape both single-entity TB lines and consolidated leaves satisfy. */
export interface StmtLine {
  glAccountCode: string;
  glAccountName: string;
  balance: number;
  rgsGroupCode?: string | null;
  rgsGroupName?: string | null;
  rgsGroupOrder?: string | null;
  rgsGroupDc?: string | null;
}

export const BALANCE_PRES: Record<string, { side: Side; order: number }> = {
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

export const PNL_PRES: Record<string, number> = {
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

export interface Cat<L extends StmtLine = StmtLine> {
  code: string;
  name: string;
  side: Side;
  order: number;
  lines: L[];
  raw: number; // sum of balance (debit − credit)
}

export const numOrder = (ref?: string | null): number => {
  const n = Number.parseInt(ref ?? "", 10);
  return Number.isNaN(n) ? 9999 : n;
};

const isUnmapped = (code: string) => code === "zzzz";

/** Sign so that revenue/assets read positive in the statement. */
export const display = (balance: number, kind: "balance" | "pnl", side: Side): number =>
  kind === "pnl" ? -balance : side === "PASSIVA" ? -balance : balance;

/** Group lines into RGS hoofdrubrieken, classified + ordered for presentation. */
export function categorize<L extends StmtLine>(rows: L[], kind: "balance" | "pnl"): Cat<L>[] {
  const byCode = new Map<string, Cat<L>>();
  for (const r of rows) {
    const code = r.rgsGroupCode || "zzzz";
    const name = r.rgsGroupName || "Niet aan RGS gekoppeld";
    const c = byCode.get(code) ?? ({ code, name, side: "OVERIG", order: 9999, lines: [], raw: 0 } as Cat<L>);
    c.lines.push(r);
    c.raw += r.balance;
    byCode.set(code, c);
  }
  const cats = [...byCode.values()];
  for (const c of cats) {
    const sample = c.lines[0];
    if (isUnmapped(c.code)) {
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
