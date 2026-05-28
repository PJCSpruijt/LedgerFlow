/**
 * Thin fetch wrapper:
 *  - Adds Authorization: Bearer <access token> if present
 *  - Adds x-workspace-id / x-group-id / x-entity-id for the selected scope
 *  - Auto-refreshes on 401 once, using the httpOnly refresh cookie
 *  - Throws ApiError so the UI can render error.code / error.message uniformly
 */

const WS_KEY = "lf_scope_workspace";
const GRP_KEY = "lf_scope_group";
const ENT_KEY = "lf_scope_entity";

let inFlightRefresh: Promise<string | null> | null = null;

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Access token is held in memory only — never in localStorage/sessionStorage —
// so an XSS payload can't read it from persistent storage. It's lost on reload
// and transparently re-minted from the httpOnly refresh cookie on app boot
// (see AuthProvider) and on any 401 (see refreshAccessToken).
let accessTokenInMemory: string | null = null;

export const tokenStore = {
  get accessToken(): string | null {
    return accessTokenInMemory;
  },
  set accessToken(value: string | null) {
    accessTokenInMemory = value;
  },
};

function persist(key: string, value: string | null): void {
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

// The selected scope (workspace + optional group + optional entity). Persisted in
// localStorage so a reload keeps the user on the same administration. The api()
// wrapper sends these as x-workspace-id / x-group-id / x-entity-id headers.
export const scopeStore = {
  get workspaceId(): string | null {
    return localStorage.getItem(WS_KEY);
  },
  set workspaceId(value: string | null) {
    persist(WS_KEY, value);
  },
  get groupId(): string | null {
    return localStorage.getItem(GRP_KEY);
  },
  set groupId(value: string | null) {
    persist(GRP_KEY, value);
  },
  get entityId(): string | null {
    return localStorage.getItem(ENT_KEY);
  },
  set entityId(value: string | null) {
    persist(ENT_KEY, value);
  },
  clear(): void {
    persist(WS_KEY, null);
    persist(GRP_KEY, null);
    persist(ENT_KEY, null);
  },
};

async function refreshAccessToken(): Promise<string | null> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = (async () => {
    try {
      const res = await fetch("/auth/refresh", { method: "POST", credentials: "include" });
      if (!res.ok) return null;
      const data = (await res.json()) as { accessToken?: string };
      if (data.accessToken) {
        tokenStore.accessToken = data.accessToken;
        return data.accessToken;
      }
      return null;
    } finally {
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Skip auth (registration/login). */
  skipAuth?: boolean;
  /** Skip the auto-refresh-on-401 retry. */
  skipRefresh?: boolean;
  /** Return the raw Response (used for blob/file downloads). */
  raw?: boolean;
}

async function doFetch(path: string, opts: ApiOptions, token: string | null): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (!opts.skipAuth && token) headers.set("Authorization", `Bearer ${token}`);
  if (scopeStore.workspaceId) headers.set("x-workspace-id", scopeStore.workspaceId);
  if (scopeStore.groupId) headers.set("x-group-id", scopeStore.groupId);
  if (scopeStore.entityId) headers.set("x-entity-id", scopeStore.entityId);
  if (opts.body !== undefined && !(opts.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(path, {
    method: opts.method ?? "GET",
    headers,
    credentials: "include",
    body:
      opts.body === undefined
        ? undefined
        : opts.body instanceof FormData
          ? opts.body
          : JSON.stringify(opts.body),
  });
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  let res = await doFetch(path, opts, tokenStore.accessToken);

  if (res.status === 401 && !opts.skipAuth && !opts.skipRefresh) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await doFetch(path, opts, fresh);
  }

  if (opts.raw) return res as unknown as T;

  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* not json */
    }
    throw new ApiError(
      res.status,
      body?.error?.code ?? "HTTP_ERROR",
      body?.error?.message ?? res.statusText,
      body?.error?.details,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Trigger a file download from a JSON-authenticated endpoint. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const res = await api<Response>(path, { raw: true });
  if (!res.ok) throw new ApiError(res.status, "DOWNLOAD_FAILED", res.statusText);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
