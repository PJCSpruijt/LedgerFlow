import ExcelJS from "exceljs";
import type {
  TransactionLine,
  TrialBalanceLine,
} from "../clients/connectors/interfaces/Connector.js";

/**
 * Build a professional .xlsx workbook for trial balance + transactions.
 *
 * Conventions:
 *  - Frozen header row, autofilter on the data range, autosized columns,
 *    currency format for amounts (€ #,##0.00; (€ #,##0.00)).
 *  - First sheet (Metadata) gives the recipient context on what they're looking at.
 *  - Buffer is returned (not streamed) — exports are small enough and this keeps
 *    the response middleware simple.
 */

export interface ExportContext {
  /** Human label for what the export covers (single administration or whole workspace). */
  scopeLabel: string;
  /** Names of every administration included, in order. */
  administrations: string[];
  generatedAt: Date;
  from: string;
  to: string;
  /** Distinct connector kinds across the included administrations. */
  connectorKinds: string[];
}

/** A trial-balance line tagged with the administration it came from. */
export type TrialBalanceExportRow = TrialBalanceLine & { administration: string };
/** A transaction line tagged with the administration it came from. */
export type TransactionExportRow = TransactionLine & { administration: string };

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF0F172A" }, // slate-900
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
};

const CURRENCY_FORMAT = '€ #,##0.00;[Red]-€ #,##0.00';

// Connectors hand us their native document-kind label (Yuki: "Purchase invoice"
// after the "TRM" prefix is stripped). Map the known ones to Dutch for the sheet;
// anything unrecognized falls through unchanged so we never hide data.
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  "Purchase invoice": "Inkoopfactuur",
  "Sales invoice": "Verkoopfactuur",
  "Financial entry": "Financiële boeking",
  "Bank statement": "Bankafschrift",
  Memorial: "Memoriaal",
};

function documentTypeLabel(raw: string | null): string {
  if (!raw) return "";
  return DOCUMENT_TYPE_LABELS[raw] ?? raw;
}

function autosize(ws: ExcelJS.Worksheet, padding = 2): void {
  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      const len =
        v == null
          ? 0
          : typeof v === "number"
            ? String(v).length
            : typeof v === "object" && "richText" in (v as object)
              ? String((v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("")).length
              : String(v).length;
      if (len > max) max = len;
    });
    col.width = Math.min(max + padding, 60);
  });
}

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle" };
  });
  row.height = 22;
}

export async function buildTrialBalanceWorkbook(
  ctx: ExportContext,
  rows: TrialBalanceExportRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LedgerFlow";
  wb.created = ctx.generatedAt;

  addMetadataSheet(wb, ctx, { sheetTitle: "Proefbalans", rowCount: rows.length });

  const ws = wb.addWorksheet("Proefbalans", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = [
    { header: "Administratie", key: "administration", width: 28 },
    { header: "Grootboekcode", key: "code", width: 16 },
    { header: "Grootboekrekening", key: "name", width: 36 },
    { header: "Type", key: "type", width: 14 },
    { header: "Debet", key: "debit", width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: "Credit", key: "credit", width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: "Saldo", key: "balance", width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: "Valuta", key: "currency", width: 10 },
  ];
  styleHeader(ws.getRow(1));

  for (const r of rows) {
    ws.addRow({
      administration: r.administration,
      code: r.glAccountCode,
      name: r.glAccountName,
      type: r.accountType === "BALANCE" ? "Balans" : "Resultaat",
      debit: r.debit || null,
      credit: r.credit || null,
      balance: r.balance,
      currency: r.currency,
    });
  }

  const lastRow = ws.rowCount;
  if (lastRow > 1) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastRow, column: 8 } };

    // Totals row
    const totalsRow = ws.addRow({
      administration: "",
      code: "",
      name: "Totaal",
      type: "",
      debit: { formula: `SUM(E2:E${lastRow})` },
      credit: { formula: `SUM(F2:F${lastRow})` },
      balance: { formula: `SUM(G2:G${lastRow})` },
      currency: "",
    });
    totalsRow.font = { bold: true };
    totalsRow.eachCell((c) => {
      c.border = { top: { style: "thin", color: { argb: "FF0F172A" } } };
    });
  }

  autosize(ws);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildTransactionsWorkbook(
  ctx: ExportContext,
  rows: TransactionExportRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LedgerFlow";
  wb.created = ctx.generatedAt;

  addMetadataSheet(wb, ctx, { sheetTitle: "Mutaties", rowCount: rows.length });

  const ws = wb.addWorksheet("Mutaties", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = [
    { header: "Administratie", key: "administration", width: 28 },
    { header: "Datum", key: "date", width: 12, style: { numFmt: "yyyy-mm-dd" } },
    { header: "Jaar", key: "year", width: 8 },
    { header: "Periode", key: "period", width: 10 },
    { header: "Code", key: "code", width: 10 },
    { header: "Grootboekrekening", key: "glName", width: 32 },
    { header: "Type", key: "type", width: 12 },
    { header: "Bedrag", key: "amount", width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: "Relatie", key: "contact", width: 28 },
    { header: "Referentie", key: "reference", width: 18 },
    { header: "Documenttype", key: "documentType", width: 18 },
    { header: "Projecten", key: "project", width: 20 },
    { header: "Omschrijving", key: "description", width: 50 },
    { header: "Valuta", key: "currency", width: 10 },
  ];
  styleHeader(ws.getRow(1));

  for (const r of rows) {
    ws.addRow({
      administration: r.administration,
      date: r.date ? new Date(r.date) : null,
      year: r.year,
      period: r.period,
      code: r.glAccountCode,
      glName: r.glAccountName,
      type:
        r.accountType === "BALANCE"
          ? "Balans"
          : r.accountType === "PROFIT_LOSS"
            ? "Resultaat"
            : "Onbekend",
      amount: r.amount,
      contact: r.contactName ?? "",
      reference: r.reference ?? "",
      documentType: documentTypeLabel(r.documentType),
      project: r.project ?? "",
      description: r.description,
      currency: r.currency,
    });
  }

  const lastRow = ws.rowCount;
  if (lastRow > 1) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastRow, column: 14 } };
    const totalsRow = ws.addRow({
      administration: "",
      date: null,
      year: null,
      period: null,
      code: "",
      glName: "Totaal",
      type: "",
      amount: { formula: `SUM(H2:H${lastRow})` },
      contact: "",
      reference: "",
      documentType: "",
      project: "",
      description: "",
      currency: "",
    });
    totalsRow.font = { bold: true };
  }

  autosize(ws);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function addMetadataSheet(
  wb: ExcelJS.Workbook,
  ctx: ExportContext,
  meta: { sheetTitle: string; rowCount: number },
): void {
  const ws = wb.addWorksheet("Metadata");
  ws.columns = [
    { header: "Veld", key: "k", width: 24 },
    { header: "Waarde", key: "v", width: 60 },
  ];
  styleHeader(ws.getRow(1));

  const data: Array<[string, string | number | Date]> = [
    ["Product", "LedgerFlow"],
    ["Tabblad", meta.sheetTitle],
    ["Bereik", ctx.scopeLabel],
    ["Administraties", ctx.administrations.join(", ")],
    ["Aantal administraties", ctx.administrations.length],
    ["Periode van", ctx.from],
    ["Periode tot", ctx.to],
    ["Aantal regels", meta.rowCount],
    ["Bron", ctx.connectorKinds.map((k) => k.toUpperCase()).join(", ")],
    ["Gegenereerd op", ctx.generatedAt],
  ];
  for (const [k, v] of data) ws.addRow({ k, v });
  ws.getColumn("v").alignment = { wrapText: true, vertical: "top" };
}
