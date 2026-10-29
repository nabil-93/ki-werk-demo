"use client";

// Maschinengesundheit · KI-Wächter – EINE Rubrik für alles, was Maschinen betrifft (ersetzt „Predictive Maintenance“):
//  Werk        Gesundheitsmatrix (Maschine × Bereich) und Frühwarn-Radar für die nächsten 72 h
//  Akte        je Maschine: Zustand, Befunde mit Analyse im Detail (Schwingung, „Warum?“, SPC), Maßnahmen mit Alternativen
//  Modell      Model Card, Trefferquote der Prognosen, Arbeitsweise
// Alle Zahlen kommen aus einer Quelle (lib/sim/guardian.ts) – dieselben sieht man im Leitstand, Lagebericht, Bericht und Copilot.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, BrainCircuit, Check, CircleAlert, Euro, EyeOff, FilePlus2, Gauge as GaugeIcon, Lightbulb, Play, Radar, ShieldCheck, Sparkles, Target, TrendingUp, Unplug } from "lucide-react";
import { refreshSnapshot, ticketAction, useUi } from "@/lib/client/store";
import { useRevealOnSelect } from "@/lib/client/reveal";
import type { DimState, GuardAction, GuardFinding, GuardianView, GuardKind, MachineGuard } from "@/lib/sim/guardian";
import { fmtDuration, fmtEur, fmtKEur, fmtNum, fmtPct, fmtTime } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { Badge, Button, PageHeader, Panel, Progress, StatusPill, Tabs } from "@/components/ui/ui";
import { Ring } from "@/components/ui/charts";
import { ChartTip, Legend, axisTick, gridProps } from "@/components/ui/chartkit";
import { TicketView } from "@/components/copilot/ToolCards";
import { Contributions, ModelCardPanel, SpcMini, VibrationChart, useMachineData, useModelCard, type MachineData } from "@/components/health/DeepDive";
import { WhatIfView, runWhatIf } from "@/components/health/WhatIf";
import type { WhatIfResult } from "@/lib/sim/whatif";

type Tab = "werk" | "akte" | "modell";

const KIND: Record<GuardKind, string> = {
  ausfall: "Mechanik · Ausfallrisiko",
  qualitaet: "Prozess · Qualität",
  leistung: "Leistung · Zykluszeit",
  kurzstopps: "Verfügbarkeit · Kurzstillstände",
  energie: "Energie",
  termin: "Liefertermin",
};
const DIMS: [GuardKind, string][] = [
  ["ausfall", "Mechanik"],
  ["qualitaet", "Qualität"],
  ["leistung", "Leistung"],
  ["kurzstopps", "Kurzstopps"],
  ["energie", "Energie"],
  ["termin", "Termin"],
];
const SEV_LABEL = { crit: "Kritisch", warn: "Warnung", info: "Hinweis" } as const;
const SEV_TONE = { crit: "border-l-crit", warn: "border-l-warn", info: "border-l-accent" } as const;
const CELL: Record<DimState, string> = { ok: "bg-ok/20", info: "bg-accent/30", warn: "bg-warn/55", crit: "bg-crit/70" };
const BAND: Record<GuardFinding["sev"], string> = { crit: "border-crit/60 bg-crit/30", warn: "border-warn/60 bg-warn/35", info: "border-accent/40 bg-accent/20" };
const healthColor = (h: number) => (h < 50 ? "var(--crit)" : h < 75 ? "var(--warn)" : "var(--ok)");
const H = 3_600_000;

function useGuardian() {
  const [g, setG] = useState<GuardianView | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/guardian", { cache: "no-store" });
        if (r.ok && alive) setG(await r.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [n]);
  return { g, reload: () => setN((x) => x + 1) };
}

/** Laufende Analyse sichtbar machen: Maschine für Maschine werden die Prüfpunkte durchlaufen */
function LiveScan({ machines }: { machines: MachineGuard[] }) {
  // je Maschine 9 Takte à 180 ms: Prüfpunkte nacheinander, dann kurz das Ergebnis
  const [k, setK] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setK((x) => x + 1), 180);
    return () => clearInterval(t);
  }, []);
  if (!machines.length) return null;
  const m = machines[Math.floor(k / 9) % machines.length];
  const step = k % 9;
  return (
    <div className="panel mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      <span className="flex items-center gap-2 text-[12px] font-semibold">
        <span className="relative flex h-2.5 w-2.5">
          <span className="pulse-ring absolute inset-0 rounded-full text-accent" />
          <span className="relative h-2.5 w-2.5 rounded-full bg-accent" />
        </span>
        Live-Analyse
      </span>
      <span className="num text-[12.5px] font-bold">{m.id}</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {m.checks.map((c, i) => (
          <span key={c.key} className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition-opacity", i > step && "opacity-30", c.state === "crit" ? "bg-crit-soft text-crit" : c.state === "warn" ? "bg-warn-soft text-warn" : "bg-panel-2 text-ink-2")}>
            {c.state === "ok" ? <Check size={10} /> : <CircleAlert size={10} />} {c.label}
          </span>
        ))}
      </div>
      <span className={cn("text-[11.5px] font-semibold", m.findings.length ? "text-warn" : "text-ok")}>{m.findings.length ? `${m.findings.length} ${m.findings.length === 1 ? "Befund" : "Befunde"}` : "unauffällig"}</span>
    </div>
  );
}

// ======================= Werk · Lagebild =======================

function HealthMatrix({ g, onPick }: { g: GuardianView; onPick: (id: string) => void }) {
  const titleOf = (m: MachineGuard, k: GuardKind) => m.findings.find((f) => f.kind === k)?.title ?? m.checks.find((c) => (k === "ausfall" ? c.key === "vib" : k === "qualitaet" ? c.key === "spc" : k === "leistung" ? c.key === "cycle" : k === "kurzstopps" ? c.key === "stops" : k === "energie" ? c.key === "energy" : c.key === "due"))?.value ?? "im Soll";
  const cols = "grid grid-cols-[64px_repeat(6,minmax(0,1fr))_78px_40px] items-center gap-1";
  return (
    <Panel title="Gesundheitsmatrix" subtitle="Maschine × Bereich · sortiert nach drohendem Verlust · Klick öffnet die Maschinen-Akte" icon={<Target size={16} />}>
      <div className={cn(cols, "mb-1 text-[10px] font-semibold uppercase tracking-wide text-faint")}>
        <span>Maschine</span>
        {DIMS.map(([k, l]) => (
          <span key={k} className="truncate text-center">
            {l}
          </span>
        ))}
        <span className="text-right">drohend</span>
        <span className="text-right">Zust.</span>
      </div>
      <div className="space-y-1">
        {g.machines.map((m) => (
          <button key={m.id} onClick={() => onPick(m.id)} className={cn(cols, "w-full rounded-lg px-0.5 py-0.5 text-left hover:bg-panel-2")}>
            <span className="num text-[12px] font-bold">{m.id}</span>
            {DIMS.map(([k, l]) => (
              <span key={k} title={`${l}: ${titleOf(m, k)}`} className={cn("flex h-6 items-center justify-center rounded-md text-[10px] font-semibold", CELL[m.dims[k]], m.dims[k] === "crit" && "text-white")}>
                {m.dims[k] === "crit" ? "!" : m.dims[k] === "warn" ? "▲" : ""}
              </span>
            ))}
            <span className={cn("num text-right text-[11.5px] font-semibold", m.lossEur72 > 0 ? "text-crit" : "text-faint")}>{m.lossEur72 > 0 ? fmtEur(m.lossEur72) : "–"}</span>
            <span className="num text-right text-[11.5px] font-semibold" style={{ color: healthColor(m.health) }}>
              {m.health}
            </span>
          </button>
        ))}
        {g.blind.map((b) => (
          <div key={b.id} className={cn(cols, "px-0.5 py-0.5 opacity-70")} title="ohne Datenanschluss – Rollout Phase 2">
            <span className="num text-[12px] font-bold text-muted">{b.id}</span>
            {DIMS.map(([k]) => (
              <span key={k} className="h-6 rounded-md border border-dashed border-faint/70" />
            ))}
            <span className="text-right text-[10.5px] text-muted">keine Daten</span>
            <EyeOff size={13} className="ml-auto text-muted" />
          </div>
        ))}
      </div>
      <Legend
        className="mt-2"
        items={[
          { color: "color-mix(in srgb, var(--ok) 20%, transparent)", label: "im Soll" },
          { color: "color-mix(in srgb, var(--accent) 30%, transparent)", label: "Hinweis" },
          { color: "color-mix(in srgb, var(--warn) 55%, transparent)", label: "▲ Warnung / Frühwarnung" },
          { color: "color-mix(in srgb, var(--crit) 70%, transparent)", label: "! kritisch" },
        ]}
        note="gestrichelt = Maschine ohne Datenanschluss · Zust. = Zustand 0–100"
      />
    </Panel>
  );
}

/** Frühwarn-Radar: wann ist womit zu rechnen – und wann greift die empfohlene Maßnahme? */
function RadarView({ g, onPick }: { g: GuardianView; onPick: (id: string) => void }) {
  // nur, was handlungsrelevant ist: Prognosen (Ausfall, Qualität, Termin) und Warnungen
  const relevant = (f: GuardFinding) => f.kind === "ausfall" || f.kind === "qualitaet" || f.kind === "termin" || f.sev !== "info";
  const lanes = g.machines.map((m) => ({ m, fs: m.findings.filter(relevant).slice(0, 2) })).filter((x) => x.fs.length).slice(0, 6);
  const pct = (h: number) => (Math.min(72, Math.max(0, h)) / 72) * 100;
  const ticks = [0, 12, 24, 36, 48, 60, 72];
  const markOf = (f: GuardFinding) => {
    const r = f.actions.find((a) => a.recommended);
    if (!r || !r.ticket || r.startH > 72) return null;
    const label = r.ticket.action === "create-maintenance" ? `Wartung ${fmtTime(g.now + r.startH * H)}` : r.label.length > 34 ? `${r.label.slice(0, 33)}…` : r.label;
    return { h: r.startH, label };
  };
  return (
    <Panel title="Frühwarn-Radar · nächste 72 h" subtitle="Oben: wann das Ereignis wahrscheinlich eintritt · darunter: wann die empfohlene Maßnahme greift · Klick öffnet die Akte" icon={<Radar size={16} />}>
      <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-2">
        <span />
        <div className="relative mb-1 h-4 text-[10px] text-faint">
          {ticks.map((h) => (
            <span key={h} className={cn("num absolute whitespace-nowrap", h === 0 ? "" : h === 72 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${pct(h)}%` }}>
              {h === 0 ? "jetzt" : `+${h} h`}
            </span>
          ))}
        </div>
        {lanes.map(({ m, fs }) => (
          <div key={m.id} className="contents">
            <button onClick={() => onPick(m.id)} className="num mb-1.5 self-center text-left text-[12px] font-bold hover:text-accent">
              {m.id}
            </button>
            <button onClick={() => onPick(m.id)} className="relative mb-1.5 overflow-hidden rounded-lg bg-panel-2 px-0 py-1 text-left hover:ring-1 hover:ring-accent/40">
              {g.shiftMarksH.map((h) => (
                <span key={h} className="absolute inset-y-0 w-px border-l border-dashed border-faint/60" style={{ left: `${pct(h)}%` }} />
              ))}
              {fs.map((f) => {
                const w = f.window ?? { fromH: 0, toH: 24, label: f.title };
                const mark = markOf(f);
                const from = pct(w.fromH);
                const right = from > 62;
                return (
                  <div key={f.id} className="relative">
                    <div className="relative h-6" title={`${f.title} · ${f.horizon}`}>
                      <span className={cn("absolute top-0.5 h-5 rounded-md border", BAND[f.sev])} style={{ left: `${from}%`, width: `${Math.max(1.5, pct(w.toH) - from)}%` }} />
                      <span className={cn("absolute top-0.5 z-10 flex h-5 items-center whitespace-nowrap px-1.5 text-[10.5px] font-semibold", f.sev === "crit" ? "text-crit" : f.sev === "warn" ? "text-ink" : "text-ink-2")} style={right ? { right: `${100 - pct(w.toH)}%` } : { left: `${from}%` }}>
                        {w.label}
                      </span>
                    </div>
                    {mark && (
                      <div className="relative h-5">
                        <span className={cn("absolute top-0 flex h-[18px] items-center gap-1 whitespace-nowrap rounded-md border border-ok/50 bg-panel px-1.5 text-[10px] font-semibold text-ok", pct(mark.h) > 60 && "-translate-x-full")} style={{ left: `${pct(mark.h)}%` }} title="empfohlene Maßnahme">
                          ◆ {mark.label}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </button>
          </div>
        ))}
      </div>
      {!lanes.length && <div className="py-8 text-center text-[12.5px] text-muted">Keine Befunde – für die nächsten 72 h ist nichts zu erwarten.</div>}
      <Legend
        className="mt-1"
        items={[
          { color: "color-mix(in srgb, var(--crit) 30%, transparent)", label: "rot: kritisch" },
          { color: "color-mix(in srgb, var(--warn) 35%, transparent)", label: "gelb: Warnung" },
          { color: "color-mix(in srgb, var(--accent) 20%, transparent)", label: "blau: Hinweis" },
          { color: "var(--ok)", kind: "ring", label: "◆ grün: empfohlene Maßnahme (Zeitpunkt)" },
          { color: "var(--faint)", kind: "dash", label: "gestrichelt: Schichtwechsel" },
        ]}
        note="Balken = Zeitfenster, in dem das Ereignis wahrscheinlich eintritt"
      />
    </Panel>
  );
}

function HowItWorks() {
  return (
    <Panel title="So arbeitet der Wächter" icon={<BrainCircuit size={16} />} ai>
      <ol className="space-y-2 text-[11.5px] leading-snug text-ink-2">
        {[
          ["Daten", "Alle 5 Minuten: Sensorik (OPC UA), BDE-Raster, Stillstände (MES), Aufträge (SAP), Qualität (CAQ/Kamera)."],
          ["Muster", "Trend statt Grenzwert: ML-Wartungsmodell, SPC/EWMA, Vergleich mit gestern und mit dem Referenzwert der Maschine."],
          ["Bewertung", "Eintrittswahrscheinlichkeit × Kosten = drohender Verlust in Euro – damit vergleichbar und priorisierbar."],
          ["Maßnahmen", "Mehrere Alternativen mit Kosten, vermiedenem Verlust und Netto. Entwurf → Freigabe durch einen Menschen."],
        ].map(([h, d], i) => (
          <li key={h} className="flex gap-2">
            <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10.5px] font-bold text-accent">{i + 1}</span>
            <span>
              <span className="font-semibold text-ink">{h}:</span> {d}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function AvoidedPanel({ g }: { g: GuardianView }) {
  if (!g.avoided.length) return null;
  return (
    <Panel title="Heute vermieden" subtitle="erwarteter Verlust, den freigegebene Maßnahmen verhindern" icon={<Euro size={16} />}>
      <div className="space-y-1.5">
        {g.avoided.map((a, i) => (
          <div key={i} className="flex items-start justify-between gap-2 text-[11.5px]">
            <span className="min-w-0 text-ink-2">
              <span className="num text-faint">{fmtTime(a.t)}</span> {a.text}
            </span>
            <span className="num shrink-0 font-semibold text-ok">{fmtEur(a.eur)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ======================= Maschinen-Akte =======================

function WatchRow({ m, active, onClick }: { m: MachineGuard; active: boolean; onClick: () => void }) {
  const top = m.findings[0];
  return (
    <button onClick={onClick} className={cn("grid w-full grid-cols-[46px_minmax(0,1fr)_84px] items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors", active ? "bg-accent-soft" : "hover:bg-panel-2")}>
      <Ring value={m.health / 100} size={40} stroke={4} color={healthColor(m.health)}>
        <span className="num text-[10.5px] font-semibold">{m.health}</span>
      </Ring>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="num text-[12.5px] font-bold">{m.id}</span>
          {m.status !== "PRODUKTION" && <StatusPill status={m.status} />}
          <span className="truncate text-[10.5px] text-muted">{m.product}</span>
        </div>
        <div className={cn("mt-0.5 truncate text-[11px]", top ? (top.sev === "crit" ? "font-semibold text-crit" : top.sev === "warn" ? "text-warn" : "text-ink-2") : "text-ok")}>{top ? top.title : "unauffällig – alle Prüfpunkte im Normalbereich"}</div>
        <div className="mt-1 flex gap-0.5">
          {DIMS.map(([k, l]) => (
            <span key={k} title={l} className={cn("h-1.5 flex-1 rounded-full", CELL[m.dims[k]])} />
          ))}
        </div>
      </div>
      <div className="text-right">
        {m.lossEur72 > 0 ? (
          <>
            <div className="num text-[12px] font-semibold text-crit">{fmtEur(m.lossEur72)}</div>
            <div className="text-[9.5px] text-muted">drohend 72 h</div>
          </>
        ) : (
          <ShieldCheck size={16} className="ml-auto text-ok" />
        )}
      </div>
    </button>
  );
}

function ActionRow({ a, f, onDraft, onSim, busy }: { a: GuardAction; f: GuardFinding; onDraft: (a: GuardAction) => void; onSim: (a: GuardAction) => void; busy: boolean }) {
  return (
    <div className={cn("grid grid-cols-3 items-center gap-2 rounded-lg px-2.5 py-2 text-[11.5px] sm:grid-cols-[minmax(0,1fr)_76px_76px_80px_auto]", a.recommended ? "bg-ok-soft ring-1 ring-ok/30" : a.baseline ? "opacity-70" : "bg-panel-2")}>
      <div className="col-span-3 min-w-0 sm:col-span-1">
        <div className="flex items-center gap-1.5 font-semibold">
          {a.recommended && <Badge sev="ok">Empfohlen</Badge>}
          <span className="truncate" title={a.label}>
            {a.label}
          </span>
        </div>
        <div className="mt-0.5 text-[10.5px] leading-snug text-muted">
          {a.detail} {a.when !== "–" && <span className="text-ink-2">· {a.when}</span>}
        </div>
      </div>
      <div className="num text-right">
        <div className="text-[9px] uppercase text-faint">Kosten</div>
        {fmtEur(a.costEur)}
      </div>
      <div className="num text-right">
        <div className="text-[9px] uppercase text-faint">vermeidet</div>
        <span className="text-ok">{fmtEur(a.avoidedEur)}</span>
      </div>
      <div className="num text-right">
        <div className="text-[9px] uppercase text-faint">Netto</div>
        <span className={cn("font-semibold", a.netEur > 0 ? "text-ok" : a.netEur < 0 ? "text-crit" : "text-muted")}>
          {a.netEur > 0 ? "+" : ""}
          {fmtEur(a.netEur)}
        </span>
      </div>
      <div className="col-span-3 flex items-center justify-end gap-1 sm:col-span-1 sm:w-[150px]">
        {a.ticket && (
          <button onClick={() => onSim(a)} disabled={busy} title="72 h im digitalen Zwilling durchrechnen: ohne vs. mit dieser Maßnahme" className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-accent hover:bg-accent-soft disabled:opacity-50">
            <Play size={11} /> 72 h
          </button>
        )}
        {a.ticket && !f.openTicket ? (
          <Button size="sm" variant={a.recommended ? "primary" : "secondary"} disabled={busy} onClick={() => onDraft(a)}>
            <FilePlus2 size={12} /> Entwurf
          </Button>
        ) : a.baseline ? (
          <span className="text-[10.5px] text-faint">Vergleich</span>
        ) : !a.ticket ? (
          <span className="text-[10.5px] text-faint">Hinweis</span>
        ) : null}
      </div>
    </div>
  );
}

/** Mechanik im Detail: Schwingungsverlauf + Trend und „Warum?“ (ehemals Seite Predictive Maintenance) */
function MechanicsDetail({ d }: { d: MachineData }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="label mb-1">Schwingung Spindellager · 16 h + KI-Trendprojektion</div>
        <VibrationChart d={d} />
      </div>
      <div className="min-w-0">
        <div className="label mb-1 flex items-center gap-1">
          <Lightbulb size={11} /> Warum? – Beitrag jedes Merkmals zum Ausfallrisiko
        </div>
        <Contributions items={d.contributions} />
      </div>
    </div>
  );
}

function FindingCard({ m, f, d, onChanged }: { m: MachineGuard; f: GuardFinding; d: MachineData | null; onChanged: () => void }) {
  const ticket = useUi((s) => (f.openTicket ? s.snap?.tickets.find((t) => t.id === f.openTicket!.id) : undefined));
  const openCopilot = useUi((s) => s.openCopilot);
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(f.kind === "ausfall" || f.kind === "qualitaet");
  // Was-wäre-wenn im digitalen Zwilling
  const [sim, setSim] = useState<WhatIfResult | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const simulate = async (a?: GuardAction) => {
    setSimBusy(true);
    setSim(await runWhatIf(m.id, f.id, a?.id));
    setSimBusy(false);
  };
  const draft = async (a: GuardAction) => {
    if (!a.ticket) return;
    setBusy(true);
    const { action, ...rest } = a.ticket;
    await ticketAction(action, rest);
    await refreshSnapshot();
    onChanged();
    setBusy(false);
  };
  const hasDeep = f.kind === "ausfall" || f.kind === "qualitaet";
  return (
    <div className={cn("rounded-xl border border-line border-l-4 bg-panel p-3.5", SEV_TONE[f.sev])}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge sev={f.sev === "info" ? "info" : f.sev}>{SEV_LABEL[f.sev]}</Badge>
        {f.early && (
          <Badge sev="warn">
            <TrendingUp size={11} /> Frühwarnung
          </Badge>
        )}
        <span className="label text-[9px]">{KIND[f.kind]}</span>
        <span className="ml-auto text-[10.5px] text-muted">erkannt {fmtTime(f.since)}</span>
      </div>
      <div className="mt-1.5 text-[14.5px] font-semibold leading-snug">{f.title}</div>
      <div className="text-[11.5px] text-muted">{f.horizon}</div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div>
          <div className="label mb-1 flex items-center gap-1 text-[9px]">
            <Radar size={11} /> Was die KI in den Daten sieht
          </div>
          <div className="text-[12px] leading-snug text-ink-2">{f.signal}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {f.evidence.map((e) => (
              <span key={e.label} className="inline-flex items-center gap-1 rounded-md border border-line bg-panel-2 px-1.5 py-0.5 text-[10.5px]">
                <span className="text-muted">{e.label}</span>
                <span className="num font-semibold">{e.value}</span>
                {e.up && <TrendingUp size={10} className="text-warn" />}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-lg bg-panel-2 p-2.5">
          <div className="label mb-1 flex items-center gap-1 text-[9px]">
            <BrainCircuit size={11} /> Wahrscheinliche Ursache
          </div>
          <div className="text-[12px] font-medium leading-snug">{f.cause}</div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[10.5px]">
            <div>
              <div className="text-muted">Sicherheit</div>
              <div className="num font-semibold">{fmtPct(f.confidence, 0)}</div>
              <Progress value={f.confidence} height={3} className="mt-0.5" />
            </div>
            <div>
              <div className="text-muted">Eintritt 72 h</div>
              <div className="num font-semibold">{fmtPct(f.probability, 0)}</div>
              <Progress value={f.probability} height={3} className="mt-0.5" sev={f.probability > 0.6 ? "crit" : "warn"} />
            </div>
            <div>
              <div className="text-muted">Drohender Verlust</div>
              <div className="num font-semibold text-crit">{fmtEur(f.lossEur72)}</div>
            </div>
          </div>
        </div>
      </div>

      {hasDeep && (
        <div className="mt-3 rounded-lg border border-line p-2.5">
          <button onClick={() => setDeep((v) => !v)} className="flex w-full items-center justify-between text-[11.5px] font-semibold text-ink-2">
            <span>Analyse im Detail · {f.kind === "ausfall" ? "Schwingungstrend und „Warum?“" : "SPC-Regelkarte"}</span>
            <span className="text-accent">{deep ? "ausblenden" : "anzeigen"}</span>
          </button>
          {deep && <div className="mt-2">{d ? f.kind === "ausfall" ? <MechanicsDetail d={d} /> : <SpcMini d={d} /> : <div className="skeleton h-40 rounded-lg" />}</div>}
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label text-[9px]">Maßnahmen & Alternativen</span>
          <span className="flex items-center gap-3">
            {f.actions.some((a) => a.ticket) && (
              <button onClick={() => simulate()} disabled={simBusy} className="flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent hover:bg-accent/15 disabled:opacity-50" title="Digitaler Zwilling: 72 h ohne vs. mit der empfohlenen Maßnahme durchrechnen">
                <Play size={11} /> Zukunft simulieren
              </button>
            )}
            <button onClick={() => openCopilot(`${m.id}: ${f.title}. Erkläre Ursache, Risiko und welche Maßnahme du empfiehlst – und warum.`)} className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline">
              <Sparkles size={11} /> KI fragen
            </button>
          </span>
        </div>
        <div className="space-y-1.5">
          {f.actions.map((a) => (
            <ActionRow key={a.id} a={a} f={f} onDraft={draft} onSim={simulate} busy={busy || simBusy} />
          ))}
        </div>
        <WhatIfView r={sim} busy={simBusy} />
        {ticket && (
          <div className="mt-2.5">
            <TicketView ticket={ticket} />
          </div>
        )}
      </div>
    </div>
  );
}

function Akte({ m, onChanged }: { m: MachineGuard; onChanged: () => void }) {
  const d = useMachineData(m.id);
  const view = useUi((s) => s.snap?.machines.find((x) => x.id === m.id));
  const p = view?.prediction;
  const scores: [string, number, string][] = [
    ["Mechanik", m.scores.mechanik, "Lager, Antrieb, Hydraulik"],
    ["Prozess & Qualität", m.scores.prozess, "SPC, Ausschuss"],
    ["Leistung", m.scores.leistung, "Zyklus, Kurzstopps"],
    ["Energie", m.scores.energie, "kW je Stück"],
  ];
  const hasMech = m.findings.some((f) => f.kind === "ausfall");
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          Maschinen-Akte {m.id} <StatusPill status={m.status} />
        </span>
      }
      subtitle={`${m.maker} ${m.model} · ${m.product} · Halle ${m.hall}${m.connectedAt ? ` · Daten seit ${fmtTime(m.connectedAt)}` : ""}${d ? ` · ${d.failureCount} Ausfälle seit Start` : ""}`}
      icon={<Activity size={16} />}
    >
      <div className="grid gap-4 md:grid-cols-[150px_minmax(0,1fr)]">
        <div className="flex flex-col items-center justify-center gap-2">
          <Ring value={m.health / 100} size={118} stroke={10} color={healthColor(m.health)}>
            <div className="text-center">
              <div className="num text-[26px] font-bold">{m.health}</div>
              <div className="text-[10px] text-muted">Zustand /100</div>
            </div>
          </Ring>
        </div>
        <div className="space-y-2">
          {scores.map(([l, v, s]) => (
            <div key={l}>
              <div className="flex justify-between text-[11.5px]">
                <span className="text-ink-2">
                  {l} <span className="text-faint">· {s}</span>
                </span>
                <span className="num font-semibold">{v}</span>
              </div>
              <Progress value={v / 100} height={5} className="mt-1" sev={v < 50 ? "crit" : v < 75 ? "warn" : "ok"} />
            </div>
          ))}
          {p && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[11.5px]">
              <span>
                <span className="text-muted">Ausfallrisiko 72 h</span> <b className={cn("num", p.p72 >= 0.75 ? "text-crit" : p.p72 >= 0.45 ? "text-warn" : "text-ink")}>{fmtPct(p.p72, 0)}</b>
              </span>
              <span>
                <span className="text-muted">ISO-Zone</span> <b className="num">{p.zone}</b>
              </span>
              <span>
                <span className="text-muted">Restlaufzeit</span> <b className="num">{p.rulH === null ? "> 30 Tage" : fmtDuration(p.rulH)}</b>
              </span>
              <span className="text-muted">
                Grenzwert-Alarm: <b className={p.zone === "D" ? "text-crit" : "text-ok"}>{p.zone === "D" ? "ausgelöst" : "noch nicht ausgelöst"}</b> – die KI erkennt den Trend
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="label mb-1.5">Prüfpunkte (alle 5 Minuten)</div>
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
          {m.checks.map((c) => (
            <div key={c.key} className={cn("rounded-lg px-2.5 py-1.5", c.state === "crit" ? "bg-crit-soft" : c.state === "warn" ? "bg-warn-soft" : "bg-panel-2")}>
              <div className="flex items-center gap-1 text-[10.5px] font-semibold">
                {c.state === "ok" ? <Check size={11} className="text-ok" /> : <CircleAlert size={11} className={c.state === "crit" ? "text-crit" : "text-warn"} />} {c.label}
              </div>
              <div className="num truncate text-[11px] text-ink-2" title={c.value}>
                {c.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {m.findings.length > 0 ? (
        <>
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
            <div>
              <div className="mb-1 text-[13px] font-semibold">Prognose: Verlust in den nächsten 72 h</div>
              <div className="h-[170px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={m.curve} margin={{ top: 6, right: 6, left: -6, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="h" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(h) => `+${h} h`} />
                    <YAxis tick={axisTick} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k €` : `${v} €`)} />
                    <Tooltip content={<ChartTip labelFormat={(l) => `in ${l} h`} valueFormat={(v) => fmtEur(v)} />} />
                    <Area dataKey="ohne" name="ohne Maßnahme" type="monotone" stroke="var(--crit)" fill="var(--crit)" fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
                    <Area dataKey="mit" name="mit empfohlenen Maßnahmen" type="monotone" stroke="var(--ok)" fill="var(--ok)" fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <Legend
                className="mt-1"
                items={[
                  { color: "var(--crit)", kind: "area", label: "rot: erwarteter Verlust ohne Maßnahme (aufsummiert)" },
                  { color: "var(--ok)", kind: "area", label: "grün: mit den empfohlenen Maßnahmen (inkl. deren Kosten)" },
                ]}
                note="Erwartungswert = Eintrittswahrscheinlichkeit × Kosten"
              />
            </div>
            <div className="grid content-start gap-2">
              <div className="rounded-xl bg-crit-soft px-3 py-2.5">
                <div className="label text-[9px]">Drohend ohne Maßnahme</div>
                <div className="num text-[20px] font-bold text-crit">{fmtEur(m.lossEur72)}</div>
              </div>
              <div className="rounded-xl bg-ok-soft px-3 py-2.5">
                <div className="label text-[9px]">Mit KI-Empfehlungen</div>
                <div className="num text-[20px] font-bold text-ok">{fmtEur(m.lossWithActionsEur72)}</div>
              </div>
              <div className="rounded-xl bg-panel-2 px-3 py-2.5">
                <div className="label text-[9px]">Einsparpotenzial</div>
                <div className="num text-[20px] font-bold">{fmtEur(Math.max(0, m.lossEur72 - m.lossWithActionsEur72))}</div>
              </div>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {m.findings.map((f) => (
              <FindingCard key={f.id} m={m} f={f} d={d} onChanged={onChanged} />
            ))}
          </div>
        </>
      ) : (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-ok-soft px-3.5 py-3 text-[12.5px]">
          <ShieldCheck size={18} className="mt-px shrink-0 text-ok" />
          <div>
            <div className="font-semibold">Keine Auffälligkeiten.</div>
            <div className="text-ink-2">Alle Prüfpunkte liegen im Normalbereich, kein Trend zeigt Richtung Grenzwert. Der Wächter prüft weiter alle 5 Minuten.</div>
          </div>
        </div>
      )}

      {/* Mechanik-Analyse bleibt immer erreichbar – ohne Befund als eigener Abschnitt */}
      {!hasMech && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="mb-2 text-[13px] font-semibold">Mechanik im Detail</div>
          {d ? <MechanicsDetail d={d} /> : <div className="skeleton h-52 rounded-lg" />}
        </div>
      )}
    </Panel>
  );
}

// ======================= Modell & Vertrauen =======================

function TrustPanel({ g }: { g: GuardianView }) {
  const t = g.trust;
  return (
    <Panel title="Trefferquote der Prognosen" subtitle={`Ausfall- und Qualitätswarnungen der letzten ${t.days} Tage – lag der Wächter richtig?`} icon={<Target size={16} />} ai>
      <div className="grid gap-4 md:grid-cols-[150px_minmax(0,1fr)]">
        <div className="flex flex-col items-center justify-center">
          <Ring value={t.hitRate} size={118} stroke={10} color={t.hitRate >= 0.8 ? "var(--ok)" : "var(--warn)"}>
            <div className="text-center">
              <div className="num text-[24px] font-bold">{fmtPct(t.hitRate, 0)}</div>
              <div className="text-[10px] text-muted">bestätigt</div>
            </div>
          </Ring>
        </div>
        <div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ["Warnungen", `${t.warnings}`],
              ["bestätigt", `${t.confirmed}`],
              ["Fehlalarme", `${t.falseAlarms}`],
              ["offen", `${t.open}`],
              ["Ø Vorwarnzeit", `${fmtNum(t.avgLeadH, 0)} h`],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-panel-2 px-2.5 py-2">
                <div className="label text-[9px]">{l}</div>
                <div className="num text-[16px] font-semibold">{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[11.5px] leading-snug text-ink-2">
            <b>Bestätigt</b> = das vorhergesagte Ereignis trat ein oder die Instandhaltung hat nach Prüfung eine Maßnahme ergriffen. <b>Fehlalarm</b> = der Befund verschwand ohne Ereignis und ohne Maßnahme. Die Vorwarnzeit zeigt, wie viele Stunden <i>vor</i> dem Ereignis der Wächter gewarnt hat.
          </div>
          <div className="mt-2 rounded-lg bg-panel-2 p-2.5 text-[11px] leading-snug text-muted">
            <b className="text-ink-2">In Produktion:</b> Jede Warnung bekommt Feedback der Instandhaltung („berechtigt?“). Daraus lernt das Modell beim monatlichen Retraining – und die Schwelle wird so gewählt, dass Fehlalarme das Vertrauen nicht zerstören.
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ======================= Seite =======================

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const { g, reload } = useGuardian();
  const card = useModelCard();
  const openCopilot = useUi((s) => s.openCopilot);
  const selectMachine = useUi((s) => s.selectMachine);
  const urlM = sp.get("m");
  const tab: Tab = (["werk", "akte", "modell"] as const).find((x) => x === sp.get("tab")) ?? (urlM ? "akte" : "werk");
  const sel = g?.machines.find((m) => m.id === urlM) ?? g?.machines[0];
  const reveal = useRevealOnSelect(tab === "akte" ? urlM : null);
  const go = (t: Tab, m?: string) => router.replace(`/waechter?tab=${t}${m ? `&m=${m}` : ""}`, { scroll: false });
  const pick = (id: string) => {
    go("akte", id);
    reveal.bump();
  };
  const t = g?.totals;
  const saving = t ? Math.max(0, t.lossEur72 - t.lossWithActionsEur72) : 0;
  const kpis = useMemo(
    () =>
      t && g
        ? ([
            [Radar, "Überwacht", `${t.monitored} Maschinen`, `${t.signals} Signale · ${t.analysesToday.toLocaleString("de-DE")} Analysen heute`, ""],
            [CircleAlert, "Offene Befunde", `${t.findings}`, `${t.crit} kritisch · ${t.early} Frühwarnungen`, t.crit ? "crit" : t.findings ? "warn" : ""],
            [TrendingUp, "Drohender Verlust 72 h", fmtKEur(t.lossEur72), "ohne Maßnahmen", t.lossEur72 > 5000 ? "crit" : ""],
            [ShieldCheck, "Mit KI-Maßnahmen", fmtKEur(t.lossWithActionsEur72), `Einsparpotenzial ${fmtKEur(saving)}`, ""],
            [Euro, "Heute vermieden", fmtKEur(t.avoidedTodayEur), "durch freigegebene Maßnahmen", t.avoidedTodayEur > 0 ? "ok" : ""],
            [Target, "Trefferquote 30 Tage", fmtPct(g.trust.hitRate, 0), `Ø ${fmtNum(g.trust.avgLeadH, 0)} h Vorwarnzeit`, ""],
          ] as const)
        : [],
    [t, g, saving],
  );

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <ShieldCheck size={12} /> Maschinengesundheit · KI-Wächter
          </>
        }
        title="Jede Maschine. Rund um die Uhr. Bevor es teuer wird."
        desc="Eine KI für alle Maschinen: Alle 5 Minuten prüft die KI Mechanik (ML-Wartungsmodell), Prozess & Qualität (SPC/EWMA), Leistung, Kurzstillstände, Energie und Liefertermine. Die KI erkennt Trends, bevor ein Grenzwert anschlägt, erklärt, was sie in den Daten sieht und warum, rechnet den drohenden Verlust in Euro – und schlägt Maßnahmen mit Alternativen vor. Freigeben muss immer ein Mensch."
        actions={
          <Button variant="ai" onClick={() => openCopilot("Welche Maschine macht gerade Probleme, was droht und was sollen wir tun?")}>
            <Sparkles size={15} /> KI fragen
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map(([Icon, l, v, s, sev]) => (
          <div key={l} className={cn("panel px-3.5 py-3", sev === "crit" && "border-crit/50", sev === "warn" && "border-warn/50", sev === "ok" && "border-ok/50")}>
            <div className="label flex items-center gap-1.5">
              <Icon size={12} /> {l}
            </div>
            <div className={cn("num mt-1 text-[21px] font-bold leading-none", sev === "crit" ? "text-crit" : sev === "ok" ? "text-ok" : "text-ink")}>{v}</div>
            <div className="mt-1 truncate text-[11px] text-muted">{s}</div>
          </div>
        ))}
        {!t && <div className="skeleton h-[84px] rounded-xl sm:col-span-3 xl:col-span-6" />}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          value={tab}
          onChange={(x) => go(x, x === "akte" ? sel?.id : undefined)}
          items={[
            { value: "werk", label: "Werk · Lagebild" },
            { value: "akte", label: "Maschinen-Akte" },
            { value: "modell", label: "Modell & Vertrauen" },
          ]}
        />
        <span className="text-[11.5px] text-muted">{tab === "werk" ? "Wo stehen wir – und was kommt in den nächsten 72 h?" : tab === "akte" ? "Eine Maschine, alle Befunde, alle Maßnahmen." : "Wie gut ist die KI – und warum kann man ihr trauen?"}</span>
      </div>

      {g && tab !== "modell" && <LiveScan machines={g.machines} />}

      {tab === "werk" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-4">
            {g ? <RadarView g={g} onPick={pick} /> : <div className="skeleton h-72 rounded-2xl" />}
            {g ? <HealthMatrix g={g} onPick={pick} /> : <div className="skeleton h-96 rounded-2xl" />}
          </div>
          <div className="space-y-4">
            <HowItWorks />
            {g && <AvoidedPanel g={g} />}
          </div>
        </div>
      )}

      {tab === "akte" && (
        <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Panel title="Wachliste" subtitle="sortiert nach drohendem Verlust · Klick öffnet die Akte" icon={<GaugeIcon size={16} />} bodyClassName="px-2 pb-2">
            <div className="space-y-0.5">
              {(g?.machines ?? []).map((m) => (
                <WatchRow key={m.id} m={m} active={sel?.id === m.id} onClick={() => pick(m.id)} />
              ))}
              {!g && <div className="skeleton h-72 rounded-xl" />}
              {(g?.blind ?? []).map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    selectMachine(b.id);
                    router.push("/");
                  }}
                  className="grid w-full grid-cols-[46px_minmax(0,1fr)_84px] items-center gap-2.5 rounded-lg border border-dashed border-faint/60 px-2 py-2 text-left opacity-75 hover:opacity-100"
                  title="Im Leitstand öffnen und anbinden"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-panel-2 text-muted">
                    <EyeOff size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="num text-[12.5px] font-bold text-muted">{b.id}</div>
                    <div className="truncate text-[11px] text-muted">keine Daten – hier ist der Wächter blind</div>
                  </div>
                  <span className="flex items-center justify-end gap-1 text-[10.5px] font-semibold text-muted">
                    <Unplug size={12} /> anbinden
                  </span>
                </button>
              ))}
            </div>
            <Legend
              className="px-2 pt-2"
              items={[
                { color: "var(--ok)", kind: "ring", label: "Ring: Zustand 0–100 (grün ≥ 75, gelb 50–75, rot < 50)" },
                { color: "var(--warn)", label: "6 Striche: Mechanik · Qualität · Leistung · Kurzstopps · Energie · Termin" },
                { color: "var(--crit)", label: "Betrag: drohender Verlust in 72 h" },
              ]}
              note="gestrichelt = Maschine ohne Datenanschluss (Rollout Phase 2)"
            />
          </Panel>
          <div ref={reveal.ref} className="min-w-0 scroll-mt-4">
            {sel ? <Akte key={sel.id} m={sel} onChanged={reload} /> : <div className="skeleton h-96 rounded-2xl" />}
          </div>
        </div>
      )}

      {tab === "modell" && (
        <div className="space-y-4">
          {g ? <TrustPanel g={g} /> : <div className="skeleton h-48 rounded-2xl" />}
          {card ? <ModelCardPanel card={card} /> : <div className="skeleton h-64 rounded-2xl" />}
          <div className="grid gap-4 lg:grid-cols-2">
            <HowItWorks />
            <Panel title="Welche Methode wofür?" icon={<BrainCircuit size={16} />}>
              <div className="space-y-2 text-[11.5px] leading-snug text-ink-2">
                {[
                  ["Mechanik", "Logistische Regression auf Trend-Merkmalen (Pegel, Steigung, Streuung, Betriebsstunden) – erklärbar über Merkmalsbeiträge."],
                  ["Qualität", "SPC mit EWMA-Karte: erkennt kleine, schleichende Verschiebungen, bevor Teile außer Toleranz liegen."],
                  ["Leistung & Kurzstopps", "Regeln auf dem BDE-Raster: wiederkehrende Muster statt Einzelereignisse, Vergleich mit gestern."],
                  ["Energie", "Abweichung zur Referenz der Maschine bei gleicher Leistung – Hinweis auf Leckage oder Heizung."],
                  ["Bewertung", "Erwartungswert in Euro (Wahrscheinlichkeit × Kosten) – dieselbe Kostenbasis in allen Ansichten."],
                ].map(([h, x]) => (
                  <div key={h}>
                    <span className="font-semibold text-ink">{h}:</span> {x}
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WaechterPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-2xl" />}>
      <Inner />
    </Suspense>
  );
}
