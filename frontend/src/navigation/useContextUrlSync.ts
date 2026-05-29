import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useScope, type ViewType } from "../contexts/ScopeContext";

/**
 * Two-way sync between the global FIN//HUB context (workspace / group / entity /
 * period / currency / view) and the URL query string, so report views are
 * deep-linkable and shareable ("Explain this number" links reproduce the exact
 * view). Loop-safe: hydrate-from-URL runs exactly once (ref-guarded); the
 * context→URL writer replaces (no history spam) and only triggers on context
 * changes, never on its own URL writes.
 */
export function useContextUrlSync(): void {
  const [sp, setSp] = useSearchParams();
  const {
    workspace,
    group,
    entity,
    period,
    currency,
    view,
    selectWorkspace,
    selectGroup,
    selectEntity,
    setPeriod,
    setCurrency,
    setView,
  } = useScope();
  const hydrated = useRef(false);

  // Hydrate once from the URL (a shared link wins over persisted local state).
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const ws = sp.get("ws");
    if (ws) selectWorkspace(ws);
    const grp = sp.get("grp");
    if (grp) selectGroup(grp);
    const ent = sp.get("ent");
    if (ent) selectEntity(ent);
    const p = sp.get("period");
    if (p) setPeriod(p);
    const c = sp.get("cur");
    if (c) setCurrency(c);
    const v = sp.get("view");
    if (v) setView(v as ViewType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect context changes into the URL after hydration.
  useEffect(() => {
    if (!hydrated.current) return;
    const next = new URLSearchParams(sp);
    const set = (k: string, v: string | null | undefined) => (v ? next.set(k, v) : next.delete(k));
    set("ws", workspace?.id);
    set("grp", group?.id);
    set("ent", entity?.id);
    set("period", period);
    set("cur", currency);
    set("view", view);
    if (next.toString() !== sp.toString()) setSp(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id, group?.id, entity?.id, period, currency, view]);
}
