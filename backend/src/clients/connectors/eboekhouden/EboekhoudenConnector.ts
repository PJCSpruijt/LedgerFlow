import { EboekhoudenClient, type EboekhoudenCredentials } from "./EboekhoudenClient.js";
export type { EboekhoudenCredentials } from "./EboekhoudenClient.js";
import type {
  Connector,
  ConnectionTestResult,
  ContactSummary,
  DateRange,
  InvoiceDocument,
  OutstandingItem,
  TransactionLine,
  TrialBalanceLine,
} from "../interfaces/Connector.js";

/**
 * e-Boekhouden connector (REST API v1).
 *
 * Coverage / known API limitations:
 *  - Trial balance: full (GET /v1/ledger/balances + GET /v1/ledger for names).
 *  - Transactions: enriched. The mutation LIST only exposes a ledgerId + id for
 *    journal/bank entries; invoice mutations come back with id=0 and no ledgerId.
 *    For entries with an id we fetch /v1/mutation/{id} to emit the header line
 *    plus each row (with relation name); invoice mutations are emitted at
 *    invoice level (date, amount, invoiceNumber as reference) without GL detail.
 *  - Debtors/creditors: derived from the outstanding-invoices endpoint.
 */

interface LedgerInfo {
  code: string;
  name: string;
  category: string;
  accountType: TrialBalanceLine["accountType"];
}

interface LedgerRow {
  id: number;
  code: string;
  description?: string;
  category?: string;
}
interface BalanceRow {
  code: string;
  type: string;
  balance: number;
}
interface MutationListItem {
  id: number;
  type: number;
  date: string;
  invoiceNumber?: string;
  ledgerId: number;
  amount: number;
}
interface MutationDetailRow {
  ledgerId: number;
  amount: number;
  description?: string;
  invoiceNumber?: string;
  relationId?: number;
}
interface MutationDetail {
  id: number;
  type: number;
  date: string;
  description?: string;
  ledgerId: number;
  relationId?: number;
  invoiceNumber?: string;
  rows?: MutationDetailRow[];
  vat?: { vatCode?: string; amount?: number }[];
}
interface ListResponse<T> {
  items: T[];
  count: number;
}

// e-Boekhouden mutation types → Dutch document labels (shown in the export).
const TYPE_LABELS: Record<number, string> = {
  1: "Inkoopfactuur",
  2: "Verkoopfactuur",
  3: "Betaling ontvangen",
  4: "Betaling verzonden",
  5: "Geld ontvangen",
  6: "Geld verzonden",
  7: "Memoriaal",
};

const PAGE = 500;

export class EboekhoudenConnector implements Connector {
  readonly kind = "eboekhouden" as const;
  private readonly client: EboekhoudenClient;
  private ledgerById?: Map<number, LedgerInfo>;
  private ledgerByCode?: Map<string, LedgerInfo>;
  private vatLedgersByCategory?: Map<string, LedgerInfo[]>;
  private readonly relationNames = new Map<number, string | null>();

  constructor(creds: EboekhoudenCredentials) {
    this.client = new EboekhoudenClient(creds);
  }

  // category "VW" = winst-en-verlies (P&L); everything else is a balance account.
  private accountType(category: string | undefined): TrialBalanceLine["accountType"] {
    return category === "VW" ? "PROFIT_LOSS" : "BALANCE";
  }

  private async loadLedgers(): Promise<void> {
    if (this.ledgerById) return;
    const byId = new Map<number, LedgerInfo>();
    const byCode = new Map<string, LedgerInfo>();
    const byCategory = new Map<string, LedgerInfo[]>();
    let offset = 0;
    for (;;) {
      const page = await this.client.get<ListResponse<LedgerRow>>("/v1/ledger", {
        limit: PAGE,
        offset,
      });
      for (const l of page.items) {
        const category = String(l.category ?? "");
        const info: LedgerInfo = {
          code: String(l.code),
          name: String(l.description ?? ""),
          category,
          accountType: this.accountType(l.category),
        };
        byId.set(l.id, info);
        byCode.set(info.code, info);
        if (category) {
          const arr = byCategory.get(category) ?? [];
          arr.push(info);
          byCategory.set(category, arr);
        }
      }
      offset += PAGE;
      if (page.items.length === 0 || offset >= page.count) break;
    }
    this.ledgerById = byId;
    this.ledgerByCode = byCode;
    this.vatLedgersByCategory = byCategory;
  }

  /**
   * Classify an e-Boekhouden VAT code to the ledger category that should carry it.
   * Deliberately conservative: anything we can't map confidently returns null so
   * the caller marks the line as needing a user-maintained mapping (REQUIRED).
   *   AF19 = VAT payable high · AF6 = VAT payable low · AFOVERIG = VAT payable other
   *   VOOR = input VAT (voorbelasting) · (BTWRC = VAT current account — not used for
   *   invoice lines, only settlement)
   */
  private vatCategory(vatCode: string): string | null {
    const c = vatCode.toUpperCase();
    if (!c || c === "GEEN") return null;
    if (c.includes("INK")) return "VOOR"; // purchase / input VAT
    if (c.includes("VERK")) {
      if (c.includes("HOOG")) return "AF19";
      if (c.includes("LAAG")) return "AF6";
      return "AFOVERIG"; // verlegd / EU / afstand / afwijkend sales VAT
    }
    return null; // e.g. AFW — cannot classify confidently
  }

  /**
   * Resolve the VAT ledger account for a VAT code WITHOUT assuming a code→ledger
   * table (the REST API exposes none). Resolution:
   *   - EXACT is reserved for an explicit source account (the API never provides
   *     one on invoice VAT, so it is not produced here).
   *   - INFERRED when the classified category maps to exactly one ledger.
   *   - REQUIRED when the category is unknown, has no ledger, or is ambiguous
   *     (>1 candidate) — we never auto-pick among multiple candidates.
   */
  private resolveVatLedger(vatCode: string): {
    code: string;
    name: string;
    accountType: TrialBalanceLine["accountType"];
    confidence: "EXACT" | "INFERRED" | "REQUIRED";
    sourceAccountKnown: boolean;
  } {
    const category = this.vatCategory(vatCode);
    const candidates = category ? (this.vatLedgersByCategory?.get(category) ?? []) : [];
    if (candidates.length === 1) {
      const l = candidates[0]!;
      return {
        code: l.code,
        name: l.name,
        accountType: l.accountType,
        confidence: "INFERRED",
        sourceAccountKnown: false,
      };
    }
    return {
      code: "",
      name: "",
      accountType: "BALANCE",
      confidence: "REQUIRED",
      sourceAccountKnown: false,
    };
  }

  private async relationName(id: number | undefined | null): Promise<string | null> {
    if (!id) return null;
    if (this.relationNames.has(id)) return this.relationNames.get(id) ?? null;
    try {
      const r = await this.client.get<{ name?: string }>(`/v1/relation/${id}`);
      const name = (r?.name ?? "").trim() || null;
      this.relationNames.set(id, name);
      return name;
    } catch {
      this.relationNames.set(id, null);
      return null;
    }
  }

  /**
   * Resolve the administration's company name for display. e-Boekhouden API
   * tokens are per-administration, so /v1/administration returns this token's
   * company. For office/accountant tokens linked to multiple administrations the
   * REST API exposes no administration selector and no explicit "default" flag,
   * and data calls operate on the account's primary administration — so we take
   * the FIRST linked administration as the default rather than returning nothing.
   */
  async getAdministrationName(): Promise<string | null> {
    const pickDefault = (items?: { company?: string }[]): string | null => {
      if (!items || items.length === 0) return null;
      return (items[0]?.company ?? "").trim() || null; // first = default/primary
    };
    try {
      const r = await this.client.get<{ items?: { company?: string }[] }>("/v1/administration");
      const name = pickDefault(r.items);
      if (name) return name;
    } catch {
      /* accountant-only on office tokens — fall through to linked */
    }
    try {
      const r = await this.client.get<{ items?: { company?: string }[] }>(
        "/v1/administration/linked",
      );
      return pickDefault(r.items);
    } catch {
      return null;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.client.get<ListResponse<LedgerRow>>("/v1/ledger", { limit: 1 });
      return { ok: true, message: "e-Boekhouden-verbinding succesvol" };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Onbekende fout bij e-Boekhouden-verbinding",
      };
    }
  }

  async getTrialBalance(range: DateRange): Promise<TrialBalanceLine[]> {
    await this.loadLedgers();
    const res = await this.client.get<ListResponse<BalanceRow>>("/v1/ledger/balances", {
      from: range.from,
      to: range.to,
    });
    return res.items.map((b) => {
      const info = this.ledgerByCode?.get(String(b.code));
      const balance = Number(b.balance) || 0;
      return {
        glAccountCode: String(b.code),
        glAccountName: info?.name ?? "",
        accountType: info?.accountType ?? this.accountType(b.type),
        // e-Boekhouden balance sign: positive = debit, negative = credit.
        debit: balance > 0 ? balance : 0,
        credit: balance < 0 ? -balance : 0,
        balance,
        currency: "EUR",
      };
    });
  }

  async getTransactions(range: DateRange): Promise<TransactionLine[]> {
    await this.loadLedgers();

    const mutations: MutationListItem[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.client.get<ListResponse<MutationListItem>>("/v1/mutation", {
        // e-Boekhouden ignores date[gte]; only date[range]=from,to filters both
        // bounds correctly.
        "date[range]": `${range.from},${range.to}`,
        limit: PAGE,
        offset,
      });
      mutations.push(...page.items);
      offset += PAGE;
      if (page.items.length === 0 || offset >= page.count) break;
    }

    const out: TransactionLine[] = [];
    for (const m of mutations) {
      const date = String(m.date).slice(0, 10);
      const year = Number(date.slice(0, 4)) || 0;
      const period = Number(date.slice(5, 7)) || 0;
      const documentType = TYPE_LABELS[m.type] ?? null;

      // Entries with a real id (journal/bank): fetch detail → header line + rows.
      if (m.id && m.id !== 0) {
        let det: MutationDetail | null = null;
        try {
          det = await this.client.get<MutationDetail>(`/v1/mutation/${m.id}`);
        } catch {
          det = null;
        }
        if (det) {
          const headRel = await this.relationName(det.relationId);
          const headInfo = this.ledgerById?.get(det.ledgerId);
          // e-Boekhouden returns positive magnitudes. The header leg carries the
          // signed amount (debit positive / credit negative); the detail rows are
          // the opposite (counter) side, so we flip their sign accordingly. This
          // yields the signed convention the rest of LedgerFlow expects
          // (negative = credit), matching the Yuki connector.
          const headerAmount = Number(m.amount) || 0;
          const rowSign = headerAmount >= 0 ? -1 : 1;
          // No transaction-level PDF link for e-Boekhouden: invoice PDFs live only
          // in the Facturatie (billing) module, keyed by its OWN numbering
          // (e.g. "F26001"). Booked sales mutations reference external invoice
          // numbers (e.g. "2025-0030" from the webshop) that never match the
          // billing module — verified live: 0/7 sales refs overlapped the billing
          // list. Setting documentId here would only yield dead "no PDF" links.
          const pdfRef: string | null = null;
          out.push({
            date,
            year,
            period,
            glAccountCode: headInfo?.code ?? "",
            glAccountName: headInfo?.name ?? "",
            accountType: headInfo?.accountType ?? "UNKNOWN",
            amount: headerAmount,
            contactName: headRel,
            reference: det.invoiceNumber
              ? String(det.invoiceNumber)
              : m.invoiceNumber
                ? String(m.invoiceNumber)
                : null,
            documentType,
            documentId: pdfRef,
            project: null,
            description: String(det.description ?? ""),
            currency: "EUR",
          });
          for (const row of det.rows ?? []) {
            const info = this.ledgerById?.get(row.ledgerId);
            const rel = row.relationId ? await this.relationName(row.relationId) : headRel;
            out.push({
              date,
              year,
              period,
              glAccountCode: info?.code ?? "",
              glAccountName: info?.name ?? "",
              accountType: info?.accountType ?? "UNKNOWN",
              amount: rowSign * Math.abs(Number(row.amount) || 0),
              contactName: rel,
              reference: row.invoiceNumber
                ? String(row.invoiceNumber)
                : det.invoiceNumber
                  ? String(det.invoiceNumber)
                  : null,
              documentType,
              documentId: pdfRef,
              project: null,
              description: String(row.description ?? det.description ?? ""),
              currency: "EUR",
            });
          }
          // Generated VAT balancing lines from the source vat[] summary. The API
          // exposes no VAT ledger on the line, so the account is inferred from the
          // ledger category (or left REQUIRED for a user mapping). The raw rows
          // above stay untouched; these lines are flagged generatedByConnector.
          for (const v of det.vat ?? []) {
            const vatAmt = Number(v.amount) || 0;
            if (!vatAmt) continue;
            const vatCode = String(v.vatCode ?? "");
            const r = this.resolveVatLedger(vatCode);
            out.push({
              date,
              year,
              period,
              glAccountCode: r.code,
              glAccountName: r.name,
              accountType: r.accountType,
              amount: rowSign * Math.abs(vatAmt),
              contactName: headRel,
              reference: det.invoiceNumber
                ? String(det.invoiceNumber)
                : m.invoiceNumber
                  ? String(m.invoiceNumber)
                  : null,
              documentType,
              project: null,
              description: `BTW ${vatCode}`,
              currency: "EUR",
              generatedByConnector: true,
              vatCode: vatCode || null,
              sourceAccountKnown: r.sourceAccountKnown,
              mappingConfidence: r.confidence,
            });
          }
          continue;
        }
      }

      // Invoice-level fallback (id=0, no GL breakdown available).
      const info = m.ledgerId ? this.ledgerById?.get(m.ledgerId) : undefined;
      out.push({
        date,
        year,
        period,
        glAccountCode: info?.code ?? "",
        glAccountName: info?.name ?? "",
        accountType: info?.accountType ?? "UNKNOWN",
        amount: Number(m.amount) || 0,
        contactName: null,
        reference: m.invoiceNumber ? String(m.invoiceNumber) : null,
        documentType,
        documentId: null, // see note above: no mutation→PDF link for e-Boekhouden
        project: null,
        description: documentType ?? "",
        currency: "EUR",
      });
    }
    return out;
  }

  /** Open invoices with amounts, from /v1/mutation/invoice/outstanding (credDeb D/C). */
  async getOutstanding(kind: "debtor" | "creditor"): Promise<OutstandingItem[]> {
    const credDeb = kind === "debtor" ? "D" : "C";
    const out: OutstandingItem[] = [];
    let offset = 0;
    for (;;) {
      let page: ListResponse<Record<string, unknown>>;
      try {
        page = await this.client.get<ListResponse<Record<string, unknown>>>(
          "/v1/mutation/invoice/outstanding",
          { credDeb, limit: PAGE, offset },
        );
      } catch {
        break;
      }
      const items = page.items ?? [];
      for (const it of items) {
        const open = Number(it.outstandingAmount) || 0;
        if (Math.abs(open) < 0.005) continue;
        const date = String(it.date ?? "").slice(0, 10);
        out.push({
          relationId: String(it.relationId ?? ""),
          relationName: String(it.company ?? ""),
          relationCode: it.relationCode ? String(it.relationCode) : null,
          invoiceNumber: it.invoiceNumber ? String(it.invoiceNumber) : null,
          date,
          dueDate: null,
          totalAmount: Number(it.totalAmount) || 0,
          openAmount: open,
          isDebtor: kind === "debtor",
          // Sales invoices (debtor) have a retrievable PDF via /v1/invoice;
          // purchase invoices (creditor) have none in the REST API.
          documentId: kind === "debtor" && it.invoiceNumber ? String(it.invoiceNumber) : null,
          // Stash the mutationId on a throwaway field for due-date enrichment below.
          __mutationId: it.mutationId,
        } as OutstandingItem & { __mutationId?: number });
      }
      offset += PAGE;
      if (items.length === 0 || offset >= (page.count ?? 0)) break;
    }

    // Derive due dates from each mutation's payment term (mutationDate + termOfPayment),
    // in small concurrent batches to limit round-trips.
    const withMut = out as Array<OutstandingItem & { __mutationId?: number }>;
    const BATCH = 8;
    for (let i = 0; i < withMut.length; i += BATCH) {
      await Promise.all(
        withMut.slice(i, i + BATCH).map(async (item) => {
          const mid = item.__mutationId;
          delete item.__mutationId;
          if (!mid) return;
          try {
            const m = await this.client.get<{ date?: string; termOfPayment?: number }>(
              `/v1/mutation/${mid}`,
            );
            const term = Number(m.termOfPayment) || 0;
            const base = m.date ? new Date(m.date) : item.date ? new Date(item.date) : null;
            if (base && !Number.isNaN(base.getTime())) {
              item.dueDate = new Date(base.getTime() + term * 86_400_000).toISOString().slice(0, 10);
            }
          } catch {
            /* leave dueDate null */
          }
        }),
      );
    }
    return out;
  }

  /**
   * Fetch a SALES invoice PDF: resolve the invoice number to its id, then stream
   * the (public, pre-signed) urlPdfFile. Purchase invoices have no PDF in the
   * REST API → null.
   */
  async getInvoicePdf(ref: string): Promise<InvoiceDocument | null> {
    if (!ref) return null;
    try {
      const list = await this.client.get<ListResponse<{ id: number; invoiceNumber?: string }>>(
        "/v1/invoice",
        { invoiceNumber: ref, limit: 5 },
      );
      const match =
        (list.items ?? []).find((i) => String(i.invoiceNumber) === ref) ?? list.items?.[0];
      if (!match) return null;
      const det = await this.client.get<{ urlPdfFile?: string; invoiceNumber?: string }>(
        `/v1/invoice/${match.id}`,
      );
      if (!det.urlPdfFile) return null;
      const res = await fetch(det.urlPdfFile);
      if (!res.ok) return null;
      const data = Buffer.from(await res.arrayBuffer());
      return {
        fileName: `${det.invoiceNumber ?? ref}.pdf`,
        contentType: res.headers.get("content-type") ?? "application/pdf",
        data,
      };
    } catch {
      return null;
    }
  }

  async getDebtors(): Promise<ContactSummary[]> {
    return this.distinctRelations("debtor");
  }

  async getCreditors(): Promise<ContactSummary[]> {
    return this.distinctRelations("creditor");
  }

  private async distinctRelations(kind: "debtor" | "creditor"): Promise<ContactSummary[]> {
    const items = await this.getOutstanding(kind);
    const byRel = new Map<string, ContactSummary>();
    for (const it of items) {
      if (!it.relationId || byRel.has(it.relationId)) continue;
      byRel.set(it.relationId, {
        id: it.relationId,
        name: it.relationName || it.relationId,
        code: it.relationCode,
        isDebtor: kind === "debtor",
        isCreditor: kind === "creditor",
      });
    }
    return [...byRel.values()];
  }
}
