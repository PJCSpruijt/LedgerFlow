-- CreateTable
CREATE TABLE "WorkspaceAccountDefault" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceAccountCode" TEXT NOT NULL,
    "rgsVersion" TEXT NOT NULL DEFAULT '3.5',
    "rgsCode" TEXT,
    "finCategoryId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceAccountDefault_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceAccountDefault_workspaceId_idx" ON "WorkspaceAccountDefault"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceAccountDefault_workspaceId_sourceAccountCode_key" ON "WorkspaceAccountDefault"("workspaceId", "sourceAccountCode");

-- AddForeignKey
ALTER TABLE "WorkspaceAccountDefault" ADD CONSTRAINT "WorkspaceAccountDefault_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceAccountDefault" ADD CONSTRAINT "WorkspaceAccountDefault_finCategoryId_fkey" FOREIGN KEY ("finCategoryId") REFERENCES "FinSemanticCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
