import { ApiError } from "../services/api";

/** True when an error is a TEMPORARY connector rate-limit (daily/API limit). */
export function isRateLimited(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "CONNECTOR_RATE_LIMITED" || (error.details as { rateLimited?: boolean } | undefined)?.rateLimited === true)
  );
}

/**
 * Uniform error renderer that distinguishes a TEMPORARY connector rate-limit
 * (amber, "probeer later opnieuw" + retry) from a HARD error (red). Use on data
 * pages so a daily-limit reads as a transient hiccup, not a failure.
 */
export function ErrorNotice({
  error,
  fallback = "Er ging iets mis",
  onRetry,
}: {
  error: unknown;
  fallback?: string;
  onRetry?: () => void;
}) {
  const message = error instanceof ApiError ? error.message : fallback;
  if (isRateLimited(error)) {
    return (
      <div className="lf-card bg-amber-50 ring-1 ring-amber-200 text-amber-900 text-sm flex items-center justify-between gap-3">
        <span>⏳ {message}</span>
        {onRetry && (
          <button className="lf-link text-sm whitespace-nowrap" onClick={onRetry}>
            Opnieuw proberen
          </button>
        )}
      </div>
    );
  }
  return <div className="lf-card text-sm text-red-600">{message}</div>;
}

/**
 * Inline badge for a per-administration status: amber "daglimiet" when the
 * entity dropped out due to a rate limit, otherwise a neutral "not included".
 */
export function EntityStatusBadge({
  included,
  reason,
  rateLimited,
}: {
  included: boolean;
  reason?: string;
  rateLimited?: boolean;
}) {
  if (included) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs ring-1 bg-emerald-50 text-emerald-700 ring-emerald-200" title="Meegenomen">
        ✓
      </span>
    );
  }
  if (rateLimited) {
    return (
      <span
        className="px-2 py-0.5 rounded-full text-xs ring-1 bg-amber-50 text-amber-800 ring-amber-200"
        title={reason ?? "Daglimiet bereikt"}
      >
        ⏳ daglimiet
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-xs ring-1 bg-slate-100 text-slate-400 ring-slate-200" title={reason ?? "Niet meegenomen"}>
      —
    </span>
  );
}
