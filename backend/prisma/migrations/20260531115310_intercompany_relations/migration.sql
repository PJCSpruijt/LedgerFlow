-- CreateTable
CREATE TABLE "IntercompanyRelation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "relationId" TEXT NOT NULL,
    "relationCode" TEXT,
    "relationName" TEXT,
    "counterpartyEntityId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntercompanyRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntercompanyRelation_workspaceId_idx" ON "IntercompanyRelation"("workspaceId");

-- CreateIndex
CREATE INDEX "IntercompanyRelation_counterpartyEntityId_idx" ON "IntercompanyRelation"("counterpartyEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "IntercompanyRelation_entityId_relationId_key" ON "IntercompanyRelation"("entityId", "relationId");
