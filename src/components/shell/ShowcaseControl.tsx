"use client";

// Live-Demo „Alle Fälle“: Play startet (bzw. setzt fort), Pause friert das Werk ein, Stop führt zurück in den Normalbetrieb.
// Kompakt in der Kopfzeile jeder Seite und ausführlich in der Demo-Regie.

import { CheckCircle2, Circle, Loader2, Pause, Play, Square } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { control, refreshSnapshot, useUi } from "@/lib/client/store";
import { cn } from "@/lib/client/cn";
import { fmtAgo } from "@/lib/ai/format";

function useShowcase() {
  const snap = useUi((s) => s.snap);
  const [busy, setBusy] = useState<string | null>(null);
  const sc = snap?.showcase;
  const active = Boolean(sc?.active);
  const paused = active && snap?.speed === 0;
  const run = async (action: "showcase-play" | "showcase-pause" | "showcase-stop") => {
    setBusy(action);
    try {
      await control(action);
      await refreshSnapshot();
    } finally {
      setBusy(null);
    }
  };
  return { snap, sc, active, paused, busy, run, on: sc?.cases.filter((c) => c.on).length ?? 0, total: sc?.cases.length ?? 0 };
}

/** kompakt für die Kopfzeile */
export function ShowcaseControl() {
  const { active, paused, busy, run, on, total } = useShowcase();
  if (!active)
    return (
      <button
        onClick={() => run("showcase-play")}
        disabled={Boolean(busy)}
        className="hidden h-9 shrink-0 items-center gap-1.5 rounded-lg border border-accent/40 px-2.5 text-[12px] font-semibold text-accent hover:bg-accent-soft disabled:opacity-60 md:flex"
        title="Live-Demo: alle Fälle gleichzeitig in jeder Rubrik zeigen (Störung, Frühwarnung, Qualität, LKW am Tor/wartend/an der Rampe/verspätet, Lager, Freigaben …)"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Alle Fälle
      </button>
    );
  return (
    <div className="hidden h-9 shrink-0 items-center gap-0.5 rounded-lg border border-accent/40 bg-accent-soft p-0.5 md:flex">
      <span className="flex items-center gap-1.5 px-2 text-[11.5px] font-semibold text-accent" title="Live-Demo läuft – so viele Fälle sind gerade sichtbar">
        <span className={cn("h-2 w-2 rounded-full", paused ? "bg-warn" : "animate-pulse bg-accent")} />
        <span className="hidden xl:inline">{paused ? "Demo pausiert" : "Alle Fälle"}</span>
        <span className="num text-[10.5px] opacity-80">
          {on}/{total}
        </span>
      </span>
      {paused ? (
        <button onClick={() => run("showcase-play")} disabled={Boolean(busy)} className="flex h-8 w-8 items-center justify-center rounded-md text-accent hover:bg-panel" title="Fortsetzen" aria-label="Fortsetzen">
          {busy === "showcase-play" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        </button>
      ) : (
        <button onClick={() => run("showcase-pause")} disabled={Boolean(busy)} className="flex h-8 w-8 items-center justify-center rounded-md text-accent hover:bg-panel" title="Pause – Werk einfrieren" aria-label="Pause">
          <Pause size={14} />
        </button>
      )}
      <button onClick={() => run("showcase-stop")} disabled={Boolean(busy)} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-panel hover:text-crit" title="Stop – zurück in den Normalbetrieb" aria-label="Stop">
        {busy === "showcase-stop" ? <Loader2 size={14} className="animate-spin" /> : <Square size={13} />}
      </button>
    </div>
  );
}

/** ausführlich für die Demo-Regie: Steuerung und Liste der gerade sichtbaren Fälle */
export function ShowcasePanel() {
  const { snap, sc, active, paused, busy, run, on, total } = useShowcase();
  return (
    <div className={cn("border-b border-line px-5 py-3.5", active && "bg-accent-soft/50")}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">Live-Demo · Alle Fälle gleichzeitig</div>
          <div className="text-[11.5px] text-muted">
            {active
              ? `${paused ? "Pausiert" : "Läuft in Echtzeit"} seit ${snap && sc?.since ? fmtAgo(sc.since, snap.now).replace(/^vor /, "") : "–"} · ${on} von ${total} Fällen gerade sichtbar – verschwindet einer, stellt die Regie ihn neu`
              : "Ein Klick: in jeder Rubrik sind alle typischen Situationen gleichzeitig aktiv – und bleiben es."}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {(!active || paused) && (
            <button onClick={() => run("showcase-play")} disabled={Boolean(busy)} className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-60">
              {busy === "showcase-play" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {active ? "Fortsetzen" : "Play"}
            </button>
          )}
          {active && !paused && (
            <button onClick={() => run("showcase-pause")} disabled={Boolean(busy)} className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-3.5 text-[12.5px] font-semibold hover:bg-panel-2">
              <Pause size={14} /> Pause
            </button>
          )}
          {active && (
            <button onClick={() => run("showcase-stop")} disabled={Boolean(busy)} className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-3.5 text-[12.5px] font-semibold hover:border-crit/50 hover:text-crit" title="Werk zurück auf Normalbetrieb">
              {busy === "showcase-stop" ? <Loader2 size={14} className="animate-spin" /> : <Square size={13} />} Stop
            </button>
          )}
        </div>
      </div>
      {active && sc && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {sc.cases.map((c) => (
            <Link key={c.key} href={c.href} className={cn("flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors", c.on ? "border-ok/30 bg-panel text-ink hover:border-ok" : "border-line bg-panel-2 text-muted")} title={`${c.area} · ${c.on ? "gerade sichtbar" : "kommt gleich wieder"}`}>
              {c.on ? <CheckCircle2 size={12} className="text-ok" /> : <Circle size={12} />} {c.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
