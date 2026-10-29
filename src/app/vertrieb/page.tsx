"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRightLeft, CalendarCheck, Handshake, Inbox, Loader2, Search, Sparkles, TrendingUp, X } from "lucide-react";
import { refreshSnapshot, ticketAction, useUi } from "@/lib/client/store";
import { CUSTOMERS, PRODUCTS } from "@/lib/sim/catalog";
import type { FeasibilityResult } from "@/lib/sim/analysis";
import type { OrderView } from "@/lib/sim/types";
import { fmtDateTime, fmtDuration, fmtEur, fmtInt, fmtKEur, fmtPct } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { Badge, Button, PageHeader, Panel, Progress, Tabs } from "@/components/ui/ui";
import { FeasibilityView, TicketView } from "@/components/copilot/ToolCards";

type Feas = FeasibilityResult & { inquiryId?: string };

async function feasibility(body: Record<string, unknown>): Promise<Feas | null> {
  const r = await fetch("/api/feasibility", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  return j.result ?? null;
}

function RiskBadge({ o }: { o: OrderView }) {
  return <Badge sev={o.risk === "gefaehrdet" ? "crit" : o.risk === "beobachten" ? "warn" : "ok"}>{fmtPct(o.onTimeProb, 0)}</Badge>;
}

function OrderDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const o = useUi((s) => s.snap?.orders.find((x) => x.id === id));
  const allTickets = useUi((s) => s.snap?.tickets);
  const tickets = useMemo(() => (allTickets ?? []).filter((t) => t.kind === "umplanung" && t.orderId === id), [allTickets, id]);
  const [alts, setAlts] = useState<{ machineId: string; freeAt: number; risk: number; changeover: boolean; status: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const openCopilot = useUi((s) => s.openCopilot);
  useEffect(() => {
    fetch("/api/feasibility", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: id }) })
      .then((r) => r.json())
      .then((d) => setAlts(d.alternatives ?? []))
      .catch(() => {});
  }, [id]);
  if (!o) return null;
  const now = useUi.getState().snap?.now ?? Date.now();
  const start = Math.min(now, o.created);
  const end = Math.max(o.due, o.projectedDone) + 6 * 3_600_000;
  const pos = (t: number) => `${((t - start) / (end - start)) * 100}%`;
  return (
    <motion.aside initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} className="panel fixed bottom-6 right-6 top-[84px] z-40 flex w-[420px] flex-col overflow-hidden shadow-[var(--shadow-lg)]">
      <div className="flex items-start justify-between border-b border-line px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="num text-[16px] font-bold">{o.id}</span>
            <RiskBadge o={o} />
            {o.priority === "hoch" && <Badge sev="info">Eilauftrag</Badge>}
          </div>
          <div className="text-[12px] text-muted">
            {o.customer} · {o.city}
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-panel-3" aria-label="Schließen">
          <X size={16} />
        </button>
      </div>
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <div className="rounded-lg bg-panel-2 p-2.5">
            <div className="label text-[9px]">Produkt</div>
            <div className="font-semibold">{o.product}</div>
          </div>
          <div className="rounded-lg bg-panel-2 p-2.5">
            <div className="label text-[9px]">Menge · Wert</div>
            <div className="num font-semibold">
              {fmtInt(o.qty)} · {fmtEur(o.valueEur)}
            </div>
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[11.5px] text-muted">
            <span>Fortschritt auf {o.machineId}</span>
            <span className="num">{fmtPct(o.progress, 0)}</span>
          </div>
          <Progress value={o.progress} />
        </div>
        <div>
          <div className="label mb-2">Zeitachse: Prognose vs. Liefertermin</div>
          <div className="relative h-14 rounded-lg bg-panel-2">
            <div className="absolute top-3 h-2 rounded-full bg-accent/70" style={{ left: pos(Math.max(start, now)), width: `calc(${pos(o.projectedDone)} - ${pos(Math.max(start, now))})` }} />
            <div className="absolute top-1 h-6 w-0.5 bg-ink" style={{ left: pos(now) }} />
            <div className={cn("absolute top-1 h-6 w-0.5", o.projectedDone > o.due ? "bg-crit" : "bg-ok")} style={{ left: pos(o.projectedDone) }} />
            <div className="absolute top-0 h-8 w-0.5 bg-warn" style={{ left: pos(o.due) }} />
            <div className="num absolute bottom-1 text-[9.5px] text-muted" style={{ left: pos(now) }}>
              jetzt
            </div>
            <div className="num absolute bottom-1 -translate-x-1/2 text-[9.5px] text-warn" style={{ left: pos(o.due) }}>
              Termin
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11.5px]">
            <div>
              <span className="text-muted">Liefertermin </span>
              <b className="num">{fmtDateTime(o.due)}</b>
            </div>
            <div>
              <span className="text-muted">Prognose </span>
              <b className={cn("num", o.projectedDone > o.due ? "text-crit" : "text-ok")}>{fmtDateTime(o.projectedDone)}</b>
            </div>
          </div>
          {o.riskReason && <div className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-warn">{o.riskReason}</div>}
        </div>
        {alts.length > 0 && o.status !== "VERSENDET" && o.status !== "VERSANDBEREIT" && (
          <div>
            <div className="label mb-1.5">Alternative Maschinen</div>
            {alts.map((a) => (
              <div key={a.machineId} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[11.5px]">
                <span className="num font-semibold">{a.machineId}</span>
                <span className="text-muted">frei ab {fmtDateTime(a.freeAt)}</span>
                {a.changeover && <Badge sev="neutral">Rüsten</Badge>}
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={busy || tickets.some((t) => t.status === "ENTWURF")}
                  onClick={async () => {
                    setBusy(true);
                    await ticketAction("create-move", { orderId: o.id, targetMachineId: a.machineId });
                    await refreshSnapshot();
                    setBusy(false);
                  }}
                >
                  <ArrowRightLeft size={12} /> Umplanen
                </Button>
              </div>
            ))}
          </div>
        )}
        {tickets.slice(0, 2).map((t) => (
          <TicketView key={t.id} ticket={t} />
        ))}
      </div>
      <div className="border-t border-line p-3">
        <Button variant="ai" className="w-full" onClick={() => openCopilot(`Prüfe den Liefertermin von ${o.id} und schlage Maßnahmen vor.`)}>
          <Sparkles size={14} /> Mit KI analysieren
        </Button>
      </div>
    </motion.aside>
  );
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const snap = useUi((s) => s.snap);
  const openCopilot = useUi((s) => s.openCopilot);
  const [filter, setFilter] = useState<"alle" | "risiko" | "versand">("alle");
  const [q, setQ] = useState("");
  const [inqRes, setInqRes] = useState<Feas | null>(null);
  const [busyInq, setBusyInq] = useState(false);
  const [form, setForm] = useState({ productId: "P-DES125", qty: 200000, days: 5, customerId: "K-1004" });
  const [formRes, setFormRes] = useState<Feas | null>(null);
  const [busyForm, setBusyForm] = useState(false);
  const selected = sp.get("o");

  const inquiry = snap?.inquiries.find((i) => i.status === "OFFEN") ?? snap?.inquiries[0];
  const orders = useMemo(() => {
    let list = (snap?.orders ?? []).filter((o) => o.status !== "VERSENDET");
    if (filter === "risiko") list = list.filter((o) => o.risk !== "ok");
    if (filter === "versand") list = list.filter((o) => o.status === "VERSANDBEREIT" || o.status === "QS");
    if (q) list = list.filter((o) => `${o.id} ${o.customer} ${o.product} ${o.machineId}`.toLowerCase().includes(q.toLowerCase()));
    return [...list].sort((a, b) => a.onTimeProb - b.onTimeProb || a.due - b.due);
  }, [snap, filter, q]);
  const byCustomer = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of snap?.orders ?? []) if (o.status !== "VERSENDET") m.set(o.customer, (m.get(o.customer) ?? 0) + o.valueEur);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [snap]);
  const maxC = byCustomer[0]?.[1] ?? 1;
  const k = snap?.kpis;

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Handshake size={12} /> Vertrieb · Liefertermine & Machbarkeit
          </>
        }
        title="Zusagen, die halten – in Sekunden statt in Stunden."
        desc="Jeder Auftrag erhält eine laufend aktualisierte Lieferprognose aus Maschinenbelegung, Maschinenzustand, Qualitätsfreigabe und Transportzeit. Neue Anfragen werden per Capable-to-Promise gegen Kapazität und Material geprüft."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { l: "Auftragsbestand", v: k ? fmtKEur(k.backlogEur) : "–", s: `${snap?.orders.filter((o) => o.status !== "VERSENDET").length ?? 0} offene Aufträge` },
          { l: "Liefertreue (30 Tage)", v: k ? fmtPct(k.onTimeDelivery) : "–", s: "pünktlich zugestellt (POD)" },
          { l: "Termin gefährdet", v: String(k?.ordersAtRisk ?? 0), s: `${snap?.orders.filter((o) => o.risk === "beobachten").length ?? 0} unter Beobachtung`, warn: (k?.ordersAtRisk ?? 0) > 0 },
          { l: "Offene Anfragen", v: String(snap?.inquiries.filter((i) => i.status === "OFFEN").length ?? 0), s: "Antwort ausstehend" },
        ].map((x) => (
          <div key={x.l} className={cn("panel p-4", x.warn && "border-warn/50")}>
            <div className="label">{x.l}</div>
            <div className={cn("num mt-1 text-[22px] font-semibold", x.warn && "text-warn")}>{x.v}</div>
            <div className="text-[11.5px] text-muted">{x.s}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Kundenanfrage" subtitle="Aus dem CRM · Machbarkeit mit einem Klick" icon={<Inbox size={16} />} ai={inquiry?.status === "OFFEN"}>
          {inquiry ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-xl bg-panel-2 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold">{CUSTOMERS.find((c) => c.id === inquiry.customerId)?.name}</span>
                    <Badge sev={inquiry.status === "OFFEN" ? "warn" : "ok"}>{inquiry.status === "OFFEN" ? "Antwort ausstehend" : "Zugesagt"}</Badge>
                  </div>
                  <div className="num mt-1 text-[13px]">
                    {fmtInt(inquiry.qty)} Stk {PRODUCTS.find((p) => p.id === inquiry.productId)?.name} · bis {fmtDateTime(inquiry.due)}
                  </div>
                  <div className="mt-1 text-[11.5px] text-muted">{inquiry.note}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={busyInq}
                  onClick={async () => {
                    setBusyInq(true);
                    setInqRes(await feasibility({ inquiryId: inquiry.id }));
                    setBusyInq(false);
                  }}
                >
                  {busyInq ? <Loader2 size={14} className="animate-spin" /> : <CalendarCheck size={14} />} Machbarkeit prüfen
                </Button>
                <Button variant="ai" onClick={() => openCopilot("Können wir die Eilanfrage von Alpenmilch zusagen?")}>
                  <Sparkles size={14} /> KI fragen
                </Button>
              </div>
              <AnimatePresence>{inqRes && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><FeasibilityView data={inqRes} /></motion.div>}</AnimatePresence>
            </div>
          ) : (
            <div className="rounded-xl bg-panel-2 p-4 text-[12.5px] text-muted">
              Keine offene Anfrage. Starte in der Demo-Regie (Shift+D) das Szenario <b>„Eilauftrag Alpenmilch“</b> oder prüfe rechts eine eigene Anfrage.
            </div>
          )}
        </Panel>

        <Panel title="Machbarkeitscheck (Capable-to-Promise)" subtitle="Freie Anfrage simulieren – z. B. während eines Kundengesprächs" icon={<TrendingUp size={16} />}>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="text-[11.5px]">
              <span className="label">Produkt</span>
              <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-line bg-panel px-2.5 text-[12.5px]">
                {PRODUCTS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11.5px]">
              <span className="label">Kunde</span>
              <select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-line bg-panel px-2.5 text-[12.5px]">
                {CUSTOMERS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.city})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11.5px]">
              <span className="label">Menge (Stück)</span>
              <input type="number" step={10000} min={10000} value={form.qty} onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })} className="num mt-1 h-9 w-full rounded-lg border border-line bg-panel px-2.5 text-[12.5px]" />
            </label>
            <label className="text-[11.5px]">
              <span className="label">Liefertermin in {form.days} Tagen (08:00)</span>
              <input type="range" min={2} max={14} value={form.days} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })} className="mt-3 w-full accent-[var(--accent)]" />
            </label>
          </div>
          <Button
            className="mt-3"
            disabled={busyForm}
            onClick={async () => {
              setBusyForm(true);
              setFormRes(await feasibility(form));
              setBusyForm(false);
            }}
          >
            {busyForm ? <Loader2 size={14} className="animate-spin" /> : <CalendarCheck size={14} />} Prüfen
          </Button>
          {formRes && (
            <div className="mt-3">
              <FeasibilityView data={formRes} />
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title="Aufträge mit Lieferprognose"
          subtitle="Sortiert nach Risiko · Prognose aus Belegung, Maschinenzustand, QS und Transport"
          icon={<CalendarCheck size={16} />}
          actions={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-2.5 text-faint" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen…" className="h-8 w-40 rounded-lg border border-line bg-panel-2 pl-7 pr-2 text-[12px] outline-none focus:border-accent/60" />
              </div>
              <Tabs size="sm" value={filter} onChange={setFilter} items={[{ value: "alle", label: "Alle" }, { value: "risiko", label: "Risiko" }, { value: "versand", label: "Versandbereit" }]} />
            </div>
          }
          bodyClassName="px-0 pb-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[12px]">
              <thead>
                <tr className="border-y border-line-2 bg-panel-2 text-[10.5px] uppercase tracking-wider text-muted">
                  {["Auftrag", "Kunde", "Produkt", "Menge", "Fortschritt", "Maschine", "Liefertermin", "Prognose", "Termintreue"].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 40).map((o) => (
                  <tr key={o.id} onClick={() => router.replace(`/vertrieb?o=${o.id}`)} className={cn("cursor-pointer border-b border-line-2 hover:bg-panel-2", selected === o.id && "bg-accent-soft")}>
                    <td className="num px-3 py-2 font-semibold">
                      {o.id}
                      {o.priority === "hoch" && <span className="ml-1 text-accent">●</span>}
                    </td>
                    <td className="max-w-[170px] truncate px-3 py-2">{o.customer}</td>
                    <td className="px-3 py-2 text-ink-2">{o.productShort}</td>
                    <td className="num px-3 py-2">{fmtInt(o.qty)}</td>
                    <td className="w-28 px-3 py-2">
                      <Progress value={o.progress} height={5} sev={o.status === "VERSANDBEREIT" || o.status === "QS" ? "ok" : "info"} />
                    </td>
                    <td className="num px-3 py-2">{o.machineId}</td>
                    <td className="num px-3 py-2 text-ink-2">{fmtDateTime(o.due)}</td>
                    <td className={cn("num px-3 py-2", o.projectedDone > o.due ? "text-crit" : "text-ink-2")}>{fmtDateTime(o.projectedDone)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <RiskBadge o={o} />
                        {o.riskReason && <span className="max-w-[160px] truncate text-[10.5px] text-muted">{o.riskReason}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Auftragsbestand je Kunde" subtitle="offener Wert" icon={<Handshake size={16} />}>
          <div className="space-y-2.5">
            {byCustomer.map(([c, v]) => (
              <div key={c}>
                <div className="flex justify-between text-[11.5px]">
                  <span className="truncate text-ink-2">{c}</span>
                  <span className="num font-semibold">{fmtKEur(v)}</span>
                </div>
                <Progress value={v / maxC} height={5} className="mt-1" />
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg bg-panel-2 p-3 text-[11.5px] leading-snug text-muted">
            Prognosen berücksichtigen das KI-Ausfallrisiko der Maschinen: Steigt es, sinkt die Termintreue der dort geplanten Aufträge – <b className="text-ink-2">bevor</b> ein Stillstand eintritt.
            <div className="num mt-1.5 text-[10.5px]">Transport: Ø 65 km/h · QS-Freigabe {fmtDuration(0.75)}</div>
          </div>
        </Panel>
      </div>

      {/* router.replace("/vertrieb") entfernt ?o auf derselben Seite nicht zuverlässig – History-API wird von Next übernommen */}
      <AnimatePresence>{selected && <OrderDrawer key={selected} id={selected} onClose={() => window.history.replaceState(null, "", "/vertrieb")} />}</AnimatePresence>
    </div>
  );
}

export default function VertriebPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-2xl" />}>
      <Inner />
    </Suspense>
  );
}
