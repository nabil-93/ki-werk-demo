"use client";

// Artikel-Detail: wann und wo gefertigt (Chargen je Maschine/Halle), Gut- und Schlechtteile, Fehlerbilder,
// Bestand, offene Aufträge und Abholungen – im Leitstand-Panel (kompakt) und auf der Lagerseite

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProductDetail } from "@/lib/sim/reports";
import { fmtDateTime, fmtInt, fmtKEur, fmtNum, fmtPct, fmtTime } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { Badge } from "@/components/ui/ui";
import { BarRow } from "@/components/ui/charts";
import { ChartTip, Legend, axisTick, gridProps } from "@/components/ui/chartkit";
import ProductArt from "./ProductArt";
import { StockBar } from "./Stock";
import { Plate } from "./Visit";

export function useProductDetail(id: string | null) {
  const [d, setD] = useState<ProductDetail | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setD(null);
    const load = async () => {
      try {
        const r = await fetch(`/api/product?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (r.ok && alive) setD(await r.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);
  return d;
}

const MAT: Record<string, string> = { "M-PPH": "PP Homopolymer (Granulat)", "M-PPR": "PP Random-Copolymer (Granulat)", "M-PSF": "PS-Folie 1,1 mm", "M-PPF": "PP-Folie 0,9 mm" };

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-semibold">{title}</span>
        {sub && <span className="truncate text-[10.5px] text-muted">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

export function ProductDetailView({ d, compact, onVisit, hideStock }: { d: ProductDetail; compact?: boolean; onVisit?: (id: string) => void; hideStock?: boolean }) {
  const p = d.product;
  const s = d.stock;
  const rate = d.today.good + d.today.scrap > 0 ? d.today.scrap / (d.today.good + d.today.scrap) : 0;
  const maxDef = Math.max(1, ...d.defects.map((x) => x.pieces));
  return (
    <div className={cn("space-y-4", !compact && "grid gap-4 space-y-0 xl:grid-cols-2")}>
      {/* Steckbrief + Bestand */}
      <div className="space-y-3">
        {!hideStock && (
          <>
        <div className="flex gap-3">
          <div className="flex shrink-0 items-center justify-center rounded-xl bg-panel-2 p-2">
            <ProductArt productId={p.id} size={compact ? 96 : 128} />
          </div>
          <div className="min-w-0 flex-1 space-y-1 text-[11.5px]">
            {[
              ["Artikel", `${p.id} · ${p.short}`],
              ["Verfahren", p.type === "SG" ? (p.iml ? "Spritzguss mit In-Mould-Label" : "Spritzguss") : "Thermoformen aus Folie"],
              ["Material", MAT[p.material] ?? p.material],
              ["Gewicht", `${fmtNum(p.weightG, 1)} g je Stück`],
              ["Palette", `${fmtInt(p.piecesPerPallet)} Stück`],
              ["Preis", `${fmtNum(p.pricePer1000, 0)} € je 1.000 Stk`],
              ["Maschinen", p.machines.join(", ")],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between gap-2">
                <span className="shrink-0 text-muted">{l}</span>
                <span className="truncate text-right font-medium text-ink-2" title={v}>
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-line p-3">
          <div className="flex items-baseline justify-between">
            <span className="label text-[9px]">Bestand · {s.location}</span>
            <Badge sev={s.state}>{s.state === "ok" ? "im Soll" : s.state === "warn" ? "unter Sicherheitsbestand" : "kritisch"}</Badge>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="num text-[22px] font-bold">{fmtInt(s.pallets)}</span>
            <span className="text-[11px] text-muted">Paletten · {fmtInt(s.pieces)} Stk · {fmtKEur(s.valueEur)}</span>
          </div>
          <StockBar s={s} />
          <div className="mt-1 flex justify-between text-[10.5px] text-ink-2">
            <span>
              frei {fmtNum(s.free / s.piecesPerPallet, 0)} · reserviert {fmtNum(s.reserved / s.piecesPerPallet, 0)} Pal. · min. {s.minPallets}
            </span>
            <span>Reichweite {s.reachDays > 30 ? "> 30" : fmtNum(s.reachDays, 1)} Tage</span>
          </div>
        </div>
          </>
        )}
        {/* Produktion heute */}
        <Section title="Produktion heute" sub={d.today.first ? `gefertigt ${fmtTime(d.today.first)}–${fmtTime(d.today.last!)}` : "heute noch nicht gefertigt"}>
          <div className="mb-2 grid grid-cols-3 gap-2">
            {[
              ["Gutteile", fmtInt(d.today.good), ""],
              ["Schlechtteile", fmtInt(d.today.scrap), d.today.scrap > 0 ? "crit" : ""],
              ["Ausschussquote", fmtPct(rate, 2), rate > 0.015 ? "crit" : rate > 0.01 ? "warn" : ""],
            ].map(([l, v, sev]) => (
              <div key={l} className="rounded-lg bg-panel-2 px-2.5 py-1.5">
                <div className="label text-[8.5px]">{l}</div>
                <div className={cn("num text-[14px] font-bold", sev === "crit" ? "text-crit" : sev === "warn" ? "text-warn" : "text-ink")}>{v}</div>
              </div>
            ))}
          </div>
          <div className="h-[130px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.series} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="t" tickFormatter={(t) => fmtTime(t)} tick={axisTick} axisLine={false} tickLine={false} minTickGap={28} />
                <YAxis tick={axisTick} tickFormatter={(v) => `${fmtNum(v / 1000, 0)}k`} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<ChartTip labelFormat={(l) => `${fmtTime(Number(l))}–${fmtTime(Number(l) + 3_600_000)}`} valueFormat={(v) => `${fmtInt(v)} Stk`} />} />
                <Bar dataKey="good" name="Gutteile" stackId="a" fill="var(--accent)" isAnimationActive={false} />
                <Bar dataKey="scrap" name="Schlechtteile" stackId="a" fill="var(--crit)" isAnimationActive={false} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend className="mt-1" items={[{ color: "var(--accent)", label: "blau: Gutteile je Stunde" }, { color: "var(--crit)", label: "rot: Schlechtteile (Ausschuss)" }]} note="alle Maschinen, die diesen Artikel fertigen" />
        </Section>
      </div>

      <div className="space-y-4">
        {/* Chargen */}
        <Section title="Fertigungslose (Chargen)" sub="letzte 2 Tage · je Schicht und nach jedem Rüsten ein Los">
          <div className="space-y-1.5">
            {d.batches.map((b) => {
              const r = b.good + b.scrap > 0 ? b.scrap / (b.good + b.scrap) : 0;
              return (
                <div key={b.id} className={cn("rounded-lg border px-2.5 py-2", b.running ? "border-accent/50 bg-accent-soft/30" : "border-line")}>
                  <div className="flex items-center gap-2">
                    <span className="num text-[11px] font-bold">{b.id}</span>
                    {b.running ? <Badge sev="info">läuft</Badge> : <Badge sev="neutral">abgeschlossen</Badge>}
                    <span className="ml-auto num text-[11px] text-ink-2">{b.machineId}</span>
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-muted">
                    {b.hallName} · {b.shift} · {fmtDateTime(b.start)} – {b.running ? "jetzt" : fmtTime(b.end)}
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-2 text-[11px]">
                    <span>
                      gut <b className="num">{fmtInt(b.good)}</b>
                    </span>
                    <span className={cn(b.scrap > 0 && "text-crit")}>
                      schlecht <b className="num">{fmtInt(b.scrap)}</b> ({fmtPct(r, 2)})
                    </span>
                    <span className="text-right">
                      Ist/Soll <b className={cn("num", b.target > 0 && b.good / b.target < 0.75 ? "text-crit" : b.target > 0 && b.good / b.target < 0.85 ? "text-warn" : "text-ok")}>{b.target > 0 ? fmtPct(b.good / b.target, 0) : "–"}</b>
                    </span>
                  </div>
                  {(b.stopMin > 1 || b.reason) && (
                    <div className="mt-0.5 truncate text-[10.5px] text-muted">
                      Stillstand {fmtNum(b.stopMin, 0)} min{b.reason ? ` · ${b.reason}` : ""} · Temp. max {fmtNum(b.temp1Max, 1)} °C
                    </div>
                  )}
                </div>
              );
            })}
            {!d.batches.length && <div className="text-[12px] text-muted">In den letzten 2 Tagen nicht gefertigt.</div>}
          </div>
        </Section>

        {/* Fehlerbilder */}
        <Section title="Schlechtteile nach Fehlerart" sub="heute · Inline-Kamera + CAQ">
          <div className="space-y-2">
            {d.defects.slice(0, 6).map((x) => (
              <BarRow key={x.key} label={x.label} value={x.pieces} max={maxDef} color="var(--crit)" right={`${fmtInt(x.pieces)} Stk`} />
            ))}
            {!d.defects.length && <div className="text-[12px] text-muted">Keine Schlechtteile erfasst.</div>}
          </div>
          {d.quality.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.quality.map((q) => (
                <span key={q.machineId} className={cn("rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold", q.spcViolation ? "bg-warn-soft text-warn" : "bg-panel-2 text-ink-2")} title={`Cpk ${fmtNum(q.cpk, 2)} · Ausschuss ${fmtPct(q.scrapRate, 2)}`}>
                  {q.machineId}: Cpk {fmtNum(q.cpk, 2)}
                  {q.spcViolation ? ` · SPC ${q.spcViolation}` : ""}
                </span>
              ))}
            </div>
          )}
          <Legend className="mt-1.5" items={[{ color: "var(--crit)", label: "Balken: Schlechtteile je Fehlerart" }]} note={`Cpk ≥ 1,33 = Prozess fähig · Prüfmerkmal: ${p.spc.label}`} />
        </Section>

        {/* Aufträge */}
        <Section title="Offene Aufträge" sub={`${d.orders.length} Aufträge`}>
          <div className="space-y-1">
            {d.orders.map((o) => (
              <div key={o.id} className="flex items-center gap-2 rounded-lg bg-panel-2 px-2.5 py-1.5 text-[11px]">
                <span className="num w-[70px] shrink-0 font-semibold">{o.id}</span>
                <span className="min-w-0 flex-1 truncate">
                  {o.customer} · {fmtInt(o.qty)} Stk · {o.machineId}
                </span>
                <span className="num shrink-0 text-muted">{fmtPct(o.progress, 0)}</span>
                <Badge sev={o.risk === "gefaehrdet" ? "crit" : o.risk === "beobachten" ? "warn" : "ok"}>{fmtPct(o.onTimeProb, 0)}</Badge>
              </div>
            ))}
            {!d.orders.length && <div className="text-[12px] text-muted">Kein offener Auftrag.</div>}
          </div>
        </Section>

        {/* Abholungen */}
        <Section title="Abholungen heute" sub="LKW mit diesem Artikel">
          <div className="space-y-1">
            {d.pickups.map((v) => (
              <button key={v.id} onClick={() => onVisit?.(v.id)} className="flex w-full items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-left text-[11px] hover:bg-panel-2">
                <Plate text={v.plate} small />
                <span className="min-w-0 flex-1 truncate">
                  {v.partner} · {fmtInt(v.qty)} Stk · {v.pallets} Pal.
                </span>
                <span className="num shrink-0 text-muted">{v.status === "ABGEFAHREN" ? `ab ${fmtTime(v.departedAt!)}` : v.arrivedAt ? "auf dem Hof" : fmtTime(v.slotStart)}</span>
              </button>
            ))}
            {!d.pickups.length && <div className="text-[12px] text-muted">Heute keine Abholung avisiert.</div>}
          </div>
        </Section>
      </div>
    </div>
  );
}
