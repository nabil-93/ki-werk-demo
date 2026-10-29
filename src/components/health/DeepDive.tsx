"use client";

// Analyse im Detail für die Maschinen-Akte: Schwingungsverlauf mit KI-Trendprojektion, „Warum?“ (lokale Erklärung
// des Wartungsmodells), SPC-Karte und Model Card. Früher eigene Seite „Predictive Maintenance“ – jetzt Teil der
// Rubrik Maschinengesundheit, damit jede Zahl nur an einer Stelle steht.

import { memo, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Area, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { BrainCircuit } from "lucide-react";
import type { MaintenanceOption } from "@/lib/sim/analysis";
import type { MachineGuard } from "@/lib/sim/guardian";
import type { ModelCard } from "@/lib/sim/ml";
import type { OrderView, SensorSample, SpcPoint } from "@/lib/sim/types";
import { fmtDateTime, fmtInt, fmtNum, fmtPct, fmtTime } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { linSlope } from "@/lib/sim/rng";
import { Panel, Progress } from "@/components/ui/ui";
import { ChartTip, Legend, axisTick, gridProps } from "@/components/ui/chartkit";

export interface MachineData {
  live: SensorSample[];
  hist: SensorSample[];
  spc: SpcPoint[];
  spcSpec: { label: string; unit: string; nominal: number; tol: number };
  maintenance: { options: MaintenanceOption[]; planned: { costEur: number; durationH: number }; unplanned: { costEur: number; durationH: number } };
  contributions: { key: string; label: string; c: number }[];
  queue: OrderView[];
  lastMaintenance: number;
  failureCount: number;
  now: number;
  guard?: MachineGuard;
}

/** Maschinendaten für die Akte (Verlauf, Erklärung, SPC) – alle 2,5 s aktualisiert */
export function useMachineData(id: string | undefined) {
  const [d, setD] = useState<MachineData | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setD(null);
    const load = async () => {
      try {
        const r = await fetch(`/api/machine?id=${id}`, { cache: "no-store" });
        if (r.ok && alive) setD(await r.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);
  return d;
}

export function useModelCard() {
  const [m, setM] = useState<ModelCard | null>(null);
  useEffect(() => {
    fetch("/api/model")
      .then((r) => r.json())
      .then((d) => setM(d.card))
      .catch(() => {});
  }, []);
  return m;
}

export const VibrationChart = memo(function VibrationChart({ d }: { d: MachineData }) {
  const data = useMemo(() => {
    const pts = d.hist.slice(-200).map((s) => ({ t: s.t, vib: Number(s.vib.toFixed(3)) as number | null, fc: null as number | null }));
    // Trendprojektion bis zur Schadensgrenze (lineare Regression der letzten 3 h)
    const recent = d.hist.filter((s) => s.t > d.lastMaintenance).slice(-36);
    const slope = linSlope(recent.map((s) => s.vib), 5 / 60);
    const last = pts[pts.length - 1];
    if (last && slope > 0.02) {
      last.fc = last.vib;
      let v = last.vib ?? 0;
      let t = last.t;
      for (let i = 0; i < 160 && v < 5.0; i++) {
        t += 15 * 60_000;
        v += slope * 0.25;
        pts.push({ t, vib: null, fc: Number(v.toFixed(3)) });
      }
    }
    return { pts, slope };
  }, [d]);
  const crossing = data.pts.find((p) => p.fc !== null && p.fc >= 4.5);
  const max = Math.max(5.2, ...data.pts.map((p) => p.vib ?? p.fc ?? 0));
  return (
    <div>
      <div className="h-[210px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.pts} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="vibg" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <ReferenceArea y1={0} y2={1.4} fill="var(--ok)" fillOpacity={0.06} />
            <ReferenceArea y1={1.4} y2={2.8} fill="var(--ok)" fillOpacity={0.03} />
            <ReferenceArea y1={2.8} y2={4.5} fill="var(--warn)" fillOpacity={0.07} />
            <ReferenceArea y1={4.5} y2={max} fill="var(--crit)" fillOpacity={0.08} />
            <ReferenceLine y={4.5} stroke="var(--crit)" strokeDasharray="4 4" label={{ value: "Schadensgrenze 4,5 mm/s (ISO 10816 C/D)", position: "insideTopLeft", fontSize: 10, fill: "var(--crit)" }} />
            <ReferenceLine y={2.8} stroke="var(--warn)" strokeDasharray="2 4" label={{ value: "Zone C", position: "insideTopLeft", fontSize: 10, fill: "var(--warn)" }} />
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => fmtTime(t)} tick={axisTick} axisLine={false} tickLine={false} minTickGap={40} />
            <YAxis domain={[0, Math.ceil(max)]} tick={axisTick} axisLine={false} tickLine={false} width={44} />
            <Tooltip content={<ChartTip labelFormat={(l) => fmtDateTime(Number(l))} valueFormat={(v) => `${fmtNum(v, 2)} mm/s`} />} />
            <Area type="monotone" dataKey="vib" name="Schwingung" stroke="var(--accent)" strokeWidth={1.8} fill="url(#vibg)" isAnimationActive={false} connectNulls={false} />
            <Line type="linear" dataKey="fc" name="KI-Prognose" stroke="var(--crit)" strokeWidth={1.8} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            {crossing && <ReferenceLine x={crossing.t} stroke="var(--crit)" strokeOpacity={0.6} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend
        className="mt-1.5"
        items={[
          { color: "var(--accent)", kind: "area", label: "blau: gemessene Schwingung (5-min-Mittel)" },
          { color: "var(--crit)", kind: "dash", label: "rot gestrichelt: KI-Trend bis zur Schadensgrenze" },
          { color: "var(--ok)", label: "grün: Zone A/B" },
          { color: "var(--warn)", label: "gelb: Zone C" },
          { color: "var(--crit)", label: "rot: Zone D (Schaden)" },
        ]}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
        <span>
          Trend: <b className="num text-ink">{data.slope >= 0 ? "+" : ""}{fmtNum(data.slope, 3)} mm/s pro h</b>
        </span>
        {crossing ? (
          <span className="text-crit">
            Prognose: Schadensgrenze erreicht <b className="num">{fmtDateTime(crossing.t)}</b>
          </span>
        ) : (
          <span>Kein steigender Trend – Grenzwert in absehbarer Zeit nicht erreicht.</span>
        )}
      </div>
    </div>
  );
});

/** „Warum?“ – Beitrag jedes Merkmals zur aktuellen Bewertung des Wartungsmodells */
export const Contributions = memo(function Contributions({ items }: { items: MachineData["contributions"] }) {
  const max = Math.max(0.5, ...items.map((i) => Math.abs(i.c)));
  const sorted = [...items].sort((a, b) => b.c - a.c);
  return (
    <div className="space-y-1.5">
      {sorted.map((i) => {
        const w = (Math.abs(i.c) / max) * 50;
        return (
          <div key={i.key} className="grid grid-cols-[150px_minmax(0,1fr)_44px] items-center gap-2">
            <div className="truncate text-[11.5px] text-ink-2">{i.label}</div>
            <div className="relative h-4">
              <div className="absolute left-1/2 top-0 h-4 w-px bg-line" />
              <motion.div
                className="absolute top-0.5 h-3 rounded-sm"
                style={{ background: i.c > 0 ? "var(--crit)" : "var(--ok)", opacity: 0.85 }}
                initial={false}
                animate={{ left: i.c > 0 ? "50%" : `${50 - w}%`, width: `${w}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
              />
            </div>
            <div className={cn("num text-right text-[11px]", i.c > 0 ? "text-crit" : "text-ok")}>{i.c > 0 ? "+" : ""}{fmtNum(i.c, 2)}</div>
          </div>
        );
      })}
      <div className="flex justify-between pt-1 text-[10px] text-faint">
        <span>← senkt Risiko</span>
        <span>erhöht Risiko →</span>
      </div>
      <Legend
        items={[
          { color: "var(--crit)", label: "rot: Merkmal erhöht das Ausfallrisiko" },
          { color: "var(--ok)", label: "grün: senkt das Risiko" },
        ]}
        note="Länge = Stärke des Einflusses auf den Modellwert"
      />
    </div>
  );
});

/** SPC-Karte der letzten Stichproben: Mittellinie, Eingriffsgrenzen (±3σ), Toleranz, Regelverletzungen */
export const SpcMini = memo(function SpcMini({ d }: { d: MachineData }) {
  const s = d.spcSpec;
  const sigma = s.tol / 4.6;
  const data = d.spc.slice(-40).map((p) => ({ t: p.t, v: Number(p.value.toFixed(3)), bad: p.violation ? Number(p.value.toFixed(3)) : null }));
  const lo = s.nominal - s.tol * 1.25;
  const hi = s.nominal + s.tol * 1.25;
  return (
    <div>
      <div className="h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => fmtTime(t)} tick={axisTick} axisLine={false} tickLine={false} minTickGap={40} />
            <YAxis domain={[lo, hi]} tick={axisTick} axisLine={false} tickLine={false} width={46} tickFormatter={(v) => fmtNum(v, 2)} />
            <ReferenceArea y1={s.nominal - s.tol} y2={s.nominal + s.tol} fill="var(--ok)" fillOpacity={0.05} />
            <ReferenceLine y={s.nominal} stroke="var(--ink-2)" strokeOpacity={0.5} />
            <ReferenceLine y={s.nominal + 3 * sigma} stroke="var(--warn)" strokeDasharray="4 4" />
            <ReferenceLine y={s.nominal - 3 * sigma} stroke="var(--warn)" strokeDasharray="4 4" />
            <ReferenceLine y={s.nominal + s.tol} stroke="var(--crit)" strokeDasharray="2 3" />
            <ReferenceLine y={s.nominal - s.tol} stroke="var(--crit)" strokeDasharray="2 3" />
            <Tooltip content={<ChartTip labelFormat={(l) => fmtTime(Number(l))} valueFormat={(v) => `${fmtNum(v, 3)} ${s.unit}`} />} />
            <Line dataKey="v" name={s.label} stroke="var(--accent)" strokeWidth={1.6} dot={{ r: 1.6 }} isAnimationActive={false} />
            <Scatter dataKey="bad" name="Regelverletzung" fill="var(--crit)" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend
        className="mt-1"
        items={[
          { color: "var(--accent)", kind: "line", label: `blau: ${s.label} je Stichprobe (n=5)` },
          { color: "var(--warn)", kind: "dash", label: "gelb: Eingriffsgrenzen ±3σ" },
          { color: "var(--crit)", kind: "dash", label: "rot: Toleranz" },
          { color: "var(--crit)", kind: "dot", label: "roter Punkt: SPC-Regel verletzt" },
        ]}
      />
    </div>
  );
});

export const ModelCardPanel = memo(function ModelCardPanel({ card }: { card: ModelCard }) {
  const cm = card.confusion;
  const metrics = [
    ["Accuracy", card.metrics.accuracy],
    ["Precision", card.metrics.precision],
    ["Recall", card.metrics.recall],
    ["F1-Score", card.metrics.f1],
    ["ROC-AUC", card.metrics.auc],
  ] as const;
  return (
    <Panel title="Model Card · pm-lager-v1.3" subtitle="Transparenz: Wie gut ist das Wartungsmodell – und worauf achtet es?" icon={<BrainCircuit size={16} />}>
      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr_1fr]">
        <div>
          <div className="label mb-2">Steckbrief</div>
          <dl className="space-y-1.5 text-[12px]">
            {[
              ["Ziel", `Ausfall innerhalb ${card.horizonH} h (Spindellager)`],
              ["Algorithmus", card.algorithm],
              ["Trainingsdaten", `${fmtInt(card.nTrain)} Zeitfenster à 2 h (simulierte Run-to-Failure-Historien)`],
              ["Testdaten", `${fmtInt(card.nTest)} Zeitfenster (nicht im Training)`],
              ["Schwelle", `${fmtPct(card.threshold, 0)} Wahrscheinlichkeit`],
              ["Trainiert", fmtDateTime(Date.parse(card.trainedAt))],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[100px_1fr] gap-2">
                <dt className="text-muted">{k}</dt>
                <dd className="text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 grid grid-cols-5 gap-1.5">
            {metrics.map(([l, v]) => (
              <div key={l} className="rounded-lg bg-panel-2 px-1.5 py-2 text-center">
                <div className="num text-[14px] font-semibold">{fmtNum(v * 100, 0)}</div>
                <div className="text-[9.5px] text-muted">{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="label mb-2">Konfusionsmatrix (Testdaten)</div>
          <div className="grid grid-cols-[70px_1fr_1fr] gap-1.5 text-[11px]">
            <div />
            <div className="text-center text-muted">Prognose: Ausfall</div>
            <div className="text-center text-muted">Prognose: OK</div>
            <div className="flex items-center text-muted">Real: Ausfall</div>
            <div className="num rounded-lg bg-ok-soft py-3 text-center text-[16px] font-semibold text-ok">{cm.tp}<div className="text-[9.5px] font-normal">richtig erkannt</div></div>
            <div className="num rounded-lg bg-crit-soft py-3 text-center text-[16px] font-semibold text-crit">{cm.fn}<div className="text-[9.5px] font-normal">übersehen</div></div>
            <div className="flex items-center text-muted">Real: OK</div>
            <div className="num rounded-lg bg-warn-soft py-3 text-center text-[16px] font-semibold text-warn">{cm.fp}<div className="text-[9.5px] font-normal">Fehlalarm</div></div>
            <div className="num rounded-lg bg-panel-2 py-3 text-center text-[16px] font-semibold">{cm.tn}<div className="text-[9.5px] font-normal text-muted">richtig OK</div></div>
          </div>
          <div className="mt-3 h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={card.roc} margin={{ top: 4, right: 8, left: -26, bottom: 0 }}>
                <CartesianGrid {...gridProps} vertical />
                <XAxis dataKey="fpr" type="number" domain={[0, 1]} tick={axisTick} tickFormatter={(v) => fmtNum(v, 1)} axisLine={false} tickLine={false} />
                <YAxis dataKey="tpr" type="number" domain={[0, 1]} tick={axisTick} tickFormatter={(v) => fmtNum(v, 1)} axisLine={false} tickLine={false} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="var(--faint)" strokeDasharray="3 3" />
                <Line dataKey="tpr" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-center text-[10px] text-muted">ROC-Kurve · AUC {fmtNum(card.metrics.auc, 3)}</div>
          <Legend
            className="mt-1 justify-center"
            items={[
              { color: "var(--accent)", kind: "line", label: "blau: Trefferquote je Fehlalarmquote" },
              { color: "var(--faint)", kind: "dash", label: "Diagonale: Zufall" },
            ]}
            note="je näher oben links, desto besser"
          />
        </div>
        <div>
          <div className="label mb-2">Merkmalsgewichte (global)</div>
          <div className="space-y-2">
            {card.weights.map((w) => (
              <div key={w.key}>
                <div className="flex justify-between text-[11.5px]">
                  <span className="truncate text-ink-2">{w.label}</span>
                  <span className="num text-muted">{w.weight >= 0 ? "+" : ""}{fmtNum(w.weight, 2)}</span>
                </div>
                <Progress value={w.importance} height={4} sev={w.weight >= 0 ? "info" : "ok"} className="mt-1" />
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-lg bg-panel-2 p-2.5 text-[11px] leading-snug text-muted">
            <b className="text-ink-2">In Produktion:</b> Training auf echter Maschinen- und CMMS-Historie, Gradient Boosting + SHAP, Versionierung mit MLflow, monatliches Retraining und Feedback der Instandhaltung („Warnung war berechtigt?“).
          </div>
        </div>
      </div>
    </Panel>
  );
});
