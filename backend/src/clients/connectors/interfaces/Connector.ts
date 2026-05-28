/**
 * Connector abstraction — every accounting system (Yuki today, Exact / Twinfield
 * tomorrow) implements this interface. Routes never depend on a specific connector;
 * they ask the registry for `getConnectorForOrganization(orgId)` and use the result.
 */

export interface ConnectorCredentials {
  /** Connector-specific opaque credential payload (already decrypted). */
  [key: string]: unknown;
}

export type ConnectorKind = "yuki" | "mock" | "exact" | "twinfield";

export interface TrialBalanceLine {
  glAccountCode: string;
  glAccountName: string;
  /** "BALANCE" = balansrekening, "PROFIT_LOSS" = winst-en-verliesrekening */
  accountType: "BALANCE" | "PROFIT_LOSS";
  debit: number;
  credit: number;
  /** debit - credit (positive = debit balance, negative = credit balance) */
  balance: number;
  currency: string;
}

export interface TransactionLine {
  date: string; // ISO yyyy-MM-dd
  year: number;
  period: number;
  glAccountCode: string;
  glAccountName: string;
  accountType: "BALANCE" | "PROFIT_LOSS" | "UNKNOWN";
  amount: number; // signed; negative = credit
  contactName: string | null;
  reference: string | null;
  description: string;
  currency: string;
}

export interface DateRange {
  from: string; // ISO yyyy-MM-dd
  to: string;   // ISO yyyy-MM-dd
}

export interface ContactSummary {
  id: string;
  name: string;
  code: string | null;
  isDebtor: boolean;
  isCreditor: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  /** When ok=true: the administrations this credential can see. */
  administrations?: { id: string; name: string }[];
}

export interface Connector {
  readonly kind: ConnectorKind;

  testConnection(): Promise<ConnectionTestResult>;

  getTrialBalance(range: DateRange): Promise<TrialBalanceLine[]>;
  getTransactions(range: DateRange): Promise<TransactionLine[]>;

  getDebtors(): Promise<ContactSummary[]>;
  getCreditors(): Promise<ContactSummary[]>;
}
