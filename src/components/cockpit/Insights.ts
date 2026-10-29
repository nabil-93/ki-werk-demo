// Abgeleitetes KI-Lagebild (deterministisch aus dem Live-Zustand)

import { fmtEur, fmtPct } from "@/lib/ai/format";
import type { Severity, Snapshot } from "@/lib/sim/types";

export interface Insight {
  id: string;
  sev: Severity;
  area: string;
  title: string;
  detail: string;
  href: string;
  ask?: string;
}

export function buildInsights(s: Snapshot): Insight[] {
  const out: Insight[] = [];
  // Maschinen: Befunde des KI-Wächters (dieselben Ursachen, Zahlen und Empfehlungen wie in der Rubrik Maschinengesundheit)
  for (const f of s.guard.findings.slice(0, 3)) {
    out.push({
      id: f.id,
      sev: f.sev,
      area: f.early ? "KI-Wächter · Frühwarnung" : "KI-Wächter",
      title: `${f.machineId}: ${f.title}`,
      detail: `${f.cause}. Drohend ${fmtEur(f.lossEur72)}${f.action ? ` → ${f.action}` : ""}`,
      href: `/waechter?tab=akte&m=${f.machineId}`,
      ask: `${f.machineId}: ${f.title}. Was droht, warum, und welche Maßnahme empfiehlst du?`,
    });
  }
  for (const m of s.machines.filter((m) => m.status === "STOERUNG").slice(0, 2)) {
    out.push({ id: `st-${m.id}`, sev: "crit", area: "Produktion", title: `${m.id} steht: ${m.statusReason ?? "Störung"}`, detail: "Instandhaltung informiert – betroffene Aufträge werden neu bewertet.", href: `/produktion?m=${m.id}` });
  }
  const atRisk = s.orders.filter((o) => o.risk === "gefaehrdet");
  if (atRisk.length)
    out.push({ id: "orders", sev: "warn", area: "Vertrieb", title: `${atRisk.length} Liefertermin${atRisk.length > 1 ? "e" : ""} gefährdet`, detail: atRisk.slice(0, 2).map((o) => `${o.id} (${o.customer})`).join(", "), href: "/vertrieb", ask: "Welche Aufträge sind terminlich gefährdet?" });
  for (const inq of s.inquiries.filter((i) => i.status === "OFFEN"))
    out.push({ id: `inq-${inq.id}`, sev: "info", area: "Vertrieb", title: `Eilanfrage ${inq.qty.toLocaleString("de-DE")} Stk wartet auf Antwort`, detail: "Machbarkeit (Kapazität, Material, Transport) in Sekunden prüfen.", href: "/vertrieb", ask: "Können wir die Eilanfrage von Alpenmilch zusagen?" });
  for (const mat of s.materials.filter((m) => m.state !== "ok"))
    out.push({
      id: `mat-${mat.id}`,
      sev: mat.state,
      area: "Logistik",
      title: `${mat.name}: nur noch ${mat.reachDays.toFixed(1).replace(".", ",")} Tage Reichweite`,
      detail: mat.inbound[0]?.status === "VERSPAETET" ? `Lieferant meldet ${mat.inbound[0].delayedH} h Verzug.` : "Unter Meldebestand – Bestellvorschlag prüfen.",
      href: `/logistik?mat=${mat.id}`,
      ask: "Wie lange reicht unser IML-Granulat noch und was schlägst du vor?",
    });
  const drafts = s.tickets.filter((t) => t.status === "ENTWURF");
  if (drafts.length) out.push({ id: "drafts", sev: "info", area: "Freigaben", title: `${drafts.length} KI-Vorschlag${drafts.length > 1 ? "e" : ""} wartet auf Freigabe`, detail: drafts[0].reason, href: "/werksexperte#freigaben" });
  if (!out.length)
    out.push({
      id: "ok",
      sev: "ok",
      area: "Werk",
      title: `Alle Prozesse stabil · OEE ${fmtPct(s.kpis.oee)}`,
      detail: `${s.kpis.machinesRunning} von ${s.kpis.machinesTotal} Maschinen produzieren. Der KI-Wächter meldet keine Befunde, alle Reichweiten im Soll.`,
      href: "/produktion",
      ask: "Erstelle das Lagebild für die aktuelle Schicht.",
    });
  const order = { crit: 0, warn: 1, info: 2, ok: 3 };
  return out.sort((a, b) => order[a.sev] - order[b.sev]);
}
