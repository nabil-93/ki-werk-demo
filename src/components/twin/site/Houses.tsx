"use client";

// Umgebende Bebauung aus OpenStreetMap: echte Grundrisse, Satteldächer (Schiefer/Ziegel),
// Fassaden mit Fenstern. Alle Häuser in ZWEI zusammengeführten Geometrien (Wände, Dächer).

import { memo, useEffect, useMemo } from "react";
import * as THREE from "three";
import { HOUSES } from "./siteData";
import { decode, obb, polyArea, rng, type V2 } from "./geo";
import { terrainHeight } from "./terrain";

// Fassadentextur: 4 × 3 Fensterfelder à 3 m (12 m × 9 m)
const TILE = 256;
function facadeCanvas(lit: boolean, seed: number) {
  const c = document.createElement("canvas");
  c.width = TILE * 4;
  c.height = TILE * 3;
  const x = c.getContext("2d")!;
  const r = rng(seed);
  x.fillStyle = lit ? "#000000" : "#ffffff";
  x.fillRect(0, 0, c.width, c.height);
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 4; i++) {
      const ox = i * TILE, oy = j * TILE;
      const wx = ox + 72, wy = oy + 70, ww = 112, wh = 118;
      if (lit) {
        if (r() < 0.32) {
          x.fillStyle = r() < 0.7 ? "#ffcf8a" : "#ffe7c2";
          x.fillRect(wx + 8, wy + 8, ww - 16, wh - 16);
        }
        continue;
      }
      x.fillStyle = "#e9e9e6";
      x.fillRect(wx, wy, ww, wh);
      x.fillStyle = "#4a5562";
      x.fillRect(wx + 8, wy + 8, ww - 16, wh - 16);
      x.fillStyle = "#e9e9e6";
      x.fillRect(wx + ww / 2 - 4, wy + 8, 8, wh - 16);
      x.fillStyle = "rgba(255,255,255,0.18)";
      x.fillRect(wx + 12, wy + 12, ww / 2 - 20, 26);
      // Fensterbank
      x.fillStyle = "#cfcfca";
      x.fillRect(wx - 6, wy + wh, ww + 12, 8);
    }
  return c;
}

const WALL = ["#f1eee7", "#ece4d3", "#e3e1da", "#f3efe3", "#d9d7cf", "#5f656d", "#efe5c8"];
const ROOF = ["#3a3f46", "#33373d", "#444a52", "#5a4036", "#7d4632", "#2f3338"];

interface Built {
  walls: THREE.BufferGeometry;
  roofs: THREE.BufferGeometry;
}

function build(): Built {
  const wp: number[] = [], wn: number[] = [], wu: number[] = [], wc: number[] = [];
  const rp: number[] = [], rn: number[] = [], rc: number[] = [];
  const r = rng(42);
  const col = new THREE.Color();
  const quad = (a: number[], b: number[], cc: number[], d: number[], n: number[], uv: number[][], color: THREE.Color) => {
    // a,b unten, c,d oben; Wicklung so, dass die Vorderseite nach außen (n) zeigt
    for (const [p, t] of [[a, uv[0]], [cc, uv[2]], [b, uv[1]], [a, uv[0]], [d, uv[3]], [cc, uv[2]]] as [number[], number[]][]) {
      wp.push(p[0], p[1], p[2]);
      wn.push(n[0], n[1], n[2]);
      wu.push(t[0], t[1]);
      wc.push(color.r, color.g, color.b);
    }
  };
  /** Dreieck, dessen Vorderseite in Richtung ref zeigt */
  const tri = (out: { p: number[]; n: number[]; c: number[] }, a: number[], b: number[], cc: number[], color: THREE.Color, ref: number[] = [0, 1, 0]) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    if (nx * ref[0] + ny * ref[1] + nz * ref[2] < 0) {
      [b, cc] = [cc, b];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const p of [a, b, cc]) {
      out.p.push(p[0], p[1], p[2]);
      out.n.push(nx, ny, nz);
      out.c.push(color.r, color.g, color.b);
    }
  };
  const roofOut = { p: rp, n: rn, c: rc };

  for (const h of HOUSES) {
    const kind = h[0];
    const height = h[1] / 10;
    let poly: V2[] = decode(h.slice(2));
    if (poly.length < 3) continue;
    // Uhrzeigersinn-Prüfung: Außennormalen zeigen vom Schwerpunkt weg
    if (polyArea(poly) < 0) poly = poly.slice().reverse();
    let base = Infinity;
    for (const [x, z] of poly) base = Math.min(base, terrainHeight(x, z));
    base -= 0.35;
    const box = obb(poly);
    const rect = Math.abs(polyArea(poly)) / (box.l * box.w);
    const gable = kind === 0 && rect > 0.78 && box.w > 4 && box.w < 14;
    const wallColor = col.set(kind === 1 ? "#cfcdc6" : WALL[Math.floor(r() * WALL.length)]).clone();
    const roofColor = col.set(kind === 0 ? ROOF[Math.floor(r() * ROOF.length)] : kind === 1 ? "#8c9096" : "#9da2a6").clone();
    const eave = base + (gable ? height : height + 0.35);

    // Wände
    let u = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, z1] = poly[i];
      const [x2, z2] = poly[(i + 1) % poly.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.05) continue;
      // Normale nach außen (Polygon gegen den Uhrzeigersinn in x/z → rechts der Kante)
      const nx = (z2 - z1) / len, nz = -(x2 - x1) / len;
      const v0 = 0, v1 = (eave - base) / 9;
      quad([x1, base, z1], [x2, base, z2], [x2, eave, z2], [x1, eave, z1], [nx, 0, nz], [[u / 12, v0], [(u + len) / 12, v0], [(u + len) / 12, v1], [u / 12, v1]], wallColor);
      u += len;
    }

    if (gable) {
      // Satteldach über dem umschließenden Rechteck, First entlang der Längsachse
      const c = Math.cos(box.a), s = Math.sin(box.a);
      const L = box.l / 2 + 0.45, W = box.w / 2 + 0.5;
      const rise = box.w * 0.42;
      const P = (lu: number, lv: number, y: number) => [box.cx + lu * c - lv * s, y, box.cz + lu * s + lv * c];
      const e1a = P(-L, -W, eave - 0.2), e1b = P(L, -W, eave - 0.2);
      const e2a = P(-L, W, eave - 0.2), e2b = P(L, W, eave - 0.2);
      const ra = P(-L, 0, eave + rise), rb = P(L, 0, eave + rise);
      // beide Dachflächen
      for (const [a, b, cc] of [
        [e1a, rb, e1b],
        [e1a, ra, rb],
        [e2a, e2b, rb],
        [e2a, rb, ra],
      ])
        tri(roofOut, a, b, cc, roofColor);
      // Giebeldreiecke (Wandfarbe)
      const g1a = P(-box.l / 2, -box.w / 2, eave), g1b = P(-box.l / 2, box.w / 2, eave), g1c = P(-box.l / 2, 0, eave + rise - 0.1);
      const g2a = P(box.l / 2, -box.w / 2, eave), g2b = P(box.l / 2, box.w / 2, eave), g2c = P(box.l / 2, 0, eave + rise - 0.1);
      const gOut = { p: wp, n: wn, c: wc };
      const before = wp.length;
      tri(gOut, g1a, g1b, g1c, wallColor, [-c, 0, -s]);
      tri(gOut, g2a, g2b, g2c, wallColor, [c, 0, s]);
      for (let k = before / 3; k < wp.length / 3; k++) wu.push(0.02, 0.02);
    } else {
      // Flachdach mit Attika
      const shape = poly.map(([x, z]) => new THREE.Vector2(x, z));
      const tris = THREE.ShapeUtils.triangulateShape(shape, []);
      for (const [a, b, cc] of tris) {
        tri(roofOut, [poly[a][0], eave, poly[a][1]], [poly[b][0], eave, poly[b][1]], [poly[cc][0], eave, poly[cc][1]], roofColor);
      }
    }
  }

  const walls = new THREE.BufferGeometry();
  walls.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3));
  walls.setAttribute("normal", new THREE.Float32BufferAttribute(wn, 3));
  walls.setAttribute("uv", new THREE.Float32BufferAttribute(wu, 2));
  walls.setAttribute("color", new THREE.Float32BufferAttribute(wc, 3));
  walls.computeBoundingSphere();
  const roofs = new THREE.BufferGeometry();
  roofs.setAttribute("position", new THREE.Float32BufferAttribute(rp, 3));
  roofs.setAttribute("normal", new THREE.Float32BufferAttribute(rn, 3));
  roofs.setAttribute("color", new THREE.Float32BufferAttribute(rc, 3));
  roofs.computeBoundingSphere();
  return { walls, roofs };
}

let built: Built | null = null;

function Houses({ dark }: { dark: boolean }) {
  const geo = useMemo(() => (built ??= build()), []);
  const tex = useMemo(() => {
    const day = new THREE.CanvasTexture(facadeCanvas(false, 1));
    day.colorSpace = THREE.SRGBColorSpace;
    day.wrapS = day.wrapT = THREE.RepeatWrapping;
    day.anisotropy = 4;
    const night = new THREE.CanvasTexture(facadeCanvas(true, 5));
    night.colorSpace = THREE.SRGBColorSpace;
    night.wrapS = night.wrapT = THREE.RepeatWrapping;
    return { day, night };
  }, []);
  useEffect(() => () => {
    tex.day.dispose();
    tex.night.dispose();
  }, [tex]);
  return (
    <group>
      <mesh geometry={geo.walls} castShadow receiveShadow>
        <meshLambertMaterial vertexColors map={tex.day} emissiveMap={tex.night} emissive={dark ? "#ffd39a" : "#000000"} emissiveIntensity={dark ? 1.4 : 0} />
      </mesh>
      <mesh geometry={geo.roofs} castShadow receiveShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
    </group>
  );
}

export default memo(Houses);
