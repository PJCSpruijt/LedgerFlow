-- CreateTable
CREATE TABLE "ConsolidationRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "groupId" TEXT,
    "label" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "eliminate" BOOLEAN NOT NULL DEFAULT false,
    "entityCount" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsolidationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsolidationRun_workspaceId_createdAt_idx" ON "ConsolidationRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsolidationRun_groupId_idx" ON "ConsolidationRun"("groupId");
