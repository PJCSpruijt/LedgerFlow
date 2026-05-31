import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import type { ApiKey } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireApiKey } from "../middleware/apiKey.js";
import { getRequestContext } from "../config/request-context.js";

/**
 * FIN//HUB Output API v1 (#30) — external, read-only, API-key-authenticated.
 * Exposes the normalized / semantic model (NOT connector-native structures) for
 * tools like Visionplanner, Caseware, Power BI and Excel Power Query.
 *
 * Every response is wrapped in a metadata envelope; every request is logged as
 * INBOUND/API traffic in the usage ledger (see middleware/apiKey).
 */

export const v1Router = Router();

/** Wrap a payload in the standard v1 envelope (request id + generation metadata). */
function sendV1(res: Response, data: unknown, meta: Record<string, unknown> = {}): void {
  res.json({
    data,
    meta: {
      requestId: getRequestContext()?.correlationId ?? randomUUID(),
      generatedAt: new Date().toISOString(),
      apiVersion: "v1",
      ...meta,
    },
  });
}

const keyOf = (res: Response): ApiKey => res.locals.apiKey as ApiKey;

// ---- Discovery (public, no key) -------------------------------------------
const OPENAPI = {
  openapi: "3.0.3",
  info: {
    title: "FIN//HUB Output API",
    version: "1.0.0",
    description:
      "Read-only access to FIN//HUB's normalized, RGS-mapped and (later) consolidated financial data.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
      bearer: { type: "http", scheme: "bearer" },
    },
  },
  security: [{ apiKey: [] }, { bearer: [] }],
  paths: {
    "/ping": { get: { summary: "Health/auth check", responses: { "200": { description: "OK" } } } },
    "/workspaces": { get: { summary: "Tenant: the key's workspace", responses: { "200": { description: "OK" } } } },
    "/groups": { get: { summary: "Tenant: consolidation groups", responses: { "200": { description: "OK" } } } },
    "/entities": { get: { summary: "Tenant: administrations", responses: { "200": { description: "OK" } } } },
  },
} as const;

v1Router.get("/openapi.json", (_req, res) => res.json(OPENAPI));

// ---- Authenticated, read-only ---------------------------------------------
v1Router.use(requireApiKey);

v1Router.get("/ping", (_req, res) => sendV1(res, { ok: true }));

v1Router.get(
  "/workspaces",
  asyncHandler(async (_req, res) => {
    const key = keyOf(res);
    const ws = await prisma.workspace.findUnique({
      where: { id: key.workspaceId },
      select: { id: true, name: true, type: true },
    });
    sendV1(res, ws ? [ws] : []);
  }),
);

v1Router.get(
  "/groups",
  asyncHandler(async (_req, res) => {
    const key = keyOf(res);
    const groups = await prisma.group.findMany({
      where: { workspaceId: key.workspaceId },
      select: { id: true, name: true, workspaceId: true },
      orderBy: { name: "asc" },
    });
    sendV1(res, groups);
  }),
);

v1Router.get(
  "/entities",
  asyncHandler(async (_req, res) => {
    const key = keyOf(res);
    const entities = await prisma.entity.findMany({
      where: {
        group: { workspaceId: key.workspaceId },
        ...(key.entityId ? { id: key.entityId } : {}),
      },
      select: { id: true, name: true, groupId: true },
      orderBy: { name: "asc" },
    });
    sendV1(res, entities);
  }),
);
