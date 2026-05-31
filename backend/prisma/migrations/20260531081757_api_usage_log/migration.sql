-- CreateTable
CREATE TABLE "ApiUsageLog" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "correlationId" TEXT,
    "jobId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "workspaceId" TEXT,
    "groupId" TEXT,
    "entityId" TEXT,
    "connectorType" TEXT,
    "connectorAccountId" TEXT,
    "sourceAdministrationId" TEXT,
    "operationType" TEXT NOT NULL,
    "endpointName" TEXT NOT NULL,
    "httpMethod" TEXT,
    "soapAction" TEXT,
    "statusCode" INTEGER,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "recordsRequested" INTEGER,
    "recordsReceived" INTEGER,
    "bytesSent" INTEGER,
    "bytesReceived" INTEGER,
    "paginationCursor" TEXT,
    "rateLimitLimit" INTEGER,
    "rateLimitRemaining" INTEGER,
    "rateLimitResetAt" TIMESTAMP(3),
    "initiatedBy" TEXT,
    "requestHash" TEXT,
    "responseHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiUsageLog_workspaceId_startedAt_idx" ON "ApiUsageLog"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "ApiUsageLog_entityId_startedAt_idx" ON "ApiUsageLog"("entityId", "startedAt");

-- CreateIndex
CREATE INDEX "ApiUsageLog_connectorType_startedAt_idx" ON "ApiUsageLog"("connectorType", "startedAt");

-- CreateIndex
CREATE INDEX "ApiUsageLog_success_startedAt_idx" ON "ApiUsageLog"("success", "startedAt");
