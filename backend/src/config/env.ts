import "dotenv/config";
import { z } from "zod";

/**
 * Centralized, validated environment configuration.
 * Throws on startup if anything required is missing.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be >= 16 chars"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),

  // 32-byte key, hex-encoded → 64 hex chars
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "CREDENTIAL_ENCRYPTION_KEY must be 64 hex chars (32 bytes)"),

  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  // Public base URL of the frontend, used to build invitation / password-reset
  // links in emails.
  APP_BASE_URL: z.string().url().default("http://localhost:5173"),

  // 2FA (TOTP) issuer label shown in authenticator apps.
  TOTP_ISSUER: z.string().default("LedgerFlow"),

  // Outbound email (SMTP). When SMTP_HOST is empty the email service runs in
  // "dev" mode: it logs the message + returns the link instead of sending.
  EMAIL_FROM: z.string().default("LedgerFlow <no-reply@ledgerflow.local>"),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  // Parse a few truthy spellings; default false (STARTTLS on 587).
  SMTP_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1" || v === "yes"),

  CONNECTOR_MODE: z.enum(["mock", "yuki"]).default("mock"),

  STRIPE_SECRET_KEY: z.string().default("sk_test_placeholder"),
  STRIPE_WEBHOOK_SECRET: z.string().default("whsec_placeholder"),
  STRIPE_PRICE_STARTER: z.string().default("price_starter_placeholder"),
  STRIPE_PRICE_PROFESSIONAL: z.string().default("price_professional_placeholder"),
  STRIPE_PRICE_OFFICE: z.string().default("price_office_placeholder"),
  STRIPE_SUCCESS_URL: z.string().url().default("http://localhost:5173/billing/success"),
  STRIPE_CANCEL_URL: z.string().url().default("http://localhost:5173/billing/cancel"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
export type Env = typeof env;
