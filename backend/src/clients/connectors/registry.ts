import type { Connection } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { decryptJson } from "../../utils/crypto.js";
import { NotFoundError, ConnectorError } from "../../utils/errors.js";
import type { Connector } from "./interfaces/Connector.js";
import { MockConnector } from "./mock/MockConnector.js";
import { YukiConnector, type YukiCredentials } from "./yuki/YukiConnector.js";
import {
  EboekhoudenConnector,
  type EboekhoudenCredentials,
} from "./eboekhouden/EboekhoudenConnector.js";

/** User-facing message when an administration has no connector configured. */
export const NO_CONNECTOR_MESSAGE =
  "Geen koppeling geconfigureerd voor deze administratie. Configureer deze in Instellingen → Koppeling.";

/** Instantiate the connector matching a connection's kind (decrypts credentials). */
function instantiate(conn: Connection): Connector {
  switch (conn.kind) {
    case "YUKI":
      return new YukiConnector(decryptJson<YukiCredentials>(conn.encryptedCredentials));
    case "EBOEKHOUDEN":
      return new EboekhoudenConnector(decryptJson<EboekhoudenCredentials>(conn.encryptedCredentials));
    default:
      throw new ConnectorError(`Onbekend koppelingstype: ${conn.kind}`);
  }
}

/**
 * Resolve the right connector for an entity (a single administration), or null
 * when none is configured. We deliberately do NOT fall back to mock data in live
 * mode: silently serving fake figures as if they were real would be dangerous
 * for a finance product.
 * - If CONNECTOR_MODE=mock → always MockConnector
 * - Else: load the encrypted Connection row, decrypt, and instantiate the
 *   connector matching its `kind`.
 * - If no connection is configured → null.
 *
 * Use this when a missing connection is a recoverable condition (e.g. a
 * multi-administration export that should skip unlinked administrations rather
 * than fail wholesale). When a missing connection must be a hard error, use
 * {@link getConnectorForEntity}.
 */
export async function tryGetConnectorForEntity(entityId: string): Promise<Connector | null> {
  if (env.CONNECTOR_MODE === "mock") return new MockConnector();

  const conn = await prisma.connection.findUnique({ where: { entityId } });
  if (!conn) return null;
  return instantiate(conn);
}

/**
 * Like {@link tryGetConnectorForEntity}, but throws NotFoundError when no
 * connection is configured. Use this for single-administration operations where
 * a missing connection is a hard error.
 */
export async function getConnectorForEntity(entityId: string): Promise<Connector> {
  const connector = await tryGetConnectorForEntity(entityId);
  if (!connector) {
    throw new NotFoundError(NO_CONNECTOR_MESSAGE);
  }
  return connector;
}
