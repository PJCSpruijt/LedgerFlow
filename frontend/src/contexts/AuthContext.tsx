import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, tokenStore, orgStore } from "../services/api";

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  organizationName: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!tokenStore.accessToken) {
          // Try refresh in case the http-only cookie is still valid.
          const r = await fetch("/auth/refresh", { method: "POST", credentials: "include" });
          if (r.ok) {
            const data = (await r.json()) as { accessToken?: string };
            if (data.accessToken) tokenStore.accessToken = data.accessToken;
          }
        }
        if (tokenStore.accessToken) {
          const me = await api<{ user: AuthUser }>("/auth/me");
          if (!cancelled) setUser(me.user);
        }
      } catch {
        tokenStore.accessToken = null;
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const r = await api<{ user: AuthUser; accessToken: string }>("/auth/login", {
      method: "POST",
      body: { email, password },
      skipAuth: true,
    });
    tokenStore.accessToken = r.accessToken;
    setUser(r.user);
  };

  const register = async (input: RegisterInput) => {
    const r = await api<{ user: AuthUser; accessToken: string }>("/auth/register", {
      method: "POST",
      body: input,
      skipAuth: true,
    });
    tokenStore.accessToken = r.accessToken;
    setUser(r.user);
  };

  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    tokenStore.accessToken = null;
    orgStore.current = null;
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
