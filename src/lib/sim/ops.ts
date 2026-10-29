// Betriebsdaten neben der Kernsimulation (engine.ts): BDE-Raster je Maschine (15 min) mit Temperaturen,
// Tagesabschlüsse, Stillstandsprotokoll, Fertigwarenlager, LKW-Zeitfenster (Yard-Management) und Tagesfinanzen.
// Die Engine meldet Produktion, Statuswechsel und Sendungen – hier wird gebucht.

import { CARRIERS, CUSTOMER, CUSTOMERS, DRIVERS, ENERGY_EUR_PER_KWH, FIXED_COST_DAY, FREIGHT_EUR_PER_KM, MATERIAL_COST, PRODUCT, PRODUCTS, STOCK_SEEDS, SUPPLIERS, VEHICLES } from "./catalog";
import type { Plant } from "./engine";
import { Rng, clamp } from "./rng";
import { H, MIN, productionDayStart } from "./time";
import type { FinanceDay, Inbound, Machine, MachineBucket, MachineDay, MachineStatus, Order, Party, ProductStock, SensorValues, Shipment, StopRecord, TruckVisit, YardDay } from "./types";

export const BUCKET_MIN = 15;
export const BUCKET = BUCKET_MIN * MIN;
export const DAY = 24 * H;
const KEEP_DAYS = 31;
export const HOME: Party = { name: "Unternehmen · Werk Nord", city: "Musterstadt", country: "DE" };

const STOP_REASONS: Record<"SG" | "TF", { micro: string[]; long: string[]; setup: string[] }> = {
  SG: {
    micro: ["Entnahmeroboter: Teil nicht gegriffen", "Etikettenmagazin leer", "Angussbrücke hängt", "Lichtschranke Förderband", "Materialförderung kurz unterbrochen"],
    long: ["Werkzeugtemperierung Alarm", "Heißkanal Zone 4 Übertemperatur", "Hydraulikdruck schwankt", "Werkzeug reinigen (Belag)"],
    setup: ["Dekorwechsel IML-Etikett", "Farbwechsel Masterbatch", "Werkzeugwechsel"],
  },
  TF: {
    micro: ["Folienriss am Einzug", "Stapler-Überlauf", "Stanzgitter-Wickler voll", "Becherzählung gestört"],
    long: ["Heizfeld Sensorfehler", "Stanzwerkzeug blockiert", "Kettenführung justieren"],
    setup: ["Formwechsel", "Folienwechsel (neue Charge)", "Druckmotiv wechseln"],
  },
};
const SLOW_REASONS = {
  SG: ["Materialfeuchte erhöht – Zyklus verlängert", "Entnahmegreifer langsam", "Werkzeugtemperierung schwankt", "Etiketteneinleger nachjustiert"],
  TF: ["Folienspannung schwankt", "Heizfeld regelt nach", "Stapelstation langsam", "Folienrolle Restlänge – Wechsel vorbereitet"],
};
const DEFAULT_REASON: Record<MachineStatus, string> = {
  PRODUKTION: "",
  STOERUNG: "Störung",
  RUESTEN: "Rüsten",
  WARTUNG: "Wartung",
  STILLSTAND: "Kein Auftrag eingeplant",
};

/** Momentaufnahme alle 15 min – Grundlage für „Was hat sich verändert?“ im Lagebericht */
export interface Pulse {
  t: number;
  good: number;
  scrap: number;
  oee: number;
  running: number;
  onSite: number;
  revenue: number;
  loss: number;
  risk: Record<string, number>;
  stock: Record<string, number>;
  reach: Record<string, number>;
}

export function emptyBucket(t: number): MachineBucket {
  return { t, good: 0, scrap: 0, target: 0, runSec: 0, stopSec: {}, slowLoss: 0, energy: 0, n: 0, nRun: 0, temp1: 0, temp1Max: 0, temp2: 0, oil: 0, vib: 0, cycle: 0, lossEur: 0 };
}

/** Stückpreis und variable Materialkosten je Stück */
export function pieceEconomics(productId: string) {
  const p = PRODUCT[productId];
  const kg = p.weightG / 1000;
  const mat = kg * 0.98 * (MATERIAL_COST[p.material] ?? 1.5) + kg * 0.02 * MATERIAL_COST["M-MB"] + (p.iml ? 1.005 * MATERIAL_COST["M-IML"] : 0);
  return { price: p.pricePer1000 / 1000, mat, db: p.pricePer1000 / 1000 - mat };
}

/** Soll-Stück je Sekunde */
export const targetRate = (m: Machine) => m.cavities / m.targetCycle;

/** entgangener Deckungsbeitrag je Stillstandssekunde (Stillstand ohne Auftrag kostet nichts) */
export function lossPerSec(m: Machine, status: MachineStatus, hasOrder = true) {
  if (status === "PRODUKTION" || (status === "STILLSTAND" && !hasOrder)) return 0;
  return targetRate(m) * pieceEconomics(m.productId).db;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

function plateFor(rng: Rng, prefix: string) {
  return `${prefix}-${String.fromCharCode(65 + rng.int(0, 25))}${String.fromCharCode(65 + rng.int(0, 25))} ${rng.int(100, 9999)}`;
}

export class Ops {
  plant: Plant;
  rng: Rng;
  buckets = new Map<string, MachineBucket[]>();
  days = new Map<string, MachineDay[]>();
  stops: StopRecord[] = [];
  openStop = new Map<string, StopRecord>();
  stock = new Map<string, ProductStock>();
  stockDaily = new Map<string, { day: number; pieces: number }[]>();
  visits: TruckVisit[] = [];
  yardDays: YardDay[] = [];
  finance: FinanceDay[] = [];
  fin!: FinanceDay;
  slow = new Map<string, { factor: number; until: number; reason: string }>();
  /** Ursache für Zyklusverlängerung behoben (Maßnahme des KI-Wächters) bis … */
  noSlowUntil = new Map<string, number>();
  pulses: Pulse[] = [];
  curDay = 0;
  nextBucket = 0;
  nextStockHist = 0;
  planUntil = 0;
  seq = { visit: 24800, stop: 1 };

  constructor(plant: Plant) {
    this.plant = plant;
    this.rng = new Rng(plant.seed * 31 + 7);
  }

  // ======================= Initialisierung (plausible Vorgeschichte) =======================

  init() {
    const p = this.plant;
    const now = p.now;
    this.curDay = p.dayStart;
    this.nextBucket = Math.floor(now / BUCKET) * BUCKET + BUCKET;
    for (const m of p.machines) this.backfillMachine(m);
    this.backfillMachineDays();
    this.initStock();
    this.fin = this.emptyFinance(this.curDay);
    this.backfillFinance();
    this.initVisits();
    this.backfillYard();
    // heutige Produktionskosten seit 06:00 nachtragen
    for (const m of p.machines) {
      const e = pieceEconomics(m.productId);
      const bs = this.buckets.get(m.id)!.filter((b) => b.t >= this.curDay);
      for (const b of bs) {
        this.fin.material += (b.good + b.scrap) * e.mat;
        this.fin.energy += b.energy * ENERGY_EUR_PER_KWH;
        this.fin.pieces += b.good;
        this.fin.lossScrap += b.scrap * e.price;
        this.fin.lossDowntime += b.lossEur - b.scrap * e.price;
      }
    }
    // Lagerbewegungen seit 06:00: Zugang aus den Linien, Abgang mit den heutigen Abholungen
    for (const m of p.machines) {
      const st = this.stock.get(m.productId);
      if (st) st.inToday += this.buckets.get(m.id)!.filter((b) => b.t >= this.curDay).reduce((s, b) => s + b.good, 0);
    }
    for (const v of this.visits) {
      if (v.kind !== "abholung" || !v.productId || (v.departedAt ?? 0) < this.curDay) continue;
      const st = this.stock.get(v.productId);
      if (st) st.outToday += v.qty;
    }
    const share = (now - this.curDay) / DAY;
    this.fin.personnel = FIXED_COST_DAY.personnel * share;
    this.fin.overhead = FIXED_COST_DAY.overhead * share;
    this.nextStockHist = Math.floor(now / H) * H + H;
    this.backfillPulses();
  }

  /** Momentaufnahmen der letzten 24 h aus Raster, Lagerverlauf und Hofbelegung rekonstruieren */
  private backfillPulses() {
    const p = this.plant;
    const now = p.now;
    const cur = this.pulseNow();
    for (let t = Math.floor((now - 24 * H) / BUCKET) * BUCKET; t < now; t += BUCKET) {
      const day = t >= this.curDay ? this.curDay : this.curDay - DAY;
      let good = 0, scrap = 0, target = 0, running = 0;
      for (const m of p.machines) {
        const bs = this.buckets.get(m.id)!.filter((b) => b.t >= day && b.t < t);
        for (const b of bs) {
          good += b.good;
          scrap += b.scrap;
          target += b.target;
        }
        const last = bs[bs.length - 1];
        if (last && last.runSec > 450) running++;
      }
      const age = (now - t) / (24 * H);
      const stock: Record<string, number> = {};
      for (const st of this.stock.values()) stock[st.productId] = st.history.find((h) => h.t >= t)?.pieces ?? st.pieces;
      const share = (t - day) / Math.max(1, now - this.curDay);
      this.pulses.push({
        t,
        good,
        scrap,
        oee: target > 0 ? good / target : cur.oee,
        running,
        onSite: this.visits.filter((v) => v.arrivedAt !== undefined && v.arrivedAt <= t && (v.departedAt ?? Infinity) > t).length,
        revenue: day === this.curDay ? this.fin.revenue * share : 0,
        loss: day === this.curDay ? (this.fin.lossDowntime + this.fin.lossScrap) * share : 0,
        risk: Object.fromEntries(Object.entries(cur.risk).map(([k, v]) => [k, v * (1 - age * 0.25)])),
        stock,
        reach: Object.fromEntries(Object.entries(cur.reach).map(([k, v]) => [k, v + age * 0.9])),
      });
    }
  }

  pulseNow(): Pulse {
    const p = this.plant;
    const k = p.kpiCore();
    return {
      t: p.now,
      good: k.good,
      scrap: k.scrap,
      oee: k.oee,
      running: p.machines.filter((m) => m.status === "PRODUKTION").length,
      onSite: this.visits.filter((v) => v.status !== "ERWARTET" && v.status !== "ABGEFAHREN").length,
      revenue: this.fin.revenue,
      loss: this.fin.lossDowntime + this.fin.lossScrap,
      risk: Object.fromEntries(p.machines.map((m) => [m.id, p.predictions.get(m.id)?.p72 ?? 0])),
      stock: Object.fromEntries([...this.stock.values()].map((s) => [s.productId, s.pieces])),
      reach: Object.fromEntries(
        p.materials.map((mat) => {
          const perH = p.expectedConsumptionPerHour(mat.id);
          return [mat.id, perH > 0 ? mat.stock / (perH * 24) : 99];
        }),
      ),
    };
  }

  /** Zwei Tage Statusverlauf + BDE-Raster rückwirkend erzeugen; Tageszähler daraus ableiten */
  private backfillMachine(m: Machine) {
    const p = this.plant;
    const rng = this.rng;
    const now = p.now;
    const from = this.curDay - DAY;
    const k = STOP_REASONS[m.type];
    // ältere Maschinen haben häufiger Kurzstillstände
    const meanRun = (95 + (1 - m.wear) * 110) * MIN;
    const segs: { t: number; status: MachineStatus; reason?: string }[] = [];
    const curStart = Math.max(from, Math.min(m.statusSince, now));
    let t = from;
    while (t < curStart) {
      segs.push({ t, status: "PRODUKTION" });
      t += Math.max(12 * MIN, -Math.log(Math.max(1e-6, rng.next())) * meanRun);
      if (t >= curStart) break;
      const r = rng.next();
      let status: MachineStatus = "STOERUNG", len: number, reason: string;
      if (r < 0.68) {
        len = rng.range(4, 15) * MIN;
        reason = rng.pick(k.micro);
      } else if (r < 0.88) {
        len = rng.range(18, 50) * MIN;
        reason = rng.pick(k.long);
      } else {
        status = "RUESTEN";
        len = rng.range(40, 90) * MIN;
        reason = rng.pick(k.setup);
      }
      segs.push({ t, status, reason });
      t += len;
    }
    // laufender Zustand
    while (segs.length && segs[segs.length - 1].t >= curStart) segs.pop();
    if (segs.length && segs[segs.length - 1].status === m.status) {
      segs[segs.length - 1].reason = m.statusReason;
      m.statusSince = segs[segs.length - 1].t;
    } else segs.push({ t: curStart, status: m.status, reason: m.statusReason });

    // Stillstandsprotokoll
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.status === "PRODUKTION") continue;
      const end = segs[i + 1]?.t;
      const rec: StopRecord = { id: this.seq.stop++, machineId: m.id, status: s.status, reason: s.reason ?? DEFAULT_REASON[s.status], start: s.t, end, lossEur: 0 };
      rec.lossEur = (((end ?? now) - s.t) / 1000) * lossPerSec(m, s.status);
      this.stops.push(rec);
      if (end === undefined) this.openStop.set(m.id, rec);
    }

    // Raster
    const e = pieceEconomics(m.productId);
    const list: MachineBucket[] = [];
    const hist = m.hist;
    for (let bt = from; bt < now; bt += BUCKET) {
      const te = Math.min(bt + BUCKET, now);
      const b = emptyBucket(bt);
      b.productId = m.productId;
      let planned = 0;
      for (let i = 0; i < segs.length; i++) {
        const s0 = Math.max(segs[i].t, bt), s1 = Math.min(segs[i + 1]?.t ?? now, te);
        if (s1 <= s0) continue;
        const sec = (s1 - s0) / 1000;
        const st = segs[i].status;
        if (st !== "WARTUNG") planned += sec;
        if (st === "PRODUKTION") b.runSec += sec;
        else {
          b.stopSec[st] = (b.stopSec[st] ?? 0) + sec;
          b.lossEur += sec * lossPerSec(m, st);
          if (!b.reason || sec > 120) b.reason = segs[i].reason;
        }
      }
      b.target = planned * targetRate(m);
      // Leistung: meist nahe Soll, gelegentlich langsamer Zyklus
      let perf = clamp(rng.gauss(0.962, 0.018), 0.88, 0.995);
      if (b.runSec > 300 && rng.chance(0.07)) {
        perf = rng.range(0.62, 0.86);
        b.reason ??= rng.pick(SLOW_REASONS[m.type]);
      }
      const pieces = b.runSec * targetRate(m) * perf;
      const scrapRate = clamp(rng.gauss(0.0075, 0.0025) + m.wear * 0.004, 0.002, 0.03);
      b.scrap = pieces * scrapRate;
      b.good = pieces - b.scrap;
      b.slowLoss = Math.max(0, b.runSec * targetRate(m) * (0.96 - perf));
      b.lossEur += b.scrap * e.price + b.slowLoss * e.db;
      b.energy = (m.baseline.power * b.runSec * 0.92 + m.baseline.power * 0.2 * ((te - bt) / 1000 - b.runSec)) / 3600;
      // Messwerte aus dem 5-Minuten-Verlauf
      const run = b.runSec / Math.max(1, (te - bt) / 1000);
      const ss = hist.filter((s) => s.t >= bt && s.t < te);
      const src = ss.length ? ss : [{ ...m.baseline, t: bt }];
      for (const s of src) {
        const t1 = s.temp1 - (1 - run) * (m.type === "SG" ? 22 : 14);
        b.n++;
        b.temp1 += t1;
        b.temp1Max = Math.max(b.temp1Max, t1);
        b.temp2 += s.temp2 - (1 - run) * 3;
        b.oil += s.oil - (1 - run) * 4;
        if (run > 0.05) {
          b.nRun++;
          b.vib += s.vib;
          b.cycle += s.cycle / perf;
        }
      }
      list.push(b);
    }
    this.buckets.set(m.id, list);

    // Tageszähler der Engine aus dem Raster (Kennzahlen bleiben konsistent)
    const today = list.filter((b) => b.t >= this.curDay);
    const oldScrap = m.scrapToday || 1;
    m.goodToday = today.reduce((s, b) => s + b.good, 0);
    m.scrapToday = today.reduce((s, b) => s + b.scrap, 0);
    m.runSecToday = today.reduce((s, b) => s + b.runSec, 0);
    m.plannedSecToday = today.reduce((s, b) => s + b.target / targetRate(m), 0);
    m.energyKwhToday = today.reduce((s, b) => s + b.energy, 0);
    const f = m.scrapToday / oldScrap;
    for (const key of Object.keys(m.defects) as (keyof typeof m.defects)[]) m.defects[key] *= f;
    const startStatus = [...segs].reverse().find((s) => s.t <= this.curDay)?.status ?? "PRODUKTION";
    m.timeline = [{ t: this.curDay, status: startStatus }, ...segs.filter((s) => s.t > this.curDay).map((s) => ({ t: s.t, status: s.status }))].slice(-60);
  }

  private backfillMachineDays() {
    const rng = this.rng;
    for (const m of this.plant.machines) {
      const list: MachineDay[] = [];
      for (let k = KEEP_DAYS - 1; k >= 2; k--) {
        const day = this.curDay - k * DAY;
        const fail = rng.chance(0.045);
        const stoerH = clamp(rng.gauss(1.1, 0.45), 0.2, 3) + (fail ? rng.range(4, 6) : 0);
        const ruestH = rng.chance(0.55) ? rng.range(0.6, 2.2) : rng.range(0, 0.4);
        const wartH = rng.chance(0.08) ? rng.range(2, 6) : 0;
        const plannedH = 24 - wartH;
        const runH = Math.max(0, plannedH - stoerH - ruestH);
        const perf = clamp(rng.gauss(0.955, 0.015), 0.88, 0.99);
        const pieces = runH * 3600 * targetRate(m) * perf;
        const scrapRate = clamp(rng.gauss(0.008, 0.002), 0.003, 0.02);
        const e = pieceEconomics(m.productId);
        const good = pieces * (1 - scrapRate), scrap = pieces * scrapRate;
        const target = plannedH * 3600 * targetRate(m);
        list.push({
          day,
          good,
          scrap,
          target,
          runH,
          plannedH,
          stoerH,
          ruestH,
          wartH,
          stops: Math.round(stoerH * 3 + ruestH),
          oee: good / Math.max(1, target),
          energy: m.baseline.power * (runH * 0.92 + (24 - runH) * 0.2),
          lossEur: (stoerH + ruestH + wartH) * 3600 * targetRate(m) * e.db + scrap * e.price + runH * 3600 * targetRate(m) * Math.max(0, 0.96 - perf) * e.db,
          temp1Max: m.baseline.temp1 + rng.range(2, 9) + (fail ? 6 : 0),
          topReason: fail ? "Lagerschaden Spindel – Notabschaltung" : rng.pick(STOP_REASONS[m.type].micro),
        });
      }
      this.days.set(m.id, list);
      // gestern aus dem Raster
      this.days.get(m.id)!.push(this.dayFromBuckets(m, this.curDay - DAY));
    }
  }

  dayFromBuckets(m: Machine, day: number): MachineDay {
    const bs = (this.buckets.get(m.id) ?? []).filter((b) => b.t >= day && b.t < day + DAY);
    const sum = (f: (b: MachineBucket) => number) => bs.reduce((s, b) => s + f(b), 0);
    const good = sum((b) => b.good), target = sum((b) => b.target);
    const reasons = new Map<string, number>();
    for (const s of this.stops) if (s.machineId === m.id && s.start >= day && s.start < day + DAY) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + ((s.end ?? this.plant.now) - s.start));
    return {
      day,
      good,
      scrap: sum((b) => b.scrap),
      target,
      runH: sum((b) => b.runSec) / 3600,
      plannedH: target / targetRate(m) / 3600,
      stoerH: sum((b) => b.stopSec.STOERUNG ?? 0) / 3600,
      ruestH: sum((b) => b.stopSec.RUESTEN ?? 0) / 3600,
      wartH: sum((b) => b.stopSec.WARTUNG ?? 0) / 3600,
      stops: this.stops.filter((s) => s.machineId === m.id && s.start >= day && s.start < day + DAY).length,
      oee: good / Math.max(1, target),
      energy: sum((b) => b.energy),
      lossEur: sum((b) => b.lossEur),
      temp1Max: Math.max(0, ...bs.map((b) => b.temp1Max)),
      topReason: [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
    };
  }

  // ---------------- Fertigwarenlager ----------------

  private initStock() {
    const p = this.plant;
    const rng = this.rng;
    for (const prod of PRODUCTS) {
      const seed = STOCK_SEEDS[prod.id];
      const reserved = this.reservedFor(prod.id);
      const pieces = Math.round(seed.basePallets * prod.piecesPerPallet * rng.range(0.85, 1.15) + reserved);
      const demand = this.dailyDemand(prod.id);
      // Verlauf vorwärts: gleichmäßiger Zugang aus der Produktion, Abholungen als Sprünge – um den Grundbestand
      // schwingend; am Ende auf den heutigen Bestand eingepasst
      const ppp = prod.piecesPerPallet;
      const base = pieces;
      const series: number[] = [];
      let v = base * rng.range(0.85, 1.1);
      for (let h = 0; h < 7 * 24; h++) {
        series.push(v);
        v += (demand / 24) * rng.range(0.7, 1.15);
        const pShip = clamp(0.04 + ((v - base) / Math.max(ppp, base)) * 0.8, 0.01, 0.45);
        if (rng.chance(pShip)) v -= Math.min(v - seed.minPallets * ppp * 0.6, rng.range(8, 24) * ppp);
      }
      const off = pieces - series[series.length - 1];
      const t0 = Math.floor(p.now / H) * H - (7 * 24 - 1) * H;
      const history = series.map((x, i) => ({ t: t0 + i * H, pieces: Math.round(Math.max(seed.minPallets * ppp * 0.5, x + off * (i / (series.length - 1)))) }));
      this.stock.set(prod.id, { productId: prod.id, pieces, location: seed.location, minPallets: seed.minPallets, history, inToday: 0, outToday: 0 });
      const daily: { day: number; pieces: number }[] = [];
      let dv = history[0].pieces;
      for (let k = KEEP_DAYS - 1; k >= 1; k--) {
        const day = this.curDay - k * DAY;
        const h = history.find((x) => x.t >= day + 18 * H);
        if (h && k <= 6) dv = h.pieces;
        else dv = Math.max(seed.minPallets * prod.piecesPerPallet * 0.6, dv * rng.range(0.82, 1.2));
        daily.push({ day, pieces: Math.round(dv) });
      }
      this.stockDaily.set(prod.id, daily);
    }
  }

  /** Stück, die bereits Aufträgen gehören (in Produktion gefertigt bzw. versandbereit) */
  reservedFor(productId: string) {
    let r = 0;
    for (const o of this.plant.orders) {
      if (o.productId !== productId) continue;
      if (o.status === "QS" || o.status === "VERSANDBEREIT") r += o.qty;
      else if (o.status === "PRODUKTION") r += o.produced;
    }
    return r;
  }

  /** mittlerer Tagesbedarf (Durchsatz der Linien, die das Produkt fertigen) */
  dailyDemand(productId: string) {
    let s = 0;
    for (const m of this.plant.machines) if (m.productId === productId) s += targetRate(m) * 86400 * 0.82;
    if (!s) {
      const m = this.plant.machines.find((x) => PRODUCT[productId].machines.includes(x.id));
      if (m) s = targetRate(m) * 86400 * 0.3;
    }
    return s;
  }

  // ---------------- Finanzen ----------------

  emptyFinance(day: number): FinanceDay {
    return { day, revenue: 0, material: 0, energy: 0, freight: 0, personnel: 0, overhead: 0, lossDowntime: 0, lossScrap: 0, pieces: 0, byCustomer: {}, byProduct: {} };
  }

  private customersFor(productId: string) {
    const p = PRODUCT[productId];
    return CUSTOMERS.filter((c) => (p.type === "TF" ? ["Feinkost", "Molkerei"].includes(c.segment) : p.id === "P-EIS1000" ? c.segment === "Speiseeis" || c.segment === "Molkerei" : true));
  }

  private backfillFinance() {
    const rng = this.rng;
    // feste Kundengewichte (Stammkunden mit großem Volumen)
    const weight = new Map(CUSTOMERS.map((c, i) => [c.id, 0.5 + ((i * 7) % 5) * 0.35 + (c.km < 200 ? 0.4 : 0)]));
    for (let k = KEEP_DAYS - 1; k >= 1; k--) {
      const day = this.curDay - k * DAY;
      const f = this.emptyFinance(day);
      const wd = new Date(day + 6 * H).getUTCDay();
      // am Wochenende wird produziert, aber kaum abgeholt – unter der Woche entsprechend mehr
      const shipFactor = wd === 0 ? 0.35 : wd === 6 ? 0.75 : rng.range(1.0, 1.25);
      for (const m of this.plant.machines) {
        const d = this.days.get(m.id)!.find((x) => x.day === day);
        if (!d) continue;
        const e = pieceEconomics(m.productId);
        f.material += (d.good + d.scrap) * e.mat;
        f.energy += d.energy * ENERGY_EUR_PER_KWH;
        f.pieces += d.good;
        f.lossScrap += d.scrap * e.price;
        f.lossDowntime += d.lossEur - d.scrap * e.price;
        // verkauft wird zeitversetzt – Abholungen schwanken mit dem Wochentag
        const sold = d.good * shipFactor * rng.range(0.92, 1.08);
        const pool = this.customersFor(m.productId);
        const tot = pool.reduce((s, c) => s + weight.get(c.id)!, 0);
        for (const c of pool) {
          const share = (weight.get(c.id)! / tot) * rng.range(0.6, 1.4);
          const pcs = sold * share;
          this.book(f, c.id, m.productId, pcs);
        }
      }
      const trucks = Math.round(9 * shipFactor);
      f.freight = trucks * rng.range(260, 420) * FREIGHT_EUR_PER_KM;
      f.personnel = FIXED_COST_DAY.personnel;
      f.overhead = FIXED_COST_DAY.overhead;
      this.finance.push(f);
    }
  }

  /** Umsatz/Kosten einer Lieferung buchen */
  private book(f: FinanceDay, customerId: string, productId: string, pieces: number, revenue?: number) {
    const e = pieceEconomics(productId);
    const rev = revenue ?? pieces * e.price;
    f.revenue += rev;
    const c = (f.byCustomer[customerId] ??= { revenue: 0, pieces: 0, cost: 0 });
    c.revenue += rev;
    c.pieces += pieces;
    c.cost += pieces * e.mat;
    const pr = (f.byProduct[productId] ??= { revenue: 0, pieces: 0, cost: 0 });
    pr.revenue += rev;
    pr.pieces += pieces;
    pr.cost += pieces * e.mat;
  }

  // ---------------- LKW-Zeitfenster ----------------

  private delayMin(rng = this.rng) {
    const r = rng.next();
    if (r < 0.6) return rng.gauss(-7, 7);
    if (r < 0.88) return rng.range(6, 38);
    return rng.range(45, 130);
  }

  private driverFor(carrier: string, plate: string) {
    const pool = DRIVERS[carrier] ?? DRIVERS["Bergische Spedition"];
    return pool[hash(plate) % pool.length];
  }

  private phoneFor(plate: string) {
    return `+49 1${60 + (hash(plate) % 19)} ••• ${String(hash(plate + "t") % 10000).padStart(4, "0")}`;
  }

  visitForShipment(sh: Shipment, o: Order): TruckVisit {
    const c = CUSTOMER[sh.customerId];
    const prod = PRODUCT[o.productId];
    const handleMin = Math.round(16 + Math.min(66, sh.pallets) * 0.9);
    const slotStart = sh.slot - (handleMin + 25) * MIN;
    const carrierPrefix = CARRIERS.find((x) => x.name === sh.carrier)?.plate ?? "GM";
    const r = new Rng(hash(sh.id));
    return {
      id: `ZF-${this.seq.visit++}`,
      kind: "abholung",
      carrier: sh.carrier,
      plate: sh.plate,
      trailer: plateFor(r, carrierPrefix),
      driver: this.driverFor(sh.carrier, sh.plate),
      phone: this.phoneFor(sh.plate),
      vehicle: sh.pallets > 33 ? "Megatrailer, doppelstöckig beladen" : r.pick(VEHICLES),
      partner: c.name,
      from: HOME,
      to: { name: c.name, city: c.city, country: c.country },
      km: c.km,
      cargo: prod.name,
      productId: prod.id,
      qty: o.qty,
      unit: "Stk",
      pallets: sh.pallets,
      weightKg: Math.round((o.qty * prod.weightG) / 1000 + sh.pallets * 24),
      orderId: o.id,
      shipmentId: sh.id,
      dock: sh.dock,
      slotStart,
      slotEnd: slotStart + 30 * MIN,
      plannedDepart: sh.slot,
      dwellMin: handleMin + 25,
      handleMin,
      arriveAt: slotStart + this.delayMin(r) * MIN,
      status: "ERWARTET",
      ref: `CMR ${String(hash(sh.id) % 900000 + 100000)} · ${sh.id}`,
    };
  }

  visitForInbound(ib: Inbound): TruckVisit {
    const mat = this.plant.material(ib.materialId)!;
    const sup = SUPPLIERS[ib.supplier] ?? SUPPLIERS[ib.supplier.replace(/ \(Express\)$/, "")] ?? { city: "–", country: "DE", km: 120 };
    const r = new Rng(hash(ib.id));
    const carrier = r.pick(CARRIERS);
    const plate = plateFor(r, carrier.plate);
    const silo = mat.id === "M-PPH" || mat.id === "M-PPR";
    const pallets = silo ? 0 : Math.max(1, Math.ceil(ib.qty / (mat.unit === "kg" ? 850 : 240_000)));
    const handleMin = silo ? 55 : Math.round(15 + pallets * 0.8);
    const slotStart = ib.eta - 15 * MIN;
    return {
      id: `ZF-${this.seq.visit++}`,
      kind: "anlieferung",
      carrier: carrier.name,
      plate,
      trailer: plateFor(r, carrier.plate),
      driver: this.driverFor(carrier.name, plate),
      phone: this.phoneFor(plate),
      vehicle: silo ? "Silozug 24 t (Druckentladung)" : "Sattelzug Plane 13,6 m",
      partner: ib.supplier,
      from: { name: ib.supplier, city: sup.city, country: sup.country },
      to: { name: `${HOME.name} · ${mat.location}`, city: HOME.city, country: "DE" },
      km: sup.km,
      cargo: mat.name,
      materialId: mat.id,
      qty: ib.qty,
      unit: mat.unit,
      pallets,
      weightKg: mat.unit === "kg" ? ib.qty + pallets * 24 : Math.round(ib.qty * 0.0021 + pallets * 24),
      inboundId: ib.id,
      dock: silo ? 6 : r.int(1, 6),
      slotStart,
      slotEnd: slotStart + 30 * MIN,
      plannedDepart: slotStart + (handleMin + 30) * MIN,
      dwellMin: handleMin + 30,
      handleMin,
      arriveAt: slotStart + this.delayMin(r) * MIN,
      status: "ERWARTET",
      ref: `WE ${ib.id} · Lieferschein ${hash(ib.id) % 90000 + 10000}`,
    };
  }

  /** Feste Tagesplanung: Packmittel-Anlieferungen und Entsorgung (deterministisch je Tag) */
  dayPlan(day: number): TruckVisit[] {
    const r = new Rng(hash(`plan-${Math.round(day / DAY)}`));
    const wd = new Date(day + 6 * H).getUTCDay();
    if (wd === 0) return [];
    const out: TruckVisit[] = [];
    const ds = new Date(day + 6 * H).toISOString().slice(2, 10).replace(/-/g, "");
    const add = (kind: TruckVisit["kind"], supplier: string, cargo: string, hour: number, pallets: number, qty: number, unit: string, kg: number, arriveAt?: number) => {
      const sup = SUPPLIERS[supplier];
      const carrier = kind === "entsorgung" ? { name: "RecyPlast Logistik", plate: "GM" } : r.pick(CARRIERS);
      const plate = plateFor(r, carrier.plate);
      const handleMin = Math.round(14 + pallets * 0.7);
      const slotStart = day + (hour - 6) * H;
      out.push({
        id: `ZF-${ds}${out.length + 1}`,
        kind,
        carrier: carrier.name,
        plate,
        trailer: plateFor(r, carrier.plate),
        driver: DRIVERS[carrier.name] ? this.driverFor(carrier.name, plate) : r.pick(["Heinz Kowalczyk", "Michael Dörr", "Artur Wiebe"]),
        phone: this.phoneFor(plate),
        vehicle: kind === "entsorgung" ? "Abrollkipper mit Container 38 m³" : r.pick(VEHICLES),
        partner: supplier,
        from: kind === "entsorgung" ? HOME : { name: supplier, city: sup.city, country: sup.country },
        to: kind === "entsorgung" ? { name: supplier, city: sup.city, country: sup.country } : HOME,
        km: sup.km,
        cargo,
        qty,
        unit,
        pallets,
        weightKg: kg,
        dock: kind === "entsorgung" ? 6 : r.int(1, 6),
        slotStart,
        slotEnd: slotStart + 30 * MIN,
        plannedDepart: slotStart + (handleMin + 30) * MIN,
        dwellMin: arriveAt !== undefined ? Math.round((slotStart - arriveAt) / MIN) + handleMin + 30 : handleMin + 30,
        handleMin,
        arriveAt: arriveAt ?? slotStart + this.delayMin(r) * MIN,
        status: "ERWARTET",
        ref: `Avis ${ds}-${out.length + 1}${arriveAt !== undefined ? " · Vorabend-Anreise (Ruhezeit auf dem Hof)" : ""}`,
      });
    };
    // Fernverkehr für den Frühtermin: reist am Vorabend an und verbringt die Ruhezeit auf dem Hof
    if (wd !== 6 && r.chance(0.75)) add("anlieferung", "Wellpappe Nord GmbH", "Umkartons Wellpappe (Faltschachteln)", 6.25, r.int(26, 33), r.int(26, 33) * 380, "Stk", r.int(6100, 8200), day - r.range(6.4, 7.7) * H);
    add("anlieferung", "Kartonagen Nord", "Faltkartons & Zwischenlagen", r.range(7.2, 10), r.int(18, 28), r.int(18, 28) * 450, "Stk", r.int(4200, 6800));
    if (wd !== 6 && r.chance(0.65)) add("anlieferung", "Kartonagen Nord", "Faltkartons (Nachlieferung)", r.range(12.5, 15.5), r.int(10, 18), r.int(10, 18) * 450, "Stk", r.int(2600, 4100));
    if (wd === 1 || wd === 3 || wd === 5) add("anlieferung", "Palettenwerk Siegtal", "Europaletten (Tausch, EPAL 1)", r.range(9, 12.5), 30, 450, "Stk", 11_200);
    if (wd === 2 || wd === 4) add("anlieferung", "Stretchfolien Rhein GmbH", "Stretch- & Haubenfolie", r.range(10, 13), r.int(8, 12), r.int(8, 12) * 40, "Rollen", r.int(3800, 5200));
    if (wd !== 6) add("entsorgung", "RecyPlast Bergisch Land", "Mahlgut & Stanzgitter (Big Bags, sortenrein)", r.range(13, 16), r.int(10, 16), r.int(5200, 8800), "kg", r.int(5200, 8800));
    return out;
  }

  /** Abholungen der Vergangenheit (Sendungen, die bereits zugestellt und archiviert sind) */
  private historyPickups(from: number, to: number) {
    const rng = this.rng;
    const out: TruckVisit[] = [];
    let t = from + rng.range(0.4, 1.4) * H;
    while (t < to - 0.5 * H) {
      const prod = rng.pick(PRODUCTS);
      const pool = this.customersFor(prod.id);
      const c = rng.pick(pool);
      const qty = Math.round(rng.range(40, 170)) * 1000;
      const carrier = rng.pick(CARRIERS);
      const plate = plateFor(rng, carrier.plate);
      const pallets = Math.max(1, Math.ceil(qty / prod.piecesPerPallet));
      const handleMin = Math.round(16 + Math.min(66, pallets) * 0.9);
      const slotStart = t;
      const arr = slotStart + this.delayMin() * MIN;
      const dockAt = arr + rng.range(4, 18) * MIN;
      const done = dockAt + handleMin * MIN;
      const dep = done + rng.range(4, 12) * MIN;
      if (dep > to) break;
      const id = `ZF-${this.seq.visit++}`;
      out.push({
        id,
        kind: "abholung",
        carrier: carrier.name,
        plate,
        trailer: plateFor(rng, carrier.plate),
        driver: this.driverFor(carrier.name, plate),
        phone: this.phoneFor(plate),
        vehicle: pallets > 33 ? "Megatrailer, doppelstöckig beladen" : rng.pick(VEHICLES),
        partner: c.name,
        from: HOME,
        to: { name: c.name, city: c.city, country: c.country },
        km: c.km,
        cargo: prod.name,
        productId: prod.id,
        qty,
        unit: "Stk",
        pallets,
        weightKg: Math.round((qty * prod.weightG) / 1000 + pallets * 24),
        orderId: `FA-${47600 + rng.int(0, 590)}`,
        dock: rng.int(1, 6),
        slotStart,
        slotEnd: slotStart + 30 * MIN,
        plannedDepart: slotStart + (handleMin + 25) * MIN,
        dwellMin: handleMin + 25,
        handleMin,
        arriveAt: arr,
        arrivedAt: arr,
        dockAt,
        doneAt: done,
        departedAt: dep,
        status: "ABGEFAHREN",
        ref: `CMR ${hash(id) % 900000 + 100000}`,
      });
      t += rng.range(2.1, 3.4) * H;
    }
    return out;
  }

  /** frühester Lade-/Entladebeginn: Abholung ab 30 min vor Zeitfenster, Wareneingang besetzt 05:30–22:00 */
  private earliest(v: TruckVisit) {
    const a = v.arrivedAt! + (v.gateMin ?? 4) * MIN;
    if (v.kind === "abholung") return Math.max(a, v.slotStart - 30 * MIN);
    const day = productionDayStart(a);
    const sinceSix = (a - day) / H;
    return sinceSix >= 16 ? day + 23.5 * H : a;
  }

  /** abgeschlossene Vergangenheit eines geplanten Besuchs durchspielen */
  private replay(v: TruckVisit, until: number) {
    if (v.arriveAt > until) return;
    v.arrivedAt = v.arriveAt;
    v.status = "AM_TOR";
    const dock = this.earliest(v);
    if (dock > until) {
      if (until > v.arrivedAt + 4 * MIN) v.status = "WARTET";
      return;
    }
    v.dockAt = dock + this.rng.range(1, 9) * MIN;
    if (v.dockAt > until) {
      v.dockAt = undefined;
      v.status = "WARTET";
      return;
    }
    v.status = "RAMPE";
    const done = v.dockAt + v.handleMin * MIN;
    if (done > until) return;
    v.doneAt = done;
    const dep = done + this.rng.range(4, 10) * MIN;
    if (dep > until) return;
    v.departedAt = dep;
    v.status = "ABGEFAHREN";
  }

  private initVisits() {
    const p = this.plant;
    const now = p.now;
    // Vergangenheit: gestern + heute bis jetzt
    for (const day of [this.curDay - DAY, this.curDay]) {
      for (const v of this.dayPlan(day)) {
        if (v.slotStart > now + 0.5 * H && day === this.curDay) {
          this.visits.push(v);
          continue;
        }
        this.replay(v, now);
        this.visits.push(v);
      }
      const hp = this.historyPickups(day, Math.min(day + DAY, now - 4 * H));
      for (const v of hp) {
        this.visits.push(v);
        if (v.departedAt! >= this.curDay) {
          this.book(this.fin, CUSTOMERS.find((c) => c.name === v.partner)!.id, v.productId!, v.qty);
          this.fin.freight += v.km * FREIGHT_EUR_PER_KM;
        }
      }
    }
    // Sendungen der Engine
    for (const sh of p.shipments) {
      const o = p.order(sh.orderId);
      if (!o) continue;
      const v = this.visitForShipment(sh, o);
      if (sh.status === "UNTERWEGS" && sh.departedAt) {
        v.departedAt = sh.departedAt;
        v.doneAt = sh.departedAt - this.rng.range(4, 9) * MIN;
        v.dockAt = v.doneAt - v.handleMin * MIN;
        v.arrivedAt = v.arriveAt = v.dockAt - this.rng.range(5, 25) * MIN;
        v.slotStart = Math.round((v.arrivedAt - this.rng.range(-10, 25) * MIN) / (15 * MIN)) * 15 * MIN;
        v.slotEnd = v.slotStart + 30 * MIN;
        v.plannedDepart = v.slotStart + v.dwellMin * MIN;
        v.status = "ABGEFAHREN";
        if (sh.departedAt >= this.curDay) {
          this.book(this.fin, sh.customerId, o.productId, o.qty, o.valueEur);
          this.fin.freight += v.km * FREIGHT_EUR_PER_KM;
        }
      } else {
        this.replay(v, now);
        // offene Sendung: Verladung schließt die laufende Simulation ab (Lagerabgang, Abfahrt)
        if (v.doneAt) {
          v.status = "RAMPE";
          v.departedAt = undefined;
          v.doneAt = undefined;
        }
        if (v.status === "RAMPE") sh.status = "BELADUNG";
      }
      this.visits.push(v);
    }
    for (const ib of p.inbound) if (ib.status !== "ANGEKOMMEN") this.visits.push(this.visitForInbound(ib));
    // morgen schon avisiert (Vorabend-Anreisen können bereits auf dem Hof stehen)
    for (const v of this.dayPlan(this.curDay + DAY)) {
      this.replay(v, now);
      this.visits.push(v);
    }
    this.planUntil = this.curDay + 2 * DAY;
    this.visits.sort((a, b) => a.slotStart - b.slotStart);
  }

  private backfillYard() {
    const rng = this.rng;
    for (let k = KEEP_DAYS - 1; k >= 2; k--) {
      const day = this.curDay - k * DAY;
      const wd = new Date(day + 6 * H).getUTCDay();
      const f = wd === 0 ? 0.15 : wd === 6 ? 0.55 : 1;
      const ab = Math.round(rng.range(8, 12) * f), an = Math.round(rng.range(4, 7) * f);
      this.yardDays.push({ day, abholung: ab, anlieferung: an, entsorgung: wd === 0 || wd === 6 ? 0 : 1, late: Math.round(rng.range(0, 3.4) * f), overstay: Math.round(rng.range(0, 2.4) * f), avgDwellMin: Math.round(rng.range(46, 72)), pallets: Math.round(ab * rng.range(20, 30) + an * 14) });
    }
    this.yardDays.push(this.yardDayFrom(this.curDay - DAY));
  }

  yardDayFrom(day: number): YardDay {
    const vs = this.visits.filter((v) => v.arrivedAt !== undefined && v.arrivedAt >= day && v.arrivedAt < day + DAY);
    const dwell = vs.filter((v) => v.departedAt).map((v) => (v.departedAt! - v.arrivedAt!) / MIN);
    return {
      day,
      abholung: vs.filter((v) => v.kind === "abholung").length,
      anlieferung: vs.filter((v) => v.kind === "anlieferung").length,
      entsorgung: vs.filter((v) => v.kind === "entsorgung").length,
      late: vs.filter((v) => v.arrivedAt! > v.slotEnd).length,
      overstay: vs.filter((v) => ((v.departedAt ?? this.plant.now) - v.arrivedAt!) / MIN > v.dwellMin).length,
      avgDwellMin: dwell.length ? Math.round(dwell.reduce((a, b) => a + b, 0) / dwell.length) : 0,
      pallets: vs.reduce((s, v) => s + v.pallets, 0),
    };
  }

  // ======================= Laufende Buchung =======================

  /** Im Rollout neu angebundene Maschine: Raster und Tageshistorie beginnen erst mit der Anbindung */
  attach(m: Machine) {
    if (this.buckets.has(m.id)) return;
    this.buckets.set(m.id, [{ ...emptyBucket(Math.floor(this.plant.now / BUCKET) * BUCKET), productId: m.productId }]);
    this.days.set(m.id, []);
  }

  /** Anbindung getrennt: Raster, Stillstandsprotokoll und Zustände der Maschine verwerfen (keine Daten mehr) */
  detach(id: string) {
    this.buckets.delete(id);
    this.days.delete(id);
    this.openStop.delete(id);
    this.slow.delete(id);
    this.noSlowUntil.delete(id);
    this.stops = this.stops.filter((s) => s.machineId !== id);
  }

  private cur(m: Machine) {
    const list = this.buckets.get(m.id);
    return list?.[list.length - 1] ?? emptyBucket(this.plant.now);
  }

  /** Zyklusverlängerung (Leistungsverlust ohne Stillstand), z. B. durch feuchtes Material */
  slowdown(m: Machine, dtSec: number) {
    const now = this.plant.now;
    let s = this.slow.get(m.id);
    if (s && now >= s.until) {
      this.slow.delete(m.id);
      s = undefined;
    }
    if (!s && m.status === "PRODUKTION" && (this.noSlowUntil.get(m.id) ?? 0) <= now && this.rng.chance((0.42 * dtSec) / 3600)) {
      s = { factor: this.rng.range(1.12, 1.55), until: now + this.rng.range(6, 26) * MIN, reason: this.rng.pick(SLOW_REASONS[m.type]) };
      this.slow.set(m.id, s);
      this.cur(m).reason ??= s.reason;
    }
    return s?.factor ?? 1;
  }

  sample(m: Machine, dtSec: number, v: SensorValues) {
    const b = this.cur(m);
    const running = m.status === "PRODUKTION";
    const planned = m.status !== "WARTUNG" && !(m.status === "STILLSTAND" && m.queue.length === 0);
    if (planned) b.target += dtSec * targetRate(m);
    if (running) b.runSec += dtSec;
    else {
      b.stopSec[m.status] = (b.stopSec[m.status] ?? 0) + dtSec;
      const l = dtSec * lossPerSec(m, m.status, m.queue.length > 0);
      b.lossEur += l;
      this.fin.lossDowntime += l;
      if (m.statusReason && !b.reason) b.reason = m.statusReason;
    }
    const kwh = (v.power * dtSec) / 3600;
    b.energy += kwh;
    this.fin.energy += kwh * ENERGY_EUR_PER_KWH;
    b.n++;
    b.temp1 += v.temp1;
    b.temp1Max = Math.max(b.temp1Max, v.temp1);
    b.temp2 += v.temp2;
    b.oil += v.oil;
    if (running && v.cycle > 0) {
      b.nRun++;
      b.vib += v.vib;
      b.cycle += v.cycle;
    }
  }

  produce(m: Machine, productId: string, good: number, scrap: number, slowLoss: number) {
    const b = this.cur(m);
    const e = pieceEconomics(productId);
    b.productId = productId;
    b.good += good;
    b.scrap += scrap;
    b.slowLoss += slowLoss;
    const l = scrap * e.price + slowLoss * e.db;
    b.lossEur += l;
    this.fin.lossScrap += scrap * e.price;
    this.fin.lossDowntime += slowLoss * e.db;
    this.fin.material += (good + scrap) * e.mat;
    this.fin.pieces += good;
    const st = this.stock.get(productId);
    if (st) {
      st.pieces += good;
      st.inToday += good;
    }
  }

  onStatus(m: Machine, next: MachineStatus, reason?: string) {
    const now = this.plant.now;
    const open = this.openStop.get(m.id);
    if (open) {
      open.end = now;
      open.lossEur = ((now - open.start) / 1000) * lossPerSec(m, open.status, open.status !== "STILLSTAND");
      this.openStop.delete(m.id);
    }
    if (next !== "PRODUKTION") {
      const rec: StopRecord = { id: this.seq.stop++, machineId: m.id, status: next, reason: reason ?? DEFAULT_REASON[next], start: now, lossEur: 0 };
      this.stops.push(rec);
      this.openStop.set(m.id, rec);
      this.cur(m).reason = rec.reason;
    }
  }

  onShipment(sh: Shipment, o: Order) {
    this.visits.push(this.visitForShipment(sh, o));
  }

  onInbound(ib: Inbound) {
    this.visits.push(this.visitForInbound(ib));
  }

  hasVisit(shipmentId: string) {
    return this.visits.some((v) => v.shipmentId === shipmentId);
  }

  /** Wareneingang erst buchen, wenn der LKW entladen ist */
  inboundReleased(ib: Inbound) {
    const v = this.visits.find((x) => x.inboundId === ib.id);
    return !v || v.doneAt !== undefined;
  }

  tick(dtSec: number) {
    const p = this.plant;
    const now = p.now;
    const f = this.fin;
    f.personnel += (FIXED_COST_DAY.personnel * dtSec) / 86400;
    f.overhead += (FIXED_COST_DAY.overhead * dtSec) / 86400;

    // Produktionstag abschließen (06:00)
    if (p.dayStart !== this.curDay) this.closeDay(this.curDay, p.dayStart);

    // Raster fortschreiben
    while (now >= this.nextBucket) {
      this.pulses.push({ ...this.pulseNow(), t: this.nextBucket });
      while (this.pulses.length > 26 * 4) this.pulses.shift();
      for (const m of p.machines) {
        const list = this.buckets.get(m.id)!;
        const nb = emptyBucket(this.nextBucket);
        nb.productId = m.productId;
        list.push(nb);
        while (list.length && list[0].t < this.curDay - DAY) list.shift();
      }
      this.nextBucket += BUCKET;
    }

    // Lagerverlauf stündlich
    while (now >= this.nextStockHist) {
      for (const st of this.stock.values()) {
        st.history.push({ t: this.nextStockHist, pieces: Math.round(st.pieces) });
        if (st.history.length > 7 * 24) st.history.shift();
      }
      this.nextStockHist += H;
    }

    // Tagesplanung rollierend avisieren
    while (this.planUntil <= now + 30 * H) {
      for (const v of this.dayPlan(this.planUntil)) if (!this.visits.some((x) => x.id === v.id)) this.visits.push(v);
      this.planUntil += DAY;
    }

    this.tickVisits();
  }

  private closeDay(day: number, next: number) {
    const p = this.plant;
    for (const m of p.machines) {
      const list = this.days.get(m.id)!;
      list.push(this.dayFromBuckets(m, day));
      while (list.length > KEEP_DAYS) list.shift();
    }
    this.yardDays.push(this.yardDayFrom(day));
    while (this.yardDays.length > KEEP_DAYS) this.yardDays.shift();
    this.finance.push(this.fin);
    while (this.finance.length > KEEP_DAYS) this.finance.shift();
    this.fin = this.emptyFinance(next);
    for (const st of this.stock.values()) {
      const d = this.stockDaily.get(st.productId)!;
      d.push({ day, pieces: Math.round(st.pieces) });
      while (d.length > KEEP_DAYS) d.shift();
      st.inToday = st.outToday = 0;
    }
    this.stops = this.stops.filter((s) => s.start >= next - 2 * DAY || !s.end);
    this.curDay = next;
  }

  private dockBusy(dock: number, except: string) {
    return this.visits.some((v) => v.id !== except && v.status === "RAMPE" && v.dock === dock);
  }

  private tickVisits() {
    const p = this.plant;
    const now = p.now;
    for (const v of this.visits) {
      switch (v.status) {
        case "ERWARTET": {
          // Lieferavis verschoben (z. B. Verzug beim Lieferanten) → Zeitfenster folgt
          if (v.inboundId) {
            const ib = p.inbound.find((i) => i.id === v.inboundId);
            if (ib) {
              const d = ib.eta - 15 * MIN - v.slotStart;
              if (Math.abs(d) > MIN) {
                v.slotStart += d;
                v.slotEnd += d;
                v.arriveAt += d;
                v.plannedDepart += d;
              }
            }
          }
          if (now >= v.arriveAt) {
            v.status = "AM_TOR";
            v.arrivedAt = now;
            const late = (now - v.slotEnd) / MIN;
            p.log("TMS", late > 30 ? "warn" : "info", `${v.plate} am Werkstor`, `${v.carrier} · ${v.kind === "abholung" ? `Abholung für ${v.partner}` : v.kind === "entsorgung" ? "Entsorgung" : `Anlieferung ${v.cargo}`}${late > 5 ? ` · ${Math.round(late)} min nach Zeitfenster` : " · im Zeitfenster"}`);
          }
          break;
        }
        case "AM_TOR":
          if (now >= v.arrivedAt! + (v.gateMin ?? 4) * MIN) v.status = "WARTET";
          break;
        case "WARTET": {
          if (now < this.earliest(v)) break;
          if (this.dockBusy(v.dock, v.id)) {
            // Yard-Management: auf eine freie Rampe umdisponieren
            const free = [1, 2, 3, 4, 5, 6].find((d) => !this.dockBusy(d, v.id));
            if (!free) break;
            v.dock = free;
            const sh = v.shipmentId ? p.shipments.find((s) => s.id === v.shipmentId) : undefined;
            if (sh) sh.dock = free;
          }
          v.status = "RAMPE";
          v.dockAt = now;
          const sh = v.shipmentId ? p.shipments.find((s) => s.id === v.shipmentId) : undefined;
          if (sh) sh.status = "BELADUNG";
          break;
        }
        case "RAMPE":
          if (!v.doneAt && now >= v.dockAt! + v.handleMin * MIN) {
            v.doneAt = now;
            this.completeHandling(v);
          }
          if (v.doneAt && now >= v.doneAt + 6 * MIN) this.depart(v);
          break;
      }
    }
    // Archiv: 2 Tage Vergangenheit
    this.visits = this.visits.filter((v) => v.status !== "ABGEFAHREN" || (v.departedAt ?? 0) > now - 2 * DAY);
  }

  private completeHandling(v: TruckVisit) {
    const p = this.plant;
    if (v.kind === "abholung" && v.productId) {
      const st = this.stock.get(v.productId);
      if (st) {
        st.pieces = Math.max(0, st.pieces - v.qty);
        st.outToday += v.qty;
      }
    }
    if (v.inboundId) {
      const ib = p.inbound.find((i) => i.id === v.inboundId);
      if (ib) ib.eta = Math.min(ib.eta, p.now);
    }
  }

  private depart(v: TruckVisit) {
    const p = this.plant;
    v.status = "ABGEFAHREN";
    v.departedAt = p.now;
    if (v.shipmentId) {
      const sh = p.shipments.find((s) => s.id === v.shipmentId);
      const o = sh ? p.order(sh.orderId) : undefined;
      if (sh && sh.status !== "UNTERWEGS" && sh.status !== "ZUGESTELLT") {
        const c = CUSTOMER[sh.customerId];
        sh.status = "UNTERWEGS";
        sh.departedAt = p.now;
        sh.eta = p.now + (c.km / 65 + 0.4) * H;
        if (o) {
          o.status = "VERSENDET";
          this.book(this.fin, sh.customerId, o.productId, o.qty, o.valueEur);
        }
        this.fin.freight += c.km * FREIGHT_EUR_PER_KM;
        const late = (p.now - v.plannedDepart) / MIN;
        p.log(
          "TMS",
          late > 30 ? "warn" : "info",
          `${sh.plate} abgefahren`,
          `${sh.pallets} Paletten nach ${c.city} · ETA ${new Date(sh.eta).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })}${late > 10 ? ` · ${Math.round(late)} min später als geplant` : ""}`,
          { orderId: sh.orderId },
        );
      }
    }
  }

  // ======================= Zeitsprung (Echtzeit-Kopplung) =======================

  /** Alle Zeitstempel verschieben; das Tagesraster wird zur neuen Uhrzeit neu aufgebaut */
  shift(delta: number, walk: (o: unknown) => void, scale: number) {
    walk([this.visits, this.stops, [...this.stock.values()].map((s) => s.history), [...this.slow.values()], this.pulses, this.noSlowUntil]);
    const dd = Math.round(delta / DAY) * DAY;
    for (const list of this.days.values()) for (const d of list) d.day += dd;
    for (const d of this.yardDays) d.day += dd;
    for (const f of this.finance) f.day += dd;
    for (const list of this.stockDaily.values()) for (const d of list) d.day += dd;
    const newDay = this.plant.dayStart;
    const keepPast = <T extends { day: number }>(xs: T[]) => xs.filter((x) => x.day < newDay);
    for (const [k, list] of this.days) this.days.set(k, keepPast(list));
    this.yardDays = keepPast(this.yardDays);
    this.finance = keepPast(this.finance);
    for (const [k, list] of this.stockDaily) this.stockDaily.set(k, keepPast(list));
    // Raster: vorhandene Werte auf das neue Tagesraster übertragen (Summen bleiben, Zeiten rasten neu ein)
    const now = this.plant.now;
    for (const m of this.plant.machines) {
      const old = this.buckets.get(m.id)!;
      const list: MachineBucket[] = [];
      // neu angebundene Maschinen haben erst ab der Anbindung ein Raster
      const from = Math.max(Math.floor((newDay - DAY) / BUCKET) * BUCKET, m.connectedAt ? Math.floor(m.connectedAt / BUCKET) * BUCKET : 0);
      for (let t = from; t <= now; t += BUCKET) list.push({ ...emptyBucket(t), productId: m.productId });
      const offset = list.length - old.length;
      old.forEach((b, i) => {
        const j = i + offset;
        if (j >= 0 && j < list.length) list[j] = { ...b, t: list[j].t };
      });
      this.buckets.set(m.id, list);
    }
    this.fin.day = newDay;
    for (const k of ["revenue", "material", "energy", "freight", "personnel", "overhead", "lossDowntime", "lossScrap", "pieces"] as const) this.fin[k] *= scale;
    this.curDay = newDay;
    this.nextBucket = Math.floor(now / BUCKET) * BUCKET + BUCKET;
    this.nextStockHist = Math.floor(now / H) * H + H;
    this.planUntil = Math.max(newDay + DAY, this.planUntil + delta);
  }
}
