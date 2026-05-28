/**
 * Grant or revoke the PLATFORM_ADMIN (superuser) role for a user.
 *
 *   npm run platform-admin -- grant  user@example.com
 *   npm run platform-admin -- revoke user@example.com
 *
 * Deliberately a CLI action (not auto-promotion from env) so every superuser
 * grant is an explicit, traceable operation.
 */
import { PlatformRole } from "@prisma/client";
import { prisma } from "../src/config/prisma.js";

async function main(): Promise<void> {
  const [action, rawEmail] = process.argv.slice(2);
  if ((action !== "grant" && action !== "revoke") || !rawEmail) {
    console.error("Usage: npm run platform-admin -- <grant|revoke> <email>");
    process.exit(1);
  }
  const email = rawEmail.toLowerCase();
  const platformRole = action === "grant" ? PlatformRole.PLATFORM_ADMIN : PlatformRole.USER;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }

  const user = await prisma.user.update({ where: { email }, data: { platformRole } });
  console.log(`${action === "grant" ? "Granted" : "Revoked"} PLATFORM_ADMIN for ${user.email} (now ${user.platformRole}).`);
  if (action === "grant") {
    console.log("Note: existing access tokens pick up the new role on next refresh (≤ access TTL).");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
