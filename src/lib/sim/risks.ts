// Risiko-Radar: Experteneinschätzung über alle Bereiche des Werks – was kann in den nächsten 72 h passieren,
// wie wahrscheinlich ist es, was kostet es und was ist zu tun. Maschinenbefunde kommen 1:1 aus dem KI-Wächter
// (gleiche Zahlen wie überall), dazu Liefertermine, Material, Fertigwaren, LKW-Hof, Datenlücken und Monatsziel.

import { orderView } from "./analysis";
import { PRODUCT } from "./catalog";
import type { Plant } from "./engine";
import { guardianView } from "./guardian";
import { financeView, stockViews, yardSummary } from "./reports";
import { H } from "./time";
import { materialViews } from "./views";
import { fmtDateTime, fmtEur, fmtInt, fmtNum, fmtPct } from "../ai/format";

export interface RiskItem {
  id: string;
  bereich: "Maschine" | "Qualität" | "Liefertermin" | "Material" | "Fertigware" | "LKW-Hof";
  titel: string;
  /** Eintrittswahrscheinlichkeit 0–1 */
  p: number;
  /** erwarteter Verlust in € (Wahrscheinlichkeit × Auswirkung) */
  eur: number;
  wann: string;
  ursache: string;
  empfehlung: string;
  href: string;
  machineId?: string;
  orderId?: string;
  materialId?: string;
}

export interface RiskRadar {
  now: number;
  lage: "stabil" | "angespannt" | "kritisch";
  items: RiskItem[];
  totalEur: number;
  withActionsEur: number;
  /** Maschinen ohne Datenanschluss – dort sieht die KI nichts */
  blind: string[];
  ziel?: { forecast: number; budget: number; gap: number };
}

const TERMIN_LOSS = (valueEur: number) => 0.06 * valueEur + 900; // wie im KI-Wächter: Vertragsstrafe + Sonderfracht

export function riskRadar(plant: Plant): RiskRadar {
  const now = plant.now;
  const g = guardianView(plant);
  const items: RiskItem[] = [];
  const covered = new Set<string>();

  // 1 · Maschinen (KI-Wächter)
  for (const m of g.machines)
    for (const f of m.findings) {
      if (f.sev === "info" && !f.early) continue;
      const rec = f.actions.find((a) => a.recommended);
      if (f.kind === "termin") covered.add(f.title.match(/FA-\d+/)?.[0] ?? "");
      items.push({
        id: f.id,
        bereich: f.kind === "qualitaet" ? "Qualität" : f.kind === "termin" ? "Liefertermin" : "Maschine",
        titel: `${m.id}: ${f.title}`,
        p: f.probability,
        eur: f.lossEur72,
        wann: f.horizon,
        ursache: f.cause,
        empfehlung: rec && !rec.baseline ? `${rec.label} (${rec.when}) – kostet ${fmtEur(rec.costEur)}, vermeidet ${fmtEur(rec.avoidedEur)}` : "beobachten",
        href: `/waechter?tab=akte&m=${m.id}`,
        machineId: m.id,
      });
    }

  // 2 · Liefertermine, die nicht schon als Maschinenbefund laufen
  for (const o of plant.openOrders()) {
    if (covered.has(o.id)) continue;
    const v = orderView(plant, o);
    if (v.risk === "ok") continue;
    const p = 1 - v.onTimeProb;
    items.push({
      id: `termin-${o.id}`,
      bereich: "Liefertermin",
      titel: `${o.id} · ${v.customer} (${v.productShort})`,
      p,
      eur: TERMIN_LOSS(o.valueEur) * p,
      wann: `Termin ${fmtDateTime(o.due)}`,
      ursache: v.riskReason ?? "Warteschlange zu lang für den Termin",
      empfehlung: "Umplanung auf freie, kompatible Maschine prüfen oder Teillieferung mit dem Kunden abstimmen",
      href: "/vertrieb",
      orderId: o.id,
    });
  }

  // 3 · Material: reicht der Bestand bis zur nächsten Lieferung?
  for (const mat of materialViews(plant)) {
    if (mat.state === "ok") continue;
    const users = plant.machines.filter((m) => PRODUCT[m.productId]?.material === mat.id && m.status !== "STILLSTAND");
    const costH = users.reduce((s, m) => s + m.costPerHour, 0);
    const next = mat.inbound.filter((i) => i.status !== "ANGEKOMMEN").sort((a, b) => a.eta - b.eta)[0];
    const reachH = mat.reachDays * 24;
    const gapH = next ? Math.max(0, (next.eta - now) / H - reachH) : Math.max(0, 72 - reachH);
    const p = gapH > 0 ? 0.85 : mat.state === "crit" ? 0.5 : 0.25;
    const impactH = gapH > 0 ? Math.min(gapH, 48) : 6;
    items.push({
      id: `material-${mat.id}`,
      bereich: "Material",
      titel: `${mat.name}: Reichweite ${fmtNum(mat.reachDays, 1)} Tage`,
      p,
      eur: p * impactH * costH,
      wann: gapH > 0 ? `Engpass ab ca. ${fmtDateTime(now + reachH * H)}` : `Meldebestand ${mat.reorderPointDays} Tage unterschritten`,
      ursache: next?.status === "VERSPAETET" ? `Lieferung ${next.id} von ${next.supplier} verspätet${next.delayedH ? ` (+${next.delayedH} h)` : ""}` : next ? `nächste Lieferung erst ${fmtDateTime(next.eta)}` : "keine Lieferung avisiert",
      empfehlung: `Expressbestellung beim Alternativlieferanten auslösen (Freigabe Einkauf)${users.length ? ` – betroffen: ${users.map((m) => m.id).join(", ")}` : ""}`,
      href: "/logistik",
      materialId: mat.id,
    });
  }

  // 4 · Fertigware: kann die nächste Abholung voll bedient werden?
  for (const s of stockViews(plant)) {
    if (!s.nextPickup || s.free >= s.nextPickup.qty) continue;
    const miss = s.nextPickup.qty - s.free;
    const value = (miss * PRODUCT[s.productId].pricePer1000) / 1000;
    const p = s.producingOn.length ? 0.45 : 0.8;
    items.push({
      id: `stock-${s.productId}`,
      bereich: "Fertigware",
      titel: `${s.name}: Abholung ${s.nextPickup.partner} nicht voll gedeckt`,
      p,
      eur: p * TERMIN_LOSS(value),
      wann: `Abholung ${fmtDateTime(s.nextPickup.t)}`,
      ursache: `es fehlen ${fmtInt(miss)} Stk freie Ware${s.producingOn.length ? ` (läuft auf ${s.producingOn.join(", ")})` : " – aktuell in keiner Produktion"}`,
      empfehlung: s.producingOn.length ? "Fertigung priorisieren und Verladung ans Ende des Zeitfensters legen" : "Fertigung einplanen oder Teilabholung mit dem Kunden abstimmen",
      href: "/lager",
    });
  }

  // 5 · LKW-Hof: überzogene Standzeiten blockieren Rampen
  const y = yardSummary(plant);
  if (y.overstay > 0)
    items.push({
      id: "hof-standzeit",
      bereich: "LKW-Hof",
      titel: `${y.overstay} LKW mit überzogener Standzeit`,
      p: 0.9,
      eur: y.overstay * 95,
      wann: "jetzt",
      ursache: "Verladung dauert länger als das Zeitfenster – Standgeld und Folgeverspätung",
      empfehlung: "überzogene Fahrzeuge zuerst abfertigen, Folge-LKW auf freie Rampe umleiten",
      href: "/lager",
    });

  items.sort((a, b) => b.eur - a.eur || b.p - a.p);
  const totalEur = items.reduce((s, r) => s + r.eur, 0);
  // Maschinenrisiken lassen sich laut Wächter bis auf den Restverlust senken, sonstige Risiken grob um 80 %
  const machineRest = g.totals.lossWithActionsEur72;
  const machineLoss = items.filter((r) => r.machineId).reduce((s, r) => s + r.eur, 0);
  const withActionsEur = Math.min(totalEur, machineRest + (totalEur - machineLoss) * 0.2);
  const f = financeView(plant, 30);
  const crit = items.some((r) => r.p >= 0.6 && r.eur >= 5000);
  return {
    now,
    lage: crit ? "kritisch" : items.some((r) => r.eur >= 1000) ? "angespannt" : "stabil",
    items,
    totalEur,
    withActionsEur,
    blind: g.blind.map((b) => b.id),
    ziel: f.month.budget ? { forecast: f.month.forecast, budget: f.month.budget, gap: f.month.forecast - f.month.budget } : undefined,
  };
}

/** kompakte, gut vorlesbare Form für den KI-Werksexperten */
export function riskRadarData(r: RiskRadar) {
  return {
    lage: r.lage,
    werkszeit: fmtDateTime(r.now),
    erwarteter_verlust_72h: fmtEur(r.totalEur),
    mit_empfohlenen_massnahmen: fmtEur(r.withActionsEur),
    anzahl_risiken: r.items.length,
    risiken: r.items.slice(0, 8).map((x) => ({
      bereich: x.bereich,
      risiko: x.titel,
      wahrscheinlichkeit: fmtPct(x.p, 0),
      erwarteter_verlust: fmtEur(x.eur),
      wann: x.wann,
      ursache: x.ursache,
      empfehlung: x.empfehlung,
    })),
    datenluecken: r.blind.length ? `${r.blind.length} Maschinen ohne Datenanschluss (${r.blind.join(", ")}) – dort kann die KI nichts vorhersagen` : "keine",
    monatsziel: r.ziel ? `Prognose ${fmtEur(r.ziel.forecast)} vs. Budget ${fmtEur(r.ziel.budget)} (${r.ziel.gap >= 0 ? "+" : ""}${fmtEur(r.ziel.gap)})` : undefined,
    hinweis: "Wahrscheinlichkeiten aus KI-Modellen und Live-Daten; erwarteter Verlust = Wahrscheinlichkeit × Auswirkung",
  };
}
