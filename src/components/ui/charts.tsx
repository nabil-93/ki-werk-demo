"use client";

import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useId, useMemo, useState } from "react";
import { cn } from "@/lib/client/cn";

/** Animierte Zahl (zählt weich zum Zielwert) */
export function Ticker({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const mv = useMotionValue(value);
  const [text, setText] = useState(() => format(value));
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [value, mv]);
  useEffect(() => mv.on("change", (v) => setText(format(v))), [mv, format]);
  return <span className={cn("num", className)}>{text}</span>;
}

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "var(--accent)",
  fill = true,
  className,
  max,
  min,
  thresholds,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  className?: string;
  max?: number;
  min?: number;
  thresholds?: { value: number; color: string }[];
}) {
  const id = useId();
  const { d, area, lo, hi } = useMemo(() => {
    if (data.length < 2) return { d: "", area: "", lo: 0, hi: 1 };
    const lo = min ?? Math.min(...data);
    const hi = max ?? Math.max(...data);
    const span = hi - lo || 1;
    const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 2 - ((v - lo) / span) * (height - 4)]);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    return { d, area: `${d}L${width},${height}L0,${height}Z`, lo, hi };
  }, [data, width, height, max, min]);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("overflow-visible", className)} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {thresholds?.map((t) => {
        const y = height - 2 - ((t.value - lo) / (hi - lo || 1)) * (height - 4);
        if (y < 0 || y > height) return null;
        return <line key={t.value} x1={0} x2={width} y1={y} y2={y} stroke={t.color} strokeDasharray="2 3" strokeWidth={1} opacity={0.7} />;
      })}
      {fill && area && <path d={area} fill={`url(#g${id})`} />}
      {d && <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** Halbkreis-Messinstrument */
export function Gauge({ value, size = 120, label, sub, color, thickness = 10 }: { value: number; size?: number; label?: string; sub?: string; color?: string; thickness?: number }) {
  const r = (size - thickness) / 2;
  const c = Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const col = color ?? (v >= 0.75 ? "var(--crit)" : v >= 0.45 ? "var(--warn)" : "var(--ok)");
  return (
    <div className="relative" style={{ width: size, height: size / 2 + 18 }}>
      <svg width={size} height={size / 2 + thickness} viewBox={`0 0 ${size} ${size / 2 + thickness}`}>
        <path d={`M ${thickness / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - thickness / 2} ${size / 2}`} fill="none" stroke="var(--panel-3)" strokeWidth={thickness} strokeLinecap="round" />
        <motion.path
          d={`M ${thickness / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - thickness / 2} ${size / 2}`}
          fill="none"
          stroke={col}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ type: "spring", stiffness: 60, damping: 18 }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
        {label && <div className="num text-[22px] font-semibold leading-none text-ink">{label}</div>}
        {sub && <div className="mt-1 text-[10.5px] font-medium text-muted">{sub}</div>}
      </div>
    </div>
  );
}

/** Kreis-Fortschritt */
export function Ring({ value, size = 44, stroke = 4, color = "var(--accent)", children }: { value: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-3)" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(1, value))) }} transition={{ type: "spring", stiffness: 70, damping: 18 }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/** Horizontaler Balken mit Beschriftung (Pareto) */
export function BarRow({ label, value, max, color = "var(--accent)", right }: { label: string; value: number; max: number; color?: string; right?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <div className="truncate text-[12px] text-ink-2">{label}</div>
      <div className="num text-[11.5px] text-muted">{right ?? value}</div>
      <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-panel-3">
        <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} transition={{ type: "spring", stiffness: 90, damping: 20 }} />
      </div>
    </div>
  );
}

export function useMotionNumber(v: number) {
  const mv = useMotionValue(v);
  useEffect(() => {
    const c = animate(mv, v, { duration: 0.6 });
    return () => c.stop();
  }, [v, mv]);
  return useTransform(mv, (x) => x);
}
