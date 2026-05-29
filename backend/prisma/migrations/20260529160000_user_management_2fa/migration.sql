-- User management: 2FA (TOTP) fields + single-use invitation / password-reset tokens.
-- Additive only.

ALTER TABLE "User" ADD COLUMN "twoFactorEnabled"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "twoFactorRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "twoFactorSecret"   TEXT;

CREATE TYPE "UserTokenKind" AS ENUM ('INVITE', 'PASSWORD_RESET');

CREATE TABLE "UserToken" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "kind"      "UserTokenKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserToken_tokenHash_key" ON "UserToken"("tokenHash");
CREATE INDEX "UserToken_userId_idx" ON "UserToken"("userId");

ALTER TABLE "UserToken"
  ADD CONSTRAINT "UserToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
