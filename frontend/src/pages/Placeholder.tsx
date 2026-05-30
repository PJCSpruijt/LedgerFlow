import { useScope } from "../contexts/ScopeContext";

/**
 * Scaffold page for modules/subpages that are part of the FIN//HUB navigation
 * architecture but not yet implemented. Keeps the information architecture
 * complete and discoverable; real functionality is added incrementally.
 */
export function Placeholder({ title }: { title: string }) {
  const { entity, workspace } = useScope();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {entity?.name ?? workspace?.name ?? "Geen context geselecteerd"}
        </p>
      </div>
      <div className="lf-card max-w-2xl">
        <div className="lf-pill bg-slate-200 text-slate-600">Binnenkort</div>
        <p className="text-sm text-slate-600 mt-3">
          Deze module is onderdeel van de FIN//HUB-architectuur en wordt in een volgende stap
          opgeleverd.
        </p>
      </div>
    </div>
  );
}
