import type {
  Connector,
  ConnectionTestResult,
  ContactSummary,
  DateRange,
  TransactionLine,
  TrialBalanceLine,
} from "../interfaces/Connector.js";

/**
 * MockConnector — returns realistic-looking Dutch SME data so the frontend, exports,
 * and AI workflows can be developed without a live Yuki account.
 * Triggered when CONNECTOR_MODE=mock or when no real credentials are configured.
 */
export class MockConnector implements Connector {
  readonly kind = "mock" as const;

  async testConnection(): Promise<ConnectionTestResult> {
    return {
      ok: true,
      message: "Mock connector — geen echte Yuki-verbinding",
      administrations: [
        { id: "00000000-0000-0000-0000-000000000001", name: "LedgerFlow Demo B.V." },
      ],
    };
  }

  async getTrialBalance(_range: DateRange): Promise<TrialBalanceLine[]> {
    return [
      tb("10000", "Kas", "BALANCE", 1_250.0, 0),
      tb("11000", "ING Bank zakelijk", "BALANCE", 84_312.55, 0),
      tb("13000", "Debiteuren", "BALANCE", 23_440.0, 0),
      tb("16000", "Crediteuren", "BALANCE", 0, 18_204.12),
      tb("24000", "Belastingschulden btw", "BALANCE", 0, 8_877.0),
      tb("40000", "Omzet diensten", "PROFIT_LOSS", 0, 142_980.0),
      tb("70000", "Inkopen", "PROFIT_LOSS", 56_120.0, 0),
      tb("70200", "Software & abonnementen", "PROFIT_LOSS", 4_840.0, 0),
      tb("80000", "Salarissen", "PROFIT_LOSS", 48_000.0, 0),
      tb("85000", "Notaris- en advocaatkosten", "PROFIT_LOSS", 2_350.0, 0),
    ];
  }

  async getTransactions(_range: DateRange): Promise<TransactionLine[]> {
    const tx = (
      date: string,
      glCode: string,
      glName: string,
      type: TransactionLine["accountType"],
      amount: number,
      contact: string | null,
      description: string,
    ): TransactionLine => ({
      date,
      year: Number(date.slice(0, 4)),
      period: Number(date.slice(5, 7)),
      glAccountCode: glCode,
      glAccountName: glName,
      accountType: type,
      amount,
      contactName: contact,
      reference: null,
      documentType: null,
      project: null,
      description,
      currency: "EUR",
    });

    return [
      tx("2026-01-05", "11000", "ING Bank zakelijk", "BALANCE", 12_500.0, "Klant A B.V.", "Ontvangen betaling factuur 2026-001"),
      tx("2026-01-05", "13000", "Debiteuren", "BALANCE", -12_500.0, "Klant A B.V.", "Afboeking debiteur"),
      tx("2026-01-12", "70200", "Software & abonnementen", "PROFIT_LOSS", 89.0, "GitHub Inc.", "GitHub Team — januari 2026"),
      tx("2026-01-12", "16000", "Crediteuren", "BALANCE", -89.0, "GitHub Inc.", "Crediteurenboeking"),
      tx("2026-01-28", "40000", "Omzet diensten", "PROFIT_LOSS", -8_500.0, "Klant B B.V.", "Verkoopfactuur 2026-002"),
      tx("2026-01-28", "13000", "Debiteuren", "BALANCE", 8_500.0, "Klant B B.V.", "Openstaande post"),
      tx("2026-02-15", "80000", "Salarissen", "PROFIT_LOSS", 16_000.0, null, "Loonjournaal februari"),
    ];
  }

  async getDebtors(): Promise<ContactSummary[]> {
    return [
      { id: "d1", name: "Klant A B.V.", code: "1001", isDebtor: true, isCreditor: false },
      { id: "d2", name: "Klant B B.V.", code: "1002", isDebtor: true, isCreditor: false },
    ];
  }

  async getCreditors(): Promise<ContactSummary[]> {
    return [
      { id: "c1", name: "GitHub Inc.", code: "9921", isDebtor: false, isCreditor: true },
      { id: "c2", name: "BSI Group The Netherlands B.V.", code: "9050", isDebtor: false, isCreditor: true },
    ];
  }
}

function tb(
  code: string,
  name: string,
  type: TrialBalanceLine["accountType"],
  debit: number,
  credit: number,
): TrialBalanceLine {
  return {
    glAccountCode: code,
    glAccountName: name,
    accountType: type,
    debit,
    credit,
    balance: debit - credit,
    currency: "EUR",
  };
}
