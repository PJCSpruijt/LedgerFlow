-- CreateTable
CREATE TABLE "EliminationAccountMapping" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "glAccountCode" TEXT NOT NULL,
    "glAccountName" TEXT,
    "eliminate" BOOLEAN NOT NULL DEFAULT true,
    "counterpartyEntityId" TEXT,
    "category" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EliminationAccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EliminationAccountMapping_workspaceId_idx" ON "EliminationAccountMapping"("workspaceId");

-- CreateIndex
CREATE INDEX "EliminationAccountMapping_counterpartyEntityId_idx" ON "EliminationAccountMapping"("counterpartyEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "EliminationAccountMapping_entityId_glAccountCode_key" ON "EliminationAccountMapping"("entityId", "glAccountCode");
