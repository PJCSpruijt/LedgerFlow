import { ConnectorError } from "../../../utils/errors.js";
import { logger } from "../../../config/logger.js";

/**
 * Low-level transport for the e-Boekhouden REST API (https://api.e-boekhouden.nl).
 *
 * Auth flow:
 *   1. POST /v1/session { accessToken, source } → { token, expiresIn }
 *   2. Subsequent calls send `Authorization: <token>` (NOTE: the raw token, no
 *      "Bearer " prefix).
 * The session token is cached until shortly before it expires and re-minted on
 * demand (and once on a 401).
 */

const BASE_URL = "https://api.e-boekhouden.nl";

export interface EboekhoudenCredentials {
  accessToken: string;
  /** Integration label, max 10 chars (pattern ^[\w_ ]{1,10}$). Defaults to "LedgerFlow". */
  source?: string;
}

export class EboekhoudenClient {
  private token?: { value: string; expiresAt: number };

  constructor(private readonly creds: EboekhoudenCredentials) {
    if (!creds.accessToken) throw new ConnectorError("e-Boekhouden accessToken is required");
  }

  private async authenticate(): Promise<string> {
    const source = (this.creds.source ?? "LedgerFlow").slice(0, 10);
    const res = await fetch(`${BASE_URL}/v1/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: this.creds.accessToken, source }),
    });
    if (!res.ok) {
      throw new ConnectorError(`e-Boekhouden authenticatie mislukt (HTTP ${res.status})`, {
        snippet: (await res.text()).slice(0, 300),
      });
    }
    const data = (await res.json()) as { token?: string; expiresIn?: number };
    if (!data.token) throw new ConnectorError("e-Boekhouden gaf geen session-token terug");
    // Refresh a minute before the server's stated expiry.
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

    let token = await this.session();
    let res = await fetch(url, { headers: { Authorization: token } });
    if (res.status === 401) {
      // Token may have expired early — re-auth once.
      this.token = undefined;
      token = await this.session();
      res = await fetch(url, { headers: { Authorization: token } });
    }
    if (!res.ok) {
      const snippet = (await res.text()).slice(0, 300);
      logger.warn({ path, status: res.status, snippet }, "e-Boekhouden API error");
      throw new ConnectorError(`e-Boekhouden ${path} gaf HTTP ${res.status}`, { snippet });
    }
    return (await res.json()) as T;
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
