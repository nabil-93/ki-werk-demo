// Geländehöhe aus dem EU-DEM-Raster (bikubisch interpoliert).
// Das Werksgelände ist eingeebnet (y = 0); außerhalb geht es weich ins echte Relief über.

import { WERK, SITE_META, TERRAIN } from "./siteData";
import { decode, signedDistToPoly, smoothstep } from "./geo";

const N = TERRAIN.n;
const STEP = TERRAIN.step;
const HALF = (N - 1) / 2;
const H = Float32Array.from(TERRAIN.h, (v) => v / 10);
const C = Math.cos((SITE_META.rotDeg * Math.PI) / 180);
const S = Math.sin((SITE_META.rotDeg * Math.PI) / 180);

/** Ausdehnung des Rasters in Metern (halbe Kantenlänge) */
export const TERRAIN_HALF = HALF * STEP;

export const SITE_POLY = decode(WERK.site);

/** Weltkoordinaten → nordausgerichtete Lokalkoordinaten des Rasters */
function toLocal(x: number, z: number): [number, number] {
  const X = x + SITE_META.originX;
  const Z = z + SITE_META.originZ;
  return [C * X + S * Z, -S * X + C * Z];
}

const g = (i: number, j: number) => H[Math.max(0, Math.min(N - 1, j)) * N + Math.max(0, Math.min(N - 1, i))];
const cr = (p0: number, p1: number, p2: number, p3: number, t: number) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

/** echte Geländehöhe relativ zum Werksniveau (ohne Einebnung) */
export function rawHeight(x: number, z: number) {
  const [lx, lz] = toLocal(x, z);
  const fx = lx / STEP + HALF;
  const fz = lz / STEP + HALF;
  const i = Math.floor(fx), j = Math.floor(fz);
  const u = fx - i, v = fz - j;
  const row = (jj: number) => cr(g(i - 1, jj), g(i, jj), g(i + 1, jj), g(i + 2, jj), u);
  return cr(row(j - 1), row(j), row(j + 1), row(j + 2), v);
}

/** Höhe für Darstellung und Fahrzeuge: Werksgelände eben, Übergang über ~45 m */
export function terrainHeight(x: number, z: number) {
  // schneller Vorab-Test: weit weg vom Gelände keine Polygonprüfung
  if (Math.abs(x) > 190 || Math.abs(z) > 190) return rawHeight(x, z);
  const d = signedDistToPoly(SITE_POLY, x, z);
  if (d <= 3) return 0;
  return rawHeight(x, z) * smoothstep(3, 48, d);
}
