"use client";

// BDE-Diagramme: Produktion im 15-Minuten-Raster (Säulen, rot bei Einbruch) und Temperaturverlauf des Tages

import { useId, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BucketView } from "@/lib/sim/types";
import { fmtEur, fmtInt, fmtNum, fmtPct, fmtTime } from "@/lib/ai/format";
import { ChartTip, Legend, axisTick, gridProps, type LegendItem } from "@/components/ui/chartkit";
import { Tabs } from "@/components/ui/ui";
import { cn } from "@/lib/client/cn";

const SEV_COLOR: Record<BucketView["sev"], string> = { ok: "var(--ok)", warn: "var(--warn)", crit: "var(--crit)", idle: "var(--faint)" };
const MIN = 60_000;

/**
 * Ist/Soll je Intervall: grün ≥ 88 %, gelb ≥ 72 %, rot darunter; grau = nicht geplant.
 * `noDataBefore`: Maschine erst seit diesem Zeitpunkt angebunden – frühere Intervalle schraffiert („keine Daten“).
 */
export function ProductionBars({ buckets, dayStart, now, height = 150, slotMin = 15, compact = false, noDataBefore }: { buckets: BucketView[]; dayStart: number; now: number; height?: number; slotMin?: number; compact?: boolean; noDataBefore?: number }) {
  const slots = Math.round((24 * 60) / slotMin);
  const hatch = `nodata-${useId().replace(/:/g, "")}`;
  const blindIdx = noDataBefore ? (noDataBefore - dayStart) / (slotMin * MIN) : -1;
  const byIdx = useMemo(() => new Map(buckets.map((b) => [Math.round((b.t - dayStart) / (slotMin * MIN)), b])), [buckets, dayStart, slotMin]);
  const [hover, setHover] = useState<number | null>(null);
  const W = slots * 6;
  const top = 4;
  const plotH = height - top - 2;
  const maxR = 1.15;
  const y = (r: number) => top + plotH * (1 - Math.min(maxR, Math.max(0, r)) / maxR);
  const nowIdx = (now - dayStart) / (slotMin * MIN);
  const hb = hover !== null ? byIdx.get(hover) : undefined;
  return (
    <div className="relative select-none" onMouseLeave={() => setHover(null)}>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          className="block w-full"
          style={{ height }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.floor(((e.clientX - r.left) / r.width) * slots);
            setHover(i >= 0 && i < slots ? i : null);
          }}
        >
          {blindIdx > 0 && (
            <>
              <defs>
                <pattern id={hatch} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width={2} height={6} fill="var(--faint)" opacity={0.35} />
                </pattern>
              </defs>
              <rect x={0} y={top} width={Math.min(slots, blindIdx) * 6} height={plotH} fill={`url(#${hatch})`} />
            </>
          )}
          <rect x={0} y={y(1)} width={W} height={y(0.88) - y(1)} fill="var(--ok)" opacity={0.06} />
          <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="var(--ink-2)" strokeOpacity={0.45} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
          <line x1={0} x2={W} y1={y(0.5)} y2={y(0.5)} stroke="var(--line)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
          {Array.from({ length: slots }, (_, i) => {
            const b = byIdx.get(i);
            const x = i * 6 + 0.7;
            if (!b) return i + 1 <= blindIdx ? null : <rect key={i} x={x} y={y(1)} width={4.6} height={y(0) - y(1)} fill="var(--panel-3)" opacity={i > nowIdx ? 0.55 : 0.25} rx={1} />;
            const r = b.sev === "idle" ? 0.035 : b.ratio;
            const dim = hover !== null && hover !== i;
            return (
              <g key={i}>
                {/* Stillstand im Intervall: rot hinterlegt, damit auch Säulen nahe null auffallen */}
                {b.sev === "crit" && <rect x={i * 6} y={y(1)} width={6} height={y(0) - y(1)} fill="var(--crit)" opacity={0.1} />}
                <rect x={x} y={y(r)} width={4.6} height={Math.max(1.2, y(0) - y(r))} fill={SEV_COLOR[b.sev]} opacity={dim ? 0.45 : b.open ? 0.6 : 1} rx={1} />
              </g>
            );
          })}
          {nowIdx > 0 && nowIdx < slots && <line x1={nowIdx * 6} x2={nowIdx * 6} y1={0} y2={height} stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
          {hover !== null && <rect x={hover * 6} y={0} width={6} height={height} fill="var(--ink)" opacity={0.06} />}
        </svg>
        <div className="pointer-events-none absolute right-1 text-[9.5px] font-semibold text-ink-2" style={{ top: y(1) - 12 }}>
          Soll 100 %
        </div>
      </div>
      {!compact && (
        <div className="num relative mt-1 h-3 text-[9.5px] text-faint">
          {Array.from({ length: 9 }, (_, k) => (
            <span key={k} className="absolute -translate-x-1/2" style={{ left: `${(k / 8) * 100}%` }}>
              {fmtTime(dayStart + k * 3 * 3_600_000)}
            </span>
          ))}
        </div>
      )}
      {hover !== null && (
        <div className="glass pointer-events-none absolute z-20 w-[220px] rounded-lg px-3 py-2 text-[11px]" style={{ left: `clamp(0px, calc(${((hover + 0.5) / slots) * 100}% - 110px), calc(100% - 220px))`, bottom: height + (compact ? 6 : 20) }}>
          <div className="num mb-1 text-[10.5px] text-muted">
            {fmtTime(dayStart + hover * slotMin * MIN)}–{fmtTime(dayStart + (hover + 1) * slotMin * MIN)}
            {hb?.open ? " · läuft" : ""}
          </div>
          {hb ? (
            <>
              <div className="flex justify-between">
                <span className="text-ink-2">Gutteile</span>
                <span className="num font-semibold">{fmtInt(hb.good)} Stk</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-2">Soll</span>
                <span className="num">{fmtInt(hb.target)} Stk</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-2">Ist/Soll</span>
                <span className={cn("num font-semibold", hb.sev === "crit" ? "text-crit" : hb.sev === "warn" ? "text-warn" : "text-ok")}>{hb.sev === "idle" ? "nicht geplant" : fmtPct(hb.ratio, 0)}</span>
              </div>
              {hb.stopMin > 0.2 && (
                <div className="flex justify-between">
                  <span className="text-ink-2">Stillstand</span>
                  <span className="num">{fmtNum(hb.stopMin, 0)} min</span>
                </div>
              )}
              {hb.scrap > 0 && (
                <div className="flex justify-between">
                  <span className="text-ink-2">Ausschuss</span>
                  <span className="num">{fmtInt(hb.scrap)} Stk</span>
                </div>
              )}
              {hb.temp1 !== null && (
                <div className="flex justify-between">
                  <span className="text-ink-2">Temp. Ø / max</span>
                  <span className="num">
                    {fmtNum(hb.temp1, 1)} / {fmtNum(hb.temp1Max ?? hb.temp1, 1)} °C
                  </span>
                </div>
              )}
              {hb.lossEur > 1 && (
                <div className="flex justify-between">
                  <span className="text-ink-2">Verlust</span>
                  <span className="num text-crit">{fmtEur(hb.lossEur)}</span>
                </div>
              )}
              {hb.reason && hb.sev !== "ok" && <div className="mt-1 border-t border-line pt-1 text-[10.5px] text-ink-2">{hb.reason}</div>}
            </>
          ) : (
            <div className="text-muted">{dayStart + hover * slotMin * MIN > now ? "noch nicht erreicht" : noDataBefore && dayStart + hover * slotMin * MIN < noDataBefore ? `keine Daten – Maschine erst seit ${fmtTime(noDataBefore)} angebunden` : "keine Daten"}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Erklärt Farben und Linien der 15-Minuten-Säulen */
export function BarsLegend({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <Legend
      className={className}
      items={[
        { color: "var(--ok)", label: "Säule grün: ≥ 88 % vom Soll" },
        { color: "var(--warn)", label: "gelb: 72–88 % (langsamer Zyklus, kurzer Stopp)" },
        { color: "var(--crit)", label: "rot: < 72 % = Einbruch / Stillstand (rot hinterlegt)" },
        { color: "var(--faint)", label: "grau: nicht geplant (kein Auftrag, Wartung)" },
        ...(compact
          ? []
          : ([
              { color: "var(--ink-2)", kind: "dash", label: "gestrichelt: Soll = 100 %" },
              { color: "var(--accent)", kind: "line", label: "blaue Linie: jetzt" },
              { color: "var(--panel-3)", label: "hell: Zeit noch nicht erreicht" },
            ] as LegendItem[])),
      ]}
      note={compact ? undefined : "Höhe der Säule = Gutteile im Verhältnis zum Soll des Intervalls"}
    />
  );
}

type SensorMeta = { label: string; short: string; unit: string; nominal: number; warn: number; crit: number };

/** Temperaturen des Tages (15-Minuten-Mittel und -Maximum) mit Warn- und Alarmgrenze */
export function TempChart({ buckets, dayStart, sensors, height = 190 }: { buckets: BucketView[]; dayStart: number; sensors: { temp1: SensorMeta; temp2: SensorMeta; oil: SensorMeta }; height?: number }) {
  const [key, setKey] = useState<"temp1" | "temp2" | "oil">("temp1");
  const s = sensors[key];
  const data = buckets.map((b) => ({ t: b.t, avg: b[key] !== null ? Number((b[key] as number).toFixed(1)) : null, max: key === "temp1" && b.temp1Max !== null ? Number(b.temp1Max.toFixed(1)) : null }));
  const vals = data.flatMap((d) => [d.avg, d.max]).filter((v): v is number => v !== null);
  const lo = Math.min(s.nominal - 4, ...vals);
  const hi = Math.max(s.crit + 1, ...vals);
  const peak = data.reduce((a, d) => ((d.max ?? d.avg ?? -1) > (a.max ?? a.avg ?? -1) ? d : a), data[0] ?? { t: 0, avg: null, max: null });
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Tabs
          size="sm"
          value={key}
          onChange={setKey}
          items={[
            { value: "temp1", label: sensors.temp1.short },
            { value: "temp2", label: sensors.temp2.short },
            { value: "oil", label: sensors.oil.short },
          ]}
        />
        {peak && (peak.max ?? peak.avg) !== null && (
          <span className="num text-[11px] text-muted">
            Höchstwert heute <b className={cn((peak.max ?? peak.avg)! >= s.warn ? "text-warn" : "text-ink")}>{fmtNum((peak.max ?? peak.avg)!, 1)} °C</b> um {fmtTime(peak.t)}
          </span>
        )}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, left: -6, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="t" type="number" domain={[dayStart, dayStart + 24 * 3_600_000]} ticks={Array.from({ length: 9 }, (_, k) => dayStart + k * 3 * 3_600_000)} tickFormatter={(t) => fmtTime(t)} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis domain={[Math.floor(lo - 1), Math.ceil(hi + 1)]} tick={axisTick} tickFormatter={(v) => `${v}°`} axisLine={false} tickLine={false} width={42} />
            <Tooltip content={<ChartTip labelFormat={(l) => `${fmtTime(Number(l))} Uhr`} valueFormat={(v) => `${fmtNum(v, 1)} °C`} />} />
            <ReferenceLine y={s.warn} stroke="var(--warn)" strokeDasharray="4 4" label={{ value: `Warnung ${s.warn} °C`, position: "insideTopRight", fontSize: 10, fill: "var(--warn)" }} />
            <ReferenceLine y={s.crit} stroke="var(--crit)" strokeDasharray="4 4" label={{ value: `Alarm ${s.crit} °C`, position: "insideTopRight", fontSize: 10, fill: "var(--crit)" }} />
            <Line dataKey="avg" name={`${s.short} Ø`} stroke="var(--accent)" strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls />
            {key === "temp1" && <Line dataKey="max" name={`${s.short} max`} stroke="var(--crit)" strokeOpacity={0.55} strokeWidth={1.2} strokeDasharray="3 3" dot={false} isAnimationActive={false} connectNulls />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legend
        className="mt-1.5"
        items={[
          { color: "var(--accent)", kind: "line", label: `blaue Linie: ${s.short} Mittelwert je 15 min` },
          ...(key === "temp1" ? [{ color: "var(--crit)", kind: "dash" as const, label: "rot gestrichelt (dünn): Höchstwert im Intervall" }] : []),
          { color: "var(--warn)", kind: "dash", label: `gelb gestrichelt: Warngrenze ${s.warn} °C` },
          { color: "var(--crit)", kind: "dash", label: `rot gestrichelt: Alarmgrenze ${s.crit} °C` },
        ]}
        note={`${s.label} · Sollwert ${s.nominal} ${s.unit} · Einbrüche = Maschine stand (kühlt ab)`}
      />
    </div>
  );
}
