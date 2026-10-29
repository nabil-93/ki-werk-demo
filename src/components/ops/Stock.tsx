"use client";

// Fertigwarenlager: Produktkarte mit Zeichnung, Paletten, freiem/reserviertem Bestand und Verlauf

import { MapPin } from "lucide-react";
import type { StockView } from "@/lib/sim/types";
import { fmtInt, fmtKEur, fmtNum, fmtTime } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { Badge } from "@/components/ui/ui";
import { Sparkline } from "@/components/ui/charts";
import { Legend } from "@/components/ui/chartkit";
import ProductArt from "./ProductArt";

export function StockLegend({ className }: { className?: string }) {
  return (
    <Legend
      className={className}
      items={[
        { color: "var(--ok)", label: "Balken grün: frei verfügbar (über Sicherheitsbestand)" },
        { color: "var(--warn)", label: "gelb: frei unter Sicherheitsbestand" },
        { color: "var(--crit)", label: "rot: unter halbem Sicherheitsbestand" },
        { color: "color-mix(in srgb, var(--accent) 70%, transparent)", label: "blau: für Aufträge reserviert" },
        { color: "var(--ink)", kind: "line", label: "schwarzer Strich: Sicherheitsbestand" },
        { color: "var(--accent)", kind: "line", label: "Kurve: Bestand der letzten 24 h" },
      ]}
    />
  );
}

export function StockBar({ s }: { s: StockView }) {
  const total = Math.max(s.pieces, s.minPallets * s.piecesPerPallet * 1.6, 1);
  const free = Math.max(0, s.free) / total, res = s.reserved / total, min = (s.minPallets * s.piecesPerPallet) / total;
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-panel-3">
      <div className={cn("absolute inset-y-0 left-0", s.state === "crit" ? "bg-crit" : s.state === "warn" ? "bg-warn" : "bg-ok")} style={{ width: `${free * 100}%` }} />
      <div className="absolute inset-y-0 bg-accent/70" style={{ left: `${free * 100}%`, width: `${res * 100}%` }} />
      <div className="absolute inset-y-[-2px] w-[2px] bg-ink" style={{ left: `${Math.min(99, min * 100)}%` }} title="Sicherheitsbestand" />
    </div>
  );
}

export function StockCard({ s, onClick, active, compact }: { s: StockView; onClick?: () => void; active?: boolean; compact?: boolean }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={cn("panel flex w-full flex-col gap-2 p-3 text-left transition-colors", onClick && "hover:border-faint", active && "border-accent ring-2 ring-accent/20", s.state === "crit" && !active && "border-crit/50")}>
      <div className="flex items-start gap-2.5">
        <ProductArt productId={s.productId} size={compact ? 52 : 64} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-semibold">{s.short}</div>
              <div className="truncate text-[10.5px] text-muted">{s.name}</div>
            </div>
            {s.state !== "ok" && <Badge sev={s.state}>{s.state === "crit" ? "kritisch" : "niedrig"}</Badge>}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="num text-[20px] font-bold leading-none">{fmtInt(s.pallets)}</span>
            <span className="text-[11px] text-muted">Paletten</span>
            <span className="num ml-auto text-[11px] text-ink-2">{fmtInt(s.pieces)} Stk</span>
          </div>
        </div>
      </div>
      <StockBar s={s} />
      <div className="flex justify-between text-[10.5px]">
        <span className="text-ink-2">
          frei <b className="num">{fmtNum(s.free / s.piecesPerPallet, 0)}</b> · reserviert <b className="num">{fmtNum(s.reserved / s.piecesPerPallet, 0)}</b> Pal.
        </span>
        <span className="text-muted">min. {s.minPallets}</span>
      </div>
      {!compact && (
        <>
          <div className="flex items-end justify-between gap-2">
            <div className="text-[10.5px] leading-snug text-muted">
              <div>
                <MapPin size={10} className="mr-0.5 inline" />
                {s.location} · {fmtKEur(s.valueEur)}
              </div>
              <div>
                heute +{fmtNum(s.inToday / s.piecesPerPallet, 0)} / −{fmtNum(s.outToday / s.piecesPerPallet, 0)} Pal. · Reichweite {s.reachDays > 30 ? "> 30" : fmtNum(s.reachDays, 1)} Tage
              </div>
            </div>
            <Sparkline data={s.history.map((h) => h.pieces)} width={78} height={26} color={s.state === "ok" ? "var(--accent)" : s.state === "warn" ? "var(--warn)" : "var(--crit)"} />
          </div>
          <div className="truncate border-t border-line pt-1.5 text-[10.5px] text-ink-2">
            {s.producingOn.length ? `in Produktion auf ${s.producingOn.join(", ")}` : "derzeit nicht in Produktion"}
            {s.nextPickup ? ` · nächste Abholung ${fmtTime(s.nextPickup.t)} (${s.nextPickup.partner})` : ""}
          </div>
        </>
      )}
    </Tag>
  );
}
