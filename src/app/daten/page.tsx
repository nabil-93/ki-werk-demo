"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Boxes, CheckCircle2, Clock3, Database, Factory, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { useUi } from "@/lib/client/store";
import { CUSTOMER, PRODUCT } from "@/lib/sim/catalog";
import { fmtDateTime, fmtInt, fmtNum, fmtPct } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { Badge, PageHeader, Panel } from "@/components/ui/ui";
import Pipeline, { AREAS } from "@/components/data/Pipeline";
import { Legend } from "@/components/ui/chartkit";

// Eine Karte im Beispiel „ein Auftrag – ein Bild“: einfache Zeilen statt Rohdaten
function Card({ title, sub, icon, rows, accent }: { title: string; sub: string; icon: React.ReactNode; rows: [string, React.ReactNode][]; accent?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl border", accent ? "border-accent/50" : "border-line")}>
      <div className={cn("flex items-center gap-2 px-3 py-2", accent ? "bg-accent-soft" : "bg-panel-2")}>
        <span className={accent ? "text-accent" : "text-muted"}>{icon}</span>
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold">{title}</div>
          <div className="truncate text-[10.5px] text-muted">{sub}</div>
        </div>
      </div>
      <div className="flex-1 divide-y divide-line bg-panel">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-[12px]">
            <span className="text-muted">{k}</span>
            <span className="num text-right font-semibold text-ink">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS: Record<string, string> = { PRODUKTION: "läuft", RUESTEN: "Rüsten", STOERUNG: "Störung", WARTUNG: "Wartung", STILLSTAND: "Stillstand" };
const RISK = { ok: { sev: "ok", label: "im Plan" }, beobachten: { sev: "warn", label: "beobachten" }, gefaehrdet: { sev: "crit", label: "gefährdet" } } as const;

export default function DatenPage() {
  const snap = useUi((s) => s.snap);
  const connectors = snap?.connectors ?? [];
  const order = useMemo(() => snap?.orders.find((o) => o.status === "PRODUKTION" && o.machineId === "SG-04") ?? snap?.orders.find((o) => o.status === "PRODUKTION"), [snap]);
  const m = order ? snap?.machines.find((x) => x.id === order.machineId) : undefined;
  const totalToday = connectors.reduce((s, c) => s + c.totalToday, 0);
  const online = connectors.filter((c) => c.status !== "offline").length;
  const live = connectors.find((c) => c.id === "iot")?.status === "online";

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Workflow size={12} /> Fundament · Datenintegration
          </>
        }
        title="Daten aus allen Bereichen – in einem System."
        desc="Die Daten kommen aus den bestehenden Systemen der Bereiche: Aufträge, Produktion, Qualität, Lager, Transport und Wartung. Die KI sammelt sie an einem Ort, prüft sie und verbindet sie. Erst dann kann sie Fragen beantworten und Probleme früh erkennen."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { icon: Database, l: "Datenquellen", v: `${online} / ${connectors.length || 8}`, s: `online · aus ${AREAS.length} Bereichen` },
          { icon: Boxes, l: "Datensätze heute", v: fmtInt(totalToday), s: "automatisch übernommen" },
          { icon: Clock3, l: "Aktualität", v: live ? "live" : "verzögert", s: "Maschinendaten in unter 1 Sekunde" },
          { icon: ShieldCheck, l: "Datenqualität", v: connectors.length ? fmtPct(connectors.reduce((s, c) => s + c.quality, 0) / connectors.length / 100) : "–", s: "vollständig und plausibel" },
        ].map((k, i) => (
          <motion.div key={k.l} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="panel flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <k.icon size={18} />
            </div>
            <div className="min-w-0">
              <div className="label">{k.l}</div>
              <div className="num text-[19px] font-semibold">{k.v}</div>
              <div className="truncate text-[11px] text-muted">{k.s}</div>
            </div>
          </motion.div>
        ))}
      </div>

      <Panel title="So fließen die Daten · live" subtitle="Links die Bereiche, in der Mitte die KI, rechts das Ergebnis – jeder Punkt ist ein Datenpaket" icon={<Workflow size={16} />}>
        {connectors.length ? <Pipeline connectors={connectors} /> : <div className="skeleton h-[420px]" />}
        <Legend
          className="mt-2"
          items={[
            { color: "var(--ok)", kind: "dot", label: "grüner Punkt: Daten kommen an" },
            { color: "var(--warn)", kind: "dot", label: "gelb: verzögert" },
            { color: "var(--accent)", kind: "dash", label: "bewegte Punkte: Datenfluss in Echtzeit" },
          ]}
          note="Zahl oben rechts im Kasten = Datensätze pro Minute"
        />
      </Panel>

      <Panel
        className="mt-4"
        title="Beispiel: Ein Auftrag – drei Quellen, ein Bild"
        subtitle={`Live: ${order?.id ?? "…"} auf ${order?.machineId ?? "…"} · erst zusammen sieht man, ob der Liefertermin hält`}
        icon={<Database size={16} />}
      >
        {order && m && snap ? (
          <div className="grid items-stretch gap-3 lg:grid-cols-[1fr_1fr_1fr_auto_1.15fr]">
            <Card
              title="Auftrag"
              sub="aus dem Bereich Aufträge & Kunden"
              icon={<Boxes size={15} />}
              rows={[
                ["Kunde", CUSTOMER[order.customerId].name],
                ["Produkt", PRODUCT[order.productId].short],
                ["Menge", `${fmtInt(order.qty)} Stk`],
                ["Liefertermin", fmtDateTime(order.due)],
              ]}
            />
            <Card
              title="Produktion"
              sub="aus dem Bereich Maschinen"
              icon={<Factory size={15} />}
              rows={[
                ["Maschine", m.id],
                ["Status", STATUS[m.status] ?? m.status],
                ["Gutteile", `${fmtInt(order.produced)} Stk`],
                ["Fortschritt", fmtPct(order.progress)],
              ]}
            />
            <Card
              title="Sensoren"
              sub="live von der Maschine"
              icon={<Clock3 size={15} />}
              rows={[
                ["Schwingung", `${fmtNum(m.current.vib, 2)} mm/s`],
                ["Temperatur Masse", `${fmtNum(m.current.temp1, 1)} °C`],
                ["Temperatur Öl", `${fmtNum(m.current.oil, 1)} °C`],
                ["Zykluszeit", `${fmtNum(m.current.cycle, 2)} s`],
              ]}
            />
            <div className="hidden items-center lg:flex">
              <ArrowRight className="text-accent" />
            </div>
            <Card
              accent
              title="Ein Bild + KI"
              sub="verbunden und von der KI bewertet"
              icon={<Sparkles size={15} />}
              rows={[
                ["Auftrag", `${order.id} · ${CUSTOMER[order.customerId].name}`],
                ["Ausfallrisiko Maschine (72 h)", fmtPct(m.prediction.p72)],
                ["Prognose fertig", fmtDateTime(order.projectedDone)],
                ["Pünktlich", fmtPct(order.onTimeProb)],
                ["Bewertung", <Badge key="r" sev={RISK[order.risk].sev}>{RISK[order.risk].label}</Badge>],
              ]}
            />
          </div>
        ) : (
          <div className="skeleton h-56" />
        )}
        <div className="mt-3 rounded-lg bg-panel-2 px-3 py-2 text-[12px] text-ink-2">
          Einzeln sagt keine Quelle, ob der Termin hält. Erst wenn Auftrag, Produktion und Sensoren verbunden sind, kann die KI das bewerten
          {order && order.risk !== "ok" ? " – hier: Der Liefertermin ist in Gefahr, und die KI zeigt den Grund." : " – hier: Die Maschine ist gesund, der Liefertermin hält."}
        </div>
      </Panel>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Vollständig", "Jeder Datensatz hat alle Pflichtfelder – sonst wird er geprüft, bevor er genutzt wird."],
          ["Aktuell", "Maschinendaten kommen in Sekunden, Aufträge in unter einer Minute – Verzögerungen werden gemeldet."],
          ["Plausibel", "Unmögliche Werte werden erkannt, zum Beispiel eine Temperatur außerhalb von 180–300 °C."],
          ["Nachvollziehbar", "Jede Zahl lässt sich bis zur Quelle zurückverfolgen – jede KI-Antwort nennt ihre Quellen."],
        ].map(([t, d]) => (
          <div key={t} className="panel p-3.5">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold">
              <CheckCircle2 size={14} className="text-ok" /> {t}
              <Badge sev="ok" className="ml-auto">
                aktiv
              </Badge>
            </div>
            <div className="mt-1 text-[11.5px] leading-snug text-muted">{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
