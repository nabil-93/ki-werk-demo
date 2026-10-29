"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, BarChart3, Boxes, Download, Euro, Factory, FileSpreadsheet, FileText, Lightbulb, Printer, Sparkles, Timer, Truck } from "lucide-react";
import { useUi } from "@/lib/client/store";
import type { Report } from "@/lib/sim/reports";
import { fmtDateTime, fmtEur, fmtInt, fmtKEur, fmtNum, fmtPct, fmtShortDate, fmtTime } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { Badge, Button, PageHeader, Panel, Tabs } from "@/components/ui/ui";
import { BarRow, Sparkline } from "@/components/ui/charts";
import { ChartTip, Legend, axisTick, gridProps } from "@/components/ui/chartkit";
import { KindBadge, Plate } from "@/components/ops/Visit";
import ProductArt from "@/components/ops/ProductArt";

type Sel = "heute" | "gestern" | "woche" | "monat";
const SEV_FILL: Record<string, string> = { ok: "var(--accent)", warn: "var(--warn)", crit: "var(--crit)", idle: "var(--panel-3)" };

function useReport(sel: Sel) {
  const [r, setR] = useState<Report | null>(null);
  useEffect(() => {
    let alive = true;
    setR(null);
    const q = sel === "gestern" ? "range=tag&offset=-1" : sel === "heute" ? "range=tag" : `range=${sel}`;
    const load = async () => {
      try {
        const res = await fetch(`/api/report?${q}`, { cache: "no-store" });
        if (res.ok && alive) setR(await res.json());
      } catch {}
    };
    load();
    const t = sel === "gestern" ? undefined : setInterval(load, 20000);
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [sel]);
  return r;
}

// ---------------- Export ----------------

function csvEscape(v: unknown) {
  const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",")) : String(v ?? "");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadBlob(name: string, type: string, content: string) {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

function fileBase(r: Report) {
  const d = new Date(r.from + 6 * 3_600_000).toISOString().slice(0, 10);
  return `WERK_WN01_${r.range === "tag" ? "Tagesbericht" : r.range === "woche" ? "Wochenbericht" : "Monatsbericht"}_${d}`;
}

function exportCsv(r: Report) {
  const rows: unknown[][] = [];
  const sec = (t: string) => rows.push([], [t]);
  rows.push([r.plant], [`${r.range === "tag" ? "Tagesbericht" : r.range === "woche" ? "Wochenbericht" : "Monatsbericht"} ${r.label}`], [`Erstellt ${fmtDateTime(r.generatedAt)}`]);
  sec("Kennzahlen");
  const k = r.kpi;
  rows.push(
    ["Gutteile", Math.round(k.good)],
    ["Soll", Math.round(k.target)],
    ["OEE (Ist/Soll)", k.oee],
    ["Verfügbarkeit", k.availability],
    ["Ausschussquote", k.scrapRate],
    ["Störung h", k.stoerH],
    ["Rüsten h", k.ruestH],
    ["Verlust entg. DB €", Math.round(k.lossEur)],
    ["Umsatz €", Math.round(k.revenue)],
    ["Materialkosten €", Math.round(k.material)],
    ["Energiekosten €", Math.round(k.energyCost)],
    ["Fracht €", Math.round(k.freight)],
    ["Deckungsbeitrag €", Math.round(k.margin)],
    ["Fixkosten €", Math.round(k.fixed)],
    ["Ergebnis €", Math.round(k.result)],
    ["Energie kWh", Math.round(k.energyKwh)],
  );
  sec("Maschinen");
  rows.push(["Maschine", "Produkt", "Gutteile", "Soll", "Ist/Soll", "Verfügbarkeit", "Ausschuss", "Störung h", "Rüsten h", "Unterbrechungen", "Verlust €", "Energie kWh", "Temp. max °C", "Hauptursache"]);
  for (const m of r.machines) rows.push([m.id, m.product, Math.round(m.good), Math.round(m.target), m.oee, m.availability, m.scrapRate, m.stoerH, m.ruestH, m.stops, Math.round(m.lossEur), Math.round(m.energy), m.temp1Max, m.topReason ?? ""]);
  sec("Stillstände");
  rows.push(["Maschine", "Status", "Ursache", "Beginn", "Ende", "Dauer min", "Verlust €"]);
  for (const s of r.stops) rows.push([s.machineId, s.status, s.reason, fmtDateTime(s.start), s.end ? fmtDateTime(s.end) : "läuft", Math.round(s.durMin), Math.round(s.lossEur)]);
  if (r.trucks.length) {
    sec("LKW");
    rows.push(["Zeitfenster", "Art", "Kennzeichen", "Spedition", "Fahrer", "Partner", "Von", "Nach", "Ware", "Menge", "Einheit", "Paletten", "Ankunft", "Abfahrt", "Verspätung min", "Standzeit min", "Überzogen min"]);
    for (const v of r.trucks) rows.push([v.id, v.kind, v.plate, v.carrier, v.driver, v.partner, v.from.city, v.to.city, v.cargo, v.qty, v.unit, v.pallets, v.arrivedAt ? fmtDateTime(v.arrivedAt) : "", v.departedAt ? fmtDateTime(v.departedAt) : "", Math.round(v.lateMin), Math.round(v.onSiteMin), Math.round(v.overstayMin)]);
  }
  sec("Fertigwarenlager");
  rows.push(["Artikel", "Paletten", "Stück", "frei", "reserviert", "Sicherheitsbestand Pal.", "Veränderung Stück", "Warenwert €", "Lagerort"]);
  for (const s of r.stock) rows.push([s.name, s.pallets, s.pieces, s.free, s.reserved, s.minPallets, s.change, Math.round(s.valueEur), s.location]);
  sec("Kunden");
  rows.push(["Kunde", "Ort", "Umsatz €", "Stück", "DB €", "DB %"]);
  for (const c of r.customers) rows.push([c.name, c.city, Math.round(c.revenue), Math.round(c.pieces), Math.round(c.db), c.marginPct]);
  sec("KI-Empfehlungen");
  for (const x of r.recommendations) rows.push([x.area, x.title, x.action, x.impactEur ? Math.round(x.impactEur) : ""]);
  const csv = "﻿" + rows.map((row) => row.map(csvEscape).join(";")).join("\r\n");
  downloadBlob(`${fileBase(r)}.csv`, "text/csv;charset=utf-8", csv);
}

/** Eigenständige HTML-Datei: Bericht + alle Styles (öffnet offline, druckbar als PDF) */
function exportHtml(r: Report) {
  const el = document.getElementById("report");
  if (!el) return;
  let css = "";
  for (const sh of Array.from(document.styleSheets)) {
    try {
      css += Array.from(sh.cssRules)
        .map((x) => x.cssText)
        .join("\n");
    } catch {}
  }
  const dark = document.documentElement.classList.contains("dark");
  const html = `<!doctype html><html lang="de" class="${dark ? "dark" : ""}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${fileBase(r)}</title><style>${css}\nbody{background:var(--bg);padding:24px} .no-print{display:none!important}</style></head><body><div style="max-width:1200px;margin:0 auto">${el.outerHTML}</div></body></html>`;
  downloadBlob(`${fileBase(r)}.html`, "text/html;charset=utf-8", html);
}

// ---------------- Abschnitte ----------------

function Kpi({ label, value, sub, sev }: { label: string; value: string; sub?: string; sev?: "ok" | "warn" | "crit" }) {
  return (
    <div className={cn("rounded-xl border border-line bg-panel px-3 py-2.5", sev === "crit" && "border-crit/50", sev === "warn" && "border-warn/50")}>
      <div className="label truncate text-[9px]">{label}</div>
      <div className={cn("num mt-0.5 truncate text-[18px] font-bold leading-tight", sev === "crit" ? "text-crit" : sev === "warn" ? "text-warn" : "text-ink")}>{value}</div>
      {sub && <div className="truncate text-[10.5px] text-muted">{sub}</div>}
    </div>
  );
}

function ProductionChart({ r }: { r: Report }) {
  const day = r.range === "tag";
  const data = r.series.map((p) => ({ ...p, revenueK: p.revenue !== undefined ? p.revenue / 1000 : undefined }));
  return (
    <div className="h-[230px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: day ? 6 : 42, left: 0, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="t" tickFormatter={(t) => (day ? fmtTime(t) : fmtShortDate(t))} tick={axisTick} axisLine={false} tickLine={false} minTickGap={day ? 26 : 18} />
          <YAxis yAxisId="g" tick={axisTick} tickFormatter={(v) => (v >= 1e6 ? `${fmtNum(v / 1e6, 1)} Mio` : `${fmtNum(v / 1000, 0)}k`)} axisLine={false} tickLine={false} width={46} />
          {!day && <YAxis yAxisId="r" orientation="right" tick={axisTick} tickFormatter={(v) => `${fmtNum(v, 0)} T€`} axisLine={false} tickLine={false} width={46} />}
          <Tooltip content={<ChartTip labelFormat={(l) => (day ? `${fmtTime(Number(l))}–${fmtTime(Number(l) + 3_600_000)}` : fmtShortDate(Number(l)))} valueFormat={(v, key) => (key === "revenueK" ? `${fmtNum(v, 1)} T€` : `${fmtInt(v)} Stk`)} />} />
          <Bar yAxisId="g" dataKey="good" name="Gutteile" isAnimationActive={false} radius={[3, 3, 0, 0]}>
            {data.map((p, i) => (
              <Cell key={i} fill={SEV_FILL[p.sev] ?? "var(--accent)"} />
            ))}
          </Bar>
          {day && <Bar yAxisId="g" dataKey="forecast" name="KI-Prognose" fill="var(--accent)" fillOpacity={0.18} stroke="var(--accent)" strokeDasharray="3 3" isAnimationActive={false} radius={[3, 3, 0, 0]} />}
          <Line yAxisId="g" dataKey="target" name="Soll" stroke="var(--ink-2)" strokeDasharray="5 4" strokeWidth={1.4} dot={false} isAnimationActive={false} />
          {!day && <Line yAxisId="r" dataKey="revenueK" name="Umsatz" stroke="var(--ok)" strokeWidth={2} dot={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
      <Legend
        className="mt-1.5"
        items={[
          { color: "var(--accent)", label: "blau: ≥ 88 % vom Soll" },
          { color: "var(--warn)", label: "gelb: 72–88 %" },
          { color: "var(--crit)", label: "rot: < 72 % (Einbruch)" },
          { color: "var(--ink-2)", kind: "dash", label: "gestrichelt: Soll aller Linien" },
          ...(day ? [{ color: "var(--accent)", kind: "area" as const, label: "hell gestrichelt: KI-Prognose bis 06:00" }] : [{ color: "var(--ok)", kind: "line" as const, label: "grüne Linie: Umsatz (rechte Achse)" }]),
        ]}
        note={day ? "Säule = Gutteile aller angebundenen Linien je Stunde" : "Säule = Gutteile je Produktionstag (06–06 Uhr)"}
      />
    </div>
  );
}

function ReportView({ r }: { r: Report }) {
  const k = r.kpi;
  const maxLoss = Math.max(1, ...r.reasons.map((x) => x.lossEur));
  const title = r.range === "tag" ? (r.offset === 0 ? "Tagesbericht" : "Tagesbericht (Vortag)") : r.range === "woche" ? "Wochenbericht" : "Monatsbericht";
  return (
    <article id="report" className="space-y-4">
      {/* Kopf */}
      <section className="panel ai-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="label">{r.plant}</div>
            <h2 className="wide mt-1 text-[22px] font-bold leading-tight">
              {title} · {r.label}
            </h2>
            <div className="mt-0.5 text-[11.5px] text-muted">
              Erstellt {fmtDateTime(r.generatedAt)} von KI-Werk{r.live ? " · Tag läuft noch (Stand jetzt)" : ""} · Produktionstag 06:00–06:00
            </div>
          </div>
          <Badge sev={k.oee >= 0.85 ? "ok" : k.oee >= 0.75 ? "warn" : "crit"}>Ist/Soll {fmtPct(k.oee, 1)}</Badge>
        </div>
        <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-panel-2 p-3.5">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-accent" />
          <div className="space-y-1 text-[12.5px] leading-relaxed text-ink-2">
            <div className="text-[12px] font-semibold text-ink">Management-Zusammenfassung</div>
            {r.summary.map((s, i) => (
              <p key={i}>{s}</p>
            ))}
          </div>
        </div>
      </section>

      {/* Kennzahlen */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Gutteile" value={k.good >= 1e6 ? `${fmtNum(k.good / 1e6, 2)} Mio` : fmtInt(k.good)} sub={`Soll ${k.target >= 1e6 ? `${fmtNum(k.target / 1e6, 2)} Mio` : fmtInt(k.target)}`} />
        <Kpi label="Ist / Soll" value={fmtPct(k.oee, 1)} sub={`Verfügbarkeit ${fmtPct(k.availability, 0)}`} sev={k.oee < 0.75 ? "crit" : k.oee < 0.85 ? "warn" : "ok"} />
        <Kpi label="Ausschuss" value={fmtPct(k.scrapRate, 2)} sub={`${fmtInt(k.scrap)} Stk`} sev={k.scrapRate > 0.012 ? "warn" : undefined} />
        <Kpi label="Stillstand" value={`${fmtNum(k.stoerH + k.ruestH + k.wartH, 1)} h`} sub={`${k.stops} Unterbrechungen`} />
        <Kpi label="Verlust (entg. DB)" value={fmtKEur(k.lossEur)} sub={`Stillstand ${fmtKEur(k.lossDowntime)} · Ausschuss ${fmtKEur(k.lossScrap)}`} sev="crit" />
        <Kpi label="Energie" value={`${fmtNum(k.energyKwh / 1000, 1)} MWh`} sub={`${fmtNum(k.co2kg / 1000, 1)} t CO₂e · ${fmtKEur(k.energyCost)}`} />
        <Kpi label="Umsatz" value={fmtKEur(k.revenue)} sub="fakturiert bei Abfahrt" />
        <Kpi label="Deckungsbeitrag" value={fmtKEur(k.margin)} sub={`${fmtPct(k.revenue > 0 ? k.margin / k.revenue : 0, 0)} vom Umsatz`} />
        <Kpi label="Ergebnis" value={`${k.result >= 0 ? "+" : ""}${fmtKEur(k.result)}`} sub={`nach Fixkosten ${fmtKEur(k.fixed)}`} sev={k.result < 0 ? "crit" : "ok"} />
        <Kpi label="LKW" value={`${r.yard.abholung + r.yard.anlieferung + r.yard.entsorgung}`} sub={`${r.yard.abholung} ab · ${r.yard.anlieferung} an · ${r.yard.entsorgung} Entsorgung`} />
        <Kpi label="Verspätet / überzogen" value={`${r.yard.late} / ${r.yard.overstay}`} sub={`Ø Standzeit ${r.yard.avgDwellMin} min`} sev={r.yard.late + r.yard.overstay > 2 ? "warn" : undefined} />
        <Kpi label="Liefertreue" value={fmtPct(k.onTimeDelivery, 1)} sub={`${r.forecast.atRisk} Aufträge mit Risiko`} sev={r.forecast.atRisk ? "warn" : "ok"} />
      </section>
      <Legend
        items={[
          { color: "var(--crit)", kind: "ring", label: "roter Rahmen/rote Zahl: kritisch bzw. Verlust" },
          { color: "var(--warn)", kind: "ring", label: "gelb: unter Ziel, beobachten" },
          { color: "var(--ok)", kind: "dot", label: "grüne Zahl: im Ziel" },
        ]}
        note="Ziele: Ist/Soll ≥ 85 % · Ausschuss ≤ 1,2 % · Ergebnis ≥ 0"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title={r.range === "tag" ? "Ausbringung je Stunde" : "Ausbringung und Umsatz je Tag"} subtitle={r.range === "tag" ? "Gutteile aller Linien · Soll gestrichelt · rot = Einbruch · hell = KI-Prognose" : "Gutteile (Säulen) · Soll · Umsatz (Linie)"} icon={<BarChart3 size={16} />}>
          <ProductionChart r={r} />
        </Panel>
        <Panel title="Verlustursachen" subtitle="Pareto nach entgangenem Deckungsbeitrag" icon={<AlertTriangle size={16} />}>
          <div className="space-y-2.5">
            {r.reasons.map((x) => (
              <BarRow key={x.reason} label={`${x.reason} · ${x.count}×`} value={x.lossEur} max={maxLoss} color="var(--crit)" right={`${fmtNum(x.min, 0)} min · ${fmtEur(x.lossEur)}`} />
            ))}
            {!r.reasons.length && <div className="text-[12px] text-muted">Keine Stillstände im Zeitraum.</div>}
          </div>
          <Legend className="mt-3" items={[{ color: "var(--crit)", label: "roter Balken: Anteil am größten Verlustposten" }]} note="rechts: Stillstandsminuten · entgangener Deckungsbeitrag" />
        </Panel>
      </div>

      <Panel title="Maschinen" subtitle="Wer hat wie viel produziert – und wo lag das Problem" icon={<Factory size={16} />} bodyClassName="px-0 pb-1">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                {["Maschine", "Produkt", "Gutteile", "Ist/Soll", "Verfügb.", "Ausschuss", "Störung", "Rüsten", "Unterbr.", "Verlust", "Temp. max", "Hauptursache"].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.machines.map((m) => (
                <tr key={m.id} className="border-b border-line-2 last:border-0">
                  <td className="num px-3 py-1.5 font-bold">{m.id}</td>
                  <td className="px-3 py-1.5 text-ink-2">{m.product}</td>
                  <td className="num px-3 py-1.5">{fmtInt(m.good)}</td>
                  <td className={cn("num px-3 py-1.5 font-semibold", m.oee < 0.75 ? "text-crit" : m.oee < 0.85 ? "text-warn" : "text-ok")}>{fmtPct(m.oee, 1)}</td>
                  <td className="num px-3 py-1.5">{fmtPct(m.availability, 0)}</td>
                  <td className={cn("num px-3 py-1.5", m.scrapRate > 0.015 && "text-warn")}>{fmtPct(m.scrapRate, 2)}</td>
                  <td className="num px-3 py-1.5">{fmtNum(m.stoerH, 1)} h</td>
                  <td className="num px-3 py-1.5">{fmtNum(m.ruestH, 1)} h</td>
                  <td className="num px-3 py-1.5">{m.stops}</td>
                  <td className="num px-3 py-1.5 text-crit">{fmtEur(m.lossEur)}</td>
                  <td className="num px-3 py-1.5">{fmtNum(m.temp1Max, 1)} °C</td>
                  <td className="max-w-[220px] truncate px-3 py-1.5 text-muted" title={m.topReason}>
                    {m.topReason ?? "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Legend
          className="px-4 pb-2 pt-2"
          items={[
            { color: "var(--ok)", kind: "dot", label: "Ist/Soll grün: ≥ 85 %" },
            { color: "var(--warn)", kind: "dot", label: "gelb: 75–85 %" },
            { color: "var(--crit)", kind: "dot", label: "rot: < 75 %" },
          ]}
          note="Verlust = entgangener Deckungsbeitrag durch Stillstand, langsamen Zyklus und Ausschuss"
        />
      </Panel>

      {r.range === "tag" && (
        <Panel title="Stillstandsprotokoll" subtitle={`${r.stops.length} Einträge · aus MES/BDE`} icon={<Timer size={16} />} bodyClassName="px-0 pb-1">
          <div className="max-h-[360px] overflow-auto print:max-h-none">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead className="sticky top-0 bg-panel">
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                  {["Beginn", "Ende", "Dauer", "Maschine", "Art", "Ursache", "Verlust"].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.stops.map((s) => (
                  <tr key={s.id} className="border-b border-line-2 last:border-0">
                    <td className="num px-3 py-1.5">{fmtTime(s.start)}</td>
                    <td className="num px-3 py-1.5">{s.end ? fmtTime(s.end) : <Badge sev="crit">läuft</Badge>}</td>
                    <td className="num px-3 py-1.5">{fmtNum(s.durMin, 0)} min</td>
                    <td className="num px-3 py-1.5 font-semibold">{s.machineId}</td>
                    <td className="px-3 py-1.5">
                      <Badge sev={s.status === "STOERUNG" ? "crit" : s.status === "WARTUNG" ? "info" : "neutral"}>{s.status === "STOERUNG" ? "Störung" : s.status === "RUESTEN" ? "Rüsten" : s.status === "WARTUNG" ? "Wartung" : "Stillstand"}</Badge>
                    </td>
                    <td className="px-3 py-1.5 text-ink-2">{s.reason}</td>
                    <td className="num px-3 py-1.5 text-crit">{fmtEur(s.lossEur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title={r.range === "tag" ? "LKW-Bewegungen" : "LKW je Tag"} subtitle={r.range === "tag" ? "Ankunft, Abfahrt, Ware, Partner, Verspätung und Standzeit" : "Abholungen · Anlieferungen · Verspätungen"} icon={<Truck size={16} />} bodyClassName="px-0 pb-1">
        {r.range === "tag" ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                  {["Kennzeichen", "Art", "Partner · Ort", "Fahrer · Spedition", "Ware", "Menge", "Ankunft", "Abfahrt", "Verspätung", "Standzeit"].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.trucks.map((v) => (
                  <tr key={v.id} className="border-b border-line-2 last:border-0">
                    <td className="px-3 py-1.5">
                      <Plate text={v.plate} small />
                    </td>
                    <td className="px-3 py-1.5">
                      <KindBadge kind={v.kind} />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="font-semibold">{v.partner}</div>
                      <div className="text-[10.5px] text-muted">{v.kind === "abholung" ? v.to.city : v.from.city}</div>
                    </td>
                    <td className="px-3 py-1.5">
                      <div>{v.driver}</div>
                      <div className="text-[10.5px] text-muted">{v.carrier}</div>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-1.5 text-ink-2" title={v.cargo}>
                      {v.cargo}
                    </td>
                    <td className="num px-3 py-1.5">
                      {fmtInt(v.qty)} {v.unit}
                      {v.pallets ? <div className="text-[10.5px] text-muted">{v.pallets} Pal.</div> : null}
                    </td>
                    <td className="num px-3 py-1.5">{v.arrivedAt ? fmtTime(v.arrivedAt) : <span className="text-muted">erw. {fmtTime(v.slotStart)}</span>}</td>
                    <td className="num px-3 py-1.5">{v.departedAt ? fmtTime(v.departedAt) : v.arrivedAt ? <Badge sev="info">auf dem Hof</Badge> : "–"}</td>
                    <td className={cn("num px-3 py-1.5", v.lateMin > 30 ? "font-semibold text-crit" : v.lateMin > 5 ? "text-warn" : "text-muted")}>{v.lateMin > 0.5 ? `+${fmtNum(v.lateMin, 0)} min` : "pünktlich"}</td>
                    <td className={cn("num px-3 py-1.5", v.overstayMin > 0 ? "font-semibold text-crit" : "")}>{v.arrivedAt ? `${fmtNum(v.onSiteMin, 0)} min${v.overstayMin > 0 ? ` (+${fmtNum(v.overstayMin, 0)})` : ""}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-[200px] px-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={r.yardDays} margin={{ top: 8, right: 6, left: -12, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="day" tickFormatter={(t) => fmtShortDate(t)} tick={axisTick} axisLine={false} tickLine={false} minTickGap={16} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} width={34} allowDecimals={false} />
                <Tooltip content={<ChartTip labelFormat={(l) => fmtShortDate(Number(l))} valueFormat={(v) => `${fmtInt(v)}`} />} />
                <Bar dataKey="abholung" name="Abholungen" stackId="a" fill="var(--accent)" isAnimationActive={false} />
                <Bar dataKey="anlieferung" name="Anlieferungen" stackId="a" fill="var(--ok)" isAnimationActive={false} />
                <Bar dataKey="entsorgung" name="Entsorgung" stackId="a" fill="var(--faint)" isAnimationActive={false} radius={[3, 3, 0, 0]} />
                <Line dataKey="late" name="verspätet" stroke="var(--crit)" strokeWidth={1.8} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <Legend
              className="mt-1"
              items={[
                { color: "var(--accent)", label: "Abholungen" },
                { color: "var(--ok)", label: "Anlieferungen" },
                { color: "var(--faint)", label: "Entsorgung" },
                { color: "var(--crit)", kind: "line", label: "rote Linie: verspätete Fahrzeuge" },
              ]}
            />
          </div>
        )}
        {r.range === "tag" && (
          <Legend
            className="px-4 pb-2 pt-2"
            items={[
              { color: "var(--crit)", kind: "dot", label: "rot: > 30 min verspätet bzw. Standzeit überschritten (+min)" },
              { color: "var(--warn)", kind: "dot", label: "gelb: 5–30 min verspätet" },
            ]}
            note="Verspätung = Ankunft nach Ende des Zeitfensters · Standzeit = Tor bis Abfahrt"
          />
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Fertigwarenlager" subtitle="Bestand je Artikel · Veränderung im Zeitraum" icon={<Boxes size={16} />} bodyClassName="px-0 pb-1">
          <table className="w-full text-[12px]">
            <tbody>
              {r.stock.map((s) => (
                <tr key={s.productId} className="border-b border-line-2 last:border-0">
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <ProductArt productId={s.productId} size={34} />
                      <div className="min-w-0">
                        <div className="font-semibold">{s.short}</div>
                        <div className="text-[10.5px] text-muted">{s.location}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num px-3 py-1.5 text-right">
                    <b>{fmtInt(s.pallets)}</b> Pal.
                    <div className="text-[10.5px] text-muted">{fmtInt(s.pieces)} Stk</div>
                  </td>
                  <td className={cn("num px-3 py-1.5 text-right", s.change < 0 ? "text-crit" : "text-ok")}>
                    {s.change >= 0 ? "+" : ""}
                    {fmtNum(s.change / s.piecesPerPallet, 0)} Pal.
                  </td>
                  <td className="px-3 py-1.5">
                    <Sparkline data={s.series.map((x) => x.pieces)} width={90} height={24} color={s.state === "ok" ? "var(--accent)" : "var(--warn)"} />
                  </td>
                  <td className="px-3 py-1.5 text-right">{s.state !== "ok" ? <Badge sev={s.state}>unter Min.</Badge> : <span className="text-[10.5px] text-muted">min. {s.minPallets}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Legend
            className="px-4 pb-2 pt-2"
            items={[
              { color: "var(--ok)", kind: "dot", label: "+ grün: Bestand gestiegen" },
              { color: "var(--crit)", kind: "dot", label: "− rot: gesunken" },
              { color: "var(--accent)", kind: "line", label: "Kurve: Bestandsverlauf im Zeitraum" },
            ]}
            note="min. = Sicherheitsbestand in Paletten"
          />
        </Panel>
        <Panel title="Kunden im Zeitraum" subtitle="Umsatz, Menge und Deckungsbeitrag (nach Material)" icon={<Euro size={16} />} bodyClassName="px-0 pb-1">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                {["Kunde", "Umsatz", "Stück", "DB", "DB %"].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.customers.slice(0, 10).map((c) => (
                <tr key={c.id} className="border-b border-line-2 last:border-0">
                  <td className="px-3 py-1.5">
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-[10.5px] text-muted">{c.city}</div>
                  </td>
                  <td className="num px-3 py-1.5">{fmtKEur(c.revenue)}</td>
                  <td className="num px-3 py-1.5">{c.pieces >= 1e6 ? `${fmtNum(c.pieces / 1e6, 2)} Mio` : fmtInt(c.pieces)}</td>
                  <td className="num px-3 py-1.5">{fmtKEur(c.db)}</td>
                  <td className="num px-3 py-1.5">{fmtPct(c.marginPct, 0)}</td>
                </tr>
              ))}
              {!r.customers.length && (
                <tr>
                  <td className="px-3 py-4 text-muted" colSpan={5}>
                    Noch keine Abholungen im Zeitraum.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel title="KI-Prognose" subtitle="Aus Maschinenzustand, Auftragsplan und Zykluszeiten" icon={<Sparkles size={16} />} ai>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Kpi label="Gutteile bis 06:00" value={`${fmtNum(r.forecast.endOfDayGood / 1e6, 2)} Mio`} sub={`Soll ${fmtNum(r.forecast.endOfDayTarget / 1e6, 2)} Mio`} sev={r.forecast.endOfDayGood / r.forecast.endOfDayTarget < 0.85 ? "warn" : "ok"} />
            <Kpi label="Monatsumsatz (Prognose)" value={fmtKEur(r.forecast.monthRevenue)} sub={`Budget ${fmtKEur(r.forecast.monthBudget)} · bisher ${fmtKEur(r.forecast.mtdRevenue)}`} sev={r.forecast.monthRevenue < r.forecast.monthBudget * 0.95 ? "warn" : "ok"} />
            <Kpi label="Aufträge mit Risiko" value={`${r.forecast.atRisk}`} sub={`von ${r.forecast.orders.length} betrachteten`} sev={r.forecast.atRisk ? "warn" : "ok"} />
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                {["Auftrag", "Kunde", "Fortschritt", "Prognose Ankunft", "Liefertermin", "Pünktlich"].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.forecast.orders.map((o) => (
                <tr key={o.id} className="border-b border-line-2 last:border-0">
                  <td className="num px-2 py-1.5 font-semibold">{o.id}</td>
                  <td className="max-w-[150px] truncate px-2 py-1.5" title={o.customer}>
                    {o.customer}
                    <div className="text-[10.5px] text-muted">
                      {o.product} · {o.machineId}
                    </div>
                  </td>
                  <td className="num px-2 py-1.5">{fmtPct(o.progress, 0)}</td>
                  <td className="num px-2 py-1.5">{fmtDateTime(o.projectedDone)}</td>
                  <td className="num px-2 py-1.5">{fmtDateTime(o.due)}</td>
                  <td className="px-2 py-1.5" title={o.riskReason}>
                    <Badge sev={o.risk === "gefaehrdet" ? "crit" : o.risk === "beobachten" ? "warn" : "ok"}>{fmtPct(o.onTimeProb, 0)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Legend
            className="mt-2"
            items={[
              { color: "var(--ok)", label: "grün: ≥ 82 % Wahrscheinlichkeit pünktlich" },
              { color: "var(--warn)", label: "gelb: 55–82 % beobachten" },
              { color: "var(--crit)", label: "rot: < 55 % gefährdet" },
            ]}
            note="Prognose Ankunft = Fertigstellung laut Maschinenplan + QS + Verladung + Fahrzeit"
          />
        </Panel>
        <Panel title="KI-Empfehlungen" subtitle="Was jetzt zu tun ist – mit geschätzter Wirkung" icon={<Lightbulb size={16} />} ai>
          <div className="space-y-2">
            {r.recommendations.map((x) => (
              <div key={x.id} className={cn("rounded-xl border p-2.5", x.sev === "crit" ? "border-crit/50 bg-crit-soft/30" : x.sev === "warn" ? "border-warn/50" : "border-line")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="label text-[9px]">{x.area}</div>
                    <div className="text-[12.5px] font-semibold leading-snug">{x.title}</div>
                  </div>
                  {x.impactEur ? <span className="num shrink-0 rounded-md bg-ok-soft px-1.5 py-0.5 text-[10.5px] font-bold text-ok">~{fmtEur(x.impactEur)}</span> : null}
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted">{x.detail}</div>
                <div className="mt-1 text-[11.5px] font-medium text-ink-2">→ {x.action}</div>
              </div>
            ))}
            {!r.recommendations.length && <div className="text-[12px] text-muted">Keine Maßnahmen nötig – alles im Soll.</div>}
          </div>
          <Legend
            className="mt-2"
            items={[
              { color: "var(--crit)", kind: "ring", label: "roter Rahmen: dringend" },
              { color: "var(--warn)", kind: "ring", label: "gelb: bald handeln" },
              { color: "var(--line)", kind: "ring", label: "grau: Hinweis" },
              { color: "var(--ok)", label: "grünes Feld: geschätzte Wirkung in €" },
            ]}
          />
        </Panel>
      </div>
      <div className="pb-2 text-center text-[10.5px] text-faint">Automatisch erzeugt von KI-Werk · Quellen: MES/BDE (15-min-Raster), OPC UA, SAP S/4HANA, WMS, TMS/Pförtner · simulierte Werksdaten (Prototyp)</div>
    </article>
  );
}

function Inner() {
  const sp = useSearchParams();
  const initial = (sp.get("r") as Sel) || "heute";
  const [sel, setSel] = useState<Sel>(["heute", "gestern", "woche", "monat"].includes(initial) ? initial : "heute");
  const r = useReport(sel);
  const openCopilot = useUi((s) => s.openCopilot);
  return (
    <div>
      <div className="no-print">
        <PageHeader
          eyebrow={
            <>
              <FileText size={12} /> Berichte · automatisch aus allen Systemen
            </>
          }
          title="Der Tag auf einen Blick – als Bericht zum Mitnehmen."
          desc="Produktion je Maschine, Stillstände mit Kosten, LKW-Bewegungen, Lagerbestände, Umsatz und Deckungsbeitrag – plus KI-Prognose und Empfehlungen. Als PDF, Excel (CSV) oder eigenständige HTML-Datei."
          actions={
            <>
              <Tabs
                value={sel}
                onChange={setSel}
                items={[
                  { value: "heute", label: "Heute" },
                  { value: "gestern", label: "Gestern" },
                  { value: "woche", label: "7 Tage" },
                  { value: "monat", label: "30 Tage" },
                ]}
              />
              <Button onClick={() => window.print()} disabled={!r} title="Druckdialog → „Als PDF speichern“">
                <Printer size={14} /> PDF
              </Button>
              <Button onClick={() => r && exportCsv(r)} disabled={!r}>
                <FileSpreadsheet size={14} /> Excel (CSV)
              </Button>
              <Button onClick={() => r && exportHtml(r)} disabled={!r}>
                <Download size={14} /> HTML
              </Button>
              <Button variant="ai" onClick={() => openCopilot(`Fasse den ${sel === "woche" ? "Wochenbericht" : sel === "monat" ? "Monatsbericht" : "Tagesbericht"} zusammen und sag mir, was ich tun soll.`)}>
                <Sparkles size={14} /> Erklären
              </Button>
            </>
          }
        />
      </div>
      {r ? <ReportView r={r} /> : <div className="skeleton h-[70vh] rounded-2xl" />}
    </div>
  );
}

export default function BerichtPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-2xl" />}>
      <Inner />
    </Suspense>
  );
}
