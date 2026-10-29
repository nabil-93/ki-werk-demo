"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Boxes, CalendarRange, Clock, Factory, PackageCheck, Search, Sparkles, Timer, Truck, Warehouse } from "lucide-react";
import { useUi } from "@/lib/client/store";
import type { StockView, VisitView, YardSummary } from "@/lib/sim/types";
import { fmtDateTime, fmtDay, fmtInt, fmtKEur, fmtNum, fmtShortDate, fmtTime } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { useRevealOnSelect } from "@/lib/client/reveal";
import { Badge, Button, PageHeader, Panel, Tabs } from "@/components/ui/ui";
import { ChartTip, Legend, axisTick, gridProps } from "@/components/ui/chartkit";
import { Fraction, KIND_META, VisitDetail, VisitLegend, VisitRow, dayCounts } from "@/components/ops/Visit";
import { StockBar, StockCard, StockLegend } from "@/components/ops/Stock";
import ProductArt from "@/components/ops/ProductArt";
import { ProductDetailView, useProductDetail } from "@/components/ops/Product";

type Range = "heute" | "morgen" | "woche" | "monat";
type Kind = "alle" | VisitView["kind"];
const H = 3_600_000;

function useYard(range: Range) {
  const [data, setData] = useState<{ now: number; from: number; to: number; summary: YardSummary; visits: VisitView[] } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/yard?range=${range}`, { cache: "no-store" });
        if (r.ok && alive) setData(await r.json());
      } catch {}
    };
    load();
    const t = setInterval(load, range === "heute" ? 3000 : 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [range]);
  return data;
}

/** Rampenbelegung heute: 6 Rampen × 24 h, Blöcke = Fahrzeug an der Rampe (geplant gestrichelt) */
function DockGantt({ visits, from, now, onPick, sel }: { visits: VisitView[]; from: number; now: number; onPick: (id: string) => void; sel?: string }) {
  const span = 24 * H;
  const pct = (t: number) => `${Math.max(0, Math.min(100, ((t - from) / span) * 100))}%`;
  const w = (a: number, b: number) => `${Math.max(0.4, ((Math.min(b, from + span) - Math.max(a, from)) / span) * 100)}%`;
  return (
    <div className="select-none">
      <div className="relative ml-[64px] h-4 text-[9.5px] text-faint">
        {Array.from({ length: 9 }, (_, k) => (
          <span key={k} className="num absolute -translate-x-1/2" style={{ left: `${(k / 8) * 100}%` }}>
            {fmtTime(from + k * 3 * H)}
          </span>
        ))}
      </div>
      {[1, 2, 3, 4, 5, 6].map((d) => (
        <div key={d} className="flex items-center gap-2 py-[3px]">
          <div className="w-[56px] shrink-0 text-[11px] font-semibold text-ink-2">Rampe {d}</div>
          <div className="relative h-6 flex-1 rounded-md bg-panel-2">
            {visits
              .filter((v) => v.dock === d && !v.forecast)
              .map((v) => {
                const a = v.dockAt ?? Math.max(v.kind === "abholung" ? v.slotStart - 0.5 * H : v.arriveAt, v.arriveAt) + 5 * 60_000;
                const b = v.departedAt ?? (v.doneAt ? v.doneAt + 6 * 60_000 : (v.dockAt ?? a) + v.handleMin * 60_000 + 6 * 60_000);
                const planned = !v.dockAt;
                const live = v.status === "RAMPE";
                return (
                  <button
                    key={v.id}
                    onClick={() => onPick(v.id)}
                    title={`${v.plate} · ${v.partner} · ${fmtTime(a)}–${fmtTime(b)}`}
                    className={cn(
                      "absolute top-0.5 bottom-0.5 overflow-hidden rounded-[5px] px-1 text-left text-[9.5px] font-semibold leading-5 text-white",
                      planned ? "border border-dashed border-ink/30 bg-transparent text-ink-2" : v.kind === "abholung" ? "bg-accent" : v.kind === "anlieferung" ? "bg-ok" : "bg-ink-2",
                      live && "ring-2 ring-accent/40",
                      v.overstayMin > 0 && !planned && "bg-crit",
                      sel === v.id && "ring-2 ring-ink",
                    )}
                    style={{ left: pct(a), width: w(a, b) }}
                  >
                    <span className="truncate">{v.plate}</span>
                  </button>
                );
              })}
            <div className="absolute top-[-3px] bottom-[-3px] w-[2px] bg-accent" style={{ left: pct(now) }} />
          </div>
        </div>
      ))}
      <Legend
        className="ml-[64px] mt-2"
        items={[
          { color: "var(--accent)", label: "blau: Abholung an der Rampe" },
          { color: "var(--ok)", label: "grün: Anlieferung" },
          { color: "var(--ink-2)", label: "dunkelgrau: Entsorgung" },
          { color: "var(--crit)", label: "rot: Standzeit überschritten" },
          { color: "var(--ink-2)", kind: "dash", label: "gestrichelt: geplant, Fahrzeug noch nicht an der Rampe" },
          { color: "var(--accent)", kind: "line", label: "senkrechte blaue Linie: jetzt" },
        ]}
        note="Breite des Blocks = Zeit an der Rampe (Beladen/Entladen + Papiere)"
      />
    </div>
  );
}

function StockDetail({ s, visits }: { s: StockView; visits: VisitView[] }) {
  const [full, setFull] = useState<StockView | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/warehouse", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => alive && setFull((d.stock as StockView[]).find((x) => x.productId === s.productId) ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [s.productId]);
  const hist = (full?.history ?? s.history).map((h) => ({ t: h.t, pal: Number((h.pieces / s.piecesPerPallet).toFixed(1)) }));
  const pickups = visits.filter((v) => v.productId === s.productId && v.kind === "abholung" && v.status !== "ABGEFAHREN").slice(0, 6);
  return (
    <Panel title={s.name} subtitle={`${s.location} · ${fmtInt(s.piecesPerPallet)} Stk je Palette · ${fmtNum(s.weightG, 1)} g · ${s.iml ? "IML-dekoriert" : s.type === "TF" ? "thermogeformt" : "spritzgegossen"}`} icon={<Boxes size={16} />}>
      <div className="grid gap-4 lg:grid-cols-[170px_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-2 rounded-xl bg-panel-2 p-3">
          <ProductArt productId={s.productId} size={140} />
          <div className="num text-[26px] font-bold leading-none">{fmtInt(s.pallets)}</div>
          <div className="text-[11px] text-muted">Paletten · {fmtInt(s.pieces)} Stück</div>
          <Badge sev={s.state}>{s.state === "ok" ? "über Sicherheitsbestand" : s.state === "warn" ? "unter Sicherheitsbestand" : "kritisch niedrig"}</Badge>
        </div>
        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Frei verfügbar", `${fmtNum(s.free / s.piecesPerPallet, 0)} Pal.`],
              ["Reserviert (Aufträge)", `${fmtNum(s.reserved / s.piecesPerPallet, 0)} Pal.`],
              ["Warenwert", fmtKEur(s.valueEur)],
              ["Reichweite", s.reachDays > 30 ? "> 30 Tage" : `${fmtNum(s.reachDays, 1)} Tage`],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-panel-2 px-3 py-2">
                <div className="label text-[9px]">{l}</div>
                <div className="num text-[14px] font-semibold">{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <StockBar s={s} />
            <div className="mt-1 flex justify-between text-[10.5px] text-muted">
              <span>grün = frei · blau = reserviert · Strich = Sicherheitsbestand ({s.minPallets} Pal.)</span>
              <span>
                heute +{fmtNum(s.inToday / s.piecesPerPallet, 0)} / −{fmtNum(s.outToday / s.piecesPerPallet, 0)} Pal.
              </span>
            </div>
          </div>
          <div className="mt-3 h-[170px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hist} margin={{ top: 6, right: 6, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="stk" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(t) => fmtShortDate(t)} tick={axisTick} axisLine={false} tickLine={false} minTickGap={50} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `${v}`} />
                <Tooltip content={<ChartTip labelFormat={(l) => fmtDateTime(Number(l))} valueFormat={(v) => `${fmtNum(v, 1)} Paletten`} />} />
                <ReferenceLine y={s.minPallets} stroke="var(--warn)" strokeDasharray="4 4" label={{ value: "Sicherheitsbestand", position: "insideTopRight", fontSize: 10, fill: "var(--warn)" }} />
                <Area type="stepAfter" dataKey="pal" name="Bestand" stroke="var(--accent)" strokeWidth={1.6} fill="url(#stk)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <Legend
            className="mt-1"
            items={[
              { color: "var(--accent)", kind: "area", label: "blaue Fläche: Bestand in Paletten (stündlich, 7 Tage)" },
              { color: "var(--warn)", kind: "dash", label: "gelb gestrichelt: Sicherheitsbestand" },
            ]}
            note="Anstieg = Zugang aus der Produktion · Stufe nach unten = Abholung per LKW"
          />
          <div className="mt-2 text-[11px] text-ink-2">
            <b>Zugang:</b> {s.producingOn.length ? `läuft auf ${s.producingOn.join(", ")}` : "derzeit keine Linie"} · <b>Abgang:</b>{" "}
            {pickups.length ? pickups.map((v) => `${fmtTime(v.slotStart)} ${v.partner} (${v.pallets} Pal.)`).join(" · ") : "keine Abholung avisiert"}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Rückverfolgung: wann, wo, auf welcher Maschine gefertigt – mit Gut-/Schlechtteilen je Charge */
function Traceability({ productId, name, onVisit }: { productId: string; name: string; onVisit: (id: string) => void }) {
  const d = useProductDetail(productId);
  return (
    <Panel title={`Rückverfolgung & Qualität · ${name}`} subtitle="Fertigungslose der letzten 2 Tage · Maschine, Halle, Zeitraum, Gut- und Schlechtteile, Fehlerarten, Aufträge" icon={<Factory size={16} />}>
      {d ? <ProductDetailView d={d} hideStock onVisit={onVisit} /> : <div className="skeleton h-64 rounded-xl" />}
    </Panel>
  );
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const snap = useUi((s) => s.snap);
  const openCopilot = useUi((s) => s.openCopilot);
  const [range, setRange] = useState<Range>("heute");
  const [kind, setKind] = useState<Kind>("alle");
  const [q, setQ] = useState("");
  const [prod, setProd] = useState<string | null>(sp.get("p"));
  const yard = useYard(range);
  const now = snap?.now ?? yard?.now ?? Date.now();
  const selId = sp.get("v");
  // Detail immer mit dem frischesten Stand (Snapshot = jede Sekunde)
  const list = useMemo(() => {
    const live = new Map((snap?.visits ?? []).map((v) => [v.id, v]));
    const all = (yard?.visits ?? []).map((v) => live.get(v.id) ?? v);
    const needle = q.trim().toLowerCase();
    return all.filter((v) => (kind === "alle" || v.kind === kind) && (!needle || [v.plate, v.driver, v.partner, v.carrier, v.to.city, v.from.city, v.cargo, v.id].join(" ").toLowerCase().includes(needle)));
  }, [yard, snap?.visits, kind, q]);
  const sel = list.find((v) => v.id === selId) ?? snap?.visits.find((v) => v.id === selId) ?? list.find((v) => v.status !== "ABGEFAHREN" && v.status !== "ERWARTET") ?? list[0];
  const byDay = useMemo(() => {
    const m = new Map<string, VisitView[]>();
    for (const v of list) {
      // Produktionstag 06:00–06:00 (Vorabend-Anreisen zählen zum Tag ihres Zeitfensters)
      const k = fmtDay(v.slotStart - 6 * H);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(v);
    }
    for (const vs of m.values()) vs.sort((a, b) => (a.arrivedAt ?? a.arriveAt) - (b.arrivedAt ?? b.arriveAt));
    return [...m.entries()];
  }, [list]);
  // laufende Nummer je Tag: „Nr. 3/19“ = drittes von 19 Fahrzeugen des Tages
  const nrOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const [, vs] of byDay) {
      const real = vs.filter((v) => !v.forecast).sort((a, b) => (a.arrivedAt ?? a.arriveAt) - (b.arrivedAt ?? b.arriveAt));
      real.forEach((v, i) => m.set(v.id, `${i + 1}/${real.length}`));
    }
    return m;
  }, [byDay]);
  const sum = snap?.yard;
  const stock = snap?.stock ?? [];
  const selStock = stock.find((s) => s.productId === prod) ?? stock[0];
  const pallets = stock.reduce((a, s) => a + s.pallets, 0);
  // Auswahl → Fahrzeug- bzw. Artikeldetail ins Bild scrollen (z. B. LKW aus der Rückverfolgung unten)
  const truckReveal = useRevealOnSelect(selId);
  const stockReveal = useRevealOnSelect(prod);
  const pick = (id: string) => {
    router.push(`/lager?v=${id}`, { scroll: false });
    truckReveal.bump();
  };

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Truck size={12} /> Lager & LKW-Hof · Yard-Management
          </>
        }
        title="Jeder LKW. Jede Palette. In Echtzeit."
        desc="Zeitfenster, Pförtner-Check-in, Rampenbelegung und Fertigwarenbestand in einem Bild: wer kommt wann, was wird geladen, wer steht zu lange – mit Fahrer, Kennzeichen, Ziel und Live-Zähler."
        actions={
          <Button variant="ai" onClick={() => openCopilot("Wie ist die Lage auf dem LKW-Hof und im Fertigwarenlager?")}>
            <Sparkles size={15} /> KI fragen
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          [Truck, "Auf dem Hof", sum ? `${sum.onSite}` : "–", "Tor · Warten · Rampe", sum && sum.overstay > 0 ? "warn" : ""],
          [CalendarRange, "Heute noch erwartet", sum ? `${sum.expectedToday}` : "–", "bis 06:00", ""],
          [PackageCheck, "Heute abgefertigt", sum ? `${sum.doneToday}/${sum.doneToday + sum.onSite + sum.expectedToday}` : "–", "fertig / alle LKW heute", ""],
          [Clock, "Verspätet", sum ? `${sum.late}` : "–", "nach Zeitfenster", sum && sum.late > 0 ? "warn" : ""],
          [Timer, "Standzeit überzogen", sum ? `${sum.overstay}` : "–", "jetzt auf dem Hof", sum && sum.overstay > 0 ? "crit" : ""],
          [Warehouse, "Fertigware", `${fmtInt(pallets)} Pal.`, fmtKEur(stock.reduce((a, s) => a + s.valueEur, 0)), ""],
        ].map(([Icon, l, v, s, sev]) => {
          const I = Icon as typeof Truck;
          return (
            <div key={l as string} className={cn("panel px-3.5 py-3", sev === "crit" && "border-crit/50", sev === "warn" && "border-warn/50")}>
              <div className="label flex items-center gap-1.5">
                <I size={12} /> {l as string}
              </div>
              <div className={cn("num mt-1 text-[22px] font-bold leading-none", sev === "crit" ? "text-crit" : sev === "warn" ? "text-warn" : "text-ink")}>{v as string}</div>
              <div className="mt-1 text-[11px] text-muted">{s as string}</div>
            </div>
          );
        })}
      </div>

      {range === "heute" && yard && (
        <Panel title="Rampenbelegung heute" subtitle="Live aus Rampenscanner und Zeitfenstern · Klick auf ein Fahrzeug zeigt die Details" icon={<Clock size={16} />} className="mb-4">
          <DockGantt visits={yard.visits} from={yard.from} now={now} onPick={pick} sel={sel?.id} />
        </Panel>
      )}

      <div className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel
          title="LKW-Zeitfenster"
          subtitle={yard ? `${list.length} Fahrzeuge · ${range === "heute" ? "heutiger Produktionstag" : range === "morgen" ? "morgen" : range === "woche" ? "nächste 7 Tage" : "nächste 30 Tage"} · Prognosen aus offenen Aufträgen gestrichelt` : "lädt …"}
          icon={<CalendarRange size={16} />}
          actions={
            <Tabs
              size="sm"
              value={range}
              onChange={setRange}
              items={[
                { value: "heute", label: "Heute" },
                { value: "morgen", label: "Morgen" },
                { value: "woche", label: "Woche" },
                { value: "monat", label: "Monat" },
              ]}
            />
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(["alle", "abholung", "anlieferung", "entsorgung"] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)} className={cn("rounded-lg px-2.5 py-1 text-[11.5px] font-semibold", kind === k ? "bg-ink text-bg" : "bg-panel-2 text-ink-2 hover:bg-panel-3")}>
                {k === "alle" ? "Alle" : KIND_META[k].label}
              </button>
            ))}
            <div className="relative ml-auto">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kennzeichen, Fahrer, Firma, Stadt …" className="h-8 w-[240px] rounded-lg border border-line bg-panel pl-8 pr-2 text-[12px] outline-none focus:border-accent" />
            </div>
          </div>
          {(() => {
            const c = dayCounts(list);
            return (
              <div className="mb-3 grid gap-3 rounded-xl border border-line bg-panel-2 px-3 py-2.5 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
                <Fraction big label={range === "heute" ? "LKW heute abgefertigt" : "abgefertigt im Zeitraum"} done={c.all.done} total={c.all.total} />
                <Fraction label="Abholungen" done={c.abholung.done} total={c.abholung.total} />
                <Fraction label="Anlieferungen" done={c.anlieferung.done} total={c.anlieferung.total} />
                <Fraction label="Entsorgung" done={c.entsorgung.done} total={c.entsorgung.total} />
              </div>
            );
          })()}
          <VisitLegend className="mb-3 rounded-lg bg-panel-2 px-3 py-2" />
          <div className="space-y-4">
            {byDay.map(([day, vs]) => (
              <div key={day}>
                {range !== "heute" && range !== "morgen" && (
                  <div className="sticky top-0 z-10 mb-1.5 flex items-center justify-between bg-panel py-1 text-[11.5px] font-semibold">
                    <span>{day}</span>
                    <span className="text-[10.5px] font-medium text-muted">
                      {vs.filter((v) => v.kind === "abholung").length} Abholungen · {vs.filter((v) => v.kind === "anlieferung").length} Anlieferungen · {vs.reduce((a, v) => a + v.pallets, 0)} Pal.
                    </span>
                  </div>
                )}
                <div className="grid gap-1.5 lg:grid-cols-2">
                  {vs.map((v) => (
                    <VisitRow key={v.id} v={v} now={now} active={sel?.id === v.id} onClick={() => pick(v.id)} index={nrOf.get(v.id)} />
                  ))}
                </div>
              </div>
            ))}
            {yard && !list.length && <div className="py-8 text-center text-[12.5px] text-muted">Keine Fahrzeuge für diese Auswahl.</div>}
            {!yard && <div className="skeleton h-64 rounded-xl" />}
          </div>
        </Panel>
        <div ref={truckReveal.ref} className="scroll-mt-4 xl:sticky xl:top-4 xl:self-start">
          <Panel title={sel ? `${sel.partner}` : "Fahrzeug"} subtitle={sel ? `${sel.id} · ${sel.carrier}` : "Fahrzeug wählen"} icon={<Truck size={16} />}>
            {sel ? <VisitDetail v={sel} now={now} /> : <div className="py-10 text-center text-[12px] text-muted">Kein Fahrzeug ausgewählt.</div>}
          </Panel>
        </div>
      </div>

      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="wide text-[18px] font-bold">Fertigwarenlager</h2>
          <div className="text-[12px] text-muted">Hochregallager (5 Gassen) und Halle C · Bestand je Artikel, frei vs. für Aufträge reserviert, Verlauf 7 Tage</div>
        </div>
        <span className="text-[11.5px] text-muted">
          {fmtInt(pallets)} Paletten · {snap ? `Stand ${fmtTime(snap.now)}` : ""}
        </span>
      </div>
      <StockLegend className="mb-3 rounded-lg bg-panel px-3 py-2" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {stock.map((s) => (
          <StockCard
            key={s.productId}
            s={s}
            active={selStock?.productId === s.productId}
            onClick={() => {
              setProd(s.productId);
              stockReveal.bump();
            }}
          />
        ))}
      </div>
      {selStock && (
        <div ref={stockReveal.ref} className="mt-4 scroll-mt-4 space-y-4">
          <StockDetail s={selStock} visits={snap?.visits ?? []} />
          <Traceability productId={selStock.productId} name={selStock.name} onVisit={pick} />
        </div>
      )}
    </div>
  );
}

export default function LagerPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-2xl" />}>
      <Inner />
    </Suspense>
  );
}
