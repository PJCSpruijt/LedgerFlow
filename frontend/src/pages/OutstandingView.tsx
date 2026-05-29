import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { formatMoney } from "../lib/period";

interface Item {
  relationId: string;
  relationName: string;
  relationCode: string | null;
  invoiceNumber: string | null;
  date: string;
  dueDate: string | null;
  totalAmount: number;
  openAmount: number;
  documentId: string | null;
}

type Bucket = "current" | "d30" | "d60" | "d90" | "d90p";
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "current", label: "Niet vervallen" },
  { key: "d30", label: "1–30" },
  { key: "d60", label: "31–60" },
  { key: "d90", label: "61–90" },
  { key: "d90p", label: "> 90" },
];

function ageDays(it: Item): number {
  const ref = it.dueDate || it.date;
  const d = new Date(`${ref}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}
function bucketOf(age: number): Bucket {
  if (age <= 0) return "current";
  if (age <= 30) return "d30";
  if (age <= 60) return "d60";
  if (age <= 90) return "d90";
  return "d90p";
}

interface Group {
  id: string;
  name: string;
  code: string | null;
  items: Item[];
  total: number;
  buckets: Record<Bucket, number>;
}

export function OutstandingView({ kind }: { kind: "debtor" | "creditor" }) {
  const { entity, currency } = useScope();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const openPdf = async (it: Item) => {
    if (!it.documentId) return;
    setPdfError(null);
    setPdf(null);
    setPdfLoading(true);
    try {
      const res = await api<Response>(
        `/api/yuki/invoice-pdf?ref=${encodeURIComponent(it.documentId)}`,
        { raw: true },
      );
      if (!res.ok) {
        setPdfError("Geen PDF beschikbaar voor deze factuur.");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      setPdf({ url, name: it.invoiceNumber ?? "factuur" });
    } catch {
      setPdfError("Kon de factuur niet ophalen.");
    } finally {
      setPdfLoading(false);
    }
  };
  const closePdf = () => {
    if (pdf) URL.revokeObjectURL(pdf.url);
    setPdf(null);
    setPdfError(null);
    setPdfLoading(false);
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["outstanding", kind, entity?.id],
    queryFn: () => api<{ items: Item[] }>(`/api/yuki/outstanding?type=${kind}`),
    enabled: !!entity,
  });

  const { groups, totals } = useMemo(() => {
    const byRel = new Map<string, Group>();
    const totals: Record<Bucket, number> = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
    let grand = 0;
    for (const it of data?.items ?? []) {
      const key = it.relationId || it.relationName;
      const g =
        byRel.get(key) ??
        ({
          id: key,
          name: it.relationName || key,
          code: it.relationCode,
          items: [],
          total: 0,
          buckets: { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 },
        } as Group);
      const b = bucketOf(ageDays(it));
      g.items.push(it);
      g.total += it.openAmount;
      g.buckets[b] += it.openAmount;
      totals[b] += it.openAmount;
      grand += it.openAmount;
      byRel.set(key, g);
    }
    const groups = [...byRel.values()].sort((a, b) => b.total - a.total);
    return { groups, totals: { ...totals, grand } };
  }, [data]);

  const title = kind === "debtor" ? "Debiteuren (openstaand)" : "Crediteuren (openstaand)";
  const toggle = (id: string) =>
    setOpen((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="space-y-4">
      {(pdf || pdfLoading || pdfError) && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={closePdf}
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
                <button className="lf-btn-secondary text-xs" onClick={closePdf}>
                  Terug
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 bg-slate-100">
              {pdfLoading && <div className="p-6 text-slate-500">Factuur laden…</div>}
              {pdfError && <div className="p-6 text-sm text-red-600">{pdfError}</div>}
              {pdf && <iframe title="factuur" src={pdf.url} className="w-full h-full border-0" />}
            </div>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {entity ? entity.name : "Selecteer een administratie"} · ouderdom o.b.v. vervaldatum
        </p>
      </div>

      {!entity && <div className="lf-card max-w-2xl">Selecteer een administratie in de bovenbalk.</div>}
      {entity && isLoading && <div className="lf-card">Laden…</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">
          {error instanceof ApiError ? error.message : "Kon openstaande posten niet laden"}
        </div>
      )}

      {entity && data && (
        <div className="lf-card p-0">
          <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-100">
            {groups.length} relaties · totaal openstaand {formatMoney(totals.grand, currency)}
          </div>
          <div className="overflow-auto max-h-[calc(100vh-230px)]">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 px-3 font-medium whitespace-nowrap">Relatie</th>
                  <th className="py-2 px-3 font-medium text-right whitespace-nowrap">#</th>
                  {BUCKETS.map((b) => (
                    <th key={b.key} className="py-2 px-3 font-medium text-right whitespace-nowrap">
                      {b.label}
                    </th>
                  ))}
                  <th className="py-2 px-3 font-medium text-right whitespace-nowrap">Openstaand</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const isOpen = open.has(g.id);
                  return (
                    <Fragment key={g.id}>
                      <tr
                        className="border-b border-slate-100 cursor-pointer hover:bg-slate-50"
                        onClick={() => toggle(g.id)}
                      >
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span className="inline-block w-4 text-slate-400">{isOpen ? "▾" : "▸"}</span>
                          {g.name}
                          {g.code && <span className="ml-2 font-mono text-xs text-slate-400">{g.code}</span>}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-500">{g.items.length}</td>
                        {BUCKETS.map((b) => (
                          <td
                            key={b.key}
                            className={`py-2 px-3 text-right whitespace-nowrap ${
                              b.key === "d90p" && g.buckets.d90p > 0 ? "text-red-600" : "text-slate-600"
                            }`}
                          >
                            {g.buckets[b.key] ? formatMoney(g.buckets[b.key], currency) : ""}
                          </td>
                        ))}
                        <td className="py-2 px-3 text-right font-semibold whitespace-nowrap">
                          {formatMoney(g.total, currency)}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={8} className="bg-slate-50 px-3 py-2">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-slate-400">
                                  <th className="py-1 px-2 font-medium">Datum</th>
                                  <th className="py-1 px-2 font-medium">Vervaldatum</th>
                                  <th className="py-1 px-2 font-medium">Factuurnr.</th>
                                  <th className="py-1 px-2 font-medium text-right">Totaal</th>
                                  <th className="py-1 px-2 font-medium text-right">Openstaand</th>
                                  <th className="py-1 px-2 font-medium text-right">Ouderdom</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.items
                                  .slice()
                                  .sort((a, b) => ageDays(b) - ageDays(a))
                                  .map((it, i) => {
                                    const age = ageDays(it);
                                    return (
                                      <tr key={i} className="border-t border-slate-100">
                                        <td className="py-1 px-2 whitespace-nowrap">{it.date}</td>
                                        <td className="py-1 px-2 whitespace-nowrap">{it.dueDate ?? "—"}</td>
                                        <td className="py-1 px-2 whitespace-nowrap">
                                          {it.documentId ? (
                                            <button
                                              className="lf-link"
                                              title="Bekijk factuur (PDF)"
                                              onClick={() => openPdf(it)}
                                            >
                                              {it.invoiceNumber ?? "—"}
                                            </button>
                                          ) : (
                                            (it.invoiceNumber ?? "")
                                          )}
                                        </td>
                                        <td className="py-1 px-2 text-right whitespace-nowrap">
                                          {formatMoney(it.totalAmount, currency)}
                                        </td>
                                        <td className="py-1 px-2 text-right whitespace-nowrap">
                                          {formatMoney(it.openAmount, currency)}
                                        </td>
                                        <td
                                          className={`py-1 px-2 text-right whitespace-nowrap ${
                                            age > 90 ? "text-red-600" : age > 0 ? "text-amber-700" : "text-slate-500"
                                          }`}
                                        >
                                          {age > 0 ? `${age} d` : "—"}
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {groups.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-3 px-3 text-slate-400">
                      Geen openstaande posten.
                    </td>
                  </tr>
                )}
              </tbody>
              {groups.length > 0 && (
                <tfoot className="sticky bottom-0 bg-white">
                  <tr className="border-t-2 border-slate-300 font-semibold">
                    <td className="py-2 px-3">Totaal</td>
                    <td className="py-2 px-3"></td>
                    {BUCKETS.map((b) => (
                      <td key={b.key} className="py-2 px-3 text-right whitespace-nowrap">
                        {formatMoney(totals[b.key], currency)}
                      </td>
                    ))}
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {formatMoney(totals.grand, currency)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
