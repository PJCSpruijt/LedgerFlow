import { SubscriptionStatus, type Subscription } from "@prisma/client";

/** Statuses that grant access to premium features (exports, syncs). */
const ACTIVE_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
]);

export function isSubscriptionActive(sub: Subscription | null | undefined): boolean {
  if (!sub) return false;
  if (!ACTIVE_STATUSES.has(sub.status)) return false;
  if (sub.validUntil && sub.validUntil.getTime() < Date.now()) return false;
  return true;
}

export function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return SubscriptionStatus.TRIALING;
    case "active":
      return SubscriptionStatus.ACTIVE;
    case "past_due":
      return SubscriptionStatus.PAST_DUE;
    case "canceled":
      return SubscriptionStatus.CANCELED;
    case "unpaid":
      return SubscriptionStatus.UNPAID;
    case "incomplete":
      return SubscriptionStatus.INCOMPLETE;
    case "incomplete_expired":
      return SubscriptionStatus.INCOMPLETE_EXPIRED;
    case "paused":
      return SubscriptionStatus.PAUSED;
    default:
      return SubscriptionStatus.NONE;
  }
}
