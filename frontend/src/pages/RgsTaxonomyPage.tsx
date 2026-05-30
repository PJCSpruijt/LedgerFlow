import { useEffect, useState } from "react";
import { api, ApiError } from "../services/api";

interface VersionInfo {
  versions: { version: string; count: number }[];
  bundled: string;
}
interface RgsAccount {
  code: string;
  description: string;
  level: number;
  isBalanceSheet: boolean;
  isProfitLoss: boolean;
  dc: string | null;
  referentienummer: string | null;
}

/** Platformbeheer → RGS-taxonomie: import/refresh + browse the RGS standard. */
export function RgsTaxonomyPage() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [version, setVersion] = useState<string>("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<RgsAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadVersions = async () => {
    try {
      const r = await api<VersionInfo>("/api/admin/rgs/versions");
      setInfo(r);
      setVersion((v) => v || r.versions[0]?.version || r.bundled);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Kon versies niet laden");
    }
  };

  useEffect(() => {
    void loadVersions();
  }, []);

  const search = async () => {
    if (!version) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ accounts: RgsAccount[] }>(
        `/api/admin/rgs/accounts?version=${encodeURIComponent(version)}${q ? `&q=${encodeURIComponent(q)}` : ""}&limit=200`,
      );
      setRows(r.accounts);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Zoeken mislukt");
    } finally {
      setBusy(false);
    }
  };

  const importBundled = async () => {
    setImporting(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api<{ version: string; imported: number }>("/api/admin/rgs/import", {
        method: "POST",
        body: { source: "bundled" },
      });
      setMsg(`RGS ${r.version} geïmporteerd: ${r.imported} codes.`);
      await loadVersions();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Import mislukt");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">RGS-taxonomie</h1>
        <p className="text-sm text-slate-500 mt-1">
          Beheer het Referentie Grootboekschema (platform-breed). Importeer of ververs de gebundelde
          dataset, of upload een officiële RGS-export via de API om een versie te vervangen.
        </p>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}
      {msg && <div className="text-sm text-emerald-700">{msg}</div>}

      <div className="lf-card space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold">Geladen versies</h2>
          <button className="lf-btn-secondary" onClick={importBundled} disabled={importing}>
            {importing ? "Importeren…" : `Gebundelde dataset importeren (${info?.bundled ?? "?"})`}
          </button>
        </div>
        {!info ? (
          <div className="text-sm text-slate-400">Laden…</div>
        ) : info.versions.length === 0 ? (
          <div className="text-sm text-amber-700">
            Nog geen RGS-versie geladen — klik op importeren om de gebundelde dataset te laden.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4 font-medium">Versie</th>
                <th className="py-2 pr-4 font-medium text-right">Aantal codes</th>
              </tr>
            </thead>
            <tbody>
              {info.versions.map((v) => (
                <tr key={v.version} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-mono">{v.version}</td>
                  <td className="py-2 pr-4 text-right text-slate-600">{v.count.toLocaleString("nl-NL")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="lf-card space-y-3">
        <h2 className="text-lg font-semibold">Taxonomie doorzoeken</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="lf-label">Versie</label>
            <select className="lf-input" value={version} onChange={(e) => setVersion(e.target.value)}>
              {info?.versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="lf-label">Zoek (code of omschrijving)</label>
            <input
              className="lf-input w-full"
              value={q}
              placeholder="bijv. omzet, debiteuren, BIva…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
            />
          </div>
          <button className="lf-btn-secondary" onClick={search} disabled={busy || !version}>
            {busy ? "Zoeken…" : "Zoek"}
          </button>
        </div>

        {rows.length > 0 && (
          <div className="overflow-auto max-h-[55vh]">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 px-3 font-medium">Code</th>
                  <th className="py-2 px-3 font-medium">Omschrijving</th>
                  <th className="py-2 px-3 font-medium">Niveau</th>
                  <th className="py-2 px-3 font-medium">B/W</th>
                  <th className="py-2 px-3 font-medium">D/C</th>
                  <th className="py-2 px-3 font-medium">Ref.nr</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code} className="border-b border-slate-100">
                    <td className="py-1.5 px-3 font-mono">{r.code}</td>
                    <td className="py-1.5 px-3">{r.description}</td>
                    <td className="py-1.5 px-3 text-slate-500">{r.level}</td>
                    <td className="py-1.5 px-3">{r.isBalanceSheet ? "Balans" : r.isProfitLoss ? "W&V" : "—"}</td>
                    <td className="py-1.5 px-3 text-slate-500">{r.dc ?? ""}</td>
                    <td className="py-1.5 px-3 font-mono text-slate-400">{r.referentienummer ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
