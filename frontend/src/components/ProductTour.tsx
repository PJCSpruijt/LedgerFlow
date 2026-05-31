import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ModuleDef } from "../navigation/navConfig";

/** Short intro per module key, shown in the new-user tour. */
const MODULE_INTRO: Record<string, string> = {
  dashboard: "Je startpunt: overzicht, synchronisatiestatus en datakwaliteit van je administraties.",
  data: "Koppel je boekhoudpakketten en bekijk transacties, grootboek, debiteuren/crediteuren en relaties — live opgehaald uit de bron.",
  mappings: "Koppel je bronrekeningen aan het RGS en aan FIN-categorieën. Dit is de basis voor genormaliseerde, vergelijkbare rapportage.",
  consolidation: "Consolideer cijfers over meerdere administraties heen (komt in een volgende stap).",
  reporting: "Jaarrekening, downloads (Excel) en API-toegang om je data naar Power BI, Caseware of Excel te halen.",
  administration: "Je instellingen: RGS aan/uit, en je abonnement beheren.",
  platform: "Platformbeheer: werkruimtes, gebruikers, plannen en statistieken (alleen voor beheerders).",
};

/**
 * A lightweight, modal-based product tour for new users. Walks the modules the
 * user can access (within their subscription), with a short intro per module
 * and a quick "go there" link. Re-launchable from the user menu.
 */
export function ProductTour({ modules, onClose }: { modules: ModuleDef[]; onClose: () => void }) {
  const navigate = useNavigate();
  const [i, setI] = useState(0);

  // Step 0 = welcome, 1..n = modules, n+1 = done.
  const last = modules.length + 1;
  const isWelcome = i === 0;
  const isDone = i === last;
  const mod = !isWelcome && !isDone ? modules[i - 1] : null;

  const goto = (m: ModuleDef) => {
    onClose();
    navigate(`${m.basePath}/${m.subpages[0]!.path}`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-2">
          <div className="text-xs text-slate-400">
            Rondleiding · {i === 0 ? "welkom" : `${i} / ${modules.length}`}
          </div>

          {isWelcome && (
            <div className="mt-2 space-y-2">
              <div className="text-xl font-extrabold tracking-tight text-brand-700">Welkom bij FIN//HUB 👋</div>
              <p className="text-sm text-slate-600">
                Een korte rondleiding langs de modules die voor jou beschikbaar zijn. Je kunt deze altijd
                opnieuw starten via je profielmenu rechtsboven.
              </p>
            </div>
          )}

          {mod && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2 text-xl font-semibold">
                <span aria-hidden>{mod.icon}</span>
                {mod.label}
              </div>
              <p className="text-sm text-slate-600">{MODULE_INTRO[mod.key] ?? ""}</p>
              <button className="lf-link text-sm" onClick={() => goto(mod)}>
                → Ga naar {mod.label}
              </button>
            </div>
          )}

          {isDone && (
            <div className="mt-2 space-y-2">
              <div className="text-xl font-semibold">Klaar om te beginnen! 🚀</div>
              <p className="text-sm text-slate-600">
                Tip: begin met <span className="font-medium">Gegevens → Koppelingen</span> om een administratie te
                koppelen (er is een wizard die je erdoorheen leidt).
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4">
          <button className="lf-link text-sm" onClick={onClose}>
            Overslaan
          </button>
          <div className="flex gap-2">
            {i > 0 && (
              <button className="lf-btn-secondary text-sm" onClick={() => setI((n) => n - 1)}>
                Vorige
              </button>
            )}
            {!isDone ? (
              <button className="lf-btn-primary text-sm" onClick={() => setI((n) => n + 1)}>
                {isWelcome ? "Start" : "Volgende"}
              </button>
            ) : (
              <button className="lf-btn-primary text-sm" onClick={onClose}>
                Afronden
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
