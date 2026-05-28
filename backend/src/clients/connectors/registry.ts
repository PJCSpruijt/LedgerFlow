import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { decryptJson } from "../../utils/crypto.js";
import { NotFoundError } from "../../utils/errors.js";
import type { Connector } from "./interfaces/Connector.js";
import { MockConnector } from "./mock/MockConnector.js";
import { YukiConnector, type YukiCredentials } from "./yuki/YukiConnector.js";

/**
 * Resolve the right connector for an organization.
 * - If CONNECTOR_MODE=mock → always MockConnector
 * - Else: load the encrypted YukiConnection row, decrypt, instantiate.
 * - If no connection is configured, throw NotFoundError. We deliberately do NOT
 *   fall back to mock data in yuki mode: silently serving fake figures as if
 *   they were real Yuki data would be dangerous for a finance product.
 */
export async function getConnectorForOrganization(organizationId: string): Promise<Connector> {
  if (env.CONNECTOR_MODE === "mock") return new MockConnector();

  const conn = await prisma.yukiConnection.findUnique({ where: { organizationId } });
  if (!conn) {
    throw new NotFoundError(
      "Geen Yuki-verbinding geconfigureerd voor deze organisatie. Configureer deze in Instellingen → Yuki.",
    );
  }
  const creds = decryptJson<YukiCredentials>(conn.encryptedCredentials);
  return new YukiConnector(creds);
}
