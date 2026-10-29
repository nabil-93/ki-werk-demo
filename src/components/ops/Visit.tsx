"use client";

// LKW-Zeitfenster: Kennzeichen, Listenzeile und Detailkarte mit Live-Zählern (Standzeit, Verspätung)

import { ArrowRight, Clock, Container, Factory, MapPin, PackageCheck, Phone, Recycle, Timer, Truck, User } from "lucide-react";
import type { VisitView } from "@/lib/sim/types";
import { fmtInt, fmtNum, fmtShortDate, fmtTime } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { Badge } from "@/components/ui/ui";
import { Legend } from "@/components/ui/chartkit";
import ProductArt from "./ProductArt";

const MIN = 60_000;

/** Dauer als h:mm:ss */
export function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Deutsches Kfz-Kennzeichen mit EU-Feld */
export function Plate({ text, small, className }: { text: string; small?: boolean; className?: string }) {
  if (text === "–") return <span className={cn("text-[11px] font-semibold text-muted", className)}>noch nicht disponiert</span>;
  return (
    <span className={cn("inline-flex shrink-0 items-stretch overflow-hidden rounded-[4px] border-[1.5px] border-[#1a1a1a] bg-white leading-none text-[#111] shadow-[0_1px_0_rgba(0,0,0,0.15)]", small ? "h-[18px]" : "h-[24px]", className)}>
      <span className={cn("flex flex-col items-center justify-center bg-[#0b3fa8] text-white", small ? "w-[9px] text-[5.5px]" : "w-[12px] text-[7px]")}>
        <span className="text-[#ffd200]" style={{ fontSize: small ? 5 : 6 }}>
          ✦
        </span>
        D
      </span>
      <span className={cn("flex items-center whitespace-nowrap font-bold tracking-[0.06em]", small ? "px-1 text-[10px]" : "px-1.5 text-[13px]")} style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
        {text}
      </span>
    </span>
  );
}

export function VisitLegend({ className }: { className?: string }) {
  return (
    <Legend
      className={className}
      items={[
        { color: "var(--accent)", kind: "dot", label: "blaues Symbol: Abholung (Fertigware zum Kunden)" },
        { color: "var(--ok)", kind: "dot", label: "grün: Anlieferung (Rohstoff/Packmittel)" },
        { color: "var(--faint)", kind: "dot", label: "grau: Entsorgung" },
        { color: "var(--crit)", kind: "ring", label: "roter Rahmen/Zähler: überfällig oder Standzeit überschritten" },
        { color: "var(--warn)", kind: "box", label: "gelbes Schild: Verspätung erwartet" },
        { color: "var(--ink-2)", kind: "dash", label: "gestrichelter Rahmen: Prognose aus offenem Auftrag" },
      ]}
      note="Zähler = Zeit seit Ankunft am Tor (h:mm:ss)"
    />
  );
}

export const KIND_META = {
  abholung: { label: "Abholung", icon: PackageCheck, cls: "bg-accent-soft text-accent-ink" },
  anlieferung: { label: "Anlieferung", icon: Container, cls: "bg-ok-soft text-ok" },
  entsorgung: { label: "Entsorgung", icon: Recycle, cls: "bg-panel-3 text-ink-2" },
} as const;

const STATUS_LABEL: Record<VisitView["status"], string> = { ERWARTET: "Erwartet", AM_TOR: "Am Tor", WARTET: "Wartet", RAMPE: "An der Rampe", ABGEFAHREN: "Abgefahren" };

export function KindBadge({ kind }: { kind: VisitView["kind"] }) {
  const k = KIND_META[kind];
  const Icon = k.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold", k.cls)}>
      <Icon size={11} /> {k.label}
    </span>
  );
}

/** Live-Zähler: auf dem Gelände (läuft), Überziehung (rot), Überfälligkeit (rot) */
function liveTimes(v: VisitView, now: number) {
  const onSite = v.arrivedAt !== undefined ? (v.departedAt ?? now) - v.arrivedAt : 0;
  // 5 min Toleranz wie im Yard-Management
  const over = v.arrivedAt !== undefined && onSite - v.dwellMin * MIN > 5 * MIN ? onSite - v.dwellMin * MIN : 0;
  const overdue = v.status === "ERWARTET" && !v.forecast && now > v.slotEnd ? now - v.slotEnd : 0;
  const lateArr = v.arrivedAt !== undefined ? Math.max(0, v.arrivedAt - v.slotEnd) : 0;
  return { onSite, over, overdue, lateArr };
}

/** Fortschritt „erledigt / gesamt“, z. B. 5/19 LKW abgefertigt */
export function Fraction({ done, total, label, className, big }: { done: number; total: number; label: string; className?: string; big?: boolean }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className={cn(big ? "flex items-baseline justify-between gap-2" : "flex flex-col")}>
        <span className="label truncate text-[9px]" title={label}>
          {label}
        </span>
        <span className={cn("num shrink-0 font-bold leading-tight", big ? "text-[20px]" : "text-[14px]")}>
          {done}
          <span className="font-semibold text-muted">/{total}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-3">
        <div className="h-full rounded-full bg-ok transition-[width] duration-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

/** Tageszählung je Art: abgefertigt / insgesamt (ohne Prognosen) */
export function dayCounts(list: VisitView[]) {
  const real = list.filter((v) => !v.forecast);
  const c = (k?: VisitView["kind"]) => {
    const xs = k ? real.filter((v) => v.kind === k) : real;
    return { done: xs.filter((v) => v.status === "ABGEFAHREN").length, inside: xs.filter((v) => v.status === "AM_TOR" || v.status === "WARTET" || v.status === "RAMPE").length, total: xs.length };
  };
  return { all: c(), abholung: c("abholung"), anlieferung: c("anlieferung"), entsorgung: c("entsorgung") };
}

export function VisitRow({ v, now, onClick, active, index }: { v: VisitView; now: number; onClick?: () => void; active?: boolean; index?: string }) {
  const t = liveTimes(v, now);
  const Icon = KIND_META[v.kind].icon;
  const onSite = v.status === "AM_TOR" || v.status === "WARTET" || v.status === "RAMPE";
  return (
    <button
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-left transition-colors",
        active ? "border-accent bg-accent-soft/40 ring-2 ring-accent/20" : "border-line hover:bg-panel-2",
        v.state === "crit" && !active && "border-crit/50",
        v.forecast && "border-dashed",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon size={15} className={cn("shrink-0", v.kind === "abholung" ? "text-accent" : v.kind === "anlieferung" ? "text-ok" : "text-muted")} />
        <Plate text={v.plate} small />
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold">{v.partner}</div>
          <div className="truncate text-[10.5px] text-muted">
            {v.cargo} · {fmtInt(v.qty)} {v.unit}
            {v.pallets ? ` · ${v.pallets} Pal.` : ""}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="num text-[11px] font-semibold">
          {v.status === "ABGEFAHREN" ? `${fmtTime(v.arrivedAt!)}–${fmtTime(v.departedAt!)}` : v.arrivedAt ? `seit ${fmtTime(v.arrivedAt)}` : `${fmtTime(v.slotStart)}–${fmtTime(v.slotEnd)}`}
        </div>
        <div className="flex justify-end">
          {onSite ? (
            <span className={cn("num text-[11px] font-bold", t.over > 0 ? "text-crit" : "text-ink-2")}>
              <Timer size={10} className="mr-0.5 inline" />
              {clock(t.onSite)}
              {t.over > 0 && ` (+${Math.round(t.over / MIN)} min)`}
            </span>
          ) : t.overdue > 0 ? (
            <span className="num text-[11px] font-bold text-crit">überfällig {clock(t.overdue)}</span>
          ) : (
            <Badge sev={v.state === "crit" ? "crit" : v.state === "warn" ? "warn" : v.status === "ABGEFAHREN" ? "ok" : "neutral"}>{v.forecast ? "Prognose" : v.status === "ERWARTET" && v.lateMin > 5 ? `+${Math.round(v.lateMin)} min` : STATUS_LABEL[v.status]}</Badge>
          )}
        </div>
      </div>
      <div className="col-span-2 flex items-center gap-2 text-[10.5px] text-muted">
        {index && <span className="num shrink-0 rounded bg-panel-3 px-1 text-[9.5px] font-bold text-ink-2">Nr. {index}</span>}
        <span className="truncate">{v.stateText}</span>
        {v.dock > 0 && v.status !== "ABGEFAHREN" && <span className="ml-auto shrink-0">Rampe {v.dock}</span>}
      </div>
    </button>
  );
}

function Step({ label, t, done, active, warn }: { label: string; t?: number; done: boolean; active?: boolean; warn?: boolean }) {
  return (
    <div className="relative flex flex-1 flex-col items-center text-center">
      <span className={cn("z-10 h-3 w-3 rounded-full border-2", done ? (warn ? "border-crit bg-crit" : "border-ok bg-ok") : active ? "border-accent bg-panel" : "border-line bg-panel")} />
      <span className="mt-1 text-[9.5px] font-semibold text-ink-2">{label}</span>
      <span className="num text-[10px] text-muted">{t ? fmtTime(t) : "–"}</span>
    </div>
  );
}

export function VisitDetail({ v, now }: { v: VisitView; now: number }) {
  const t = liveTimes(v, now);
  const onSite = v.status === "AM_TOR" || v.status === "WARTET" || v.status === "RAMPE";
  const lateCustomer = v.customerEta && v.customerDue ? v.customerEta - v.customerDue : 0;
  const steps = ["ERWARTET", "AM_TOR", "WARTET", "RAMPE", "ABGEFAHREN"];
  const si = steps.indexOf(v.status);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Plate text={v.plate} />
        {v.trailer !== "–" && (
          <span className="flex items-center gap-1 text-[10.5px] text-muted">
            Auflieger <Plate text={v.trailer} small />
          </span>
        )}
        <KindBadge kind={v.kind} />
        <Badge sev={v.state === "crit" ? "crit" : v.state === "warn" ? "warn" : v.status === "ABGEFAHREN" ? "ok" : "info"}>{STATUS_LABEL[v.status]}</Badge>
      </div>

      {/* Live-Zähler */}
      {onSite ? (
        <div className={cn("rounded-xl border p-3", t.over > 0 ? "border-crit/50 bg-crit-soft/50" : "border-line bg-panel-2")}>
          <div className="label text-[9px]">Auf dem Werksgelände seit {fmtTime(v.arrivedAt!)}</div>
          <div className={cn("num text-[26px] font-bold leading-tight tracking-[-0.02em]", t.over > 0 ? "text-crit" : "text-ink")}>{clock(t.onSite)}</div>
          <div className="mt-0.5 text-[11px] text-ink-2">
            geplante Standzeit {v.dwellMin} min{t.over > 0 ? <b className="text-crit"> · überschritten um {clock(t.over)}</b> : ` · noch ${Math.max(0, Math.round(v.dwellMin - t.onSite / MIN))} min im Plan`}
          </div>
          <div className="mt-1 text-[11px] text-muted">{v.stateText}</div>
        </div>
      ) : v.status === "ERWARTET" ? (
        <div className={cn("rounded-xl border p-3", t.overdue > 0 ? "border-crit/50 bg-crit-soft/50" : "border-line bg-panel-2")}>
          <div className="label text-[9px]">{v.forecast ? "Prognose aus offenem Auftrag" : `Zeitfenster ${fmtShortDate(v.slotStart)} ${fmtTime(v.slotStart)}–${fmtTime(v.slotEnd)}`}</div>
          {t.overdue > 0 ? (
            <>
              <div className="num text-[24px] font-bold text-crit">überfällig {clock(t.overdue)}</div>
              <div className="text-[11px] text-ink-2">{v.etaKnown ? `Telematik-ETA ${fmtTime(v.arriveAt)}` : "Keine Telematik-Position – Spedition kontaktieren"}</div>
            </>
          ) : (
            <>
              <div className="num text-[24px] font-bold">Ankunft in {clock(Math.max(0, (v.etaKnown ? v.arriveAt : v.slotStart) - now))}</div>
              <div className={cn("text-[11px]", v.lateMin > 5 ? "font-semibold text-warn" : "text-ink-2")}>{v.etaKnown ? `Telematik-ETA ${fmtTime(v.arriveAt)}${v.lateMin > 5 ? ` · ca. ${Math.round(v.lateMin)} min nach Zeitfenster` : " · im Zeitfenster"}` : "Position noch nicht übermittelt (ETA ab 3 h vor Ankunft)"}</div>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-panel-2 p-3">
          <div className="label text-[9px]">Abgefertigt</div>
          <div className="num text-[20px] font-bold">
            {fmtTime(v.arrivedAt!)} → {fmtTime(v.departedAt!)}
          </div>
          <div className={cn("text-[11px]", t.over > 0 ? "font-semibold text-crit" : "text-ink-2")}>
            Standzeit {Math.round(t.onSite / MIN)} min (Plan {v.dwellMin} min){t.over > 0 ? ` · +${Math.round(t.over / MIN)} min` : ""}
          </div>
        </div>
      )}
      {t.lateArr > 0 && (
        <div className="rounded-lg bg-crit-soft px-3 py-1.5 text-[11.5px] font-semibold text-crit">
          Verspätet angekommen: {Math.round(t.lateArr / MIN)} min nach Zeitfenster ({fmtTime(v.slotStart)}–{fmtTime(v.slotEnd)})
        </div>
      )}

      {/* Ablauf */}
      <div className="relative flex px-1">
        <div className="absolute left-[10%] right-[10%] top-[5px] h-[2px] bg-line" />
        <Step label="Avis" t={v.slotStart} done={si >= 0} />
        <Step label="Tor" t={v.arrivedAt} done={si >= 1} active={si === 0} warn={t.lateArr > 0} />
        <Step label="Rampe" t={v.dockAt} done={si >= 3} active={si === 2} />
        <Step label={v.kind === "abholung" ? "Beladen" : "Entladen"} t={v.doneAt} done={!!v.doneAt} active={si === 3 && !v.doneAt} />
        <Step label="Abfahrt" t={v.departedAt} done={si >= 4} warn={t.over > 0} />
      </div>

      {/* Ware */}
      <div className="flex items-center gap-3 rounded-xl border border-line p-2.5">
        {v.productId ? <ProductArt productId={v.productId} size={58} /> : <div className="flex h-[58px] w-[58px] items-center justify-center rounded-lg bg-panel-2 text-muted">{v.kind === "entsorgung" ? <Recycle size={26} /> : <Container size={26} />}</div>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold">{v.cargo}</div>
          <div className="num text-[12px] text-ink-2">
            {fmtInt(v.qty)} {v.unit}
            {v.pallets ? ` · ${v.pallets} Paletten` : ""} · {fmtNum(v.weightKg / 1000, 1)} t
          </div>
          <div className="truncate text-[10.5px] text-muted">
            {v.orderId ? `Auftrag ${v.orderId} · ` : ""}
            {v.ref}
          </div>
        </div>
      </div>

      {/* Route */}
      <div className="rounded-xl border border-line p-2.5">
        <div className="flex items-center gap-2 text-[11.5px]">
          <div className="min-w-0 flex-1">
            <div className="label text-[9px]">von</div>
            <div className="truncate font-semibold">{v.from.name}</div>
            <div className="truncate text-muted">
              <MapPin size={10} className="mr-0.5 inline" />
              {v.from.city} ({v.from.country})
            </div>
          </div>
          <ArrowRight size={15} className="shrink-0 text-muted" />
          <div className="min-w-0 flex-1 text-right">
            <div className="label text-[9px]">nach</div>
            <div className="truncate font-semibold">{v.to.name}</div>
            <div className="truncate text-muted">
              <MapPin size={10} className="mr-0.5 inline" />
              {v.to.city} ({v.to.country})
            </div>
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5 text-[11px]">
          <span className="text-muted">{fmtInt(v.km)} km</span>
          {v.customerEta && (
            <span className={cn("num", lateCustomer > 0 ? "font-semibold text-crit" : "text-ink-2")}>
              Ankunft Kunde {fmtShortDate(v.customerEta)} {fmtTime(v.customerEta)}
              {v.customerDue ? (lateCustomer > 0 ? ` · ${fmtNum(lateCustomer / 3_600_000, 1)} h nach Liefertermin` : " · im Liefertermin") : ""}
            </span>
          )}
        </div>
      </div>

      {/* Fahrzeug & Fahrer */}
      <div className="grid grid-cols-2 gap-2 text-[11.5px]">
        {[
          [Truck, "Spedition", v.carrier],
          [User, "Fahrer", v.driver],
          [Phone, "Telefon", v.phone],
          [Factory, "Fahrzeug", v.vehicle],
          [Clock, "Rampe", v.dock ? `Rampe ${v.dock}` : "wird zugewiesen"],
          [Timer, "Plan-Standzeit", `${v.dwellMin} min (${v.kind === "abholung" ? "Beladen" : "Entladen"} ${v.handleMin} min)`],
        ].map(([Icon, l, val]) => {
          const I = Icon as typeof Truck;
          return (
            <div key={l as string} className="min-w-0 rounded-lg bg-panel-2 px-2.5 py-1.5">
              <div className="label flex items-center gap-1 text-[9px]">
                <I size={10} /> {l as string}
              </div>
              <div className="truncate font-semibold" title={val as string}>
                {val as string}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] leading-snug text-faint">Fahrerdaten nach DSGVO nur für Werksabwicklung (Telefon maskiert). Zeiten aus Pförtner-Check-in, Rampenscanner und Telematik der Spedition.</div>
    </div>
  );
}
