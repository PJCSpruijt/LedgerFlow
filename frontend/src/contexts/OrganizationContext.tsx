import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, orgStore } from "../services/api";
import { useAuth } from "./AuthContext";

export interface OrgSummary {
  id: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  subscription: {
    plan: "STARTER" | "PROFESSIONAL" | "OFFICE" | null;
    status: string;
    validUntil: string | null;
  } | null;
  hasYukiConnection: boolean;
}

interface OrgContextValue {
  organizations: OrgSummary[];
  current: OrgSummary | null;
  loading: boolean;
  setCurrent: (id: string) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<OrgContextValue | null>(null);

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<OrgSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(orgStore.current);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) {
      setOrganizations([]);
      setLoading(false);
      return;
    }
    const r = await api<{ organizations: OrgSummary[] }>("/api/organizations");
    setOrganizations(r.organizations);
    setLoading(false);

    if (!currentId || !r.organizations.find((o) => o.id === currentId)) {
      const first = r.organizations[0];
      if (first) {
        orgStore.current = first.id;
        setCurrentId(first.id);
      }
    }
  }, [user, currentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setCurrent = (id: string) => {
    orgStore.current = id;
    setCurrentId(id);
  };

  const current = organizations.find((o) => o.id === currentId) ?? null;

  return (
    <Ctx.Provider value={{ organizations, current, loading, setCurrent, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export function useOrg(): OrgContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOrg must be used inside OrganizationProvider");
  return v;
}
