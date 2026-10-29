// Sichten und Auswertungen über die Betriebsdaten: Maschinen-Tagesverlauf, Fertigwarenlager,
// LKW-Zeitfenster, Tages-/Wochen-/Monatsbericht, Finanzen, Lagebericht (Briefing) und KI-Empfehlungen.
// Alles deterministisch aus dem Werkszustand – dieselben Zahlen sieht auch der KI-Copilot.

import { CO2_PER_KWH, CUSTOMER, CUSTOMERS, DEFECTS, PRODUCT, PRODUCTS, SENSOR_DEFS } from "./catalog";
import { machineView } from "./views";
import { alternativeMachines, maintenanceOptions, orderView } from "./analysis";
import type { Plant } from "./engine";
import { BUCKET, DAY, HOME, pieceEconomics, targetRate } from "./ops";
import { H, MIN, shiftOf } from "./time";
import type { BucketView, FinanceDay, Machine, MachineBucket, MachineDay, Severity, StockView, StopRecord, TruckVisit, VisitView, YardDay, YardSummary } from "./types";
import { fmtDuration, fmtEur, fmtInt, fmtKEur, fmtNum, fmtPct, fmtTime } from "../ai/format";
import { GUARD_KIND, guardianView } from "./guardian";

// ======================= Maschinen =======================

export function bucketView(m: Machine, b: MachineBucket, now: number): BucketView {
  const end = Math.min(now, b.t + BUCKET);
  const full = Math.max(1, (end - b.t) / 1000);
  const planned = b.target / targetRate(m);
  const ratio = b.target > 1 ? b.good / b.target : 0;
  const stop = Object.values(b.stopSec).reduce((s, x) => s + (x ?? 0), 0);
  const avg = (x: number, n: number) => (n ? x / n : null);
  return {
    t: b.t,
    good: Math.round(b.good),
    scrap: Math.round(b.scrap),
    target: Math.round(b.target),
    ratio,
    runMin: b.runSec / 60,
    stopMin: stop / 60,
    stoerMin: (b.stopSec.STOERUNG ?? 0) / 60,
    ruestMin: (b.stopSec.RUESTEN ?? 0) / 60,
    wartMin: (b.stopSec.WARTUNG ?? 0) / 60,
    energy: b.energy,
    temp1: avg(b.temp1, b.n),
    temp1Max: b.n ? b.temp1Max : null,
    temp2: avg(b.temp2, b.n),
    oil: avg(b.oil, b.n),
    vib: avg(b.vib, b.nRun),
    cycle: avg(b.cycle, b.nRun),
    lossEur: b.lossEur,
    reason: b.reason,
    sev: planned < full * 0.3 ? "idle" : ratio >= 0.88 ? "ok" : ratio >= 0.72 ? "warn" : "crit",
    open: now < b.t + BUCKET,
  };
}

export function stopView(plant: Plant, s: StopRecord) {
  const end = s.end ?? plant.now;
  const m = plant.machines.find((x) => x.id === s.machineId)!;
  const lossEur = s.end ? s.lossEur : ((end - s.start) / 1000) * targetRate(m) * pieceEconomics(m.productId).db * (s.status === "STILLSTAND" && !m.queue.length ? 0 : 1);
  return { ...s, end: s.end, open: !s.end, durMin: (end - s.start) / MIN, lossEur };
}
export type StopView = ReturnType<typeof stopView>;

export function machineDayDetail(plant: Plant, id: string, offset = 0) {
  const m = plant.findMachine(id);
  if (!m) return null;
  const ops = plant.ops;
  const day = ops.curDay + offset * DAY;
  const buckets = (ops.buckets.get(m.id) ?? []).filter((b) => b.t >= day && b.t < day + DAY).map((b) => bucketView(m, b, plant.now));
  const totals = ops.dayFromBuckets(m, day);
  const stops = ops.stops
    .filter((s) => s.machineId === m.id && s.start < day + DAY && (s.end ?? plant.now) > day)
    .map((s) => stopView(plant, s))
    .sort((a, b) => b.start - a.start);
  const history = [...(ops.days.get(m.id) ?? []).filter((d) => d.day < ops.curDay), ops.dayFromBuckets(m, ops.curDay)].slice(-30);
  const defs = SENSOR_DEFS[m.type];
  const pick = (k: "temp1" | "temp2" | "oil") => {
    const d = defs.find((x) => x.key === k)!;
    return { label: d.label, short: d.short, unit: d.unit, nominal: d.nominal, warn: d.warn, crit: d.crit };
  };
  const e = pieceEconomics(m.productId);
  return {
    id: m.id,
    type: m.type,
    now: plant.now,
    day,
    dayEnd: day + DAY,
    connectedAt: m.connectedAt,
    bucketMin: BUCKET / MIN,
    targetPerBucket: targetRate(m) * (BUCKET / 1000),
    buckets,
    totals,
    stops,
    history,
    sensors: { temp1: pick("temp1"), temp2: pick("temp2"), oil: pick("oil") },
    economics: { pricePerPiece: e.price, dbPerPiece: e.db, lossPerHour: targetRate(m) * 3600 * e.db },
  };
}
export type MachineDayDetail = NonNullable<ReturnType<typeof machineDayDetail>>;

/** Tagessummen aller Maschinen (heute live) – für die Übersicht „Produktion je Maschine“ */
export function productionOverview(plant: Plant) {
  const ops = plant.ops;
  return plant.machines.map((m) => {
    const d = ops.dayFromBuckets(m, ops.curDay);
    const bs = (ops.buckets.get(m.id) ?? []).filter((b) => b.t >= ops.curDay).map((b) => bucketView(m, b, plant.now));
    return { id: m.id, type: m.type, hall: m.hall, status: m.status, connectedAt: m.connectedAt, product: PRODUCT[m.productId].short, good: d.good, target: d.target, scrap: d.scrap, oee: d.oee, lossEur: d.lossEur, stoerH: d.stoerH, ruestH: d.ruestH, topReason: d.topReason, temp1Max: d.temp1Max, bars: bs.map((b) => ({ t: b.t, r: Number(b.ratio.toFixed(3)), s: b.sev })) };
  });
}

// ======================= Fertigwarenlager =======================

export function stockViews(plant: Plant, full = false): StockView[] {
  const ops = plant.ops;
  return PRODUCTS.map((p) => {
    const st = ops.stock.get(p.id)!;
    const reserved = Math.min(st.pieces, ops.reservedFor(p.id));
    const free = st.pieces - reserved;
    const freePal = free / p.piecesPerPallet;
    const demand = ops.dailyDemand(p.id);
    const next = ops.visits.filter((v) => v.productId === p.id && v.kind === "abholung" && v.status !== "ABGEFAHREN").sort((a, b) => a.slotStart - b.slotStart)[0];
    return {
      productId: p.id,
      name: p.name,
      short: p.short,
      type: p.type,
      material: p.material,
      iml: p.iml,
      weightG: p.weightG,
      piecesPerPallet: p.piecesPerPallet,
      pricePer1000: p.pricePer1000,
      location: st.location,
      pieces: Math.round(st.pieces),
      pallets: Math.ceil(st.pieces / p.piecesPerPallet),
      reserved: Math.round(reserved),
      free: Math.round(free),
      minPallets: st.minPallets,
      valueEur: (st.pieces / 1000) * p.pricePer1000,
      reachDays: demand > 0 ? free / demand : 99,
      inToday: Math.round(st.inToday),
      outToday: Math.round(st.outToday),
      producingOn: plant.machines.filter((m) => m.productId === p.id && m.status === "PRODUKTION").map((m) => m.id),
      nextPickup: next ? { visitId: next.id, t: next.slotStart, qty: next.qty, partner: next.partner } : undefined,
      state: freePal < st.minPallets * 0.5 ? "crit" : freePal < st.minPallets ? "warn" : "ok",
      history: full ? st.history : st.history.slice(-24),
    };
  });
}

/**
 * Artikel-Detail: Bestand, Fertigungslose (Chargen) der letzten 2 Tage mit Maschine, Halle, Zeitraum,
 * Gut- und Schlechtteilen, Fehlerbilder, offene Aufträge und avisierte Abholungen
 */
export function productDetail(plant: Plant, productId: string) {
  const p = PRODUCT[productId];
  if (!p) return null;
  const ops = plant.ops;
  const now = plant.now;
  const stock = stockViews(plant, true).find((s) => s.productId === productId)!;
  type Batch = { id: string; machineId: string; hall: string; hallName: string; shift: string; shiftStart: number; start: number; end: number; good: number; scrap: number; target: number; stopMin: number; temp1Max: number; running: boolean; reason?: string };
  const batches: Batch[] = [];
  const hourly = new Map<number, { good: number; scrap: number }>();
  const machineScrap = new Map<string, number>();
  for (const m of plant.machines) {
    const bs = ops.buckets.get(m.id) ?? [];
    let cur: Batch | null = null;
    const close = () => {
      if (cur && cur.good > 0) batches.push(cur);
      cur = null;
    };
    for (const b of bs) {
      const mine = b.productId === productId;
      // Rüsten (Farb-/Dekorwechsel) beginnt ein neues Fertigungslos
      const setup = (b.stopSec.RUESTEN ?? 0) > 0.5 * BUCKET / 1000;
      const sh = shiftOf(b.t + 60_000);
      if (!mine || setup) {
        close();
        continue;
      }
      // je Schicht ein Los (Schichtübergabe mit Rückstellmuster)
      if (cur && (cur as Batch).shiftStart !== sh.start) close();
      if (!cur) {
        const d = new Date(b.t);
        const stamp = `${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
        cur = { id: `CH-${m.id.replace("-", "")}-${stamp}`, machineId: m.id, hall: m.hall, hallName: m.hall === "A" ? "Halle A · Spritzguss" : "Halle B · Thermoformen", shift: sh.name, shiftStart: sh.start, start: b.t, end: b.t, good: 0, scrap: 0, target: 0, stopMin: 0, temp1Max: 0, running: false };
      }
      const c: Batch = cur;
      c.end = Math.min(now, b.t + BUCKET);
      c.good += b.good;
      c.scrap += b.scrap;
      c.target += b.target;
      c.stopMin += Object.values(b.stopSec).reduce((s, x) => s + (x ?? 0), 0) / 60;
      c.temp1Max = Math.max(c.temp1Max, b.temp1Max);
      if (b.reason && b.stopSec.STOERUNG) c.reason = b.reason;
      c.running = now < b.t + BUCKET && m.productId === productId && m.status === "PRODUKTION";
      if (b.t >= ops.curDay) {
        const h = Math.floor(b.t / H) * H;
        const x = hourly.get(h) ?? { good: 0, scrap: 0 };
        x.good += b.good;
        x.scrap += b.scrap;
        hourly.set(h, x);
        machineScrap.set(m.id, (machineScrap.get(m.id) ?? 0) + b.scrap);
      }
    }
    close();
  }
  batches.sort((a, b) => b.start - a.start);
  // Fehlerbilder: Tagesverteilung der beteiligten Maschinen, anteilig nach Ausschuss dieses Artikels
  const defects: Record<string, number> = {};
  for (const [id, sc] of machineScrap) {
    const m = plant.machines.find((x) => x.id === id)!;
    const share = m.scrapToday > 0 ? Math.min(1, sc / m.scrapToday) : 0;
    for (const [k, v] of Object.entries(m.defects)) defects[k] = (defects[k] ?? 0) + v * share;
  }
  const today = batches.filter((b) => b.end > ops.curDay);
  const sum = (xs: Batch[], f: (b: Batch) => number) => xs.reduce((a, b) => a + f(b), 0);
  const series: { t: number; good: number; scrap: number }[] = [];
  for (let h = Math.floor(ops.curDay / H) * H; h < ops.curDay + DAY; h += H) {
    const x = hourly.get(h);
    series.push({ t: h, good: Math.round(x?.good ?? 0), scrap: Math.round(x?.scrap ?? 0) });
  }
  const orders = plant.orders
    .filter((o) => o.productId === productId && o.status !== "VERSENDET")
    .map((o) => orderView(plant, o))
    .sort((a, b) => a.due - b.due)
    .map((o) => ({ id: o.id, customer: o.customer, city: o.city, qty: o.qty, produced: Math.round(o.produced), progress: o.progress, status: o.status, machineId: o.machineId, due: o.due, projectedDone: o.projectedDone, onTimeProb: o.onTimeProb, risk: o.risk }));
  const pickups = ops.visits
    .filter((v) => v.productId === productId && v.kind === "abholung" && (v.status !== "ABGEFAHREN" || (v.departedAt ?? 0) >= ops.curDay))
    .map((v) => visitView(plant, v))
    .sort((a, b) => (a.arrivedAt ?? a.arriveAt) - (b.arrivedAt ?? b.arriveAt));
  const quality = plant.machines
    .filter((m) => m.productId === productId || machineScrap.has(m.id))
    .map((m) => {
      const mv = machineView(plant, m);
      return { machineId: m.id, status: m.status, cpk: mv.cpk, spcViolation: mv.spcViolation, scrapRate: mv.scrapRate };
    });
  return {
    now,
    day: ops.curDay,
    product: { id: p.id, name: p.name, short: p.short, type: p.type, weightG: p.weightG, material: p.material, iml: p.iml, piecesPerPallet: p.piecesPerPallet, pricePer1000: p.pricePer1000, machines: p.machines, spc: p.spc },
    stock,
    today: { good: sum(today, (b) => b.good), scrap: sum(today, (b) => b.scrap), first: today.length ? Math.min(...today.map((b) => Math.max(b.start, ops.curDay))) : undefined, last: today.length ? Math.max(...today.map((b) => b.end)) : undefined },
    series,
    batches: batches.slice(0, 24),
    defects: Object.entries(defects)
      .map(([k, v]) => ({ key: k, label: DEFECTS[k as keyof typeof DEFECTS]?.label ?? k, pieces: Math.round(v) }))
      .filter((d) => d.pieces > 0)
      .sort((a, b) => b.pieces - a.pieces),
    orders,
    pickups,
    quality,
  };
}
export type ProductDetail = NonNullable<ReturnType<typeof productDetail>>;

// ======================= LKW-Zeitfenster =======================

export function visitView(plant: Plant, v: TruckVisit): VisitView {
  const now = plant.now;
  const arrived = v.arrivedAt !== undefined;
  const etaKnown = arrived || v.arriveAt - now < 3 * H;
  const arriveAt = etaKnown ? v.arriveAt : v.slotStart;
  let lateMin = 0;
  if (arrived) lateMin = Math.max(0, (v.arrivedAt! - v.slotEnd) / MIN);
  else if (now > v.slotEnd) lateMin = (now - v.slotEnd) / MIN;
  else if (etaKnown) lateMin = Math.max(0, (v.arriveAt - v.slotEnd) / MIN);
  const onSiteMin = arrived ? ((v.departedAt ?? now) - v.arrivedAt!) / MIN : 0;
  // Toleranz 5 min, erst danach gilt die Standzeit als überzogen
  const overstayMin = arrived && onSiteMin - v.dwellMin > 5 ? onSiteMin - v.dwellMin : 0;
  const verb = v.kind === "abholung" ? "Beladung" : "Entladung";
  let state: Severity = "ok";
  let stateText = "";
  switch (v.status) {
    case "ERWARTET":
      if (v.forecast) {
        state = "info";
        stateText = `Prognose · Abholung ca. ${fmtTime(v.slotStart)}`;
      } else if (now > v.slotEnd) {
        state = lateMin > 30 ? "crit" : "warn";
        stateText = `überfällig seit ${fmtDuration(lateMin / 60)}`;
      } else if (etaKnown && lateMin > 5) {
        state = lateMin > 30 ? "crit" : "warn";
        stateText = `ETA ${fmtTime(arriveAt)} · ca. ${Math.round(lateMin)} min nach Zeitfenster`;
      } else {
        state = "info";
        stateText = etaKnown ? `unterwegs · ETA ${fmtTime(arriveAt)}` : `avisiert ${fmtTime(v.slotStart)}–${fmtTime(v.slotEnd)}`;
      }
      break;
    case "AM_TOR":
      state = lateMin > 30 ? "warn" : "info";
      stateText = "Anmeldung beim Pförtner";
      break;
    case "WARTET": {
      const w = (now - v.arrivedAt!) / MIN;
      if (v.ref.includes("Vorabend")) {
        state = "info";
        stateText = `Ruhezeit auf dem Hof · Entladung ab ${fmtTime(v.slotStart - 45 * MIN)}`;
        break;
      }
      state = overstayMin > 0 ? "crit" : w > 25 ? "warn" : "info";
      stateText = `wartet auf Rampe ${v.dock} · ${Math.round(w)} min`;
      break;
    }
    case "RAMPE": {
      const pr = v.doneAt ? 100 : Math.min(99, ((now - (v.dockAt ?? now)) / MIN / v.handleMin) * 100);
      state = overstayMin > 0 ? "crit" : "info";
      stateText = v.doneAt ? `Papiere/Ladungssicherung an Rampe ${v.dock}` : `${verb} an Rampe ${v.dock} · ${Math.round(pr)} %`;
      break;
    }
    case "ABGEFAHREN":
      state = overstayMin > 15 || lateMin > 30 ? "warn" : "ok";
      stateText = `abgefahren ${fmtTime(v.departedAt!)}`;
      break;
  }
  let customerEta: number | undefined, customerDue: number | undefined;
  if (v.kind === "abholung") {
    const sh = v.shipmentId ? plant.shipments.find((s) => s.id === v.shipmentId) : undefined;
    const o = v.orderId ? plant.order(v.orderId) : undefined;
    customerDue = o?.due;
    const transport = (v.km / 65 + 0.4) * H;
    customerEta = sh?.eta ?? (v.departedAt ? v.departedAt + transport : Math.max(v.plannedDepart, (v.dockAt ?? Math.max(now, arriveAt)) + v.handleMin * MIN + 6 * MIN) + transport);
  }
  const departLateMin = v.departedAt ? Math.max(0, (v.departedAt - v.plannedDepart) / MIN) : arrived && now > v.plannedDepart ? (now - v.plannedDepart) / MIN : 0;
  return { ...v, arriveAt, lateMin, onSiteMin, overstayMin, departLateMin, state, stateText, etaKnown, customerEta, customerDue };
}

const SEV_ORDER: Record<Severity, number> = { crit: 0, warn: 1, info: 2, ok: 3 };

/** Für Snapshot und 3D: auf dem Hof, kurz zuvor abgefahren, in den nächsten Stunden erwartet */
export function liveVisits(plant: Plant): VisitView[] {
  const now = plant.now;
  return plant.ops.visits
    .filter((v) => (v.status === "ABGEFAHREN" ? (v.departedAt ?? 0) > now - 2 * H : v.status !== "ERWARTET" || v.slotStart < now + 8 * H))
    .map((v) => visitView(plant, v))
    .sort((a, b) => (a.arrivedAt ?? a.arriveAt) - (b.arrivedAt ?? b.arriveAt))
    .slice(0, 48);
}

export function yardSummary(plant: Plant): YardSummary {
  const ops = plant.ops;
  const now = plant.now;
  const dayEnd = ops.curDay + DAY;
  const vs = ops.visits.map((v) => visitView(plant, v));
  return {
    onSite: vs.filter((v) => v.status === "AM_TOR" || v.status === "WARTET" || v.status === "RAMPE").length,
    expectedToday: vs.filter((v) => v.status === "ERWARTET" && v.slotStart < dayEnd).length,
    doneToday: vs.filter((v) => v.status === "ABGEFAHREN" && (v.departedAt ?? 0) >= ops.curDay).length,
    late: vs.filter((v) => (v.status === "ERWARTET" ? now > v.slotEnd && v.slotStart >= ops.curDay - 6 * H : v.lateMin > 0 && (v.arrivedAt ?? 0) >= ops.curDay)).length,
    overstay: vs.filter((v) => v.status !== "ABGEFAHREN" && v.overstayMin > 0).length,
  };
}

/** Zeitfenster-Plan inkl. Tagesplanung künftiger Tage und Prognose-Abholungen aus offenen Aufträgen */
export function schedule(plant: Plant, from: number, to: number): VisitView[] {
  const ops = plant.ops;
  const now = plant.now;
  const out = ops.visits.filter((v) => (v.arrivedAt ?? v.slotStart) < to && (v.departedAt ?? v.slotEnd) >= from).map((v) => visitView(plant, v));
  for (let d = ops.planUntil; d < to; d += DAY) if (d + DAY > from) for (const v of ops.dayPlan(d)) out.push(visitView(plant, v));
  const planned = new Set(ops.visits.map((v) => v.orderId).filter(Boolean));
  for (const o of plant.orders) {
    if (planned.has(o.id) || o.status === "VERSENDET" || o.shipmentId) continue;
    const finish = o.status === "QS" ? now + 0.75 * H : o.status === "VERSANDBEREIT" ? now : plant.projectFinish(o);
    const slot = Math.round((finish + 2.75 * H) / (30 * MIN)) * 30 * MIN;
    if (slot < from || slot >= to) continue;
    const c = CUSTOMER[o.customerId];
    const p = PRODUCT[o.productId];
    const pallets = Math.max(1, Math.ceil(o.qty / p.piecesPerPallet));
    const handleMin = Math.round(16 + Math.min(66, pallets) * 0.9);
    out.push(
      visitView(plant, {
        id: `PR-${o.id.slice(3)}`,
        kind: "abholung",
        forecast: true,
        carrier: "wird disponiert",
        plate: "–",
        trailer: "–",
        driver: "–",
        phone: "–",
        vehicle: pallets > 33 ? "Megatrailer (Bedarf ermittelt)" : "Sattelzug (Bedarf ermittelt)",
        partner: c.name,
        from: HOME,
        to: { name: c.name, city: c.city, country: c.country },
        km: c.km,
        cargo: p.name,
        productId: p.id,
        qty: o.qty,
        unit: "Stk",
        pallets,
        weightKg: Math.round((o.qty * p.weightG) / 1000 + pallets * 24),
        orderId: o.id,
        dock: 0,
        slotStart: slot,
        slotEnd: slot + 30 * MIN,
        plannedDepart: slot + (handleMin + 25) * MIN,
        dwellMin: handleMin + 25,
        handleMin,
        arriveAt: slot,
        status: "ERWARTET",
        ref: `Prognose aus ${o.id} (Fertigstellung ${fmtTime(finish)})`,
      }),
    );
  }
  return out.sort((a, b) => a.slotStart - b.slotStart);
}

// ======================= Finanzen =======================

export function financeTotals(f: FinanceDay) {
  const margin = f.revenue - f.material - f.energy - f.freight;
  return { revenue: f.revenue, margin, result: margin - f.personnel - f.overhead, loss: f.lossDowntime + f.lossScrap };
}

function sumFinance(list: FinanceDay[]) {
  const t = { revenue: 0, material: 0, energy: 0, freight: 0, personnel: 0, overhead: 0, lossDowntime: 0, lossScrap: 0, pieces: 0 };
  const byCustomer: FinanceDay["byCustomer"] = {};
  const byProduct: FinanceDay["byProduct"] = {};
  for (const f of list) {
    for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += f[k];
    for (const [id, c] of Object.entries(f.byCustomer)) {
      const x = (byCustomer[id] ??= { revenue: 0, pieces: 0, cost: 0 });
      x.revenue += c.revenue;
      x.pieces += c.pieces;
      x.cost += c.cost;
    }
    for (const [id, c] of Object.entries(f.byProduct)) {
      const x = (byProduct[id] ??= { revenue: 0, pieces: 0, cost: 0 });
      x.revenue += c.revenue;
      x.pieces += c.pieces;
      x.cost += c.cost;
    }
  }
  return { ...t, byCustomer, byProduct };
}

export const BUDGET_REVENUE_DAY = 96_000;

export function financeView(plant: Plant, days = 30) {
  const ops = plant.ops;
  const list = [...ops.finance.filter((f) => f.day < ops.curDay).slice(-(days - 1)), ops.fin];
  const sum = sumFinance(list);
  const margin = sum.revenue - sum.material - sum.energy - sum.freight;
  const result = margin - sum.personnel - sum.overhead;
  // Kunden: Umsatz, Menge, DB (nach Material und anteiliger Fracht)
  const freightShare = sum.freight / Math.max(1, sum.revenue);
  const customers = CUSTOMERS.map((c) => {
    const x = sum.byCustomer[c.id] ?? { revenue: 0, pieces: 0, cost: 0 };
    const freight = x.revenue * freightShare * (c.km / 380);
    const db = x.revenue - x.cost - freight;
    const open = plant.orders.filter((o) => o.customerId === c.id && o.status !== "VERSENDET");
    return {
      id: c.id,
      name: c.name,
      city: c.city,
      country: c.country,
      segment: c.segment,
      km: c.km,
      revenue: x.revenue,
      pieces: x.pieces,
      cost: x.cost + freight,
      db,
      marginPct: x.revenue > 0 ? db / x.revenue : 0,
      openOrders: open.length,
      openValue: open.reduce((s, o) => s + o.valueEur, 0),
      today: ops.fin.byCustomer[c.id]?.revenue ?? 0,
    };
  }).sort((a, b) => b.revenue - a.revenue);
  const products = PRODUCTS.map((p) => {
    const x = sum.byProduct[p.id] ?? { revenue: 0, pieces: 0, cost: 0 };
    return { id: p.id, name: p.name, short: p.short, revenue: x.revenue, pieces: x.pieces, db: x.revenue - x.cost, marginPct: x.revenue > 0 ? (x.revenue - x.cost) / x.revenue : 0 };
  }).sort((a, b) => b.revenue - a.revenue);
  const series = list.map((f) => ({ day: f.day, ...financeTotals(f), material: f.material, energy: f.energy, freight: f.freight, fixed: f.personnel + f.overhead, partial: f === ops.fin }));
  // Monatsprognose (Kalendermonat)
  const now = plant.now;
  const d = new Date(now);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const mtd = list.filter((f) => f.day >= monthStart - 6 * H);
  const mtdRev = mtd.reduce((s, f) => s + f.revenue, 0);
  const last7 = list.slice(-8, -1);
  const avg7 = last7.reduce((s, f) => s + f.revenue, 0) / Math.max(1, last7.length);
  const dayShare = (now - ops.curDay) / DAY;
  const remainingDays = Math.max(0, daysInMonth - mtd.length + (1 - dayShare));
  const forecastMonth = mtdRev + avg7 * remainingDays;
  return {
    now,
    days,
    totals: { ...sum, margin, result, marginPct: sum.revenue > 0 ? margin / sum.revenue : 0, resultPct: sum.revenue > 0 ? result / sum.revenue : 0, loss: sum.lossDowntime + sum.lossScrap },
    today: { ...financeTotals(ops.fin), material: ops.fin.material, energy: ops.fin.energy, freight: ops.fin.freight, fixed: ops.fin.personnel + ops.fin.overhead, pieces: ops.fin.pieces },
    series,
    customers,
    products,
    month: { mtdRevenue: mtdRev, forecast: forecastMonth, budget: BUDGET_REVENUE_DAY * daysInMonth, daysInMonth, avg7 },
  };
}
export type FinanceView = ReturnType<typeof financeView>;

// ======================= KI-Empfehlungen =======================

export interface Recommendation {
  id: string;
  sev: Severity;
  area: string;
  title: string;
  detail: string;
  action: string;
  impactEur?: number;
  href: string;
}

export function recommendations(plant: Plant): Recommendation[] {
  const out: Recommendation[] = [];
  const ops = plant.ops;
  const now = plant.now;
  // Maschinen: dieselben Befunde, Ursachen und Zahlen wie im KI-Wächter (ein Gehirn für alle Sichten)
  const covered = new Set<string>();
  for (const mg of guardianView(plant).machines)
    for (const f of mg.findings) {
      const rec = f.actions.find((a) => a.recommended);
      if (f.kind === "termin") {
        const head = plant.machines.find((x) => x.id === mg.id)?.queue[0];
        if (head) covered.add(head);
      }
      out.push({
        id: f.id,
        sev: f.sev,
        area: GUARD_KIND[f.kind].short,
        title: `${mg.id}: ${f.title}`,
        detail: `${f.cause}. ${f.horizon} · drohender Verlust ${fmtEur(f.lossEur72)} in 72 h.`,
        action: rec ? `${rec.label} (${rec.when}) – Kosten ${fmtEur(rec.costEur)}, vermeidet ${fmtEur(rec.avoidedEur)}.` : "Beobachten.",
        impactEur: rec ? Math.max(0, rec.netEur) : undefined,
        href: `/waechter?tab=akte&m=${mg.id}`,
      });
    }
  const orders = plant.orders.filter((o) => (o.status === "GEPLANT" || o.status === "PRODUKTION") && !covered.has(o.id)).map((o) => ({ o, v: orderView(plant, o) }));
  for (const { o, v } of orders.filter((x) => x.v.risk === "gefaehrdet").slice(0, 3)) {
    const alt = alternativeMachines(plant, o).find((a) => a.status !== "STOERUNG" && a.risk < 0.45);
    out.push({
      id: `ord-${o.id}`,
      sev: "warn",
      area: "Vertrieb",
      title: `${o.id} (${v.customer}): Liefertermin gefährdet`,
      detail: `Pünktlichkeit ${fmtPct(v.onTimeProb, 0)} · ${v.riskReason ?? "zu wenig Puffer"}.`,
      action: alt ? `Restmenge auf ${alt.machineId} umplanen (frei ab ${fmtTime(alt.freeAt)}) oder Kunde proaktiv informieren.` : "Zusatzschicht prüfen und Kunde proaktiv über neuen Termin informieren.",
      impactEur: Math.round(o.valueEur),
      href: `/vertrieb?o=${o.id}`,
    });
  }
  for (const s of stockViews(plant).filter((x) => x.state !== "ok")) {
    const mach = PRODUCT[s.productId].machines[0];
    out.push({
      id: `stk-${s.productId}`,
      sev: s.state,
      area: "Lager",
      title: `${s.short}: frei verfügbarer Bestand unter Sicherheitsbestand`,
      detail: `${fmtNum(s.free / s.piecesPerPallet, 1)} von mind. ${s.minPallets} Paletten frei${s.nextPickup ? ` · nächste Abholung ${fmtTime(s.nextPickup.t)} (${s.nextPickup.partner})` : ""}.`,
      action: `Lagerauftrag auf ${s.producingOn[0] ?? mach} vorziehen bzw. Abrufmengen mit dem Kunden abstimmen.`,
      href: "/lager",
    });
  }
  for (const v of ops.visits.map((x) => visitView(plant, x))) {
    if (v.status !== "ABGEFAHREN" && v.overstayMin > 0)
      out.push({
        id: `yard-${v.id}`,
        sev: v.overstayMin > 30 ? "warn" : "info",
        area: "LKW-Hof",
        title: `${v.plate} steht ${Math.round(v.overstayMin)} min über Plan`,
        detail: `${v.carrier} · ${v.kind === "abholung" ? `Abholung ${v.partner}` : `Anlieferung ${v.cargo}`} · Rampe ${v.dock} · ${v.stateText}.`,
        action: "Verladeteam verstärken oder Folgefahrzeug auf freie Rampe umdisponieren; Standgeld vermeiden.",
        impactEur: Math.round(v.overstayMin * 1.1),
        href: `/lager?v=${v.id}`,
      });
    else if (v.status === "ERWARTET" && !v.forecast && v.lateMin > 20 && v.slotStart < now + 3 * H)
      out.push({
        id: `late-${v.id}`,
        sev: v.lateMin > 45 ? "warn" : "info",
        area: "LKW-Hof",
        title: `${v.plate} (${v.carrier}) ca. ${Math.round(v.lateMin)} min verspätet`,
        detail: `${v.kind === "abholung" ? `Abholung für ${v.partner}, ${v.to.city}` : `Anlieferung ${v.cargo}`} · Zeitfenster ${fmtTime(v.slotStart)}–${fmtTime(v.slotEnd)}.`,
        action: v.kind === "abholung" ? "Rampe für das nächste Fahrzeug freigeben; Kunde über spätere Ankunft informieren." : "Zeitfenster neu vergeben; Linienversorgung prüfen.",
        href: `/lager?v=${v.id}`,
      });
  }
  for (const mat of plant.materials) {
    const perH = plant.expectedConsumptionPerHour(mat.id);
    const reach = perH > 0 ? mat.stock / (perH * 24) : 99;
    if (reach < mat.reorderPointDays)
      out.push({
        id: `mat-${mat.id}`,
        sev: reach < 1.5 ? "crit" : "warn",
        area: "Einkauf",
        title: `${mat.name}: Reichweite ${fmtNum(reach, 1)} Tage`,
        detail: `Meldebestand ${mat.reorderPointDays} Tage unterschritten.`,
        action: "Bestellvorschlag der KI-Regel prüfen und freigeben (KI-Werksexperte → Freigaben).",
        href: `/logistik?mat=${mat.id}`,
      });
  }
  const fv = financeView(plant, 30);
  const weak = fv.customers.filter((c) => c.revenue > 20_000 && c.marginPct < 0.33).sort((a, b) => a.marginPct - b.marginPct)[0];
  if (weak)
    out.push({
      id: `cust-${weak.id}`,
      sev: "info",
      area: "Finanzen",
      title: `${weak.name}: Deckungsbeitrag nur ${fmtPct(weak.marginPct, 0)}`,
      detail: `${fmtKEur(weak.revenue)} Umsatz in 30 Tagen, ${weak.km} km Lieferweg – Fracht frisst Marge.`,
      action: "Frachtkostenpauschale oder Mindestabnahme je Abruf verhandeln; Touren bündeln.",
      impactEur: Math.round(weak.revenue * 0.04),
      href: "/finanzen",
    });
  return out.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || (b.impactEur ?? 0) - (a.impactEur ?? 0));
}

// ======================= Berichte =======================

export type ReportRange = "tag" | "woche" | "monat";

function machineDays(plant: Plant, m: Machine, from: number, to: number): MachineDay[] {
  const ops = plant.ops;
  const out = (ops.days.get(m.id) ?? []).filter((d) => d.day >= from && d.day < to && d.day < ops.curDay);
  if (to > ops.curDay) out.push(ops.dayFromBuckets(m, ops.curDay));
  return out;
}

export function buildReport(plant: Plant, range: ReportRange, offset = 0) {
  const ops = plant.ops;
  const now = plant.now;
  const n = range === "tag" ? 1 : range === "woche" ? 7 : 30;
  const to = range === "tag" ? ops.curDay + (offset + 1) * DAY : ops.curDay + DAY;
  const from = to - n * DAY;
  const live = to > ops.curDay;
  const end = Math.min(now, to);

  // Maschinen
  const machines = plant.machines.map((m) => {
    const ds = machineDays(plant, m, from, to);
    const s = (f: (d: MachineDay) => number) => ds.reduce((a, d) => a + f(d), 0);
    const good = s((d) => d.good), scrap = s((d) => d.scrap), target = s((d) => d.target), plannedH = s((d) => d.plannedH), runH = s((d) => d.runH);
    const reasons = new Map<string, number>();
    for (const d of ds) if (d.topReason) reasons.set(d.topReason, (reasons.get(d.topReason) ?? 0) + 1);
    return {
      id: m.id,
      type: m.type,
      hall: m.hall,
      product: PRODUCT[m.productId].short,
      status: m.status,
      good,
      scrap,
      scrapRate: good + scrap > 0 ? scrap / (good + scrap) : 0,
      target,
      oee: target > 0 ? good / target : 0,
      availability: plannedH > 0 ? runH / plannedH : 0,
      runH,
      plannedH,
      stoerH: s((d) => d.stoerH),
      ruestH: s((d) => d.ruestH),
      wartH: s((d) => d.wartH),
      stops: s((d) => d.stops),
      lossEur: s((d) => d.lossEur),
      energy: s((d) => d.energy),
      temp1Max: Math.max(0, ...ds.map((d) => d.temp1Max)),
      topReason: range === "tag" ? ds[0]?.topReason : [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
    };
  });
  const sum = (f: (x: (typeof machines)[number]) => number) => machines.reduce((a, x) => a + f(x), 0);
  const good = sum((x) => x.good), scrap = sum((x) => x.scrap), target = sum((x) => x.target);

  // Verlauf: Tag stündlich, sonst je Tag
  type Pt = { t: number; good: number | null; target: number; forecast?: number | null; revenue?: number; sev: string };
  const series: Pt[] = [];
  if (range === "tag") {
    const d0 = from;
    let rateLast = 0;
    for (let h = 0; h < 24; h++) {
      const t = d0 + h * H;
      let g = 0, tg = 0, any = false;
      for (const m of plant.machines) {
        for (const b of (ops.buckets.get(m.id) ?? []).filter((x) => x.t >= t && x.t < t + H)) {
          g += b.good;
          tg += b.target;
          any = true;
        }
      }
      const full = plant.machines.reduce((a, m) => a + targetRate(m) * 3600, 0);
      if (any && t < end) {
        // laufende Stunde: Soll der vollen Stunde zeigen, Bewertung nach anteiligem Soll
        series.push({ t, good: Math.round(g), target: Math.round(Math.max(tg, full * 0.9)), sev: tg > 0 && g / tg < 0.72 ? "crit" : tg > 0 && g / tg < 0.88 ? "warn" : "ok" });
        if (t + H <= end) rateLast = g;
      } else series.push({ t, good: null, target: Math.round(full), forecast: live ? Math.round(rateLast * 0.98) : null, sev: "idle" });
    }
  } else {
    for (let d = from; d < to; d += DAY) {
      let g = 0, tg = 0;
      for (const m of plant.machines) {
        const md = machineDays(plant, m, d, d + DAY)[0];
        if (md) {
          g += md.good;
          tg += md.target;
        }
      }
      const f = d === ops.curDay ? ops.fin : ops.finance.find((x) => x.day === d);
      series.push({ t: d, good: Math.round(g), target: Math.round(tg), revenue: f?.revenue ?? 0, sev: tg > 0 && g / tg < 0.72 ? "crit" : tg > 0 && g / tg < 0.85 ? "warn" : "ok" });
    }
  }

  // Stillstände
  const stopsAll = ops.stops.filter((s) => s.start < to && (s.end ?? now) > from).map((s) => stopView(plant, s));
  const stops = (range === "tag" ? stopsAll.sort((a, b) => b.start - a.start) : stopsAll.sort((a, b) => b.lossEur - a.lossEur)).slice(0, range === "tag" ? 80 : 20);
  const reasonMap = new Map<string, { reason: string; count: number; min: number; lossEur: number }>();
  for (const s of stopsAll) {
    const r = reasonMap.get(s.reason) ?? { reason: s.reason, count: 0, min: 0, lossEur: 0 };
    r.count++;
    r.min += s.durMin;
    r.lossEur += s.lossEur;
    reasonMap.set(s.reason, r);
  }
  const reasons = [...reasonMap.values()].sort((a, b) => b.lossEur - a.lossEur).slice(0, 8);

  // LKW
  const trucks = range === "tag" ? ops.visits.filter((v) => (v.arrivedAt ?? v.slotStart) >= from && (v.arrivedAt ?? v.slotStart) < to).map((v) => visitView(plant, v)).sort((a, b) => (a.arrivedAt ?? a.slotStart) - (b.arrivedAt ?? b.slotStart)) : [];
  const yardDays: YardDay[] = [...ops.yardDays.filter((d) => d.day >= from && d.day < to && d.day < ops.curDay), ...(live ? [ops.yardDayFrom(ops.curDay)] : [])];
  const yard = {
    abholung: yardDays.reduce((a, d) => a + d.abholung, 0),
    anlieferung: yardDays.reduce((a, d) => a + d.anlieferung, 0),
    entsorgung: yardDays.reduce((a, d) => a + d.entsorgung, 0),
    late: yardDays.reduce((a, d) => a + d.late, 0),
    overstay: yardDays.reduce((a, d) => a + d.overstay, 0),
    pallets: yardDays.reduce((a, d) => a + d.pallets, 0),
    avgDwellMin: yardDays.length ? Math.round(yardDays.reduce((a, d) => a + d.avgDwellMin, 0) / yardDays.length) : 0,
    open: live ? ops.visits.filter((v) => v.status === "ERWARTET" && v.slotStart < to).length : 0,
  };

  // Lager
  const sv = stockViews(plant, true);
  const stock = sv.map((s) => {
    const st = ops.stock.get(s.productId)!;
    const pts = range === "monat" ? [...(ops.stockDaily.get(s.productId) ?? []).filter((d) => d.day >= from).map((d) => ({ t: d.day, pieces: d.pieces })), { t: now, pieces: s.pieces }] : st.history.filter((h) => h.t >= from && h.t < to).concat(live ? [{ t: now, pieces: s.pieces }] : []);
    const first = pts[0]?.pieces ?? s.pieces;
    const last = pts[pts.length - 1]?.pieces ?? s.pieces;
    return { productId: s.productId, name: s.name, short: s.short, pieces: s.pieces, pallets: s.pallets, free: s.free, reserved: s.reserved, minPallets: s.minPallets, piecesPerPallet: s.piecesPerPallet, valueEur: s.valueEur, state: s.state, location: s.location, change: last - first, series: pts };
  });

  // Finanzen
  const finList = range === "tag" ? [offset === 0 ? ops.fin : ops.finance.find((f) => f.day === from)].filter(Boolean) as FinanceDay[] : [...ops.finance.filter((f) => f.day >= from && f.day < ops.curDay), ops.fin];
  const fs = sumFinance(finList);
  const margin = fs.revenue - fs.material - fs.energy - fs.freight;
  const result = margin - fs.personnel - fs.overhead;
  const customers = Object.entries(fs.byCustomer)
    .map(([id, c]) => ({ id, name: CUSTOMER[id]?.name ?? id, city: CUSTOMER[id]?.city ?? "", revenue: c.revenue, pieces: c.pieces, db: c.revenue - c.cost, marginPct: c.revenue > 0 ? (c.revenue - c.cost) / c.revenue : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
  const products = Object.entries(fs.byProduct)
    .map(([id, c]) => ({ id, name: PRODUCT[id]?.name ?? id, short: PRODUCT[id]?.short ?? id, revenue: c.revenue, pieces: c.pieces, db: c.revenue - c.cost, marginPct: c.revenue > 0 ? (c.revenue - c.cost) / c.revenue : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  const runH = sum((x) => x.runH), plannedH = sum((x) => x.plannedH);
  const energy = sum((x) => x.energy);
  const kpi = {
    good,
    scrap,
    target,
    scrapRate: good + scrap > 0 ? scrap / (good + scrap) : 0,
    oee: target > 0 ? good / target : 0,
    availability: plannedH > 0 ? runH / plannedH : 0,
    runH,
    stoerH: sum((x) => x.stoerH),
    ruestH: sum((x) => x.ruestH),
    wartH: sum((x) => x.wartH),
    stops: sum((x) => x.stops),
    lossEur: fs.lossDowntime + fs.lossScrap,
    lossDowntime: fs.lossDowntime,
    lossScrap: fs.lossScrap,
    energyKwh: energy,
    co2kg: energy * CO2_PER_KWH,
    revenue: fs.revenue,
    material: fs.material,
    energyCost: fs.energy,
    freight: fs.freight,
    fixed: fs.personnel + fs.overhead,
    margin,
    result,
    onTimeDelivery: plant.delivered.onTime / plant.delivered.total,
  };

  // Prognose
  const open = plant.orders.filter((o) => o.status !== "VERSENDET").map((o) => orderView(plant, o));
  const lastHours = plant.machines.reduce((a, m) => a + (ops.buckets.get(m.id) ?? []).filter((b) => b.t >= now - 2 * H && b.t < now - BUCKET).reduce((s, b) => s + b.good, 0), 0) / 1.75;
  const dayGood = plant.machines.reduce((a, m) => a + ops.dayFromBuckets(m, ops.curDay).good, 0);
  const dayTarget = plant.machines.reduce((a, m) => a + targetRate(m) * 86400, 0) * 0.98;
  const remainingH = (ops.curDay + DAY - now) / H;
  const fv = financeView(plant, 30);
  const forecast = {
    endOfDayGood: dayGood + lastHours * remainingH * 0.97,
    endOfDayTarget: dayTarget,
    ratePerHour: lastHours,
    monthRevenue: fv.month.forecast,
    monthBudget: fv.month.budget,
    mtdRevenue: fv.month.mtdRevenue,
    orders: open
      .filter((o) => o.status === "GEPLANT" || o.status === "PRODUKTION" || o.status === "QS" || o.status === "VERSANDBEREIT")
      .sort((a, b) => a.onTimeProb - b.onTimeProb)
      .slice(0, 12)
      .map((o) => ({ id: o.id, customer: o.customer, product: o.productShort, qty: o.qty, progress: o.progress, due: o.due, projectedDone: o.projectedDone, onTimeProb: o.onTimeProb, risk: o.risk, riskReason: o.riskReason, machineId: o.machineId, valueEur: o.valueEur })),
    atRisk: open.filter((o) => o.risk === "gefaehrdet").length,
  };

  const label =
    range === "tag"
      ? new Date(from + 6 * H).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" })
      : `${new Date(from + 6 * H).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" })} – ${new Date(to - 18 * H).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" })}`;

  const recs = recommendations(plant).slice(0, 8);
  const worst = [...machines].sort((a, b) => b.lossEur - a.lossEur)[0];
  const best = [...machines].sort((a, b) => b.oee - a.oee)[0];
  const summary = [
    `${range === "tag" ? (offset === 0 ? "Heute" : "Am Vortag") : range === "woche" ? "In den letzten 7 Tagen" : "In den letzten 30 Tagen"} wurden ${fmtInt(good)} Gutteile gefertigt (${fmtPct(target > 0 ? good / target : 0, 1)} vom Soll), Ausschuss ${fmtPct(kpi.scrapRate, 2)}.`,
    `Stillstände summierten sich auf ${fmtNum(kpi.stoerH + kpi.ruestH, 1)} h (${kpi.stops} Unterbrechungen). Entgangener Deckungsbeitrag inkl. Ausschuss: ${fmtKEur(kpi.lossEur)} – größter Posten ${worst.id} (${fmtKEur(worst.lossEur)}${worst.topReason ? `, ${worst.topReason}` : ""}).`,
    `Bester Wert: ${best.id} mit ${fmtPct(best.oee, 1)} Leistung zum Soll.`,
    `Am Hof: ${yard.abholung} Abholungen, ${yard.anlieferung} Anlieferungen, ${yard.entsorgung} Entsorgungen · ${yard.late} Fahrzeuge verspätet · Ø Standzeit ${yard.avgDwellMin} min.`,
    `Umsatz ${fmtKEur(fs.revenue)}, Deckungsbeitrag ${fmtKEur(margin)} (${fmtPct(fs.revenue > 0 ? margin / fs.revenue : 0, 0)}), Ergebnis nach Fixkosten ${result >= 0 ? "+" : ""}${fmtKEur(result)}.`,
  ];
  if (live) summary.push(`KI-Prognose bis 06:00: ${fmtNum(forecast.endOfDayGood / 1e6, 2)} Mio. Gutteile · ${forecast.atRisk} Auftrag/Aufträge mit Terminrisiko · Monatsumsatz voraussichtlich ${fmtKEur(forecast.monthRevenue)} (Budget ${fmtKEur(forecast.monthBudget)}).`);

  return { range, offset, from, to, live, generatedAt: now, label, plant: "Unternehmen · Werk Nord (WN-01)", kpi, machines, series, stops, reasons, trucks, yardDays, yard, stock, customers, products, forecast, recommendations: recs, summary };
}
export type Report = ReturnType<typeof buildReport>;

// ======================= Lagebericht (Briefing) =======================

export interface Change {
  id: string;
  area: string;
  text: string;
  dir: "up" | "down";
  good: boolean;
  value: string;
}

export function buildBriefing(plant: Plant) {
  const ops = plant.ops;
  const now = plant.now;
  const hour = Number(new Date(now).toLocaleString("de-DE", { hour: "2-digit", hour12: false, timeZone: "Europe/Berlin" }));
  const greeting = hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
  const shift = shiftOf(now);
  const k = plant.kpiCore();
  const cur = ops.pulseNow();
  const ago = (ms: number) => ops.pulses.filter((p) => p.t <= now - ms).pop() ?? ops.pulses[0];
  const p1 = ago(H);
  const pShift = ops.pulses.filter((p) => p.t <= shift.start).pop() ?? ops.pulses[0];

  // Ausbringung letzte Stunde vs. Stunde davor
  const goodIn = (a: number, b: number) => plant.machines.reduce((s, m) => s + (ops.buckets.get(m.id) ?? []).filter((x) => x.t >= a && x.t < b).reduce((q, x) => q + x.good, 0), 0);
  const edge = Math.floor(now / BUCKET) * BUCKET;
  const lastH = goodIn(edge - H, edge), prevH = goodIn(edge - 2 * H, edge - H);
  // gestern zur gleichen Zeit
  const ydGood = plant.machines.reduce((s, m) => s + (ops.buckets.get(m.id) ?? []).filter((x) => x.t >= ops.curDay - DAY && x.t < now - DAY).reduce((q, x) => q + x.good, 0), 0);

  const changes: Change[] = [];
  const pct = (a: number, b: number) => (b > 0 ? (a - b) / b : 0);
  if (prevH > 0 && Math.abs(pct(lastH, prevH)) > 0.02)
    changes.push({ id: "rate", area: "Produktion", text: `Ausbringung letzte Stunde ${lastH > prevH ? "gestiegen" : "gesunken"}`, dir: lastH > prevH ? "up" : "down", good: lastH > prevH, value: `${pct(lastH, prevH) > 0 ? "+" : ""}${fmtPct(pct(lastH, prevH), 1)} (${fmtInt(lastH)} Stk/h)` });
  if (ydGood > 0)
    changes.push({ id: "yday", area: "Produktion", text: `Gutteile seit 06:00 gegenüber gestern um diese Zeit`, dir: k.good >= ydGood ? "up" : "down", good: k.good >= ydGood, value: `${pct(k.good, ydGood) > 0 ? "+" : ""}${fmtPct(pct(k.good, ydGood), 1)}` });
  if (p1 && Math.abs(cur.oee - p1.oee) > 0.004)
    changes.push({ id: "oee", area: "Produktion", text: "OEE seit einer Stunde", dir: cur.oee > p1.oee ? "up" : "down", good: cur.oee > p1.oee, value: `${fmtPct(p1.oee, 1)} → ${fmtPct(cur.oee, 1)}` });
  if (p1 && cur.running !== p1.running)
    changes.push({ id: "run", area: "Produktion", text: "Linien in Produktion", dir: cur.running > p1.running ? "up" : "down", good: cur.running > p1.running, value: `${p1.running} → ${cur.running} von ${plant.machines.length}` });
  for (const m of plant.machines) {
    const a = pShift?.risk[m.id] ?? 0, b = cur.risk[m.id] ?? 0;
    if (Math.abs(b - a) >= 0.08 && Math.max(a, b) >= 0.25)
      changes.push({ id: `risk-${m.id}`, area: "Instandhaltung", text: `${m.id}: Ausfallrisiko seit Schichtbeginn`, dir: b > a ? "up" : "down", good: b < a, value: `${fmtPct(a, 0)} → ${fmtPct(b, 0)}` });
  }
  const sv = stockViews(plant);
  for (const s of sv) {
    const p24 = ago(24 * H)?.stock[s.productId];
    if (p24 === undefined) continue;
    const dPal = (s.pieces - p24) / s.piecesPerPallet;
    if (Math.abs(dPal) >= 6) changes.push({ id: `stk-${s.productId}`, area: "Lager", text: `Bestand ${s.short} seit gestern`, dir: dPal > 0 ? "up" : "down", good: dPal > 0 || s.state === "ok", value: `${dPal > 0 ? "+" : ""}${fmtInt(dPal)} Pal. (jetzt ${fmtInt(s.pallets)})` });
  }
  for (const mat of plant.materials) {
    const a = pShift?.reach[mat.id], b = cur.reach[mat.id];
    if (a === undefined || b === undefined || b > 20) continue;
    if (Math.abs(b - a) >= 0.4) changes.push({ id: `mat-${mat.id}`, area: "Material", text: `Reichweite ${mat.name}`, dir: b > a ? "up" : "down", good: b > a, value: `${fmtNum(a, 1)} → ${fmtNum(b, 1)} Tage` });
  }
  if (p1 && cur.onSite !== p1.onSite) changes.push({ id: "yard", area: "LKW-Hof", text: "Fahrzeuge auf dem Hof", dir: cur.onSite > p1.onSite ? "up" : "down", good: true, value: `${p1.onSite} → ${cur.onSite}` });
  if (pShift && cur.loss - pShift.loss > 250) changes.push({ id: "loss", area: "Finanzen", text: "Verlust (entgangener DB) seit Schichtbeginn", dir: "up", good: false, value: `+${fmtKEur(cur.loss - pShift.loss)}` });
  if (pShift && cur.revenue - pShift.revenue > 500) changes.push({ id: "rev", area: "Finanzen", text: "Umsatz seit Schichtbeginn (fakturiert bei Abfahrt)", dir: "up", good: true, value: `+${fmtKEur(cur.revenue - pShift.revenue)}` });

  // Lage in Sätzen
  const ms = plant.machines;
  const running = ms.filter((m) => m.status === "PRODUKTION").length;
  const notRunning = ms.filter((m) => m.status !== "PRODUKTION");
  const vs = ops.visits.map((v) => visitView(plant, v));
  const onSite = vs.filter((v) => v.status === "AM_TOR" || v.status === "WARTET" || v.status === "RAMPE");
  const late = vs.filter((v) => v.status === "ERWARTET" && !v.forecast && v.lateMin > 10 && v.slotStart < now + 3 * H);
  const risky = ms.filter((m) => m.status === "PRODUKTION" && (plant.predictions.get(m.id)?.p72 ?? 0) >= 0.4);
  const fin = financeTotals(ops.fin);
  const stopsToday = ops.stops.filter((s) => s.start >= ops.curDay).map((s) => stopView(plant, s)).sort((a, b) => b.lossEur - a.lossEur);
  const minLeft = Math.round((shift.end - now) / MIN);
  const paragraphs: { area: string; text: string; sev: Severity }[] = [];
  paragraphs.push({
    area: "Werk",
    sev: "ok",
    text: `${greeting}. Es ist ${fmtTime(now)} Uhr, ${shift.name} (${minLeft < 90 ? `Schichtwechsel in ${minLeft} min` : `bis ${fmtTime(shift.end)}`}). ${running} von ${ms.length} Linien produzieren, OEE heute ${fmtPct(k.oee, 1)} (Ziel 85 %). Seit 06:00 sind ${fmtInt(k.good)} Gutteile entstanden${ydGood > 0 ? ` – ${pct(k.good, ydGood) >= 0 ? "mehr" : "weniger"} als gestern um diese Zeit (${pct(k.good, ydGood) > 0 ? "+" : ""}${fmtPct(pct(k.good, ydGood), 1)})` : ""}.`,
  });
  const issues: string[] = [];
  for (const m of notRunning) issues.push(`${m.id} ${m.status === "STOERUNG" ? "steht" : m.status === "RUESTEN" ? "rüstet" : m.status === "WARTUNG" ? "ist in Wartung" : "hat keinen Auftrag"} seit ${fmtDuration((now - m.statusSince) / H)}${m.statusReason ? ` (${m.statusReason})` : ""}`);
  for (const m of risky) {
    const p = plant.predictions.get(m.id)!;
    issues.push(`das KI-Modell sieht für ${m.id} ein Ausfallrisiko von ${fmtPct(p.p72, 0)} in 72 h${p.drivers[0] ? ` (${p.drivers[0].label})` : ""}`);
  }
  paragraphs.push({
    area: "Maschinen",
    sev: ms.some((m) => m.status === "STOERUNG") || risky.some((m) => (plant.predictions.get(m.id)?.p72 ?? 0) >= 0.7) ? "crit" : issues.length ? "warn" : "ok",
    text: issues.length
      ? `Aufmerksamkeit: ${issues.join("; ")}. Stillstände und Ausschuss kosteten heute bisher ${fmtKEur(fin.loss)} entgangenen Deckungsbeitrag${stopsToday[0] ? ` – größter Einzelposten ${stopsToday[0].machineId}: ${stopsToday[0].reason} (${Math.round(stopsToday[0].durMin)} min, ${fmtKEur(stopsToday[0].lossEur)})` : ""}.`
      : `Alle Linien laufen störungsfrei. Entgangener Deckungsbeitrag heute bisher ${fmtKEur(fin.loss)} (vor allem Kurzstillstände und Ausschuss).`,
  });
  const yardTxt = onSite.length
    ? `Auf dem Hof ${onSite.length === 1 ? "steht 1 LKW" : `stehen ${onSite.length} LKW`}: ${onSite
        .slice(0, 4)
        .map((v) => `${v.plate} (${v.kind === "abholung" ? v.partner : v.cargo}) ${v.status === "RAMPE" ? `an Rampe ${v.dock}` : v.status === "WARTET" ? "wartet" : "am Tor"}${v.overstayMin > 0 ? `, ${Math.round(v.overstayMin)} min über Plan` : ""}`)
        .join(", ")}.`
    : "Der Hof ist im Moment frei.";
  const nextTrucks = vs.filter((v) => v.status === "ERWARTET" && !v.forecast && v.slotStart < now + 3 * H);
  paragraphs.push({
    area: "LKW-Hof",
    sev: onSite.some((v) => v.overstayMin > 0) || late.some((v) => v.lateMin > 45) ? "warn" : "ok",
    text: `${yardTxt} In den nächsten 3 Stunden werden ${nextTrucks.length} Fahrzeuge erwartet${late.length ? `, davon ${late.length} verspätet (${late.slice(0, 2).map((v) => `${v.plate} +${Math.round(v.lateMin)} min`).join(", ")})` : ""}. Heute bereits abgefertigt: ${vs.filter((v) => v.status === "ABGEFAHREN" && (v.departedAt ?? 0) >= ops.curDay).length}.`,
  });
  const low = sv.filter((s) => s.state !== "ok");
  const totalPal = sv.reduce((a, s) => a + s.pallets, 0);
  const matLow = plant.materials.filter((mat) => (cur.reach[mat.id] ?? 99) < mat.reorderPointDays);
  paragraphs.push({
    area: "Lager & Material",
    sev: low.some((s) => s.state === "crit") || matLow.some((m) => (cur.reach[m.id] ?? 99) < 1.5) ? "crit" : low.length || matLow.length ? "warn" : "ok",
    text: `Im Fertigwarenlager liegen ${fmtInt(totalPal)} Paletten (Warenwert ${fmtKEur(sv.reduce((a, s) => a + s.valueEur, 0))}). ${low.length ? `Unter Sicherheitsbestand: ${low.map((s) => `${s.short} (${fmtNum(s.free / s.piecesPerPallet, 0)} von ${s.minPallets} Pal. frei)`).join(", ")}.` : "Alle Artikel über Sicherheitsbestand."} ${matLow.length ? `Rohstoffe unter Meldebestand: ${matLow.map((m) => `${m.name} ${fmtNum(cur.reach[m.id], 1)} Tage`).join(", ")}.` : "Alle Rohstoff-Reichweiten im Soll."}`,
  });
  paragraphs.push({
    area: "Finanzen",
    sev: fin.result < 0 && (now - ops.curDay) / H > 12 ? "warn" : "ok",
    text: `Umsatz heute ${fmtKEur(fin.revenue)} (fakturiert bei Abfahrt), Deckungsbeitrag ${fmtKEur(fin.margin)}, Ergebnis nach anteiligen Fixkosten ${fin.result >= 0 ? "+" : ""}${fmtKEur(fin.result)}.`,
  });
  const rep = buildReport(plant, "tag", 0);
  paragraphs.push({
    area: "KI-Prognose",
    sev: rep.forecast.atRisk ? "warn" : "info",
    text: `Bis 06:00 erwartet das Modell ${fmtNum(rep.forecast.endOfDayGood / 1e6, 2)} Mio. Gutteile (${fmtPct(rep.forecast.endOfDayGood / Math.max(1, rep.forecast.endOfDayTarget), 0)} vom Soll). ${rep.forecast.atRisk ? `${rep.forecast.atRisk} Auftrag/Aufträge mit Terminrisiko – zuerst ${rep.forecast.orders[0].id} (${rep.forecast.orders[0].customer}, Pünktlichkeit ${fmtPct(rep.forecast.orders[0].onTimeProb, 0)}).` : "Alle offenen Aufträge liegen im Termin."} Monatsumsatz voraussichtlich ${fmtKEur(rep.forecast.monthRevenue)} bei Budget ${fmtKEur(rep.forecast.monthBudget)}.`,
  });

  // Als Nächstes
  const next: { t: number; kind: string; text: string }[] = [];
  for (const v of nextTrucks.slice(0, 6)) next.push({ t: v.etaKnown ? v.arriveAt : v.slotStart, kind: "LKW", text: `${v.plate} · ${v.kind === "abholung" ? `Abholung ${v.partner} (${v.pallets} Pal.)` : v.kind === "entsorgung" ? "Entsorgung Mahlgut" : `Anlieferung ${v.cargo}`}${v.lateMin > 5 ? ` · +${Math.round(v.lateMin)} min` : ""}` });
  for (const o of plant.orders.filter((o) => o.status === "PRODUKTION")) {
    const t = plant.projectFinish(o);
    if (t < now + 3 * H) next.push({ t, kind: "Auftrag", text: `${o.id} fertig (${CUSTOMER[o.customerId].name}, ${fmtInt(o.qty)} Stk ${PRODUCT[o.productId].short})` });
  }
  for (const t of plant.tickets.filter((x) => x.kind === "wartung" && x.status === "FREIGEGEBEN" && x.start < now + 3 * H)) next.push({ t: t.start, kind: "Wartung", text: `${t.machineId}: ${t.reason}` });
  if (shift.end < now + 3 * H) next.push({ t: shift.end, kind: "Schicht", text: `Schichtwechsel – Übergabe an ${shift.name === "Frühschicht" ? "Spätschicht" : shift.name === "Spätschicht" ? "Nachtschicht" : "Frühschicht"}` });
  next.sort((a, b) => a.t - b.t);

  const headline = ms.some((m) => m.status === "STOERUNG")
    ? `${ms.filter((m) => m.status === "STOERUNG").map((m) => m.id).join(", ")} in Störung – Rest läuft`
    : risky.length
      ? `Werk läuft – ${risky.map((m) => m.id).join(", ")} unter KI-Beobachtung`
      : `Werk läuft stabil · OEE ${fmtPct(k.oee, 1)}`;

  return {
    now,
    greeting,
    shift,
    headline,
    paragraphs,
    changes: changes.slice(0, 14),
    next: next.slice(0, 10),
    recommendations: recommendations(plant).slice(0, 5),
    kpis: { oee: k.oee, good: k.good, running, total: ms.length, onSite: onSite.length, revenue: fin.revenue, result: fin.result, loss: fin.loss, pallets: totalPal },
    events: plant.events.slice(0, 8),
  };
}
export type Briefing = ReturnType<typeof buildBriefing>;
