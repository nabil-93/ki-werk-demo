// Baumstandorte (einmal berechnet): Wald, Stadtwald, Gärten über die OSM-Dichtemaske, dazu OSM-Einzelbäume
// und die Pflanzstreifen im Werk. Wird von den Bäumen und von den gebackenen Schatten genutzt.

import { GROUND_HALF, MASK_N, MASK_RES, treeMask } from "./groundPaint";
import { OSM_TREES } from "./siteData";
import { SITE_TREES } from "./plan";
import { decode, rng } from "./geo";

export interface Tree {
  x: number;
  z: number;
  h: number;
  w: number;
  rot: number;
  conifer: boolean;
  tint: number;
}

/** Meter um das Werk: detaillierte Bäume */
export const NEAR = 300;
export const isNear = (t: { x: number; z: number }) => Math.abs(t.x - 40) < NEAR && Math.abs(t.z) < NEAR;

let cache: Tree[] | null = null;

export function treeList(): Tree[] {
  if (cache) return cache;
  const mask = treeMask();
  const r = rng(2024);
  const out: Tree[] = [];
  const sample = (x: number, z: number) => {
    const i = Math.floor((x + GROUND_HALF) / MASK_RES), j = Math.floor((z + GROUND_HALF) / MASK_RES);
    if (i < 0 || j < 0 || i >= MASK_N || j >= MASK_N) return 0;
    return mask[j * MASK_N + i];
  };
  const lim = GROUND_HALF - 12;
  // Raster mit Zufallsversatz: nah um das Werk dicht, in der Ferne grob (dafür größere Bäume)
  const grid = (x0: number, x1: number, z0: number, z1: number, step: number, far: boolean) => {
    for (let z = z0; z < z1; z += step)
      for (let x = x0; x < x1; x += step) {
        const px = x + (r() - 0.5) * step, pz = z + (r() - 0.5) * step;
        if (far === isNear({ x: px, z: pz })) continue;
        const v = sample(px, pz);
        if (v === 0 || r() * 255 > v) continue;
        const forest = v >= 200;
        const conifer = forest ? r() < 0.58 : r() < 0.22;
        const h = (forest ? (conifer ? 17 + r() * 13 : 13 + r() * 10) : conifer ? 7 + r() * 7 : 6 + r() * 7) * (far ? 1.25 : 1);
        out.push({ x: px, z: pz, h, w: h * (0.85 + r() * 0.35), rot: r() * Math.PI * 2, conifer, tint: r() });
      }
  };
  grid(40 - NEAR, 40 + NEAR, -NEAR, NEAR, 6.5, false);
  grid(-lim, lim, -lim, lim, 13.5, true);
  for (const [x, z] of decode(OSM_TREES)) out.push({ x, z, h: 18, w: 17, rot: r() * 6, conifer: false, tint: r() });
  for (const [x, z, h] of SITE_TREES) out.push({ x, z, h, w: h * 0.95, rot: r() * 6, conifer: r() < 0.15, tint: r() });
  cache = out;
  return out;
}
