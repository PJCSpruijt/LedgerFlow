import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

interface RgsResult {
  code: string;
  description: string;
  level: number;
  isBalanceSheet: boolean;
  isProfitLoss: boolean;
}

/**
 * Typeahead over the workspace's RGS taxonomy: type (part of) a code or
 * description and pick a matching RGS account. Optionally constrained to the
 * balans/W&V side of the source account being mapped.
 */
export function RgsCodeSearch({
  accountType,
  onPick,
}: {
  accountType?: string;
  onPick: (code: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<RgsResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const side = accountType === "BALANCE" ? "B" : accountType === "PROFIT_LOSS" ? "W" : undefined;

  // Debounced search as the user types.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    let cancel = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api<{ results: RgsResult[] }>(
          `/api/rgs-mappings/rgs-search?q=${encodeURIComponent(term)}${side ? `&side=${side}` : ""}`,
        );
        if (!cancel) {
          setResults(r.results);
          setOpen(true);
          setHi(0);
        }
      } catch {
        if (!cancel) setResults([]);
      } finally {
        if (!cancel) setLoading(false);
      }
    }, 250);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [q, side]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pick = (code: string) => {
    onPick(code);
    setQ("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <input
        className="lf-input font-mono text-xs h-7 py-0 w-48"
        placeholder="Zoek RGS-code of omschrijving…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (results[hi]) pick(results[hi].code);
            else if (/^[BW]/i.test(q.trim())) pick(q.trim()); // accept a typed exact code
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (loading || results.length > 0) && (
        <div className="absolute z-50 mt-1 w-[26rem] max-h-72 overflow-auto bg-white border border-slate-200 rounded-md shadow-lg text-xs">
          {loading && <div className="px-3 py-2 text-slate-400">Zoeken…</div>}
          {results.map((r, i) => (
            <button
              key={r.code}
              type="button"
              className={`w-full text-left px-3 py-1.5 flex gap-2 ${i === hi ? "bg-brand-50" : "hover:bg-slate-50"}`}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(r.code)}
            >
              <span className="font-mono text-slate-600 shrink-0">{r.code}</span>
              <span className="text-slate-500 truncate">{r.description}</span>
            </button>
          ))}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-slate-400">Geen resultaten</div>
          )}
        </div>
      )}
    </div>
  );
}
