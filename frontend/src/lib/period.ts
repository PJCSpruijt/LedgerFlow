/** Convert a "YYYY-MM" period to an inclusive ISO date range (first..last day). */
export function periodToRange(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) {
    const d = new Date();
    return { from: `${d.getFullYear()}-01-01`, to: d.toISOString().slice(0, 10) };
  }
  const mm = String(m).padStart(2, "0");
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

export function formatMoney(amount: number, currency = "EUR"): string {
  return amount.toLocaleString("nl-NL", { style: "currency", currency });
}
