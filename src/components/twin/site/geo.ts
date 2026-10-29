// 2D-Geometrie-Helfer für Grundrisse, Wege und Streuung (Meter, x/z-Ebene)

export type V2 = [number, number];

/** Dezimeter-Koordinaten [x0, z0, x1, z1, …] → Punkte in Metern */
export function decode(p: readonly number[]): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < p.length; i += 2) out.push([p[i] / 10, p[i + 1] / 10]);
  return out;
}

export function polyArea(poly: V2[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

export function centroid(poly: V2[]): V2 {
  let x = 0, z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / poly.length, z / poly.length];
}

export function pointInPoly(poly: V2[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Abstand zum Polygonrand – negativ im Inneren */
export function signedDistToPoly(poly: V2[], x: number, z: number) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distToSegment(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]));
  return pointInPoly(poly, x, z) ? -d : d;
}

/** Kleinstes umschließendes Rechteck (Drehwinkel um y, Mittelpunkt, Länge ≥ Breite) */
export function obb(poly: V2[]) {
  let best = { a: 0, area: Infinity, cx: 0, cz: 0, l: 0, w: 0 };
  // Kandidaten: Richtungen der Polygonkanten
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    const a = Math.atan2(z2 - z1, x2 - x1);
    const c = Math.cos(a), s = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of poly) {
      const u = x * c + z * s, v = -x * s + z * c;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      const long = u1 - u0 >= v1 - v0;
      best = { a: long ? a : a + Math.PI / 2, area, cx: cu * c - cv * s, cz: cu * s + cv * c, l: Math.max(u1 - u0, v1 - v0), w: Math.min(u1 - u0, v1 - v0) };
    }
  }
  return best;
}

/**
 * Schatten eines senkrechten Baukörpers am Boden als Vierecke je Kante (Grundriss → verschobener Grundriss).
 * Zusammen mit dem Grundriss deckt ihre Vereinigung den exakten Schatten ab – auch bei L- oder Kammformen.
 */
export function shadowQuads(poly: V2[], height: number, dir: [number, number]): V2[][] {
  const dx = dir[0] * height, dz = dir[1] * height;
  const out: V2[][] = [poly, poly.map(([x, z]) => [x + dx, z + dz] as V2)];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    out.push([a, b, [b[0] + dx, b[1] + dz], [a[0] + dx, a[1] + dz]]);
  }
  return out;
}

/** Deterministischer Zufall (Mulberry32) */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Polylinie mit Bogenlänge: Punkt + Richtung an Position s */
export class Polyline {
  readonly pts: V2[];
  readonly cum: number[];
  readonly length: number;
  constructor(pts: V2[]) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.length = this.cum[this.cum.length - 1];
  }
  at(s: number): { x: number; z: number; h: number } {
    const p = this.pts;
    if (p.length === 1) return { x: p[0][0], z: p[0][1], h: 0 };
    s = Math.max(0, Math.min(this.length, s));
    // binäre Suche (Fahrwege haben teils Hunderte Punkte, at() wird je Bild oft gerufen)
    let lo = 1, hi = this.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    const i = lo;
    const l = this.cum[i] - this.cum[i - 1] || 1;
    const t = (s - this.cum[i - 1]) / l;
    const [ax, az] = p[i - 1];
    const [bx, bz] = p[i];
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, h: Math.atan2(bx - ax, bz - az) };
  }
  /** Bogenlänge des nächstgelegenen Punkts (Suche ab Startindex für Stetigkeit) */
  project(x: number, z: number, from = 0, window = Infinity): number {
    let best = Infinity, bestS = 0;
    const p = this.pts;
    for (let i = 1; i < p.length; i++) {
      if (this.cum[i] < from - 1 || this.cum[i - 1] > from + window) continue;
      const [ax, az] = p[i - 1];
      const [bx, bz] = p[i];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
      if (d < best) {
        best = d;
        bestS = this.cum[i - 1] + t * Math.sqrt(l2);
      }
    }
    return bestS;
  }
}

/** Polylinie seitlich versetzen (positiv = rechts in Fahrtrichtung) */
export function offsetPolyline(pts: V2[], d: number): V2[] {
  if (pts.length < 2) return pts.slice();
  const out: V2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // rechts von Richtung (dx, dz) bei x = Ost, z = Süd: (-dz, dx)
    out.push([pts[i][0] - dz * d, pts[i][1] + dx * d]);
  }
  return out;
}

/** Kubische Bézierkurve als Punktfolge */
export function bezier(p0: V2, p1: V2, p2: V2, p3: V2, n = 24): V2[] {
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

/** Ecken einer Polylinie mit Kreisbögen abrunden (Fahrspuren) */
export function roundCorners(pts: V2[], radius: number, seg = 6): V2[] {
  if (pts.length < 3) return pts.slice();
  const out: V2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, pz] = pts[i - 1];
    const [cx, cz] = pts[i];
    const [nx, nz] = pts[i + 1];
    const l1 = Math.hypot(cx - px, cz - pz), l2 = Math.hypot(nx - cx, nz - cz);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const a: V2 = [cx + ((px - cx) / l1) * r, cz + ((pz - cz) / l1) * r];
    const b: V2 = [cx + ((nx - cx) / l2) * r, cz + ((nz - cz) / l2) * r];
    // quadratische Bézierkurve durch die Ecke
    for (let k = 0; k <= seg; k++) {
      const t = k / seg, u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cz + t * t * b[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
