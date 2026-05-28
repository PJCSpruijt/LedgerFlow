-- Phase 2: Workspace > Group > Entity hierarchy + scoped Membership.
-- Three stages: (1) additive create, (2) backfill from Organization/OrganizationUser,
-- (3) enforce constraints + drop the old flat tables. Destructive at stage 3.

-- ============================================================
-- STAGE 1 — additive (new enums, tables, nullable columns)
-- ============================================================

CREATE TYPE "WorkspaceType" AS ENUM ('COMPANY', 'ACCOUNTING_FIRM');
CREATE TYPE "ScopeLevel" AS ENUM ('WORKSPACE', 'GROUP', 'ENTITY');
CREATE TYPE "ScopedRole" AS ENUM (
  'WORKSPACE_ADMIN', 'ACCOUNTANT_ADMIN', 'ACCOUNTANT_USER', 'CLIENT_ADMIN',
  'CLIENT_USER', 'READ_ONLY', 'MAPPING_MANAGER', 'CONSOLIDATION_MANAGER'
);

CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WorkspaceType" NOT NULL DEFAULT 'COMPANY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopeLevel" "ScopeLevel" NOT NULL,
    "role" "ScopedRole" NOT NULL,
    "workspaceId" TEXT,
    "groupId" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Subscription" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "YukiConnection" ADD COLUMN "entityId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "groupId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "entityId" TEXT;

-- ============================================================
-- STAGE 2 — backfill from the old flat Organization model
-- One Organization becomes: Workspace (reusing the org id) + one Group + one Entity.
-- ============================================================

-- Workspace per Organization; reuse the org id so existing FK values map 1:1.
INSERT INTO "Workspace" ("id", "name", "type", "createdAt", "updatedAt")
SELECT "id", "name", 'COMPANY', "createdAt", CURRENT_TIMESTAMP
FROM "Organization";

-- One Group per workspace.
INSERT INTO "Group" ("id", "workspaceId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid(), w."id", w."name", w."createdAt", CURRENT_TIMESTAMP
FROM "Workspace" w;

-- One Entity per group.
INSERT INTO "Entity" ("id", "groupId", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid(), g."id", g."name", g."createdAt", CURRENT_TIMESTAMP
FROM "Group" g;

-- Subscription -> workspace (workspace.id == old organizationId).
UPDATE "Subscription" SET "workspaceId" = "organizationId";

-- YukiConnection -> the entity under the org's (single) group.
UPDATE "YukiConnection" yc
SET "entityId" = e."id"
FROM "Group" g
JOIN "Entity" e ON e."groupId" = g."id"
WHERE g."workspaceId" = yc."organizationId";

-- AuditLog -> workspace.
UPDATE "AuditLog" SET "workspaceId" = "organizationId";

-- OrganizationUser -> workspace-level Membership, with role mapping.
INSERT INTO "Membership" ("id", "userId", "scopeLevel", "role", "workspaceId", "createdAt")
SELECT
  gen_random_uuid(),
  ou."userId",
  'WORKSPACE',
  CASE ou."role"
    WHEN 'OWNER'  THEN 'WORKSPACE_ADMIN'::"ScopedRole"
    WHEN 'ADMIN'  THEN 'WORKSPACE_ADMIN'::"ScopedRole"
    WHEN 'MEMBER' THEN 'CLIENT_USER'::"ScopedRole"
    WHEN 'VIEWER' THEN 'READ_ONLY'::"ScopedRole"
  END,
  ou."organizationId",
  ou."createdAt"
FROM "OrganizationUser" ou;

-- ============================================================
-- STAGE 3 — enforce constraints, drop old structures
-- ============================================================

-- New-table FKs.
ALTER TABLE "Group" ADD CONSTRAINT "Group_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Group_workspaceId_idx" ON "Group"("workspaceId");
CREATE INDEX "Entity_groupId_idx" ON "Entity"("groupId");
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");
CREATE INDEX "Membership_workspaceId_idx" ON "Membership"("workspaceId");
CREATE INDEX "Membership_groupId_idx" ON "Membership"("groupId");
CREATE INDEX "Membership_entityId_idx" ON "Membership"("entityId");

-- Exactly one scope FK is set, and it matches scopeLevel. Prisma cannot express
-- this, so it lives here as raw SQL (may show as drift in future `migrate dev`).
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_one_scope_chk" CHECK (
  (("workspaceId" IS NOT NULL)::int + ("groupId" IS NOT NULL)::int + ("entityId" IS NOT NULL)::int) = 1
  AND (("scopeLevel" = 'WORKSPACE') = ("workspaceId" IS NOT NULL))
  AND (("scopeLevel" = 'GROUP')     = ("groupId" IS NOT NULL))
  AND (("scopeLevel" = 'ENTITY')    = ("entityId" IS NOT NULL))
);

-- At most one membership per (user, scope target).
CREATE UNIQUE INDEX "Membership_userId_workspaceId_key" ON "Membership"("userId", "workspaceId") WHERE "workspaceId" IS NOT NULL;
CREATE UNIQUE INDEX "Membership_userId_groupId_key" ON "Membership"("userId", "groupId") WHERE "groupId" IS NOT NULL;
CREATE UNIQUE INDEX "Membership_userId_entityId_key" ON "Membership"("userId", "entityId") WHERE "entityId" IS NOT NULL;

-- Subscription: swap organizationId -> workspaceId.
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_organizationId_fkey";
DROP INDEX "Subscription_organizationId_key";
ALTER TABLE "Subscription" DROP COLUMN "organizationId";
ALTER TABLE "Subscription" ALTER COLUMN "workspaceId" SET NOT NULL;
CREATE UNIQUE INDEX "Subscription_workspaceId_key" ON "Subscription"("workspaceId");
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- YukiConnection: swap organizationId -> entityId.
ALTER TABLE "YukiConnection" DROP CONSTRAINT "YukiConnection_organizationId_fkey";
DROP INDEX "YukiConnection_organizationId_key";
ALTER TABLE "YukiConnection" DROP COLUMN "organizationId";
ALTER TABLE "YukiConnection" ALTER COLUMN "entityId" SET NOT NULL;
CREATE UNIQUE INDEX "YukiConnection_entityId_key" ON "YukiConnection"("entityId");
ALTER TABLE "YukiConnection" ADD CONSTRAINT "YukiConnection_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AuditLog: swap organizationId -> workspaceId (+ optional group/entity).
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_organizationId_fkey";
DROP INDEX "AuditLog_organizationId_timestamp_idx";
ALTER TABLE "AuditLog" DROP COLUMN "organizationId";
ALTER TABLE "AuditLog" ALTER COLUMN "workspaceId" SET NOT NULL;
CREATE INDEX "AuditLog_workspaceId_timestamp_idx" ON "AuditLog"("workspaceId", "timestamp");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Drop the old flat model.
DROP TABLE "OrganizationUser";
DROP TABLE "Organization";
DROP TYPE "OrganizationRole";
