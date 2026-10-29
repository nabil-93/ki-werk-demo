// Stammdaten des simulierten Werks Nord.
// Maschinen- und Produktdaten sind realistisch angelehnt, aber frei erfunden.
// Kundennamen, Spediteure und Lieferanten sind fiktiv.

import type { Customer, DefectType, MachineType, Product, SensorDef, SensorKey } from "./types";

export const PLANT = {
  name: "Werk Nord",
  code: "WN-01",
  company: "Unternehmen",
  region: "Deutschland",
  lat: 51.3,
  lon: 9.5,
};

export const SENSOR_DEFS: Record<MachineType, SensorDef[]> = {
  SG: [
    { key: "vib", label: "Schwingung Spindellager (RMS)", short: "Schwingung", unit: "mm/s", nominal: 1.6, warn: 2.8, crit: 4.5, upperOnly: true, digits: 2 },
    { key: "temp1", label: "Massetemperatur", short: "Masse", unit: "°C", nominal: 238, warn: 246, crit: 252, upperOnly: false, digits: 1 },
    { key: "temp2", label: "Werkzeugtemperatur", short: "Werkzeug", unit: "°C", nominal: 24, warn: 30, crit: 35, upperOnly: false, digits: 1 },
    { key: "oil", label: "Hydrauliköl / Lagertemperatur", short: "Öl/Lager", unit: "°C", nominal: 43, warn: 50, crit: 56, upperOnly: true, digits: 1 },
    { key: "pressure", label: "Einspritzdruck", short: "Druck", unit: "bar", nominal: 1480, warn: 1600, crit: 1700, upperOnly: false, digits: 0 },
    { key: "cycle", label: "Zykluszeit", short: "Zyklus", unit: "s", nominal: 4.2, warn: 4.5, crit: 4.9, upperOnly: true, digits: 2 },
    { key: "power", label: "Leistungsaufnahme", short: "Leistung", unit: "kW", nominal: 96, warn: 112, crit: 125, upperOnly: true, digits: 1 },
  ],
  TF: [
    { key: "vib", label: "Schwingung Stanzantrieb (RMS)", short: "Schwingung", unit: "mm/s", nominal: 1.9, warn: 2.8, crit: 4.5, upperOnly: true, digits: 2 },
    { key: "temp1", label: "Heizfeld-Temperatur", short: "Heizfeld", unit: "°C", nominal: 148, warn: 156, crit: 162, upperOnly: false, digits: 1 },
    { key: "temp2", label: "Formwerkzeug-Temperatur", short: "Werkzeug", unit: "°C", nominal: 32, warn: 38, crit: 42, upperOnly: false, digits: 1 },
    { key: "oil", label: "Getriebeöl-Temperatur", short: "Getriebe", unit: "°C", nominal: 47, warn: 55, crit: 60, upperOnly: true, digits: 1 },
    { key: "pressure", label: "Formluftdruck", short: "Formluft", unit: "bar", nominal: 6.2, warn: 6.8, crit: 7.2, upperOnly: false, digits: 2 },
    { key: "cycle", label: "Taktzeit", short: "Takt", unit: "s", nominal: 2.4, warn: 2.6, crit: 2.85, upperOnly: true, digits: 2 },
    { key: "power", label: "Leistungsaufnahme", short: "Leistung", unit: "kW", nominal: 138, warn: 158, crit: 172, upperOnly: true, digits: 1 },
  ],
};

export function sensorDef(type: MachineType, key: SensorKey): SensorDef {
  return SENSOR_DEFS[type].find((s) => s.key === key)!;
}

export interface MachineSeed {
  id: string;
  type: MachineType;
  hall: "A" | "B";
  maker: string;
  model: string;
  year: number;
  cavities: number;
  targetCycle: number;
  costPerHour: number;
  productId: string;
  wear: number;
}

export const MACHINE_SEEDS: MachineSeed[] = [
  { id: "SG-01", type: "SG", hall: "A", maker: "ENGEL", model: "e-speed 420", year: 2019, cavities: 4, targetCycle: 4.4, costPerHour: 1650, productId: "P-IML500", wear: 0.22 },
  { id: "SG-02", type: "SG", hall: "A", maker: "ENGEL", model: "e-speed 420", year: 2021, cavities: 4, targetCycle: 4.4, costPerHour: 1650, productId: "P-IML500", wear: 0.12 },
  { id: "SG-03", type: "SG", hall: "A", maker: "Netstal", model: "ELION 3200", year: 2018, cavities: 8, targetCycle: 3.6, costPerHour: 1420, productId: "P-DK95", wear: 0.31 },
  { id: "SG-04", type: "SG", hall: "A", maker: "Netstal", model: "ELION 3200", year: 2017, cavities: 6, targetCycle: 3.9, costPerHour: 1580, productId: "P-IML250", wear: 0.38 },
  { id: "SG-05", type: "SG", hall: "A", maker: "Arburg", model: "ALLROUNDER 720 H", year: 2020, cavities: 2, targetCycle: 6.8, costPerHour: 1380, productId: "P-EIS1000", wear: 0.18 },
  { id: "SG-06", type: "SG", hall: "A", maker: "Netstal", model: "ELION 2800", year: 2022, cavities: 12, targetCycle: 3.2, costPerHour: 1290, productId: "P-DK75", wear: 0.09 },
  { id: "SG-07", type: "SG", hall: "A", maker: "ENGEL", model: "e-motion 310", year: 2020, cavities: 8, targetCycle: 3.8, costPerHour: 1460, productId: "P-DES125", wear: 0.27 },
  { id: "SG-08", type: "SG", hall: "A", maker: "ENGEL", model: "e-motion 310", year: 2023, cavities: 8, targetCycle: 3.8, costPerHour: 1460, productId: "P-DES125", wear: 0.06 },
  { id: "TF-01", type: "TF", hall: "B", maker: "KIEFEL", model: "KMD 78 Speed", year: 2019, cavities: 24, targetCycle: 2.4, costPerHour: 1720, productId: "P-JOG150", wear: 0.24 },
  { id: "TF-02", type: "TF", hall: "B", maker: "KIEFEL", model: "KMD 78 Speed", year: 2021, cavities: 24, targetCycle: 2.4, costPerHour: 1720, productId: "P-JOG150", wear: 0.15 },
  { id: "TF-03", type: "TF", hall: "B", maker: "ILLIG", model: "RDKP 72g", year: 2016, cavities: 12, targetCycle: 2.6, costPerHour: 1540, productId: "P-FK200", wear: 0.33 },
  { id: "TF-04", type: "TF", hall: "B", maker: "ILLIG", model: "RDKP 72g", year: 2022, cavities: 10, targetCycle: 2.7, costPerHour: 1540, productId: "P-SAL375", wear: 0.11 },
];

/** Weitere Spritzgießmaschinen in Halle A: produzieren, sind aber noch nicht angebunden (Rollout Phase 2) */
export interface Phase2Seed extends MachineSeed {
  /** Artikel, die auf der Maschine laufen können */
  products: string[];
  /** Weg der Anbindung (ältere Steuerungen ohne OPC UA brauchen eine Nachrüstung) */
  link: { via: string; detail: string; signals: number; costEur: number; days: number };
}

export const PHASE2_SEEDS: Phase2Seed[] = [
  { id: "SG-09", type: "SG", hall: "A", maker: "ENGEL", model: "victory 200", year: 2012, cavities: 8, targetCycle: 4.0, costPerHour: 1180, productId: "P-DK95", wear: 0.34, products: ["P-DK95", "P-DK75"], link: { via: "Retrofit-Box", detail: "Steuerung ohne OPC UA: IoT-Gateway mit Schwingungssensor, Stromzähler und Zyklussignal nachrüsten", signals: 6, costEur: 2400, days: 1 } },
  { id: "SG-10", type: "SG", hall: "A", maker: "Netstal", model: "SYNERGY 2400", year: 2010, cavities: 12, targetCycle: 3.4, costPerHour: 1120, productId: "P-DK75", wear: 0.41, products: ["P-DK75", "P-DK95"], link: { via: "Retrofit-Box", detail: "Ältere Steuerung: Sensorik nachrüsten (Schwingung, Temperatur, Strom) und per IoT-Gateway anbinden", signals: 6, costEur: 2600, days: 1 } },
  { id: "SG-11", type: "SG", hall: "A", maker: "Arburg", model: "ALLROUNDER 630 S", year: 2014, cavities: 4, targetCycle: 5.0, costPerHour: 1240, productId: "P-IML250", wear: 0.29, products: ["P-IML250", "P-IML500"], link: { via: "Euromap 63 → OPC UA", detail: "Steuerung liefert Daten über Euromap 63 – ein Protokoll-Wrapper übersetzt sie nach OPC UA", signals: 7, costEur: 1800, days: 1 } },
  { id: "SG-12", type: "SG", hall: "A", maker: "ENGEL", model: "e-mac 465", year: 2016, cavities: 4, targetCycle: 4.6, costPerHour: 1390, productId: "P-IML500", wear: 0.24, products: ["P-IML500", "P-IML250"], link: { via: "OPC UA (Euromap 77)", detail: "Schnittstelle ist vorhanden – nur Lizenz freischalten und ins Werksnetz einbinden", signals: 7, costEur: 900, days: 0.5 } },
  { id: "SG-13", type: "SG", hall: "A", maker: "KraussMaffei", model: "CX 300", year: 2011, cavities: 8, targetCycle: 3.9, costPerHour: 1260, productId: "P-DES125", wear: 0.37, products: ["P-DES125"], link: { via: "Retrofit-Box", detail: "Steuerung ohne Datenschnittstelle: Sensorik nachrüsten und über IoT-Gateway anbinden", signals: 6, costEur: 2500, days: 1 } },
  { id: "SG-14", type: "SG", hall: "A", maker: "Netstal", model: "ELION 2200", year: 2015, cavities: 8, targetCycle: 3.7, costPerHour: 1330, productId: "P-DK95", wear: 0.27, products: ["P-DK95", "P-DK75"], link: { via: "OPC UA", detail: "OPC UA ist an Bord, aber die Maschine hängt noch nicht im Produktionsnetz (Netzwerkkabel + Freigabe)", signals: 7, costEur: 700, days: 0.5 } },
];

export const PHASE2_SEED = Object.fromEntries(PHASE2_SEEDS.map((s) => [s.id, s])) as Record<string, Phase2Seed>;

export const PRODUCTS: Product[] = [
  { id: "P-IML500", name: "IML-Becher 500 ml rund", short: "IML 500", type: "SG", weightG: 18.5, material: "M-PPR", iml: true, pricePer1000: 86, piecesPerPallet: 9600, machines: ["SG-01", "SG-02"], spc: { label: "Etikettenversatz", unit: "mm", nominal: 0, tol: 0.4 } },
  { id: "P-IML250", name: "IML-Becher 250 ml rund", short: "IML 250", type: "SG", weightG: 11.2, material: "M-PPR", iml: true, pricePer1000: 61, piecesPerPallet: 16800, machines: ["SG-04", "SG-02", "SG-01"], spc: { label: "Etikettenversatz", unit: "mm", nominal: 0, tol: 0.4 } },
  { id: "P-DK95", name: "Deckel Ø 95 mm Schnapp", short: "Deckel 95", type: "SG", weightG: 5.8, material: "M-PPH", iml: false, pricePer1000: 24, piecesPerPallet: 38400, machines: ["SG-03", "SG-06"], spc: { label: "Deckelgewicht", unit: "g", nominal: 5.8, tol: 0.15 } },
  { id: "P-DK75", name: "Deckel Ø 75 mm Schnapp", short: "Deckel 75", type: "SG", weightG: 3.9, material: "M-PPH", iml: false, pricePer1000: 19, piecesPerPallet: 52000, machines: ["SG-06", "SG-03"], spc: { label: "Deckelgewicht", unit: "g", nominal: 3.9, tol: 0.12 } },
  { id: "P-EIS1000", name: "Eiscremebecher 1000 ml IML", short: "Eis 1000", type: "SG", weightG: 32.0, material: "M-PPR", iml: true, pricePer1000: 142, piecesPerPallet: 4200, machines: ["SG-05"], spc: { label: "Etikettenversatz", unit: "mm", nominal: 0, tol: 0.4 } },
  { id: "P-DES125", name: "Dessertbecher 125 ml IML", short: "Dessert 125", type: "SG", weightG: 6.4, material: "M-PPR", iml: true, pricePer1000: 44, piecesPerPallet: 24000, machines: ["SG-07", "SG-08"], spc: { label: "Etikettenversatz", unit: "mm", nominal: 0, tol: 0.4 } },
  { id: "P-JOG150", name: "Joghurtbecher 150 g bedruckt", short: "Joghurt 150", type: "TF", weightG: 4.1, material: "M-PSF", iml: false, pricePer1000: 21, piecesPerPallet: 43200, machines: ["TF-01", "TF-02"], spc: { label: "Wandstärke Boden", unit: "mm", nominal: 0.42, tol: 0.05 } },
  { id: "P-FK200", name: "Feinkostschale 200 g", short: "Feinkost 200", type: "TF", weightG: 7.5, material: "M-PPF", iml: false, pricePer1000: 33, piecesPerPallet: 21600, machines: ["TF-03", "TF-04"], spc: { label: "Wandstärke Seite", unit: "mm", nominal: 0.38, tol: 0.05 } },
  { id: "P-SAL375", name: "Salatschale 375 ml mit Siegelrand", short: "Salat 375", type: "TF", weightG: 9.8, material: "M-PPF", iml: false, pricePer1000: 39, piecesPerPallet: 14400, machines: ["TF-04", "TF-03"], spc: { label: "Siegelrandbreite", unit: "mm", nominal: 4.0, tol: 0.25 } },
];

export const PRODUCT = Object.fromEntries(PRODUCTS.map((p) => [p.id, p])) as Record<string, Product>;

export const CUSTOMERS: Customer[] = [
  { id: "K-1001", name: "Alpenmilch eG", city: "München", country: "DE", km: 590, lat: 48.137, lon: 11.575, segment: "Molkerei" },
  { id: "K-1002", name: "Molkerei Bergland", city: "Kempten", country: "DE", km: 620, lat: 47.726, lon: 10.315, segment: "Molkerei" },
  { id: "K-1003", name: "Nordfrische Feinkost GmbH", city: "Hamburg", country: "DE", km: 400, lat: 53.551, lon: 9.993, segment: "Feinkost" },
  { id: "K-1004", name: "Rheintal Desserts", city: "Köln", country: "DE", km: 55, lat: 50.937, lon: 6.96, segment: "Desserts" },
  { id: "K-1005", name: "Eismanufaktur Lindenhof", city: "Stuttgart", country: "DE", km: 370, lat: 48.775, lon: 9.182, segment: "Speiseeis" },
  { id: "K-1006", name: "Hofkäserei Sauerland", city: "Arnsberg", country: "DE", km: 95, lat: 51.396, lon: 8.064, segment: "Molkerei" },
  { id: "K-1007", name: "Zuivel Noord B.V.", city: "Groningen", country: "NL", km: 360, lat: 53.219, lon: 6.567, segment: "Molkerei" },
  { id: "K-1008", name: "Laiterie des Prés", city: "Lyon", country: "FR", km: 790, lat: 45.764, lon: 4.836, segment: "Molkerei" },
  { id: "K-1009", name: "Spreewald Feinkost KG", city: "Berlin", country: "DE", km: 560, lat: 52.52, lon: 13.405, segment: "Feinkost" },
  { id: "K-1010", name: "Alpine Dairy AG", city: "Zürich", country: "CH", km: 560, lat: 47.377, lon: 8.541, segment: "Molkerei" },
  { id: "K-1011", name: "Mlékárna Morava a.s.", city: "Brno", country: "CZ", km: 880, lat: 49.195, lon: 16.607, segment: "Molkerei" },
  { id: "K-1012", name: "Salatküche Westfalen", city: "Münster", country: "DE", km: 150, lat: 51.961, lon: 7.626, segment: "Feinkost" },
];

export const CUSTOMER = Object.fromEntries(CUSTOMERS.map((c) => [c.id, c])) as Record<string, Customer>;

export interface MaterialSeed {
  id: string;
  name: string;
  unit: "kg" | "Stk";
  stock: number;
  capacity: number;
  location: string;
  reorderPointDays: number;
  supplier: string;
}

export const MATERIAL_SEEDS: MaterialSeed[] = [
  { id: "M-PPH", name: "PP-Granulat Homopolymer", unit: "kg", stock: 41800, capacity: 60000, location: "Silo 1 + 2", reorderPointDays: 3, supplier: "Polymerwerk Rhein-Ruhr" },
  { id: "M-PPR", name: "PP-Granulat Random-Copolymer (IML)", unit: "kg", stock: 36200, capacity: 60000, location: "Silo 3 + 4", reorderPointDays: 3, supplier: "Nordsee Polymers" },
  { id: "M-PSF", name: "PS-Folie 1,1 mm (Rollen)", unit: "kg", stock: 34000, capacity: 48000, location: "Folienlager B1", reorderPointDays: 4, supplier: "Folientechnik Sauerland" },
  { id: "M-PPF", name: "PP-Folie 0,9 mm (Rollen)", unit: "kg", stock: 30000, capacity: 40000, location: "Folienlager B2", reorderPointDays: 4, supplier: "Folientechnik Sauerland" },
  { id: "M-IML", name: "IML-Etiketten (alle Dekore)", unit: "Stk", stock: 6_400_000, capacity: 12_000_000, location: "Etikettenlager A3", reorderPointDays: 5, supplier: "Labelprint Westfalen" },
  { id: "M-MB", name: "Masterbatch weiß", unit: "kg", stock: 3100, capacity: 4000, location: "Additivlager", reorderPointDays: 5, supplier: "ColorTec GmbH" },
];

export const CARRIERS = [
  { name: "Bergische Spedition", plate: "GM" },
  { name: "Rheinland Logistik", plate: "K" },
  { name: "NordFracht", plate: "HH" },
  { name: "Sauerland Trans", plate: "OE" },
  { name: "EuroKühl Transporte", plate: "SU" },
];

export const DEFECTS: Record<DefectType, { label: string; desc: string; machineTypes: MachineType[] }> = {
  kurzschuss: { label: "Kurzschuss / unvollständig", desc: "Formteil nicht vollständig gefüllt – meist am Rand.", machineTypes: ["SG"] },
  grat: { label: "Gratbildung", desc: "Überstehendes Material an der Trennebene.", machineTypes: ["SG", "TF"] },
  etikettenversatz: { label: "Etikettenversatz", desc: "IML-Etikett verschoben oder verdreht eingelegt.", machineTypes: ["SG"] },
  schwarzpunkt: { label: "Schwarzer Punkt / Einschluss", desc: "Verbranntes Material oder Fremdpartikel.", machineTypes: ["SG", "TF"] },
  riss: { label: "Riss / Spannungsriss", desc: "Feiner Riss, oft durch Entformung oder Kälte.", machineTypes: ["SG", "TF"] },
  verformung: { label: "Verformung / Verzug", desc: "Becher unrund oder Boden eingefallen.", machineTypes: ["SG", "TF"] },
};

export const DEFECT_KEYS = Object.keys(DEFECTS) as DefectType[];

export const SHIFTS = [
  { name: "Frühschicht", from: 6, to: 14 },
  { name: "Spätschicht", from: 14, to: 22 },
  { name: "Nachtschicht", from: 22, to: 30 },
];

export const WAREHOUSE_CAPACITY = 3200; // Palettenstellplätze Fertigwarenlager
export const CO2_PER_KWH = 0.38; // kg CO2e je kWh (Strommix-Annahme)

// ---------------- Lager, Hof, Kosten (Annahmen für die Simulation) ----------------

/** Stellplatz und Sicherheitsbestand (Paletten) je Fertigprodukt im Hochregallager */
export const STOCK_SEEDS: Record<string, { location: string; minPallets: number; basePallets: number }> = {
  "P-IML500": { location: "HRL Gasse 1", minPallets: 14, basePallets: 26 },
  "P-IML250": { location: "HRL Gasse 1", minPallets: 10, basePallets: 18 },
  "P-DK95": { location: "HRL Gasse 2", minPallets: 6, basePallets: 12 },
  "P-DK75": { location: "HRL Gasse 2", minPallets: 5, basePallets: 9 },
  "P-EIS1000": { location: "HRL Gasse 3", minPallets: 12, basePallets: 22 },
  "P-DES125": { location: "HRL Gasse 4", minPallets: 8, basePallets: 15 },
  "P-JOG150": { location: "HRL Gasse 5", minPallets: 8, basePallets: 16 },
  "P-FK200": { location: "Halle C · Block 2", minPallets: 7, basePallets: 13 },
  "P-SAL375": { location: "Halle C · Block 3", minPallets: 7, basePallets: 11 },
};

/** Einstandspreise Rohstoffe (€ je kg bzw. je Stück) */
export const MATERIAL_COST: Record<string, number> = {
  "M-PPH": 1.32,
  "M-PPR": 1.46,
  "M-PSF": 1.94,
  "M-PPF": 1.71,
  "M-IML": 0.0042,
  "M-MB": 4.6,
};
export const ENERGY_EUR_PER_KWH = 0.19;
export const FREIGHT_EUR_PER_KM = 1.68; // Komplettladung, frei Haus
/** Fixkosten je Kalendertag (Personal 3-Schicht, Gemeinkosten/Abschreibung) */
export const FIXED_COST_DAY = { personnel: 27_500, overhead: 13_500 };

export const SUPPLIERS: Record<string, { city: string; country: string; km: number }> = {
  "Polymerwerk Rhein-Ruhr": { city: "Gelsenkirchen", country: "DE", km: 98 },
  "Nordsee Polymers": { city: "Wilhelmshaven", country: "DE", km: 330 },
  "Folientechnik Sauerland": { city: "Meschede", country: "DE", km: 84 },
  "Labelprint Westfalen": { city: "Bielefeld", country: "DE", km: 165 },
  "ColorTec GmbH": { city: "Leverkusen", country: "DE", km: 52 },
  "Polymer Trade Benelux (Express)": { city: "Antwerpen", country: "BE", km: 255 },
  "Kartonagen Nord": { city: "Nordstadt", country: "DE", km: 14 },
  "Palettenwerk Siegtal": { city: "Eitorf", country: "DE", km: 38 },
  "Stretchfolien Rhein GmbH": { city: "Troisdorf", country: "DE", km: 47 },
  "RecyPlast Bergisch Land": { city: "Wipperfürth", country: "DE", km: 22 },
  "Wellpappe Nord GmbH": { city: "Neumünster", country: "DE", km: 455 },
};

/** Fahrerstamm der Spediteure (fiktiv) */
export const DRIVERS: Record<string, string[]> = {
  "Bergische Spedition": ["Jürgen Becker", "Thomas Krämer", "Sven Hollmann", "Dirk Schäfer", "Oliver Bremer"],
  "Rheinland Logistik": ["Marek Nowak", "Andreas Vogt", "Hakan Demir", "Frank Lüdtke", "Ralf Heinen"],
  NordFracht: ["Kai Petersen", "Dariusz Kowalski", "Lars Brodersen", "Mirko Jansen"],
  "Sauerland Trans": ["Stefan Wagner", "Ionuț Popescu", "Christian Rademacher", "Uwe Klein"],
  "EuroKühl Transporte": ["Andrius Petrauskas", "Mehmet Yılmaz", "Pavel Novák", "Tobias Brandt"],
};
export const VEHICLES = ["Sattelzug Plane 13,6 m", "Sattelzug Koffer 13,6 m", "Megatrailer 3 m Innenhöhe", "Sattelzug Plane 13,6 m"];
