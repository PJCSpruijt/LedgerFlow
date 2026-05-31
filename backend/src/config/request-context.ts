import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-inbound-request context, propagated through async calls. Lets deep layers
 * (e.g. connector HTTP clients) attach the originating user + a correlation id
 * to API-usage logs without threading them through every function signature.
 */
export interface RequestContext {
  correlationId: string;
  userId?: string;
  /** Who initiated this request: an interactive UI user, an external API client,
   *  or a system/cron job. Drives the channel split in usage statistics. */
  initiatorType?: "USER" | "API" | "SYSTEM";
  /** External API client id when initiatorType = "API" (Output API, #30). */
  apiClientId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export const getRequestContext = (): RequestContext | undefined => requestContext.getStore();
