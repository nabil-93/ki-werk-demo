// Fahrlogik ohne React: Pfadverfolgung, Sattelzug-Kinematik, Abstandshaltung

import { Polyline, type V2 } from "./geo";
import { TRUCK } from "./plan";

// ---------------------------------------------------------------- Abstandshaltung

interface Body {
  pts: V2[];
  r: number;
}
/** Körperpunkte aller Fahrzeuge (wird jedes Bild neu befüllt) */
export const bodies = new Map<number, Body>();

let nextId = 1;
export const newId = () => nextId++;

/** Liegt ein anderes Fahrzeug auf dem Fahrweg vor uns? */
export function blockedAhead(self: number, path: Polyline, sFront: number, look: number, r = 1.2) {
  for (let s = sFront + 0.5; s < sFront + look; s += 1.6) {
    const q = path.at(s);
    for (const [id, b] of bodies) {
      if (id === self) continue;
      const lim = (r + b.r) ** 2;
      for (const p of b.pts) if ((p[0] - q.x) ** 2 + (p[1] - q.z) ** 2 < lim) return true;
    }
  }
  return false;
}

/** Krümmung voraus: Richtungsänderung über die nächsten d Meter (rad) */
export function turnAhead(path: Polyline, s: number, d = 10) {
  const a = path.at(s).h, b = path.at(s + d).h;
  return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
}

// ---------------------------------------------------------------- Geschwindigkeit

export function approach(v: number, target: number, dt: number, acc = 1.6, dec = 3.2) {
  return target > v ? Math.min(target, v + acc * dt) : Math.max(target, v - dec * dt);
}

/** zulässige Geschwindigkeit, um bis "rest" Meter zum Stehen zu kommen */
export const stopSpeed = (rest: number, dec = 2.2) => Math.sqrt(Math.max(0, 2 * dec * Math.max(0, rest)));

// ---------------------------------------------------------------- Sattelzug

export interface TruckPose {
  K: V2; // Hinterachse Zugmaschine (Sattelkupplung)
  hc: number; // Richtung Zugmaschine (atan2(dx, dz))
  R: V2; // Achsmitte Auflieger
  ht: number; // Richtung Auflieger
}

const dir = (h: number): V2 => [Math.sin(h), Math.cos(h)];

/** Vorwärts: Zugmaschine folgt dem Pfad, Auflieger als Schleppkurve hinter dem Königszapfen */
export function truckForward(p: TruckPose, path: Polyline, s: number) {
  const a = path.at(s);
  const b = path.at(s + 1.2);
  p.K = [a.x, a.z];
  const h = Math.atan2(b.x - a.x, b.z - a.z);
  if (Number.isFinite(h) && (b.x !== a.x || b.z !== a.z)) p.hc = h;
  const dx = p.K[0] - p.R[0], dz = p.K[1] - p.R[1];
  const l = Math.hypot(dx, dz) || 1;
  p.R = [p.K[0] - (dx / l) * TRUCK.kingpin, p.K[1] - (dz / l) * TRUCK.kingpin];
  p.ht = Math.atan2(dx, dz);
}

/** Rückwärts: Aufliegerachse folgt dem Pfad, Zugmaschine knickt als Schleppkurve nach */
export function truckReverse(p: TruckPose, path: Polyline, s: number) {
  // Vorderachse der Zugmaschine (alte Lage) wird hinter dem Königszapfen hergezogen
  const F: V2 = [p.K[0] + Math.sin(p.hc) * TRUCK.wheelbase, p.K[1] + Math.cos(p.hc) * TRUCK.wheelbase];
  const a = path.at(s);
  const b = path.at(s + 1.2);
  p.R = [a.x, a.z];
  // Bewegungsrichtung = rückwärts → Aufliegerfront zeigt entgegen
  const mh = Math.atan2(b.x - a.x, b.z - a.z);
  if (b.x !== a.x || b.z !== a.z) p.ht = mh + Math.PI;
  const [tx, tz] = dir(p.ht);
  p.K = [p.R[0] + tx * TRUCK.kingpin, p.R[1] + tz * TRUCK.kingpin];
  p.hc = Math.atan2(F[0] - p.K[0], F[1] - p.K[1]);
  // Knickwinkel begrenzen (kein Einklappen)
  let d = Math.atan2(Math.sin(p.hc - p.ht), Math.cos(p.hc - p.ht));
  d = Math.max(-1.25, Math.min(1.25, d));
  p.hc = p.ht + d;
}

/** Körperpunkte eines Sattelzugs für die Abstandshaltung */
export function truckBody(p: TruckPose): V2[] {
  const [cx, cz] = dir(p.hc);
  const [tx, tz] = dir(p.ht);
  return [
    [p.K[0] + cx * 3.6, p.K[1] + cz * 3.6],
    [p.K[0] + cx * 1.2, p.K[1] + cz * 1.2],
    [p.R[0] + tx * 6.5, p.R[1] + tz * 6.5],
    [p.R[0] + tx * 3, p.R[1] + tz * 3],
    [p.R[0], p.R[1]],
    [p.R[0] - tx * 3, p.R[1] - tz * 3],
  ];
}

/** Pose aus Aufliegerposition und Richtung (gestreckter Zug) */
export function straightPose(K: V2, h: number): TruckPose {
  const [x, z] = dir(h);
  return { K: [K[0], K[1]], hc: h, R: [K[0] - x * TRUCK.kingpin, K[1] - z * TRUCK.kingpin], ht: h };
}
