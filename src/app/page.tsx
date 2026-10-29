"use client";

// Leitstand: 3D-Zwilling + Overlays.
// Performance: Die Seite selbst abonniert KEINE Live-Daten – nur die kleinen Overlay-Komponenten.
// So wird der 3D-Szenengraph nicht jede Sekunde neu abgeglichen.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowRight, Bell, Boxes, ChevronDown, ChevronUp, DoorOpen, Euro, Eye, EyeOff, Gauge as GaugeIcon, Leaf, PanelRightClose, PanelRightOpen, Sparkles, Target, Truck, Warehouse } from "lucide-react";
import { useUi } from "@/lib/client/store";
import { cn } from "@/lib/client/cn";
import { fmtAgo, fmtInt, fmtKEur, fmtNum, fmtPct, fmtTime } from "@/lib/ai/format";
import { SourceTag, StatusDot, Tabs } from "@/components/ui/ui";
import { Sparkline, Ticker } from "@/components/ui/charts";
import { VIEWS } from "@/components/twin/layout";
import { buildInsights } from "@/components/cockpit/Insights";
import MachinePanel from "@/components/cockpit/MachinePanel";
import Phase2Panel from "@/components/cockpit/Phase2Panel";
import { PHASE2_SEED } from "@/lib/sim/catalog";
import { DockPanel, GatePanel, ProductPanel, TruckPanel, WarehousePanel, YardList } from "@/components/cockpit/OpsPanels";

const TwinScene = dynamic(() => import("@/components/twin/TwinScene"), {
  ssr: false,
  loading: () => (
    <div className="blueprint absolute inset-0 flex items-center justify-center">
      <div className="text-[12px] text-muted">Digitaler Zwilling wird geladen…</div>
    </div>
  ),
});

const fmtOee = (v: number) => `${fmtNum(v, 1)} %`;
const fmtOut = (v: number) => fmtInt(v);

function Kpi({ icon: Icon, label, value, sub, spark, warn, className }: { icon: typeof Activity; label: string; value: React.ReactNode; sub?: string; spark?: number[]; warn?: boolean; className?: string }) {
  return (
    <div className={cn("glass fade-in min-w-0 rounded-xl px-3.5 py-2.5", warn && "border-warn/50", className)} title={`${label}${spark ? " · kleine Linie = Verlauf der letzten 24 h" : ""}${warn ? " · gelber Rahmen = unter Ziel / Aufmerksamkeit" : ""}`}>
      <div className="flex items-center gap-1.5">
        <Icon size={13} className="shrink-0 text-muted" />
        <div className="label truncate text-[9.5px]">{label}</div>
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="num truncate text-[20px] font-semibold leading-none tracking-[-0.03em]">{value}</div>
        {spark && spark.length > 2 && <Sparkline data={spark} width={54} height={20} className="hidden shrink-0 @min-[1180px]:block" />}
      </div>
      {sub && <div className="mt-1 truncate text-[10.5px] text-muted">{sub}</div>}
    </div>
  );
}

function KpiRow() {
  const k = useUi((s) => s.snap?.kpis);
  const hist = useUi((s) => s.snap?.history);
  const openOrders = useUi((s) => s.snap?.orders.filter((o) => o.status !== "VERSENDET").length ?? 0);
  const yard = useUi((s) => s.snap?.yard);
  const fin = useUi((s) => s.snap?.finance);
  const h = hist ?? [];
  return (
    <div className="@container pointer-events-auto">
      <div className="grid auto-cols-fr grid-flow-col gap-2.5">
        <Kpi icon={GaugeIcon} label="OEE Werk" value={k ? <Ticker value={k.oee * 100} format={fmtOee} /> : "–"} sub="Ziel 85 % · heute" spark={h.map((x) => x.oee)} />
        <Kpi icon={Boxes} label="Ausbringung heute" value={k ? <Ticker value={k.outputToday} format={fmtOut} /> : "–"} sub="Gutteile seit 06:00" spark={h.map((x) => x.output)} />
        <Kpi icon={Target} label="Ausschuss" value={k ? fmtPct(k.scrapRate, 2) : "–"} sub="Inline-Kamera + CAQ" spark={h.map((x) => x.scrap)} warn={!!k && k.scrapRate > 0.012} />
        <Kpi className="hidden @min-[640px]:block" icon={Truck} label="Liefertreue" value={k ? fmtPct(k.onTimeDelivery) : "–"} sub={k ? `${k.ordersAtRisk} Aufträge mit Risiko` : ""} warn={!!k && k.ordersAtRisk > 0} />
        <Kpi className="hidden @min-[820px]:block" icon={Euro} label="Umsatz heute" value={fin ? fmtKEur(fin.revenueToday) : "–"} sub={fin ? `Ergebnis ${fin.resultToday >= 0 ? "+" : ""}${fmtKEur(fin.resultToday)} · ${openOrders} Aufträge offen` : ""} />
        <Kpi className="hidden @min-[920px]:block" icon={Truck} label="LKW auf dem Hof" value={yard ? `${yard.onSite}` : "–"} sub={yard ? `${yard.doneToday}/${yard.doneToday + yard.onSite + yard.expectedToday} abgefertigt · ${yard.late} verspätet` : ""} warn={!!yard && (yard.overstay > 0 || yard.late > 0)} />
        <Kpi className="hidden @min-[1100px]:block" icon={Leaf} label="Energie heute" value={k ? `${fmtInt(k.energyKwhToday / 1000)} MWh` : "–"} sub={k ? `${fmtNum(k.co2kgToday / 1000, 1)} t CO₂e` : ""} spark={h.map((x) => x.energy)} />
      </div>
    </div>
  );
}

/**
 * KI-Lagebild: zunächst nur als kompakte Leiste; klappt von selbst auf, sobald ein neuer Hinweis
 * (Warnung/Störung) kommt. Per Knopf jederzeit ein- und ausklappbar.
 */
function Lagebild() {
  const snap = useUi((s) => s.snap);
  const openCopilot = useUi((s) => s.openCopilot);
  const router = useRouter();
  const insights = useMemo(() => (snap ? buildInsights(snap) : []), [snap]);
  const [open, setOpen] = useState(false);
  const seen = useRef(new Set<string>());
  const alerts = useMemo(() => insights.filter((i) => i.sev !== "ok"), [insights]);
  const worst = alerts.some((i) => i.sev === "crit") ? "crit" : alerts.some((i) => i.sev === "warn") ? "warn" : alerts.length ? "info" : "ok";
  // neuer Hinweis → automatisch aufklappen
  useEffect(() => {
    const fresh = alerts.filter((i) => !seen.current.has(i.id));
    fresh.forEach((i) => seen.current.add(i.id));
    if (fresh.length) setOpen(true);
  }, [alerts]);
  const summary = alerts.length ? `${alerts.length} ${alerts.length === 1 ? "Hinweis" : "Hinweise"} · ${alerts[0].title}` : insights[0] ? insights[0].title : "Lage wird ausgewertet …";
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="glass ai-border fade-in pointer-events-auto flex w-full max-w-[372px] items-center gap-2.5 rounded-2xl px-3 py-2 text-left hover:bg-panel-2" title="KI-Lagebild aufklappen">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[linear-gradient(135deg,var(--ai-1),var(--ai-2))] text-white">
          <Sparkles size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
            KI-Lagebild <StatusDot sev={worst} pulse={worst !== "ok"} />
          </div>
          <div className="truncate text-[10.5px] text-muted">{summary}</div>
        </div>
        <ChevronDown size={16} className="shrink-0 text-muted" />
      </button>
    );
  return (
    <div className="glass ai-border fade-in pointer-events-auto flex min-h-0 w-full max-w-[372px] flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[linear-gradient(135deg,var(--ai-1),var(--ai-2))] text-white">
          <Sparkles size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">KI-Lagebild</div>
          <div className="text-[10.5px] text-muted">{snap ? `${snap.shift.name} · aktualisiert ${fmtTime(snap.now)}` : "…"}</div>
        </div>
        <button onClick={() => setOpen(false)} className="-mr-1.5 flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-panel-3 hover:text-ink" title="KI-Lagebild einklappen" aria-label="KI-Lagebild einklappen">
          <ChevronUp size={16} />
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
        {insights.map((it) => (
          <div key={it.id} className="fade-in rounded-xl border border-line bg-panel p-2.5">
            <div className="flex items-start gap-2">
              <StatusDot sev={it.sev} pulse={it.sev === "crit"} className="mt-1" />
              <div className="min-w-0 flex-1">
                <div className="label text-[9px]">{it.area}</div>
                <div className="text-[12.5px] font-semibold leading-snug">{it.title}</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{it.detail}</div>
                <div className="mt-1.5 flex gap-1.5">
                  <button onClick={() => router.push(it.href)} className="flex items-center gap-1 rounded-md bg-panel-3 px-2 py-0.5 text-[11px] font-semibold text-ink-2 hover:text-ink">
                    Öffnen <ArrowRight size={11} />
                  </button>
                  {it.ask && (
                    <button onClick={() => openCopilot(it.ask)} className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold text-accent hover:bg-accent-soft">
                      <Sparkles size={11} /> Erklären
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const AlertList = memo(function AlertList() {
  const alerts = useUi((s) => s.snap?.alerts);
  if (!alerts?.length) return <div className="p-8 text-center text-[12.5px] text-muted">Keine offenen Hinweise – alles im Soll.</div>;
  return (
    <>
      {alerts.map((a) => (
        <Link key={a.id} href={a.href} className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-panel-2">
          <StatusDot sev={a.severity} pulse={a.severity === "crit"} className="mt-1.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <SourceTag source={a.source} />
              <span className="truncate text-[12.5px] font-semibold">{a.title}</span>
            </div>
            <div className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{a.detail}</div>
          </div>
        </Link>
      ))}
    </>
  );
});

const EventFeed = memo(function EventFeed() {
  const events = useUi((s) => s.snap?.events);
  return (
    <>
      {(events ?? []).slice(0, 30).map((e) => (
        <div key={e.id} className="fade-in flex gap-2.5 rounded-lg px-2.5 py-1.5">
          <div className="num w-10 shrink-0 pt-0.5 text-[10.5px] text-faint">{fmtTime(e.t)}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <SourceTag source={e.source} />
              <StatusDot sev={e.severity} />
              <span className="truncate text-[12px] font-medium">{e.title}</span>
            </div>
            {e.detail && <div className="mt-0.5 line-clamp-2 text-[11px] text-muted">{e.detail}</div>}
          </div>
        </div>
      ))}
    </>
  );
});

type PanelTab = "hinweise" | "hof" | "feed";

function RailButton({ icon: Icon, label, count, onClick }: { icon: typeof Activity; label: string; count?: number; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-panel-3 hover:text-ink">
      <Icon size={17} strokeWidth={1.8} />
      {!!count && <span className="num absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-crit px-1 text-[9.5px] font-bold text-white">{count}</span>}
    </button>
  );
}

function RightPanel({ focus, open, setOpen }: { focus: boolean; open: boolean; setOpen: (v: boolean) => void }) {
  const selected = useUi((s) => s.selectedMachine);
  const visit = useUi((s) => s.selectedVisit);
  const warehouse = useUi((s) => s.warehouseOpen);
  const gate = useUi((s) => s.gateOpen);
  const dock = useUi((s) => s.dockOpen);
  const product = useUi((s) => s.selectedProduct);
  // Rollout-Maschine ohne Datenanschluss (bzw. gerade in der Inbetriebnahme) → eigenes Panel
  const phase2 = useUi((s) => !!s.selectedMachine && !!PHASE2_SEED[s.selectedMachine] && (s.linking === s.selectedMachine || !s.snap?.machines.some((m) => m.id === s.selectedMachine)));
  const alertCount = useUi((s) => s.snap?.alerts.length ?? 0);
  const yardCount = useUi((s) => s.snap?.yard.onSite ?? 0);
  const footer = useUi((s) => (s.snap?.events[0] ? `Letztes Ereignis ${fmtAgo(s.snap.events[0].t, s.snap.now)} · ${s.snap.connectors.length} Quellsysteme` : ""));
  const tab = useUi((s) => s.rightTab);
  const setTab = useUi((s) => s.setRightTab) as (t: PanelTab) => void;
  const openAt = (t: PanelTab) => {
    setTab(t);
    setOpen(true);
  };
  return (
    <div
      className={cn(
        "glass fade-in absolute bottom-4 right-4 top-4 overflow-hidden rounded-2xl transition-[width,opacity,transform] duration-300 ease-[cubic-bezier(.32,.72,0,1)]",
        open ? "w-[336px] xl:w-[384px]" : "w-[52px]",
        focus && "pointer-events-none translate-x-7 opacity-0",
      )}
    >
      {/* Eingeklappt: schmale Leiste */}
      <div className={cn("absolute inset-y-0 right-0 flex w-[52px] flex-col items-center gap-1 py-2.5 transition-opacity duration-200", open ? "pointer-events-none opacity-0" : "opacity-100 delay-100")}>
        <RailButton icon={PanelRightOpen} label="Panel ausklappen (])" onClick={() => setOpen(true)} />
        <div className="my-1 h-px w-6 bg-line" />
        <RailButton icon={Bell} label={`Hinweise · ${alertCount}`} count={alertCount} onClick={() => openAt("hinweise")} />
        <RailButton icon={Truck} label={`LKW-Hof · ${yardCount} auf dem Gelände`} onClick={() => openAt("hof")} />
        <RailButton
          icon={DoorOpen}
          label="Werkstor · Pförtnerbuch"
          onClick={() => {
            useUi.getState().openGate(true);
            setOpen(true);
          }}
        />
        <RailButton
          icon={Boxes}
          label="Fertigwarenlager"
          onClick={() => {
            useUi.getState().openWarehouse(true);
            setOpen(true);
          }}
        />
        <RailButton icon={Activity} label="Live-Ereignisse" onClick={() => openAt("feed")} />
        <div className="mt-auto pb-1">
          <StatusDot sev="ok" pulse />
        </div>
      </div>

      {/* Ausgeklappt: feste Breite, damit beim Animieren nichts umbricht */}
      <div className={cn("absolute inset-y-0 left-0 flex w-[336px] flex-col transition-opacity duration-200 xl:w-[384px]", open ? "opacity-100" : "pointer-events-none opacity-0")}>
        {visit ? (
          <TruckPanel id={visit} />
        ) : product ? (
          <ProductPanel id={product} />
        ) : warehouse ? (
          <WarehousePanel />
        ) : gate ? (
          <GatePanel />
        ) : dock ? (
          <DockPanel dock={dock} />
        ) : selected ? (
          phase2 ? <Phase2Panel key={selected} id={selected} /> : <MachinePanel id={selected} />
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <Tabs
                size="sm"
                value={tab}
                onChange={setTab}
                items={[
                  { value: "hinweise", label: `Hinweise · ${alertCount}` },
                  { value: "hof", label: `Hof · ${yardCount}` },
                  { value: "feed", label: "Live" },
                ]}
              />
              <span className="ml-auto flex items-center gap-1.5 text-[10.5px] font-semibold text-ok">
                <StatusDot sev="ok" pulse /> live
              </span>
              <button onClick={() => setOpen(false)} title="Panel einklappen (])" aria-label="Panel einklappen" className="-mr-1.5 flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-panel-3 hover:text-ink">
                <PanelRightClose size={16} />
              </button>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">{tab === "hinweise" ? <AlertList /> : tab === "hof" ? <YardList /> : <EventFeed />}</div>
            {footer && <div className="truncate border-t border-line px-4 py-2 text-[10.5px] text-muted">{footer}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export default function Leitstand() {
  // Ansicht liegt im Store: Gebäude-Etiketten in der 3D-Szene können sie ebenfalls wechseln
  const view = useUi((s) => s.twinView);
  const setView = useUi((s) => s.setTwinView);
  const roofsOff = useUi((s) => s.roofsOff);
  const toggleRoofs = useUi((s) => s.toggleRoofs);
  const [focus, setFocus] = useState(false);
  const [panelOpen, setPanelOpenState] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("cortex-panel") === "0") setPanelOpenState(false);
    } catch {}
  }, []);
  const setPanelOpen = useCallback((v: boolean) => {
    setPanelOpenState(v);
    try {
      localStorage.setItem("cortex-panel", v ? "1" : "0");
    } catch {}
  }, []);
  const selected = useUi((s) => s.selectedMachine);
  const selectedVisit = useUi((s) => s.selectedVisit);
  const warehouseOpen = useUi((s) => s.warehouseOpen);
  const gateOpen = useUi((s) => s.gateOpen);
  const dockOpen = useUi((s) => s.dockOpen);
  const [intro] = useState(() => {
    try {
      return !sessionStorage.getItem("cortex-twin-seen") && (sessionStorage.setItem("cortex-twin-seen", "1"), true);
    } catch {
      return false;
    }
  });

  // Maschine gewählt → Panel mit den Maschinendetails automatisch ausklappen
  useEffect(() => {
    if (selected || selectedVisit || warehouseOpen || gateOpen || dockOpen) setPanelOpen(true);
  }, [selected, selectedVisit, warehouseOpen, gateOpen, dockOpen, setPanelOpen]);

  // Taste ] klappt das rechte Panel ein/aus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "]" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      setPanelOpenState((v) => {
        try {
          localStorage.setItem("cortex-panel", v ? "0" : "1");
        } catch {}
        return !v;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rightGap = panelOpen ? "right-[356px] xl:right-[404px]" : "right-[76px]";

  return (
    <div className="absolute inset-0">
      <TwinScene intro={intro} />

      {/* Linke Spalte: KPI-Leiste + KI-Lagebild */}
      <div className={cn("pointer-events-none absolute bottom-[68px] left-4 top-4 flex flex-col gap-2.5 transition-[right,opacity] duration-300 ease-[cubic-bezier(.32,.72,0,1)]", rightGap, focus && "opacity-0 [&_*]:!pointer-events-none")}>
        <KpiRow />
        <Lagebild />
      </div>

      <RightPanel focus={focus} open={panelOpen} setOpen={setPanelOpen} />

      {/* Ansichten + Legende – die Legende wächst stufenweise mit der Breite und ragt nie ins rechte Panel */}
      <div className={cn("@container pointer-events-none absolute bottom-4 left-4 transition-[right] duration-300 ease-[cubic-bezier(.32,.72,0,1)]", rightGap)}>
        <div className="flex min-w-0 items-center gap-2.5 [&>*]:pointer-events-auto">
          <button onClick={() => setFocus((f) => !f)} className="glass flex h-[38px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold text-ink-2 hover:text-ink" title="Panels ein-/ausblenden">
            {focus ? <Eye size={15} /> : <EyeOff size={15} />} {focus ? "Panels zeigen" : "Nur 3D"}
          </button>
          <button onClick={toggleRoofs} className={cn("glass flex h-[38px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold hover:text-ink", roofsOff ? "text-accent" : "text-ink-2")} title="Hallendächer öffnen/schließen (öffnen sich beim Heranzoomen automatisch)">
            <Warehouse size={15} /> {roofsOff ? "Dächer zeigen" : "Dächer öffnen"}
          </button>
          <div className="glass flex shrink-0 rounded-xl p-1">
            {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors", view.key === v ? "bg-ink text-bg" : "text-ink-2 hover:bg-panel-3")}
              >
                {VIEWS[v].label}
              </button>
            ))}
          </div>
          <div className="glass hidden min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap rounded-xl px-3.5 py-2 text-[11px] text-ink-2 @min-[1240px]:flex">
            {[
              ["#19d36b", "Produktion"],
              ["#ffb000", "Rüsten"],
              ["#ff3b3b", "Störung"],
              ["#3b82ff", "Wartung"],
            ].map(([c, l]) => (
              <span key={l} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: c }} /> {l}
              </span>
            ))}
            <span className="hidden items-center gap-3 @min-[1660px]:flex">
              <span className="h-4 w-px bg-line" />
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-4 rounded-[3px] border-2 border-warn" /> KI-Frühwarnung
              </span>
              <span className="flex items-center gap-1.5" title="Rollout Phase 2: Maschine produziert, liefert aber noch keine Daten – Klick zeigt die Anbindung">
                <span className="h-2.5 w-4 rounded-[3px] border-2 border-dashed border-faint" /> nicht angebunden
              </span>
              <span className="flex items-center gap-1.5" title="Blauer Pfeil und Ring markieren den ausgewählten LKW">
                <span className="h-2.5 w-2.5 rounded-full border-2 border-accent" /> gewählter LKW
              </span>
            </span>
            <span className="hidden text-faint @min-[1940px]:inline">Klick auf Maschine, LKW oder Lager = Details</span>
          </div>
        </div>
      </div>
    </div>
  );
}
