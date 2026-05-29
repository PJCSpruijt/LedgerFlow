-- Plan catalog + per-subscription plan link.
-- Additive only: introduces a managed Plan table, seeds the three existing
-- plans (keys match the legacy SubscriptionPlan enum so Stripe mapping keeps
-- working), links Subscription.planId, and backfills it from the legacy enum.

CREATE TYPE "BillingInterval" AS ENUM ('MONTH', 'YEAR');

CREATE TABLE "Plan" (
    "id"            TEXT NOT NULL,
    "key"           TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "description"   TEXT,
    "priceCents"    INTEGER NOT NULL DEFAULT 0,
    "currency"      TEXT NOT NULL DEFAULT 'EUR',
    "interval"      "BillingInterval" NOT NULL DEFAULT 'MONTH',
    "modules"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "stripePriceId" TEXT,
    "active"        BOOLEAN NOT NULL DEFAULT true,
    "sortOrder"     INTEGER NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");

-- Seed the three existing plans (idempotent on key via ON CONFLICT).
INSERT INTO "Plan" ("id", "key", "name", "description", "priceCents", "currency", "interval", "modules", "active", "sortOrder", "updatedAt")
VALUES
  (gen_random_uuid(), 'STARTER', 'Starter', 'Voor een enkele administratie.', 2900, 'EUR', 'MONTH',
    ARRAY['EXPORTS','YUKI_SYNC']::TEXT[], true, 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PROFESSIONAL', 'Professional', 'Voor meerdere administraties met AI-commentaar.', 7900, 'EUR', 'MONTH',
    ARRAY['EXPORTS','YUKI_SYNC','MULTI_ADMIN','AI_INSIGHTS']::TEXT[], true, 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OFFICE', 'Office', 'Onbeperkt, met consolidatie en API-toegang.', 19900, 'EUR', 'MONTH',
    ARRAY['EXPORTS','YUKI_SYNC','MULTI_ADMIN','CONSOLIDATION','AI_INSIGHTS','API_ACCESS']::TEXT[], true, 3, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "Subscription" ADD COLUMN "planId" TEXT;

CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill planId from the legacy enum so existing subscriptions point at the
-- managed plan row.
UPDATE "Subscription" s
SET "planId" = p."id"
FROM "Plan" p
WHERE s."plan" IS NOT NULL AND s."plan"::text = p."key";
