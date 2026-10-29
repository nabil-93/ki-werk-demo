"use client";

import { memo } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { SpcPoint } from "@/lib/sim/types";
import { fmtNum, fmtTime } from "@/lib/ai/format";
import { ChartTip, Legend, axisTick, gridProps } from "@/components/ui/chartkit";

function SpcChart({ points, spec }: { points: SpcPoint[]; spec: { label: string; unit: string; nominal: number; tol: number } }) {
  const sigma = spec.tol / 4.6;
  const ucl = spec.nominal + 3 * sigma;
  const lcl = spec.nominal - 3 * sigma;
  const usl = spec.nominal + spec.tol;
  const lsl = spec.nominal - spec.tol;
  const data = points.map((p) => ({ t: p.t, v: Number(p.value.toFixed(4)), viol: p.violation ? Number(p.value.toFixed(4)) : null }));
  const lo = Math.min(lsl, ...data.map((d) => d.v)) - spec.tol * 0.15;
  const hi = Math.max(usl, ...data.map((d) => d.v)) + spec.tol * 0.15;
  const d = spec.unit === "g" || spec.unit === "mm" ? (spec.tol < 0.1 ? 3 : 2) : 2;
  return (
    <div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 10, right: 52, left: -8, bottom: 0 }}>
          <ReferenceArea y1={lcl} y2={ucl} fill="var(--ok)" fillOpacity={0.05} />
          <ReferenceArea y1={usl} y2={hi} fill="var(--crit)" fillOpacity={0.06} />
          <ReferenceArea y1={lo} y2={lsl} fill="var(--crit)" fillOpacity={0.06} />
          <CartesianGrid {...gridProps} />
          <ReferenceLine y={spec.nominal} stroke="var(--ink-2)" strokeOpacity={0.5} label={{ value: "Soll", position: "right", fontSize: 10, fill: "var(--muted)" }} />
          <ReferenceLine y={ucl} stroke="var(--warn)" strokeDasharray="4 3" label={{ value: "OEG", position: "right", fontSize: 10, fill: "var(--warn)" }} />
          <ReferenceLine y={lcl} stroke="var(--warn)" strokeDasharray="4 3" label={{ value: "UEG", position: "right", fontSize: 10, fill: "var(--warn)" }} />
          <ReferenceLine y={usl} stroke="var(--crit)" label={{ value: "OTG", position: "right", fontSize: 10, fill: "var(--crit)" }} />
          <ReferenceLine y={lsl} stroke="var(--crit)" label={{ value: "UTG", position: "right", fontSize: 10, fill: "var(--crit)" }} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => fmtTime(t)} tick={axisTick} axisLine={false} tickLine={false} minTickGap={40} />
          <YAxis domain={[lo, hi]} tick={axisTick} tickFormatter={(v) => fmtNum(v, d)} axisLine={false} tickLine={false} width={52} />
          <Tooltip content={<ChartTip labelFormat={(l) => fmtTime(Number(l))} valueFormat={(v) => `${fmtNum(v, d + 1)} ${spec.unit}`} />} />
          <Line dataKey="v" name={spec.label} stroke="var(--accent)" strokeWidth={1.6} dot={{ r: 2.2, fill: "var(--accent)", strokeWidth: 0 }} isAnimationActive={false} />
          <Scatter dataKey="viol" name="Regelverletzung" fill="var(--crit)" shape="circle" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <Legend
        className="mt-1"
        items={[
          { color: "var(--accent)", kind: "line", label: "blaue Punkte: Stichprobenmittel (n = 5)" },
          { color: "var(--crit)", kind: "dot", label: "roter Punkt: SPC-Regel verletzt" },
          { color: "var(--ink-2)", kind: "line", label: "graue Linie: Sollwert" },
          { color: "var(--warn)", kind: "dash", label: "OEG/UEG: Eingriffsgrenzen ±3σ" },
          { color: "var(--crit)", kind: "line", label: "OTG/UTG: Toleranzgrenzen (rot hinterlegt = Ausschuss)" },
          { color: "var(--ok)", label: "grün hinterlegt: Prozess beherrscht" },
        ]}
      />
    </div>
  );
}

export default memo(SpcChart);
