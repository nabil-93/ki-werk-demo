// Fahrwege, Stellplätze und Grünflächen auf dem Werksgelände (Weltkoordinaten in Metern).
// Abgeleitet aus den OSM-Zufahrten und dem Luftbild: Zufahrt vom Breiten Weg zwischen Verwaltung
// und Hochregallager, LKW-Hof westlich der Mittelhalle mit Rampen an deren Westfassade.

import { DOCKS } from "../layout";
import { bezier, offsetPolyline, roundCorners, type V2 } from "./geo";

/** Mittellinie der Werksstraße: Zufahrtsstraße (Tor) → LKW-Hof */
export const GATE_ROAD: V2[] = roundCorners(
  [
    [85, -104],
    [83.4, -94],
    [79.4, -70],
    [76.6, -58.5],
    [72.6, -51.6],
    [65, -47.4],
    [56, -45.4],
    [51.6, -42],
    [49.6, -34],
    [49, -20],
    [49, -4],
  ],
  5,
);
export const ROAD_WIDTH = 7.4;
/** Einmündung der Werksstraße in den Breiten Weg (Ampel) und Abstand der Haltelinien davor (m) */
export const JUNCTION: V2 = [85, -104];
export const SIGNAL_STOP = 12;

/** Fahrspuren (Rechtsverkehr) */
export const IN_LANE: V2[] = offsetPolyline(GATE_ROAD, 1.75);
export const OUT_LANE: V2[] = offsetPolyline(GATE_ROAD.slice().reverse(), 1.75);

// Einbahn-Hof: Durchfahrspur x = 27 und Wartespur x = 20 nach Süden, Wende vor der Südhalle,
// Ostspur x = 40 nach Norden (dort Halt zum Rückwärts-Andocken), Ausfahrt zurück zur Werksstraße.
const arc = (cx: number, cz: number, r: number, n = 10): V2[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = Math.PI - (i / n) * Math.PI; // Westen → Süden → Osten
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r] as V2;
  });
export const NORTH_LANE_X = 41;
/** Von der Hofeinfahrt bis zur Durchfahrspur */
export const YARD_HEAD: V2[] = roundCorners([[IN_LANE[IN_LANE.length - 1][0], -4], [46, 0.5], [31, 2.5], [27, 9], [27, 12]], 4);
/** Wendeschleife vor der Südhalle: Radius 11 m (Sattelzug-tauglich), von x = 19 nach x = 41 */
export const BULB: V2[] = arc(30, 50, 11, 16);
const THROUGH_TO_BULB: V2[] = join([[27, 12]], [[27, 36]], bezier([27, 36], [27, 41], [19, 44], [19, 50], 12));
export const YARD_EXIT: V2[] = roundCorners([[41, 3], [43, -4], [50.75, -11]], 4);

/** Warteplatz (Zugmaschine, Spitze nach Süden) – Zeitfenstersteuerung: weitere LKW kommen später */
export const WAIT_SLOTS: V2[] = [[20, 30]];

/** Pfadstücke verbinden (doppelte Punkte entfernen) */
export function join(...parts: V2[][]): V2[] {
  const out: V2[] = [];
  for (const part of parts)
    for (const p of part) {
      const q = out[out.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.3) out.push(p);
    }
  return out;
}

/** Hofeinfahrt → Halteposition vor dem Tor (Durchfahrspur, Wendeschleife, Ostspur) */
export function entryToStaging(dock: number): V2[] {
  return join(YARD_HEAD, THROUGH_TO_BULB, BULB, [stagingK(dock)]);
}

/** Hofeinfahrt → Warteplatz (Spurwechsel von x = 27 auf x = 20) */
export function entryToSlot(slot: number): V2[] {
  const [sx, sz] = WAIT_SLOTS[slot];
  return join(YARD_HEAD, bezier([27, 12], [27, 16], [sx, sz - 11], [sx, sz - 6], 12), [[sx, sz]]);
}

/** Warteplatz → Wendeschleife */
function slotToBulb(slot: number): V2[] {
  const [sx, sz] = WAIT_SLOTS[slot];
  return join([[sx, sz]], [[sx, 38]], bezier([sx, 38], [sx, 43], [19, 45], [19, 50], 10));
}

/** Warteplatz → Halteposition vor dem Tor */
export function slotToStaging(slot: number, dock: number): V2[] {
  return join(slotToBulb(slot), BULB, [stagingK(dock)]);
}

/** Hof → Ausfahrt ohne Andocken (z. B. nach Zurücksetzen) */
export function entryToExit(): V2[] {
  return join(YARD_HEAD, THROUGH_TO_BULB, BULB, [[41, 44]], YARD_EXIT);
}
export function slotToExit(slot: number): V2[] {
  return join(slotToBulb(slot), BULB, [[41, 44]], YARD_EXIT);
}

/** Geometrie der Sattelzüge (Meter) */
export const TRUCK = {
  wheelbase: 3.8, // Hinterachse → Vorderachse Zugmaschine
  front: 4.7, // Hinterachse → Frontstoßfänger
  kingpin: 9.0, // Achsmitte Auflieger → Königszapfen
  rearOverhang: 3.4, // Achsmitte Auflieger → Heck
  width: 2.55,
};

/** Andockpose je Tor: Aufliegerachse R, Zugmaschine K (Blick nach Westen) */
export function dockPose(dock: number) {
  const d = DOCKS[(dock - 1) % DOCKS.length];
  const rx = d.x - 0.5 - TRUCK.rearOverhang;
  return { R: [rx, d.z] as V2, K: [rx - TRUCK.kingpin, d.z] as V2, z: d.z };
}

/** Rückwärtsfahrt in das Tor: Kurve von der aktuellen Aufliegerposition (Bewegung rückwärts) */
export function reversePath(R: V2, trailerHeading: number, dock: number): V2[] {
  const { R: T } = dockPose(dock);
  const d = Math.hypot(T[0] - R[0], T[1] - R[1]);
  // Bewegungsrichtung rückwärts = entgegen der Aufliegerlängsachse
  const bx = -Math.sin(trailerHeading), bz = -Math.cos(trailerHeading);
  const p1: V2 = [R[0] + bx * d * 0.42, R[1] + bz * d * 0.42];
  const p2: V2 = [T[0] - d * 0.5, T[1]];
  return bezier(R, p1, p2, T, 28);
}

/** Abfahrt vom Tor: nach Westen ausziehen, dann auf die Ostspur nach Norden zur Ausfahrt */
export function departPath(K: V2, dock: number): V2[] {
  const { z } = dockPose(dock);
  return join(bezier(K, [K[0] - 8, K[1]], [NORTH_LANE_X, z - 5], [NORTH_LANE_X, z - 13], 20), YARD_EXIT);
}

/** Halteposition auf der Ostspur, von der aus rückwärts angedockt wird (Zugmaschine) */
export function stagingK(dock: number): V2 {
  const { z } = dockPose(dock);
  return [NORTH_LANE_X, Math.min(43, z - 10 - TRUCK.kingpin)];
}

/** Grünflächen im Werk (Rasen mit Bäumen) */
export const SITE_LAWNS: V2[][] = [
  // Grünzug zwischen Werkstatt und Technikgebäude (Luftbild: Wiese mit Bäumen)
  [[-28, -60], [17, -61], [18, -40], [-26, -38.5]],
  // Gehölzstreifen westlich der Südhalle
  [[-36, 6], [-16, 5], [-16.5, 58], [-15.8, 124], [-23.4, 124.9], [-24.5, 103.4], [-32.1, 57.9], [-35.7, 21]],
  // Pflanzstreifen an der Hauptstraße
  [[117.5, -27], [123.6, -27], [125.5, 44], [122.6, 83], [121.4, 121], [117.4, 121]],
  // Streifen zwischen Halle C und Breitem Weg
  [[-82, -127], [-16, -119], [38, -107.4], [38, -97], [-10, -96.5], [-31, -104], [-56, -115], [-84, -109]],
  // Südkante an der Straße Am Stadtwald
  [[-13, 121.5], [116, 120.8], [116, 124.6], [47.8, 126.3], [-13, 127.9]],
];

/** Bäume auf dem Werksgelände (Position, Höhe) */
export const SITE_TREES: [number, number, number][] = [
  ...[-22, -14, -6, 2, 10].flatMap((x, i) => [[x, -55 + (i % 2) * 3, 13 + (i % 3) * 2] as [number, number, number], [x + 3, -45 - (i % 2) * 2, 11 + (i % 2) * 3] as [number, number, number]]),
  ...Array.from({ length: 13 }, (_, i) => [-27 + (i % 2) * 5, 12 + i * 8.5, 12 + ((i * 7) % 5)] as [number, number, number]),
  ...Array.from({ length: 16 }, (_, i) => [120.5 + (i % 2) * 1.2, -22 + i * 9, 10 + ((i * 5) % 4)] as [number, number, number]),
  ...Array.from({ length: 11 }, (_, i) => [-74 + i * 10.5, -120 + i * 1.7, 11 + ((i * 3) % 4)] as [number, number, number]),
];

/** Mitarbeiterparkplatz an der Verwaltung: Reihen von Stellplätzen (Start, Richtung, Anzahl) */
export const STAFF_PARKING: { x: number; z: number; dx: number; dz: number; n: number; face: number }[] = [
  { x: 86.5, z: -57, dx: 2.55, dz: 0, n: 7, face: 0 },
  { x: 86.5, z: -40.5, dx: 2.55, dz: 0, n: 7, face: Math.PI },
];

/** Fußgängerüberwege (Mitte, Ausrichtung der Streifen) */
export const CROSSINGS: { x: number; z: number; a: number; w: number }[] = [
  { x: 80.8, z: -80, a: 0.18, w: 7.4 },
];

/** Staplerweg (gelb markiert): Zelthalle (Südtor) ↔ Nordtor Halle A */
export const FORKLIFT_LANE: V2[] = [
  [2, 45.4],
  [2, 65],
];
