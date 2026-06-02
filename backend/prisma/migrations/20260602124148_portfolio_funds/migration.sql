-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "fundId" TEXT,
ALTER COLUMN "workspaceId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PortfolioFund" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioFund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioHolding" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "label" TEXT,
    "stakePct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioHolding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortfolioHolding_fundId_idx" ON "PortfolioHolding"("fundId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioHolding_fundId_workspaceId_key" ON "PortfolioHolding"("fundId", "workspaceId");

-- CreateIndex
CREATE INDEX "ApiKey_fundId_idx" ON "ApiKey"("fundId");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "PortfolioFund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioHolding" ADD CONSTRAINT "PortfolioHolding_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "PortfolioFund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioHolding" ADD CONSTRAINT "PortfolioHolding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
