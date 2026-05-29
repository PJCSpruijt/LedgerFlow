-- Generalize YukiConnection → Connection (generic connector layer).
-- Renames the table + its constraints/indexes and adds a `kind` discriminator.
-- Existing rows are Yuki connections, so kind defaults to 'YUKI'.

CREATE TYPE "ConnectionKind" AS ENUM ('YUKI', 'EBOEKHOUDEN');

ALTER TABLE "YukiConnection" RENAME TO "Connection";

ALTER TABLE "Connection" RENAME CONSTRAINT "YukiConnection_pkey" TO "Connection_pkey";
ALTER TABLE "Connection" RENAME CONSTRAINT "YukiConnection_entityId_fkey" TO "Connection_entityId_fkey";
ALTER INDEX "YukiConnection_entityId_key" RENAME TO "Connection_entityId_key";

ALTER TABLE "Connection" ADD COLUMN "kind" "ConnectionKind" NOT NULL DEFAULT 'YUKI';
