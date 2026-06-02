import { ConnectorError } from "../../../utils/errors.js";
import { logger } from "../../../config/logger.js";
import type { ConnectorContext } from "../context.js";
import { classifyOperation, logApiUsage, sha256 } from "../../../services/api-usage.service.js";
import { withRetry } from "../retry.js";

/**
 * Low-level transport for the e-Boekhouden REST API (https://api.e-boekhouden.nl).
 *
 * Auth flow:
 *   1. POST /v1/session { accessToken, source } → { token, expiresIn }
 *   2. Subsequent calls send `Authorization: <token>` (NOTE: the raw token, no
 *      "Bearer " prefix).
 * The session token is cached until shortly before it expires and re-minted on
 * demand (and once on a 401).
 *
 * Every outbound call is recorded in the API-usage ledger (#26) — metadata only,
 * never the token or full payloads.
 */

const BASE_URL = "https://api.e-boekhouden.nl";

export interface EboekhoudenCredentials {
  accessToken: string;
  /** Integration label, max 10 chars (pattern ^[\w_ ]{1,10}$). Defaults to "LedgerFlow". */
  source?: string;
}

function rateLimit(headers: Headers) {
  const num = (h: string) => {
    const v = headers.get(h);
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    rateLimitLimit: num("x-ratelimit-limit") ?? num("ratelimit-limit"),
    rateLimitRemaining: num("x-ratelimit-remaining") ?? num("ratelimit-remaining"),
  };
}

export class EboekhoudenClient {
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly creds: EboekhoudenCredentials,
    private readonly ctx?: ConnectorContext,
  ) {
    if (!creds.accessToken) throw new ConnectorError("e-Boekhouden accessToken is required");
  }

  private async authenticate(): Promise<string> {
    const source = (this.creds.source ?? "LedgerFlow").slice(0, 10);
    const startedAt = new Date();
    const res = await fetch(`${BASE_URL}/v1/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: this.creds.accessToken, source }),
    });
    const text = await res.text();
    logApiUsage({
      context: this.ctx ?? null,
      startedAt,
      endedAt: new Date(),
      operationType: "token_refresh",
      endpointName: "/v1/session",
      httpMethod: "POST",
      statusCode: res.status,
      success: res.ok,
      errorCode: res.ok ? null : String(res.status),
      bytesReceived: text.length,
      requestHash: sha256("POST /v1/session"),
      responseHash: sha256(text),
    });
    if (!res.ok) {
      throw new ConnectorError(`e-Boekhouden authenticatie mislukt (HTTP ${res.status})`, {
        snippet: text.slice(0, 300),
      });
    }
    const data = JSON.parse(text) as { token?: string; expiresIn?: number };
    if (!data.token) throw new ConnectorError("e-Boekhouden gaf geen session-token terug");
    this.token = { value: data.token, expiresAt: Date.now() + ((data.expiresIn ?? 3600) - 60) * 1000 };
    return this.token.value;
  }

  private async session(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    return this.authenticate();
  }

  /** GET a JSON resource. Brackets in keys (e.g. `date[gte]`) are encoded. */
  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const qs = query
      ? "?" +
        Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    const url = `${BASE_URL}${path}${qs}`;
    const startedAt = new Date();
    let retryCount = 0;

    let token = await this.session();
    // Retry only transient network failures; a 429/daily-limit is handled below.
    let res = await withRetry(() => fetch(url, { headers: { Authorization: token } }), { label: `e-Boekhouden GET ${path}` });
    if (res.status === 401) {
      // Token may have expired early — re-auth once.
      retryCount = 1;
      this.token = undefined;
      token = await this.session();
      res = await withRetry(() => fetch(url, { headers: { Authorization: token } }), { label: `e-Boekhouden GET ${path}` });
    }
    const text = await res.text();
    const records = (() => {
      try {
        const j = JSON.parse(text) as { items?: unknown[] };
        return Array.isArray(j.items) ? j.items.length : null;
      } catch {
        return null;
      }
    })();
    logApiUsage({
      context: this.ctx ?? null,
      startedAt,
      endedAt: new Date(),
      operationType: classifyOperation("EBOEKHOUDEN", path, "GET"),
      endpointName: path,
      httpMethod: "GET",
      statusCode: res.status,
      success: res.ok,
      errorCode: res.ok ? null : String(res.status),
      retryCount,
      recordsReceived: records,
      bytesReceived: text.length,
      paginationCursor: query?.["offset"] != null ? String(query["offset"]) : null,
      ...rateLimit(res.headers),
      requestHash: sha256(`GET ${path}${qs}`),
      responseHash: sha256(text),
    });

    if (!res.ok) {
      logger.warn({ path, status: res.status, snippet: text.slice(0, 300) }, "e-Boekhouden API error");
      // Rate-limit / daily-limit → clear message instead of a bare HTTP status.
      if (res.status === 429 || /rate.?limit|limit exceeded|too many requests|quota/i.test(text)) {
        throw new ConnectorError(
          "Daglimiet/rate-limit van de e-Boekhouden-koppeling bereikt. De data kan tijdelijk niet worden opgehaald; probeer het later opnieuw.",
          { statusCode: res.status, rateLimited: true, connector: "eboekhouden" },
        );
      }
      throw new ConnectorError(`e-Boekhouden ${path} gaf HTTP ${res.status}`, { snippet: text.slice(0, 300) });
    }
    return JSON.parse(text) as T;
  }

  /** Revoke the current session token (best-effort). */
  async close(): Promise<void> {
    if (!this.token) return;
    try {
      await fetch(`${BASE_URL}/v1/session`, {
        method: "DELETE",
        headers: { Authorization: this.token.value },
      });
    } catch {
      /* best-effort */
    }
    this.token = undefined;
  }
}
