// Simulations-Engine des Werks: ersetzt im Prototyp SAP, MES, IoT-Gateway, CAQ, WMS und TMS.
// Läuft serverseitig als Singleton; die Zeit wird bei jeder Anfrage nachgezogen (1 Tick = 1 reale Sekunde).

import {
  CARRIERS,
  CUSTOMER,
  CUSTOMERS,
  DEFECTS,
  DEFECT_KEYS,
  MACHINE_SEEDS,
  MATERIAL_SEEDS,
  PHASE2_SEED,
  PRODUCT,
  PRODUCTS,
  SENSOR_DEFS,
} from "./catalog";
import { analyzeMachine } from "./guardian";
import { HIST_STEP_MIN, PmModel, predictMachine } from "./ml";
import { Ops } from "./ops";
import { nominalBaseline, sensorValues } from "./physics";
import { Rng, clamp } from "./rng";
import { maintainShowcase } from "./showcase";
import { H, MIN, atDayHour, productionDayStart } from "./time";
import type {
  DefectType,
  Inbound,
  Inquiry,
  Machine,
  MachineStatus,
  Material,
  Order,
  PlantEvent,
  Prediction,
  ScenarioId,
  ScenarioState,
  SensorSample,
  Severity,
  Shipment,
  SourceSystem,
  Ticket,
} from "./types";

const LIVE_LEN = 150;
const HIST_LEN = 576; // 48 h im 5-Minuten-Raster
const SPC_LEN = 60;
const MAX_EVENTS = 250;
// Werksuhr läuft standardmäßig in Echtzeit; Szenarien schalten in den Zeitraffer
export const DEFAULT_SPEED = 1;
export const SCENARIO_SPEED = 30;

export { SCENARIO_INFO } from "./scenarios";

interface StatusTimer {
  until: number;
  next: MachineStatus;
  repairs?: boolean;
  ticketId?: string;
}

export class Plant {
  seed: number;
  rng: Rng;
  now = 0;
  speed = DEFAULT_SPEED;
  paused = false;
  lastReal = 0;
  startedReal = 0;
  machines: Machine[] = [];
  orders: Order[] = [];
  materials: Material[] = [];
  inbound: Inbound[] = [];
  shipments: Shipment[] = [];
  events: PlantEvent[] = [];
  tickets: Ticket[] = [];
  inquiries: Inquiry[] = [];
  scenarios: Record<ScenarioId, ScenarioState> = {
    lager: { id: "lager", active: false },
    etikett: { id: "etikett", active: false },
    eilauftrag: { id: "eilauftrag", active: false },
    granulat: { id: "granulat", active: false },
  };
  predictions = new Map<string, Prediction>();
  model: PmModel;
  timers = new Map<string, StatusTimer>();
  spcNext = new Map<string, number>();
  ewma = new Map<string, number>();
  labelDriftRate = new Map<string, number>();
  plantHistory: { t: number; oee: number; output: number; scrap: number; energy: number }[] = [];
  delivered = { onTime: 412, total: 426 };
  dayStart = 0;
  nextHistAt = 0;
  nextPlantHistAt = 0;
  nextOrderAt = 0;
  lastHourMark = 0;
  outputSinceMark = 0;
  scrapSinceMark = 0;
  energySinceMark = 0;
  connectorTotals: Record<string, number> = {};
  seq = { order: 48210, event: 1, ticket: 310, shipment: 7700, inbound: 5100, inquiry: 90 };
  /** BDE-Raster, Lager, LKW-Hof, Finanzen */
  ops: Ops;
  /** KI-Wächter: wann ein Befund erstmals erkannt wurde (Befund-ID → Zeit) */
  guardSeen = new Map<string, number>();
  /** … und wann zuletzt (verschwindet ein Befund kurz, wird er nicht erneut gemeldet) */
  guardLast = new Map<string, number>();
  /** umgesetzte Maßnahmen („Maschine:Wirkung“ → Zeit) – solange wird der Befund beobachtet statt erneut gemeldet */
  measureAt = new Map<string, number>();
  /** Kurzstillstands-Ursache abgestellt bis … */
  microFixUntil = new Map<string, number>();
  /** Ersatzteil-Set liegt bereit → Reparatur deutlich kürzer */
  spares = new Set<string>();
  /** durch freigegebene KI-Maßnahmen vermiedener (erwarteter) Verlust */
  avoided: { t: number; machineId?: string; eur: number; text: string }[] = [];
  /** Bilanz der Prognosen des Wächters (Ausfall, Qualität): 30 Tage Vorgeschichte + laufend */
  guardTrust = { warnings: 0, confirmed: 0, falseAlarms: 0, leadH: 0, leadN: 0 };
  /** gemeldete Prognose-Befunde, deren Ausgang noch offen ist (ID → erkannt seit) */
  guardOpen = new Map<string, number>();
  /** Kopie für Was-wäre-wenn-Rechnungen: keine Wächter-Meldungen */
  quiet = false;
  /** Live-Demo „Alle Fälle“: Regisseur hält alle typischen Situationen gleichzeitig aktiv (lib/sim/showcase.ts) */
  showcase = { active: false, startedAt: 0, nextCheck: 0, seq: 1, last: {} as Record<string, number> };

  constructor(seed = 42, model?: PmModel) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.model = model ?? new PmModel().train();
    this.ops = new Ops(this);
    this.init();
  }

  // ======================= Initialisierung =======================

  private init() {
    const real = Date.now();
    this.lastReal = real;
    this.startedReal = real;
    this.now = Math.floor(real / 1000) * 1000;
    this.dayStart = productionDayStart(this.now);
    const rng = this.rng;
    const hoursToday = (this.now - this.dayStart) / H;

    // Maschinen
    this.machines = MACHINE_SEEDS.map((s) => {
      const baseline = nominalBaseline(s.type, rng, s.targetCycle * rng.range(1.025, 1.06));
      const wearRate = rng.range(0.0003, 0.0012);
      const m: Machine = {
        id: s.id,
        type: s.type,
        hall: s.hall,
        maker: s.maker,
        model: s.model,
        year: s.year,
        cavities: s.cavities,
        targetCycle: s.targetCycle,
        costPerHour: s.costPerHour,
        status: "PRODUKTION",
        statusSince: this.now - rng.range(0.5, 5) * H,
        productId: s.productId,
        queue: [],
        wear: s.wear,
        wearRate,
        heater: rng.range(0, 0.08),
        leak: rng.range(0, 0.05),
        labelDrift: 0,
        lastMaintenance: this.now - s.wear * rng.range(2400, 3600) * H,
        failureCount: 0,
        goodToday: 0,
        scrapToday: 0,
        runSecToday: 0,
        plannedSecToday: 0,
        energyKwhToday: 0,
        defects: { kurzschuss: 0, grat: 0, etikettenversatz: 0, schwarzpunkt: 0, riss: 0, verformung: 0 },
        live: [],
        hist: [],
        spc: [],
        timeline: [],
        current: baseline,
        baseline,
      };
      return m;
    });

    // Historie rückwärts erzeugen (Verschleiß war früher geringer)
    for (const m of this.machines) {
      for (let i = HIST_LEN - 1; i >= 0; i--) {
        const t = this.now - i * HIST_STEP_MIN * MIN;
        const w = Math.max(0, m.wear - m.wearRate * (i * HIST_STEP_MIN) / 60);
        m.hist.push({ t, ...sensorValues(m.baseline, { wear: w, heater: m.heater, leak: m.leak }, rng) });
      }
      for (let i = LIVE_LEN - 1; i >= 0; i--) {
        const t = this.now - i * this.speed * 1000;
        m.live.push({ t, ...sensorValues(m.baseline, m, rng) });
      }
      m.current = { ...m.live[m.live.length - 1] };
      const p = PRODUCT[m.productId];
      for (let i = SPC_LEN - 1; i >= 0; i--) {
        m.spc.push({ t: this.now - i * 5 * MIN, value: p.spc.nominal + rng.gauss(0, p.spc.tol / 4.6 / Math.sqrt(1.5)) });
      }
      // Tageszähler plausibel vorbelegen
      const avail = rng.range(0.84, 0.93);
      const run = hoursToday * avail;
      const pieces = (run * 3600 * m.cavities) / (m.targetCycle * 1.02);
      const scrapRate = rng.range(0.004, 0.011);
      m.goodToday = Math.round(pieces * (1 - scrapRate));
      m.scrapToday = Math.round(pieces * scrapRate);
      m.runSecToday = run * 3600;
      m.plannedSecToday = hoursToday * 3600;
      m.energyKwhToday = m.baseline.power * run * 0.92 + m.baseline.power * 0.25 * (hoursToday - run);
      this.distributeDefects(m, m.scrapToday, 1);
      m.timeline.push({ t: this.dayStart, status: "PRODUKTION" });
      if (hoursToday > 2) {
        const tStop = this.dayStart + rng.range(0.5, hoursToday - 1) * H;
        m.timeline.push({ t: tStop, status: rng.chance(0.5) ? "RUESTEN" : "STOERUNG" });
        m.timeline.push({ t: tStop + rng.range(0.2, 0.7) * H, status: "PRODUKTION" });
      }
    }
    // Eine Maschine steht beim Start im Rüstvorgang (Realismus)
    const tf3 = this.machine("TF-03");
    tf3.status = "RUESTEN";
    tf3.statusSince = this.now - 0.4 * H;
    tf3.statusReason = "Formwechsel Feinkostschale 200 g";
    tf3.timeline.push({ t: tf3.statusSince, status: "RUESTEN" });
    this.timers.set(tf3.id, { until: this.now + 0.5 * H, next: "PRODUKTION" });

    // Material
    this.materials = MATERIAL_SEEDS.map((s) => ({ ...s, consumption: [], consumedThisHour: 0 }));
    this.inbound = [
      this.mkInbound("M-PPH", 24000, this.now + 30 * H, "Polymerwerk Rhein-Ruhr"),
      this.mkInbound("M-PPR", 24000, this.now + 20 * H, "Nordsee Polymers"),
      this.mkInbound("M-PSF", 16000, this.now + 44 * H, "Folientechnik Sauerland"),
      this.mkInbound("M-IML", 4_000_000, this.now + 52 * H, "Labelprint Westfalen"),
      this.mkInbound("M-PPF", 12000, this.now + 60 * H, "Folientechnik Sauerland"),
    ];
    this.inbound[1].status = "UNTERWEGS";

    // Aufträge je Maschine
    for (const m of this.machines) {
      const n = rng.int(2, 3);
      let t = this.now;
      for (let k = 0; k < n; k++) {
        const prodId = k === 0 ? m.productId : rng.chance(0.7) ? m.productId : rng.pick(PRODUCTS.filter((p) => p.machines.includes(m.id))).id;
        const ratePerH = (3600 * m.cavities) / m.targetCycle * 0.9;
        const qty = Math.round((ratePerH * rng.range(14, 40)) / 1000) * 1000;
        const produced = k === 0 ? Math.round(qty * rng.range(0.15, 0.8)) : 0;
        const remainingH = (qty - produced) / ratePerH;
        t += remainingH * H;
        const cust = this.pickCustomerFor(prodId);
        const slack = rng.range(10, 40) * H;
        const o = this.mkOrder(cust.id, prodId, qty, t + slack + (cust.km / 65) * H, m.id, produced);
        o.status = k === 0 ? "PRODUKTION" : "GEPLANT";
        m.queue.push(o.id);
        this.orders.push(o);
      }
    }
    // Ein Auftrag knapp geplant (realistische Spannung)
    const tight = this.orders.find((o) => o.machineId === "SG-07" && o.status === "PRODUKTION");
    if (tight) tight.due = this.projectFinish(tight) + 4.5 * H + (CUSTOMER[tight.customerId].km / 65) * H;

    // Heute bereits fertige/verladene Aufträge + Sendungen
    for (let i = 0; i < 9; i++) {
      const p = rng.pick(PRODUCTS);
      const cust = this.pickCustomerFor(p.id);
      const qty = Math.round(rng.range(60, 380)) * 1000;
      const o = this.mkOrder(cust.id, p.id, qty, this.now + rng.range(6, 60) * H, rng.pick(p.machines), qty);
      o.status = i < 4 ? "VERSENDET" : "VERSANDBEREIT";
      o.doneAt = this.now - rng.range(2, 14) * H;
      this.orders.push(o);
      const sh = this.mkShipment(o, i < 4 ? this.now - rng.range(0.5, 5) * H : this.now + rng.range(0.3, 7) * H);
      if (i < 4) {
        sh.status = "UNTERWEGS";
        sh.departedAt = sh.slot;
        sh.eta = sh.slot + (cust.km / 65 + 0.5) * H;
        if (sh.eta < this.now) {
          sh.eta = this.now + rng.range(0.5, 3) * H;
        }
      }
      // Liefertermin plausibel hinter die geplante Ankunft legen
      o.due = (sh.eta ?? sh.slot + (cust.km / 65 + 0.4) * H) + rng.range(4, 30) * H;
      this.shipments.push(sh);
    }
    this.shipments.sort((a, b) => a.slot - b.slot);

    // Werks-Historie (24 h, 15-Minuten-Raster)
    for (let i = 96; i > 0; i--) {
      const t = this.now - i * 15 * MIN;
      const hour = new Date(t).getHours();
      const night = hour >= 22 || hour < 6 ? 0.96 : 1;
      this.plantHistory.push({
        t,
        oee: clamp(0.82 + rng.gauss(0, 0.025) - (i % 31 === 0 ? 0.08 : 0), 0.6, 0.95) * night,
        output: Math.round(rng.range(178000, 196000) * night),
        scrap: clamp(0.0075 + rng.gauss(0, 0.0012), 0.003, 0.02),
        energy: Math.round(rng.range(1380, 1520)),
      });
    }

    this.nextHistAt = this.now + HIST_STEP_MIN * MIN;
    this.nextPlantHistAt = this.now + 15 * MIN;
    this.nextOrderAt = this.now + rng.range(1.5, 3) * H;
    this.lastHourMark = this.now;
    for (const m of this.machines) this.updatePrediction(m);
    this.ops.init();
    // Vorgeschichte der letzten 30 Tage (plausibel): wie oft lag der Wächter richtig?
    const warned = rng.int(38, 47);
    const fa = rng.int(3, 5);
    const ok = warned - fa - 2;
    this.guardTrust = { warnings: warned, confirmed: ok, falseAlarms: fa, leadH: ok * rng.range(15, 21), leadN: ok };
    // bestehende Auffälligkeiten beim Start still übernehmen (sie waren schon vorher da)
    this.watch(true);

    this.log("MES", "info", "Schichtübergabe dokumentiert", "Alle Linien laufen, TF-03 im geplanten Formwechsel.");
    this.log("IoT", "ok", "OPC-UA-Gateway verbunden", "12 Maschinen · 84 Signale · Abtastrate 1 s");
    this.log("SAP", "info", "Auftragsbestand synchronisiert", `${this.openOrders().length} offene Fertigungsaufträge übernommen.`);
    this.log("KI", "info", "Modell pm-lager-v1.3 geladen", `Trainiert auf ${this.model.card.nTrain.toLocaleString("de-DE")} Zeitfenstern · AUC ${this.model.card.metrics.auc.toFixed(3)}`);
  }

  private pickCustomerFor(productId: string) {
    const p = PRODUCT[productId];
    const pool = CUSTOMERS.filter((c) =>
      p.type === "TF" ? ["Feinkost", "Molkerei"].includes(c.segment) : p.id === "P-EIS1000" ? c.segment === "Speiseeis" || c.segment === "Molkerei" : true,
    );
    return this.rng.pick(pool);
  }

  private mkOrder(customerId: string, productId: string, qty: number, due: number, machineId: string, produced = 0): Order {
    const p = PRODUCT[productId];
    return {
      id: `FA-${this.seq.order++}`,
      customerId,
      productId,
      qty,
      produced,
      due,
      created: this.now - this.rng.range(24, 240) * H,
      machineId,
      status: "GEPLANT",
      valueEur: Math.round((qty / 1000) * p.pricePer1000),
      priority: "normal",
    };
  }

  private mkInbound(materialId: string, qty: number, eta: number, supplier: string): Inbound {
    return { id: `WE-${this.seq.inbound++}`, materialId, qty, eta, supplier, status: "BESTELLT" };
  }

  private mkShipment(o: Order, slot: number): Shipment {
    const c = this.rng.pick(CARRIERS);
    const p = PRODUCT[o.productId];
    const sh: Shipment = {
      id: `LS-${this.seq.shipment++}`,
      orderId: o.id,
      customerId: o.customerId,
      carrier: c.name,
      plate: `${c.plate}-${String.fromCharCode(65 + this.rng.int(0, 25))}${String.fromCharCode(65 + this.rng.int(0, 25))} ${this.rng.int(100, 9999)}`,
      pallets: Math.max(1, Math.ceil(o.qty / p.piecesPerPallet)),
      dock: this.rng.int(1, 6),
      slot,
      status: "GEPLANT",
    };
    o.shipmentId = sh.id;
    return sh;
  }

  // ======================= Zugriff =======================

  machine(id: string) {
    const m = this.machines.find((x) => x.id === id.toUpperCase());
    if (!m) throw new Error(`Unbekannte Maschine ${id}`);
    return m;
  }

  findMachine(id: string) {
    return this.machines.find((x) => x.id === id.toUpperCase().replace(/\s+/g, "").replace(/^SG(\d)$/, "SG-0$1"));
  }

  order(id: string) {
    return this.orders.find((o) => o.id.toUpperCase() === id.toUpperCase());
  }

  material(id: string) {
    return this.materials.find((m) => m.id === id);
  }

  openOrders() {
    return this.orders.filter((o) => o.status !== "VERSENDET");
  }

  log(source: SourceSystem, severity: Severity, title: string, detail?: string, extra?: { machineId?: string; orderId?: string }) {
    this.events.unshift({ id: this.seq.event++, t: this.now, source, severity, title, detail, ...extra });
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
  }

  /** Stückzahl je Stunde einer Maschine bei aktuellem Zustand */
  ratePerHour(m: Machine) {
    const cycle = Math.max(m.targetCycle, m.current.cycle || m.targetCycle);
    return ((3600 * m.cavities) / cycle) * 0.94;
  }

  /** voraussichtliches Fertigstellungsdatum eines Auftrags (Warteschlange der Maschine) */
  projectFinish(o: Order): number {
    const m = this.machine(o.machineId);
    let t = this.now;
    const timer = this.timers.get(m.id);
    if (m.status !== "PRODUKTION" && timer) t = Math.max(t, timer.until);
    const pred = this.predictions.get(m.id);
    if (pred && pred.p72 > 0.35 && m.status === "PRODUKTION") t += pred.p72 * 5 * H; // erwartete Ausfallzeit
    for (const id of m.queue) {
      const q = this.order(id);
      if (!q) continue;
      const rate = this.ratePerHour(m);
      t += (Math.max(0, q.qty - q.produced) / rate) * H;
      if (q.id === o.id) return t;
      t += 1.2 * H; // Rüsten/Übergang
    }
    return o.doneAt ?? t;
  }

  // ======================= Zeitfortschritt =======================

  sync() {
    const real = Date.now();
    let ticks = Math.floor((real - this.lastReal) / 1000);
    if (ticks <= 0) return;
    this.lastReal += ticks * 1000;
    if (this.paused) return;
    if (ticks > 90) {
      // Nach langer Pause nicht alles nachholen – Zeit springt vorwärts
      this.now += (ticks - 90) * this.speed * 1000;
      ticks = 90;
    }
    for (let i = 0; i < ticks; i++) this.tick(this.speed);
  }

  tick(dtSec: number) {
    const prev = this.now;
    this.now += dtSec * 1000;
    const dtH = dtSec / 3600;

    // Produktionstag-Wechsel (06:00)
    const ds = productionDayStart(this.now);
    if (ds !== this.dayStart) {
      this.dayStart = ds;
      for (const m of this.machines) {
        m.goodToday = m.scrapToday = m.runSecToday = m.plannedSecToday = m.energyKwhToday = 0;
        for (const k of DEFECT_KEYS) m.defects[k] = 0;
        m.timeline = [{ t: ds, status: m.status }];
      }
      this.log("MES", "info", "Neuer Produktionstag", "Tageszähler zurückgesetzt (06:00 Uhr).");
    }
    this.ops.tick(dtSec);

    for (const m of this.machines) this.tickMachine(m, dtSec, dtH);
    this.tickTickets();
    this.tickOrders();
    this.tickMaterials(dtH);
    this.tickShipments();
    if (this.showcase.active && !this.quiet && this.now >= this.showcase.nextCheck) {
      this.showcase.nextCheck = this.now + MIN;
      maintainShowcase(this);
    }

    // Historie im 5-Minuten-Raster
    while (this.now >= this.nextHistAt) {
      for (const m of this.machines) {
        if (m.status === "PRODUKTION") {
          m.hist.push({ t: this.nextHistAt, ...sensorValues(m.baseline, m, this.rng) });
          if (m.hist.length > HIST_LEN) m.hist.shift();
        }
        this.updatePrediction(m);
      }
      this.nextHistAt += HIST_STEP_MIN * MIN;
      this.checkPredictiveAlerts();
      this.watch();
    }

    // Werks-Historie alle 15 Minuten
    while (this.now >= this.nextPlantHistAt) {
      const k = this.kpiCore();
      const hours = Math.max(1 / 60, (this.now - this.lastHourMark) / H);
      this.plantHistory.push({
        t: this.nextPlantHistAt,
        oee: k.oee,
        output: Math.round(this.outputSinceMark / hours),
        scrap: this.outputSinceMark > 0 ? this.scrapSinceMark / (this.outputSinceMark + this.scrapSinceMark) : k.scrapRate,
        energy: Math.round(this.energySinceMark / hours),
      });
      if (this.plantHistory.length > 96) this.plantHistory.shift();
      this.outputSinceMark = this.scrapSinceMark = this.energySinceMark = 0;
      this.lastHourMark = this.now;
      this.nextPlantHistAt += 15 * MIN;
    }

    // Neue Kundenaufträge aus SAP
    if (this.now >= this.nextOrderAt) {
      this.spawnOrder();
      this.nextOrderAt = this.now + this.rng.range(2, 4.5) * H;
    }

    // Verbindungs-Statistik
    const secs = (this.now - prev) / 1000;
    this.connectorTotals.iot = (this.connectorTotals.iot ?? 1_240_000) + Math.round(7 * this.machines.length * Math.min(secs, 60));
    this.connectorTotals.sap = (this.connectorTotals.sap ?? 18_400) + this.rng.int(0, 3);
    this.connectorTotals.mes = (this.connectorTotals.mes ?? 96_000) + this.rng.int(4, 14);
    this.connectorTotals.caq = (this.connectorTotals.caq ?? 41_800) + this.rng.int(2, 8);
    this.connectorTotals.wms = (this.connectorTotals.wms ?? 7_900) + this.rng.int(0, 3);
    this.connectorTotals.tms = (this.connectorTotals.tms ?? 1_120) + (this.rng.chance(0.3) ? 1 : 0);
    this.connectorTotals.crm = (this.connectorTotals.crm ?? 2_310) + (this.rng.chance(0.2) ? 1 : 0);
    this.connectorTotals.cmms = (this.connectorTotals.cmms ?? 860) + (this.rng.chance(0.1) ? 1 : 0);
  }

  /** Zustand von außen setzen (Live-Demo): nach Ablauf zurück in Produktion, bei repairs mit Instandsetzung */
  forceStatus(m: Machine, status: MachineStatus, reason: string, hours: number, repairs = false) {
    this.setStatus(m, status, reason);
    this.timers.set(m.id, { until: this.now + hours * H, next: "PRODUKTION", repairs });
  }

  private setStatus(m: Machine, status: MachineStatus, reason?: string) {
    if (m.status === status && m.statusReason === reason) return;
    if (m.status !== status) this.ops.onStatus(m, status, reason);
    m.status = status;
    m.statusSince = this.now;
    m.statusReason = reason;
    m.timeline.push({ t: this.now, status });
    if (m.timeline.length > 60) m.timeline.shift();
  }

  private tickMachine(m: Machine, dtSec: number, dtH: number) {
    const rng = this.rng;
    // Szenario Lagerschaden: Verschleiß beschleunigt sich schrittweise (realistischer Verlauf)
    const sc = this.scenarios.lager;
    if (sc.active && sc.startedAt && m.id === "SG-04" && m.wear < 1 && !this.timers.get(m.id)?.repairs) {
      const el = (this.now - sc.startedAt) / H;
      m.wearRate = 0.012 + 0.06 * clamp(el / 1.6, 0, 1);
    }
    // Latente Zustände
    m.wear +=m.wearRate * dtH * (m.status === "PRODUKTION" ? 1 : 0.1) * rng.range(0.7, 1.3);
    m.heater = clamp(m.heater + rng.gauss(0, 0.004) * Math.sqrt(dtSec / 30), 0, 0.7);
    m.leak = clamp(m.leak + rng.gauss(0, 0.002) * Math.sqrt(dtSec / 30), 0, 0.6);
    const drift = this.labelDriftRate.get(m.id) ?? 0;
    if (drift > 0 && m.status === "PRODUKTION") m.labelDrift = Math.min(0.85, m.labelDrift + drift * dtH);

    // Zeitgesteuerte Zustandswechsel
    const timer = this.timers.get(m.id);
    if (timer && this.now >= timer.until) {
      this.timers.delete(m.id);
      if (timer.repairs) {
        if (m.id === "SG-04" && this.scenarios.lager.active) this.stopScenario("lager");
        if (m.id === "SG-02" && this.scenarios.etikett.active) this.stopScenario("etikett");
        m.wear = rng.range(0.04, 0.09);
        m.wearRate = rng.range(0.0003, 0.0008);
        m.labelDrift = 0;
        this.labelDriftRate.delete(m.id);
        this.ewma.delete(m.id);
        m.lastMaintenance = this.now;
      }
      const next = m.queue.length ? timer.next : "STILLSTAND";
      this.setStatus(m, next, next === "STILLSTAND" ? "Kein Auftrag eingeplant" : undefined);
      if (timer.ticketId) {
        const t = this.tickets.find((x) => x.id === timer.ticketId);
        if (t) {
          t.status = "ERLEDIGT";
          this.log("CMMS", "ok", `Wartung ${m.id} abgeschlossen`, `${t.reason} – Maschine wieder in Produktion. Zustand zurückgesetzt.`, { machineId: m.id });
        }
      } else if (timer.repairs) {
        this.log("CMMS", "ok", `Reparatur ${m.id} abgeschlossen`, "Lager getauscht, Probelauf i.O.", { machineId: m.id });
      } else if (next === "PRODUKTION") {
        this.log("MES", "info", `${m.id} wieder in Produktion`, undefined, { machineId: m.id });
      }
    }

    if (m.status === "PRODUKTION") {
      // Ausfall durch Verschleiß
      if (m.wear >= 1) {
        m.failureCount++;
        this.setStatus(m, "STOERUNG", "Lagerschaden Spindel – Notabschaltung (Schwingung über Grenzwert)");
        // liegt das Ersatzteil-Set schon bereit (Maßnahme des KI-Wächters), ist die Reparatur deutlich kürzer
        const spare = this.spares.delete(m.id);
        this.resolveGuard(`ausfall-${m.id}`, true, true);
        const repairH = spare ? rng.range(1.8, 2.4) : rng.range(4.5, 6);
        this.timers.set(m.id, { until: this.now + repairH * H, next: "PRODUKTION", repairs: true });
        this.log("IoT", "crit", `${m.id}: Notabschaltung`, `Schwingung ${m.current.vib.toFixed(2)} mm/s über Schadensgrenze. Ungeplanter Stillstand ca. ${Math.round(repairH)} h.`, { machineId: m.id });
        this.log("CMMS", "warn", `Störungsauftrag ${m.id} angelegt`, spare ? "Instandhaltung alarmiert · Ersatzteil-Set liegt bereit (KI-Wächter) – Reparatur ca. 2 h statt 5 h." : "Instandhaltung alarmiert · Ersatzteil Spindellager angefordert.", { machineId: m.id });
      } else if (rng.chance(0.06 * dtH * ((this.microFixUntil.get(m.id) ?? 0) > this.now ? 0.25 : 1)) && !this.scenarioMachine(m.id)) {
        // Kurze, zufällige Störungen
        const reasons = m.type === "SG"
          ? ["Entnahmeroboter: Teil nicht gegriffen", "Materialförderung unterbrochen", "Etikettenmagazin leer", "Werkzeugtemperierung Alarm"]
          : ["Folienriss am Einzug", "Stapler-Überlauf", "Heizfeld Sensorfehler", "Stanzwerkzeug blockiert"];
        const reason = rng.pick(reasons);
        this.setStatus(m, "STOERUNG", reason);
        this.timers.set(m.id, { until: this.now + rng.range(0.15, 0.6) * H, next: "PRODUKTION" });
        this.log("MES", "warn", `${m.id}: ${reason}`, "Kurzstillstand – Bediener informiert.", { machineId: m.id });
      }
    }

    // Sensorwerte (Zyklus verlängert sich bei Leistungseinbrüchen, z. B. feuchtem Material)
    const running = m.status === "PRODUKTION";
    const v = sensorValues(m.baseline, m, rng);
    const slow = this.ops.slowdown(m, dtSec);
    if (running && slow > 1) v.cycle *= slow;
    const idle = running
      ? v
      : {
          ...v,
          vib: 0.25 + rng.next() * 0.1,
          pressure: 0,
          cycle: 0,
          power: m.baseline.power * (m.status === "RUESTEN" ? 0.3 : 0.12),
          temp1: v.temp1 - (m.status === "WARTUNG" || m.status === "STOERUNG" ? 25 : 0),
        };
    m.current = idle;
    m.live.push({ t: this.now, ...idle });
    if (m.live.length > LIVE_LEN) m.live.shift();

    // Planbelegungszeit (geplante Wartung zählt nicht)
    if (m.status !== "WARTUNG" && !(m.status === "STILLSTAND" && m.queue.length === 0)) m.plannedSecToday += dtSec;
    m.energyKwhToday += (idle.power * dtSec) / 3600;
    this.energySinceMark += (idle.power * dtSec) / 3600;
    this.ops.sample(m, dtSec, idle);

    if (!running) return;
    m.runSecToday += dtSec;

    // Produktion
    const head = m.queue.length ? this.order(m.queue[0]) : undefined;
    if (!head) {
      this.setStatus(m, "STILLSTAND", "Kein Auftrag eingeplant");
      return;
    }
    const p = PRODUCT[head.productId];
    const cycle = Math.max(m.targetCycle * 0.98, v.cycle);
    const pieces = (dtSec / cycle) * m.cavities;
    const scrapRate = this.scrapRate(m, p.iml);
    const scrap = pieces * scrapRate;
    const good = pieces - scrap;
    head.produced = Math.min(head.qty, head.produced + good);
    m.goodToday += good;
    m.scrapToday += scrap;
    this.outputSinceMark += good;
    this.scrapSinceMark += scrap;
    this.distributeDefects(m, scrap, 1);
    this.ops.produce(m, p.id, good, scrap, slow > 1 ? pieces * (slow - 1) : 0);

    // Material
    const kg = (pieces * p.weightG) / 1000;
    this.consume(p.material, kg * 0.98);
    this.consume("M-MB", kg * 0.02);
    if (p.iml) this.consume("M-IML", pieces * 1.005);

    // SPC-Stichprobe (Mittelwert n=5) alle 5 Minuten
    if (this.now >= (this.spcNext.get(m.id) ?? 0)) {
      this.spcNext.set(m.id, this.now + 5 * MIN);
      const sigma = p.spc.tol / 4.6;
      const offset = p.iml ? m.labelDrift : 0;
      const value = p.spc.nominal + offset + rng.gauss(0, sigma / Math.sqrt(1.5));
      // EWMA-Karte (λ = 0,2) erkennt kleine, schleichende Verschiebungen früh
      const ew = 0.2 * value + 0.8 * (this.ewma.get(m.id) ?? p.spc.nominal);
      this.ewma.set(m.id, ew);
      let violation = this.spcRule(m, value, p.spc.nominal, sigma);
      if (!violation && Math.abs(ew - p.spc.nominal) > 3.2 * (sigma / Math.sqrt(1.5)) * Math.sqrt(0.2 / 1.8)) violation = "EWMA";
      m.spc.push({ t: this.now, value, violation });
      if (m.spc.length > SPC_LEN) m.spc.shift();
    }

    // Auftrag fertig?
    if (head.produced >= head.qty) {
      head.status = "QS";
      head.doneAt = this.now;
      m.queue.shift();
      this.log("MES", "ok", `${head.id} fertig produziert`, `${head.qty.toLocaleString("de-DE")} Stk ${p.short} · Übergabe an Qualitätsfreigabe`, { orderId: head.id, machineId: m.id });
      const next = m.queue.length ? this.order(m.queue[0]) : undefined;
      if (next) {
        next.status = "PRODUKTION";
        if (next.productId !== m.productId) {
          m.productId = next.productId;
          m.spc = [];
          this.ewma.delete(m.id);
          this.setStatus(m, "RUESTEN", `Werkzeugwechsel auf ${PRODUCT[next.productId].short}`);
          this.timers.set(m.id, { until: this.now + rng.range(1, 1.8) * H, next: "PRODUKTION" });
        }
      } else {
        this.setStatus(m, "STILLSTAND", "Kein Auftrag eingeplant");
      }
    }
  }

  private scenarioMachine(id: string) {
    return (this.scenarios.lager.active && id === "SG-04") || (this.scenarios.etikett.active && id === "SG-02");
  }

  private scrapRate(m: Machine, iml: boolean) {
    const base = 0.0045 + 0.004 * m.heater + 0.006 * Math.max(0, m.wear - 0.6);
    if (!iml) return base;
    // Anteil der Etiketten außerhalb ±0,4 mm (Normalverteilung um Drift)
    const sigma = 0.4 / 4.6;
    const z = (0.4 - m.labelDrift) / sigma;
    const out = 1 - normCdf(z);
    return base + clamp(out, 0, 0.3);
  }

  private distributeDefects(m: Machine, scrap: number, _w: number) {
    if (scrap <= 0) return;
    const p = PRODUCT[m.productId];
    const weights: Partial<Record<DefectType, number>> =
      m.type === "SG"
        ? { kurzschuss: 0.25, grat: 0.2, etikettenversatz: p.iml ? 0.15 : 0, schwarzpunkt: 0.2, riss: 0.08, verformung: 0.12 }
        : { grat: 0.3, schwarzpunkt: 0.15, riss: 0.25, verformung: 0.3 };
    if (p.iml && m.labelDrift > 0.15) {
      const extra = clamp((m.labelDrift - 0.15) * 8, 0, 6);
      weights.etikettenversatz = (weights.etikettenversatz ?? 0) + extra;
    }
    if (m.wear > 0.6) weights.kurzschuss = (weights.kurzschuss ?? 0) + (m.wear - 0.6) * 2;
    const sum = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0);
    for (const [k, w] of Object.entries(weights)) {
      if (!w) continue;
      m.defects[k as DefectType] += (scrap * w) / sum;
    }
  }

  private spcRule(m: Machine, value: number, nominal: number, sigma: number): string | undefined {
    const ucl = nominal + 3 * sigma;
    const lcl = nominal - 3 * sigma;
    if (value > ucl || value < lcl) return "R1";
    // R2: 9 Punkte auf einer Seite der Mittellinie (mit Mindestverschiebung gegen Fehlalarme)
    const pts = [...m.spc.slice(-8).map((p) => p.value), value];
    const mu = pts.reduce((a, b) => a + b, 0) / pts.length;
    if (pts.length >= 9 && (pts.every((x) => x > nominal) || pts.every((x) => x < nominal)) && Math.abs(mu - nominal) > 1.2 * sigma) return "R2";
    // R3: 7 Punkte stetig steigend/fallend
    const tr = [...m.spc.slice(-6).map((p) => p.value), value];
    if (tr.length === 7 && Math.abs(tr[6] - tr[0]) > 2 * sigma) {
      let inc = true, dec = true;
      for (let i = 1; i < 7; i++) {
        if (tr[i] <= tr[i - 1]) inc = false;
        if (tr[i] >= tr[i - 1]) dec = false;
      }
      if (inc || dec) return "R3";
    }
    return undefined;
  }

  private consume(materialId: string, qty: number) {
    const mat = this.material(materialId);
    if (!mat) return;
    mat.stock = Math.max(0, mat.stock - qty);
    mat.consumedThisHour += qty;
  }

  private tickMaterials(dtH: number) {
    // Stundenverbrauch abschließen
    if (Math.floor(this.now / H) !== Math.floor((this.now - dtH * H) / H)) {
      for (const mat of this.materials) {
        mat.consumption.push(mat.consumedThisHour);
        if (mat.consumption.length > 48) mat.consumption.shift();
        mat.consumedThisHour = 0;
      }
    }
    // Wareneingänge
    for (const ib of this.inbound) {
      if (ib.status === "ANGEKOMMEN") continue;
      if (ib.status === "BESTELLT" && ib.eta - this.now < 10 * H) ib.status = "UNTERWEGS";
      // gebucht wird erst nach der Entladung am Hof
      if (this.now >= ib.eta && this.ops.inboundReleased(ib)) {
        ib.status = "ANGEKOMMEN";
        const mat = this.material(ib.materialId);
        if (mat) {
          mat.stock = Math.min(mat.capacity, mat.stock + ib.qty);
          this.log("WMS", "ok", `Wareneingang ${mat.name}`, `${ib.qty.toLocaleString("de-DE")} ${mat.unit} von ${ib.supplier} eingelagert (${mat.location}).`);
        }
      }
    }
    this.inbound = this.inbound.filter((ib) => ib.status !== "ANGEKOMMEN" || this.now - ib.eta < 6 * H);

    // Automatische Bestellvorschläge (KI-Regel), wenn Reichweite unter Meldebestand fällt
    for (const mat of this.materials) {
      const perH = this.expectedConsumptionPerHour(mat.id);
      if (perH <= 0) continue;
      const pending = this.inbound.filter((i) => i.materialId === mat.id && i.status !== "ANGEKOMMEN").reduce((s, i) => s + i.qty, 0);
      const reachDays = mat.stock / (perH * 24);
      const hasDraft = this.tickets.some((t) => t.kind === "bestellung" && t.materialId === mat.id && (t.status === "ENTWURF" || t.status === "FREIGEGEBEN"));
      const soonInbound = this.inbound.some((i) => i.materialId === mat.id && i.status !== "ANGEKOMMEN" && i.status !== "VERSPAETET" && i.eta - this.now < reachDays * 24 * H);
      if (reachDays < mat.reorderPointDays && !hasDraft && !(pending > 0 && soonInbound)) {
        const qty = Math.round((perH * 24 * 7) / 1000) * 1000;
        this.tickets.unshift({
          id: `T-${this.seq.ticket++}`,
          kind: "bestellung",
          materialId: mat.id,
          qty,
          start: this.now,
          durationH: 24,
          reason: `Reichweite ${mat.name} nur noch ${reachDays.toFixed(1).replace(".", ",")} Tage – Expressbestellung über 7 Tagesbedarfe vorgeschlagen.`,
          createdBy: "KI-Regel",
          createdAt: this.now,
          status: "ENTWURF",
          costEur: Math.round((qty * (mat.unit === "kg" ? 1.42 : 0.0042)) / 10) * 10,
        });
        this.log("KI", "warn", `Bestellvorschlag ${mat.name}`, `Reichweite ${reachDays.toFixed(1).replace(".", ",")} Tage < Meldebestand ${mat.reorderPointDays} Tage. Freigabe im Einkauf erforderlich.`);
      }
    }
  }

  expectedConsumptionPerHour(materialId: string) {
    let s = 0;
    for (const m of this.machines) {
      if (m.status === "STOERUNG" || m.status === "WARTUNG") continue;
      const head = m.queue.length ? this.order(m.queue[0]) : undefined;
      if (!head) continue;
      const p = PRODUCT[head.productId];
      const pcs = this.ratePerHour(m);
      if (p.material === materialId) s += (pcs * p.weightG) / 1000 * 0.98;
      if (materialId === "M-MB") s += (pcs * p.weightG) / 1000 * 0.02;
      if (materialId === "M-IML" && p.iml) s += pcs;
    }
    return s;
  }

  private tickOrders() {
    for (const o of this.orders) {
      if (o.status === "QS" && o.doneAt && this.now - o.doneAt > 0.75 * H) {
        o.status = "VERSANDBEREIT";
        this.log("CAQ", "ok", `${o.id} freigegeben`, "Prüflos i.O. – Ware versandbereit.", { orderId: o.id });
        const sh = this.mkShipment(o, this.now + this.rng.range(1.5, 4) * H);
        this.shipments.push(sh);
        this.ops.onShipment(sh, o);
        this.log("TMS", "info", `Lieferschein ${sh.id} disponiert`, `${sh.carrier} · ${sh.pallets} Paletten · Tor ${sh.dock}`, { orderId: o.id });
      }
    }
    // Alte, versendete Aufträge aufräumen
    this.orders = this.orders.filter((o) => o.status !== "VERSENDET" || !o.doneAt || this.now - o.doneAt < 30 * H);
  }

  private tickShipments() {
    for (const sh of this.shipments) {
      const o = this.order(sh.orderId);
      const c = CUSTOMER[sh.customerId];
      // Beladung und Abfahrt steuert das Yard-Management (LKW-Zeitfenster), sofern ein Fahrzeug avisiert ist
      const yard = (sh.status === "GEPLANT" || sh.status === "BELADUNG") && this.ops.hasVisit(sh.id);
      if (yard) continue;
      if (sh.status === "GEPLANT" && this.now >= sh.slot - 0.6 * H) {
        sh.status = "BELADUNG";
      } else if (sh.status === "BELADUNG" && this.now >= sh.slot) {
        sh.status = "UNTERWEGS";
        sh.departedAt = this.now;
        sh.eta = this.now + (c.km / 65 + 0.4) * H;
        if (o) o.status = "VERSENDET";
        this.log("TMS", "info", `${sh.plate} abgefahren`, `${sh.pallets} Paletten nach ${c.city} · ETA ${new Date(sh.eta).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })}`, { orderId: sh.orderId });
      } else if (sh.status === "UNTERWEGS" && sh.eta && this.now >= sh.eta) {
        sh.status = "ZUGESTELLT";
        sh.onTime = !o || sh.eta <= o.due;
        this.delivered.total++;
        if (sh.onTime) this.delivered.onTime++;
        this.log("TMS", sh.onTime ? "ok" : "warn", `Zugestellt bei ${c.name}`, sh.onTime ? "Pünktlich (POD erhalten)." : "Verspätet zugestellt.", { orderId: sh.orderId });
      }
    }
    this.shipments = this.shipments.filter((s) => s.status !== "ZUGESTELLT" || (s.eta && this.now - s.eta < 8 * H));
  }

  private tickTickets() {
    for (const t of this.tickets) {
      // Maßnahmen des KI-Wächters wirken, sobald sie (freigegeben) umgesetzt sind
      if (t.kind === "massnahme" && t.status === "FREIGEGEBEN" && this.now >= t.start) {
        t.status = "ERLEDIGT";
        const m = t.machineId ? this.findMachine(t.machineId) : undefined;
        if (m) this.applyMeasure(m, t);
        continue;
      }
      if (t.kind === "wartung" && t.status === "FREIGEGEBEN" && t.machineId && this.now >= t.start) {
        const m = this.machine(t.machineId);
        if (m.status === "STOERUNG" && this.timers.get(m.id)?.repairs) {
          t.status = "ERLEDIGT";
          continue;
        }
        t.status = "IN_ARBEIT";
        this.setStatus(m, "WARTUNG", t.reason);
        this.timers.set(m.id, { until: this.now + t.durationH * H, next: "PRODUKTION", repairs: true, ticketId: t.id });
        this.log("CMMS", "info", `Geplante Wartung ${m.id} gestartet`, `${t.reason} · Dauer ${t.durationH.toString().replace(".", ",")} h`, { machineId: m.id });
      }
    }
  }

  private spawnOrder() {
    const p = this.rng.pick(PRODUCTS);
    const cust = this.pickCustomerFor(p.id);
    const qty = Math.round(this.rng.range(80, 420)) * 1000;
    const m = this.bestMachineFor(p.id);
    const finish = this.queueEnd(m) + (qty / this.ratePerHour(m)) * H;
    const due = finish + this.rng.range(20, 60) * H + (cust.km / 65) * H;
    const o = this.mkOrder(cust.id, p.id, qty, due, m.id);
    o.created = this.now;
    this.orders.push(o);
    m.queue.push(o.id);
    if (m.status === "STILLSTAND" && m.queue.length === 1) {
      o.status = "PRODUKTION";
      if (m.productId !== p.id) {
        m.productId = p.id;
        this.setStatus(m, "RUESTEN", `Werkzeugwechsel auf ${p.short}`);
        this.timers.set(m.id, { until: this.now + 1.2 * H, next: "PRODUKTION" });
      } else this.setStatus(m, "PRODUKTION");
    }
    this.log("SAP", "info", `Neuer Kundenauftrag ${o.id}`, `${cust.name} · ${qty.toLocaleString("de-DE")} Stk ${p.short} · eingeplant auf ${m.id}`, { orderId: o.id, machineId: m.id });
  }

  queueEnd(m: Machine) {
    let t = this.now;
    const timer = this.timers.get(m.id);
    if (timer) t = Math.max(t, timer.until);
    for (const id of m.queue) {
      const q = this.order(id);
      if (q) t += (Math.max(0, q.qty - q.produced) / this.ratePerHour(m) + 1.2) * H;
    }
    return t;
  }

  /** Maschinen, die einen Artikel fertigen können – inkl. im Rollout angebundener Maschinen (deren Kapazität ist jetzt planbar) */
  machineIdsFor(productId: string) {
    const extra = this.machines.filter((m) => m.connectedAt && PHASE2_SEED[m.id]?.products.includes(productId)).map((m) => m.id);
    return [...PRODUCT[productId].machines, ...extra];
  }

  bestMachineFor(productId: string) {
    return this.machineIdsFor(productId).map((id) => this.machine(id)).sort((a, b) => this.queueEnd(a) - this.queueEnd(b))[0];
  }

  // ======================= Rollout: Maschine anbinden =======================

  /**
   * Bindet eine Maschine aus Rollout Phase 2 an (Retrofit-Box bzw. OPC UA). Sie hat vorher schon produziert,
   * nur ohne Daten – ab jetzt laufen Status, Sensorik, BDE-Raster und KI-Prognose wie bei den übrigen Linien.
   */
  connectMachine(id: string) {
    this.sync();
    const s = PHASE2_SEED[id.toUpperCase()];
    if (!s) return false;
    if (this.machines.some((m) => m.id === s.id)) return true;
    const rng = this.rng;
    const baseline = nominalBaseline(s.type, rng, s.targetCycle * rng.range(1.03, 1.07));
    const m: Machine = {
      id: s.id,
      type: s.type,
      hall: s.hall,
      maker: s.maker,
      model: s.model,
      year: s.year,
      cavities: s.cavities,
      targetCycle: s.targetCycle,
      costPerHour: s.costPerHour,
      status: "PRODUKTION",
      statusSince: this.now,
      productId: s.productId,
      queue: [],
      wear: s.wear,
      wearRate: rng.range(0.0004, 0.0012),
      heater: rng.range(0.02, 0.1),
      leak: rng.range(0.01, 0.06),
      labelDrift: 0,
      lastMaintenance: this.now - s.wear * rng.range(2400, 3600) * H,
      failureCount: 0,
      goodToday: 0,
      scrapToday: 0,
      runSecToday: 0,
      plannedSecToday: 0,
      energyKwhToday: 0,
      defects: { kurzschuss: 0, grat: 0, etikettenversatz: 0, schwarzpunkt: 0, riss: 0, verformung: 0 },
      live: [],
      hist: [],
      spc: [],
      timeline: [{ t: this.now, status: "PRODUKTION" }],
      current: baseline,
      baseline,
      connectedAt: this.now,
    };
    // erster Messwert direkt nach der Inbetriebnahme – eine Historie gibt es nicht
    const first = { t: this.now, ...sensorValues(baseline, m, rng) };
    m.live.push(first);
    m.hist.push(first);
    m.current = { ...first };

    // laufender Fertigungsauftrag (bisher per Schichtzettel rückgemeldet) + ein Folgeauftrag aus SAP
    let t = this.now;
    for (let k = 0; k < 2; k++) {
      const prodId = k === 0 ? s.productId : rng.pick(s.products);
      const ratePerH = ((3600 * m.cavities) / m.targetCycle) * 0.9;
      const qty = Math.round((ratePerH * rng.range(16, 36)) / 1000) * 1000;
      const produced = k === 0 ? Math.round(qty * rng.range(0.2, 0.7)) : 0;
      t += ((qty - produced) / ratePerH) * H;
      const cust = this.pickCustomerFor(prodId);
      const o = this.mkOrder(cust.id, prodId, qty, t + rng.range(14, 40) * H + (cust.km / 65) * H, m.id, produced);
      o.status = k === 0 ? "PRODUKTION" : "GEPLANT";
      m.queue.push(o.id);
      this.orders.push(o);
    }

    this.machines.push(m);
    this.updatePrediction(m);
    this.ops.attach(m);
    this.log("SAP", "info", `${m.id}: Auftrag ${m.queue[0]} verknüpft`, "Rückmeldung von Gutteilen und Stillständen läuft ab jetzt automatisch statt per Schichtzettel.", { machineId: m.id, orderId: m.queue[0] });
    this.log("IoT", "ok", `${m.id} angebunden`, `${s.link.via} · ${s.link.signals} Signale · Abtastrate 1 s – Maschine ist jetzt live in MES und in der KI.`, { machineId: m.id });
    return true;
  }

  /**
   * Anbindung einer Rollout-Maschine wieder trennen: Die Maschine produziert weiter, die KI sieht sie aber nicht mehr.
   * Offene Aufträge laufen wieder nur auf Papier und verschwinden aus der Planung; Entwürfe für die Maschine werden verworfen.
   */
  disconnectMachine(id: string) {
    this.sync();
    const m = this.findMachine(id);
    if (!m || !m.connectedAt) return false;
    this.orders = this.orders.filter((o) => o.machineId !== m.id || (o.status !== "GEPLANT" && o.status !== "PRODUKTION"));
    for (const t of this.tickets) if ((t.machineId === m.id || t.targetMachineId === m.id) && t.status !== "ERLEDIGT") t.status = "ABGELEHNT";
    for (const map of [this.timers, this.predictions, this.predAt, this.spcNext, this.ewma, this.labelDriftRate, this.alerted, this.microFixUntil]) map.delete(m.id);
    this.spares.delete(m.id);
    this.alerted.delete(`spc:${m.id}`);
    // Befunde der Maschine vergessen (ohne Daten kann der Wächter nichts bewerten)
    for (const map of [this.guardSeen, this.guardLast, this.guardOpen]) for (const k of [...map.keys()]) if (k.endsWith(`-${m.id}`)) map.delete(k);
    this.machines = this.machines.filter((x) => x !== m);
    this.ops.detach(m.id);
    this.log("IoT", "warn", `${m.id} getrennt`, "Datenanschluss deaktiviert – die Maschine produziert weiter, Status und Sensorik sind aber nicht mehr sichtbar.", { machineId: m.id });
    return true;
  }

  // ======================= KI-Prognosen =======================

  private predAt = new Map<string, number>();

  updatePrediction(m: Machine) {
    const win = m.hist.filter((s) => s.t > m.lastMaintenance);
    const hours = (this.now - m.lastMaintenance) / H;
    const usable = win.length >= 4 ? win : m.hist.slice(-4);
    const prevPred = this.predictions.get(m.id);
    const prevT = this.predAt.get(m.id);
    // nach Wartung/Reparatur keine Glättung über den Eingriff hinweg
    const prev = prevPred && prevT && prevT > m.lastMaintenance ? { pred: prevPred, elapsedH: (this.now - prevT) / H } : undefined;
    this.predictions.set(m.id, predictMachine(this.model, m.id, usable as SensorSample[], m.baseline, hours, prev));
    this.predAt.set(m.id, this.now);
  }

  private alerted = new Map<string, number>();

  private checkPredictiveAlerts() {
    for (const m of this.machines) {
      const p = this.predictions.get(m.id);
      if (!p || m.status !== "PRODUKTION") continue;
      const level = p.p72 >= 0.75 ? 2 : p.p72 >= 0.45 ? 1 : 0;
      const prev = this.alerted.get(m.id) ?? 0;
      if (level > prev) {
        const rul = p.rulH !== null ? ` · Restlaufzeit ca. ${Math.max(1, Math.round(p.rulH))} h` : "";
        this.log(
          "KI",
          level === 2 ? "crit" : "warn",
          `${m.id}: Ausfallrisiko ${Math.round(p.p72 * 100)} %${rul}`,
          `Treiber: ${p.drivers.map((d) => `${d.label} ${d.value}`).join(" · ") || "Zustandsverschlechterung"}. Wartung empfohlen.`,
          { machineId: m.id },
        );
      }
      this.alerted.set(m.id, level === 0 && p.p72 < 0.3 ? 0 : Math.max(prev, level));
      if (p.p72 < 0.25) this.alerted.set(m.id, 0);

      const prod = PRODUCT[m.productId];
      const lastSpc = m.spc.slice(-3).find((s) => s.violation);
      const key = `spc:${m.id}`;
      if (lastSpc && !this.alerted.get(key)) {
        this.alerted.set(key, 1);
        this.log("CAQ", "warn", lastSpc.violation === "EWMA" ? `${m.id}: Schleichende Prozessdrift erkannt (EWMA)` : `${m.id}: SPC-Regel ${lastSpc.violation} verletzt`, `${prod.spc.label} driftet (${lastSpc.value.toFixed(2).replace(".", ",")} ${prod.spc.unit}). Prozess prüfen, bevor Ausschuss entsteht.`, { machineId: m.id });
      }
      if (!m.spc.slice(-12).some((s) => s.violation)) this.alerted.set(key, 0);
    }
  }

  /**
   * KI-Wächter: alle Maschinen analysieren; neue Befunde als Frühwarnung melden
   * (Ausfallrisiko meldet bereits die Wartungsprognose, Hinweise der Stufe „info“ nur im Wächter selbst)
   */
  private watch(silent = false) {
    if (this.quiet) return;
    const seen = new Set<string>();
    for (const m of this.machines) {
      for (const f of analyzeMachine(this, m).findings) {
        seen.add(f.id);
        this.guardLast.set(f.id, this.now);
        if (this.guardSeen.has(f.id)) continue;
        this.guardSeen.set(f.id, silent ? this.now - this.rng.range(0.3, 3) * H : this.now);
        // Prognose-Befunde (Ausfall, Qualität) für die Trefferquote nachhalten
        if ((f.kind === "ausfall" || f.kind === "qualitaet") && (f.sev !== "info" || (f.kind === "ausfall" && f.early))) {
          this.guardOpen.set(f.id, this.guardSeen.get(f.id)!);
          if (!silent) this.guardTrust.warnings++;
        }
        if (silent || f.kind === "ausfall" || f.sev === "info") continue;
        const rec = f.actions.find((a) => a.recommended);
        this.log("KI", f.sev, `KI-Wächter · ${m.id}: ${f.title}`, `${f.cause}.${rec ? ` Empfehlung: ${rec.label} (vermeidet ca. ${Math.round(rec.avoidedEur).toLocaleString("de-DE")} €).` : ""}`, { machineId: m.id });
      }
    }
    // erst nach 2 h ohne Befund vergessen (Hysterese gegen wiederholte Meldungen)
    for (const id of [...this.guardSeen.keys()])
      if (!seen.has(id) && this.now - (this.guardLast.get(id) ?? 0) > 2 * H) {
        this.guardSeen.delete(id);
        this.guardLast.delete(id);
        // ohne Maßnahme und ohne Ereignis verschwunden → Fehlalarm
        this.resolveGuard(id, false);
      }
  }

  /** Ausgang einer Prognose verbuchen: bestätigt (Ereignis trat ein bzw. Maßnahme ergriffen) oder Fehlalarm */
  private resolveGuard(id: string, confirmed: boolean, event = false) {
    const since = this.guardOpen.get(id);
    if (since === undefined) return;
    this.guardOpen.delete(id);
    if (!confirmed) {
      this.guardTrust.falseAlarms++;
      return;
    }
    this.guardTrust.confirmed++;
    // Vorwarnzeit: von der ersten Meldung bis zum tatsächlichen Ereignis
    if (event) {
      this.guardTrust.leadH += (this.now - since) / H;
      this.guardTrust.leadN++;
    }
  }

  /** Wirkung einer umgesetzten Maßnahme auf die Maschine */
  private applyMeasure(m: Machine, t: Ticket) {
    const e = t.effect ?? "keine";
    this.measureAt.set(`${m.id}:${e}`, this.now);
    switch (e) {
      case "zyklus":
        this.ops.slow.delete(m.id);
        this.ops.noSlowUntil.set(m.id, this.now + 12 * H);
        m.heater = Math.min(m.heater, 0.03);
        break;
      case "kurzstopps":
        this.microFixUntil.set(m.id, this.now + 24 * H);
        break;
      case "energie":
        m.leak = 0.01;
        m.heater = Math.min(m.heater, 0.03);
        break;
      case "qualitaet":
        m.labelDrift = 0;
        this.labelDriftRate.delete(m.id);
        this.ewma.delete(m.id);
        if (m.id === "SG-02" && this.scenarios.etikett.active) this.stopScenario("etikett");
        break;
      case "ersatzteil":
        this.spares.add(m.id);
        break;
    }
    this.log("CMMS", "ok", `Maßnahme an ${m.id} umgesetzt`, t.reason, { machineId: m.id });
  }

  // ======================= Kennzahlen =======================

  kpiCore() {
    let good = 0, scrap = 0, run = 0, planned = 0, perfW = 0, energy = 0;
    for (const m of this.machines) {
      good += m.goodToday;
      scrap += m.scrapToday;
      run += m.runSecToday;
      planned += m.plannedSecToday;
      energy += m.energyKwhToday;
      perfW += this.performance(m) * m.runSecToday;
    }
    const availability = planned > 0 ? run / planned : 1;
    const performance = run > 0 ? perfW / run : 1;
    const quality = good + scrap > 0 ? good / (good + scrap) : 1;
    return { oee: availability * performance * quality, availability, performance, quality, good, scrap, scrapRate: 1 - quality, energy };
  }

  performance(m: Machine) {
    const recent = m.live.slice(-20).filter((s) => s.cycle > 0);
    const cyc = recent.length ? recent.reduce((a, s) => a + s.cycle, 0) / recent.length : m.targetCycle;
    return clamp(m.targetCycle / cyc, 0.5, 1);
  }

  // ======================= Aktionen =======================

  setSpeed(speed: number) {
    this.sync();
    this.speed = clamp(Math.round(speed), 1, 600);
  }

  setPaused(paused: boolean) {
    this.sync();
    this.paused = paused;
  }

  /** Läuft die Werksuhr synchron zur echten Uhrzeit? */
  isRealtime() {
    return !this.paused && this.speed === 1 && Math.abs(this.now - Date.now()) < 6000;
  }

  /** Werksuhr wieder an die echte Uhrzeit koppeln (nach Zeitraffer, Pause oder Vorspulen) */
  realtime() {
    this.sync();
    this.speed = 1;
    this.paused = false;
    const real = Date.now();
    this.lastReal = real;
    const delta = Math.floor(real / 1000) * 1000 - this.now;
    if (Math.abs(delta) >= 1000) this.shiftTime(delta);
  }

  /** Verschiebt alle Zeitstempel des Werkszustands – Abstände und Reihenfolge bleiben erhalten */
  private shiftTime(delta: number) {
    const isTs = (v: unknown): v is number => typeof v === "number" && v > 1e12 && v < 1e13;
    const walk = (o: unknown): void => {
      if (!o || typeof o !== "object") return;
      if (o instanceof Map) {
        for (const [k, v] of o) {
          if (isTs(v)) o.set(k, v + delta);
          else walk(v);
        }
      } else if (Array.isArray(o)) {
        for (let i = 0; i < o.length; i++) {
          if (isTs(o[i])) o[i] += delta;
          else walk(o[i]);
        }
      } else {
        const r = o as Record<string, unknown>;
        for (const k of Object.keys(r)) {
          const v = r[k];
          if (isTs(v)) r[k] = v + delta;
          else walk(v);
        }
      }
    };
    walk([this.machines, this.orders, this.inbound, this.shipments, this.events, this.tickets, this.inquiries, this.scenarios, this.plantHistory, this.timers, this.spcNext, this.predAt, this.predictions, this.guardSeen, this.guardLast, this.guardOpen, this.measureAt, this.microFixUntil, this.avoided, this.showcase]);
    const hoursBefore = (this.now - this.dayStart) / H;
    this.now += delta;
    this.nextHistAt += delta;
    this.nextPlantHistAt += delta;
    this.nextOrderAt += delta;
    this.lastHourMark += delta;
    // Tageszähler auf die neue Uhrzeit skalieren (Quoten wie OEE und Ausschuss bleiben gleich)
    this.dayStart = productionDayStart(this.now);
    const f = (this.now - this.dayStart) / H / Math.max(0.05, hoursBefore);
    for (const m of this.machines) {
      m.goodToday *= f;
      m.scrapToday *= f;
      m.runSecToday *= f;
      m.plannedSecToday *= f;
      m.energyKwhToday *= f;
      for (const k of DEFECT_KEYS) m.defects[k] *= f;
      const before = m.timeline.filter((e) => e.t <= this.dayStart).pop();
      m.timeline = [{ t: this.dayStart, status: before?.status ?? m.status }, ...m.timeline.filter((e) => e.t > this.dayStart)];
    }
    this.ops.shift(delta, walk, f);
  }

  startScenario(id: ScenarioId) {
    this.sync();
    const sc = this.scenarios[id];
    if (sc.active) return;
    sc.active = true;
    sc.startedAt = this.now;
    switch (id) {
      case "lager": {
        const m = this.machine("SG-04");
        m.wear = Math.max(m.wear, 0.44);
        m.wearRate = 0.012;
        break;
      }
      case "etikett": {
        this.labelDriftRate.set("SG-02", 0.32);
        break;
      }
      case "eilauftrag": {
        const inq: Inquiry = {
          id: `AN-${this.seq.inquiry++}`,
          customerId: "K-1001",
          productId: "P-IML500",
          qty: 280_000,
          due: atDayHour(this.now, 5, 6),
          created: this.now,
          status: "OFFEN",
          note: "Aktionsware Sommer-Joghurt – Liefertermin fix, Folgeaufträge 2,1 Mio. Stk/Jahr in Aussicht.",
        };
        this.inquiries.unshift(inq);
        this.log("CRM", "warn", "Eilanfrage Alpenmilch eG", "280.000 IML-Becher 500 ml · Liefertermin in 5 Tagen (06:00) · Antwort an Kunden erwartet.");
        break;
      }
      case "granulat": {
        const ib = this.inbound.find((i) => i.materialId === "M-PPR" && i.status !== "ANGEKOMMEN");
        if (ib) {
          ib.status = "VERSPAETET";
          ib.delayedH = 48;
          ib.eta += 48 * H;
        }
        const mat = this.material("M-PPR")!;
        const perH = this.expectedConsumptionPerHour("M-PPR");
        mat.stock = Math.min(mat.stock, perH * 24 * 1.25);
        this.log("TMS", "warn", "Lieferavis: Verspätung PP-Random-Copolymer", "Nordsee Polymers meldet 48 h Verzug (Produktionsstörung beim Lieferanten).");
        break;
      }
    }
  }

  stopScenario(id: ScenarioId) {
    const sc = this.scenarios[id];
    sc.active = false;
    sc.startedAt = undefined;
    if (id === "etikett") this.labelDriftRate.delete("SG-02");
    if (id === "lager") {
      const m = this.machine("SG-04");
      m.wearRate = 0.0006;
    }
  }

  createTicket(t: Omit<Ticket, "id" | "createdAt" | "status">) {
    this.sync();
    const ticket: Ticket = { ...t, id: `T-${this.seq.ticket++}`, createdAt: this.now, status: "ENTWURF" };
    this.tickets.unshift(ticket);
    return ticket;
  }

  decideTicket(id: string, approve: boolean) {
    this.sync();
    const t = this.tickets.find((x) => x.id === id);
    if (!t || t.status !== "ENTWURF") return t;
    if (!approve) {
      t.status = "ABGELEHNT";
      this.log("KI", "info", `Vorschlag ${t.id} abgelehnt`, t.reason);
      return t;
    }
    t.status = "FREIGEGEBEN";
    // Vorschlag freigegeben → erwarteter vermiedener Verlust zählt für den KI-Wächter
    if (t.savingEur && t.savingEur > 0) this.avoided.push({ t: this.now, machineId: t.machineId, eur: t.savingEur, text: t.reason });
    // Maßnahme ergriffen → die zugehörige Prognose gilt als bestätigt
    if (t.source) this.resolveGuard(t.source, true);
    if (t.machineId && t.kind === "wartung") this.resolveGuard(`ausfall-${t.machineId}`, true);
    if (t.machineId && (t.kind === "qs-sperre" || t.effect === "qualitaet")) this.resolveGuard(`qualitaet-${t.machineId}`, true);
    switch (t.kind) {
      case "massnahme":
        this.log("CMMS", "info", `Maßnahme ${t.id} freigegeben`, `${t.machineId} · Umsetzung ${new Date(t.start).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })} · ${t.reason}`, { machineId: t.machineId });
        break;
      case "wartung":
        this.log("CMMS", "ok", `Wartungsauftrag ${t.id} freigegeben`, `${t.machineId} · Start ${new Date(t.start).toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })} · ${t.reason}`, { machineId: t.machineId });
        break;
      case "umplanung": {
        const o = t.orderId ? this.order(t.orderId) : undefined;
        if (o && t.targetMachineId) this.moveOrder(o, t.targetMachineId);
        t.status = "ERLEDIGT";
        break;
      }
      case "bestellung": {
        const mat = t.materialId ? this.material(t.materialId) : undefined;
        if (mat && t.qty) {
          const ib = this.mkInbound(mat.id, t.qty, this.now + 20 * H, mat.id === "M-PPR" ? "Polymer Trade Benelux (Express)" : `${mat.supplier} (Express)`);
          ib.status = "UNTERWEGS";
          this.inbound.push(ib);
          this.ops.onInbound(ib);
          this.log("SAP", "ok", `Bestellung ${ib.id} ausgelöst`, `${t.qty.toLocaleString("de-DE")} ${mat.unit} ${mat.name} · ETA 20 h`);
        }
        t.status = "ERLEDIGT";
        break;
      }
      case "qs-sperre": {
        this.log("CAQ", "warn", `Charge gesperrt (${t.machineId})`, t.reason, { machineId: t.machineId });
        const m = t.machineId ? this.findMachine(t.machineId) : undefined;
        if (m) {
          this.setStatus(m, "STOERUNG", "QS-Sperre: Greifer/Vakuum prüfen");
          this.timers.set(m.id, { until: this.now + 0.75 * H, next: "PRODUKTION", repairs: true });
        }
        t.status = "ERLEDIGT";
        break;
      }
    }
    return t;
  }

  moveOrder(o: Order, targetId: string) {
    const from = this.machine(o.machineId);
    const to = this.machine(targetId);
    if (from.id === to.id) return;
    const wasHead = from.queue[0] === o.id;
    from.queue = from.queue.filter((x) => x !== o.id);
    // hinter den laufenden Auftrag einplanen
    to.queue.splice(Math.min(1, to.queue.length), 0, o.id);
    o.machineId = to.id;
    o.status = to.queue[0] === o.id ? "PRODUKTION" : "GEPLANT";
    if (wasHead) {
      const next = from.queue.length ? this.order(from.queue[0]) : undefined;
      if (next) next.status = "PRODUKTION";
      else if (from.status === "PRODUKTION") this.setStatus(from, "STILLSTAND", "Kein Auftrag eingeplant");
    }
    this.log("MES", "ok", `${o.id} umgeplant`, `${from.id} → ${to.id} (nach laufendem Auftrag)`, { orderId: o.id, machineId: to.id });
  }

  confirmInquiry(id: string, machinePlan: { machineId: string; qty: number }[]) {
    const inq = this.inquiries.find((i) => i.id === id);
    if (!inq || inq.status !== "OFFEN") return;
    inq.status = "BESTAETIGT";
    for (const part of machinePlan) {
      // Maschine inzwischen nicht mehr angebunden (Rollout-Demo) → Teilmenge entfällt
      if (!this.findMachine(part.machineId)) continue;
      const o = this.mkOrder(inq.customerId, inq.productId, part.qty, inq.due, part.machineId);
      o.priority = "hoch";
      o.created = this.now;
      this.orders.push(o);
      const m = this.machine(part.machineId);
      m.queue.splice(Math.min(1, m.queue.length), 0, o.id);
      this.log("SAP", "ok", `Auftrag ${o.id} angelegt (Eilauftrag)`, `${part.qty.toLocaleString("de-DE")} Stk auf ${m.id} · Priorität hoch`, { orderId: o.id, machineId: m.id });
    }
  }
}

function normCdf(z: number) {
  // Abramowitz-Stegun-Näherung
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// ======================= Singleton =======================

const g = globalThis as unknown as { __kiWerkPlant?: Plant; __kiWerkModel?: PmModel; __kiWerkRev?: number };
// Bei Änderungen an Simulation/Modell hochzählen – erzwingt Neuaufbau im Dev-Server
const REV = 7;

function model() {
  if (!g.__kiWerkModel || g.__kiWerkRev !== REV) {
    g.__kiWerkModel = new PmModel().train();
    g.__kiWerkPlant = undefined;
    g.__kiWerkRev = REV;
  }
  return g.__kiWerkModel;
}

export function getPlant(): Plant {
  const mdl = model();
  if (!g.__kiWerkPlant) g.__kiWerkPlant = new Plant(42, mdl);
  g.__kiWerkPlant.sync();
  return g.__kiWerkPlant;
}

/** Neues Werk ab der echten Uhrzeit – Uhr läuft wieder in Echtzeit */
export function resetPlant(): Plant {
  g.__kiWerkPlant = new Plant(42, model());
  return g.__kiWerkPlant;
}

export { SENSOR_DEFS };