-- CreateTable
CREATE TABLE "ConnectorCache" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "paramsKey" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectorCache_entityId_idx" ON "ConnectorCache"("entityId");

-- CreateIndex
CREATE INDEX "ConnectorCache_fetchedAt_idx" ON "ConnectorCache"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorCache_entityId_method_paramsKey_key" ON "ConnectorCache"("entityId", "method", "paramsKey");
