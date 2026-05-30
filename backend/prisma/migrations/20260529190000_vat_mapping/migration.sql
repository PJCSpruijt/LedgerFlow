-- User-maintained VAT account mappings (per workspace, optionally per entity).
CREATE TABLE "VatMapping" (
    "id"                      TEXT NOT NULL,
    "workspaceId"             TEXT NOT NULL,
    "entityId"                TEXT,
    "sourceVatCode"           TEXT NOT NULL,
    "sourceLedgerAccountCode" TEXT NOT NULL DEFAULT '',
    "targetLedgerCode"        TEXT NOT NULL,
    "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VatMapping_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VatMapping_workspaceId_idx" ON "VatMapping"("workspaceId");
CREATE INDEX "VatMapping_entityId_idx" ON "VatMapping"("entityId");

ALTER TABLE "VatMapping"
  ADD CONSTRAINT "VatMapping_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VatMapping"
  ADD CONSTRAINT "VatMapping_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
