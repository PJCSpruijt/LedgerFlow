/**
 * Emergency 2FA reset for a user — works entirely outside the web UI, so an
 * admin who has locked themselves out (lost authenticator, mandated-but-stuck
 * enrollment) can always recover.
 *
 *   npm run reset-2fa -- user@example.com
 *
 * Clears the enrolled secret, disables 2FA, AND lifts the "required" mandate so
 * the user can log in normally and (optionally) set 2FA up again.
 */
import { prisma } from "../src/config/prisma.js";

async function main(): Promise<void> {
  const [rawEmail] = process.argv.slice(2);
  if (!rawEmail) {
    console.error("Usage: npm run reset-2fa -- <email>");
    process.exit(1);
  }
  const email = rawEmail.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }

  const user = await prisma.user.update({
    where: { email },
    data: { twoFactorRequired: false, twoFactorEnabled: false, twoFactorSecret: null },
    select: { email: true, twoFactorRequired: true, twoFactorEnabled: true },
  });
  console.log(
    `2FA reset for ${user.email}: required=${user.twoFactorRequired}, enabled=${user.twoFactorEnabled}.`,
  );
  console.log("The user can now log in without 2FA and re-enroll via Instellingen.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
