-- CreateTable
CREATE TABLE "RelationCanonicalOverride" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "relationName" TEXT,
    "canonicalKey" TEXT NOT NULL,
    "displayName" TEXT,
    "vatNumber" TEXT,
    "email" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelationCanonicalOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RelationCanonicalOverride_workspaceId_idx" ON "RelationCanonicalOverride"("workspaceId");

-- CreateIndex
CREATE INDEX "RelationCanonicalOverride_workspaceId_canonicalKey_idx" ON "RelationCanonicalOverride"("workspaceId", "canonicalKey");

-- CreateIndex
CREATE UNIQUE INDEX "RelationCanonicalOverride_entityId_relationId_key" ON "RelationCanonicalOverride"("entityId", "relationId");
