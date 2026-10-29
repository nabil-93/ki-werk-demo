// Baut aus dem Simulationszustand die Sichten, die an Oberfläche und KI gehen.

import { CUSTOMER, PRODUCT, WAREHOUSE_CAPACITY, CO2_PER_KWH } from "./catalog";
import { orderView } from "./analysis";
import type { Plant } from "./engine";
import { financeTotals, liveVisits, stockViews, yardSummary } from "./reports";
import { guardianView } from "./guardian";
import { showcaseCases } from "./showcase";
import { Rng, clamp, mean, std } from "./rng";
import { shiftOf } from "./time";
import type { Alert, ConnectorView, Machine, MachineView, MaterialView, OrderView, ShipmentView, Snapshot } from "./types";

export function machineView(plant: Plant, m: Machine): MachineView {
  const p = PRODUCT[m.productId];
  const head = m.queue[0] ? plant.order(m.queue[0]) : undefined;
  const availability = m.plannedSecToday > 0 ? clamp(m.runSecToday / m.plannedSecToday, 0, 1) : 1;
  const performance = plant.performance(m);
  const quality = m.goodToday + m.scrapToday > 0 ? m.goodToday / (m.goodToday + m.scrapToday) : 1;
  const spcVals = m.spc.map((s) => s.value);
  const sd = std(spcVals) || p.spc.tol / 4.6;
  const mu = spcVals.length ? mean(spcVals) : p.spc.nominal;
  const usl = p.spc.nominal + p.spc.tol;
  const lsl = p.spc.nominal - p.spc.tol;
  const cpk = Math.min(usl - mu, mu - lsl) / (3 * sd);
  const lastViolation = m.spc.slice(-4).find((s) => s.violation)?.violation;
  return {
    id: m.id,
    type: m.type,
    hall: m.hall,
    maker: m.maker,
    model: m.model,
    year: m.year,
    cavities: m.cavities,
    targetCycle: m.targetCycle,
    status: m.status,
    statusSince: m.statusSince,
    statusReason: m.statusReason,
    product: { id: p.id, name: p.name, short: p.short },
    orderId: head?.id,
    orderProgress: head ? head.produced / head.qty : undefined,
    outputPerHour: m.status === "PRODUKTION" ? Math.round(plant.ratePerHour(m)) : 0,
    oee: availability * performance * quality,
    availability,
    performance,
    quality,
    goodToday: Math.round(m.goodToday),
    scrapToday: Math.round(m.scrapToday),
    scrapRate: 1 - quality,
    energyKwhToday: Math.round(m.energyKwhToday),
    current: m.current,
    spark: m.live.slice(-40).map((s) => Number(s.vib.toFixed(3))),
    prediction: plant.predictions.get(m.id)!,
    defects: Object.fromEntries(Object.entries(m.defects).map(([k, v]) => [k, Math.round(v)])) as MachineView["defects"],
    spcViolation: lastViolation,
    cpk: Number.isFinite(cpk) ? cpk : 0,
    connectedAt: m.connectedAt,
  };
}

export function materialViews(plant: Plant): MaterialView[] {
  return plant.materials.map((mat) => {
    const perH = plant.expectedConsumptionPerHour(mat.id);
    const reachDays = perH > 0 ? mat.stock / (perH * 24) : 99;
    const inbound = plant.inbound.filter((i) => i.materialId === mat.id && i.status !== "ANGEKOMMEN").sort((a, b) => a.eta - b.eta);
    const state = reachDays < 1.5 ? "crit" : reachDays < mat.reorderPointDays ? "warn" : "ok";
    return { ...mat, consumption: mat.consumption.slice(-24), reachDays, avgPerHour: perH, inbound, state };
  });
}

export function shipmentViews(plant: Plant): ShipmentView[] {
  return plant.shipments.map((s) => {
    const c = CUSTOMER[s.customerId];
    const progress = s.status === "UNTERWEGS" && s.departedAt && s.eta ? clamp((plant.now - s.departedAt) / (s.eta - s.departedAt), 0, 1) : s.status === "ZUGESTELLT" ? 1 : 0;
    return { ...s, customer: c.name, city: c.city, country: c.country, km: c.km, lat: c.lat, lon: c.lon, progress };
  });
}

export function computeAlerts(plant: Plant, machines: MachineView[], orders: OrderView[], materials: MaterialView[]): Alert[] {
  const alerts: Alert[] = [];
  for (const m of machines) {
    if (m.status === "STOERUNG")
      alerts.push({ id: `stoer-${m.id}`, severity: "crit", source: "MES", title: `${m.id} in Störung`, detail: m.statusReason ?? "Ungeplanter Stillstand", machineId: m.id, href: `/produktion?m=${m.id}` });
    const p = m.prediction;
    if (p && m.status === "PRODUKTION" && p.p72 >= 0.45)
      alerts.push({
        id: `pm-${m.id}`,
        severity: p.p72 >= 0.75 ? "crit" : "warn",
        source: "KI",
        title: `${m.id}: Ausfallrisiko ${Math.round(p.p72 * 100)} %`,
        detail: p.rulH !== null ? `Restlaufzeit ca. ${Math.max(1, Math.round(p.rulH))} h · ${p.drivers[0]?.label ?? "Zustand verschlechtert"}` : (p.drivers[0]?.label ?? "Zustand verschlechtert"),
        machineId: m.id,
        href: `/waechter?tab=akte&m=${m.id}`,
      });
    if (m.spcViolation && m.status === "PRODUKTION")
      alerts.push({ id: `spc-${m.id}`, severity: "warn", source: "CAQ", title: `${m.id}: SPC-Regel ${m.spcViolation}`, detail: `Prozess driftet · Cpk ${m.cpk.toFixed(2).replace(".", ",")}`, machineId: m.id, href: `/qualitaet?m=${m.id}` });
    else if (m.scrapRate > 0.025 && m.status === "PRODUKTION")
      alerts.push({ id: `scrap-${m.id}`, severity: "warn", source: "CAQ", title: `${m.id}: Ausschuss ${(m.scrapRate * 100).toFixed(1).replace(".", ",")} %`, detail: "Über Eingriffsgrenze 2,5 %", machineId: m.id, href: `/qualitaet?m=${m.id}` });
  }
  for (const mat of materials) {
    if (mat.state !== "ok")
      alerts.push({
        id: `mat-${mat.id}`,
        severity: mat.state,
        source: "WMS",
        title: `${mat.name}: Reichweite ${mat.reachDays.toFixed(1).replace(".", ",")} Tage`,
        detail: mat.inbound[0] ? `Nächster Zulauf ${mat.inbound[0].status === "VERSPAETET" ? "verspätet" : "geplant"}` : "Kein Zulauf geplant",
        materialId: mat.id,
        href: `/logistik?mat=${mat.id}`,
      });
  }
  for (const o of orders.filter((o) => o.risk === "gefaehrdet").slice(0, 4))
    alerts.push({ id: `ord-${o.id}`, severity: "warn", source: "SAP", title: `Liefertermin ${o.id} gefährdet`, detail: `${o.customer} · ${o.riskReason ?? ""}`, orderId: o.id, href: `/vertrieb?o=${o.id}` });
  for (const inq of plant.inquiries.filter((i) => i.status === "OFFEN"))
    alerts.push({ id: `inq-${inq.id}`, severity: "info", source: "CRM", title: `Kundenanfrage ${CUSTOMER[inq.customerId].name}`, detail: `${inq.qty.toLocaleString("de-DE")} Stk ${PRODUCT[inq.productId].short} – Antwort ausstehend`, href: `/vertrieb?inq=${inq.id}` });
  const drafts = plant.tickets.filter((t) => t.status === "ENTWURF");
  if (drafts.length)
    alerts.push({ id: "tickets", severity: "info", source: "KI", title: `${drafts.length} KI-Vorschlag${drafts.length > 1 ? "e" : ""} zur Freigabe`, detail: drafts[0].reason, href: "/werksexperte#freigaben" });
  const order = { crit: 0, warn: 1, info: 2, ok: 3 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function connectorViews(plant: Plant): ConnectorView[] {
  // eigener Zufall – kosmetische Werte sollen den Simulationsverlauf nicht verändern
  const r = new Rng(Math.floor(plant.now / 1000));
  const now = plant.now;
  const t = plant.connectorTotals;
  const iotDelayed = plant.machines.some((m) => m.status === "STOERUNG") && r.chance(0.1);
  return [
    { id: "sap", name: "SAP S/4HANA", system: "ERP", protocol: "OData v4 · RFC/BAPI", domain: "Aufträge, Kunden, Material, Preise", status: "online", recordsPerMin: r.int(28, 46), latencyMs: r.int(180, 320), lastSync: now - r.int(5, 40) * 1000, totalToday: t.sap ?? 0, quality: 99.2 },
    { id: "mes", name: "MES / BDE", system: "Fertigungssteuerung", protocol: "REST · Webhooks", domain: "Maschinenstatus, Stückzahlen, Stillstände", status: "online", recordsPerMin: r.int(140, 220), latencyMs: r.int(40, 90), lastSync: now - r.int(1, 4) * 1000, totalToday: t.mes ?? 0, quality: 98.7 },
    { id: "iot", name: "OPC UA Gateway", system: "Maschinensteuerungen", protocol: "OPC UA · EUROMAP 77 / 83", domain: "84 Sensorsignale, 1 s Abtastung", status: iotDelayed ? "verzoegert" : "online", recordsPerMin: 84 * 60, latencyMs: iotDelayed ? r.int(900, 1600) : r.int(12, 35), lastSync: now - 1000, totalToday: t.iot ?? 0, quality: 99.8 },
    { id: "caq", name: "CAQ / Prüfplanung", system: "Qualitätsmanagement", protocol: "SQL-Replikation", domain: "Prüfmerkmale, SPC, Kamerabefunde", status: "online", recordsPerMin: r.int(60, 110), latencyMs: r.int(90, 160), lastSync: now - r.int(3, 12) * 1000, totalToday: t.caq ?? 0, quality: 97.9 },
    { id: "wms", name: "Lagerverwaltung (LVS)", system: "WMS", protocol: "REST", domain: "Bestände, Lagerplätze, Wareneingang", status: "online", recordsPerMin: r.int(10, 24), latencyMs: r.int(110, 210), lastSync: now - r.int(10, 60) * 1000, totalToday: t.wms ?? 0, quality: 99.5 },
    { id: "tms", name: "Speditionsportal", system: "TMS", protocol: "EDIFACT IFTSTA · API", domain: "Sendungen, Lieferavis, ETA", status: "online", recordsPerMin: r.int(2, 8), latencyMs: r.int(400, 900), lastSync: now - r.int(30, 180) * 1000, totalToday: t.tms ?? 0, quality: 95.4 },
    { id: "crm", name: "CRM", system: "Vertrieb", protocol: "REST", domain: "Anfragen, Reklamationen, Kontakte", status: "online", recordsPerMin: r.int(1, 5), latencyMs: r.int(150, 300), lastSync: now - r.int(20, 120) * 1000, totalToday: t.crm ?? 0, quality: 96.8 },
    { id: "cmms", name: "Instandhaltung (CMMS)", system: "Wartung", protocol: "REST", domain: "Wartungsaufträge, Ersatzteile, Historie", status: "online", recordsPerMin: r.int(1, 4), latencyMs: r.int(120, 260), lastSync: now - r.int(15, 90) * 1000, totalToday: t.cmms ?? 0, quality: 98.1 },
  ];
}

export function buildSnapshot(plant: Plant): Snapshot {
  const machines = plant.machines.map((m) => machineView(plant, m));
  const orders = plant.orders.map((o) => orderView(plant, o)).sort((a, b) => a.due - b.due);
  const materials = materialViews(plant);
  const shipments = shipmentViews(plant).sort((a, b) => a.slot - b.slot);
  const alerts = computeAlerts(plant, machines, orders, materials);
  const k = plant.kpiCore();
  const open = orders.filter((o) => o.status !== "VERSENDET");
  const shift = shiftOf(plant.now);
  const stock = stockViews(plant);
  const fin = financeTotals(plant.ops.fin);
  return {
    now: plant.now,
    speed: plant.paused ? 0 : plant.speed,
    realtime: plant.isRealtime(),
    shift,
    kpis: {
      oee: k.oee,
      outputToday: Math.round(k.good),
      scrapRate: k.scrapRate,
      onTimeDelivery: plant.delivered.onTime / plant.delivered.total,
      backlogEur: open.reduce((s, o) => s + o.valueEur * (1 - o.progress * 0.0), 0),
      energyKwhToday: Math.round(k.energy),
      co2kgToday: Math.round(k.energy * CO2_PER_KWH),
      machinesRunning: machines.filter((m) => m.status === "PRODUKTION").length,
      machinesTotal: machines.length,
      openAlerts: alerts.filter((a) => a.severity === "crit" || a.severity === "warn").length,
      ordersAtRisk: open.filter((o) => o.risk === "gefaehrdet").length,
      // Fertigwaren + Packmittel/Etiketten (rund 1.650 Stellplätze)
      warehouseUsed: Math.min(WAREHOUSE_CAPACITY, 1650 + stock.reduce((s, x) => s + x.pallets, 0)),
      warehouseCapacity: WAREHOUSE_CAPACITY,
    },
    machines,
    orders,
    materials,
    shipments,
    events: plant.events.slice(0, 60),
    alerts,
    tickets: plant.tickets.slice(0, 30),
    scenarios: Object.values(plant.scenarios),
    inquiries: plant.inquiries,
    connectors: connectorViews(plant),
    history: plant.plantHistory,
    visits: liveVisits(plant),
    yard: yardSummary(plant),
    stock,
    finance: { revenueToday: fin.revenue, marginToday: fin.margin, lossToday: fin.loss, resultToday: fin.result },
    guard: guardSummary(plant),
    showcase: plant.showcase.active ? { active: true, since: plant.showcase.startedAt, cases: showcaseCases(plant) } : { active: false, cases: [] },
  };
}

/** Wichtigste Befunde des KI-Wächters für Leitstand, Seitenleiste und KI-Lagebild */
function guardSummary(plant: Plant): Snapshot["guard"] {
  const g = guardianView(plant);
  const findings = g.machines
    .flatMap((m) => m.findings)
    .filter((f) => f.sev !== "info" || f.early)
    .sort((a, b) => ({ crit: 0, warn: 1, info: 2 })[a.sev] - ({ crit: 0, warn: 1, info: 2 })[b.sev] || b.lossEur72 - a.lossEur72)
    .slice(0, 6)
    .map((f) => {
      const rec = f.actions.find((a) => a.recommended);
      return { id: f.id, machineId: f.machineId, kind: f.kind, sev: f.sev, early: f.early, title: f.title, cause: f.cause, horizon: f.horizon, lossEur72: Math.round(f.lossEur72), action: rec?.label, avoidedEur: rec?.avoidedEur };
    });
  return { findings, lossEur72: g.totals.lossEur72, lossWithActionsEur72: g.totals.lossWithActionsEur72, avoidedTodayEur: g.totals.avoidedTodayEur };
}

export function machineDetail(plant: Plant, id: string) {
  const m = plant.findMachine(id);
  if (!m) return null;
  return {
    view: machineView(plant, m),
    live: m.live,
    hist: m.hist.slice(-288),
    spc: m.spc,
    timeline: m.timeline,
    spcSpec: PRODUCT[m.productId].spc,
    baseline: m.baseline,
    lastMaintenance: m.lastMaintenance,
    failureCount: m.failureCount,
    queue: m.queue.map((id) => plant.order(id)).filter(Boolean).map((o) => orderView(plant, o!)),
  };
}
