import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: "ledgerflow-backend" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.passwordHash",
      "*.password",
      "*.encryptedCredentials",
      "*.stripeSecretKey",
    ],
    remove: true,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
