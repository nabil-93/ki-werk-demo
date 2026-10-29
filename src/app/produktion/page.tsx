"use client";

import { Suspense, memo, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ChevronLeft, Factory, Gauge as GaugeIcon, PlugZap, Sparkles, Timer, Unplug, X } from "lucide-react";
import { control, refreshSnapshot, useUi } from "@/lib/client/store";
import { PHASE2_SEEDS, SENSOR_DEFS, PRODUCT } from "@/lib/sim/catalog";
import type { MachineStatus, MachineView, SensorSample } from "@/lib/sim/types";
import type { MachineDayDetail } from "@/lib/sim/reports";
import { fmtDateTime, fmtEur, fmtInt, fmtNum, fmtPct, fmtTime } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { useRevealOnSelect } from "@/lib/client/reveal";
import { Badge, Button, PageHeader, Panel, Progress, STATUS_META, StatusPill, Tabs } from "@/components/ui/ui";
import { Ring, Sparkline } from "@/components/ui/charts";
import { ChartTip, Legend, axisTick, gridProps } from "@/components/ui/chartkit";
import { BarsLegend, ProductionBars, TempChart } from "@/components/ops/charts";

function MachineCard({ m, onClick, active }: { m: MachineView; onClick: () => void; active: boolean }) {
  const risk = m.status === "PRODUKTION" && m.prediction.p72 >= 0.45;
  return (
    <motion.button
      layout
      onClick={onClick}
      className={cn(
        "panel group relative flex flex-col gap-2.5 p-3.5 text-left transition-[border-color,box-shadow]",
        active ? "border-accent ring-2 ring-accent/20" : "hover:border-faint",
        m.status === "STOERUNG" && "border-crit/60",
        risk && !active && (m.prediction.p72 >= 0.75 ? "border-crit/50" : "border-warn/50"),
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="num text-[15px] font-bold">{m.id}</span>
            <StatusPill status={m.status} />
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted">
            {m.maker} {m.model}
          </div>
        </div>
        <Ring value={m.oee} size={42} stroke={4} color={m.oee < 0.6 ? "var(--crit)" : m.oee < 0.8 ? "var(--warn)" : "var(--ok)"}>
          <span className="num text-[10px] font-semibold">{Math.round(m.oee * 100)}</span>
        </Ring>
      </div>
      <div>
        <div className="flex justify-between text-[11px]">
          <span className="truncate text-ink-2">{m.product.short}</span>
          <span className="num text-muted">{m.orderId ?? "–"}</span>
        </div>
        <Progress value={m.orderProgress ?? 0} height={4} className="mt-1" sev={m.status === "PRODUKTION" ? "info" : "neutral"} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="label text-[9px]">Stück / h</div>
          <div className="num text-[14px] font-semibold">{fmtInt(m.outputPerHour)}</div>
        </div>
        <Sparkline data={m.spark} width={84} height={26} color={m.current.vib > 2.8 ? "var(--warn)" : "var(--accent)"} />
      </div>
      {(risk || m.statusReason) && (
        <div className={cn("truncate rounded-md px-2 py-1 text-[10.5px] font-medium", risk ? (m.prediction.p72 >= 0.75 ? "bg-crit-soft text-crit" : "bg-warn-soft text-warn") : "bg-panel-2 text-muted")}>
          {risk ? `KI: Ausfallrisiko ${fmtPct(m.prediction.p72, 0)}` : m.statusReason}
        </div>
      )}
      {m.connectedAt && !risk && !m.statusReason && (
        <div className="flex items-center gap-1 truncate rounded-md bg-ok-soft px-2 py-1 text-[10.5px] font-medium text-ok">
          <PlugZap size={11} /> neu angebunden · Daten seit {fmtTime(m.connectedAt)}
        </div>
      )}
    </motion.button>
  );
}

const TL_COLORS: Record<MachineStatus, string> = { PRODUKTION: "var(--ok)", RUESTEN: "var(--warn)", STOERUNG: "var(--crit)", WARTUNG: "var(--accent)", STILLSTAND: "var(--faint)" };

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const m = useUi((s) => s.snap?.machines.find((x) => x.id === id));
  const now = useUi((s) => s.snap?.now ?? Date.now());
  const openCopilot = useUi((s) => s.openCopilot);
  const [offset, setOffset] = useState<"0" | "-1">("0");
  const [d, setD] = useState<{ live: SensorSample[]; hist: SensorSample[]; timeline: { t: number; status: MachineStatus }[]; day?: MachineDayDetail } | null>(null);
  // Rollout-Demo: Anbindung trennen (zweiter Klick bestätigt)
  const [cut, setCut] = useState<"idle" | "ask" | "busy">("idle");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await fetch(`/api/machine?id=${id}${offset === "-1" ? "&day=-1" : ""}`, { cache: "no-store" });
      // Maschine (nicht mehr) angebunden → nicht weiter abfragen
      if (r.status === 404) clearInterval(t);
      if (r.ok && alive) setD(await r.json());
    };
    const t = setInterval(load, 2000);
    load();
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, offset]);
  if (!m) return null;
  const defs = SENSOR_DEFS[m.type];
  const live = (d?.live ?? []).slice(-90);
  const tl = d?.timeline ?? [];
  const t0 = tl[0]?.t ?? now - 8 * 3_600_000;
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {m.id} · {m.maker} {m.model} <StatusPill status={m.status} />
        </span>
      }
      subtitle={`${PRODUCT[m.product.id].name} · ${m.cavities}-fach · Sollzyklus ${fmtNum(m.targetCycle, 1)} s · Halle ${m.hall}`}
      icon={<Activity size={16} />}
      actions={
        <>
          <Button size="sm" onClick={onClose} title="Zurück zur Maschinenübersicht">
            <ChevronLeft size={14} /> Zurück
          </Button>
          {m.connectedAt && (
            <Button
              size="sm"
              variant={cut === "idle" ? "secondary" : "danger"}
              disabled={cut === "busy"}
              title="Maschine produziert weiter, liefert aber keine Daten mehr an die KI"
              onClick={async () => {
                if (cut === "idle") return setCut("ask");
                setCut("busy");
                await control("disconnect", { machine: m.id });
                onClose();
                await refreshSnapshot();
              }}
            >
              <Unplug size={13} /> {cut === "idle" ? "Anbindung trennen" : "Wirklich trennen?"}
            </Button>
          )}
          <Button size="sm" variant="ai" onClick={() => openCopilot(`Wie ist der Zustand von ${m.id} und was empfiehlst du?`)}>
            <Sparkles size={13} /> KI
          </Button>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-panel-3" aria-label="Schließen">
            <X size={16} />
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Verfügbarkeit", fmtPct(m.availability)],
          ["Leistung", fmtPct(m.performance)],
          ["Qualität", fmtPct(m.quality, 2)],
          ["Energie heute", `${fmtInt(m.energyKwhToday)} kWh`],
        ].map(([l, v]) => (
          <div key={l} className="rounded-lg bg-panel-2 px-3 py-2">
            <div className="label text-[9px]">{l}</div>
            <div className="num text-[15px] font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <div className="label mb-1">Statusverlauf heute</div>
        <div className="flex h-5 overflow-hidden rounded-md bg-panel-3">
          {tl.map((s, i) => {
            const end = tl[i + 1]?.t ?? now;
            return <div key={i} title={`${STATUS_META[s.status].label} ab ${fmtTime(s.t)}`} style={{ width: `${((end - s.t) / Math.max(1, now - t0)) * 100}%`, background: TL_COLORS[s.status] }} />;
          })}
        </div>
        <div className="num mt-1 flex justify-between text-[10px] text-faint">
          <span>{fmtTime(t0)}</span>
          <span>jetzt {fmtTime(now)}</span>
        </div>
        <Legend className="mt-1" items={(Object.keys(TL_COLORS) as MachineStatus[]).map((s) => ({ color: TL_COLORS[s], label: STATUS_META[s].label }))} note="Breite = Dauer des Zustands" />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {defs.map((def) => {
          const data = live.map((s) => ({ t: s.t, v: s[def.key] > 0 ? Number(s[def.key].toFixed(def.digits + 1)) : null }));
          const cur = m.current[def.key];
          return (
            <div key={def.key} className="rounded-xl border border-line-2 bg-panel-2/60 p-2.5">
              <div className="flex items-baseline justify-between">
                <span className="truncate text-[11px] text-muted">{def.label}</span>
              </div>
              <div className="num text-[15px] font-semibold">
                {cur > 0 ? fmtNum(cur, def.digits) : "–"} <span className="text-[10px] font-normal text-muted">{def.unit}</span>
              </div>
              <div className="h-[56px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <YAxis hide domain={["auto", "auto"]} />
                    <XAxis dataKey="t" hide />
                    <Tooltip content={<ChartTip labelFormat={(l) => fmtTime(Number(l))} valueFormat={(v) => `${fmtNum(v, def.digits)} ${def.unit}`} />} />
                    <Line dataKey="v" name={def.short} stroke={def.key === "vib" && cur >= def.warn ? "var(--warn)" : "var(--accent)"} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
      <Legend className="mt-2" items={[{ color: "var(--accent)", kind: "line", label: "blaue Linie: Messwert der letzten 90 s (1 Wert/s)" }, { color: "var(--warn)", kind: "line", label: "gelb: Schwingung über Warngrenze" }]} note="Lücken = Maschine steht (kein Messwert)" />
      {d?.day && <DayBlock day={d.day} offset={offset} setOffset={setOffset} />}
    </Panel>
  );
}

/** Tagesverlauf einer Maschine: 96 Säulen (15 min), Temperaturen und Stillstandsprotokoll */
function DayBlock({ day, offset, setOffset }: { day: MachineDayDetail; offset: "0" | "-1"; setOffset: (v: "0" | "-1") => void }) {
  const t = day.totals;
  const worst = [...day.buckets].filter((b) => b.sev === "crit").length;
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold">Produktion {offset === "0" ? "heute" : "gestern"} im 15-Minuten-Raster</div>
          <div className="text-[11px] text-muted">
            {day.buckets.length} Intervalle · {worst} Einbrüche unter 72 % · Soll je Intervall {fmtInt(day.targetPerBucket)} Stk · Fahre über eine Säule für Details
          </div>
        </div>
        <Tabs
          size="sm"
          value={offset}
          onChange={setOffset}
          items={[
            { value: "0", label: "Heute" },
            { value: "-1", label: "Gestern" },
          ]}
        />
      </div>
      <ProductionBars buckets={day.buckets} dayStart={day.day} now={day.now} height={170} noDataBefore={day.connectedAt} />
      <BarsLegend className="mt-2" />
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ["Gutteile", fmtInt(t.good)],
          ["Soll", fmtInt(t.target)],
          ["Ist / Soll", fmtPct(t.oee, 1)],
          ["Stillstand", `${fmtNum(t.stoerH + t.ruestH + t.wartH, 1)} h · ${t.stops}×`],
          ["Verlust (entg. DB)", fmtEur(t.lossEur)],
          ["Energie", `${fmtInt(t.energy)} kWh`],
        ].map(([l, v]) => (
          <div key={l} className="rounded-lg bg-panel-2 px-3 py-2">
            <div className="label text-[9px]">{l}</div>
            <div className={cn("num text-[14px] font-semibold", l.startsWith("Verlust") && "text-crit")}>{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="mb-1 text-[13px] font-semibold">Temperaturen des Tages</div>
          <TempChart buckets={day.buckets} dayStart={day.day} sensors={day.sensors} />
        </div>
        <div>
          <div className="mb-1 text-[13px] font-semibold">Stillstände {offset === "0" ? "heute" : "gestern"}</div>
          <div className="max-h-[262px] overflow-auto rounded-xl border border-line">
            <table className="w-full text-[11.5px]">
              <thead className="sticky top-0 bg-panel">
                <tr className="border-b border-line text-left text-[9.5px] uppercase tracking-wide text-muted">
                  {["Zeit", "Dauer", "Art", "Ursache", "Verlust"].map((h) => (
                    <th key={h} className="px-2.5 py-1.5 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {day.stops.map((s) => (
                  <tr key={s.id} className="border-b border-line-2 last:border-0">
                    <td className="num px-2.5 py-1">
                      {fmtTime(s.start)}–{s.end ? fmtTime(s.end) : "jetzt"}
                    </td>
                    <td className="num px-2.5 py-1">{fmtNum(s.durMin, 0)} min</td>
                    <td className="px-2.5 py-1">
                      <Badge sev={s.status === "STOERUNG" ? "crit" : s.status === "WARTUNG" ? "info" : "neutral"}>{STATUS_META[s.status].label}</Badge>
                    </td>
                    <td className="px-2.5 py-1 text-ink-2">{s.reason}</td>
                    <td className="num px-2.5 py-1 text-crit">{fmtEur(s.lossEur)}</td>
                  </tr>
                ))}
                {!day.stops.length && (
                  <tr>
                    <td colSpan={5} className="px-2.5 py-4 text-center text-muted">
                      Keine Stillstände.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

type Overview = { now: number; day: number; machines: { id: string; type: string; hall: string; status: MachineStatus; connectedAt?: number; product: string; good: number; target: number; scrap: number; oee: number; lossEur: number; stoerH: number; ruestH: number; topReason?: string; temp1Max: number; bars: { t: number; r: number; s: string }[] }[] };

const MINI: Record<string, string> = { ok: "var(--ok)", warn: "var(--warn)", crit: "var(--crit)", idle: "var(--faint)" };

/** Alle Maschinen untereinander: wie viel heute produziert, wann es lief und wann nicht */
function ProductionOverview({ selected, onPick }: { selected: string | null; onPick: (id: string) => void }) {
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/production", { cache: "no-store" });
        if (r.ok && alive) setO(await r.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const max = Math.max(1, ...(o?.machines ?? []).map((m) => m.good));
  const slot = (t: number) => Math.round((t - (o?.day ?? 0)) / (15 * 60_000));
  const anyNew = (o?.machines ?? []).some((m) => m.connectedAt && m.connectedAt > o!.day);
  return (
    <Panel title="Produktion je Maschine heute" subtitle="Gutteile seit 06:00 · Verlauf im 15-Minuten-Raster (rot = Einbruch, grau = ohne Plan) · Klick öffnet den Tagesverlauf" icon={<Factory size={16} />} bodyClassName="px-2 pb-2">
      <div className="space-y-0.5">
        {(o?.machines ?? []).map((m) => {
          // Säulen nach Uhrzeit einsortieren (neu angebundene Maschinen haben erst ab der Anbindung Daten)
          const at = new Map(m.bars.map((b) => [slot(b.t), b]));
          const blind = m.connectedAt ? (m.connectedAt - o!.day) / (15 * 60_000) : -1;
          return (
            <button key={m.id} onClick={() => onPick(m.id)} className={cn("grid w-full grid-cols-[70px_100px_minmax(0,1fr)_150px_70px_80px] items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-panel-2", selected === m.id && "bg-accent-soft/40 ring-1 ring-accent/30")}>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: STATUS_META[m.status].color }} />
                <span className="num text-[12.5px] font-bold">{m.id}</span>
              </span>
              <span className="min-w-0 text-[11px] text-ink-2">
                <span className="block truncate">{m.product}</span>
                {blind > 0 && <span className="block truncate text-[9.5px] font-semibold text-ok">angebunden {fmtTime(m.connectedAt!)}</span>}
              </span>
              <svg viewBox={`0 0 ${96 * 3} 26`} preserveAspectRatio="none" className="h-[26px] w-full">
                {Array.from({ length: 96 }, (_, i) => {
                  const b = at.get(i);
                  if (!b && i + 1 <= blind) return <rect key={i} x={i * 3 + 0.3} y={24} width={2.3} height={2} fill="var(--faint)" opacity={0.6} />;
                  if (!b) return <rect key={i} x={i * 3 + 0.3} y={4} width={2.3} height={22} fill="var(--panel-3)" opacity={0.5} />;
                  const h = b.s === "idle" ? 2 : Math.max(1.5, Math.min(1.15, b.r) / 1.15 * 26);
                  return <rect key={i} x={i * 3 + 0.3} y={26 - h} width={2.3} height={h} fill={MINI[b.s]} />;
                })}
              </svg>
              <span>
                <span className="num block text-[12px] font-semibold">{fmtInt(m.good)} Stk</span>
                <span className="block h-1 overflow-hidden rounded-full bg-panel-3">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${(m.good / max) * 100}%` }} />
                </span>
              </span>
              <span className={cn("num text-right text-[12px] font-semibold", m.oee < 0.75 ? "text-crit" : m.oee < 0.85 ? "text-warn" : "text-ok")}>{fmtPct(m.oee, 0)}</span>
              <span className="num text-right text-[11.5px] text-crit" title={m.topReason}>
                {fmtEur(m.lossEur)}
              </span>
            </button>
          );
        })}
        {!o && <div className="skeleton h-72 rounded-xl" />}
      </div>
      <div className="mt-1 grid grid-cols-[70px_100px_minmax(0,1fr)_150px_70px_80px] gap-3 px-2 text-[9.5px] uppercase tracking-wide text-faint">
        <span>Linie</span>
        <span>Produkt</span>
        <span className="flex justify-between">
          <span>06:00</span>
          <span>18:00</span>
          <span>06:00</span>
        </span>
        <span>Gutteile</span>
        <span className="text-right">Ist/Soll</span>
        <span className="text-right">Verlust</span>
      </div>
      <Legend
        className="px-2 pt-2"
        items={[
          { color: "var(--ok)", label: "grün: ≥ 88 % vom Soll" },
          { color: "var(--warn)", label: "gelb: 72–88 %" },
          { color: "var(--crit)", label: "rot: Einbruch/Stillstand" },
          { color: "var(--faint)", label: "grau: ohne Plan" },
          { color: "var(--panel-3)", label: "hell: noch nicht erreicht" },
          ...(anyNew ? [{ color: "var(--faint)", kind: "dash" as const, label: "Strich unten: keine Daten (vor der Anbindung)" }] : []),
          { color: "var(--accent)", label: "blauer Balken: Gutteile im Vergleich der Linien" },
        ]}
        note="jede kleine Säule = 15 Minuten · Punkt links = aktueller Status"
      />
    </Panel>
  );
}

// memo mit Vergleich auf den letzten Zeitstempel: Diagramm rendert nur alle 15 Sim-Minuten neu
const HistoryChart = memo(
  function HistoryChart({ hist }: { hist: { t: number; output: number; oeeP: number }[] }) {
    return (
              <div className="h-[252px]">
                <ResponsiveContainer width="100%" height={226}>
                  <ComposedChart data={hist} margin={{ top: 8, right: 4, left: -4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="outg" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => fmtTime(t)} tick={axisTick} axisLine={false} tickLine={false} minTickGap={40} />
                    <YAxis yAxisId="o" tick={axisTick} tickFormatter={(v) => `${fmtNum(v / 1000, 0)}k`} axisLine={false} tickLine={false} width={40} />
                    <YAxis yAxisId="e" orientation="right" domain={[50, 100]} tick={axisTick} tickFormatter={(v) => `${v} %`} axisLine={false} tickLine={false} width={40} />
                    <Tooltip content={<ChartTip labelFormat={(l) => fmtDateTime(Number(l))} valueFormat={(v, k) => (k === "oeeP" ? `${fmtNum(v, 1)} %` : `${fmtInt(v)} Stk/h`)} />} />
                    <Bar yAxisId="o" dataKey="output" name="Gutteile / h" fill="url(#outg)" stroke="var(--accent)" strokeOpacity={0.4} isAnimationActive={false} />
                    <Line yAxisId="e" dataKey="oeeP" name="OEE" stroke="var(--ok)" strokeWidth={1.8} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                <Legend
                  className="mt-1"
                  items={[
                    { color: "var(--accent)", kind: "area", label: "blaue Säulen: Gutteile je Stunde (linke Achse)" },
                    { color: "var(--ok)", kind: "line", label: "grüne Linie: OEE in % (rechte Achse)" },
                  ]}
                />
              </div>
    );
  },
  (a, b) => a.hist.length === b.hist.length && a.hist[a.hist.length - 1]?.t === b.hist[b.hist.length - 1]?.t,
);

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const snap = useUi((s) => s.snap);
  const selected = sp.get("m");
  const [hall, setHall] = useState<"alle" | "A" | "B">("alle");
  // Klick auf eine Maschine → Seite scrollt zum Anfang der Detailansicht
  const reveal = useRevealOnSelect(selected);
  const pick = (id: string) => {
    router.push(`/produktion?m=${id}`, { scroll: false });
    reveal.bump();
  };
  const machines = (snap?.machines ?? []).filter((m) => hall === "alle" || m.hall === hall);
  const all = snap?.machines ?? [];
  // Rollout Phase 2: Maschinen in Halle A, die (noch) keine Daten liefern – Anbindung im Leitstand
  const blind = PHASE2_SEEDS.filter((s) => snap && !all.some((m) => m.id === s.id));
  const selectMachine = useUi((s) => s.selectMachine);
  const avail = all.length ? all.reduce((s, m) => s + m.availability, 0) / all.length : 0;
  const perf = all.length ? all.reduce((s, m) => s + m.performance, 0) / all.length : 0;
  const qual = all.length ? all.reduce((s, m) => s + m.quality, 0) / all.length : 0;
  const hist = (snap?.history ?? []).map((h) => ({ ...h, oeeP: h.oee * 100 }));
  const reasons = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of snap?.events ?? []) if (e.source === "MES" && e.severity === "warn" && e.machineId) {
      const r = e.title.split(": ")[1] ?? e.title;
      m.set(r, (m.get(r) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [snap]);

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Factory size={12} /> Produktion · Transparenz in Echtzeit
          </>
        }
        title="Jede Maschine. Jeder Auftrag. Jede Sekunde."
        desc={`Statt Schichtbuch und Excel: Status, Ausbringung, OEE und Sensorik aller ${all.length || 12} angebundenen Linien live – direkt aus MES und Maschinensteuerung (OPC UA).${blind.length ? ` ${blind.length} weitere Maschinen in Halle A folgen im Rollout.` : ""}`}
      />

      <div className="mb-4 grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Panel title="OEE Werk heute" subtitle="Gesamtanlageneffektivität = Verfügbarkeit × Leistung × Qualität" icon={<GaugeIcon size={16} />}>
          <div className="flex items-center gap-4">
            <Ring value={snap?.kpis.oee ?? 0} size={104} stroke={9} color="var(--accent)">
              <div className="text-center">
                <div className="num text-[20px] font-bold">{snap ? fmtPct(snap.kpis.oee, 1) : "–"}</div>
                <div className="text-[9.5px] text-muted">Ziel 85 %</div>
              </div>
            </Ring>
            <div className="min-w-0 flex-1 space-y-2.5">
              {[
                ["Verfügbarkeit", avail, "Stillstände, Rüsten"],
                ["Leistung", perf, "Zyklus vs. Soll"],
                ["Qualität", qual, "Gutteile"],
              ].map(([l, v, s]) => (
                <div key={String(l)}>
                  <div className="flex justify-between text-[11.5px]">
                    <span className="text-ink-2">
                      {l} <span className="text-faint">· {s}</span>
                    </span>
                    <span className="num font-semibold">{fmtPct(Number(v))}</span>
                  </div>
                  <Progress value={Number(v)} height={5} className="mt-1" />
                </div>
              ))}
            </div>
          </div>
          {reasons.length > 0 && (
            <div className="mt-4">
              <div className="label mb-1.5">Häufigste Kurzstillstände (letzte Ereignisse)</div>
              {reasons.map(([r, n]) => (
                <div key={r} className="flex items-center justify-between py-0.5 text-[11.5px]">
                  <span className="truncate text-ink-2">{r}</span>
                  <Badge sev="neutral">{n}×</Badge>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Ausbringung & OEE · 24 h" subtitle="15-Minuten-Raster aus dem MES" icon={<Timer size={16} />}>
          <HistoryChart hist={hist} />
        </Panel>
      </div>

      {selected && (
        <div ref={reveal.ref} className="mb-4 scroll-mt-4">
          {/* router.replace("/produktion") entfernt ?m auf derselben Seite nicht zuverlässig – History-API wird von Next übernommen */}
          <Detail id={selected} onClose={() => window.history.replaceState(null, "", "/produktion")} />
        </div>
      )}

      <div className="mb-4">
        <ProductionOverview selected={selected} onPick={pick} />
      </div>

      <div className="mb-3 flex items-center gap-2">
        {(["alle", "A", "B"] as const).map((h) => (
          <button key={h} onClick={() => setHall(h)} className={cn("rounded-lg px-3 py-1.5 text-[12px] font-semibold", hall === h ? "bg-ink text-bg" : "bg-panel text-ink-2 hover:bg-panel-3")}>
            {h === "alle" ? "Alle Linien" : h === "A" ? "Halle A · Spritzguss IML" : "Halle B · Thermoformen"}
          </button>
        ))}
        <span className="ml-auto text-[11.5px] text-muted">{snap ? `${snap.kpis.machinesRunning} von ${snap.kpis.machinesTotal} produzieren` : ""}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {machines.map((m) => (
          <MachineCard key={m.id} m={m} active={m.id === selected} onClick={() => pick(m.id)} />
        ))}
        {hall !== "B" &&
          blind.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                selectMachine(s.id);
                router.push("/");
              }}
              title="Im Leitstand öffnen und anbinden"
              className="panel flex flex-col gap-2 border-dashed p-3.5 text-left opacity-85 transition-opacity hover:border-faint hover:opacity-100"
            >
              <div className="flex items-center gap-2">
                <span className="num text-[15px] font-bold text-muted">{s.id}</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-faint px-2 py-0.5 text-[10.5px] font-semibold text-muted">
                  <Unplug size={11} /> nicht angebunden
                </span>
              </div>
              <div className="truncate text-[11px] text-muted">
                {s.maker} {s.model} · Bj. {s.year}
              </div>
              <div className="text-[11px] text-ink-2">{PRODUCT[s.productId].short} · produziert, aber ohne Daten</div>
              <div className="mt-auto rounded-md bg-panel-2 px-2 py-1 text-[10.5px] font-medium text-muted">{s.link.via} · Klick: im Leitstand anbinden</div>
            </button>
          ))}
      </div>
      <Legend
        className="mt-3 rounded-lg bg-panel px-3 py-2"
        items={[
          { color: "var(--ok)", kind: "ring", label: "Ring: OEE heute (grün ≥ 80 %, gelb 60–80 %, rot < 60 %)" },
          { color: "var(--accent)", label: "blauer Balken: Fortschritt des laufenden Auftrags" },
          { color: "var(--accent)", kind: "line", label: "Linie rechts: Schwingung live (gelb = über Warngrenze)" },
          { color: "var(--warn)", kind: "ring", label: "gelber/roter Rahmen: KI-Ausfallrisiko bzw. Störung" },
          ...(blind.length ? [{ color: "var(--faint)", kind: "dash" as const, label: "gestrichelte Karte: produziert, aber noch ohne Datenanschluss (Rollout Phase 2)" }] : []),
        ]}
      />
    </div>
  );
}

export default function ProduktionPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-2xl" />}>
      <Inner />
    </Suspense>
  );
}
