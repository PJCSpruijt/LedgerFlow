export function formatMoney(amount: number, currency = "EUR"): string {
  return amount.toLocaleString("nl-NL", { style: "currency", currency });
}
