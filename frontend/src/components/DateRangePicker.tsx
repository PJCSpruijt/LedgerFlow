import { useEffect, useMemo, useRef, useState } from "react";

const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
type Mode = "maand" | "kwartaal" | "jaar";

interface Range {
  from: string; // YYYY-MM-DD
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m1: number, d: number) => `${y}-${pad(m1)}-${pad(d)}`;
const lastDay = (y: number, m1: number) => new Date(y, m1, 0).getDate(); // m1 = 1..12

/** Date span for one selectable cell, given the mode + displayed year. */
function cellRange(mode: Mode, year: number, idx: number): Range {
  if (mode === "jaar") return { from: iso(year, 1, 1), to: iso(year, 12, 31) };
  if (mode === "kwartaal") {
    const start = idx * 3 + 1;
    const end = start + 2;
    return { from: iso(year, start, 1), to: iso(year, end, lastDay(year, end)) };
  }
  const m = idx + 1;
  return { from: iso(year, m, 1), to: iso(year, m, lastDay(year, m)) };
}

function labelFor(r: Range): string {
  const [fy, fm] = r.from.split("-").map(Number);
  const [ty, tm] = r.to.split("-").map(Number);
  const start = `${MONTHS[fm - 1]} ${fy}`;
  const end = `${MONTHS[tm - 1]} ${ty}`;
  return start === end ? start : `${start} – ${end}`;
}

export function DateRangePicker({
  value,
  onChange,
}: {
  value: Range;
  onChange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("maand");
  const [year, setYear] = useState<number>(() => Number(value.from.slice(0, 4)) || new Date().getFullYear());
  const [anchor, setAnchor] = useState<Range | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Re-sync the displayed year when the popover (re)opens.
  useEffect(() => {
    if (open) {
      setYear(Number(value.from.slice(0, 4)) || new Date().getFullYear());
      setAnchor(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cells = mode === "jaar" ? [0] : mode === "kwartaal" ? [0, 1, 2, 3] : [...Array(12).keys()];

  const pick = (idx: number) => {
    const r = cellRange(mode, year, idx);
    if (!anchor) {
      // First click: provisional single-unit selection.
      setAnchor(r);
      onChange(r.from, r.to);
      return;
    }
    // Second click: extend from the anchor to here (order-independent, cross-year).
    const from = anchor.from < r.from ? anchor.from : r.from;
    const to = anchor.to > r.to ? anchor.to : r.to;
    setAnchor(null);
    onChange(from, to);
    setOpen(false);
  };

  const isSelected = (idx: number) => {
    const r = cellRange(mode, year, idx);
    return r.from >= value.from && r.to <= value.to;
  };

  const buttonLabel = useMemo(() => labelFor(value), [value.from, value.to]);

  return (
    <div className="relative" ref={ref}>
      <button
        className="lf-input text-xs h-9 py-0 px-3 w-48 text-left whitespace-nowrap"
        onClick={() => setOpen((o) => !o)}
        title="Periode (van / tot)"
      >
        📅 {buttonLabel}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-slate-200 z-50 p-3">
          <div className="flex items-center justify-between mb-2">
            <button className="lf-btn-secondary text-xs px-2" onClick={() => setYear((y) => y - 1)}>
              ‹
            </button>
            <span className="text-sm font-semibold">{year}</span>
            <button className="lf-btn-secondary text-xs px-2" onClick={() => setYear((y) => y + 1)}>
              ›
            </button>
          </div>

          <div className={`grid gap-1 ${mode === "maand" ? "grid-cols-4" : mode === "kwartaal" ? "grid-cols-4" : "grid-cols-1"}`}>
            {cells.map((idx) => {
              const label =
                mode === "jaar" ? String(year) : mode === "kwartaal" ? `K${idx + 1}` : MONTHS[idx];
              const sel = isSelected(idx);
              const isAnchor = anchor && cellRange(mode, year, idx).from === anchor.from && cellRange(mode, year, idx).to === anchor.to;
              return (
                <button
                  key={idx}
                  onClick={() => pick(idx)}
                  className={`py-2 text-sm rounded-md transition-colors ${
                    sel
                      ? "bg-brand-600 text-white"
                      : isAnchor
                        ? "bg-brand-200 text-brand-800"
                        : "hover:bg-slate-100 text-slate-700"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-xs">
              {(["maand", "kwartaal", "jaar"] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    setAnchor(null);
                  }}
                  className={`px-3 py-1.5 capitalize ${
                    mode === m ? "bg-brand-50 text-brand-700 font-medium" : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-slate-400">
              {anchor ? "Kies einde…" : "Klik 1 cel of 2 voor bereik"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
