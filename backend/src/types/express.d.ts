import type { OrganizationRole, PlatformRole } from "@prisma/client";

declare global {
  namespace Express {
    interface UserContext {
      id: string;
      email: string;
      platformRole: PlatformRole;
    }
    interface OrganizationContext {
      id: string;
      role: OrganizationRole;
    }
    interface Request {
      user?: UserContext;
      organization?: OrganizationContext;
    }
  }
}

export {};
