/** "Laatst opgehaald" + een knop om de connector-data integraal opnieuw op te halen. */
export function CacheBar({
  cachedAt,
  refreshing,
  onRefresh,
}: {
  cachedAt?: string | null;
  refreshing?: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400 no-print">
      {cachedAt && <span title={new Date(cachedAt).toLocaleString("nl-NL")}>Laatst opgehaald: {fetchedLabel(cachedAt)}</span>}
      <button className="lf-link" onClick={onRefresh} disabled={refreshing} title="Haal de gegevens nu integraal opnieuw op via de boekhoudkoppeling">
        {refreshing ? "Ophalen…" : "↻ Opnieuw ophalen"}
      </button>
    </div>
  );
}

function fetchedLabel(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "zojuist";
  if (mins < 60) return `${mins} min geleden`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} uur geleden`;
  return new Date(iso).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" });
}
