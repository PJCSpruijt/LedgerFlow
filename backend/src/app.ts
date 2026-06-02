import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import rateLimit from "express-rate-limit";
import type { IncomingMessage, ServerResponse } from "node:http";

import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { enforceTwoFactorEnrollment } from "./middleware/auth.js";

import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { workspaceRouter } from "./routes/workspaces.js";
import { ledgerRouter } from "./routes/ledger.js";
import { teamRouter } from "./routes/team.js";
import { reportingRouter } from "./routes/reporting.js";
import { exportRouter } from "./routes/export.js";
import { billingRouter, stripeWebhookRouter } from "./routes/billing.js";
import { adminRouter } from "./routes/admin.js";
import { vatMappingRouter } from "./routes/vatMapping.js";
import { rgsMappingRouter } from "./routes/rgsMapping.js";
import { consolidationRouter } from "./routes/consolidation.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { workspaceSettingsRouter } from "./routes/workspaceSettings.js";
import { v1Router } from "./routes/v1.js";
import { apiKeysRouter } from "./routes/apiKeys.js";

/**
 * Build the Express app. Exposed as a factory so tests can mount it without
 * actually listening on a port.
 */
export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // Stripe webhook MUST receive the raw body for signature verification —
  // mount it BEFORE express.json().
  app.use("/api/billing/webhook", stripeWebhookRouter);

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()),
      credentials: true,
      // Let the browser SPA read these on download responses (otherwise hidden
      // cross-origin): the filename, and which administrations the export skipped.
      exposedHeaders: ["Content-Disposition", "X-Skipped-Administrations"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    }),
  );

  // Global rate limit. Auth and billing routes apply stricter limits internally.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );

  // Routes
  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  // External Output API (#30): API-key auth, independent of the internal 2FA/JWT
  // pipeline. Mounted before the /api 2FA guard so external clients aren't blocked.
  app.use("/api/v1", v1Router);
  // Hard-block all app APIs for users with admin-mandated-but-not-enrolled 2FA.
  // (Enrollment lives under /auth, which is mounted above and stays reachable.)
  app.use("/api", enforceTwoFactorEnrollment);
  app.use("/api/workspaces", workspaceRouter);
  app.use("/api/api-keys", apiKeysRouter);
  // Connector-neutral ledger API (serves Yuki, e-Boekhouden, … via the registry).
  app.use("/api/ledger", ledgerRouter);
  // Deprecated alias — kept temporarily so cached clients keep working; remove
  // once all callers use /api/ledger.
  app.use("/api/yuki", ledgerRouter);
  app.use("/api/team", teamRouter);
  app.use("/api/reporting", reportingRouter);
  app.use("/api/export", exportRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/vat-mappings", vatMappingRouter);
  app.use("/api/rgs-mappings", rgsMappingRouter);
  app.use("/api/consolidation", consolidationRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/workspace-settings", workspaceSettingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
