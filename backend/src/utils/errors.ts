/**
 * Domain error hierarchy. All thrown errors that should produce a specific
 * HTTP response must extend AppError. The error middleware maps them to
 * status + JSON body. Anything else becomes a 500.
 */
export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.name = this.constructor.name;
  }
}

/** True when a caught error is a connector rate-limit (temporary) failure. */
export function isRateLimitError(e: unknown): boolean {
  return e instanceof ConnectorError && e.rateLimited;
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: unknown) {
    super(400, "BAD_REQUEST", message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, "NOT_FOUND", message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(409, "CONFLICT", message);
  }
}

export class SubscriptionRequiredError extends AppError {
  constructor(message = "Active subscription required") {
    super(402, "SUBSCRIPTION_REQUIRED", message);
  }
}

/**
 * The workspace has an active subscription, but its plan does not include the
 * module the requested feature needs. Distinct from SubscriptionRequiredError
 * (no active plan at all) so the UI can prompt an upgrade rather than a purchase.
 */
export class ModuleRequiredError extends AppError {
  constructor(message = "Your plan does not include this feature", details?: unknown) {
    super(403, "MODULE_REQUIRED", message, details);
  }
}

/**
 * The user's account has 2FA mandated by an admin but hasn't completed
 * enrollment yet. All app APIs are blocked until they enable 2FA; the client
 * should route them to the mandatory enrollment screen.
 */
export class TwoFactorEnrollmentRequiredError extends AppError {
  constructor(message = "2FA-instelling vereist voordat je verder kunt") {
    super(403, "TWO_FACTOR_ENROLLMENT_REQUIRED", message);
  }
}

/**
 * An upstream accounting connector (Yuki, e-Boekhouden, …) failed. Two flavours:
 *  - rate-limited (daily/API limit reached) → 429, TEMPORARY: retrying later
 *    helps, so the UI shows an amber "probeer later opnieuw" notice.
 *  - everything else (auth, fault, unreachable) → 502, treated as a hard error.
 * `details` may carry raw upstream snippets (logged, never returned); the safe
 * `rateLimited` + `connector` fields are surfaced to the client by the handler.
 */
export class ConnectorError extends AppError {
  public readonly rateLimited: boolean;
  public readonly connector?: string;

  constructor(message = "Connector error", details?: { rateLimited?: boolean; connector?: string; [k: string]: unknown }) {
    const rateLimited = !!details?.rateLimited;
    super(
      rateLimited ? 429 : 502,
      rateLimited ? "CONNECTOR_RATE_LIMITED" : "CONNECTOR_ERROR",
      message,
      details,
    );
    this.rateLimited = rateLimited;
    this.connector = typeof details?.connector === "string" ? details.connector : undefined;
  }
}
