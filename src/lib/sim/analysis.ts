// Analysen, die sowohl die Oberfläche als auch der KI-Copilot nutzen:
// Lieferterminprognose, Machbarkeitsprüfung (Capable-to-Promise), Wartungsfenster.

import { CUSTOMER, PRODUCT } from "./catalog";
import type { Plant } from "./engine";
import { clamp } from "./rng";
import { H, nextShiftChange } from "./time";
import type { Machine, Order, OrderView } from "./types";

const TRUCK_KMH = 65;
const QS_H = 0.75;
const DISPATCH_H = 2;

export function transportHours(customerId: string) {
  return CUSTOMER[customerId].km / TRUCK_KMH + 0.4;
}

export function orderView(plant: Plant, o: Order): OrderView {
  const c = CUSTOMER[o.customerId];
  const p = PRODUCT[o.productId];
  const progress = clamp(o.produced / o.qty, 0, 1);
  let projectedDone: number;
  let onTimeProb = 1;
  let risk: OrderView["risk"] = "ok";
  let riskReason: string | undefined;

  if (o.status === "GEPLANT" || o.status === "PRODUKTION") {
    const finish = plant.projectFinish(o);
    projectedDone = finish + (QS_H + DISPATCH_H + transportHours(o.customerId)) * H;
    const slackH = (o.due - projectedDone) / H;
    const remainingH = Math.max(1, (finish - plant.now) / H);
    const scale = 3 + remainingH * 0.12;
    onTimeProb = 1 / (1 + Math.exp(-(slackH + 1.5) / scale));
    const m = plant.machine(o.machineId);
    const pred = plant.predictions.get(m.id);
    if (pred && pred.p72 > 0.45 && m.status === "PRODUKTION") {
      onTimeProb = Math.min(onTimeProb, 1 - pred.p72 * 0.75);
      riskReason = `${m.id}: Ausfallrisiko ${Math.round(pred.p72 * 100)} % in 72 h`;
    } else if (m.status === "STOERUNG") {
      riskReason = `${m.id} in Störung: ${m.statusReason ?? "ungeplanter Stillstand"}`;
    } else if (slackH < 0) {
      riskReason = `Fertigstellung ${Math.abs(slackH).toFixed(1).replace(".", ",")} h nach Liefertermin erwartet`;
    } else if (slackH < 8) {
      riskReason = `Nur ${slackH.toFixed(1).replace(".", ",")} h Puffer bis Liefertermin`;
    }
  } else if (o.status === "QS" || o.status === "VERSANDBEREIT") {
    const sh = plant.shipments.find((s) => s.orderId === o.id);
    projectedDone = sh
      ? Math.max(sh.slot, plant.now) + transportHours(o.customerId) * H
      : plant.now + (o.status === "QS" ? QS_H : 0.5) * H + (DISPATCH_H + transportHours(o.customerId)) * H;
    onTimeProb = projectedDone <= o.due ? 0.98 : 0.3;
    if (projectedDone > o.due) riskReason = `Ankunft voraussichtlich ${((projectedDone - o.due) / H).toFixed(1).replace(".", ",")} h nach Liefertermin`;
  } else {
    const sh = plant.shipments.find((s) => s.orderId === o.id);
    projectedDone = sh?.eta ?? o.doneAt ?? plant.now;
    onTimeProb = projectedDone <= o.due ? 0.99 : 0.2;
  }
  if (onTimeProb < 0.55) risk = "gefaehrdet";
  else if (onTimeProb < 0.82) risk = "beobachten";
  if (risk === "ok") riskReason = undefined;
  else if (!riskReason) {
    const slackH = (o.due - projectedDone) / H;
    riskReason = slackH >= 0 ? `Nur ${slackH.toFixed(1).replace(".", ",")} h Puffer bis Liefertermin` : `Prognose ${Math.abs(slackH).toFixed(1).replace(".", ",")} h nach Liefertermin`;
  }

  return {
    ...o,
    customer: c.name,
    city: c.city,
    product: p.name,
    productShort: p.short,
    progress,
    projectedDone,
    onTimeProb,
    risk,
    riskReason,
  };
}

// ---------------- Machbarkeit (Capable-to-Promise) ----------------

export interface FeasibilityResult {
  feasible: boolean;
  partial: boolean;
  verdict: "machbar" | "konflikt" | "teilweise" | "nicht";
  freeQty: number;
  restQty: number;
  restDelivery?: number;
  productId: string;
  productName: string;
  qty: number;
  due: number;
  customer?: string;
  transportH: number;
  latestFinish: number;
  plan: { machineId: string; qty: number; start: number; end: number; mode: "frei" | "vorgezogen" }[];
  plannedQty: number;
  material: { id: string; name: string; unit: string; needed: number; available: number; inbound: number; ok: boolean }[];
  impacts: { orderId: string; customer: string; delayH: number; stillOnTime: boolean }[];
  revenueEur: number;
  notes: string[];
}

export function checkFeasibility(plant: Plant, productId: string, qty: number, due: number, customerId?: string): FeasibilityResult {
  const p = PRODUCT[productId];
  const transportH = customerId ? transportHours(customerId) : 4;
  const latestFinish = due - (transportH + QS_H + DISPATCH_H) * H;
  const notes: string[] = [];
  let remaining = qty;
  const plan: FeasibilityResult["plan"] = [];
  const impacts: FeasibilityResult["impacts"] = [];

  const machines = plant.machineIdsFor(productId).map((id) => plant.machine(id));
  // 1) Freie Kapazität nach der bestehenden Warteschlange
  for (const m of machines.sort((a, b) => plant.queueEnd(a) - plant.queueEnd(b))) {
    if (remaining <= 0) break;
    const pred = plant.predictions.get(m.id);
    const start = plant.queueEnd(m) + (m.productId === productId ? 0 : 1.2 * H);
    const availH = (latestFinish - start) / H;
    if (availH <= 0.5) continue;
    let rate = plant.ratePerHour(m);
    if (pred && pred.p72 > 0.45) {
      rate *= 1 - pred.p72 * 0.5;
      notes.push(`${m.id} mit Abschlag eingeplant (Ausfallrisiko ${Math.round(pred.p72 * 100)} %).`);
    }
    const cap = Math.floor((availH * rate) / 1000) * 1000;
    const take = Math.min(remaining, cap);
    if (take <= 0) continue;
    plan.push({ machineId: m.id, qty: take, start, end: start + (take / rate) * H, mode: "frei" });
    remaining -= take;
  }
  // 2) Vorziehen vor geplante Aufträge mit Puffer
  if (remaining > 0) {
    for (const m of machines) {
      if (remaining <= 0) break;
      const running = m.queue[0] ? plant.order(m.queue[0]) : undefined;
      const rate = plant.ratePerHour(m);
      const start = running ? plant.now + (Math.max(0, running.qty - running.produced) / rate) * H + (running.productId === productId ? 0 : 1.2 * H) : plant.now + 1.2 * H;
      const availH = (latestFinish - start) / H;
      if (availH <= 0.5) continue;
      const already = plan.filter((x) => x.machineId === m.id).reduce((s, x) => s + x.qty, 0);
      const cap = Math.max(0, Math.floor((availH * rate) / 1000) * 1000 - already);
      const take = Math.min(remaining, cap);
      if (take <= 0) continue;
      const shiftH = take / rate + (running && running.productId !== productId ? 1.2 : 0);
      for (const id of m.queue.slice(1)) {
        const o = plant.order(id);
        if (!o) continue;
        const ov = orderView(plant, o);
        const newDone = ov.projectedDone + shiftH * H;
        impacts.push({ orderId: o.id, customer: ov.customer, delayH: shiftH, stillOnTime: newDone <= o.due });
      }
      plan.push({ machineId: m.id, qty: take, start, end: start + (take / rate) * H, mode: "vorgezogen" });
      remaining -= take;
    }
  }

  // Material
  const plannedQty = qty - Math.max(0, remaining);
  const matNeed = (plannedQty * p.weightG) / 1000 * 1.02;
  const material: FeasibilityResult["material"] = [];
  const check = (id: string, needed: number) => {
    const mat = plant.material(id)!;
    const perH = plant.expectedConsumptionPerHour(id);
    const horizonH = Math.max(0, (latestFinish - plant.now) / H);
    const inbound = plant.inbound.filter((i) => i.materialId === id && i.status !== "ANGEKOMMEN" && i.eta <= latestFinish).reduce((s, i) => s + i.qty, 0);
    const available = Math.max(0, mat.stock - perH * horizonH * 0.85);
    material.push({ id, name: mat.name, unit: mat.unit, needed: Math.round(needed), available: Math.round(available), inbound, ok: available + inbound >= needed });
  };
  check(p.material, matNeed);
  if (p.iml) check("M-IML", plannedQty * 1.01);

  const matOk = material.every((m) => m.ok);
  if (!matOk) notes.push("Materialbedarf übersteigt den verfügbaren Bestand inkl. Zulauf – Zusatzbestellung nötig.");
  const conflicts = impacts.filter((i) => i.delayH > 0 && !i.stillOnTime);
  if (conflicts.length) notes.push(`Vollmenge nur durch Vorziehen möglich – ${conflicts.length} andere${conflicts.length > 1 ? " Aufträge würden" : "r Auftrag würde"} den Liefertermin verfehlen.`);

  // Konfliktfreie Teilmenge + Termin für die Restmenge (nach den bestehenden Warteschlangen)
  const freeQty = plan.filter((x) => x.mode === "frei").reduce((s, x) => s + x.qty, 0);
  const restQty = Math.max(0, qty - freeQty);
  let restDelivery: number | undefined;
  if (restQty > 0) {
    const starts = machines.map((m) => {
      const freeSeg = plan.filter((x) => x.machineId === m.id && x.mode === "frei");
      const s0 = freeSeg.length ? Math.max(...freeSeg.map((x) => x.end)) : plantQueueEnd(plant, m.id) + (m.productId === productId ? 0 : 1.2 * H);
      return { s: s0, r: plant.ratePerHour(m) };
    });
    for (let T = plant.now; T < plant.now + 30 * 24 * H; T += 0.25 * H) {
      const made = starts.reduce((s, x) => s + (Math.max(0, T - x.s) / H) * x.r, 0);
      if (made >= restQty) {
        restDelivery = T + (QS_H + DISPATCH_H + transportH) * H;
        break;
      }
    }
  }

  const feasible = remaining <= 0 && matOk && conflicts.length === 0;
  const verdict: FeasibilityResult["verdict"] = feasible ? "machbar" : remaining <= 0 && matOk ? "konflikt" : plannedQty > 0 ? "teilweise" : "nicht";
  return {
    feasible,
    verdict,
    freeQty,
    restQty,
    restDelivery,
    partial: !feasible && plannedQty > 0,
    productId,
    productName: p.name,
    qty,
    due,
    customer: customerId ? CUSTOMER[customerId].name : undefined,
    transportH,
    latestFinish,
    plan,
    plannedQty,
    material,
    impacts: impacts.filter((i) => i.delayH > 0).slice(0, 6),
    revenueEur: Math.round((qty / 1000) * p.pricePer1000),
    notes,
  };
}

function plantQueueEnd(plant: Plant, id: string) {
  return plant.queueEnd(plant.machine(id));
}

// ---------------- Wartungsfenster ----------------

export interface MaintenanceOption {
  start: number;
  label: string;
  lostPieces: number;
  lostEur: number;
  riskBefore: number; // Wahrscheinlichkeit, dass der Ausfall vorher eintritt
  recommended: boolean;
  note: string;
}

export function maintenanceOptions(plant: Plant, m: Machine): { options: MaintenanceOption[]; planned: { costEur: number; durationH: number }; unplanned: { costEur: number; durationH: number } } {
  const pred = plant.predictions.get(m.id);
  const rul = pred?.rulH ?? 400;
  const durationH = 1.5;
  const rate = plant.ratePerHour(m);
  const p = PRODUCT[m.productId];
  const candidates: { start: number; label: string; note: string }[] = [];
  candidates.push({ start: plant.now + 0.5 * H, label: "Sofort (in 30 min)", note: "Maximale Sicherheit – Auftrag wird kurz unterbrochen." });
  const sc = nextShiftChange(plant.now);
  candidates.push({ start: sc, label: "Zum Schichtwechsel", note: "Übergabe nutzen, Instandhaltung beider Schichten verfügbar." });
  const head = m.queue[0] ? plant.order(m.queue[0]) : undefined;
  if (head) {
    const end = plant.now + (Math.max(0, head.qty - head.produced) / rate) * H;
    candidates.push({ start: end, label: "Nach laufendem Auftrag", note: `Nach ${head.id} – kombiniert mit ohnehin nötigem Rüsten.` });
  }
  const options = candidates
    .filter((c, i, arr) => arr.findIndex((x) => Math.abs(x.start - c.start) < 0.25 * H) === i)
    .sort((a, b) => a.start - b.start)
    .map((c) => {
      const hoursUntil = (c.start - plant.now) / H;
      const riskBefore = rul <= 0 ? 1 : clamp(1 - Math.exp(-hoursUntil / Math.max(0.5, rul * 0.55)), 0, 0.99) * (pred?.p72 ?? 0.1);
      const lostPieces = Math.round(rate * durationH * (c.label.startsWith("Nach") ? 0.4 : 1));
      return {
        ...c,
        riskBefore,
        lostPieces,
        lostEur: Math.round((lostPieces / 1000) * p.pricePer1000 * 0.5 + m.costPerHour * durationH * 0.3),
        recommended: false,
      };
    });
  // Empfehlung: geringster Erwartungswert aus Risiko × Ausfallkosten + Stillstandskosten
  const unplannedCost = Math.round(m.costPerHour * 5 + 9800 + 2100);
  let best = 0;
  let bestScore = Infinity;
  options.forEach((o, i) => {
    const score = o.riskBefore * unplannedCost + o.lostEur;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  if (options[best]) options[best].recommended = true;
  return {
    options,
    planned: { costEur: Math.round(m.costPerHour * durationH + 2400), durationH },
    unplanned: { costEur: unplannedCost, durationH: 5 },
  };
}

export function alternativeMachines(plant: Plant, o: Order) {
  return plant
    .machineIdsFor(o.productId)
    .filter((id) => id !== o.machineId)
    .map((id) => {
      const m = plant.machine(id);
      const pred = plant.predictions.get(id);
      const end = plant.queueEnd(m);
      return { machineId: id, freeAt: end, risk: pred?.p72 ?? 0, status: m.status, changeover: m.productId !== o.productId };
    })
    .sort((a, b) => a.freeAt - b.freeAt);
}
