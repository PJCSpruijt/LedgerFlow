import { prisma } from "../config/prisma.js";

/**
 * Foreign-exchange conversion for reporting. Amounts come from connectors in
 * their own transaction currency; for reporting we convert everything to one
 * currency (chosen in the top bar) using daily ECB rates from Frankfurter.
 *
 * Rates are cached in-memory (per process) and in the FxRate table so repeated
 * report loads don't re-hit the API. EUR-only administrations never trigger a
 * lookup (from === to short-circuits).
 */

const mem = new Map<string, number>(); // `${date}|${from}|${to}` → rate (NaN = known failure)

const key = (date: string, from: string, to: string) => `${date}|${from}|${to}`;

/** Resolve one rate (from→to at date). Throws if it cannot be determined. */
export async function getFxRate(date: string, from: string, to: string): Promise<number> {
  if (from === to) return 1;
  const k = key(date, from, to);
  const cached = mem.get(k);
  if (cached !== undefined) {
    if (Number.isNaN(cached)) throw new Error(`FX unavailable for ${k}`);
    return cached;
  }

  const row = await prisma.fxRate.findUnique({
    where: { date_base_quote: { date, base: from, quote: to } },
  });
  if (row) {
    mem.set(k, row.rate);
    return row.rate;
  }

  try {
    const res = await fetch(
      `https://api.frankfurter.app/${date}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`,
    );
    if (!res.ok) throw new Error(`FX http ${res.status}`);
    const data = (await res.json()) as { date?: string; rates?: Record<string, number> };
    const rate = data.rates?.[to];
    if (typeof rate !== "number") throw new Error("FX no rate");
    await prisma.fxRate
      .upsert({
        where: { date_base_quote: { date, base: from, quote: to } },
        create: { date, base: from, quote: to, rate, rateDate: data.date ?? date },
        update: { rate, rateDate: data.date ?? date },
      })
      .catch(() => undefined);
    mem.set(k, rate);
    return rate;
  } catch (e) {
    mem.set(k, NaN); // avoid hammering the API for a date/pair that has no rate
    throw e;
  }
}

/** Convert an amount; returns null when no rate is available (caller falls back). */
export async function convert(
  amount: number,
  from: string,
  to: string,
  date: string,
): Promise<number | null> {
  try {
    return amount * (await getFxRate(date, from, to));
  } catch {
    return null;
  }
}

/**
 * Prefetch all distinct (date, from)→to rates in parallel so a report load does
 * one concurrent burst instead of N sequential calls. Failures are swallowed
 * (those lines fall back to their original amount at convert-time).
 */
export async function prefetchRates(
  pairs: { date: string; from: string }[],
  to: string,
): Promise<void> {
  const seen = new Set<string>();
  const tasks: Promise<unknown>[] = [];
  for (const p of pairs) {
    if (p.from === to) continue;
    const k = key(p.date, p.from, to);
    if (seen.has(k)) continue;
    seen.add(k);
    tasks.push(getFxRate(p.date, p.from, to).catch(() => undefined));
  }
  await Promise.all(tasks);
}
