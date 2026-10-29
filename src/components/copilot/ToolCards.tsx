"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, CheckCircle2, FileText, PackageCheck, TriangleAlert, X } from "lucide-react";
import type { ToolCard } from "@/lib/ai/tools";
import type { FeasibilityResult, MaintenanceOption } from "@/lib/sim/analysis";
import type { Kpis, MachineView, MaterialView, OrderView, ShipmentView, Ticket, Alert } from "@/lib/sim/types";
import type { SearchHit } from "@/lib/knowledge";
import type { RiskRadar } from "@/lib/sim/risks";
import type { WhatIfResult } from "@/lib/sim/whatif";
import { WhatIfView } from "@/components/health/WhatIf";
import { DEFECTS } from "@/lib/sim/catalog";
import { fmtDateTime, fmtDuration, fmtEur, fmtInt, fmtNum, fmtPct, fmtTime } from "@/lib/ai/format";
import { refreshSnapshot, ticketAction, useUi } from "@/lib/client/store";
import { cn } from "@/lib/client/cn";
import { Badge, Button, Progress, SourceTag, StatusDot, StatusPill, sevForRisk } from "@/components/ui/ui";
import { BarRow, Gauge } from "@/components/ui/charts";

function Box({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-line bg-panel p-3", className)}>{children}</div>;
}

function Overview({ data }: { data: { kpis: Kpis; shift: string; alerts: Alert[] } }) {
  const k = data.kpis;
  const cells = [
    ["OEE", fmtPct(k.oee)],
    ["Ausbringung", fmtInt(k.outputToday)],
    ["Ausschuss", fmtPct(k.scrapRate, 2)],
    ["Liefertreue", fmtPct(k.onTimeDelivery)],
  ];
  return (
    <Box>
      <div className="grid grid-cols-4 gap-2">
        {cells.map(([l, v]) => (
          <div key={l}>
            <div className="label text-[9px]">{l}</div>
            <div className="num text-[14px] font-semibold">{v}</div>
          </div>
        ))}
      </div>
      {data.alerts.length > 0 && (
        <div className="mt-2.5 space-y-1 border-t border-line-2 pt-2">
          {data.alerts.slice(0, 3).map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-[11.5px]">
              <StatusDot sev={a.severity} />
              <SourceTag source={a.source} />
              <span className="truncate text-ink-2">{a.title}</span>
            </div>
          ))}
        </div>
      )}
    </Box>
  );
}

function Machines({ data }: { data: MachineView[] }) {
  return (
    <Box className="p-1.5">
      {data.map((m) => (
        <Link key={m.id} href={`/waechter?tab=akte&m=${m.id}`} className="grid grid-cols-[52px_92px_minmax(0,1fr)_44px] items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-panel-2">
          <span className="num text-[12px] font-semibold">{m.id}</span>
          <StatusPill status={m.status} />
          <div className="flex items-center gap-2">
            <Progress value={m.prediction.p72} sev={sevForRisk(m.prediction.p72)} height={5} />
          </div>
          <span className="num text-right text-[11.5px] text-muted">{fmtPct(m.prediction.p72, 0)}</span>
        </Link>
      ))}
    </Box>
  );
}

function Prediction({ data }: { data: { view: MachineView; options: { options: MaintenanceOption[]; planned: { costEur: number }; unplanned: { costEur: number } } } }) {
  const v = data.view;
  const p = v.prediction;
  return (
    <Box>
      <div className="flex items-start gap-4">
        <Gauge value={p.p72} size={110} label={fmtPct(p.p72, 0)} sub="Ausfall 72 h" thickness={9} />
        <div className="min-w-0 flex-1 space-y-1.5 pt-1">
          <div className="flex items-center gap-2">
            <span className="num text-[13px] font-bold">{v.id}</span>
            <StatusPill status={v.status} />
            <Badge sev={p.zone === "D" ? "crit" : p.zone === "C" ? "warn" : "ok"}>ISO-Zone {p.zone}</Badge>
          </div>
          <div className="text-[11.5px] text-muted">
            Restlaufzeit <b className="num text-ink">{p.rulH === null ? "> 30 Tage" : fmtDuration(p.rulH)}</b> · Zustand <b className="num text-ink">{p.health}/100</b>
          </div>
          {p.drivers.map((d) => (
            <div key={d.label} className="flex items-center justify-between gap-2 text-[11.5px]">
              <span className="truncate text-ink-2">{d.label}</span>
              <span className="num shrink-0 text-muted">{d.value}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line-2 pt-2.5">
        <div className="rounded-lg bg-ok-soft px-2.5 py-1.5">
          <div className="label text-[9px] text-ok">Geplant</div>
          <div className="num text-[13px] font-semibold text-ok">{fmtEur(data.options.planned.costEur)}</div>
        </div>
        <div className="rounded-lg bg-crit-soft px-2.5 py-1.5">
          <div className="label text-[9px] text-crit">Ungeplanter Ausfall</div>
          <div className="num text-[13px] font-semibold text-crit">{fmtEur(data.options.unplanned.costEur)}</div>
        </div>
      </div>
    </Box>
  );
}

function Orders({ data }: { data: OrderView[] }) {
  if (!data.length) return <Box className="text-[12px] text-muted">Keine Aufträge gefunden.</Box>;
  return (
    <Box className="p-1.5">
      {data.map((o) => (
        <Link key={o.id} href={`/vertrieb?o=${o.id}`} className="grid grid-cols-[78px_minmax(0,1fr)_64px] items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-panel-2">
          <span className="num text-[11.5px] font-semibold">{o.id}</span>
          <div className="min-w-0">
            <div className="truncate text-[12px]">{o.customer}</div>
            <div className="truncate text-[10.5px] text-muted">
              {o.productShort} · {o.machineId} · bis {fmtDateTime(o.due)}
            </div>
          </div>
          <Badge sev={o.risk === "gefaehrdet" ? "crit" : o.risk === "beobachten" ? "warn" : "ok"} className="justify-self-end">
            {fmtPct(o.onTimeProb, 0)}
          </Badge>
        </Link>
      ))}
    </Box>
  );
}

function Delivery({ data }: { data: { order: OrderView; alternatives: { machineId: string; freeAt: number; risk: number; changeover: boolean }[] } }) {
  const o = data.order;
  const late = o.projectedDone > o.due;
  return (
    <Box>
      <div className="flex items-center justify-between">
        <div>
          <div className="num text-[13px] font-bold">{o.id}</div>
          <div className="text-[11.5px] text-muted">
            {o.customer} · {fmtInt(o.qty)} Stk {o.productShort}
          </div>
        </div>
        <Badge sev={o.risk === "gefaehrdet" ? "crit" : o.risk === "beobachten" ? "warn" : "ok"}>{fmtPct(o.onTimeProb, 0)} termintreu</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]">
        <div className="rounded-lg bg-panel-2 px-2.5 py-1.5">
          <div className="label text-[9px]">Liefertermin</div>
          <div className="num font-semibold">{fmtDateTime(o.due)}</div>
        </div>
        <div className={cn("rounded-lg px-2.5 py-1.5", late ? "bg-crit-soft text-crit" : "bg-ok-soft text-ok")}>
          <div className="label text-[9px] text-current">Prognose</div>
          <div className="num font-semibold">{fmtDateTime(o.projectedDone)}</div>
        </div>
      </div>
      {o.riskReason && <div className="mt-2 text-[11.5px] text-ink-2">{o.riskReason}</div>}
      {data.alternatives.length > 0 && (
        <div className="mt-2 text-[11px] text-muted">
          Alternativen: {data.alternatives.map((a) => `${a.machineId} (frei ${fmtDateTime(a.freeAt)}${a.changeover ? ", Rüsten" : ""})`).join(" · ")}
        </div>
      )}
    </Box>
  );
}

export function FeasibilityView({ data, compact }: { data: FeasibilityResult & { inquiryId?: string }; compact?: boolean }) {
  const inquiries = useUi((s) => s.snap?.inquiries);
  const inq = data.inquiryId ? inquiries?.find((i) => i.id === data.inquiryId) : undefined;
  const [busy, setBusy] = useState(false);
  const verdict = data.verdict === "machbar" ? "ok" : data.verdict === "nicht" ? "crit" : "warn";
  const start = Math.min(...data.plan.map((p) => p.start), Date.now());
  const end = Math.max(data.latestFinish, ...data.plan.map((p) => p.end));
  const span = Math.max(1, end - start);
  const title = { machbar: "Machbar – ohne Konflikte", konflikt: "Vollmenge nur mit Konflikten", teilweise: "Teilweise machbar", nicht: "Nicht machbar" }[data.verdict];
  return (
    <Box className={compact ? "" : "p-4"}>
      <div className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2", verdict === "ok" ? "bg-ok-soft text-ok" : verdict === "warn" ? "bg-warn-soft text-warn" : "bg-crit-soft text-crit")}>
        {verdict === "ok" ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
        <div className="min-w-0">
          <div className="text-[13px] font-bold">{title}</div>
          <div className="text-[11.5px] opacity-90">
            {fmtInt(data.qty)} Stk {data.productName} bis {fmtDateTime(data.due)}
          </div>
        </div>
        <div className="num ml-auto text-right text-[12px] font-semibold">{fmtEur(data.revenueEur)}</div>
      </div>
      {data.verdict !== "machbar" && data.restQty > 0 && (
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-ok/30 bg-ok-soft/60 px-2.5 py-2">
            <div className="label text-[9px] text-ok">Option A · konfliktfrei</div>
            <div className="num mt-0.5 text-[12.5px] font-semibold">{fmtInt(data.freeQty)} Stk zum Termin</div>
            {data.restDelivery && <div className="num text-[11px] text-muted">+ {fmtInt(data.restQty)} Stk bis {fmtDateTime(data.restDelivery)}</div>}
          </div>
          <div className="rounded-lg border border-warn/30 bg-warn-soft/60 px-2.5 py-2">
            <div className="label text-[9px] text-warn">Option B · Vorziehen</div>
            <div className="num mt-0.5 text-[12.5px] font-semibold">{fmtInt(data.plannedQty)} Stk zum Termin</div>
            <div className="text-[11px] text-muted">{data.impacts.filter((i) => !i.stillOnTime).length} Aufträge verspätet</div>
          </div>
        </div>
      )}
      <div className="mt-3 space-y-1.5">
        {data.plan.map((p, i) => (
          <div key={i} className="grid grid-cols-[46px_minmax(0,1fr)_72px] items-center gap-2">
            <span className="num text-[11.5px] font-semibold">{p.machineId}</span>
            <div className="relative h-5 rounded bg-panel-3">
              <div
                className={cn("absolute top-0 h-5 rounded text-[9.5px] font-semibold leading-5 text-white", p.mode === "frei" ? "bg-accent" : "bg-warn")}
                style={{ left: `${((p.start - start) / span) * 100}%`, width: `${Math.max(4, ((p.end - p.start) / span) * 100)}%` }}
              >
                <span className="px-1.5">{p.mode === "frei" ? "frei" : "vorgezogen"}</span>
              </div>
              <div className="absolute top-[-3px] h-[26px] w-px bg-crit" style={{ left: `${((data.latestFinish - start) / span) * 100}%` }} title="spätestes Produktionsende" />
            </div>
            <span className="num text-right text-[11px] text-muted">{fmtInt(p.qty)}</span>
          </div>
        ))}
        <div className="flex justify-between text-[10px] text-faint">
          <span>{fmtDateTime(start)}</span>
          <span className="text-crit">spätestens {fmtDateTime(data.latestFinish)}</span>
        </div>
      </div>
      <div className="mt-2.5 space-y-1 border-t border-line-2 pt-2.5">
        {data.material.map((m) => (
          <div key={m.id} className="flex items-center gap-2 text-[11.5px]">
            {m.ok ? <Check size={13} className="text-ok" /> : <X size={13} className="text-crit" />}
            <span className="truncate text-ink-2">{m.name}</span>
            <span className="num ml-auto shrink-0 text-muted">
              {fmtInt(m.needed)} / {fmtInt(m.available + m.inbound)} {m.unit}
            </span>
          </div>
        ))}
        {data.impacts.length > 0 && (
          <div className="pt-1 text-[11px] text-muted">
            Auswirkung: {data.impacts.slice(0, 3).map((i) => `${i.orderId} +${fmtDuration(i.delayH)}${i.stillOnTime ? "" : " ⚠"}`).join(" · ")}
          </div>
        )}
      </div>
      {inq && inq.status === "OFFEN" && data.plan.length > 0 && (
        <div className="mt-3 flex items-center gap-2 border-t border-line-2 pt-3">
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const free = data.plan.filter((p) => p.mode === "frei");
              const plan =
                data.verdict === "machbar" || !free.length
                  ? data.plan.map((p) => ({ machineId: p.machineId, qty: p.qty }))
                  : [...free.map((p) => ({ machineId: p.machineId, qty: p.qty })), { machineId: free[0].machineId, qty: data.restQty }];
              await ticketAction("confirm-inquiry", { id: inq.id, plan });
              await refreshSnapshot();
              setBusy(false);
            }}
          >
            <PackageCheck size={14} /> {data.verdict === "machbar" ? "Zusagen & in SAP anlegen" : "Option A zusagen & in SAP anlegen"}
          </Button>
          <span className="text-[11px] text-muted">Freigabe durch Vertrieb</span>
        </div>
      )}
      {inq && inq.status === "BESTAETIGT" && <div className="mt-3 flex items-center gap-2 text-[12px] font-semibold text-ok"><CheckCircle2 size={14} /> Zugesagt – Aufträge angelegt</div>}
    </Box>
  );
}

function Quality({ data }: { data: { views: MachineView[]; pareto: [string, number][] } }) {
  const max = Math.max(1, ...data.pareto.map((p) => p[1]));
  return (
    <Box className="space-y-2">
      {data.pareto.slice(0, 4).map(([k, n]) => (
        <BarRow key={k} label={DEFECTS[k as keyof typeof DEFECTS].label} value={n} max={max} right={`${fmtInt(n)} Stk`} color={k === "etikettenversatz" ? "var(--warn)" : "var(--accent)"} />
      ))}
      <div className="flex flex-wrap gap-1.5 border-t border-line-2 pt-2">
        {data.views
          .filter((v) => v.spcViolation || v.cpk < 1.33)
          .slice(0, 6)
          .map((v) => (
            <Badge key={v.id} sev={v.spcViolation ? "warn" : "neutral"}>
              {v.id} · Cpk {fmtNum(v.cpk, 2)}
              {v.spcViolation ? ` · ${v.spcViolation}` : ""}
            </Badge>
          ))}
      </div>
    </Box>
  );
}

function Materials({ data }: { data: MaterialView[] }) {
  return (
    <Box className="space-y-2">
      {data.map((m) => (
        <div key={m.id}>
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="truncate text-ink-2">{m.name}</span>
            <span className={cn("num font-semibold", m.state === "crit" ? "text-crit" : m.state === "warn" ? "text-warn" : "text-ink")}>{fmtNum(m.reachDays, 1)} Tage</span>
          </div>
          <Progress value={Math.min(1, m.reachDays / 10)} sev={m.state} height={5} className="mt-1" />
        </div>
      ))}
    </Box>
  );
}

function Shipments({ data }: { data: ShipmentView[] }) {
  return (
    <Box className="p-1.5">
      {data.slice(0, 7).map((s) => (
        <div key={s.id} className="grid grid-cols-[70px_minmax(0,1fr)_74px] items-center gap-2 rounded-lg px-2 py-1.5">
          <Badge sev={s.status === "UNTERWEGS" ? "info" : s.status === "ZUGESTELLT" ? "ok" : "neutral"}>{s.status === "BELADUNG" ? "Beladung" : s.status === "UNTERWEGS" ? "Unterwegs" : s.status === "ZUGESTELLT" ? "Zugestellt" : "Geplant"}</Badge>
          <div className="min-w-0">
            <div className="truncate text-[12px]">{s.customer}</div>
            <div className="truncate text-[10.5px] text-muted">
              {s.city} · {s.pallets} Pal. · Tor {s.dock}
            </div>
          </div>
          <span className="num text-right text-[11px] text-muted">{s.eta ? `ETA ${fmtTime(s.eta)}` : fmtTime(s.slot)}</span>
        </div>
      ))}
    </Box>
  );
}

const LAGE = { stabil: { sev: "ok", label: "stabil" }, angespannt: { sev: "warn", label: "angespannt" }, kritisch: { sev: "crit", label: "kritisch" } } as const;

function Risks({ data }: { data: RiskRadar }) {
  const l = LAGE[data.lage];
  return (
    <Box className="p-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge sev={l.sev} dot>
          Lage {l.label}
        </Badge>
        <span className="text-[11.5px] text-muted">
          erwartet in 72 h <b className="num text-ink">{fmtEur(data.totalEur)}</b> · mit Maßnahmen <b className="num text-ok">{fmtEur(data.withActionsEur)}</b>
        </span>
      </div>
      {data.items.length === 0 && <div className="rounded-lg bg-ok-soft px-2.5 py-2 text-[12px]">Keine relevanten Risiken in den nächsten 72 h.</div>}
      <div className="space-y-1">
        {data.items.slice(0, 6).map((r) => (
          <Link key={r.id} href={r.href} className="grid grid-cols-[74px_minmax(0,1fr)_64px] items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-panel-2">
            <span className="label truncate text-[9px]">{r.bereich}</span>
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium">{r.titel}</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <Progress value={r.p} sev={r.p >= 0.6 ? "crit" : r.p >= 0.3 ? "warn" : "info"} height={4} className="w-16" />
                <span className="num text-[10.5px] text-muted">{fmtPct(r.p, 0)} · {r.wann}</span>
              </div>
            </div>
            <span className={cn("num text-right text-[11.5px] font-semibold", r.eur >= 5000 ? "text-crit" : r.eur >= 1000 ? "text-warn" : "text-ink-2")}>{fmtEur(r.eur)}</span>
          </Link>
        ))}
      </div>
      {data.blind.length > 0 && <div className="mt-2 border-t border-line-2 pt-1.5 text-[10.5px] text-muted">Blinder Fleck: {data.blind.length} Maschinen ohne Datenanschluss ({data.blind.join(", ")})</div>}
    </Box>
  );
}

function Docs({ data }: { data: SearchHit[] }) {
  if (!data.length) return <Box className="text-[12px] text-muted">Keine Fundstellen.</Box>;
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => (
        <Box key={i} className="flex gap-2.5 p-2.5">
          <FileText size={15} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="num rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent-ink">{d.docId}</span>
              <span className="truncate text-[11.5px] font-semibold">{d.heading}</span>
            </div>
            <div className="mt-0.5 truncate text-[10.5px] text-muted">{d.title}</div>
            <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-ink-2">{d.text}</div>
          </div>
        </Box>
      ))}
    </div>
  );
}

export function TicketView({ ticket }: { ticket: Ticket }) {
  const live = useUi((s) => s.snap?.tickets.find((t) => t.id === ticket.id)) ?? ticket;
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    setBusy(true);
    await ticketAction(approve ? "approve" : "reject", { id: live.id });
    await refreshSnapshot();
    setBusy(false);
  };
  const kindLabel = { wartung: "Wartungsauftrag", umplanung: "Umplanung", bestellung: "Bestellung", "qs-sperre": "QS-Sperre", massnahme: "Maßnahme" }[live.kind];
  const st = live.status;
  return (
    <div className={cn("rounded-xl border p-3", st === "ENTWURF" ? "border-accent/40 bg-accent-soft/50" : "border-line bg-panel")}>
      <div className="flex items-center gap-2">
        <span className="num text-[11.5px] font-bold">{live.id}</span>
        <span className="text-[12px] font-semibold">{kindLabel}</span>
        {live.machineId && <span className="num text-[11.5px] text-muted">{live.machineId}{live.targetMachineId ? ` → ${live.targetMachineId}` : ""}</span>}
        <Badge sev={st === "ENTWURF" ? "info" : st === "ABGELEHNT" ? "neutral" : st === "ERLEDIGT" ? "ok" : "warn"} className="ml-auto">
          {st === "ENTWURF" ? "Freigabe nötig" : st === "FREIGEGEBEN" ? "Freigegeben" : st === "IN_ARBEIT" ? "In Arbeit" : st === "ERLEDIGT" ? "Erledigt" : "Abgelehnt"}
        </Badge>
      </div>
      <div className="mt-1.5 text-[11.5px] leading-snug text-ink-2">{live.reason}</div>
      <div className="num mt-1.5 flex flex-wrap gap-x-3 text-[10.5px] text-muted">
        {live.kind === "wartung" && <span>Start {fmtDateTime(live.start)} · {fmtDuration(live.durationH)}</span>}
        {live.kind === "massnahme" && <span>Umsetzung {fmtDateTime(live.start)}</span>}
        {live.costEur !== undefined && <span>Kosten {fmtEur(live.costEur)}</span>}
        {live.savingEur !== undefined && <span className="text-ok">vermeidet {fmtEur(live.savingEur)}</span>}
        <span>von {live.createdBy}</span>
      </div>
      {st === "ENTWURF" && (
        <div className="mt-2.5 flex gap-1.5">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => decide(true)}>
            <Check size={13} /> Freigeben
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide(false)}>
            Ablehnen
          </Button>
        </div>
      )}
    </div>
  );
}

export default function ToolCardView({ card }: { card: ToolCard }) {
  switch (card.kind) {
    case "overview":
      return <Overview data={card.data as Parameters<typeof Overview>[0]["data"]} />;
    case "machines":
      return <Machines data={card.data as MachineView[]} />;
    case "prediction":
      return <Prediction data={card.data as Parameters<typeof Prediction>[0]["data"]} />;
    case "orders":
      return <Orders data={card.data as OrderView[]} />;
    case "delivery":
      return <Delivery data={card.data as Parameters<typeof Delivery>[0]["data"]} />;
    case "feasibility":
      return <FeasibilityView data={card.data as FeasibilityResult} compact />;
    case "quality":
      return <Quality data={card.data as Parameters<typeof Quality>[0]["data"]} />;
    case "materials":
      return <Materials data={card.data as MaterialView[]} />;
    case "shipments":
      return <Shipments data={card.data as ShipmentView[]} />;
    case "docs":
      return <Docs data={card.data as SearchHit[]} />;
    case "ticket":
      return <TicketView ticket={card.data as Ticket} />;
    case "risks":
      return <Risks data={card.data as RiskRadar} />;
    case "whatif":
      return <WhatIfView r={card.data as WhatIfResult} busy={false} />;
  }
  return null;
}
