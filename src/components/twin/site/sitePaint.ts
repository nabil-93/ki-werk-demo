// Hochaufgelöste Bodentextur des Werksgeländes: Asphalt, Rasen, Fahrbahnmarkierungen,
// Rampenspuren, LKW-Wartestreifen, Mitarbeiterparkplatz, Überwege. Außerhalb des Geländes transparent.

import * as THREE from "three";
import { DOCKS, GATE } from "../layout";
import { CROSSINGS, entryToExit, FORKLIFT_LANE, GATE_ROAD, IN_LANE, OUT_LANE, ROAD_WIDTH, SITE_LAWNS, STAFF_PARKING, TRUCK, WAIT_SLOTS } from "./plan";
import { offsetPolyline, Polyline, rng, type V2 } from "./geo";
import { SITE_POLY } from "./terrain";
import { bakeShadows } from "./bakedShadows";
import type { Tree } from "./treeData";

export const SITE_DECAL = { x0: -132, x1: 132, z0: -134, z1: 134 };
const RES = 2048;
const SX = RES / (SITE_DECAL.x1 - SITE_DECAL.x0);
const SZ = RES / (SITE_DECAL.z1 - SITE_DECAL.z0);
const X = (x: number) => (x - SITE_DECAL.x0) * SX;
const Z = (z: number) => (z - SITE_DECAL.z0) * SZ;

const PAL = {
  light: { asphalt: "#8d9093", patch: ["#878a8d", "#93969a", "#83878a"], lawn: "#97b773", lawnVar: "#8aab68", white: "#f5f5f1", yellow: "#e2b72a", hatch: "rgba(226,183,42,0.85)", text: "rgba(255,255,255,0.9)" },
  dark: { asphalt: "#25292e", patch: ["#23272c", "#282c31", "#212529"], lawn: "#16211a", lawnVar: "#132017", white: "#626870", yellow: "#7c6726", hatch: "rgba(124,103,38,0.8)", text: "rgba(160,168,178,0.6)" },
};

function poly(c: CanvasRenderingContext2D, pts: V2[], close = true) {
  c.beginPath();
  pts.forEach(([x, z], i) => (i ? c.lineTo(X(x), Z(z)) : c.moveTo(X(x), Z(z))));
  if (close) c.closePath();
}

function line(c: CanvasRenderingContext2D, pts: V2[], w: number, color: string, dash?: number[]) {
  c.strokeStyle = color;
  c.lineWidth = w * SX;
  c.setLineDash(dash ? dash.map((d) => d * SX) : []);
  poly(c, pts, false);
  c.stroke();
  c.setLineDash([]);
}

function text(c: CanvasRenderingContext2D, s: string, x: number, z: number, size: number, color: string, rot = 0) {
  c.save();
  c.translate(X(x), Z(z));
  c.rotate(rot);
  c.fillStyle = color;
  c.font = `800 ${size * SX}px "Archivo", "Segoe UI", system-ui, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(s, 0, 0);
  c.restore();
}

function arrow(c: CanvasRenderingContext2D, x: number, z: number, h: number, color: string) {
  // h: Fahrtrichtung (atan2(dx, dz))
  c.save();
  c.translate(X(x), Z(z));
  c.rotate(-h + Math.PI);
  c.fillStyle = color;
  const s = SX;
  c.beginPath();
  c.moveTo(0, -2.6 * s);
  c.lineTo(1.1 * s, -0.8 * s);
  c.lineTo(0.38 * s, -0.8 * s);
  c.lineTo(0.38 * s, 2.4 * s);
  c.lineTo(-0.38 * s, 2.4 * s);
  c.lineTo(-0.38 * s, -0.8 * s);
  c.lineTo(-1.1 * s, -0.8 * s);
  c.closePath();
  c.fill();
  c.restore();
}

const cache = new Map<string, THREE.CanvasTexture>();

export function siteTexture(dark: boolean, bake?: Tree[] | null) {
  const key = `${dark ? "dark" : "light"}:${bake ? "bake" : "rt"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = dark ? PAL.dark : PAL.light;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = RES;
  const c = canvas.getContext("2d")!;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.save();
  poly(c, SITE_POLY);
  c.clip();
  // Asphalt mit Ausbesserungen
  c.fillStyle = p.asphalt;
  c.fillRect(0, 0, RES, RES);
  const r = rng(3);
  for (let i = 0; i < 520; i++) {
    c.fillStyle = p.patch[Math.floor(r() * p.patch.length)];
    c.globalAlpha = 0.5 + r() * 0.5;
    const w = (2 + r() * 9) * SX, h = (1.5 + r() * 6) * SX;
    c.fillRect(r() * RES, r() * RES, w, h);
  }
  c.globalAlpha = 1;
  // Rasenflächen
  for (const l of SITE_LAWNS) {
    c.fillStyle = p.lawn;
    poly(c, l);
    c.fill();
  }
  c.save();
  for (const l of SITE_LAWNS) poly(c, l);
  c.clip();
  for (let i = 0; i < 900; i++) {
    c.fillStyle = p.lawnVar;
    c.globalAlpha = 0.25 + r() * 0.3;
    c.beginPath();
    c.ellipse(r() * RES, r() * RES, (1 + r() * 4) * SX, (0.8 + r() * 3) * SX, r() * 3, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
  c.globalAlpha = 1;

  // Werksstraße: Randlinien + Leitlinie
  line(c, offsetPolyline(GATE_ROAD, ROAD_WIDTH / 2 - 0.3), 0.15, p.white);
  line(c, offsetPolyline(GATE_ROAD, -(ROAD_WIDTH / 2 - 0.3)), 0.15, p.white);
  line(c, GATE_ROAD, 0.14, p.white, [3, 3]);
  // Fahrtrichtungspfeile im Hof
  const loop = new Polyline(entryToExit());
  for (let s = 14; s < loop.length - 8; s += 15) {
    const q = loop.at(s);
    arrow(c, q.x, q.z, q.h, p.white);
  }
  // Rampenspuren mit Tornummern
  for (const d of DOCKS) {
    const x0 = d.x - 0.4, x1 = d.x - 22;
    for (const dz of [-1.85, 1.85]) line(c, [[x0, d.z + dz], [x1, d.z + dz]], 0.15, p.white);
    line(c, [[x0 - 0.6, d.z - 1.6], [x0 - 0.6, d.z + 1.6]], 0.5, p.yellow);
    text(c, String(d.dock), x1 + 3, d.z, 2.2, p.text, Math.PI / 2);
  }
  // LKW-Wartestreifen
  for (const [x, z] of WAIT_SLOTS) {
    c.strokeStyle = p.white;
    c.lineWidth = 0.15 * SX;
    c.strokeRect(X(x - 1.8), Z(z - TRUCK.kingpin - TRUCK.rearOverhang - 0.6), 3.6 * SX, (TRUCK.kingpin + TRUCK.rearOverhang + TRUCK.front + 1.2) * SZ);
    text(c, "LKW", x, z - 4, 1.8, p.text, -Math.PI / 2);
  }
  // Sperrfläche vor den Silos
  c.save();
  poly(c, [[64, -38], [92, -38], [92, -32], [64, -32]]);
  c.clip();
  c.strokeStyle = p.hatch;
  c.lineWidth = 0.35 * SX;
  for (let x = 54; x < 100; x += 1.6) line(c, [[x, -38], [x + 6, -32]], 0.35, p.hatch);
  c.restore();
  // Mitarbeiterparkplatz
  for (const row of STAFF_PARKING) {
    const nx = Math.sin(row.face), nz = -Math.cos(row.face);
    for (let i = 0; i <= row.n; i++) {
      const x = row.x - 1.27 + i * row.dx, z = row.z + i * row.dz;
      line(c, [[x, z], [x + nx * 5, z + nz * 5]], 0.12, p.white);
    }
  }
  // Fußgängerüberwege
  for (const cr of CROSSINGS) {
    c.save();
    c.translate(X(cr.x), Z(cr.z));
    c.rotate(cr.a);
    c.fillStyle = p.white;
    for (let k = -cr.w / 2 + 0.25; k < cr.w / 2; k += 0.9) c.fillRect(k * SX, -1.5 * SZ, 0.5 * SX, 3 * SZ);
    c.restore();
  }
  // Haltelinien mit „STOP“ vor der Schranke – je Fahrtrichtung, lesbar für den ankommenden Fahrer
  for (const lane of [IN_LANE, OUT_LANE]) {
    const pl = new Polyline(lane);
    const sb = pl.project(GATE.x, GATE.z);
    for (const [q, what] of [
      [pl.at(sb - 2.0), "line"],
      [pl.at(sb - 4.6), "text"],
    ] as const) {
      c.save();
      c.translate(X(q.x), Z(q.z));
      // Schrift-„oben“ zeigt in Fahrtrichtung
      c.rotate(Math.atan2(Math.sin(q.h), -Math.cos(q.h)));
      c.fillStyle = p.white;
      if (what === "line") c.fillRect(-1.65 * SX, -0.25 * SZ, 3.3 * SX, 0.5 * SZ);
      else {
        // Fahrbahnschrift ist in Fahrtrichtung gestreckt
        c.scale(1, 1.9);
        c.font = `900 ${1.2 * SX}px "Archivo", "Segoe UI", system-ui, sans-serif`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("STOP", 0, 0);
      }
      c.restore();
    }
  }
  // Staplerweg
  line(c, offsetPolyline(FORKLIFT_LANE, 1.2), 0.12, p.yellow, [0.8, 0.6]);
  line(c, offsetPolyline(FORKLIFT_LANE, -1.2), 0.12, p.yellow, [0.8, 0.6]);
  text(c, "LKW-HOF", 34, 22, 3.2, p.text, -Math.PI / 2);
  text(c, "EINFAHRT", 80.4, -99, 1.6, p.text, Math.PI + 0.06);
  // gebackene Schatten der Werksgebäude, Silos und Bäume (innerhalb des Geländes)
  if (bake) {
    const near = bake.filter((t) => t.x > SITE_DECAL.x0 - 30 && t.x < SITE_DECAL.x1 && t.z > SITE_DECAL.z0 && t.z < SITE_DECAL.z1 + 30);
    bakeShadows(c, { x0: SITE_DECAL.x0, z0: SITE_DECAL.z0, w: SITE_DECAL.x1 - SITE_DECAL.x0, h: SITE_DECAL.z1 - SITE_DECAL.z0 }, 1100, { trees: near, houses: true, alpha: dark ? 0.24 : 0.36 });
  }
  c.restore();

  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  cache.set(key, t);
  return t;
}
