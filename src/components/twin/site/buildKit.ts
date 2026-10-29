// Bausteine für die Werksgebäude: Wände mit Toröffnungen, Flachdächer, Fassaden- und Dachtexturen.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { distToSegment, type V2 } from "./geo";

export interface Opening {
  x: number;
  z: number;
  w: number;
  h: number;
}

/** Quader mit Texturkoordinaten in Metern/tile (keine gestreckten Texturen) und dunkler Oberkante */
function wallBox(len: number, h: number, t: number, tile: number, capColor: THREE.Color, bodyColor: THREE.Color) {
  const g = new THREE.BoxGeometry(len, h, t);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(uv.count * 3);
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const su = nx > 0.5 ? t : len;
    const sv = ny > 0.5 ? t : h;
    uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
    const c = n.getY(i) > 0.5 ? capColor : bodyColor;
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * Wände entlang eines Polygons als zusammengeführte Quader.
 * Öffnungen (Tore/Türen) werden ausgespart; die Stürze darüber kommen in eine eigene Geometrie,
 * damit sie beim Aufschneiden der Halle ausgeblendet werden können.
 */
export function wallsAlong(poly: V2[], height: number, openings: Opening[], opts: { t?: number; tile?: number; cap?: string; body?: string; closed?: boolean } = {}) {
  const t = opts.t ?? 0.35, tile = opts.tile ?? 4;
  const cap = new THREE.Color(opts.cap ?? "#4b5159"), body = new THREE.Color(opts.body ?? "#ffffff");
  const walls: THREE.BufferGeometry[] = [];
  const lintels: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const n = opts.closed === false ? poly.length - 1 : poly.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.1) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const ang = Math.atan2(-dz, dx);
    // Öffnungen auf dieser Kante (Parameter entlang der Kante)
    const gaps = openings
      .filter((o) => distToSegment(o.x, o.z, ax, az, bx, bz) < 0.9)
      .map((o) => {
        const s = (o.x - ax) * dx + (o.z - az) * dz;
        return { a: Math.max(0, s - o.w / 2), b: Math.min(len, s + o.w / 2), h: o.h };
      })
      .sort((p, q) => p.a - q.a);
    const piece = (s0: number, s1: number, y0: number, y1: number, into: THREE.BufferGeometry[]) => {
      if (s1 - s0 < 0.05 || y1 - y0 < 0.05) return;
      const ext = into === walls ? 0.18 : 0; // Ecken überlappen lassen
      const L = s1 - s0 + (s0 <= 0.01 ? ext : 0) + (s1 >= len - 0.01 ? ext : 0);
      const mid = (s0 + s1) / 2 + ((s1 >= len - 0.01 ? ext : 0) - (s0 <= 0.01 ? ext : 0)) / 2;
      const g = wallBox(L, y1 - y0, t, tile, cap, body);
      m.makeRotationY(ang).setPosition(ax + dx * mid, (y0 + y1) / 2, az + dz * mid);
      g.applyMatrix4(m);
      into.push(g);
    };
    let cur = 0;
    for (const gp of gaps) {
      piece(cur, gp.a, 0, height, walls);
      piece(gp.a, gp.b, gp.h, height, lintels);
      cur = gp.b;
    }
    piece(cur, len, 0, height, walls);
  }
  const merge = (list: THREE.BufferGeometry[]) => {
    if (!list.length) return null;
    const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)))!;
    list.forEach((x) => x.dispose());
    return g;
  };
  return { walls: merge(walls)!, lintels: merge(lintels) };
}

/** Flachdach über einem Polygon; UV in Weltmetern (tile = Kachelgröße) */
export function flatRoof(poly: V2[], y: number, tileU: number, tileV: number) {
  const shape = poly.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(shape, []);
  const pos: number[] = [], uv: number[] = [], nor: number[] = [];
  for (const [a, b, c] of tris) {
    const A = poly[a], B = poly[b], C = poly[c];
    const up = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]) >= 0;
    for (const p of up ? [A, B, C] : [A, C, B]) {
      pos.push(p[0], y, p[1]);
      uv.push(p[0] / tileU, -p[1] / tileV);
      nor.push(0, 1, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/** Attika (Dachrand) als Quader entlang der Kanten */
export function parapet(poly: V2[], y: number, h = 0.6, t = 0.4) {
  const list: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.1) continue;
    const g = new THREE.BoxGeometry(len + t, h, t);
    m.makeRotationY(Math.atan2(-(bz - az), bx - ax)).setPosition((ax + bx) / 2, y + h / 2, (az + bz) / 2);
    g.applyMatrix4(m);
    list.push(g.toNonIndexed());
    g.dispose();
  }
  return mergeGeometries(list)!;
}

// ---------------------------------------------------------------- Texturen

const texCache = new Map<string, THREE.CanvasTexture>();
function canvasTex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const hit = texCache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

/** Trapezblech-Fassade (Kachel 4 m × 4 m) */
export function claddingTex(base: string, rib: string) {
  return canvasTex(`clad:${base}:${rib}`, 256, 256, (c) => {
    c.fillStyle = base;
    c.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 16) {
      c.fillStyle = rib;
      c.fillRect(x, 0, 3, 256);
      c.fillStyle = "rgba(255,255,255,0.18)";
      c.fillRect(x + 4, 0, 2, 256);
    }
  });
}

/** Bürofassade mit Fensterbändern (Kachel 7,2 m × 7,2 m = 2 Geschosse) */
export function officeTex(dark: boolean) {
  return canvasTex(`office:${dark}`, 512, 512, (c) => {
    c.fillStyle = dark ? "#2a3038" : "#f2f3f1";
    c.fillRect(0, 0, 512, 512);
    for (const y0 of [40, 296]) {
      c.fillStyle = dark ? "#e8c88a" : "#3d5a7a";
      c.fillRect(0, y0, 512, 120);
      c.fillStyle = dark ? "#f6dfb0" : "rgba(255,255,255,0.22)";
      if (!dark) c.fillRect(0, y0 + 6, 512, 26);
      c.fillStyle = dark ? "#2a3038" : "#d9dcdf";
      for (let x = 0; x < 512; x += 85) c.fillRect(x, y0, 6, 120);
    }
  });
}

/** Dachkacheln: "shed" Lichtbänder (Südhalle), "skylights" Lichtkuppeln (Mittelhalle), "solar" PV-Felder */
export function roofTex(kind: "shed" | "skylights" | "solar" | "plain", dark: boolean) {
  return canvasTex(`roof:${kind}:${dark}`, 512, 512, (c) => {
    const base = dark ? "#2b3036" : kind === "skylights" ? "#8f9497" : kind === "plain" ? "#9b9fa2" : "#d3d5d2";
    c.fillStyle = base;
    c.fillRect(0, 0, 512, 512);
    // feine Bahnen der Dachabdichtung
    c.fillStyle = dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.04)";
    for (let y = 0; y < 512; y += 32) c.fillRect(0, y, 512, 2);
    if (kind === "shed") {
      c.fillStyle = dark ? "#55606e" : "#eef3f6";
      c.fillRect(0, 200, 512, 90);
      c.fillStyle = dark ? "#3b4450" : "#c3ccd3";
      c.fillRect(0, 286, 512, 8);
    } else if (kind === "skylights") {
      for (let x = 40; x < 512; x += 256)
        for (let y = 40; y < 512; y += 256) {
          c.fillStyle = dark ? "#59636f" : "#e8eef2";
          c.fillRect(x, y, 90, 150);
          c.strokeStyle = dark ? "#3b4450" : "#b9c2c9";
          c.lineWidth = 5;
          c.strokeRect(x, y, 90, 150);
        }
    } else if (kind === "solar") {
      for (let y = 30; y < 512; y += 128) {
        c.fillStyle = dark ? "#18233a" : "#2b3d63";
        c.fillRect(20, y, 472, 74);
        c.strokeStyle = dark ? "#27375a" : "#5a74a8";
        c.lineWidth = 2;
        for (let x = 20; x < 492; x += 39) c.strokeRect(x, y, 39, 37);
      }
    }
  });
}

/** Sektionaltor (Kachel = ein Tor) */
export function doorTex() {
  return canvasTex("door", 128, 128, (c) => {
    c.fillStyle = "#dfe3e8";
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = "#b9c0c8";
    for (let y = 0; y < 128; y += 26) c.fillRect(0, y, 128, 3);
    c.fillStyle = "#9aa6b4";
    c.fillRect(10, 30, 108, 14);
  });
}

/** Schranke rot/weiß */
export function barrierTex() {
  return canvasTex("barrier", 256, 16, (c) => {
    for (let x = 0; x < 256; x += 32) {
      c.fillStyle = (x / 32) % 2 ? "#ffffff" : "#d62828";
      c.fillRect(x, 0, 32, 16);
    }
  });
}
