import { useState } from "react";
import { api } from "../services/api";

/**
 * "Export naar Excel" + "PDF/print" buttons for any data overview. `getRows` is
 * called on click and should return the rows currently shown (respecting the
 * user's filters/sorting/grouping). Excel is generated server-side from those
 * rows; PDF uses the browser print dialog with a print stylesheet.
 */
export function ExportButtons({
  getRows,
  filename,
  sheetName,
}: {
  getRows: () => Record<string, unknown>[];
  filename: string;
  sheetName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const excel = async () => {
    const rows = getRows();
    if (!rows.length) {
      setErr("Geen gegevens om te exporteren");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await api<Response>("/api/export/sheet", {
        method: "POST",
        body: { filename, sheetName, rows },
        raw: true,
      });
      if (!res.ok) throw new Error("export failed");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErr("Export mislukt (mogelijk te veel regels)");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 no-print">
      <button className="lf-btn-secondary text-xs" onClick={excel} disabled={busy} title="Exporteer naar Excel">
        {busy ? "Bezig…" : "⬇ Excel"}
      </button>
      <button
        className="lf-btn-secondary text-xs"
        onClick={() => window.print()}
        title="Afdrukken of opslaan als PDF"
      >
        🖨 PDF
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
