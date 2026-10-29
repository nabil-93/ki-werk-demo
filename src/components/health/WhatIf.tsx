"use client";

// Was-wäre-wenn: Ergebnis der Zukunftsrechnung im digitalen Zwilling – 72 h ohne vs. mit Maßnahme

import { Loader2, Play, Zap } from "lucide-react";
import type { MachineStatus } from "@/lib/sim/types";
import type { WhatIfBranch, WhatIfResult } from "@/lib/sim/whatif";
import { fmtDateTime, fmtEur, fmtInt, fmtNum } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { Legend } from "@/components/ui/chartkit";

const SEG: Record<MachineStatus, string> = { PRODUKTION: "bg-ok/70", RUESTEN: "bg-warn/70", STOERUNG: "bg-crit", WARTUNG: "bg-accent", STILLSTAND: "bg-faint/50" };

export async function runWhatIf(machineId: string, findingId?: string, actionId?: string): Promise<WhatIfResult | null> {
  try {
    const r = await fetch("/api/whatif", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machineId, findingId, actionId }) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

const lateText = (b: WhatIfBranch) => (!b.order ? "–" : b.order.lateH > 0.5 ? `${b.order.id}: ${fmtNum(b.order.lateH, 0)} h zu spät` : `${b.order.id}: pünktlich`);

function Lane({ b, horizonH, tone }: { b: WhatIfBranch; horizonH: number; tone: "bad" | "good" }) {
  return (
    <div className="grid gap-2 md:grid-cols-[150px_minmax(0,1fr)_260px] md:items-center">
      <div className="min-w-0">
        <div className={cn("text-[12px] font-semibold", tone === "bad" ? "text-crit" : "text-ok")}>{tone === "bad" ? "Ohne Maßnahme" : "Mit Maßnahme"}</div>
        <div className="truncate text-[10.5px] text-muted" title={b.label}>
          {tone === "bad" ? "weiterlaufen wie bisher" : b.label}
        </div>
      </div>
      <div className="relative h-7 overflow-hidden rounded-md bg-panel-2">
        {b.segments.map((s, i) => (
          <span key={i} className={cn("absolute inset-y-0", SEG[s.status])} style={{ left: `${(s.fromH / horizonH) * 100}%`, width: `${Math.max(0.3, ((s.toH - s.fromH) / horizonH) * 100)}%` }} title={`${s.status} +${fmtNum(s.fromH, 1)}–${fmtNum(s.toH, 1)} h`} />
        ))}
        {b.failures.map((f, i) => (
          <span key={i} className="absolute top-0.5 z-10 flex h-6 -translate-x-1/2 items-center gap-0.5 rounded-md bg-panel px-1 text-[10px] font-bold text-crit shadow-[var(--shadow-sm)]" style={{ left: `${(f.atH / horizonH) * 100}%` }} title={f.reason}>
            <Zap size={11} /> Ausfall +{fmtNum(f.atH, 1)} h
          </span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
        <div className="rounded-md bg-panel-2 px-2 py-1">
          <div className="text-muted">Stillstand</div>
          <div className="num font-semibold">{fmtNum(b.stoerH + b.wartH, 1)} h</div>
        </div>
        <div className="rounded-md bg-panel-2 px-2 py-1">
          <div className="text-muted">Gutteile</div>
          <div className="num font-semibold">{fmtInt(b.good)}</div>
        </div>
        <div className={cn("rounded-md px-2 py-1", tone === "bad" ? "bg-crit-soft" : "bg-ok-soft")}>
          <div className="text-muted">Verlust</div>
          <div className={cn("num font-semibold", tone === "bad" ? "text-crit" : "text-ok")}>{fmtEur(b.lossEur)}</div>
        </div>
      </div>
    </div>
  );
}

export function WhatIfView({ r, busy }: { r: WhatIfResult | null; busy: boolean }) {
  if (busy)
    return (
      <div className="ai-border mt-2.5 flex items-center gap-2.5 rounded-xl bg-panel p-3 text-[12px]">
        <Loader2 size={16} className="animate-spin text-accent" />
        <div>
          <div className="font-semibold">Die KI rechnet die Zukunft durch …</div>
          <div className="text-[11px] text-muted">Kopie des Werks · 2 × 72 Stunden · ohne und mit Maßnahme</div>
        </div>
      </div>
    );
  if (!r) return null;
  const a = r.without, b = r.with;
  const saved = a.lossEur - b.lossEur;
  const lessStop = a.stoerH + a.wartH - (b.stoerH + b.wartH);
  const morePieces = b.good - a.good;
  const prevented = a.failures.length - b.failures.length;
  return (
    <div className="ai-border mt-2.5 rounded-xl bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Play size={13} className="text-accent" />
        <span className="text-[12.5px] font-semibold">Was-wäre-wenn · 72 h im digitalen Zwilling durchgerechnet</span>
        <span className="text-[10.5px] text-muted">
          ab {fmtDateTime(r.startedAt)} · gleicher Ausgangszustand, gleicher Zufall · {fmtNum(r.ms / 1000, 1)} s
        </span>
      </div>
      <div className={cn("mb-3 rounded-lg px-3 py-2 text-[12.5px]", saved > 0 ? "bg-ok-soft" : "bg-warn-soft")}>
        <b>{saved > 0 ? `Mit „${r.action}“: ${fmtEur(saved)} weniger Verlust` : `„${r.action}“ lohnt sich in diesen 72 h nicht (${fmtEur(-saved)} mehr)`}</b>
        <span className="text-ink-2">
          {" "}
          · {lessStop >= 0 ? `${fmtNum(lessStop, 1)} h weniger Stillstand` : `${fmtNum(-lessStop, 1)} h mehr Stillstand`} · {morePieces >= 0 ? "+" : ""}
          {fmtInt(morePieces)} Gutteile{prevented > 0 ? ` · ${prevented === 1 ? "Ausfall verhindert" : `${prevented} Ausfälle verhindert`}` : ""}
          {a.order && b.order ? ` · Auftrag: ${lateText(a)} → ${lateText(b)}` : ""}
        </span>
      </div>
      <div className="space-y-2.5">
        <Lane b={a} horizonH={r.horizonH} tone="bad" />
        <Lane b={b} horizonH={r.horizonH} tone="good" />
      </div>
      <div className="num mt-1 flex justify-between pl-0 text-[10px] text-faint md:pl-[158px] md:pr-[268px]">
        <span>jetzt</span>
        <span>+24 h</span>
        <span>+48 h</span>
        <span>+72 h</span>
      </div>
      <details className="mt-2 text-[11px] text-ink-2">
        <summary className="cursor-pointer font-semibold text-accent">Wie gerechnet?</summary>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          {[a, b].map((x, i) => (
            <div key={i} className="rounded-lg bg-panel-2 p-2">
              <div className="mb-1 font-semibold">{i === 0 ? "Ohne Maßnahme" : "Mit Maßnahme"}</div>
              {(
                [
                  ["Stillstand × Kosten je Stunde", x.costs.stillstand],
                  ["Reparatur (Teile, Fremdleistung)", x.costs.reparatur],
                  ["Wartungsteile", x.costs.wartung],
                  ["Ausschuss", x.costs.ausschuss],
                  ["Maßnahme", x.costs.massnahme],
                ] as const
              ).map(([l, v]) => (
                <div key={l} className="flex justify-between">
                  <span className="text-muted">{l}</span>
                  <span className="num">{fmtEur(v)}</span>
                </div>
              ))}
              <div className="mt-1 text-[10.5px] text-faint">zufällige Kurzstopps {fmtNum(x.microH, 1)} h – in beiden Varianten ähnlich, nicht im Vergleich</div>
            </div>
          ))}
        </div>
        <div className="mt-1.5 text-[10.5px] text-muted">Die Simulation kopiert den kompletten Werkszustand (Verschleiß, Aufträge, Material, Schichten) und spielt 72 Stunden im 2-Minuten-Takt durch. Der Live-Betrieb bleibt unberührt.</div>
      </details>
      <Legend
        className="mt-2"
        items={[
          { color: "color-mix(in srgb, var(--ok) 70%, transparent)", label: "grün: Produktion" },
          { color: "var(--crit)", label: "rot: Störung" },
          { color: "var(--accent)", label: "blau: Wartung" },
          { color: "color-mix(in srgb, var(--warn) 70%, transparent)", label: "gelb: Rüsten" },
        ]}
        note="⚡ = Lagerschaden im simulierten Verlauf"
      />
    </div>
  );
}
