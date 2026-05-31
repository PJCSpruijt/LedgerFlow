-- AlterTable
ALTER TABLE "ApiUsageLog" ADD COLUMN     "apiClientId" TEXT,
ADD COLUMN     "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
ADD COLUMN     "initiatorType" TEXT NOT NULL DEFAULT 'USER';

-- CreateIndex
CREATE INDEX "ApiUsageLog_initiatorType_startedAt_idx" ON "ApiUsageLog"("initiatorType", "startedAt");
