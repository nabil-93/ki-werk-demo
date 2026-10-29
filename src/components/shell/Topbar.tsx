"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, ChevronLeft, Clapperboard, Clock3, Moon, Sparkles, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { control, refreshSnapshot, useUi } from "@/lib/client/store";
import { cn } from "@/lib/client/cn";
import { fmtAgo, fmtShortDate, fmtTimeSec } from "@/lib/ai/format";
import { Kbd, SourceTag, StatusDot } from "@/components/ui/ui";
import { pageTitle } from "./Sidebar";
import { ShowcaseControl } from "./ShowcaseControl";

export default function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const snap = useUi((s) => s.snap);
  const connected = useUi((s) => s.connected);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const openCopilot = useUi((s) => s.openCopilot);
  const toggleDirector = useUi((s) => s.toggleDirector);
  const directorOpen = useUi((s) => s.directorOpen);
  const [bell, setBell] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBell(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const alerts = snap?.alerts ?? [];
  const serious = alerts.filter((a) => a.severity === "crit" || a.severity === "warn");
  const online = snap?.connectors.filter((c) => c.status !== "offline").length ?? 0;

  return (
    <header className="relative z-20 flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-panel px-5">
      {/* Zurück: eine Ansicht zurück (wie der Browser-Zurück-Knopf) */}
      {pathname !== "/" && (
        <button
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          className="-ml-1 flex h-9 shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 text-[12px] font-semibold text-ink-2 hover:bg-panel-2 hover:text-ink"
          title="Zurück zur vorherigen Ansicht"
        >
          <ChevronLeft size={16} /> Zurück
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="label text-[9.5px]">Werk Nord · WN-01</div>
        <div className="truncate text-[15px] font-semibold tracking-[-0.015em]">{pageTitle(pathname)}</div>
      </div>

      {/* Werkszeit */}
      <button onClick={() => toggleDirector()} className="hidden items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-left hover:border-faint md:flex" title="Demo-Regie öffnen (Shift+D)">
        <div className="flex items-center gap-2">
          <StatusDot sev={connected ? "ok" : "crit"} pulse={connected} />
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-ok">{connected ? "Live" : "Offline"}</span>
        </div>
        <div className="h-6 w-px bg-line" />
        <div className="leading-tight">
          <div className="num text-[13px] font-semibold">{snap ? fmtTimeSec(snap.now) : "--:--:--"}</div>
          <div className="text-[10px] text-muted">{snap ? `${fmtShortDate(snap.now)} · ${snap.shift.name}` : "verbinde…"}</div>
        </div>
        {snap && (
          <span className={cn("num rounded-md px-1.5 py-0.5 text-[10.5px] font-bold", snap.speed === 0 ? "bg-warn-soft text-warn" : snap.realtime ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent")}>
            {snap.speed === 0 ? "PAUSE" : snap.realtime ? "Echtzeit" : snap.speed > 1 ? `Zeitraffer ${snap.speed}×` : "Sim-Zeit"}
          </span>
        )}
      </button>
      {snap && !snap.realtime && (
        <button
          onClick={async () => {
            await control("realtime");
            await refreshSnapshot();
          }}
          className="hidden h-9 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-semibold text-ink-2 hover:bg-panel-2 hover:text-ink md:flex"
          title="Werksuhr wieder an die echte Uhrzeit koppeln"
        >
          <Clock3 size={15} /> Echtzeit
        </button>
      )}

      <ShowcaseControl />

      <Link href="/daten" className="hidden items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-muted hover:bg-panel-2 lg:flex" title="Datenintegration">
        <StatusDot sev={online === (snap?.connectors.length ?? 8) ? "ok" : "warn"} />
        <span className="num font-semibold text-ink-2">
          {online}/{snap?.connectors.length ?? 8}
        </span>
        Systeme
      </Link>

      <div ref={bellRef} className="relative">
        <button onClick={() => setBell((v) => !v)} className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-panel-2" aria-label="Hinweise">
          <Bell size={18} />
          {serious.length > 0 && <span className="num absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-crit px-1 text-[9.5px] font-bold text-white">{serious.length}</span>}
        </button>
        <AnimatePresence>
          {bell && (
            <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.16 }} className="glass absolute right-0 top-11 w-[380px] overflow-hidden rounded-xl">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <div className="text-[13px] font-semibold">Hinweise & Alarme</div>
                <div className="text-[11px] text-muted">{alerts.length} aktiv</div>
              </div>
              <div className="scroll-thin max-h-[420px] overflow-y-auto p-1.5">
                {alerts.length === 0 && <div className="p-6 text-center text-[12.5px] text-muted">Alles im grünen Bereich.</div>}
                {alerts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      setBell(false);
                      router.push(a.href);
                    }}
                    className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-panel-2"
                  >
                    <StatusDot sev={a.severity} pulse={a.severity === "crit"} className="mt-1.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <SourceTag source={a.source} />
                        <span className="truncate text-[12.5px] font-semibold">{a.title}</span>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{a.detail}</div>
                    </div>
                  </button>
                ))}
              </div>
              {snap && snap.events[0] && <div className="border-t border-line px-4 py-2 text-[10.5px] text-muted">Letztes Ereignis {fmtAgo(snap.events[0].t, snap.now)}</div>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <button onClick={() => toggleDirector()} className={cn("flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-panel-2", directorOpen && "bg-panel-3 text-ink")} title="Demo-Regie (Shift+D)" aria-label="Demo-Regie">
        <Clapperboard size={18} />
      </button>

      <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-panel-2" aria-label="Farbschema wechseln">
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <button onClick={() => openCopilot()} className="ai-border group flex h-9 items-center gap-2 rounded-lg bg-panel px-3 text-[13px] font-semibold text-ink shadow-[var(--shadow-sm)] hover:bg-panel-2">
        <Sparkles size={16} className="text-accent" />
        <span className="hidden sm:inline">Frag die KI</span>
        <span className="hidden items-center gap-0.5 lg:flex">
          <Kbd>Strg</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
    </header>
  );
}
