// Bodentextur des Geländes (Canvas): Flächennutzung, Straßen mit Markierungen, Parkplätze,
// Gewässer und Hausgrundrisse aus OpenStreetMap. Dazu eine Maske für die Baumstreuung.

import * as THREE from "three";
import { AREAS, HOUSES, PARKINGS, ROADS, WATER } from "./siteData";
import { decode, rng, type V2 } from "./geo";
import { SITE_POLY, TERRAIN_HALF } from "./terrain";
import { bakeShadows } from "./bakedShadows";
import type { Tree } from "./treeData";

export const GROUND_HALF = TERRAIN_HALF; // Meter
const TEX = 4096;

interface GroundPalette {
  grass: string;
  grassVar: string[];
  forest: string;
  meadow: string;
  garden: string;
  park: string;
  pitch: string;
  water: string;
  parking: string;
  site: string;
  asphalt: string;
  asphaltMain: string;
  sidewalk: string;
  track: string;
  path: string;
  marking: string;
  houseAo: string;
}

const LIGHT_G: GroundPalette = {
  grass: "#9dbb78",
  grassVar: ["#a9c584", "#91b06d", "#b3cb8b", "#8aa865"],
  forest: "#5f7d48",
  meadow: "#b0cd84",
  garden: "#a3bd80",
  park: "#8fb46c",
  pitch: "#7fb866",
  water: "#79acd0",
  parking: "#8b8f93",
  site: "#a3a6a4",
  asphalt: "#7a7e82",
  asphaltMain: "#6c7075",
  sidewalk: "#cfcbc2",
  track: "#c4ad87",
  path: "#d6ccb8",
  marking: "#f4f4f0",
  houseAo: "rgba(40,45,35,0.22)",
};

const DARK_G: GroundPalette = {
  grass: "#17231a",
  grassVar: ["#1a281d", "#142017", "#1d2b1f", "#121c14"],
  forest: "#0e1810",
  meadow: "#1b291d",
  garden: "#182419",
  park: "#132016",
  pitch: "#15281a",
  water: "#0f2a40",
  parking: "#24282d",
  site: "#22262a",
  asphalt: "#24282d",
  asphaltMain: "#202429",
  sidewalk: "#2d3137",
  track: "#2a2620",
  path: "#2a2a26",
  marking: "#6d7279",
  houseAo: "rgba(0,0,0,0.35)",
};

const S = TEX / (2 * GROUND_HALF); // Pixel je Meter
const px = (v: number) => (v + GROUND_HALF) * S;

function path(c: CanvasRenderingContext2D, pts: V2[], close: boolean) {
  c.beginPath();
  pts.forEach(([x, z], i) => (i ? c.lineTo(px(x), px(z)) : c.moveTo(px(x), px(z))));
  if (close) c.closePath();
}

const decoded = {
  areas: AREAS.map((a) => ({ k: a.k, h: a.h, p: decode(a.p) })),
  roads: ROADS.map((r) => ({ t: r.t, w: r.w / 10, main: r.main, p: decode(r.p) })),
  water: WATER.map((w) => decode(w)),
  houses: HOUSES.map((h) => decode(h.slice(2))),
  parkings: PARKINGS.map((p) => decode(p.p)),
};

function paintAreas(c: CanvasRenderingContext2D, g: GroundPalette) {
  const fill = (k: number, color: string, hole = 0) => {
    for (const a of decoded.areas) {
      if (a.k !== k || a.h !== hole) continue;
      c.fillStyle = color;
      path(c, a.p, true);
      c.fill();
    }
  };
  fill(2, g.forest); // Wald zuerst, Ortslage darüber
  fill(7, g.garden);
  fill(7, g.forest, 1); // Aussparungen im Wohngebiet: Stadtwald und Gehölze
  fill(2, g.grass, 1);
  fill(1, g.meadow);
  fill(9, g.park);
  fill(3, g.park);
  fill(4, g.pitch);
  fill(8, g.site);
  fill(6, g.water);
  fill(5, g.parking);
}

function paintRoads(c: CanvasRenderingContext2D, g: GroundPalette) {
  c.lineCap = "round";
  c.lineJoin = "round";
  const stroke = (pts: V2[], w: number, color: string, dash?: number[]) => {
    c.strokeStyle = color;
    c.lineWidth = Math.max(1, w * S);
    c.setLineDash(dash ? dash.map((d) => d * S) : []);
    path(c, pts, false);
    c.stroke();
  };
  // Gehwege, dann Fahrbahn (Kreuzungen verschmelzen), dann Markierungen
  for (const r of decoded.roads) if (r.t <= 2) stroke(r.p, r.w + 3.4, g.sidewalk);
  for (const r of decoded.roads) if (r.t === 4) stroke(r.p, r.w, g.track);
  for (const r of decoded.roads) if (r.t === 5) stroke(r.p, r.w, g.path);
  for (const r of decoded.roads) if (r.t <= 3) stroke(r.p, r.w, r.main ? g.asphaltMain : g.asphalt);
  for (const r of decoded.roads) {
    if (!r.main) continue;
    stroke(r.p, 0.32, g.marking, [3, 6]); // Leitlinie
  }
  c.setLineDash([]);
}

function paintParkingStripes(c: CanvasRenderingContext2D, g: GroundPalette) {
  // Stellplatzmarkierungen entlang der längsten Kante jedes Parkplatzes
  c.strokeStyle = g.marking;
  c.lineWidth = Math.max(1, 0.14 * S);
  for (const p of decoded.parkings) {
    if (p.length < 3) continue;
    let best = 0, bi = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l > best) (best = l), (bi = i);
    }
    const a = p[bi], b = p[(bi + 1) % p.length];
    const dx = (b[0] - a[0]) / best, dz = (b[1] - a[1]) / best;
    // Innenrichtung: zum Schwerpunkt
    let cx = 0, cz = 0;
    for (const q of p) (cx += q[0]), (cz += q[1]);
    cx /= p.length;
    cz /= p.length;
    let nx = -dz, nz = dx;
    if ((cx - a[0]) * nx + (cz - a[1]) * nz < 0) (nx = -nx), (nz = -nz);
    c.beginPath();
    for (let s = 1.25; s < best - 1; s += 2.5) {
      const x = a[0] + dx * s, z = a[1] + dz * s;
      c.moveTo(px(x), px(z));
      c.lineTo(px(x + nx * 5), px(z + nz * 5));
    }
    c.stroke();
  }
}

/** Farbflecken: "grass" = Grüntöne (Grundierung), "lum" = nur Helligkeit (über allen Flächen) */
function paintNoise(c: CanvasRenderingContext2D, g: GroundPalette, seed: number, mode: "grass" | "lum") {
  const r = rng(seed);
  for (let i = 0; i < 5200; i++) {
    c.globalAlpha = mode === "grass" ? 0.06 + r() * 0.08 : 0.025 + r() * 0.04;
    c.fillStyle = mode === "grass" ? g.grassVar[Math.floor(r() * g.grassVar.length)] : r() > 0.5 ? "#ffffff" : "#000000";
    const x = r() * TEX, y = r() * TEX, rad = (6 + r() * 34) * S;
    c.beginPath();
    c.ellipse(x, y, rad, rad * (0.5 + r() * 0.8), r() * Math.PI, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}

const cache = new Map<string, THREE.CanvasTexture>();

/**
 * Bodentextur für das gesamte Gelände (wird je Farbschema einmal erzeugt).
 * bake: Schatten von Gebäuden, Häusern und Bäumen einbrennen (statt Echtzeitschatten).
 */
export function groundTexture(dark: boolean, bake?: Tree[] | null) {
  const key = `${dark ? "dark" : "light"}:${bake ? "bake" : "rt"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const g = dark ? DARK_G : LIGHT_G;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TEX;
  const c = canvas.getContext("2d")!;
  c.fillStyle = g.grass;
  c.fillRect(0, 0, TEX, TEX);
  paintNoise(c, g, 7, "grass");
  paintAreas(c, g);
  paintNoise(c, g, 11, "lum");
  // Grundrisse leicht abdunkeln (Kontaktschatten)
  c.fillStyle = g.houseAo;
  c.strokeStyle = g.houseAo;
  c.lineWidth = 2.2 * S;
  c.lineJoin = "round";
  for (const h of decoded.houses) {
    path(c, h, true);
    c.fill();
    c.stroke();
  }
  for (const w of decoded.water) {
    c.strokeStyle = g.water;
    c.lineWidth = 2.6 * S;
    c.lineCap = "round";
    path(c, w, false);
    c.stroke();
  }
  paintRoads(c, g);
  paintParkingStripes(c, g);
  // Werksgelände: Grundfläche (Details liefert die Werkstextur)
  c.fillStyle = g.site;
  path(c, SITE_POLY, true);
  c.fill();
  if (bake) bakeShadows(c, { x0: -GROUND_HALF, z0: -GROUND_HALF, w: 2 * GROUND_HALF, h: 2 * GROUND_HALF }, 1280, { trees: bake, houses: true, alpha: dark ? 0.22 : 0.34 });
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, t);
  return t;
}

// ---------------------------------------------------------------- Maske für Bäume

export const MASK_RES = 2; // Meter je Pixel
export const MASK_N = Math.round((2 * GROUND_HALF) / MASK_RES);
let maskCache: Uint8ClampedArray | null = null;

/**
 * Rotkanal: Baumdichte 0…255 (Wald 255, Gehölz 230, Park 170, Gärten 60, Wiese 10),
 * Straßen, Häuser, Parkplätze und Gewässer sind ausgespart.
 */
export function treeMask() {
  if (maskCache) return maskCache;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = MASK_N;
  const c = canvas.getContext("2d", { willReadFrequently: true })!;
  const m = MASK_N / (2 * GROUND_HALF);
  const mp = (v: number) => (v + GROUND_HALF) * m;
  const poly = (pts: V2[], close = true) => {
    c.beginPath();
    pts.forEach(([x, z], i) => (i ? c.lineTo(mp(x), mp(z)) : c.moveTo(mp(x), mp(z))));
    if (close) c.closePath();
  };
  const grey = (v: number) => `rgb(${v},${v},${v})`;
  c.fillStyle = grey(14);
  c.fillRect(0, 0, MASK_N, MASK_N);
  const fill = (k: number, v: number, hole = 0) => {
    c.fillStyle = grey(v);
    for (const a of decoded.areas) if (a.k === k && a.h === hole) (poly(a.p), c.fill());
  };
  fill(2, 255);
  fill(7, 60);
  fill(7, 230, 1);
  fill(2, 20, 1);
  fill(1, 6);
  fill(9, 150);
  fill(3, 170);
  for (const k of [4, 5, 6, 8]) fill(k, 0);
  c.fillStyle = grey(0);
  poly(SITE_POLY);
  c.fill();
  c.strokeStyle = grey(0);
  c.lineCap = "round";
  c.lineJoin = "round";
  for (const r of decoded.roads) {
    c.lineWidth = (r.w + (r.t <= 2 ? 7 : 3)) * m;
    poly(r.p, false);
    c.stroke();
  }
  c.lineWidth = 6 * m;
  for (const h of decoded.houses) {
    poly(h);
    c.fill();
    c.stroke();
  }
  for (const w of decoded.water) {
    c.lineWidth = 4 * m;
    poly(w, false);
    c.stroke();
  }
  const data = c.getImageData(0, 0, MASK_N, MASK_N).data;
  const out = new Uint8ClampedArray(MASK_N * MASK_N);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4];
  maskCache = out;
  return out;
}
