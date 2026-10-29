"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Boxes, Container, MapPin, PackageCheck, ShoppingCart, Sparkles, Truck, Warehouse } from "lucide-react";
import { useUi } from "@/lib/client/store";
import { PLANT } from "@/lib/sim/catalog";
import type { MaterialView, ShipmentView } from "@/lib/sim/types";
import { fmtDateTime, fmtInt, fmtNum, fmtPct, fmtShortDate, fmtTime } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { useRevealOnSelect } from "@/lib/client/reveal";
import { Badge, Button, PageHeader, Panel, Progress } from "@/components/ui/ui";
import { Ring } from "@/components/ui/charts";
import { ChartTip, Legend, axisTick, gridProps } from "@/components/ui/chartkit";
import { TicketView } from "@/components/copilot/ToolCards";

function SiloGlyph({ m }: { m: MaterialView }) {
  const level = Math.max(0.02, Math.min(1, m.stock / m.capacity));
  const color = m.state === "crit" ? "var(--crit)" : m.state === "warn" ? "var(--warn)" : "var(--accent)";
  return (
    <svg width="46" height="64" viewBox="0 0 46 64">
      <rect x="5" y="4" width="36" height="44" rx="6" fill="var(--panel-3)" stroke="var(--line)" />
      <motion.rect x="7" width="32" rx="4" fill={color} opacity={0.85} initial={false} animate={{ y: 6 + 40 * (1 - level), height: 40 * level }} transition={{ type: "spring", stiffness: 80, damping: 18 }} />
      <path d="M8 48 L23 60 L38 48" fill="var(--panel-3)" stroke="var(--line)" />
    </svg>
  );
}

function projection(m: MaterialView, now: number) {
  const pts: { t: number; stock: number }[] = [];
  let stock = m.stock;
  const inbound = [...m.inbound].sort((a, b) => a.eta - b.eta);
  for (let h = 0; h <= 7 * 24; h += 2) {
    const t = now + h * 3_600_000;
    for (const ib of inbound) if (ib.eta <= t && ib.eta > t - 2 * 3_600_000) stock += ib.qty;
    pts.push({ t, stock: Math.max(0, Math.round(stock)) });
    stock -= m.avgPerHour * 2;
  }
  return pts;
}

function RouteMap({ shipments }: { shipments: ShipmentView[] }) {
  const W = 520, Hh = 380;
  const px = (lon: number) => ((lon - 1.5) / (18 - 1.5)) * W;
  const py = (lat: number) => ((55 - lat) / (55 - 44.5)) * Hh;
  const home = { x: px(PLANT.lon), y: py(PLANT.lat) };
  const dests = useMemo(() => {
    const m = new Map<string, ShipmentView>();
    for (const s of shipments) if (!m.has(s.city)) m.set(s.city, s);
    return [...m.values()];
  }, [shipments]);
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="h-auto w-full">
      <defs>
        <pattern id="dots" width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.1" fill="var(--line)" />
        </pattern>
      </defs>
      <rect width={W} height={Hh} fill="url(#dots)" rx="12" />
      {shipments.map((s) => {
        const d = { x: px(s.lon), y: py(s.lat) };
        const mx = (home.x + d.x) / 2;
        const my = Math.min(home.y, d.y) - 40;
        const path = `M ${home.x} ${home.y} Q ${mx} ${my} ${d.x} ${d.y}`;
        const t = s.progress;
        const bx = (1 - t) * (1 - t) * home.x + 2 * (1 - t) * t * mx + t * t * d.x;
        const by = (1 - t) * (1 - t) * home.y + 2 * (1 - t) * t * my + t * t * d.y;
        return (
          <g key={s.id}>
            <path d={path} fill="none" stroke={s.status === "UNTERWEGS" ? "var(--accent)" : "var(--line)"} strokeWidth={s.status === "UNTERWEGS" ? 1.8 : 1.2} strokeDasharray={s.status === "UNTERWEGS" ? undefined : "4 4"} />
            {s.status === "UNTERWEGS" && (
              <g transform={`translate(${bx}, ${by})`}>
                <circle r="9" fill="var(--accent)" opacity="0.15" />
                <circle r="4.5" fill="var(--accent)" stroke="white" strokeWidth="1.5" />
              </g>
            )}
          </g>
        );
      })}
      {dests.map((s) => (
        <g key={s.city} transform={`translate(${px(s.lon)}, ${py(s.lat)})`}>
          <circle r="3.5" fill="var(--ink-2)" />
          <text x="7" y="4" className="fill-[var(--ink-2)]" style={{ fontSize: 11, fontWeight: 600 }}>
            {s.city}
          </text>
        </g>
      ))}
      <g transform={`translate(${home.x}, ${home.y})`}>
        <circle r="14" fill="var(--ai-1)" opacity="0.15">
          <animate attributeName="r" values="8;18;8" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle r="6" fill="var(--ai-1)" stroke="white" strokeWidth="2" />
        <text x="10" y="-8" className="fill-[var(--ink)]" style={{ fontSize: 11.5, fontWeight: 700 }}>
          Werk Nord
        </text>
      </g>
    </svg>
  );
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const snap = useUi((s) => s.snap);
  const openCopilot = useUi((s) => s.openCopilot);
  const mats = snap?.materials ?? [];
  const selId = sp.get("mat") ?? mats.find((m) => m.state !== "ok")?.id ?? "M-PPR";
  const sel = mats.find((m) => m.id === selId);
  const proj = useMemo(() => (sel && snap ? projection(sel, snap.now) : []), [sel, snap]);
  const reorder = sel ? sel.avgPerHour * 24 * sel.reorderPointDays : 0;
  const zeroAt = proj.find((p) => p.stock <= 0)?.t;
  const tickets = (snap?.tickets ?? []).filter((t) => t.kind === "bestellung").slice(0, 3);
  const shipments = snap?.shipments ?? [];
  const [dockView] = useState(true);
  const k = snap?.kpis;
  const reveal = useRevealOnSelect(sp.get("mat"));

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Truck size={12} /> Logistik · Material & Versand
          </>
        }
        title="Engpässe sehen, bevor sie die Linie stoppen."
        desc="Reichweiten werden aus dem aktuellen Maschinenplan berechnet – nicht aus Vergangenheitswerten. Lieferverzug, Bestellvorschläge und Versand laufen in einem Bild zusammen."
        actions={
          <Button variant="ai" onClick={() => openCopilot("Wie lange reicht unser IML-Granulat noch und was schlägst du vor?")}>
            <Sparkles size={15} /> KI fragen
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {mats.map((m, i) => (
          <motion.button
            key={m.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            onClick={() => {
              router.replace(`/logistik?mat=${m.id}`, { scroll: false });
              reveal.bump();
            }}
            className={cn("panel flex items-center gap-3 p-3 text-left transition-colors", m.id === selId ? "border-accent ring-2 ring-accent/20" : "hover:border-faint", m.state === "crit" && "border-crit/60")}
          >
            <SiloGlyph m={m} />
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold">{m.name}</div>
              <div className="truncate text-[10.5px] text-muted">{m.location}</div>
              <div className={cn("num mt-1 text-[18px] font-semibold", m.state === "crit" ? "text-crit" : m.state === "warn" ? "text-warn" : "text-ink")}>{fmtNum(m.reachDays, 1)} Tage</div>
              <div className="num text-[10.5px] text-muted">
                {fmtInt(m.stock)} {m.unit}
              </div>
            </div>
          </motion.button>
        ))}
      </div>
      <Legend
        className="mt-2"
        items={[
          { color: "var(--accent)", label: "Silo/Behälter blau: Füllstand im Soll" },
          { color: "var(--warn)", label: "gelb: unter Meldebestand" },
          { color: "var(--crit)", label: "rot: kritisch (< 1,5 Tage)" },
        ]}
        note="große Zahl = Reichweite in Tagen beim aktuellen Maschinenplan"
      />

      <div ref={reveal.ref} className="mt-4 grid scroll-mt-4 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel
          title={sel ? `Bestandsprognose · ${sel.name}` : "Bestandsprognose"}
          subtitle="7 Tage · Verbrauch aus aktuellem Maschinenplan · Zulauf laut Lieferavis"
          icon={<Container size={16} />}
          actions={sel && <Badge sev={sel.state}>{sel.state === "crit" ? "Notfallplan" : sel.state === "warn" ? "unter Meldebestand" : "im Soll"}</Badge>}
        >
          {sel && proj.length > 0 ? (
            <>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={proj} margin={{ top: 10, right: 8, left: 6, bottom: 0 }}>
                    <defs>
                      <linearGradient id="stockg" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={sel.state === "crit" ? "var(--crit)" : "var(--accent)"} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={sel.state === "crit" ? "var(--crit)" : "var(--accent)"} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => fmtShortDate(t)} tick={axisTick} axisLine={false} tickLine={false} minTickGap={50} />
                    <YAxis tick={axisTick} tickFormatter={(v) => (sel.unit === "kg" ? `${fmtNum(v / 1000, 0)} t` : `${fmtNum(v / 1e6, 1)} Mio`)} axisLine={false} tickLine={false} width={52} />
                    <Tooltip content={<ChartTip labelFormat={(l) => fmtDateTime(Number(l))} valueFormat={(v) => `${fmtInt(v)} ${sel.unit}`} />} />
                    <ReferenceLine y={reorder} stroke="var(--warn)" strokeDasharray="4 4" label={{ value: `Meldebestand (${sel.reorderPointDays} Tage)`, position: "insideTopRight", fontSize: 10, fill: "var(--warn)" }} />
                    {sel.inbound.map((ib) => (
                      <ReferenceLine key={ib.id} x={ib.eta} stroke={ib.status === "VERSPAETET" ? "var(--crit)" : "var(--ok)"} strokeDasharray="3 3" label={{ value: ib.status === "VERSPAETET" ? "Zulauf (verspätet)" : "Zulauf", position: "insideTopLeft", fontSize: 10, fill: ib.status === "VERSPAETET" ? "var(--crit)" : "var(--ok)" }} />
                    ))}
                    <Area type="stepAfter" dataKey="stock" name="Bestand" stroke={sel.state === "crit" ? "var(--crit)" : "var(--accent)"} strokeWidth={1.8} fill="url(#stockg)" isAnimationActive={false} />
                    <Line dataKey="stock" stroke="transparent" dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <Legend
                className="mt-1"
                items={[
                  { color: sel.state === "crit" ? "var(--crit)" : "var(--accent)", kind: "area", label: "Fläche: prognostizierter Bestand (rot = Notfall)" },
                  { color: "var(--warn)", kind: "dash", label: "gelb gestrichelt: Meldebestand" },
                  { color: "var(--ok)", kind: "dash", label: "grün senkrecht: geplanter Zulauf" },
                  { color: "var(--crit)", kind: "dash", label: "rot senkrecht: verspäteter Zulauf" },
                ]}
                note="Abfall = Verbrauch der laufenden Maschinen · Sprung nach oben = Lieferung"
              />
              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                {[
                  ["Verbrauch", `${fmtInt(sel.avgPerHour)} ${sel.unit}/h`],
                  ["Reichweite", `${fmtNum(sel.reachDays, 1)} Tage`],
                  ["Leer am", zeroAt ? fmtDateTime(zeroAt) : "nicht in 7 Tagen"],
                  ["Lieferant", sel.supplier],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-lg bg-panel-2 px-3 py-2">
                    <div className="label text-[9px]">{l}</div>
                    <div className={cn("num truncate text-[13px] font-semibold", l === "Leer am" && zeroAt && "text-crit")}>{v}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="skeleton h-[250px]" />
          )}
        </Panel>

        <Panel title="Zulauf & Bestellvorschläge" subtitle="Lieferavis (TMS) · KI-Regel Meldebestand" icon={<ShoppingCart size={16} />}>
          <div className="space-y-2">
            {mats
              .flatMap((m) => m.inbound.map((ib) => ({ ...ib, mat: m })))
              .sort((a, b) => a.eta - b.eta)
              .slice(0, 6)
              .map((ib) => (
                <div key={ib.id} className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2", ib.status === "VERSPAETET" ? "border-crit/40 bg-crit-soft/40" : "border-line")}>
                  <PackageCheck size={15} className={ib.status === "VERSPAETET" ? "text-crit" : "text-ok"} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold">{ib.mat.name}</div>
                    <div className="truncate text-[10.5px] text-muted">
                      {fmtInt(ib.qty)} {ib.mat.unit} · {ib.supplier}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="num text-[11px] font-semibold">{fmtDateTime(ib.eta)}</div>
                    <Badge sev={ib.status === "VERSPAETET" ? "crit" : ib.status === "UNTERWEGS" ? "info" : "neutral"}>{ib.status === "VERSPAETET" ? `+${ib.delayedH} h` : ib.status === "UNTERWEGS" ? "unterwegs" : "bestellt"}</Badge>
                  </div>
                </div>
              ))}
            {tickets.map((t) => (
              <TicketView key={t.id} ticket={t} />
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Versand heute" subtitle={`${shipments.length} Sendungen · 6 Verladetore`} icon={<Truck size={16} />} bodyClassName="px-2 pb-2">
          {dockView && (
            <div className="space-y-1">
              {shipments.map((s) => (
                <div key={s.id} className="grid grid-cols-[84px_minmax(0,1fr)_92px_82px] items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-panel-2">
                  <Badge sev={s.status === "UNTERWEGS" ? "info" : s.status === "ZUGESTELLT" ? "ok" : s.status === "BELADUNG" ? "warn" : "neutral"}>{s.status === "BELADUNG" ? `Tor ${s.dock} · lädt` : s.status === "UNTERWEGS" ? "unterwegs" : s.status === "ZUGESTELLT" ? "zugestellt" : `Tor ${s.dock}`}</Badge>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold">{s.customer}</div>
                    <div className="truncate text-[10.5px] text-muted">
                      {s.city} · {s.pallets} Pal. · {s.carrier} · {s.plate}
                    </div>
                  </div>
                  <div className="w-full">{s.status === "UNTERWEGS" ? <Progress value={s.progress} height={5} /> : <div className="num text-[11px] text-muted">{s.km} km</div>}</div>
                  <div className="num text-right text-[11px] text-ink-2">{s.eta ? `ETA ${fmtTime(s.eta)}` : `ab ${fmtTime(s.slot)}`}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Lieferziele" subtitle="Sendungen live – Position aus Fahrtfortschritt" icon={<MapPin size={16} />}>
          <RouteMap shipments={shipments.filter((s) => s.status !== "ZUGESTELLT")} />
          <Legend
            className="mt-2"
            items={[
              { color: "var(--ai-1)", kind: "dot", label: "pulsierend: Werk Nord" },
              { color: "var(--accent)", kind: "line", label: "blaue Linie + Punkt: LKW unterwegs (Position nach Fahrtfortschritt)" },
              { color: "var(--line)", kind: "dash", label: "gestrichelt: Sendung geplant" },
              { color: "var(--ink-2)", kind: "dot", label: "Punkt: Lieferziel" },
            ]}
          />
        </Panel>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="panel flex items-center gap-4 p-4">
          <Ring value={k ? k.warehouseUsed / k.warehouseCapacity : 0} size={64} stroke={6} color={k && k.warehouseUsed / k.warehouseCapacity > 0.9 ? "var(--crit)" : "var(--accent)"}>
            <span className="num text-[12px] font-semibold">{k ? fmtPct(k.warehouseUsed / k.warehouseCapacity, 0) : "–"}</span>
          </Ring>
          <div>
            <div className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Warehouse size={14} /> Fertigwarenlager
            </div>
            <div className="num text-[12px] text-muted">
              {k ? `${fmtInt(k.warehouseUsed)} / ${fmtInt(k.warehouseCapacity)} Stellplätze` : ""}
            </div>
          </div>
        </div>
        <div className="panel flex items-center gap-4 p-4">
          <Boxes size={28} className="text-accent" />
          <div>
            <div className="text-[13px] font-semibold">Versandbereit</div>
            <div className="num text-[12px] text-muted">{snap?.orders.filter((o) => o.status === "VERSANDBEREIT").length ?? 0} Aufträge · QS-freigegeben</div>
          </div>
        </div>
        <div className="panel p-4 text-[11.5px] leading-snug text-muted">
          <b className="text-ink-2">Logik:</b> Reichweite = Bestand ÷ (Stundenverbrauch der laufenden und geplanten Maschinen). Unter Meldebestand schlägt eine KI-Regel automatisch eine Bestellung vor – ausgelöst wird sie erst nach Freigabe durch den Einkauf.
        </div>
      </div>
    </div>
  );
}

export default function LogistikPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-2xl" />}>
      <Inner />
    </Suspense>
  );
}
