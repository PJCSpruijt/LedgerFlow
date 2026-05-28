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

export class ConnectorError extends AppError {
  constructor(message = "Connector error", details?: unknown) {
    super(502, "CONNECTOR_ERROR", message, details);
  }
}
