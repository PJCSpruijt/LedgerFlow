-- CreateTable
CREATE TABLE "LabIdea" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabIdea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabVote" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabComment" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabIdea_status_idx" ON "LabIdea"("status");

-- CreateIndex
CREATE INDEX "LabIdea_category_idx" ON "LabIdea"("category");

-- CreateIndex
CREATE UNIQUE INDEX "LabVote_ideaId_userId_key" ON "LabVote"("ideaId", "userId");

-- CreateIndex
CREATE INDEX "LabComment_ideaId_idx" ON "LabComment"("ideaId");

-- AddForeignKey
ALTER TABLE "LabVote" ADD CONSTRAINT "LabVote_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "LabIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabComment" ADD CONSTRAINT "LabComment_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "LabIdea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
