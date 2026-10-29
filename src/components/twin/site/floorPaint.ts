// Hallenböden: Beschichtung, gelbe Fahrwege, grüne Gehwege, Zonen und Beschriftungen

import * as THREE from "three";
import { CONVEYOR_A, CONVEYOR_B, DOCKS, HALL_A_POLY, HALL_B_POLY, MACHINE_SPOTS, PHASE2_SPOTS, WAREHOUSE } from "../layout";
import type { V2 } from "./geo";

const PX = 16; // Pixel je Meter
const FONT = '"Archivo", "Segoe UI", system-ui, sans-serif';

function bbox(poly: V2[]) {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  return { x0: Math.min(...xs) - 1, x1: Math.max(...xs) + 1, z0: Math.min(...zs) - 1, z1: Math.max(...zs) + 1 };
}

const cache = new Map<string, THREE.CanvasTexture>();

export function hallFloorTex(hall: "A" | "B", dark: boolean) {
  const key = `${hall}:${dark}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const poly = hall === "A" ? HALL_A_POLY : HALL_B_POLY;
  const b = bbox(poly);
  const w = b.x1 - b.x0, h = b.z1 - b.z0;
  const cv = document.createElement("canvas");
  cv.width = Math.round(w * PX);
  cv.height = Math.round(h * PX);
  const c = cv.getContext("2d")!;
  const X = (x: number) => (x - b.x0) * PX;
  const Z = (z: number) => (z - b.z0) * PX;
  const col = dark
    ? { base: "#1a1f24", tile: "rgba(255,255,255,0.035)", yellow: "#8a7424", green: "#1f3a2c", white: "rgba(220,226,232,0.35)", text: "rgba(220,226,232,0.28)", zone: "rgba(90,140,255,0.08)" }
    : { base: "#cfd5d0", tile: "rgba(0,0,0,0.05)", yellow: "#e2b72a", green: "#86b98f", white: "rgba(255,255,255,0.85)", text: "rgba(30,36,44,0.30)", zone: "rgba(43,89,255,0.07)" };
  c.fillStyle = col.base;
  c.fillRect(0, 0, cv.width, cv.height);
  // Fugenraster 6 m
  c.strokeStyle = col.tile;
  c.lineWidth = 1;
  for (let x = Math.ceil(b.x0 / 6) * 6; x < b.x1; x += 6) {
    c.beginPath();
    c.moveTo(X(x), 0);
    c.lineTo(X(x), cv.height);
    c.stroke();
  }
  for (let z = Math.ceil(b.z0 / 6) * 6; z < b.z1; z += 6) {
    c.beginPath();
    c.moveTo(0, Z(z));
    c.lineTo(cv.width, Z(z));
    c.stroke();
  }
  const hline = (x0: number, x1: number, z: number, color: string, lw = 0.14) => {
    c.fillStyle = color;
    c.fillRect(X(x0), Z(z) - (lw * PX) / 2, (x1 - x0) * PX, lw * PX);
  };
  const vline = (x: number, z0: number, z1: number, color: string, lw = 0.14) => {
    c.fillStyle = color;
    c.fillRect(X(x) - (lw * PX) / 2, Z(z0), lw * PX, (z1 - z0) * PX);
  };
  const label = (s: string, x: number, z: number, size: number, rot = 0, color = col.text) => {
    c.save();
    c.translate(X(x), Z(z));
    c.rotate(rot);
    c.fillStyle = color;
    c.font = `800 ${size * PX}px ${FONT}`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(s, 0, 0);
    c.restore();
  };
  const zone = (x0: number, z0: number, x1: number, z1: number, dashed = true) => {
    c.fillStyle = col.zone;
    c.fillRect(X(x0), Z(z0), (x1 - x0) * PX, (z1 - z0) * PX);
    c.strokeStyle = col.yellow;
    c.lineWidth = 0.12 * PX;
    c.setLineDash(dashed ? [0.6 * PX, 0.4 * PX] : []);
    c.strokeRect(X(x0), Z(z0), (x1 - x0) * PX, (z1 - z0) * PX);
    c.setLineDash([]);
  };

  // weicher Kontaktschatten unter Maschinen und Regalen (Umgebungsverdeckung)
  const ao = (x0: number, z0: number, x1: number, z1: number) => {
    for (const [g, a] of [
      [0.9, 0.06],
      [0.45, 0.08],
      [0, 0.1],
    ]) {
      c.fillStyle = `rgba(0,0,0,${dark ? a * 1.4 : a})`;
      c.fillRect(X(x0 - g), Z(z0 - g), (x1 - x0 + 2 * g) * PX, (z1 - z0 + 2 * g) * PX);
    }
  };
  for (const s of [...MACHINE_SPOTS, ...PHASE2_SPOTS]) {
    const sg = !s.id.startsWith("TF");
    if ((hall === "A") !== sg) continue;
    const hx = sg ? 4.2 : 6.9, hz = sg ? 1.5 : 1.35;
    ao(s.x - hx, s.z - hz, s.x + hx, s.z + hz);
  }
  if (hall === "A") for (const x of [-11.5, -8.3, -5.1]) ao(x - 0.7, 75, x + 0.7, 115);
  else for (let k = 0; k < 8; k++) ao(75.8, WAREHOUSE.z0 + 4 + k * 6.2 - 1.4, 113, WAREHOUSE.z0 + 4 + k * 6.2 + 1.4);

  if (hall === "A") {
    // Fahrwege beidseits des Förderbands, Querweg, Gehweg an der Südwand
    for (const z of [88.2, 92.6, 96.4, 100.9]) hline(-13, 115.5, z, col.yellow);
    for (const x of [40.2, 43.8]) vline(x, 70.8, 118.6, col.yellow);
    hline(-13, 115.5, 116.6, col.green, 1.2);
    zone(46, 79.5, 103, 110.5, false);
    zone(-6.5, 79.5, 35, 110.5);
    label("PILOTLINIE · PHASE 1 · ANGEBUNDEN", 74.5, 76.2, 1.5);
    label("ROLLOUT PHASE 2 · MASCHINE FÜR MASCHINE", 14.2, 76.2, 1.35);
    label("IML-ETIKETTEN", -8.3, 74, 1);
    label("VERPACKUNG", 108.5, 109.6, 1.1);
    label("QS-LABOR", 105.5, 84.6, 0.9);
    // Staplerspuren: Ostgang und Querweg Nord (Verbindungsgang zum Lager)
    vline(112.8, 72, 110, col.yellow);
    vline(115.2, 72, 110, col.yellow);
    hline(88, 115.5, 72.3, col.yellow);
    hline(88, 115.5, 74.7, col.yellow);
    label("HALLE A · SPRITZGUSS", 74.5, 114, 2.4);
    // Maschinenplätze
    for (const s of [...MACHINE_SPOTS, ...PHASE2_SPOTS].filter((m) => m.id.startsWith("SG"))) {
      c.strokeStyle = col.white;
      c.lineWidth = 0.1 * PX;
      c.strokeRect(X(s.x - 4.8), Z(s.z - 2.6), 9.6 * PX, 5.2 * PX);
    }
    hline(CONVEYOR_A.x0, CONVEYOR_A.x1, CONVEYOR_A.z, "rgba(0,0,0,0.08)", 1.2);
  } else {
    // Thermoformen
    for (const z of [-16.2, -10.6, -6.4, -0.8]) hline(63, 116, z, col.yellow);
    vline(72.5, -28.5, 12.6, col.yellow);
    label("HALLE B · THERMOFORMEN", 92, -25.6, 2.1);
    label("FOLIENROLLEN", 68.5, -13.5, 0.9);
    hline(CONVEYOR_B.x0, CONVEYOR_B.x1, CONVEYOR_B.z, "rgba(0,0,0,0.08)", 1.2);
    // Lager: Regalgassen, Bereitstellung vor den Toren
    for (let k = 0; k < 8; k++) {
      const zc = WAREHOUSE.z0 + 4 + k * 6.2;
      c.fillStyle = dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)";
      c.fillRect(X(75.6), Z(zc - 1.45), 37.6 * PX, 2.9 * PX);
    }
    vline(73.8, 13.4, 64.6, col.yellow);
    for (const d of DOCKS) {
      c.strokeStyle = col.white;
      c.lineWidth = 0.1 * PX;
      c.strokeRect(X(d.x + 0.6), Z(d.z - 1.9), 7 * PX, 3.8 * PX);
      label(`TOR ${d.dock}`, d.x + 5, d.z, 0.7, -Math.PI / 2);
    }
    label("LAGER & VERSAND", 94, 15.4, 1.9);
    label("BEREITSTELLUNG", 69.2, 14.8, 0.8);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  // Die ShapeGeometry liefert UV = (x, −z) in Metern → auf den Hüllquader abbilden
  t.repeat.set(1 / w, 1 / h);
  t.offset.set(-b.x0 / w, b.z1 / h);
  cache.set(key, t);
  return t;
}
