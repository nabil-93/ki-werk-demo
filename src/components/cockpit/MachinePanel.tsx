"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Loader2, PlugZap, ShieldCheck, Sparkles, Unplug, X } from "lucide-react";
import { control, refreshSnapshot, useUi } from "@/lib/client/store";
import { cn } from "@/lib/client/cn";
import type { DimState, GuardKind, MachineGuard } from "@/lib/sim/guardian";
import type { MachineView } from "@/lib/sim/types";
import { SENSOR_DEFS, PRODUCT } from "@/lib/sim/catalog";
import type { SensorSample } from "@/lib/sim/types";
import type { MachineDayDetail } from "@/lib/sim/reports";
import { fmtDuration, fmtEur, fmtInt, fmtNum, fmtPct, fmtTime } from "@/lib/ai/format";
import { Badge, Button, Progress, StatusPill, sevForRisk } from "@/components/ui/ui";
import { Gauge, Sparkline } from "@/components/ui/charts";
import { BarsLegend, ProductionBars } from "@/components/ops/charts";
import { Legend } from "@/components/ui/chartkit";
import { BackButton } from "./OpsPanels";

const DIMS: [GuardKind, string][] = [
  ["ausfall", "Mechanik"],
  ["qualitaet", "Qualität"],
  ["leistung", "Leistung"],
  ["kurzstopps", "Kurzstopps"],
  ["energie", "Energie"],
  ["termin", "Termin"],
];
const DIM_BG: Record<DimState, string> = { ok: "bg-ok", info: "bg-accent/60", warn: "bg-warn", crit: "bg-crit" };

/** Maschinengesundheit: Wartungsprognose und KI-Wächter in EINER Box – Klick öffnet die Maschinen-Akte */
function HealthBox({ m, g }: { m: MachineView; g?: MachineGuard }) {
  const p = m.prediction;
  const f = g?.findings[0];
  const rec = f?.actions.find((a) => a.recommended);
  return (
    <Link href={`/waechter?tab=akte&m=${m.id}`} className="ai-border block rounded-xl bg-panel p-3 transition-colors hover:bg-panel-2">
      <div className="mb-1 flex items-center gap-1.5">
        <ShieldCheck size={13} className="text-accent" />
        <span className="text-[12px] font-semibold">Maschinengesundheit · KI-Wächter</span>
        <Badge sev={p.zone === "D" ? "crit" : p.zone === "C" ? "warn" : "ok"} className="ml-auto">
          ISO {p.zone}
        </Badge>
      </div>
      <div className="flex items-center gap-3">
        <Gauge value={p.p72} size={96} thickness={9} label={fmtPct(p.p72, 0)} sub="Ausfall 72 h" />
        <div className="min-w-0 flex-1 space-y-1 text-[11.5px]">
          <div className="flex justify-between">
            <span className="text-muted">Zustand</span>
            <span className="num font-semibold">{g?.health ?? p.health}/100</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Restlaufzeit</span>
            <span className="num font-semibold">{p.rulH === null ? "> 30 Tage" : fmtDuration(p.rulH)}</span>
          </div>
          {g && (
            <div className="flex gap-1 pt-1">
              {DIMS.map(([k, l]) => (
                <span key={k} title={l} className={cn("h-2 flex-1 rounded-full", DIM_BG[g.dims[k]])} />
              ))}
            </div>
          )}
        </div>
      </div>
      {f ? (
        <div className="mt-2 border-t border-line pt-2">
          <div className="text-[12px] font-semibold leading-snug">{f.title}</div>
          <div className="mt-0.5 line-clamp-2 text-[11px] text-muted">{f.cause}</div>
          <div className="mt-1 text-[11px]">
            Drohend <span className="num font-semibold text-crit">{fmtEur(f.lossEur72)}</span>
            {rec && <span className="text-ok"> → {rec.label}</span>}
          </div>
          {g && g.findings.length > 1 && <div className="mt-0.5 text-[10.5px] text-muted">+ {g.findings.length - 1} weitere Befunde</div>}
        </div>
      ) : g ? (
        <div className="mt-2 border-t border-line pt-2 text-[11.5px] text-ink-2">Keine Befunde – alle Prüfpunkte im Normalbereich.</div>
      ) : null}
      <Legend
        className="mt-2"
        items={[
          { color: "var(--ok)", label: "grün: im Soll" },
          { color: "var(--warn)", label: "gelb: Frühwarnung" },
          { color: "var(--crit)", label: "rot: kritisch" },
        ]}
        note="Bogen = Ausfallrisiko 72 h · 6 Punkte = Mechanik, Qualität, Leistung, Kurzstopps, Energie, Termin"
      />
      <div className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-accent">
        Maschinen-Akte öffnen <ArrowUpRight size={12} />
      </div>
    </Link>
  );
}

export function useMachineDetail(id: string | null, interval = 2000) {
  const [data, setData] = useState<{ live: SensorSample[]; hist: SensorSample[]; day?: MachineDayDetail; guard?: MachineGuard } | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/machine?id=${id}`, { cache: "no-store" });
        if (r.ok && alive) setData(await r.json());
      } catch {}
    };
    load();
    const t = setInterval(load, interval);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, interval]);
  return data;
}

export default function MachinePanel({ id }: { id: string }) {
  const m = useUi((s) => s.snap?.machines.find((x) => x.id === id));
  const select = useUi((s) => s.selectMachine);
  const openCopilot = useUi((s) => s.openCopilot);
  const detail = useMachineDetail(id);
  // Rollout-Demo: Anbindung wieder trennen (mit Rückfrage) – danach zeigt der Leitstand das Rollout-Panel
  const [confirmCut, setConfirmCut] = useState(false);
  const [cutting, setCutting] = useState(false);
  const cut = async () => {
    setCutting(true);
    await control("disconnect", { machine: id });
    await refreshSnapshot();
    setCutting(false);
    setConfirmCut(false);
  };
  if (!m) return null;
  const defs = SENSOR_DEFS[m.type].filter((d) => ["vib", "oil", "temp1", "cycle"].includes(d.key));
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <BackButton onClick={() => select(null)} label="Zurück zur Übersicht" />
          <div className="flex items-center gap-2">
            <span className="num text-[17px] font-bold">{m.id}</span>
            <StatusPill status={m.status} />
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted">
            {m.maker} {m.model} · Bj. {m.year} · {m.cavities}-fach · Halle {m.hall}
          </div>
        </div>
        <button onClick={() => select(null)} className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-ink" aria-label="Schließen">
          <X size={16} />
        </button>
      </div>
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-4 py-3.5">
        {m.connectedAt && (
          <div className="rounded-lg border border-ok/30 bg-ok-soft px-3 py-2 text-[11.5px] text-ink-2">
            <div className="flex items-start gap-2">
              <PlugZap size={14} className="mt-px shrink-0 text-ok" />
              <span>
                <span className="font-semibold text-ink">Neu angebunden um {fmtTime(m.connectedAt)}</span> – Daten liegen erst ab da vor. Die KI-Prognose baut ihre Basis gerade auf und wird mit jeder Stunde genauer.
              </span>
            </div>
            {confirmCut ? (
              <div className="mt-2 flex items-center gap-1.5">
                <span className="mr-auto text-[11px] font-semibold text-ink">Datenanschluss trennen?</span>
                <Button size="sm" variant="danger" onClick={cut} disabled={cutting}>
                  {cutting ? <Loader2 size={13} className="animate-spin" /> : <Unplug size={13} />} Trennen
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmCut(false)} disabled={cutting}>
                  Abbrechen
                </Button>
              </div>
            ) : (
              <button onClick={() => setConfirmCut(true)} className="-ml-1.5 mt-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-muted hover:bg-panel hover:text-crit" title="Maschine produziert weiter, liefert aber keine Daten mehr an die KI">
                <Unplug size={12} /> Anbindung trennen (Demo)
              </button>
            )}
          </div>
        )}
        {m.statusReason && <div className="rounded-lg bg-panel-2 px-3 py-2 text-[12px] text-ink-2">{m.statusReason}</div>}
        <HealthBox m={m} g={detail?.guard} />
        <div>
          <div className="label mb-1">Produkt & Auftrag</div>
          <div className="text-[13px] font-semibold">{PRODUCT[m.product.id]?.name}</div>
          {m.orderId && (
            <div className="mt-1.5">
              <div className="flex justify-between text-[11.5px] text-muted">
                <span className="num">{m.orderId}</span>
                <span className="num">{fmtPct(m.orderProgress ?? 0, 0)}</span>
              </div>
              <Progress value={m.orderProgress ?? 0} className="mt-1" />
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["OEE heute", fmtPct(m.oee)],
            ["Stück / h", fmtInt(m.outputPerHour)],
            ["Ausschuss", fmtPct(m.scrapRate, 2)],
          ].map(([l, v]) => (
            <div key={l} className="rounded-lg bg-panel-2 px-2.5 py-2">
              <div className="label text-[9px]">{l}</div>
              <div className="num text-[14px] font-semibold">{v}</div>
            </div>
          ))}
        </div>
        {detail?.day && (
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="label">Produktion heute · 15-min-Raster</span>
              <span className="num text-[11px] text-ink-2">
                {fmtInt(detail.day.totals.good)} / {fmtInt(detail.day.totals.target)} Stk
              </span>
            </div>
            <ProductionBars buckets={detail.day.buckets} dayStart={detail.day.day} now={detail.day.now} height={70} noDataBefore={detail.day.connectedAt} />
            <BarsLegend compact className="mt-1.5" />
            <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
              <div className="rounded-lg bg-panel-2 px-2 py-1.5">
                <div className="label text-[8.5px]">Stillstand</div>
                <div className="num font-semibold">{fmtNum(detail.day.totals.stoerH + detail.day.totals.ruestH, 1)} h</div>
              </div>
              <div className="rounded-lg bg-panel-2 px-2 py-1.5">
                <div className="label text-[8.5px]">Verlust</div>
                <div className="num font-semibold text-crit">{fmtEur(detail.day.totals.lossEur)}</div>
              </div>
              <div className="rounded-lg bg-panel-2 px-2 py-1.5">
                <div className="label text-[8.5px]">Temp. max</div>
                <div className="num font-semibold">{fmtNum(detail.day.totals.temp1Max, 1)} °C</div>
              </div>
            </div>
            {detail.day.stops[0] && (
              <div className="mt-1.5 truncate text-[11px] text-muted" title={detail.day.stops[0].reason}>
                Letzter Stillstand: {detail.day.stops[0].reason} ({Math.round(detail.day.stops[0].durMin)} min)
              </div>
            )}
          </div>
        )}
        <div>
          <div className="label mb-1.5">Live-Sensorik (OPC UA)</div>
          <div className="space-y-2">
            {defs.map((d) => {
              const series = detail?.live.slice(-60).map((s) => s[d.key]).filter((v) => v > 0) ?? (d.key === "vib" ? m.spark : []);
              const v = m.current[d.key];
              const bad = d.key === "vib" ? v >= d.warn : false;
              return (
                <div key={d.key} className="grid grid-cols-[minmax(0,1fr)_92px_70px] items-center gap-2">
                  <div className="truncate text-[11.5px] text-ink-2">{d.short}</div>
                  <Sparkline data={series} width={92} height={22} color={bad ? "var(--warn)" : "var(--accent)"} />
                  <div className="num text-right text-[12px] font-semibold">
                    {v > 0 ? fmtNum(v, d.digits) : "–"} <span className="text-[10px] font-normal text-muted">{d.unit}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <Legend
            className="mt-2"
            items={[
              { color: "var(--accent)", kind: "line", label: "blaue Linie: Messwert der letzten 60 s" },
              { color: "var(--warn)", kind: "line", label: "gelb: über Warngrenze" },
            ]}
            note="Zahl rechts = aktueller Wert"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
        <Link href={`/produktion?m=${m.id}`} className="contents">
          <Button size="sm" className="w-full">
            Tagesverlauf <ArrowUpRight size={13} />
          </Button>
        </Link>
        <Button size="sm" variant="ai" className="w-full" onClick={() => openCopilot(`Wie ist der Zustand von ${m.id} und was empfiehlst du?`)}>
          <Sparkles size={13} /> Frag die KI
        </Button>
      </div>
    </div>
  );
}

export { sevForRisk };
