import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { requestContext } from "../config/request-context.js";
import { verifyApiKey, checkRate } from "../services/api-key.service.js";
import { logApiUsage } from "../services/api-usage.service.js";
import { ForbiddenError, UnauthorizedError } from "../utils/errors.js";

/**
 * Authenticate an external Output-API client by API key (Authorization: Bearer
 * <key> or X-API-Key). Read-only (GET only), per-key rate-limited, and marked as
 * API/INBOUND traffic in the usage ledger. The validated key is on res.locals.apiKey.
 */
export const requireApiKey: RequestHandler = async (req, res, next) => {
  try {
    const raw = (
      req.header("x-api-key") ||
      req.header("authorization")?.replace(/^Bearer\s+/i, "") ||
      ""
    ).trim();
    if (!raw) throw new UnauthorizedError("API-sleutel vereist (X-API-Key of Bearer-token)");

    const key = await verifyApiKey(raw);
    if (!key) throw new UnauthorizedError("Ongeldige, verlopen of ingetrokken API-sleutel");
    if (req.method !== "GET") throw new ForbiddenError("De Output API is alleen-lezen");

    if (!checkRate(key.id, key.rateLimitPerMin)) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: { code: "rate_limited", message: "Rate limit bereikt" } });
      return;
    }

    res.locals.apiKey = key;
    requestContext.enterWith({ correlationId: randomUUID(), initiatorType: "API", apiClientId: key.id });

    // Audit/usage log of the external access — written when the response finishes.
    const startedAt = new Date();
    res.on("finish", () => {
      logApiUsage({
        context: null,
        direction: "INBOUND",
        workspaceId: key.workspaceId,
        entityId: key.entityId,
        startedAt,
        endedAt: new Date(),
        operationType: "output_api",
        endpointName: req.path,
        httpMethod: req.method,
        statusCode: res.statusCode,
        success: res.statusCode < 400,
      });
    });

    next();
  } catch (e) {
    next(e);
  }
};
