"use client";

import { useEffect, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Euro, PieChart, Sparkles, TrendingUp, Users } from "lucide-react";
import { useUi } from "@/lib/client/store";
import type { FinanceView } from "@/lib/sim/reports";
import { fmtInt, fmtKEur, fmtNum, fmtPct, fmtShortDate } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { useRevealOnSelect } from "@/lib/client/reveal";
import { Badge, Button, PageHeader, Panel, Progress, Tabs } from "@/components/ui/ui";
import { ChartTip, Legend, axisTick, gridProps } from "@/components/ui/chartkit";
import ProductArt from "@/components/ops/ProductArt";

function useFinance(days: number) {
  const [f, setF] = useState<FinanceView | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/finance?days=${days}`, { cache: "no-store" });
        if (r.ok && alive) setF(await r.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [days]);
  return f;
}

export default function FinanzenPage() {
  const [days, setDays] = useState<7 | 30>(30);
  const f = useFinance(days);
  const openCopilot = useUi((s) => s.openCopilot);
  const [cust, setCust] = useState<string | null>(null);
  const reveal = useRevealOnSelect(cust);
  const t = f?.totals;
  const series = (f?.series ?? []).map((d) => ({ ...d, revK: d.revenue / 1000, dbK: d.margin / 1000, resK: d.result / 1000 }));
  const maxRev = Math.max(1, ...(f?.customers ?? []).map((c) => c.revenue));
  const selC = f?.customers.find((c) => c.id === cust);
  const costs = t ? [
    ["Material (Granulat, Folie, Etiketten)", t.material, "var(--accent)"],
    ["Energie", t.energy, "var(--warn)"],
    ["Fracht (frei Haus)", t.freight, "#0f9fb5"],
    ["Personal", t.personnel, "#9b51e0"],
    ["Gemeinkosten / AfA", t.overhead, "var(--faint)"],
  ] as const : [];
  const costSum = costs.reduce((a, c) => a + c[1], 0);
  const m = f?.month;
  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Euro size={12} /> Finanzen & Kunden · Deckungsbeitragsrechnung
          </>
        }
        title="Was das Werk verdient – je Tag, Kunde und Produkt."
        desc="Umsatz wird bei Abfahrt des LKW fakturiert, Material und Energie laufen mit der Produktion mit. Der Verlust aus Stillständen und Ausschuss ist als entgangener Deckungsbeitrag ausgewiesen."
        actions={
          <>
            <Tabs
              value={String(days)}
              onChange={(v) => setDays(Number(v) as 7 | 30)}
              items={[
                { value: "7", label: "7 Tage" },
                { value: "30", label: "30 Tage" },
              ]}
            />
            <Button variant="ai" onClick={() => openCopilot("Mit welchen Kunden verdienen wir am meisten und wo verlieren wir Marge?")}>
              <Sparkles size={14} /> KI fragen
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        {[
          ["Umsatz", t ? fmtKEur(t.revenue) : "–", `${days} Tage`, ""],
          ["Deckungsbeitrag", t ? fmtKEur(t.margin) : "–", t ? `${fmtPct(t.marginPct, 1)} vom Umsatz` : "", ""],
          ["Ergebnis", t ? `${t.result >= 0 ? "+" : ""}${fmtKEur(t.result)}` : "–", t ? `${fmtPct(t.resultPct, 1)} Umsatzrendite` : "", t && t.result < 0 ? "crit" : "ok"],
          ["Verlust (entg. DB)", t ? fmtKEur(t.loss) : "–", t ? `Stillstand ${fmtKEur(t.lossDowntime)} · Ausschuss ${fmtKEur(t.lossScrap)}` : "", "crit"],
          ["Heute", f ? fmtKEur(f.today.revenue) : "–", f ? `DB ${fmtKEur(f.today.margin)} · Ergebnis ${f.today.result >= 0 ? "+" : ""}${fmtKEur(f.today.result)}` : "", ""],
          ["Verkaufte Stück", t ? `${fmtNum(t.pieces / 1e6, 1)} Mio` : "–", "gefertigt im Zeitraum", ""],
        ].map(([l, v, s, sev]) => (
          <div key={l} className={cn("panel px-3.5 py-2.5", sev === "crit" && "border-crit/40")}>
            <div className="label truncate text-[9px]">{l}</div>
            <div className={cn("num mt-0.5 truncate text-[19px] font-bold", sev === "crit" ? "text-crit" : sev === "ok" ? "text-ok" : "text-ink")}>{v}</div>
            <div className="truncate text-[10.5px] text-muted">{s}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Umsatz, Deckungsbeitrag und Ergebnis je Tag" subtitle="Produktionstag 06:00–06:00 · heutiger Tag läuft noch" icon={<TrendingUp size={16} />}>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 8, right: 6, left: -4, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="day" tickFormatter={(d) => fmtShortDate(d)} tick={axisTick} axisLine={false} tickLine={false} minTickGap={18} />
                <YAxis tick={axisTick} tickFormatter={(v) => `${fmtNum(v, 0)} T€`} axisLine={false} tickLine={false} width={54} />
                <Tooltip content={<ChartTip labelFormat={(l) => fmtShortDate(Number(l))} valueFormat={(v) => `${fmtNum(v, 1)} T€`} />} />
                <ReferenceLine y={0} stroke="var(--line)" />
                <Bar dataKey="revK" name="Umsatz" fill="var(--accent)" fillOpacity={0.75} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Line dataKey="dbK" name="Deckungsbeitrag" stroke="var(--ok)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="resK" name="Ergebnis" stroke="var(--ink-2)" strokeDasharray="4 3" strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <Legend
            className="mt-1.5"
            items={[
              { color: "var(--accent)", label: "blaue Säule: Umsatz des Tages" },
              { color: "var(--ok)", kind: "line", label: "grüne Linie: Deckungsbeitrag (Umsatz − Material − Energie − Fracht)" },
              { color: "var(--ink-2)", kind: "dash", label: "gestrichelt: Ergebnis nach Personal- und Gemeinkosten" },
              { color: "var(--line)", kind: "line", label: "Nulllinie" },
            ]}
            note="Wochenende: weniger Abholungen → Ergebnis unter null, unter der Woche aufgeholt"
          />
        </Panel>
        <div className="space-y-4">
          <Panel title="Monat: Prognose vs. Budget" subtitle="KI-Hochrechnung aus Ø der letzten 7 Tage" icon={<Sparkles size={16} />} ai>
            {m ? (
              <>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="label text-[9px]">Prognose Monatsumsatz</div>
                    <div className="num text-[24px] font-bold">{fmtKEur(m.forecast)}</div>
                  </div>
                  <Badge sev={m.forecast >= m.budget ? "ok" : m.forecast >= m.budget * 0.93 ? "warn" : "crit"}>{fmtPct(m.forecast / m.budget, 0)} vom Budget</Badge>
                </div>
                <Progress value={m.mtdRevenue / m.budget} className="mt-2" height={7} />
                <Legend className="mt-1" items={[{ color: "var(--accent)", label: "Balken: bisheriger Monatsumsatz im Verhältnis zum Budget" }]} />
                <div className="num mt-1 flex justify-between text-[10.5px] text-muted">
                  <span>bisher {fmtKEur(m.mtdRevenue)}</span>
                  <span>Budget {fmtKEur(m.budget)}</span>
                </div>
                <div className="mt-2 text-[11.5px] text-ink-2">
                  {m.forecast >= m.budget
                    ? "Auf Kurs – Budget wird voraussichtlich erreicht."
                    : `Lücke ca. ${fmtKEur(m.budget - m.forecast)}: entspricht ${fmtNum((m.budget - m.forecast) / Math.max(1, m.avg7), 1)} durchschnittlichen Umsatztagen. Hebel: Stillstände senken (siehe Verlust) und Abrufe der Top-Kunden vorziehen.`}
                </div>
              </>
            ) : (
              <div className="skeleton h-28" />
            )}
          </Panel>
          <Panel title="Kostenstruktur" subtitle={`${days} Tage · Anteil an den Gesamtkosten`} icon={<PieChart size={16} />}>
            <div className="flex h-3 overflow-hidden rounded-full">
              {costs.map(([l, v, c]) => (
                <div key={l} style={{ width: `${(v / Math.max(1, costSum)) * 100}%`, background: c }} title={l} />
              ))}
            </div>
            <div className="mt-2 space-y-1">
              {costs.map(([l, v, c]) => (
                <div key={l} className="flex items-center gap-2 text-[11.5px]">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />
                  <span className="flex-1 text-ink-2">{l}</span>
                  <span className="num font-semibold">{fmtKEur(v)}</span>
                  <span className="num w-10 text-right text-muted">{fmtPct(v / Math.max(1, costSum), 0)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Kunden" subtitle="Umsatz, Menge, Deckungsbeitrag nach Material und anteiliger Fracht · Klick für Details" icon={<Users size={16} />} bodyClassName="px-0 pb-1">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                  {["Kunde", "Umsatz", "", "Stück", "DB", "DB %", "Heute", "Offen"].map((h, i) => (
                    <th key={i} className="px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(f?.customers ?? []).map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => {
                      setCust(c.id === cust ? null : c.id);
                      reveal.bump();
                    }}
                    className={cn("cursor-pointer border-b border-line-2 last:border-0 hover:bg-panel-2", c.id === cust && "bg-accent-soft/40")}>
                    <td className="px-3 py-1.5">
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-[10.5px] text-muted">
                        {c.city} ({c.country}) · {c.segment} · {c.km} km
                      </div>
                    </td>
                    <td className="num px-3 py-1.5 font-semibold">{fmtKEur(c.revenue)}</td>
                    <td className="w-[110px] px-3 py-1.5">
                      <div className="h-1.5 overflow-hidden rounded-full bg-panel-3">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${(c.revenue / maxRev) * 100}%` }} />
                      </div>
                    </td>
                    <td className="num px-3 py-1.5">{c.pieces >= 1e6 ? `${fmtNum(c.pieces / 1e6, 2)} Mio` : fmtInt(c.pieces)}</td>
                    <td className="num px-3 py-1.5">{fmtKEur(c.db)}</td>
                    <td className={cn("num px-3 py-1.5 font-semibold", c.marginPct < 0.33 ? "text-warn" : "text-ok")}>{fmtPct(c.marginPct, 0)}</td>
                    <td className="num px-3 py-1.5">{c.today ? fmtKEur(c.today) : "–"}</td>
                    <td className="num px-3 py-1.5">{c.openOrders ? `${c.openOrders} · ${fmtKEur(c.openValue)}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Legend
            className="px-4 pb-2 pt-2"
            items={[
              { color: "var(--accent)", label: "Balken: Umsatz im Verhältnis zum größten Kunden" },
              { color: "var(--ok)", kind: "dot", label: "DB % grün: ≥ 33 %" },
              { color: "var(--warn)", kind: "dot", label: "gelb: < 33 % (Fracht/Preis prüfen)" },
            ]}
            note="Offen = Anzahl und Wert noch nicht gelieferter Aufträge"
          />
        </Panel>
        <div className="space-y-4">
          {selC && (
            <div ref={reveal.ref} className="scroll-mt-4">
              <Panel title={selC.name} subtitle={`${selC.city} · ${selC.segment}`} icon={<Users size={16} />}>
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  {[
                    ["Umsatz", fmtKEur(selC.revenue)],
                    ["Deckungsbeitrag", `${fmtKEur(selC.db)} (${fmtPct(selC.marginPct, 0)})`],
                    ["Gelieferte Stück", fmtInt(selC.pieces)],
                    ["Kosten (Material + Fracht)", fmtKEur(selC.cost)],
                    ["Offene Aufträge", `${selC.openOrders} · ${fmtKEur(selC.openValue)}`],
                    ["Lieferweg", `${selC.km} km`],
                  ].map(([l, v]) => (
                    <div key={l} className="rounded-lg bg-panel-2 px-2.5 py-1.5">
                      <div className="label text-[9px]">{l}</div>
                      <div className="num font-semibold">{v}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[11.5px] text-ink-2">
                  {selC.marginPct < 0.33 ? `Marge unter Durchschnitt – vor allem durch ${selC.km} km Fracht. Vorschlag: Frachtpauschale oder größere Abrufmengen je LKW.` : "Profitabler Kunde – Abrufe bündeln und Rahmenvertrag ausbauen."}
                </div>
              </Panel>
            </div>
          )}
          <Panel title="Produkte" subtitle="Umsatz und Deckungsbeitrag je Artikel" icon={<PieChart size={16} />} bodyClassName="px-0 pb-1">
            <table className="w-full text-[12px]">
              <tbody>
                {(f?.products ?? []).map((p) => (
                  <tr key={p.id} className="border-b border-line-2 last:border-0">
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <ProductArt productId={p.id} size={32} />
                        <span className="font-semibold">{p.short}</span>
                      </div>
                    </td>
                    <td className="num px-3 py-1.5 text-right">{fmtKEur(p.revenue)}</td>
                    <td className="num px-3 py-1.5 text-right text-muted">{p.pieces >= 1e6 ? `${fmtNum(p.pieces / 1e6, 1)} Mio` : fmtInt(p.pieces)}</td>
                    <td className="num px-3 py-1.5 text-right">{fmtKEur(p.db)}</td>
                    <td className="num px-3 py-1.5 text-right font-semibold">{fmtPct(p.marginPct, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </div>
  );
}
