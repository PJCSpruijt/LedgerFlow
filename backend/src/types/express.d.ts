import type { PlatformRole, ScopedRole, ScopeLevel } from "@prisma/client";

declare global {
  namespace Express {
    interface UserContext {
      id: string;
      email: string;
      platformRole: PlatformRole;
    }
    // The resolved scope for a request: always a workspace, optionally narrowed
    // to a group and/or entity. `roles` holds every scoped role the user has that
    // applies to this chain; `role` is the most-privileged one (for display).
    interface ScopeContext {
      workspaceId: string;
      groupId?: string;
      entityId?: string;
      scopeLevel: ScopeLevel;
      role: ScopedRole;
      roles: ScopedRole[];
    }
    interface Request {
      user?: UserContext;
      scope?: ScopeContext;
    }
  }
}

export {};
