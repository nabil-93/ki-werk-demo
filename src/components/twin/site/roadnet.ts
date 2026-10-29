// Öffentliches Straßennetz (OSM) als Graph: kürzeste Wege, Fahrspuren mit Rechtsverkehr

import { ROADNET } from "./siteData";
import { decode, offsetPolyline, roundCorners, type V2 } from "./geo";

export const NODES: V2[] = decode(ROADNET.nodes);
export const ADJ: number[][] = ROADNET.adj;

export function nearestNode(x: number, z: number, minDegree = 1) {
  let best = -1, bd = Infinity;
  NODES.forEach(([nx, nz], i) => {
    if (ADJ[i].length < minDegree) return;
    const d = (nx - x) ** 2 + (nz - z) ** 2;
    if (d < bd) (bd = d), (best = i);
  });
  return best;
}

/** Dijkstra (Graph ~500 Knoten – einfache Prioritätsliste genügt) */
export function route(from: number, to: number): number[] | null {
  const n = NODES.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[from] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1, du = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < du) (du = dist[i]), (u = i);
    if (u < 0 || u === to) break;
    done[u] = 1;
    for (const v of ADJ[u]) {
      const w = du + Math.hypot(NODES[u][0] - NODES[v][0], NODES[u][1] - NODES[v][1]);
      if (w < dist[v]) (dist[v] = w), (prev[v] = u);
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const out: number[] = [];
  for (let v = to; v >= 0; v = prev[v]) out.unshift(v);
  return out;
}

/**
 * Knotenfolge → Fahrspur (rechts versetzt, Ecken gerundet).
 * minSeg: dicht liegende Knoten (z. B. an Einmündungen) zusammenfassen, damit der Kurvenradius greifen kann.
 */
export function laneFromNodes(ids: number[], offset = 1.6, radius = 6, minSeg = 0.5): V2[] {
  const pts: V2[] = [];
  ids.forEach((id, i) => {
    const p = NODES[id];
    const q = pts[pts.length - 1];
    if (!q || i === ids.length - 1 || Math.hypot(p[0] - q[0], p[1] - q[1]) > minSeg) pts.push(p);
  });
  return roundCorners(offsetPolyline(pts, offset), radius, 8);
}

/** Zufälliges Ziel in Mindestentfernung */
export function randomGoal(from: number, rnd: () => number, minDist = 260) {
  const [fx, fz] = NODES[from];
  for (let k = 0; k < 40; k++) {
    const i = Math.floor(rnd() * NODES.length);
    if (Math.hypot(NODES[i][0] - fx, NODES[i][1] - fz) > minDist && ADJ[i].length) return i;
  }
  return Math.floor(rnd() * NODES.length);
}
