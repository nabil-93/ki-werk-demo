"use client";

// Rechtes Panel im Leitstand: angeklickter LKW, Fertigwarenlager und Hof-Übersicht

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronLeft, DoorOpen, Sparkles, Warehouse, X } from "lucide-react";
import { useUi } from "@/lib/client/store";
import type { VisitView } from "@/lib/sim/types";
import { fmtInt, fmtKEur, fmtTime } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { Button } from "@/components/ui/ui";
import { Legend } from "@/components/ui/chartkit";
import { Fraction, KIND_META, Plate, VisitDetail, VisitLegend, VisitRow, dayCounts } from "@/components/ops/Visit";
import { StockCard, StockLegend } from "@/components/ops/Stock";
import { ProductDetailView, useProductDetail } from "@/components/ops/Product";

/** „Zurück“ in der Detailansicht des rechten Panels */
export function BackButton({ onClick, label = "Zurück" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="-ml-1.5 mb-1 flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-accent hover:bg-accent-soft" title={label}>
      <ChevronLeft size={15} /> {label}
    </button>
  );
}

/**
 * Zeitfenster für das Detailpanel: aus dem Live-Snapshot, sonst direkt vom Yard-Management
 * (der Snapshot enthält nur Fahrzeuge auf dem Hof und kurz vor/nach ihrem Besuch)
 */
function useVisit(id: string) {
  const live = useUi((s) => s.snap?.visits.find((x) => x.id === id));
  const [fetched, setFetched] = useState<{ id: string; v: VisitView | null } | null>(null);
  const has = Boolean(live);
  useEffect(() => {
    if (has) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/yard?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!alive) return;
        setFetched({ id, v: r.ok ? (await r.json()).visit : null });
      } catch {}
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, has]);
  const v = live ?? (fetched?.id === id ? fetched.v : null);
  return { v, loading: !live && fetched?.id !== id };
}

export function TruckPanel({ id }: { id: string }) {
  const { v, loading } = useVisit(id);
  const now = useUi((s) => s.snap?.now ?? Date.now());
  const select = useUi((s) => s.selectVisit);
  const openCopilot = useUi((s) => s.openCopilot);
  const fromGate = useUi((s) => s.gateOpen);
  const fromDock = useUi((s) => s.dockOpen);
  const fromProduct = useUi((s) => s.selectedProduct);
  const fromStock = useUi((s) => s.warehouseOpen);
  const back = () => {
    if (!fromGate && !fromDock && !fromProduct && !fromStock) useUi.getState().setRightTab("hof");
    select(null);
  };
  const backLabel = fromProduct ? "Zurück zum Artikel" : fromStock ? "Zurück zum Lager" : fromDock ? `Zurück zu Rampe ${fromDock}` : fromGate ? "Zurück zum Pförtnerbuch" : "Zurück zur Hofliste";
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <BackButton onClick={back} label={backLabel} />
          <div className="text-[15px] font-bold">{v ? `${v.kind === "abholung" ? "Abholung" : v.kind === "anlieferung" ? "Anlieferung" : "Entsorgung"} · ${v.partner}` : "LKW"}</div>
          <div className="truncate text-[11.5px] text-muted">{v ? `Zeitfenster ${v.id} · ${v.carrier}` : loading ? "wird geladen …" : "Zeitfenster nicht gefunden"}</div>
        </div>
        <button onClick={back} className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-ink" aria-label="Schließen">
          <X size={16} />
        </button>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto px-4 py-3.5">
        {v ? (
          <VisitDetail v={v} now={now} />
        ) : loading ? (
          <div className="skeleton h-72 rounded-xl" />
        ) : (
          <div className="py-10 text-center text-[12.5px] text-muted">Zu diesem Zeitfenster liegen keine Daten mehr vor (älter als 2 Tage).</div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
        <Link href={`/lager?v=${id}`} className="contents">
          <Button size="sm" className="w-full">
            Hof & Zeitfenster <ArrowUpRight size={13} />
          </Button>
        </Link>
        <Button size="sm" variant="ai" className="w-full" onClick={() => openCopilot(v ? `Was ist mit dem LKW ${v.plate} (${v.partner}) los und was sollen wir tun?` : "Wie ist die Lage auf dem LKW-Hof?")}>
          <Sparkles size={13} /> Frag die KI
        </Button>
      </div>
    </div>
  );
}

export function WarehousePanel() {
  const stock = useUi((s) => s.snap?.stock);
  const close = useUi((s) => s.openWarehouse);
  const pallets = stock?.reduce((a, s) => a + s.pallets, 0) ?? 0;
  const value = stock?.reduce((a, s) => a + s.valueEur, 0) ?? 0;
  const low = stock?.filter((s) => s.state !== "ok").length ?? 0;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <BackButton onClick={() => close(false)} label="Zurück zur Übersicht" />
          <div className="flex items-center gap-2 text-[15px] font-bold">
            <Warehouse size={16} /> Fertigwarenlager
          </div>
          <div className="truncate text-[11.5px] text-muted">
            Hochregallager + Halle C · {fmtInt(pallets)} Paletten · {fmtKEur(value)}
            {low ? ` · ${low} unter Sicherheitsbestand` : ""}
          </div>
        </div>
        <button onClick={() => close(false)} className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-ink" aria-label="Schließen">
          <X size={16} />
        </button>
      </div>
      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto px-3 py-3">
        <StockLegend className="rounded-lg bg-panel-2 px-2.5 py-2" />
        <div className="px-1 text-[11px] text-muted">Klick auf einen Artikel: wann, wo und auf welcher Maschine gefertigt, Gut- und Schlechtteile, Aufträge.</div>
        {(stock ?? []).map((s) => (
          <StockCard key={s.productId} s={s} onClick={() => useUi.getState().selectProduct(s.productId)} />
        ))}
      </div>
      <div className="border-t border-line p-3">
        <Link href="/lager" className="contents">
          <Button size="sm" className="w-full">
            Lager & LKW-Hof öffnen <ArrowUpRight size={13} />
          </Button>
        </Link>
      </div>
    </div>
  );
}

type GateFilter = "alle" | "erwartet" | "drin" | "raus" | "spaet";

/** Alle Zeitfenster des heutigen Produktionstags (ohne Prognosen), mit Live-Stand aus dem Snapshot */
function useTodayVisits() {
  const live = useUi((s) => s.snap?.visits);
  const [day, setDay] = useState<VisitView[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/yard?range=heute", { cache: "no-store" });
        if (r.ok && alive) setDay((await r.json()).visits);
      } catch {}
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const byId = new Map((live ?? []).map((v) => [v.id, v]));
  return { ready: day !== null, all: (day ?? []).filter((v) => !v.forecast).map((v) => byId.get(v.id) ?? v) };
}

const byTime = (a: VisitView, b: VisitView) => (a.arrivedAt ?? a.arriveAt) - (b.arrivedAt ?? b.arriveAt);

/** Verladerampe: wer steht gerade dran, wer war heute da, wer kommt noch – Klick auf ein Tor im 3D-Werk */
export function DockPanel({ dock }: { dock: number }) {
  const open = useUi((s) => s.openDock);
  const select = useUi((s) => s.selectVisit);
  const now = useUi((s) => s.snap?.now ?? Date.now());
  const { ready, all } = useTodayVisits();
  const [scope, setScope] = useState<"rampe" | "alle">("rampe");
  const atDock = all.filter((v) => v.dock === dock).sort(byTime);
  const current = atDock.find((v) => v.status === "RAMPE");
  const next = atDock.find((v) => v.status === "ERWARTET" || v.status === "AM_TOR" || v.status === "WARTET");
  const ordered = (scope === "rampe" ? atDock : all.slice().sort(byTime));
  const cnt = dayCounts(atDock);
  const busy = (d: number) => all.find((v) => v.dock === d && v.status === "RAMPE");
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <BackButton onClick={() => open(null)} label="Zurück zur Übersicht" />
            <div className="flex items-center gap-2 text-[15px] font-bold">
              <Warehouse size={16} /> Rampe {dock} · Verladetor
            </div>
            <div className="text-[11.5px] text-muted">Westfassade Halle B · Lager & Versand · LKW des heutigen Tages</div>
          </div>
          <button onClick={() => open(null)} className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-ink" aria-label="Schließen">
            <X size={16} />
          </button>
        </div>
        {/* Rampe wechseln */}
        <div className="mt-2.5 grid grid-cols-6 gap-1">
          {[1, 2, 3, 4, 5, 6].map((d) => {
            const b = busy(d);
            return (
              <button key={d} onClick={() => open(d)} title={b ? `Rampe ${d}: ${b.plate} (${b.partner})` : `Rampe ${d}: frei`} className={cn("rounded-lg border py-1 text-center", d === dock ? "border-accent bg-accent-soft/50" : "border-line bg-panel hover:border-faint")}>
                <div className="num text-[13px] font-bold">{d}</div>
                <div className={cn("mx-auto mt-0.5 h-1.5 w-1.5 rounded-full", b ? (b.overstayMin > 0 ? "bg-crit" : "bg-accent") : "bg-ok")} />
              </button>
            );
          })}
        </div>
        <div className={cn("mt-2 rounded-xl border px-3 py-2", current ? (current.overstayMin > 0 ? "border-crit/50 bg-crit-soft/40" : "border-accent/40 bg-accent-soft/30") : "border-line bg-panel-2")}>
          <div className="label text-[9px]">Jetzt an Rampe {dock}</div>
          {current ? (
            <button onClick={() => select(current.id)} className="mt-0.5 flex w-full items-center gap-2 text-left">
              <Plate text={current.plate} small />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{current.partner}</span>
              <span className="truncate text-[10.5px] text-muted">{current.stateText.replace(` an Rampe ${dock}`, "")}</span>
            </button>
          ) : (
            <div className="mt-0.5 text-[12px] font-semibold text-ok">
              frei{next ? <span className="font-normal text-ink-2"> · nächstes Fahrzeug {next.plate} ({next.partner}) {next.arrivedAt ? "wartet bereits" : `ca. ${fmtTime(next.etaKnown ? next.arriveAt : next.slotStart)}`}</span> : <span className="font-normal text-muted"> · heute kein weiteres Fahrzeug eingeplant</span>}
            </div>
          )}
        </div>
        <div className="mt-2 rounded-xl border border-line bg-panel-2 px-3 py-2">
          <Fraction big label={`LKW an Rampe ${dock} heute abgefertigt`} done={cnt.all.done} total={cnt.all.total} />
          <div className="mt-1.5 grid grid-cols-3 gap-3">
            <Fraction label="Abholungen" done={cnt.abholung.done} total={cnt.abholung.total} />
            <Fraction label="Anlieferungen" done={cnt.anlieferung.done} total={cnt.anlieferung.total} />
            <Fraction label="Kommen noch" done={atDock.filter((v) => v.status === "ERWARTET").length} total={cnt.all.total} />
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          {(
            [
              ["rampe", `Rampe ${dock} · ${atDock.length}`],
              ["alle", `Alle Rampen · ${all.length}`],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setScope(k)} className={cn("whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold", scope === k ? "bg-ink text-bg" : "text-ink-2 hover:bg-panel-3")}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll-thin flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
        {ordered.map((v, i) => (
          <GateRow key={v.id} v={v} now={now} nr={`${i + 1}/${ordered.length}`} dockLabel={scope === "alle"} onClick={() => select(v.id)} />
        ))}
        {ready && !ordered.length && <div className="py-8 text-center text-[12px] text-muted">Heute keine Fahrzeuge an dieser Rampe.</div>}
        {!ready && <div className="skeleton h-64 rounded-xl" />}
        <Legend
          className="rounded-lg bg-panel-2 px-2.5 py-2"
          items={[
            { color: "var(--accent)", kind: "dot", label: "blauer Punkt: Rampe belegt" },
            { color: "var(--ok)", kind: "dot", label: "grün: Rampe frei" },
            { color: "var(--crit)", kind: "dot", label: "rot: Standzeit an der Rampe überschritten" },
          ]}
          note="Zuweisung kann sich ändern: ist die geplante Rampe belegt, disponiert das Yard-Management auf eine freie um"
        />
      </div>
    </div>
  );
}

/** Pförtnerbuch am Werkstor: wer kommt heute, wer ist eingefahren, wer ausgefahren – mit Verspätungen */
export function GatePanel() {
  const close = useUi((s) => s.openGate);
  const select = useUi((s) => s.selectVisit);
  const now = useUi((s) => s.snap?.now ?? Date.now());
  const [f, setF] = useState<GateFilter>("alle");
  const { ready, all } = useTodayVisits();
  const day = ready ? all : null;
  const onSite = (v: VisitView) => v.status === "AM_TOR" || v.status === "WARTET" || v.status === "RAMPE";
  // verspätet = nach dem Zeitfenster eingefahren bzw. überfällig, oder später als geplant ausgefahren
  const isLateIn = (v: VisitView) => (v.arrivedAt !== undefined && v.lateMin > 5) || (v.status === "ERWARTET" && now > v.slotEnd);
  const isLateOut = (v: VisitView) => v.departLateMin > 5;
  const groups = {
    erwartet: all.filter((v) => v.status === "ERWARTET"),
    drin: all.filter(onSite),
    raus: all.filter((v) => v.status === "ABGEFAHREN"),
    spaet: all.filter((v) => isLateIn(v) || isLateOut(v)),
  };
  // chronologisch nummeriert: Nr. 1 = erstes Fahrzeug des Tages
  const ordered = all.slice().sort((a, b) => (a.arrivedAt ?? a.arriveAt) - (b.arrivedAt ?? b.arriveAt));
  const nr = new Map(ordered.map((v, i) => [v.id, i + 1]));
  const list = f === "alle" ? ordered : ordered.filter((v) => groups[f].includes(v));
  const lateIn = all.filter(isLateIn).length;
  const lateOut = all.filter(isLateOut).length;
  const cnt = dayCounts(all);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <BackButton onClick={() => close(false)} label="Zurück zur Übersicht" />
            <div className="flex items-center gap-2 text-[15px] font-bold">
              <DoorOpen size={16} /> Werkstor · Pförtnerbuch heute
            </div>
            <div className="text-[11.5px] text-muted">Ein- und Ausfahrten seit 06:00 · Schranke, Check-in, Zeitfenster</div>
          </div>
          <button onClick={() => close(false)} className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-ink" aria-label="Schließen">
            <X size={16} />
          </button>
        </div>
        <div className="mt-2.5 rounded-xl border border-line bg-panel-2 px-3 py-2.5">
          <Fraction big label="LKW heute abgefertigt" done={cnt.all.done} total={cnt.all.total} />
          <div className="mt-2 grid grid-cols-3 gap-3">
            <Fraction label="Abholungen" done={cnt.abholung.done} total={cnt.abholung.total} />
            <Fraction label="Anlieferungen" done={cnt.anlieferung.done} total={cnt.anlieferung.total} />
            <Fraction label="Entsorgung" done={cnt.entsorgung.done} total={cnt.entsorgung.total} />
          </div>
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          {(
            [
              ["erwartet", "Erwartet", groups.erwartet.length, ""],
              ["drin", "Auf dem Hof", groups.drin.length, ""],
              ["raus", "Ausgefahren", groups.raus.length, ""],
              ["spaet", "Verspätet", groups.spaet.length, groups.spaet.length ? "crit" : ""],
            ] as const
          ).map(([k, l, n, sev]) => (
            <button
              key={l}
              onClick={() => setF(f === k ? "alle" : k)}
              title={f === k ? "Filter aufheben" : `Nur „${l}“ anzeigen`}
              className={cn("rounded-lg border px-2 py-1.5 text-left", f === k ? (k === "spaet" ? "border-crit bg-crit-soft/50" : "border-accent bg-accent-soft/50") : "border-line bg-panel hover:border-faint")}
            >
              <div className="label truncate text-[8.5px]">{l}</div>
              <div className={cn("num text-[16px] font-bold leading-tight", sev === "crit" ? "text-crit" : "text-ink")}>
                {n}
                <span className="text-[11px] font-semibold text-muted">/{cnt.all.total}</span>
              </div>
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          {(["alle", "erwartet", "drin", "raus", "spaet"] as GateFilter[]).map((k) => (
            <button key={k} onClick={() => setF(k)} className={cn("whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold", f === k ? (k === "spaet" ? "bg-crit text-white" : "bg-ink text-bg") : "text-ink-2 hover:bg-panel-3")}>
              {k === "alle" ? "Alle" : k === "erwartet" ? "Kommen" : k === "drin" ? "Drin" : k === "raus" ? "Raus" : "Verspätet"}
            </button>
          ))}
          <span className="ml-auto truncate text-[10.5px] text-muted">
            verspätet: {lateIn} rein · {lateOut} raus
          </span>
        </div>
      </div>
      <div className="scroll-thin flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
        {list.map((v) => (
          <GateRow key={v.id} v={v} now={now} nr={`${nr.get(v.id)}/${ordered.length}`} onClick={() => select(v.id)} />
        ))}
        {day && !list.length && <div className="py-8 text-center text-[12px] text-muted">Keine Fahrzeuge in dieser Auswahl.</div>}
        {!day && <div className="skeleton h-64 rounded-xl" />}
        <Legend
          className="rounded-lg bg-panel-2 px-2.5 py-2"
          items={[
            { color: "var(--ok)", kind: "dot", label: "grün: pünktlich im Zeitfenster" },
            { color: "var(--crit)", kind: "dot", label: "rot +min: Verspätung bei Ein- bzw. Ausfahrt" },
            { color: "var(--accent)", kind: "dot", label: "blau: Fahrzeug noch auf dem Gelände" },
            { color: "var(--ok)", label: "✓ abgefertigt = Ladung fertig und ausgefahren" },
          ]}
          note="Einfahrt-Verspätung = nach Ende des Zeitfensters · Ausfahrt-Verspätung = nach geplanter Abfahrt"
        />
      </div>
    </div>
  );
}

function GateRow({ v, now, onClick, nr, dockLabel }: { v: VisitView; now: number; onClick: () => void; nr: string; dockLabel?: boolean }) {
  const inside = v.status === "AM_TOR" || v.status === "WARTET" || v.status === "RAMPE";
  const overdue = v.status === "ERWARTET" && now > v.slotEnd;
  const Icon = KIND_META[v.kind].icon;
  return (
    <button onClick={onClick} className={cn("w-full rounded-lg border px-2.5 py-2 text-left hover:bg-panel-2", overdue || v.overstayMin > 0 ? "border-crit/50" : "border-line")}>
      <div className="flex items-center gap-2">
        <span className="num shrink-0 rounded bg-panel-3 px-1 text-[9.5px] font-bold text-ink-2" title="Fahrzeug Nr. … von … heute">
          {nr}
        </span>
        <Icon size={14} className={cn("shrink-0", v.kind === "abholung" ? "text-accent" : v.kind === "anlieferung" ? "text-ok" : "text-muted")} />
        <Plate text={v.plate} small />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{v.partner}</span>
        {v.status === "ABGEFAHREN" ? (
          <span className="shrink-0 rounded-md bg-ok-soft px-1.5 py-0.5 text-[10px] font-bold text-ok">✓ abgefertigt</span>
        ) : inside ? (
          <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent-ink">auf dem Hof</span>
        ) : (
          <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold", overdue ? "bg-crit-soft text-crit" : "bg-panel-3 text-ink-2")}>{overdue ? "überfällig" : "kommt noch"}</span>
        )}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-md bg-panel-2 px-2 py-1">
          <div className="label text-[8.5px]">Einfahrt</div>
          {v.arrivedAt !== undefined ? (
            <div className="num">
              {new Date(v.arrivedAt).toDateString() !== new Date(now).toDateString() && <span className="text-muted">gestern </span>}
              <b>{fmtTime(v.arrivedAt)}</b> {v.lateMin > 0.5 ? <span className="font-semibold text-crit">+{Math.round(v.lateMin)} min</span> : <span className="text-ok">pünktlich</span>}
            </div>
          ) : overdue ? (
            <div className="num font-semibold text-crit">fehlt · +{Math.round((now - v.slotEnd) / 60_000)} min</div>
          ) : (
            <div className="num text-ink-2">
              erw. {fmtTime(v.slotStart)}–{fmtTime(v.slotEnd)}
              {v.etaKnown && v.lateMin > 5 ? <span className="text-warn"> · ETA {fmtTime(v.arriveAt)}</span> : null}
            </div>
          )}
        </div>
        <div className="rounded-md bg-panel-2 px-2 py-1">
          <div className="label text-[8.5px]">Ausfahrt</div>
          {v.departedAt !== undefined ? (
            <div className="num">
              <b>{fmtTime(v.departedAt)}</b> {v.departLateMin > 0.5 ? <span className="font-semibold text-crit">+{Math.round(v.departLateMin)} min</span> : <span className="text-ok">pünktlich</span>}
            </div>
          ) : inside ? (
            <div className={cn("num", v.departLateMin > 0 ? "font-semibold text-crit" : "text-accent")}>{v.departLateMin > 0 ? `überfällig +${Math.round(v.departLateMin)} min` : `geplant ${fmtTime(v.plannedDepart)}`}</div>
          ) : (
            <div className="num text-muted">geplant {fmtTime(v.plannedDepart)}</div>
          )}
        </div>
      </div>
      <div className="mt-1 truncate text-[10.5px] text-muted">
        {dockLabel && v.dock ? <b className="text-ink-2">Rampe {v.dock} · </b> : null}
        {v.carrier} · {v.driver} · {v.cargo}
        {v.pallets ? ` · ${v.pallets} Pal.` : ""}
      </div>
    </button>
  );
}

/** Artikel im Leitstand: Chargen, Maschinen, Gut-/Schlechtteile – „Zurück“ führt zur Lagerübersicht */
export function ProductPanel({ id }: { id: string }) {
  const d = useProductDetail(id);
  const fromStock = useUi((s) => s.warehouseOpen);
  const back = () => useUi.getState().selectProduct(null);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <BackButton onClick={back} label={fromStock ? "Zurück zum Lager" : "Zurück zur Übersicht"} />
          <div className="truncate text-[15px] font-bold">{d ? d.product.name : "Artikel"}</div>
          <div className="truncate text-[11.5px] text-muted">{d ? `${d.product.id} · Rückverfolgung: wann, wo, welche Maschine` : "wird geladen …"}</div>
        </div>
        <button onClick={back} className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-ink" aria-label="Schließen">
          <X size={16} />
        </button>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto px-4 py-3.5">{d ? <ProductDetailView d={d} compact onVisit={(v) => useUi.getState().selectVisit(v)} /> : <div className="skeleton h-96 rounded-xl" />}</div>
      <div className="border-t border-line p-3">
        <Link href={`/lager?p=${id}`} className="contents">
          <Button size="sm" className="w-full">
            Im Lager öffnen <ArrowUpRight size={13} />
          </Button>
        </Link>
      </div>
    </div>
  );
}

/** Kompakte Hofliste im Leitstand: auf dem Gelände, dann nächste Ankünfte */
export function YardList() {
  const visits = useUi((s) => s.snap?.visits);
  const now = useUi((s) => s.snap?.now ?? Date.now());
  const select = useUi((s) => s.selectVisit);
  const yard = useUi((s) => s.snap?.yard);
  const list = (visits ?? []).filter((v) => v.status !== "ABGEFAHREN");
  const onSite = list.filter((v) => v.status !== "ERWARTET");
  const next = list.filter((v) => v.status === "ERWARTET").slice(0, 8);
  return (
    <div className="space-y-1.5">
      {yard && (
        <button onClick={() => useUi.getState().openGate(true)} className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-left hover:border-faint" title="Pförtnerbuch öffnen">
          <Fraction label="LKW heute abgefertigt · Klick: Pförtnerbuch" done={yard.doneToday} total={yard.doneToday + yard.onSite + yard.expectedToday} />
        </button>
      )}
      <div className="label px-1 pt-1">Auf dem Gelände · {onSite.length}</div>
      {onSite.length ? onSite.map((v) => <VisitRow key={v.id} v={v} now={now} onClick={() => select(v.id)} />) : <div className="px-1 text-[11.5px] text-muted">Kein Fahrzeug auf dem Hof.</div>}
      <div className="label px-1 pt-2">Als Nächstes erwartet</div>
      {next.map((v) => (
        <VisitRow key={v.id} v={v} now={now} onClick={() => select(v.id)} />
      ))}
      <VisitLegend className="rounded-lg bg-panel-2 px-2.5 py-2" />
    </div>
  );
}
