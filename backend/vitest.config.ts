import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Hermetic env so importing config/env.ts validates without a real .env.
    // dotenv/config won't override these (it only fills unset vars).
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test?schema=public",
      JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef",
      CREDENTIAL_ENCRYPTION_KEY: "0".repeat(64),
    },
  },
});
