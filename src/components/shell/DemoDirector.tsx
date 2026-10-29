"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Clapperboard, FastForward, Pause, Play, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { control, refreshSnapshot, useUi } from "@/lib/client/store";
import { SCENARIO_INFO } from "@/lib/sim/scenarios";
import type { ScenarioId } from "@/lib/sim/types";
import { cn } from "@/lib/client/cn";
import { Badge, Button, Kbd } from "@/components/ui/ui";
import { fmtAgo } from "@/lib/ai/format";
import { gpuTier, qualitySetting, setQuality } from "@/components/twin/site/quality";
import { ShowcasePanel } from "./ShowcaseControl";

const SPEEDS = [1, 10, 30, 120, 300];

/** 3D-Qualität: Automatisch (nach Grafikchip), Schnell (gebackene Schatten), Hoch (Echtzeitschatten) */
function QualityRow() {
  const [info] = useState(() => ({ setting: qualitySetting(), ...gpuTier() }));
  const opts: { v: "auto" | "fast" | "high"; label: string }[] = [
    { v: "auto", label: "Automatisch" },
    { v: "fast", label: "Schnell" },
    { v: "high", label: "Hoch" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-2.5">
      <div className="label">3D-Qualität</div>
      <div className="flex rounded-lg border border-line bg-panel-2 p-0.5">
        {opts.map((o) => (
          <button key={o.v} onClick={() => setQuality(o.v)} className={cn("rounded-md px-2.5 py-1 text-[12px] font-semibold", info.setting === o.v ? "bg-panel text-ink shadow-[var(--shadow-sm)]" : "text-muted hover:text-ink")}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1 truncate text-[11px] text-muted" title={info.gpu}>
        aktiv: {info.tier === "high" ? "Hoch (Echtzeitschatten, Kantenglättung)" : "Schnell (vorberechnete Schatten, Auflösung passt sich der Bildrate an)"} · {info.gpu.replace(/^ANGLE \(|\)$/g, "").split(",").slice(0, 2).join(",")}
      </div>
    </div>
  );
}

export default function DemoDirector() {
  const open = useUi((s) => s.directorOpen);
  const toggle = useUi((s) => s.toggleDirector);
  const snap = useUi((s) => s.snap);
  const openCopilot = useUi((s) => s.openCopilot);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (key: string, action: string, extra: Record<string, unknown> = {}) => {
    setBusy(key);
    try {
      await control(action, extra);
      await refreshSnapshot();
    } finally {
      setBusy(null);
    }
  };

  const speed = snap?.speed ?? 1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          className="glass scroll-thin fixed bottom-5 left-1/2 z-[70] max-h-[calc(100dvh-90px)] w-[min(760px,calc(100vw-40px))] -translate-x-1/2 overflow-y-auto rounded-2xl"
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <div className="flex items-center gap-2.5">
              <Clapperboard size={17} className="text-accent" />
              <div>
                <div className="text-[13.5px] font-semibold">Demo-Regie</div>
                <div className="text-[11px] text-muted">Uhr läuft in Echtzeit · Szenarien schalten automatisch in den Zeitraffer 30×</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1 text-[10.5px] text-muted sm:flex">
                <Kbd>Shift</Kbd>+<Kbd>D</Kbd>
              </span>
              <button onClick={() => toggle(false)} className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-ink" aria-label="Schließen">
                <X size={16} />
              </button>
            </div>
          </div>

          <ShowcasePanel />

          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
            <div className="label">Uhr</div>
            <div className="flex rounded-lg border border-line bg-panel-2 p-0.5">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  // „Echtzeit“ koppelt die Werksuhr wieder an die echte Uhrzeit
                  onClick={() => (s === 1 ? act("realtime", "realtime") : act(`s${s}`, "speed", { speed: s }))}
                  title={s === 1 ? "Werksuhr = echte Uhrzeit" : `Zeitraffer: 1 s = ${s} s im Werk`}
                  className={cn("num rounded-md px-2.5 py-1 text-[12px] font-semibold", speed === s ? "bg-panel text-ink shadow-[var(--shadow-sm)]" : "text-muted hover:text-ink")}
                >
                  {s === 1 ? (snap && !snap.realtime ? "↺ Echtzeit" : "Echtzeit") : `${s}×`}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => act("pause", "pause", { paused: speed !== 0 })}>
              {speed === 0 ? <Play size={14} /> : <Pause size={14} />}
              {speed === 0 ? "Fortsetzen" : "Pause"}
            </Button>
            <Button size="sm" onClick={() => act("jump", "jump", { speed: 30 })} disabled={busy === "jump"}>
              <FastForward size={14} /> +30 min
            </Button>
            <div className="ml-auto">
              <Button size="sm" variant="ghost" onClick={() => act("reset", "reset")} disabled={busy === "reset"}>
                <RotateCcw size={14} /> Werk zurücksetzen
              </Button>
            </div>
          </div>

          <QualityRow />

          <div className="grid gap-2.5 p-4 sm:grid-cols-2">
            {(Object.keys(SCENARIO_INFO) as ScenarioId[]).map((id, i) => {
              const info = SCENARIO_INFO[id];
              const st = snap?.scenarios.find((s) => s.id === id);
              const active = Boolean(st?.active);
              return (
                <div key={id} className={cn("rounded-xl border p-3.5 transition-colors", active ? "border-accent/50 bg-accent-soft" : "border-line bg-panel")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="num flex h-5 w-5 items-center justify-center rounded-md bg-ink text-[10.5px] font-bold text-bg">{i + 1}</span>
                        <div className="truncate text-[13px] font-semibold">{info.title}</div>
                      </div>
                      <div className="mt-1 text-[11px] text-muted">{info.short}</div>
                    </div>
                    {active && snap && st?.startedAt && <Badge sev="info">aktiv · {fmtAgo(st.startedAt, snap.now)}</Badge>}
                  </div>
                  <p className="mt-2 line-clamp-3 text-[11.5px] leading-snug text-ink-2">{info.desc}</p>
                  <div className="mt-3 flex items-center gap-1.5">
                    {!active ? (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy === id}
                        onClick={async () => {
                          await act(id, "scenario-start", { scenario: id });
                          router.push(info.href);
                        }}
                      >
                        <Play size={13} /> Starten
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => router.push(info.href)}>
                          Ansehen
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => act(id, "scenario-stop", { scenario: id })}>
                          <Square size={12} /> Stop
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => openCopilot(info.ask)} className="ml-auto" title={info.ask}>
                      <Sparkles size={13} className="text-accent" /> Fragen
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
