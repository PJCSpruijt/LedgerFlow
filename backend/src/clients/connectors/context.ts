/**
 * Scope a connector instance carries so its HTTP client can attribute every
 * outbound call in the API-usage ledger. Built by the registry when resolving a
 * connector for an entity; null for unscoped/mock usage.
 */
export interface ConnectorContext {
  workspaceId: string;
  groupId: string;
  entityId: string;
  /** Connection.id (the connector account). */
  connectionId: string;
  connectorType: "YUKI" | "EBOEKHOUDEN" | "MOCK";
  /** Source-system administration id (Yuki administrationId), when known. */
  sourceAdministrationId?: string | null;
}
