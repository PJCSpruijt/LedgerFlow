import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "../config/prisma.js";

/**
 * RGS (Referentie Grootboekschema) taxonomy import.
 *
 * RGS is a public, versioned Dutch account standard, so the taxonomy is stored
 * platform-globally (`RgsAccount`, unique per version+code) and imported by a
 * platform admin. The importer is FORMAT-TOLERANT: it accepts both our own
 * normalized JSON shape and a raw RGS export (CSV/JSON parsed to objects) with
 * the canonical column names (Referentiecode, Omschrijving, Nivo, D/C,
 * Referentienummer, ReferentieOmslagcode). This lets the official RGS 3.5
 * Excel/CSV be uploaded to replace the bundled default without code changes.
 */

export interface RgsAccountInput {
  version: string;
  code: string;
  referentienummer: string | null;
  description: string;
  category: string | null;
  parentCode: string | null;
  level: number;
  rgsType: string;
  dc: string | null;
  isBalanceSheet: boolean;
  isProfitLoss: boolean;
  omslagCode: string | null;
  sbrConcept: string | null;
  applicability: unknown;
}

const TYPE_BY_LEVEL: Record<number, string> = {
  1: "report",
  2: "mainGroup",
  3: "category",
  4: "account",
  5: "mutation",
};

const norm = (s: string) => s.toLowerCase().replace(/[\s/_.()-]+/g, "");
function pick(row: Record<string, unknown>, aliases: string[]): string {
  for (const a of aliases) {
    for (const k of Object.keys(row)) {
      if (norm(k) === norm(a)) {
        const v = row[k];
        return v == null ? "" : String(v).trim();
      }
    }
  }
  return "";
}

/** Parent referentiecode: codes are B/W + 3-letter groups, one per level. */
function deriveParent(code: string): string | null {
  if (code.length <= 1) return null;
  if (code.length === 4) return code.charAt(0); // level-2 → the B/W root
  return code.slice(0, code.length - 3);
}

/**
 * Normalize an arbitrary RGS row set. Rows already in our shape (have `code` +
 * numeric `level`) pass through with light coercion; raw RGS exports are mapped
 * from their canonical column names and the derived fields are computed.
 */
export function parseRgsRows(version: string, raw: unknown[]): RgsAccountInput[] {
  const out: RgsAccountInput[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const code = (pick(row, ["code", "Referentiecode", "RGS-code", "RGScode"]) || "").trim();
    if (!code || !/^[BW]/i.test(code)) continue;
    const first = code.charAt(0).toUpperCase();
    const levelRaw = pick(row, ["level", "Nivo", "Niveau"]);
    const level =
      Number.parseInt(levelRaw, 10) ||
      (code.length <= 1 ? 1 : Math.min(5, Math.floor((code.length - 1) / 3) + 1));
    const description =
      pick(row, ["description", "Omschrijving"]) || pick(row, ["Omschrijving (verkort)", "OmschrijvingKort"]);
    const dc = pick(row, ["dc", "D/C", "DC"]).toUpperCase() || null;
    const applic = (row as { applicability?: unknown }).applicability ?? null;
    out.push({
      version,
      code,
      referentienummer: pick(row, ["referentienummer", "Referentienummer", "RefNr"]) || null,
      description,
      category: pick(row, ["category", "Rubriek"]) || null,
      parentCode:
        (pick(row, ["parentCode"]) || "").trim() || deriveParent(code),
      level,
      rgsType: pick(row, ["rgsType"]) || TYPE_BY_LEVEL[level] || "account",
      dc,
      isBalanceSheet: first === "B",
      isProfitLoss: first === "W",
      omslagCode: pick(row, ["omslagCode", "ReferentieOmslagcode", "Omslagcode"]) || null,
      sbrConcept: pick(row, ["sbrConcept", "SBRConcept"]) || null,
      applicability: applic,
    });
  }
  return out;
}

/**
 * Replace the taxonomy for a version (authoritative refresh): delete all rows of
 * that version, then bulk-insert the parsed set. Idempotent — re-running yields
 * the same table. Deduplicates by code within the batch.
 */
export async function importRgsDataset(
  version: string,
  raw: unknown[],
): Promise<{ version: string; imported: number }> {
  const parsed = parseRgsRows(version, raw);
  // Drop duplicate codes within the incoming batch (the unique key is version+code).
  const byCode = new Map<string, RgsAccountInput>();
  for (const p of parsed) byCode.set(p.code, p);
  const data = [...byCode.values()].map((p) => ({
    version: p.version,
    code: p.code,
    referentienummer: p.referentienummer,
    description: p.description,
    category: p.category,
    parentCode: p.parentCode,
    level: p.level,
    rgsType: p.rgsType,
    dc: p.dc,
    isBalanceSheet: p.isBalanceSheet,
    isProfitLoss: p.isProfitLoss,
    omslagCode: p.omslagCode,
    sbrConcept: p.sbrConcept,
    // undefined → column stays NULL; an array/object is stored as JSON.
    applicability: p.applicability == null ? undefined : (p.applicability as object),
  }));

  await prisma.$transaction([
    prisma.rgsAccount.deleteMany({ where: { version } }),
    prisma.rgsAccount.createMany({ data, skipDuplicates: true }),
  ]);
  return { version, imported: data.length };
}

/** The bundled default RGS dataset shipped with the app (prisma/data). */
export function loadBundledRgs(): { version: string; rows: RgsAccountInput[] } {
  const url = new URL("../../prisma/data/rgs-3.3.json", import.meta.url);
  const rows = JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as RgsAccountInput[];
  return { version: rows[0]?.version ?? "3.3", rows };
}

/** Versions currently loaded, with row counts. */
export async function listRgsVersions(): Promise<{ version: string; count: number }[]> {
  const grouped = await prisma.rgsAccount.groupBy({
    by: ["version"],
    _count: { _all: true },
    orderBy: { version: "asc" },
  });
  return grouped.map((g) => ({ version: g.version, count: g._count._all }));
}

/** Search/browse the taxonomy of a version (for the platform admin browser). */
export async function searchRgsAccounts(opts: {
  version: string;
  q?: string;
  parentCode?: string;
  level?: number;
  limit?: number;
}): Promise<unknown[]> {
  const { version, q, parentCode, level, limit = 100 } = opts;
  return prisma.rgsAccount.findMany({
    where: {
      version,
      ...(parentCode ? { parentCode } : {}),
      ...(level ? { level } : {}),
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { referentienummer: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: [{ level: "asc" }, { code: "asc" }],
    take: Math.min(limit, 500),
  });
}
