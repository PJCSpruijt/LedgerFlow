import { useState } from "react";
import { api } from "../services/api";

/**
 * Shared invoice-PDF modal. `open(ref, name)` fetches `/api/ledger/invoice-pdf`
 * for the given opaque connector ref and shows it in an overlay; `element` is
 * the modal (render it once near the page root). Used by both the
 * receivables/payables view and the transactions table.
 */
export function usePdfModal() {
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = async (ref: string, name: string) => {
    setErr(null);
    setPdf(null);
    setLoading(true);
    try {
      const res = await api<Response>(
        `/api/ledger/invoice-pdf?ref=${encodeURIComponent(ref)}`,
        { raw: true },
      );
      if (!res.ok) {
        setErr("Geen PDF beschikbaar voor deze factuur.");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      setPdf({ url, name });
    } catch {
      setErr("Kon de factuur niet ophalen.");
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    if (pdf) URL.revokeObjectURL(pdf.url);
    setPdf(null);
    setErr(null);
    setLoading(false);
  };

  const element =
    pdf || loading || err ? (
      <div
        className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        onClick={close}
      >
        <div
          className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
            <div className="font-medium text-sm">{pdf?.name ?? "Factuur"}</div>
            <div className="flex items-center gap-3">
              {pdf && (
                <a href={pdf.url} download={`${pdf.name}.pdf`} className="lf-link text-sm">
                  Download
                </a>
              )}
              <button className="lf-btn-secondary text-xs" onClick={close}>
                Terug
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 bg-slate-100">
            {loading && <div className="p-6 text-slate-500">Factuur laden…</div>}
            {err && <div className="p-6 text-sm text-red-600">{err}</div>}
            {pdf && <iframe title="factuur" src={pdf.url} className="w-full h-full border-0" />}
          </div>
        </div>
      </div>
    ) : null;

  return { open, element };
}
