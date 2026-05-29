import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, scopeStore } from "../services/api";
import { useAuth } from "./AuthContext";

export type ScopedRole =
  | "WORKSPACE_ADMIN"
  | "ACCOUNTANT_ADMIN"
  | "ACCOUNTANT_USER"
  | "CLIENT_ADMIN"
  | "CLIENT_USER"
  | "READ_ONLY"
  | "MAPPING_MANAGER"
  | "CONSOLIDATION_MANAGER";

const ADMIN_ROLES: ScopedRole[] = ["WORKSPACE_ADMIN", "ACCOUNTANT_ADMIN", "CLIENT_ADMIN"];
export const isAdminRole = (role: ScopedRole | null | undefined): boolean =>
  role != null && ADMIN_ROLES.includes(role);

export interface EntityNode {
  id: string;
  name: string;
  role: ScopedRole;
}
export interface GroupNode {
  id: string;
  name: string;
  role: ScopedRole;
  entities: EntityNode[];
}
export interface WorkspaceNode {
  id: string;
  name: string;
  type: string;
  role: ScopedRole;
  groups: GroupNode[];
}

interface ScopeContextValue {
  workspaces: WorkspaceNode[];
  loading: boolean;
  workspace: WorkspaceNode | null;
  group: GroupNode | null;
  entity: EntityNode | null;
  /** Effective role at the deepest selected level. */
  role: ScopedRole | null;
  selectWorkspace: (id: string) => void;
  selectGroup: (id: string | null) => void;
  selectEntity: (id: string | null) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState<string | null>(scopeStore.workspaceId);
  const [groupId, setGroupId] = useState<string | null>(scopeStore.groupId);
  const [entityId, setEntityId] = useState<string | null>(scopeStore.entityId);

  const reload = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setLoading(false);
      return;
    }
    // While the user must still enroll in mandated 2FA, the backend blocks all
    // /api calls — skip loading the scope tree until enrollment completes.
    if (user.twoFactorRequired && !user.twoFactorEnabled) {
      setWorkspaces([]);
      setLoading(false);
      return;
    }
    const r = await api<{ workspaces: WorkspaceNode[] }>("/api/workspaces");
    setWorkspaces(r.workspaces);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Reconcile the persisted selection against the loaded tree. Drop ids that no
  // longer exist and default to the first available workspace/group/entity.
  useEffect(() => {
    if (loading) return;
    let ws = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0] ?? null;
    let nextWs = ws?.id ?? null;

    let grp = ws?.groups.find((g) => g.id === groupId) ?? ws?.groups[0] ?? null;
    let nextGrp = grp?.id ?? null;

    let ent = grp?.entities.find((e) => e.id === entityId) ?? grp?.entities[0] ?? null;
    let nextEnt = ent?.id ?? null;

    if (nextWs !== workspaceId) {
      scopeStore.workspaceId = nextWs;
      setWorkspaceId(nextWs);
    }
    if (nextGrp !== groupId) {
      scopeStore.groupId = nextGrp;
      setGroupId(nextGrp);
    }
    if (nextEnt !== entityId) {
      scopeStore.entityId = nextEnt;
      setEntityId(nextEnt);
    }
  }, [loading, workspaces, workspaceId, groupId, entityId]);

  const selectWorkspace = (id: string) => {
    scopeStore.workspaceId = id;
    setWorkspaceId(id);
    // Reset deeper selection — the effect re-defaults group/entity for the new workspace.
    scopeStore.groupId = null;
    scopeStore.entityId = null;
    setGroupId(null);
    setEntityId(null);
  };

  const selectGroup = (id: string | null) => {
    scopeStore.groupId = id;
    setGroupId(id);
    scopeStore.entityId = null;
    setEntityId(null);
  };

  const selectEntity = (id: string | null) => {
    scopeStore.entityId = id;
    setEntityId(id);
  };

  const workspace = workspaces.find((w) => w.id === workspaceId) ?? null;
  const group = workspace?.groups.find((g) => g.id === groupId) ?? null;
  const entity = group?.entities.find((e) => e.id === entityId) ?? null;
  const role = entity?.role ?? group?.role ?? workspace?.role ?? null;

  return (
    <Ctx.Provider
      value={{
        workspaces,
        loading,
        workspace,
        group,
        entity,
        role,
        selectWorkspace,
        selectGroup,
        selectEntity,
        reload,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useScope(): ScopeContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useScope must be used inside ScopeProvider");
  return v;
}
