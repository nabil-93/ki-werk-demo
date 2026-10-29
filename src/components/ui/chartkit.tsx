"use client";

// Gemeinsames Styling für Recharts-Diagramme

import { Info } from "lucide-react";
import { cn } from "@/lib/client/cn";

export type LegendItem = { label: string; color: string; kind?: "box" | "line" | "dash" | "dot" | "area" | "ring" };

function Swatch({ color, kind = "box" }: { color: string; kind?: LegendItem["kind"] }) {
  if (kind === "line") return <span className="h-[2.5px] w-4 shrink-0 rounded-full" style={{ background: color }} />;
  if (kind === "dash") return <span className="w-4 shrink-0 border-t-2 border-dashed" style={{ borderColor: color }} />;
  if (kind === "dot") return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
  if (kind === "ring") return <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2" style={{ borderColor: color }} />;
  if (kind === "area") return <span className="h-2.5 w-4 shrink-0 rounded-[3px] border" style={{ background: `color-mix(in srgb, ${color} 30%, transparent)`, borderColor: color }} />;
  return <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />;
}

/** Legende: erklärt jede Farbe, Linie und Markierung eines Diagramms */
export function Legend({ items, note, className }: { items: LegendItem[]; note?: string; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[10.5px] leading-tight text-muted", className)}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <Swatch color={it.color} kind={it.kind} />
          {it.label}
        </span>
      ))}
      {note && (
        <span className="flex items-center gap-1 text-faint">
          <Info size={11} className="shrink-0" />
          {note}
        </span>
      )}
    </div>
  );
}

export const axisTick = { fontSize: 10.5, fill: "var(--muted)", fontFamily: "var(--font-jetbrains)" };
export const gridProps = { stroke: "var(--line-2)", strokeDasharray: "3 4", vertical: false } as const;

interface TipPayload {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export function ChartTip({
  active,
  payload,
  label,
  labelFormat,
  valueFormat,
}: {
  active?: boolean;
  payload?: TipPayload[];
  label?: string | number;
  labelFormat?: (l: string | number) => string;
  valueFormat?: (v: number, key?: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass rounded-lg px-3 py-2 text-[11.5px]">
      {label !== undefined && <div className="num mb-1 text-[10.5px] text-muted">{labelFormat ? labelFormat(label) : label}</div>}
      {payload
        .filter((p) => p.value !== undefined && p.value !== null && !Number.isNaN(Number(p.value)))
        .map((p) => (
          <div key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            <span className="text-ink-2">{p.name}</span>
            <span className="num ml-auto pl-3 font-semibold">{valueFormat ? valueFormat(Number(p.value), String(p.dataKey)) : p.value}</span>
          </div>
        ))}
    </div>
  );
}
