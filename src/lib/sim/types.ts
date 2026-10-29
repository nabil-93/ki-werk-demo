// Gemeinsame Typen für Simulation, API und Oberfläche

export type MachineType = "SG" | "TF"; // Spritzgießen (IML) | Thermoformen
export type MachineStatus = "PRODUKTION" | "RUESTEN" | "STOERUNG" | "WARTUNG" | "STILLSTAND";
export type Severity = "ok" | "info" | "warn" | "crit";
export type SourceSystem = "MES" | "IoT" | "SAP" | "CAQ" | "WMS" | "TMS" | "CMMS" | "KI" | "CRM";
export type Hall = "A" | "B";

export type SensorKey = "vib" | "temp1" | "temp2" | "oil" | "pressure" | "cycle" | "power";

export interface SensorDef {
  key: SensorKey;
  label: string;
  short: string;
  unit: string;
  nominal: number;
  warn: number;
  crit: number;
  /** true = höher ist schlechter, false = Abweichung in beide Richtungen */
  upperOnly: boolean;
  digits: number;
}

export type SensorValues = Record<SensorKey, number>;

export interface SensorSample extends SensorValues {
  t: number;
}

export interface Product {
  id: string;
  name: string;
  short: string;
  type: MachineType;
  weightG: number;
  material: string; // Material-ID
  iml: boolean;
  pricePer1000: number;
  piecesPerPallet: number;
  machines: string[]; // kompatible Maschinen
  spc: { label: string; unit: string; nominal: number; tol: number };
}

export interface Customer {
  id: string;
  name: string;
  city: string;
  country: string;
  km: number;
  lat: number;
  lon: number;
  segment: string;
}

export type OrderStatus = "GEPLANT" | "PRODUKTION" | "QS" | "VERSANDBEREIT" | "VERSENDET";

export interface Order {
  id: string;
  customerId: string;
  productId: string;
  qty: number;
  produced: number;
  due: number; // Sim-Zeit (ms)
  created: number;
  machineId: string;
  status: OrderStatus;
  valueEur: number;
  priority: "normal" | "hoch";
  doneAt?: number;
  shipmentId?: string;
}

export interface Machine {
  id: string;
  type: MachineType;
  hall: Hall;
  maker: string;
  model: string;
  year: number;
  cavities: number;
  targetCycle: number; // s
  costPerHour: number; // Deckungsbeitrag/Stillstandskosten €/h
  status: MachineStatus;
  statusSince: number;
  statusReason?: string;
  productId: string;
  queue: string[]; // Auftrags-IDs, Kopf = in Produktion
  // latente Zustände (in der Realität unbekannt – nur Simulation)
  wear: number;
  wearRate: number; // pro Stunde
  heater: number;
  leak: number;
  labelDrift: number; // mm Versatz IML
  lastMaintenance: number;
  failureCount: number;
  // Zähler
  goodToday: number;
  scrapToday: number;
  runSecToday: number;
  plannedSecToday: number;
  energyKwhToday: number;
  defects: Record<DefectType, number>;
  // Historie
  live: SensorSample[]; // pro Tick
  hist: SensorSample[]; // 5-Minuten-Raster
  spc: SpcPoint[];
  timeline: { t: number; status: MachineStatus }[];
  current: SensorValues;
  baseline: SensorValues;
  /** Rollout Phase 2: Zeitpunkt der Anbindung – davor liegen keine Daten vor */
  connectedAt?: number;
}

export type DefectType = "kurzschuss" | "grat" | "etikettenversatz" | "schwarzpunkt" | "riss" | "verformung";

export interface SpcPoint {
  t: number;
  value: number;
  violation?: string;
}

export interface Material {
  id: string;
  name: string;
  unit: "kg" | "Stk";
  stock: number;
  capacity: number;
  location: string;
  reorderPointDays: number;
  supplier: string;
  consumption: number[]; // Verbrauch je Sim-Stunde (gleitend)
  consumedThisHour: number;
}

export interface Inbound {
  id: string;
  materialId: string;
  qty: number;
  eta: number;
  supplier: string;
  status: "BESTELLT" | "UNTERWEGS" | "VERSPAETET" | "ANGEKOMMEN";
  delayedH?: number;
}

export type ShipmentStatus = "GEPLANT" | "BELADUNG" | "UNTERWEGS" | "ZUGESTELLT";

export interface Shipment {
  id: string;
  orderId: string;
  customerId: string;
  carrier: string;
  plate: string;
  pallets: number;
  dock: number;
  slot: number; // geplante Abfahrt
  departedAt?: number;
  eta?: number;
  status: ShipmentStatus;
  onTime?: boolean;
}

export interface PlantEvent {
  id: number;
  t: number;
  source: SourceSystem;
  severity: Severity;
  title: string;
  detail?: string;
  machineId?: string;
  orderId?: string;
}

export type TicketStatus = "ENTWURF" | "FREIGEGEBEN" | "IN_ARBEIT" | "ERLEDIGT" | "ABGELEHNT";

/** Wirkung einer Maßnahme des KI-Wächters, sobald sie umgesetzt ist */
export type MeasureEffect = "zyklus" | "kurzstopps" | "energie" | "qualitaet" | "ersatzteil" | "keine";

export interface Ticket {
  id: string;
  kind: "wartung" | "umplanung" | "bestellung" | "qs-sperre" | "massnahme";
  machineId?: string;
  orderId?: string;
  targetMachineId?: string;
  materialId?: string;
  qty?: number;
  start: number;
  durationH: number;
  reason: string;
  createdBy: "KI-Werksexperte" | "Nutzer" | "KI-Regel" | "KI-Wächter";
  createdAt: number;
  status: TicketStatus;
  costEur?: number;
  savingEur?: number;
  effect?: MeasureEffect;
  /** Befund des KI-Wächters, aus dem der Entwurf entstanden ist */
  source?: string;
}

export interface ScenarioState {
  id: ScenarioId;
  active: boolean;
  startedAt?: number;
}

export type ScenarioId = "lager" | "etikett" | "eilauftrag" | "granulat";

export interface Inquiry {
  id: string;
  customerId: string;
  productId: string;
  qty: number;
  due: number;
  created: number;
  status: "OFFEN" | "BESTAETIGT" | "ABGELEHNT";
  note: string;
}

// ---------- Abgeleitete Sichten (an den Client) ----------

export interface Prediction {
  machineId: string;
  p72: number; // Ausfallwahrscheinlichkeit 72 h
  health: number; // 0..100
  rulH: number | null; // Restlebensdauer in h (null = > 30 Tage)
  zone: "A" | "B" | "C" | "D";
  drivers: { label: string; value: string; impact: number }[];
  features: Record<string, number>;
}

export interface MachineView {
  id: string;
  type: MachineType;
  hall: Hall;
  maker: string;
  model: string;
  year: number;
  cavities: number;
  targetCycle: number;
  status: MachineStatus;
  statusSince: number;
  statusReason?: string;
  product: { id: string; name: string; short: string };
  orderId?: string;
  orderProgress?: number;
  outputPerHour: number;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  goodToday: number;
  scrapToday: number;
  scrapRate: number;
  energyKwhToday: number;
  current: SensorValues;
  spark: number[]; // Vibration (live)
  prediction: Prediction;
  defects: Record<DefectType, number>;
  spcViolation?: string;
  cpk: number;
  /** nur bei im Rollout neu angebundenen Maschinen: seit wann Daten vorliegen */
  connectedAt?: number;
}

export interface OrderView extends Order {
  customer: string;
  city: string;
  product: string;
  productShort: string;
  progress: number;
  projectedDone: number;
  onTimeProb: number;
  risk: "ok" | "beobachten" | "gefaehrdet";
  riskReason?: string;
}

export interface MaterialView extends Material {
  reachDays: number;
  avgPerHour: number;
  inbound: Inbound[];
  state: Severity;
}

export interface ShipmentView extends Shipment {
  customer: string;
  city: string;
  country: string;
  km: number;
  lat: number;
  lon: number;
  progress: number;
}

export interface Kpis {
  oee: number;
  outputToday: number;
  scrapRate: number;
  onTimeDelivery: number;
  backlogEur: number;
  energyKwhToday: number;
  co2kgToday: number;
  machinesRunning: number;
  machinesTotal: number;
  openAlerts: number;
  ordersAtRisk: number;
  warehouseUsed: number;
  warehouseCapacity: number;
}

export interface Alert {
  id: string;
  severity: Severity;
  source: SourceSystem;
  title: string;
  detail: string;
  machineId?: string;
  orderId?: string;
  materialId?: string;
  href: string;
}

export interface ConnectorView {
  id: string;
  name: string;
  system: string;
  protocol: string;
  domain: string;
  status: "online" | "verzoegert" | "offline";
  recordsPerMin: number;
  latencyMs: number;
  lastSync: number;
  totalToday: number;
  quality: number;
}

// ---------- Betriebsdaten: Maschinenverlauf, Fertigwarenlager, LKW-Hof, Finanzen ----------

/** 15-Minuten-Raster je Maschine (BDE): Stückzahlen, Zeiten, Temperaturen */
export interface MachineBucket {
  t: number;
  /** im Intervall gefertigter Artikel (für Chargen-Rückverfolgung) */
  productId?: string;
  good: number;
  scrap: number;
  /** Soll-Gutteile bei Sollzyklus und voller Laufzeit */
  target: number;
  runSec: number;
  /** Zeit je Nicht-Produktionsstatus */
  stopSec: Partial<Record<MachineStatus, number>>;
  /** davon Leistungsverlust durch langsamen Zyklus (Stück) */
  slowLoss: number;
  energy: number;
  // Summen der Messwerte (Mittelwert = Summe / n; Zyklus und Schwingung nur im Lauf: / nRun)
  n: number;
  nRun: number;
  temp1: number;
  temp1Max: number;
  temp2: number;
  oil: number;
  vib: number;
  cycle: number;
  /** Stillstandskosten + Ausschusswert in € */
  lossEur: number;
  reason?: string;
}

export interface BucketView {
  t: number;
  good: number;
  scrap: number;
  target: number;
  /** Ist / Soll */
  ratio: number;
  runMin: number;
  stopMin: number;
  stoerMin: number;
  ruestMin: number;
  wartMin: number;
  energy: number;
  temp1: number | null;
  temp1Max: number | null;
  temp2: number | null;
  oil: number | null;
  vib: number | null;
  cycle: number | null;
  lossEur: number;
  reason?: string;
  sev: "ok" | "warn" | "crit" | "idle";
  open?: boolean;
}

/** Tagesabschluss je Maschine */
export interface MachineDay {
  day: number;
  good: number;
  scrap: number;
  target: number;
  runH: number;
  plannedH: number;
  stoerH: number;
  ruestH: number;
  wartH: number;
  stops: number;
  oee: number;
  energy: number;
  lossEur: number;
  temp1Max: number;
  topReason?: string;
}

/** Stillstand (Störung, Rüsten, Wartung, Stillstand) mit Kosten */
export interface StopRecord {
  id: number;
  machineId: string;
  status: MachineStatus;
  reason: string;
  start: number;
  end?: number;
  lossEur: number;
}

export interface ProductStock {
  productId: string;
  pieces: number;
  location: string;
  minPallets: number;
  /** stündlicher Verlauf (7 Tage) */
  history: { t: number; pieces: number }[];
  inToday: number;
  outToday: number;
}

export interface StockView {
  productId: string;
  name: string;
  short: string;
  type: MachineType;
  material: string;
  iml: boolean;
  weightG: number;
  piecesPerPallet: number;
  pricePer1000: number;
  location: string;
  pieces: number;
  pallets: number;
  reserved: number;
  free: number;
  minPallets: number;
  valueEur: number;
  /** Tage, die der freie Bestand bei Ø-Abruf reicht */
  reachDays: number;
  inToday: number;
  outToday: number;
  producingOn: string[];
  nextPickup?: { visitId: string; t: number; qty: number; partner: string };
  state: Severity;
  history: { t: number; pieces: number }[];
}

export type VisitKind = "abholung" | "anlieferung" | "entsorgung";
export type VisitStatus = "ERWARTET" | "AM_TOR" | "WARTET" | "RAMPE" | "ABGEFAHREN";

export interface Party {
  name: string;
  city: string;
  country: string;
}

/** LKW-Zeitfenster (Yard-Management): ein Besuch eines Fahrzeugs im Werk */
export interface TruckVisit {
  id: string;
  kind: VisitKind;
  carrier: string;
  plate: string;
  trailer: string;
  driver: string;
  phone: string;
  vehicle: string;
  partner: string;
  from: Party;
  to: Party;
  km: number;
  cargo: string;
  productId?: string;
  materialId?: string;
  qty: number;
  unit: string;
  pallets: number;
  weightKg: number;
  orderId?: string;
  shipmentId?: string;
  inboundId?: string;
  dock: number;
  slotStart: number;
  slotEnd: number;
  plannedDepart: number;
  /** geplante Standzeit im Werk (min) */
  dwellMin: number;
  /** Lade-/Entladedauer (min) */
  handleMin: number;
  /** tatsächliche (bzw. per Telematik erwartete) Ankunft */
  arriveAt: number;
  arrivedAt?: number;
  dockAt?: number;
  doneAt?: number;
  departedAt?: number;
  status: VisitStatus;
  ref: string;
  /** nur Prognose (aus offenem Auftrag), noch kein avisiertes Fahrzeug */
  forecast?: boolean;
  /** Dauer der Anmeldung beim Pförtner (min, Standard 4) */
  gateMin?: number;
}

export interface VisitView extends TruckVisit {
  /** Ankunft nach Zeitfensterende (min); bei noch nicht angekommenen: überfällig bzw. erwartete Verspätung */
  lateMin: number;
  onSiteMin: number;
  /** Standzeit über Plan (min) */
  overstayMin: number;
  /** Ausfahrt später als geplant (min; bei noch nicht abgefahrenen: bereits überfällig) */
  departLateMin: number;
  state: Severity;
  stateText: string;
  etaKnown: boolean;
  /** Ankunft beim Kunden (Abholung) */
  customerEta?: number;
  customerDue?: number;
}

export interface YardDay {
  day: number;
  abholung: number;
  anlieferung: number;
  entsorgung: number;
  late: number;
  overstay: number;
  avgDwellMin: number;
  pallets: number;
}

export interface FinanceDay {
  day: number;
  revenue: number;
  material: number;
  energy: number;
  freight: number;
  personnel: number;
  overhead: number;
  lossDowntime: number;
  lossScrap: number;
  pieces: number;
  byCustomer: Record<string, { revenue: number; pieces: number; cost: number }>;
  byProduct: Record<string, { revenue: number; pieces: number; cost: number }>;
}

export interface YardSummary {
  onSite: number;
  expectedToday: number;
  doneToday: number;
  late: number;
  overstay: number;
}

export interface Snapshot {
  now: number;
  speed: number;
  /** Werksuhr synchron zur echten Uhrzeit */
  realtime: boolean;
  shift: { name: string; start: number; end: number };
  kpis: Kpis;
  machines: MachineView[];
  orders: OrderView[];
  materials: MaterialView[];
  shipments: ShipmentView[];
  events: PlantEvent[];
  alerts: Alert[];
  tickets: Ticket[];
  scenarios: ScenarioState[];
  inquiries: Inquiry[];
  connectors: ConnectorView[];
  history: { t: number; oee: number; output: number; scrap: number; energy: number }[];
  /** LKW auf dem Hof und in den nächsten Stunden */
  visits: VisitView[];
  yard: YardSummary;
  stock: StockView[];
  finance: { revenueToday: number; marginToday: number; lossToday: number; resultToday: number };
  /** Live-Demo „Alle Fälle“: läuft der Regisseur, und welche Fälle sind gerade zu sehen? */
  showcase: { active: boolean; since?: number; cases: { key: string; label: string; area: string; on: boolean; href: string }[] };
  /** KI-Wächter: wichtigste Befunde – dieselben Zahlen wie in der Rubrik Maschinengesundheit */
  guard: {
    findings: { id: string; machineId: string; kind: string; sev: "crit" | "warn" | "info"; early: boolean; title: string; cause: string; horizon: string; lossEur72: number; action?: string; avoidedEur?: number }[];
    lossEur72: number;
    lossWithActionsEur72: number;
    avoidedTodayEur: number;
  };
}
