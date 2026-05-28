import Stripe from "stripe";
import { env } from "./env.js";

/**
 * Single Stripe SDK instance.
 *
 * apiVersion is pinned so the response shape stays stable across SDK upgrades —
 * the webhook handler depends on where fields like `current_period_end` live,
 * which Stripe moves between API versions. Bump this deliberately (and re-test
 * the webhook) rather than letting it drift.
 */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-02-24.acacia",
  typescript: true,
});

export const STRIPE_PRICE_IDS: Record<"STARTER" | "PROFESSIONAL" | "OFFICE", string> = {
  STARTER: env.STRIPE_PRICE_STARTER,
  PROFESSIONAL: env.STRIPE_PRICE_PROFESSIONAL,
  OFFICE: env.STRIPE_PRICE_OFFICE,
};

export function planFromPriceId(priceId: string | null | undefined):
  | "STARTER"
  | "PROFESSIONAL"
  | "OFFICE"
  | null {
  if (!priceId) return null;
  if (priceId === STRIPE_PRICE_IDS.STARTER) return "STARTER";
  if (priceId === STRIPE_PRICE_IDS.PROFESSIONAL) return "PROFESSIONAL";
  if (priceId === STRIPE_PRICE_IDS.OFFICE) return "OFFICE";
  return null;
}
