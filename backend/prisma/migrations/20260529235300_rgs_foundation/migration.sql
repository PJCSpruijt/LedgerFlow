-- CreateTable
CREATE TABLE "RgsAccount" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referentienummer" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "parentCode" TEXT,
    "level" INTEGER NOT NULL,
    "rgsType" TEXT NOT NULL,
    "dc" TEXT,
    "isBalanceSheet" BOOLEAN NOT NULL DEFAULT false,
    "isProfitLoss" BOOLEAN NOT NULL DEFAULT false,
    "omslagCode" TEXT,
    "sbrConcept" TEXT,
    "applicability" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RgsAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceAccount" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinSemanticCategory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'METRIC',
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinSemanticCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceAccountMapping" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sourceAccountCode" TEXT NOT NULL,
    "rgsVersion" TEXT NOT NULL DEFAULT '3.5',
    "rgsCode" TEXT,
    "finCategoryId" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "SourceAccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "rgsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rgsRequired" BOOLEAN NOT NULL DEFAULT false,
    "rgsVersion" TEXT NOT NULL DEFAULT '3.5',
    "extra" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RgsAccount_version_parentCode_idx" ON "RgsAccount"("version", "parentCode");

-- CreateIndex
CREATE INDEX "RgsAccount_version_level_idx" ON "RgsAccount"("version", "level");

-- CreateIndex
CREATE UNIQUE INDEX "RgsAccount_version_code_key" ON "RgsAccount"("version", "code");

-- CreateIndex
CREATE INDEX "SourceAccount_entityId_idx" ON "SourceAccount"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceAccount_entityId_code_key" ON "SourceAccount"("entityId", "code");

-- CreateIndex
CREATE INDEX "FinSemanticCategory_workspaceId_idx" ON "FinSemanticCategory"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "FinSemanticCategory_workspaceId_key_key" ON "FinSemanticCategory"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "SourceAccountMapping_workspaceId_entityId_sourceAccountCode_idx" ON "SourceAccountMapping"("workspaceId", "entityId", "sourceAccountCode", "supersededAt");

-- CreateIndex
CREATE INDEX "SourceAccountMapping_entityId_supersededAt_idx" ON "SourceAccountMapping"("entityId", "supersededAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSettings_workspaceId_key" ON "WorkspaceSettings"("workspaceId");

-- AddForeignKey
ALTER TABLE "SourceAccount" ADD CONSTRAINT "SourceAccount_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinSemanticCategory" ADD CONSTRAINT "FinSemanticCategory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAccountMapping" ADD CONSTRAINT "SourceAccountMapping_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAccountMapping" ADD CONSTRAINT "SourceAccountMapping_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAccountMapping" ADD CONSTRAINT "SourceAccountMapping_finCategoryId_fkey" FOREIGN KEY ("finCategoryId") REFERENCES "FinSemanticCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSettings" ADD CONSTRAINT "WorkspaceSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
