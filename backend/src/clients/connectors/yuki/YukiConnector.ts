import { XMLParser } from "fast-xml-parser";
import { YukiSoapClient, escapeXml } from "./YukiSoapClient.js";
import { ConnectorError } from "../../../utils/errors.js";
import type {
  Connector,
  ConnectionTestResult,
  ContactSummary,
  DateRange,
  TransactionLine,
  TrialBalanceLine,
} from "../interfaces/Connector.js";

/**
 * Yuki API connector.
 *
 * Credential payload (decrypted by the caller):
 *   { accessKey: string; administrationId: string }
 *
 * Implementation notes:
 *  - Authenticate flow is confirmed by Yuki docs: POST Accounting.asmx Authenticate(accessKey) → sessionID.
 *  - ProcessJournal(sessionID, administrationID, xmlDoc) is fully documented (see writeback method below).
 *  - Trial balance and transactions use the AccountingInfo web service.
 *    The exact method names below (GLAccountTransactions, GLAccountBalance) follow the
 *    Yuki naming convention used in the public Postman collection; if your account
 *    exposes slightly different names (e.g. AccountTransactionsByPeriod), only
 *    `methodTrialBalance` / `methodTransactions` need to change.
 *  - Many AccountingInfo responses are returned as an *embedded XML document*
 *    wrapped in CDATA inside the SOAP body — the helper `parseEmbeddedXml`
 *    handles that pattern.
 */

const NAMESPACE = "http://www.theyukicompany.com/";

export interface YukiCredentials {
  accessKey: string;
  administrationId: string;
}

const embeddedXmlParser = new XMLParser({
  ignoreAttributes: false,
  // Flatten attributes into the same object as child elements (no "@_" prefix) —
  // Yuki uses attributes for Code/BalanceType/etc. and we want them addressable
  // alongside child elements like Description/Amount.
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: true,
  parseAttributeValue: false,
  trimValues: true,
  // processEntities MUST be true — turning it off silently breaks attribute
  // extraction in fast-xml-parser v4 (Code/BalanceType become undefined).
  // The hardcoded 1000-entity safety limit is handled by chunking transaction
  // requests into monthly windows in getTransactions().
  processEntities: true,
  numberParseOptions: { leadingZeros: false, hex: false },
  isArray: (name) =>
    [
      "GLAccount",
      "GLAccountTransaction",
      "Transaction",
      "JournalEntry",
      "Contact",
      "Administration",
      "Item",
    ].includes(name),
});

/** Decode XML entities that the parser left raw because processEntities=false. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;|&#xa;/g, "\n")
    .replace(/&#13;|&#xd;/g, "\r")
    .replace(/&amp;/g, "&"); // must be last
}

/** Safely stringify+decode an unknown XML field. */
function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return decodeXmlEntities(String(v));
}

export class YukiConnector implements Connector {
  readonly kind = "yuki" as const;
  private readonly soap = new YukiSoapClient();
  private cachedSession?: { sessionId: string; expiresAt: number };

  constructor(private readonly creds: YukiCredentials) {
    if (!creds.accessKey) throw new ConnectorError("Yuki accessKey is required");
    if (!creds.administrationId) throw new ConnectorError("Yuki administrationId is required");
  }

  /** Get a sessionID, reusing for up to ~10 minutes to limit auth calls. */
  private async session(): Promise<string> {
    const now = Date.now();
    if (this.cachedSession && this.cachedSession.expiresAt > now) {
      return this.cachedSession.sessionId;
    }
    const sessionId = await this.soap.authenticate(this.creds.accessKey, "Accounting");
    this.cachedSession = { sessionId, expiresAt: now + 10 * 60_000 };
    return sessionId;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const sessionId = await this.session();
      // Optional: try Administrations(sessionID) to enumerate accessible admins.
      // Falls back gracefully if the method doesn't exist on this account.
      let administrations: { id: string; name: string }[] | undefined;
      try {
        const body =
          `<Administrations xmlns="${NAMESPACE}">` +
          `<sessionID>${escapeXml(sessionId)}</sessionID>` +
          `</Administrations>`;
        const env = await this.soap.call({
          bodyXml: body,
          method: "Administrations",
          service: "Accounting",
        });
        const result = (env as any)?.AdministrationsResponse?.AdministrationsResult;
        const inner = parseEmbeddedXml(result);
        // The SOAP client's parser has no isArray hint for "Administration", so a
        // single administration arrives as an object, not a one-element array.
        // Normalize before mapping.
        const raw = inner?.Administrations?.Administration as
          | Array<{ ID?: string; Name?: string }>
          | { ID?: string; Name?: string }
          | undefined;
        const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
        if (list.length) {
          administrations = list.map((a) => ({ id: String(a.ID ?? ""), name: String(a.Name ?? "") }));
        }
      } catch {
        // Method may not be enabled on this key — silently skip.
      }

      return {
        ok: true,
        message: "Yuki-verbinding succesvol",
        administrations,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Onbekende fout bij Yuki-verbinding",
      };
    }
  }

  /**
   * Resolve the human-readable name of the configured administration via Yuki's
   * Administrations endpoint, matched on administrationId. Returns null if Yuki
   * doesn't expose the list on this key or the id isn't found.
   */
  async getAdministrationName(): Promise<string | null> {
    const result = await this.testConnection();
    if (!result.ok || !result.administrations) return null;
    const match = result.administrations.find((a) => a.id === this.creds.administrationId);
    return match?.name?.trim() || null;
  }

  /**
   * Trial balance via Accounting.GLAccountBalance(sessionID, administrationID, transactionDate).
   * Per the WSDL this is a POINT-IN-TIME balance (cumulative position as of `transactionDate`),
   * not a period activity. We use range.to as the as-of date.
   *
   * Yuki expects an xs:dateTime — we pass yyyy-MM-ddT00:00:00 so an ISO date works.
   */
  async getTrialBalance(range: DateRange): Promise<TrialBalanceLine[]> {
    const sessionId = await this.session();
    const asOf = `${range.to}T00:00:00`;
    const body =
      `<GLAccountBalance xmlns="${NAMESPACE}">` +
      `<sessionID>${escapeXml(sessionId)}</sessionID>` +
      `<administrationID>${escapeXml(this.creds.administrationId)}</administrationID>` +
      `<transactionDate>${escapeXml(asOf)}</transactionDate>` +
      `</GLAccountBalance>`;

    const env = await this.soap.call({
      bodyXml: body,
      method: "GLAccountBalance",
      service: "Accounting",
    });

    const result =
      (env as { GLAccountBalanceResponse?: { GLAccountBalanceResult?: unknown } })
        ?.GLAccountBalanceResponse?.GLAccountBalanceResult;
    const inner = parseEmbeddedXml(result);

    // Yuki returns one of these container shapes — try in order of likelihood.
    const rawRows: unknown =
      inner?.GLAccountBalances?.GLAccount ??
      inner?.GLAccountBalance?.GLAccount ??
      inner?.GLAccount ??
      [];
    const rows: Array<Record<string, unknown>> = Array.isArray(rawRows)
      ? (rawRows as Array<Record<string, unknown>>)
      : rawRows && typeof rawRows === "object"
        ? [rawRows as Record<string, unknown>]
        : [];

    return rows.map((r) => {
      // Yuki returns ONE signed Amount per GL — positive = debit, negative = credit.
      // We split into debit/credit columns for the Excel trial balance.
      const amount = num(r.Amount ?? r.Debit);
      const code = str(r.Code ?? r.GLAccountCode ?? r.AccountCode);
      const name = str(r.Description ?? r.Name ?? r.GLAccount);
      // BalanceType: "B" = balansrekening, "W"/"P" = winst-en-verliesrekening
      const balanceType = str(r.BalanceType ?? r.Type ?? "B").toUpperCase();
      return {
        glAccountCode: code,
        glAccountName: name,
        accountType:
          balanceType.startsWith("P") || balanceType.startsWith("W") ? "PROFIT_LOSS" : "BALANCE",
        debit: amount >= 0 ? amount : 0,
        credit: amount < 0 ? -amount : 0,
        balance: amount,
        currency: str(r.Currency) || "EUR",
      };
    });
  }

  /**
   * Transactions via AccountingInfo.GetTransactionDetails(sessionID,
   * administrationID, GLAccountCode, StartDate, EndDate, financialMode) — see
   * fetchTransactionsChunk for why this method (it carries documentReference /
   * documentType, which GLAccountTransactions does not).
   *
   * Splits the request into MONTHLY chunks to keep each response small: a
   * multi-year pull would return a very large payload and risk Yuki-side
   * timeouts. The sessionID is cached so the extra HTTP calls only cost one
   * round-trip each.
   */
  async getTransactions(range: DateRange): Promise<TransactionLine[]> {
    // Fire the enrichment lookup in parallel with transaction chunks. The map
    // combines GetGLAccountScheme (full chart of accounts, including historical
    // codes that have been zeroed out) and GLAccountBalance (current trial
    // balance, used as fallback for anything missing from the scheme).
    const enrichmentPromise = this.buildAccountEnrichment(range);

    const chunks = monthlyChunks(range.from, range.to);
    const all: TransactionLine[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const rows = await this.fetchTransactionsChunk(chunks[i]!);
      all.push(...rows);
      if (i < chunks.length - 1) await sleep(120);
    }

    const byCode = await enrichmentPromise;
    if (byCode.size === 0) return all;

    for (const t of all) {
      const hit = byCode.get(t.glAccountCode);
      if (hit) {
        if (!t.glAccountName) t.glAccountName = hit.name;
        if (t.accountType === "UNKNOWN") t.accountType = hit.type;
      }
    }
    return all;
  }

  /**
   * Build a code → { name, type } map covering as many GL accounts as possible.
   * GetGLAccountScheme is the authoritative source (full chart, including
   * historical accounts); trial balance is layered on top for any account the
   * scheme is missing.
   */
  private async buildAccountEnrichment(
    range: DateRange,
  ): Promise<Map<string, { name: string; type: TrialBalanceLine["accountType"] }>> {
    const byCode = new Map<string, { name: string; type: TrialBalanceLine["accountType"] }>();

    // 1. Trial balance — best source for accountType (B vs W is explicit).
    try {
      const tb = await this.getTrialBalance(range);
      for (const r of tb) {
        byCode.set(r.glAccountCode, { name: r.glAccountName, type: r.accountType });
      }
    } catch {
      /* swallow — fall back to scheme only */
    }

    // 2. GL Account Scheme — covers historical accounts that aren't in the
    //    current trial balance. Does not override what trial balance gave us.
    try {
      const scheme = await this.getGLAccountScheme();
      for (const [code, info] of scheme) {
        if (!byCode.has(code)) byCode.set(code, info);
      }
    } catch {
      /* swallow — keep trial balance only */
    }

    return byCode;
  }

  /**
   * Fetch Yuki's chart of accounts (all GL accounts, active and historical).
   * Response shape varies by Yuki account; we try the common containers.
   */
  private async getGLAccountScheme(): Promise<
    Map<string, { name: string; type: TrialBalanceLine["accountType"] }>
  > {
    const sessionId = await this.session();
    const body =
      `<GetGLAccountScheme xmlns="${NAMESPACE}">` +
      `<sessionID>${escapeXml(sessionId)}</sessionID>` +
      `<administrationID>${escapeXml(this.creds.administrationId)}</administrationID>` +
      `</GetGLAccountScheme>`;

    const env = await this.soap.call({
      bodyXml: body,
      method: "GetGLAccountScheme",
      service: "AccountingInfo",
    });

    const result =
      (env as { GetGLAccountSchemeResponse?: { GetGLAccountSchemeResult?: unknown } })
        ?.GetGLAccountSchemeResponse?.GetGLAccountSchemeResult;
    const inner = parseEmbeddedXml(result);

    // Walk the response tree looking for GL account leaves. Yuki uses lowercase
    // field names here (code/type/descripton — yes, that's a typo in the API)
    // and a NUMERIC type code: 1/2 = balance sheet, 3-6 = P&L.
    const map = new Map<string, { name: string; type: TrialBalanceLine["accountType"] }>();
    walkForGLAccounts(inner, (node) => {
      const code = str(
        node.code ?? node.Code ?? node.GLAccountCode ?? node.AccountCode,
      );
      if (!code) return;
      const name = str(
        // "descripton" (sic) is how Yuki spells it in GetGLAccountScheme.
        node.descripton ?? node.description ?? node.Description ?? node.Name,
      );
      const rawType = node.type ?? node.Type ?? node.BalanceType;
      const numericType = typeof rawType === "number" ? rawType : Number(str(rawType));
      const stringType = str(rawType).toUpperCase();
      // type 1 (activa) and 2 (passiva/EV/schulden) → BALANCE
      // type 3 (omzet/inkopen) / 4 (kosten) / 5 (financieel) / 6 (belastingen) → P&L
      // Letter fallback (B/W/P) for trial-balance-style payloads.
      const accountType: TrialBalanceLine["accountType"] =
        Number.isFinite(numericType) && numericType >= 1
          ? numericType <= 2
            ? "BALANCE"
            : "PROFIT_LOSS"
          : stringType.startsWith("P") || stringType.startsWith("W")
            ? "PROFIT_LOSS"
            : "BALANCE";
      if (!map.has(code)) map.set(code, { name, type: accountType });
    });
    return map;
  }

  private async fetchTransactionsChunk(range: DateRange): Promise<TransactionLine[]> {
    const sessionId = await this.session();
    // AccountingInfo.GetTransactionDetails exposes the source-document number
    // (documentReference) and document kind (documentType) that the older
    // Accounting.GLAccountTransactions method omits. Params:
    //  - GLAccountCode: empty → every GL account
    //  - financialMode: INTEGER flag (0 = include everything); a boolean string
    //    here triggers a .NET "Input string was not in a correct format" fault.
    const body =
      `<GetTransactionDetails xmlns="${NAMESPACE}">` +
      `<sessionID>${escapeXml(sessionId)}</sessionID>` +
      `<administrationID>${escapeXml(this.creds.administrationId)}</administrationID>` +
      `<GLAccountCode></GLAccountCode>` +
      `<StartDate>${escapeXml(range.from)}</StartDate>` +
      `<EndDate>${escapeXml(range.to)}</EndDate>` +
      `<financialMode>0</financialMode>` +
      `</GetTransactionDetails>`;

    const env = await this.soap.call({
      bodyXml: body,
      method: "GetTransactionDetails",
      service: "AccountingInfo",
    });

    // Unlike most AccountingInfo methods, GetTransactionDetails returns inline
    // XML elements (not a CDATA-wrapped embedded document), so the SOAP client's
    // own parser has already expanded it: result = { TransactionInfo: [...] }.
    const result =
      (env as { GetTransactionDetailsResponse?: { GetTransactionDetailsResult?: unknown } })
        ?.GetTransactionDetailsResponse?.GetTransactionDetailsResult;
    const rawRows: unknown = (result as { TransactionInfo?: unknown })?.TransactionInfo;
    // The SOAP parser has no isArray hint for TransactionInfo, so a single-row
    // month arrives as an object instead of a one-element array.
    const rows: Array<Record<string, unknown>> = Array.isArray(rawRows)
      ? (rawRows as Array<Record<string, unknown>>)
      : rawRows && typeof rawRows === "object"
        ? [rawRows as Record<string, unknown>]
        : [];

    return rows.map((r) => {
      const date = str(r.transactionDate).slice(0, 10);
      // documentReference is 0 for entries without a source document (bank,
      // memorial); treat that as "no reference".
      const ref = num(r.documentReference);
      // documentType arrives with a "TRM" prefix (e.g. "TRMPurchase invoice").
      const rawType = str(r.documentType).replace(/^TRM/, "").trim();
      return {
        date,
        year: Number(date.slice(0, 4)) || 0,
        period: Number(date.slice(5, 7)) || 0,
        glAccountCode: str(r.glAccountCode),
        glAccountName: "",
        accountType: "UNKNOWN" as const,
        amount: num(r.transactionAmount),
        contactName: r.fullName ? str(r.fullName) : null,
        reference: ref ? String(ref) : null,
        documentType: rawType || null,
        // GetTransactionDetails has no project field; left null so the export
        // renders an empty "Projecten" column (ready for connectors that do).
        project: null,
        description: str(r.description),
        currency: str(r.currency) || "EUR",
      };
    });
  }

  async getDebtors(): Promise<ContactSummary[]> {
    return this.outstandingItems("OutstandingDebtorItems", true);
  }

  async getCreditors(): Promise<ContactSummary[]> {
    return this.outstandingItems("OutstandingCreditorItems", false);
  }

  /**
   * Outstanding debtor/creditor items via Accounting.OutstandingDebtorItems /
   * Accounting.OutstandingCreditorItems.
   *
   * WSDL requires four params: sessionID, administrationID, includeBankTransactions
   * (boolean), sortOrder (enum tns:OutstandingItemsSortOrder — "ContactName" is the
   * safest default; "DueDate" / "InvoiceDate" / "InvoiceNumber" also valid).
   */
  private async outstandingItems(
    method: "OutstandingDebtorItems" | "OutstandingCreditorItems",
    isDebtor: boolean,
  ): Promise<ContactSummary[]> {
    const sessionId = await this.session();
    const body =
      `<${method} xmlns="${NAMESPACE}">` +
      `<sessionID>${escapeXml(sessionId)}</sessionID>` +
      `<administrationID>${escapeXml(this.creds.administrationId)}</administrationID>` +
      `<includeBankTransactions>false</includeBankTransactions>` +
      `<sortOrder>ContactName</sortOrder>` +
      `</${method}>`;
    try {
      const env = await this.soap.call({ bodyXml: body, method, service: "Accounting" });
      const result = (env as Record<string, any>)?.[`${method}Response`]?.[`${method}Result`];
      const inner = parseEmbeddedXml(result);
      const rows: Array<Record<string, unknown>> =
        (inner?.OutstandingItems?.Item as Array<Record<string, unknown>> | undefined) ??
        (inner?.Items?.Item as Array<Record<string, unknown>> | undefined) ??
        (inner?.Contacts?.Contact as Array<Record<string, unknown>> | undefined) ??
        [];

      // De-dupe by contact name/code since outstanding-items lists one row per invoice.
      const byKey = new Map<string, ContactSummary>();
      for (const r of rows) {
        const name = String(r.ContactName ?? r.Name ?? r.Debtor ?? r.Creditor ?? "");
        const code = r.ContactCode ? String(r.ContactCode) : r.Code ? String(r.Code) : null;
        const key = code || name;
        if (!key) continue;
        if (!byKey.has(key)) {
          byKey.set(key, {
            id: String(r.ContactID ?? r.ID ?? key),
            name,
            code,
            isDebtor,
            isCreditor: !isDebtor,
          });
        }
      }
      return [...byKey.values()];
    } catch {
      return [];
    }
  }

  /**
   * Writeback: import a general journal document into Yuki.
   * Uses Accounting.ProcessJournal — fully documented and verified.
   * Returns the GUID of the created journal document.
   */
  async processJournal(journalXml: string): Promise<string> {
    const sessionId = await this.session();
    const body =
      `<ProcessJournal xmlns="${NAMESPACE}">` +
      `<sessionID>${escapeXml(sessionId)}</sessionID>` +
      `<administrationID>${escapeXml(this.creds.administrationId)}</administrationID>` +
      `<xmlDoc>${escapeXml(journalXml)}</xmlDoc>` +
      `</ProcessJournal>`;
    const env = await this.soap.call({
      bodyXml: body,
      method: "ProcessJournal",
      service: "Accounting",
    });
    const result = (env as any)?.ProcessJournalResponse?.ProcessJournalResult;
    return typeof result === "string" ? result : String(result ?? "");
  }
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Many AccountingInfo methods return a string that is itself an XML document
 * (sometimes inside CDATA). Decode and re-parse it.
 */
function parseEmbeddedXml(value: unknown): any {
  if (!value) return null;
  if (typeof value === "object") return value;
  const xml = String(value).trim();
  if (!xml.startsWith("<")) return null;
  return embeddedXmlParser.parse(xml);
}

/**
 * Split [from, to] (inclusive) into per-month [start, end] windows.
 * Edge months are clamped so the first chunk starts at `from` and the last
 * ends at `to`. All values are yyyy-MM-dd strings; computation is in UTC to
 * avoid timezone drift.
 */
function monthlyChunks(from: string, to: string): DateRange[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [{ from, to }];
  }
  const chunks: DateRange[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    const monthStart = cursor;
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const chunkStart = monthStart < start ? start : monthStart;
    const chunkEnd = monthEnd > end ? end : monthEnd;
    chunks.push({
      from: toIsoDate(chunkStart),
      to: toIsoDate(chunkEnd),
    });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return chunks;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Recursively walk a parsed XML tree and invoke `cb` on every object that
 * looks like a GL account leaf (has a Code/GLAccountCode field). Lets the
 * caller stay agnostic to whether Yuki returns a flat list or a nested
 * Rubriek/Groep hierarchy.
 */
function walkForGLAccounts(node: unknown, cb: (n: Record<string, unknown>) => void): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) walkForGLAccounts(item, cb);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  // Leaf detection — any object with both a code field and a description-like
  // field. Field naming varies wildly across Yuki endpoints (lowercase in
  // GetGLAccountScheme including the "descripton" typo, PascalCase in trial
  // balance), so we check both conventions.
  const hasCode =
    obj.code !== undefined ||
    obj.Code !== undefined ||
    obj.GLAccountCode !== undefined ||
    obj.AccountCode !== undefined;
  const hasName =
    obj.descripton !== undefined || // sic — typo in Yuki GetGLAccountScheme
    obj.description !== undefined ||
    obj.Description !== undefined ||
    obj.Name !== undefined;
  if (hasCode && hasName) cb(obj);
  for (const value of Object.values(obj)) walkForGLAccounts(value, cb);
}
