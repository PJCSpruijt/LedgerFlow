-- CreateTable
CREATE TABLE "ConsolidationAdjustment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "groupId" TEXT,
    "description" TEXT NOT NULL,
    "debitRgsCode" TEXT NOT NULL,
    "creditRgsCode" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "effectiveDate" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsolidationAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsolidationAdjustment_workspaceId_idx" ON "ConsolidationAdjustment"("workspaceId");

-- CreateIndex
CREATE INDEX "ConsolidationAdjustment_groupId_idx" ON "ConsolidationAdjustment"("groupId");
