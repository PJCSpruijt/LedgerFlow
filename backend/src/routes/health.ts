import { Router } from "express";
import { prisma } from "../config/prisma.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  // Lightweight readiness check — pings the DB.
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "ok", time: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "degraded", db: "error" });
  }
});
