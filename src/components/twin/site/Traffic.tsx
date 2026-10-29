"use client";

// Verkehr auf dem echten Straßennetz und im Werk:
//  - Pkw fahren zufällige Routen (Rechtsverkehr, Abstand, Kurvenbremsung), geparkte Autos auf den Parkplätzen
//  - Sattelzüge aus den Versanddaten: Anfahrt über Hauptstraße und Zufahrtsstraße, Halt an der Schranke,
//    Warteplatz, Wende im Hof, Rückwärts-Andocken, Abfahrt – Auflieger knickt physikalisch nach
//  - zusätzliche Anlieferungen (Granulat, Etiketten, Folie) an freien Toren

import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useUi } from "@/lib/client/store";
import type { VisitView } from "@/lib/sim/types";
import { GATE } from "../layout";
import { trailerTexture } from "../textures";
import { PARKINGS } from "./siteData";
import { decode, pointInPoly, Polyline, rng, roundCorners, type V2 } from "./geo";
import { ADJ, laneFromNodes, nearestNode, NODES, randomGoal, route } from "./roadnet";
import { departPath, dockPose, entryToExit, entryToSlot, entryToStaging, IN_LANE, join, JUNCTION, OUT_LANE, reversePath, SIGNAL_STOP, slotToExit, slotToStaging, STAFF_PARKING, TRUCK, WAIT_SLOTS } from "./plan";
import { approach, blockedAhead, bodies, newId, stopSpeed, straightPose, truckBody, truckForward, truckReverse, turnAhead, type TruckPose } from "./vehicles";
import { barrier, dockBusy, signal } from "./cutaway";
import { terrainHeight } from "./terrain";

const rnd = rng(77);
const CAR_COLORS = ["#f2f2f0", "#c9ccd0", "#9aa0a6", "#2b2f35", "#1e2a44", "#7a1f1f", "#3d4a5c", "#e8e4da", "#5b6168", "#24344f"];

// ---------------------------------------------------------------- Fahrzeugmodelle

function vc(g: THREE.BufferGeometry, hex: string) {
  const c = new THREE.Color(hex);
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return ng;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, col: string) => vc(new THREE.BoxGeometry(w, h, d).translate(x, y, z), col);
const wheel = (r: number, w: number, x: number, y: number, z: number) => vc(new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2).translate(x, y, z), "#1c1f24");

/**
 * Pkw (Ursprung Fahrzeugmitte, Front +z): Karosserie weiß (Lackfarbe kommt als Instanzfarbe),
 * Scheiben und Räder dunkel – alles in EINER Geometrie
 */
const CAR = (() => {
  const car = mergeGeometries([
    box(1.8, 0.78, 4.4, 0, 0.72, 0, "#ffffff"),
    box(1.6, 0.62, 2.3, 0, 1.42, -0.25, "#2a323c"),
    box(1.62, 0.05, 2.0, 0, 1.76, -0.3, "#9aa3ad"),
    wheel(0.33, 0.24, 0.82, 0.33, 1.38),
    wheel(0.33, 0.24, -0.82, 0.33, 1.38),
    wheel(0.33, 0.24, 0.82, 0.33, -1.38),
    wheel(0.33, 0.24, -0.82, 0.33, -1.38),
  ])!;
  const lights = mergeGeometries([box(0.3, 0.12, 0.04, 0.6, 0.85, 2.21, "#fff6d8"), box(0.3, 0.12, 0.04, -0.6, 0.85, 2.21, "#fff6d8"), box(0.3, 0.12, 0.04, 0.62, 0.88, -2.21, "#ff2d2d"), box(0.3, 0.12, 0.04, -0.62, 0.88, -2.21, "#ff2d2d")])!;
  return { car, lights };
})();

// ---------------------------------------------------------------- weiche Schatten unter Fahrzeugen

/** Kontaktschatten aller bewegten Fahrzeuge in einem InstancedMesh (echte Schatten wären zu teuer) */
const blobs = new Map<number, { x: number; z: number; h: number; w: number; l: number }>();
const MAX_BLOBS = 64;

function BlobShadows() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }, []);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    let i = 0;
    for (const b of blobs.values()) {
      if (i >= MAX_BLOBS) break;
      tmpO.position.set(b.x, terrainHeight(b.x, b.z) + 0.08, b.z);
      tmpO.rotation.set(-Math.PI / 2, 0, b.h);
      tmpO.scale.set(b.w, b.l, 1);
      tmpO.updateMatrix();
      m.setMatrixAt(i++, tmpO.matrix);
    }
    tmpO.scale.set(1, 1, 1);
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX_BLOBS]} frustumCulled={false} renderOrder={1}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} />
    </instancedMesh>
  );
}

const CARRIER_STYLE: Record<string, { bg: string; accent: string; cab: string }> = {
  "Bergische Spedition": { bg: "#ffffff", accent: "#1f3b8f", cab: "#1f3b8f" },
  "Rheinland Logistik": { bg: "#f7f7f2", accent: "#b42318", cab: "#b42318" },
  NordFracht: { bg: "#eef4fb", accent: "#0f6c8a", cab: "#0f6c8a" },
  "Sauerland Trans": { bg: "#ffffff", accent: "#2f6b2f", cab: "#2f6b2f" },
  "EuroKühl Transporte": { bg: "#f3f6fa", accent: "#374151", cab: "#374151" },
  "RecyPlast Logistik": { bg: "#f1f7ee", accent: "#3f6212", cab: "#3f6212" },
  "Polymerwerk Rhein-Ruhr": { bg: "#f6f4fb", accent: "#5b2a91", cab: "#e9e9ec" },
  "Labelprint Westfalen": { bg: "#fffaf3", accent: "#c2410c", cab: "#c2410c" },
  "Folientechnik Sauerland": { bg: "#f2f8f7", accent: "#0f766e", cab: "#f1f3f4" },
};
const INBOUND = ["Polymerwerk Rhein-Ruhr", "Labelprint Westfalen", "Folientechnik Sauerland"];

const tractorCache = new Map<string, THREE.BufferGeometry>();
/** Zugmaschine: Ursprung Hinterachse, Front +z */
function tractorGeo(cab: string) {
  const hit = tractorCache.get(cab);
  if (hit) return hit;
  const g = mergeGeometries([
    box(2.2, 0.4, 6.2, 0, 0.95, 1.2, "#2b3038"),
    box(2.5, 2.55, 2.3, 0, 2.4, 3.55, cab),
    box(2.42, 0.6, 1.5, 0, 3.95, 3.25, cab),
    box(2.2, 1.0, 0.06, 0, 2.95, 4.72, "#1b2633"),
    box(2.3, 0.35, 0.12, 0, 1.15, 4.75, "#3a4048"),
    box(0.6, 0.55, 1.4, 1.1, 1.25, 1.7, "#9aa3ad"),
    box(1.3, 0.12, 1.3, 0, 1.2, 0, "#15181c"),
    box(0.32, 0.1, 0.06, 0.95, 1.5, 4.76, "#fff5d6"),
    box(0.32, 0.1, 0.06, -0.95, 1.5, 4.76, "#fff5d6"),
    wheel(0.52, 0.34, 1.05, 0.52, 3.8),
    wheel(0.52, 0.34, -1.05, 0.52, 3.8),
    wheel(0.52, 0.6, 0.95, 0.52, 0),
    wheel(0.52, 0.6, -0.95, 0.52, 0),
  ])!;
  tractorCache.set(cab, g);
  return g;
}

/**
 * Auflieger als EINE Geometrie: Kofferaufbau (Seiten mit Speditionsgrafik, übrige Flächen und Fahrwerk
 * auf eine einfarbige Ecke der Textur gemappt) + Fahrwerk/Räder als Vertexfarbe.
 * Ursprung Achsmitte, Front (+z) am Königszapfen.
 */
let trailerCache: THREE.BufferGeometry | null = null;
function trailerGeo() {
  if (trailerCache) return trailerCache;
  const flat = (g: THREE.BufferGeometry) => {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.01, 0.98);
    return g;
  };
  const shell = vc(new THREE.BoxGeometry(2.55, 2.75, 13.6).translate(0, 2.62, 3.4), "#ffffff");
  // Flächen 0/1 (±x) behalten die Grafik, Dach/Boden/Stirnseiten → einfarbige Ecke
  const uv = shell.attributes.uv as THREE.BufferAttribute;
  for (let i = 12; i < uv.count; i++) uv.setXY(i, 0.01, 0.98);
  const g = mergeGeometries([
    shell,
    flat(box(2.1, 0.3, 12.6, 0, 1.1, 3.4, "#2b3038")),
    ...[-1.3, 0, 1.3].flatMap((z) => [flat(wheel(0.48, 0.5, 0.95, 0.48, z)), flat(wheel(0.48, 0.5, -0.95, 0.48, z))]),
    flat(box(0.18, 0.9, 0.18, 0.9, 0.6, 7.6, "#5d6670")),
    flat(box(0.18, 0.9, 0.18, -0.9, 0.6, 7.6, "#5d6670")),
    flat(box(2.4, 0.16, 0.06, 0, 1.15, -3.44, "#c4161c")),
  ])!;
  trailerCache = g;
  return g;
}

// ---------------------------------------------------------------- Pkw-Verkehr

interface Car {
  id: number;
  path: Polyline;
  s: number;
  v: number;
  vmax: number;
  end: number;
  blocked: number;
  ghost: number;
  color: THREE.Color;
}

function carRoute(from: number) {
  for (let k = 0; k < 8; k++) {
    const to = randomGoal(from, rnd);
    const ids = route(from, to);
    if (!ids || ids.length < 3) continue;
    const pl = new Polyline(laneFromNodes(ids, 1.5, 6));
    if (pl.length > 80) return { pl, end: to };
  }
  return null;
}

function makeCars(n: number): Car[] {
  const out: Car[] = [];
  for (let i = 0; i < n * 3 && out.length < n; i++) {
    const start = Math.floor(rnd() * NODES.length);
    if (!ADJ[start].length) continue;
    const r = carRoute(start);
    if (!r) continue;
    out.push({ id: newId(), path: r.pl, s: rnd() * r.pl.length * 0.7, v: 6, vmax: 8.5 + rnd() * 3, end: r.end, blocked: 0, ghost: 0, color: new THREE.Color(CAR_COLORS[i % CAR_COLORS.length]) });
  }
  return out;
}

const tmpO = new THREE.Object3D();

function placeVehicle(o: THREE.Object3D, x: number, z: number, h: number, len: number) {
  const fx = x + Math.sin(h) * len * 0.5, fz = z + Math.cos(h) * len * 0.5;
  const bx = x - Math.sin(h) * len * 0.5, bz = z - Math.cos(h) * len * 0.5;
  const yf = terrainHeight(fx, fz), yb = terrainHeight(bx, bz);
  o.position.set(x, (yf + yb) / 2, z);
  o.rotation.set(0, h, 0);
  o.rotateX(-Math.atan2(yf - yb, len));
}

/**
 * Fährt direkt hinter dem Pkw ein LKW zum Werk? Dann darf der Pkw trotz Rot weiter –
 * sonst stünde der LKW, der das Rot angefordert hat, selbst in der Schlange.
 */
function truckBehind(p: { x: number; z: number; h: number }) {
  const cx = Math.sin(p.h), cz = Math.cos(p.h);
  for (const b of bodies.values()) {
    if (b.r < 1.2 || b.pts.length < 2) continue;
    const [f, k] = b.pts;
    const tx = f[0] - k[0], tz = f[1] - k[1];
    const tl = Math.hypot(tx, tz) || 1;
    if ((tx * cx + tz * cz) / tl < 0.7) continue;
    const dx = p.x - f[0], dz = p.z - f[1];
    const along = dx * cx + dz * cz, side = Math.abs(dx * cz - dz * cx);
    if (along > 0 && along < 35 && side < 3) return true;
  }
  return false;
}

function CarFleet({ dark }: { dark: boolean }) {
  const cars = useMemo(() => makeCars(18), []);
  const car = useRef<THREE.InstancedMesh>(null);
  const lights = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    cars.forEach((c, i) => car.current?.setColorAt(i, c.color));
    if (car.current?.instanceColor) car.current.instanceColor.needsUpdate = true;
  }, [cars]);
  useEffect(
    () => () =>
      cars.forEach((c) => {
        bodies.delete(c.id);
        blobs.delete(c.id * 2);
      }),
    [cars],
  );
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    cars.forEach((c, i) => {
      const look = 4 + c.v * 1.5;
      if (c.ghost > 0) c.ghost -= dt;
      const blocked = c.ghost <= 0 && blockedAhead(c.id, c.path, c.s + 2.3, look, 1.0);
      c.blocked = blocked ? c.blocked + dt : 0;
      // Verklemmung an Kreuzungen auflösen – nicht in der Schlange vor der roten Ampel
      if (c.blocked > 7 && signal.phase === "green") c.ghost = 3;
      const turn = turnAhead(c.path, c.s, 14);
      let vCurve = turn > 0.25 ? Math.max(3.2, c.vmax * (1 - turn * 0.55)) : c.vmax;
      // Ampel an der Werkseinfahrt: bei Rot/Gelb/Rot-Gelb an der Haltelinie stoppen
      if (signal.phase !== "green") {
        const sj = c.path.project(JUNCTION[0], JUNCTION[1], c.s, 90);
        const pj = c.path.at(sj);
        if (sj > c.s && (pj.x - JUNCTION[0]) ** 2 + (pj.z - JUNCTION[1]) ** 2 < 49) {
          const rest = sj - SIGNAL_STOP - (c.s + 2.3);
          // bei Gelb und zu kurzem Anhalteweg wird noch durchgefahren
          const late = signal.phase === "amber" && rest < 9;
          if (rest > -0.5 && !late && !truckBehind(c.path.at(c.s))) vCurve = Math.min(vCurve, stopSpeed(rest, 3.2));
        }
      }
      c.v = approach(c.v, blocked ? 0 : vCurve, dt, 2.2, 6);
      c.s += c.v * dt;
      if (c.s >= c.path.length - 0.5) {
        const r = carRoute(c.end);
        if (r) {
          c.path = r.pl;
          c.end = r.end;
          c.s = 0;
        } else c.s = 0;
      }
      const a = c.path.at(c.s);
      const b = c.path.at(c.s + 2.5);
      const h = Math.atan2(b.x - a.x, b.z - a.z) || a.h;
      bodies.set(c.id, { pts: [[a.x + Math.sin(h) * 1.7, a.z + Math.cos(h) * 1.7], [a.x - Math.sin(h) * 1.6, a.z - Math.cos(h) * 1.6]], r: 1.0 });
      blobs.set(c.id * 2, { x: a.x, z: a.z, h, w: 2.4, l: 5.2 });
      placeVehicle(tmpO, a.x, a.z, h, 2.8);
      tmpO.updateMatrix();
      car.current?.setMatrixAt(i, tmpO.matrix);
      lights.current?.setMatrixAt(i, tmpO.matrix);
    });
    for (const m of [car.current, lights.current]) if (m) m.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={car} args={[CAR.car, undefined, cars.length]} frustumCulled={false}>
        <meshStandardMaterial vertexColors roughness={0.32} metalness={0.45} />
      </instancedMesh>
      <instancedMesh ref={lights} args={[CAR.lights, undefined, cars.length]} frustumCulled={false}>
        <meshBasicMaterial vertexColors toneMapped={false} transparent opacity={dark ? 1 : 0.55} />
      </instancedMesh>
    </group>
  );
}

/** Geparkte Autos: Parkplätze aus OSM (senkrecht bzw. längs) und Mitarbeiterparkplatz – eine Geometrie */
function ParkedCars() {
  const geo = useMemo(() => {
    const out: { x: number; z: number; h: number; c: string }[] = [];
    const r = rng(9);
    for (const p of PARKINGS) {
      const poly = decode(p.p);
      if (poly.length < 3) continue;
      // zwei längste Kanten
      const edges = poly.map((a, i) => {
        const b = poly[(i + 1) % poly.length];
        return { a, b, l: Math.hypot(b[0] - a[0], b[1] - a[1]) };
      });
      edges.sort((x, y) => y.l - x.l);
      for (const e of edges.slice(0, p.street ? 1 : 2)) {
        const dx = (e.b[0] - e.a[0]) / e.l, dz = (e.b[1] - e.a[1]) / e.l;
        const step = p.street ? 5.6 : 2.5;
        for (let s = step / 2 + 0.3; s < e.l - step / 2; s += step) {
          for (const side of [1, -1]) {
            const nx = -dz * side, nz = dx * side;
            const off = p.street ? 1.1 : 2.6;
            const x = e.a[0] + dx * s + nx * off, z = e.a[1] + dz * s + nz * off;
            if (!pointInPoly(poly, x, z)) continue;
            if (r() < 0.22) break;
            const h = p.street ? Math.atan2(dx, dz) : Math.atan2(nx, nz) + (r() < 0.5 ? Math.PI : 0);
            out.push({ x, z, h, c: CAR_COLORS[Math.floor(r() * CAR_COLORS.length)] });
            break;
          }
        }
      }
    }
    for (const row of STAFF_PARKING)
      for (let i = 0; i < row.n; i++) if (r() < 0.86) out.push({ x: row.x + i * row.dx, z: row.z + i * row.dz + (row.face ? -2.5 : 2.5), h: row.face + (r() < 0.5 ? 0 : Math.PI), c: CAR_COLORS[Math.floor(r() * CAR_COLORS.length)] });
    // Lackfarbe in die Vertexfarben einrechnen (Karosserie weiß × Lack)
    const col = new THREE.Color();
    const list = out.map((s) => {
      placeVehicle(tmpO, s.x, s.z, s.h, 2.8);
      tmpO.updateMatrix();
      const g = CAR.car.clone().applyMatrix4(tmpO.matrix);
      const c = g.attributes.color as THREE.BufferAttribute;
      col.set(s.c);
      for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * col.r, c.getY(i) * col.g, c.getZ(i) * col.b);
      return g;
    });
    const merged = mergeGeometries(list)!;
    list.forEach((g) => g.dispose());
    return merged;
  }, []);
  return (
    <mesh geometry={geo} castShadow receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.32} metalness={0.45} />
    </mesh>
  );
}

// ---------------------------------------------------------------- Sattelzüge

type Loc = "public" | "yard" | "slot" | "staging" | "dock" | "out";
interface Leg {
  path: Polyline;
  rev: boolean;
  vmax: number;
  /** bis zu dieser Bogenlänge schnelle Fahrt (öffentliche Straße) */
  fast?: [number, number];
  stop: boolean;
  /** Haltelinie vor der Schranke (Bogenlänge der Front) */
  barrierAt?: number;
  then: Loc;
}
export interface Truck {
  id: number;
  key: string;
  carrier: string;
  ambient: boolean;
  want: "dock" | "slot" | "leave";
  dock?: number;
  slot?: number;
  loc: Loc;
  leg?: Leg;
  s: number;
  v: number;
  pose: TruckPose;
  hold: number;
  blocked: number;
  ghost: number;
}

const SPAWN_POINTS: V2[] = [
  [144, 671], // Hauptstraße, Süden
  [206, -261], // Landstraße, Norden
  [-491, 6], // Zufahrtsstraße, Westen
];
let gateNode = -1;
let spawnNodes: number[] = [];
function graphReady() {
  if (gateNode >= 0) return;
  gateNode = nearestNode(85, -104);
  spawnNodes = SPAWN_POINTS.map(([x, z]) => nearestNode(x, z));
}

function publicLane(from: number, to: number) {
  const ids = route(from, to);
  // Sattelzüge brauchen weite Kurvenradien, sonst knickt der Auflieger unrealistisch ein
  return ids && ids.length > 1 ? laneFromNodes(ids, 1.75, 13, 9) : null;
}

function gatePos(pl: Polyline) {
  const s = pl.project(GATE.x, GATE.z);
  const p = pl.at(s);
  return Math.hypot(p.x - GATE.x, p.z - GATE.z) < 4 ? s : undefined;
}

function leg(pts: V2[], o: { rev?: boolean; vmax: number; stop: boolean; then: Loc; fastLen?: number; fastFrom?: number }): Leg {
  const path = new Polyline(pts);
  const g = o.rev ? undefined : gatePos(path);
  return {
    path,
    rev: Boolean(o.rev),
    vmax: o.vmax,
    stop: o.stop,
    then: o.then,
    fast: o.fastLen !== undefined ? [0, o.fastLen] : o.fastFrom !== undefined ? [o.fastFrom, Infinity] : undefined,
    barrierAt: g !== undefined ? g - 2.2 : undefined,
  };
}

/** öffentliche Anfahrt bis zur Hofeinfahrt */
function arrivalLeg(spawn: number): Leg | null {
  graphReady();
  const pub = publicLane(spawn, gateNode);
  if (!pub) return null;
  const pts = roundCorners(join(pub.slice(0, -1), IN_LANE), 9);
  return leg(pts, { vmax: 4.6, stop: false, then: "yard", fastLen: new Polyline(pub).length - 22 });
}

/** Abfahrt: Hofstrecke → Werksstraße → öffentliche Straße bis zum Rand */
function exitPoints(prefix: V2[]): { pts: V2[]; slowLen: number } {
  graphReady();
  const k = OUT_LANE.findIndex((p) => p[1] < prefix[prefix.length - 1][1] - 0.5);
  const site = join(prefix, OUT_LANE.slice(Math.max(0, k)));
  const target = spawnNodes[Math.floor(rnd() * spawnNodes.length)];
  const pub = publicLane(gateNode, target) ?? [];
  return { pts: roundCorners(join(site, pub.slice(1)), 9), slowLen: new Polyline(site).length + 8 };
}

class TruckManager {
  trucks: Truck[] = [];
  dockOwner = new Map<number, number>();
  slotOwner: (number | null)[] = WAIT_SLOTS.map(() => null);
  synced = false;
  // keine anonymen LKW mehr – alle Fahrzeuge kommen aus dem Zeitfenster-Plan
  nextAmbient = Infinity;
  listeners = new Set<() => void>();

  notify() {
    this.listeners.forEach((l) => l());
  }

  reserveDock(t: Truck) {
    if (!t.dock) return false;
    const o = this.dockOwner.get(t.dock);
    if (o !== undefined && o !== t.id) return false;
    this.dockOwner.set(t.dock, t.id);
    return true;
  }

  freeSlot() {
    return this.slotOwner.findIndex((x) => x === null);
  }

  release(t: Truck) {
    if (t.dock && this.dockOwner.get(t.dock) === t.id) {
      this.dockOwner.delete(t.dock);
      dockBusy.delete(t.dock);
    }
    if (t.slot !== undefined && this.slotOwner[t.slot] === t.id) this.slotOwner[t.slot] = null;
  }

  /** Neuer LKW von außerhalb – nur, wenn Tor oder Warteplatz frei ist (sonst später erneut) */
  spawn(key: string, carrier: string, want: Truck["want"], dock: number | undefined, ambient: boolean) {
    graphReady();
    const id = newId();
    let slot: number | undefined;
    const dockFree = want === "dock" && dock !== undefined && !this.dockOwner.has(dock);
    if (dockFree) this.dockOwner.set(dock!, id);
    else {
      if (ambient) return false;
      slot = this.freeSlot();
      if (slot < 0) return false;
      this.slotOwner[slot] = id;
    }
    const spawn = spawnNodes[Math.floor(rnd() * spawnNodes.length)];
    const l = arrivalLeg(spawn);
    if (!l) {
      if (dockFree) this.dockOwner.delete(dock!);
      if (slot !== undefined) this.slotOwner[slot] = null;
      return false;
    }
    const start = l.path.at(0), next = l.path.at(2);
    const t: Truck = { id, key, carrier, ambient, want, dock, slot, loc: "public", leg: l, s: 0, v: 7, pose: straightPose([start.x, start.z], Math.atan2(next.x - start.x, next.z - start.z)), hold: 0, blocked: 0, ghost: 0 };
    truckForward(t.pose, l.path, 0);
    this.trucks.push(t);
    this.notify();
    return true;
  }

  /** Startbild: angedockte und wartende LKW direkt an ihren Plätzen */
  placeInitial(key: string, carrier: string, want: Truck["want"], dock: number | undefined) {
    const t: Truck = { id: newId(), key, carrier, ambient: false, want, dock, loc: "yard", s: 0, v: 0, pose: straightPose([0, 0], 0), hold: 0, blocked: 0, ghost: 0 };
    if (want === "dock" && dock && !this.dockOwner.has(dock)) {
      const p = dockPose(dock);
      t.pose = straightPose(p.K, -Math.PI / 2);
      this.dockOwner.set(dock, t.id);
      dockBusy.add(dock);
      t.loc = "dock";
    } else {
      const slot = this.freeSlot();
      if (slot < 0) return;
      t.slot = slot;
      this.slotOwner[slot] = t.id;
      t.pose = straightPose(WAIT_SLOTS[slot], 0);
      t.loc = "slot";
      if (want === "dock") t.want = "dock";
    }
    this.trucks.push(t);
  }

  /**
   * Abgleich mit dem Yard-Management der Simulation: jeder LKW im 3D-Werk ist ein echtes Zeitfenster
   * (anklickbar). Ankommende Fahrzeuge starten so früh, dass sie etwa zur gemeldeten Ankunft am Tor sind.
   */
  sync(visits: VisitView[], now: number, speed: number) {
    const lead = 90_000 * Math.max(1, speed);
    const visible = visits.filter((v) => v.status === "AM_TOR" || v.status === "WARTET" || v.status === "RAMPE" || (v.status === "ERWARTET" && !v.forecast && v.arriveAt - now < lead && v.arriveAt - now > -lead));
    const keys = new Set(visible.map((v) => v.id));
    const dockOf = (v: VisitView) => ((Math.max(1, v.dock) - 1) % 6) + 1;
    if (!this.synced) {
      this.synced = true;
      for (const v of visible.filter((x) => x.status === "RAMPE")) this.placeInitial(v.id, v.carrier, "dock", dockOf(v));
      for (const v of visible.filter((x) => x.status === "WARTET" || x.status === "AM_TOR").slice(0, WAIT_SLOTS.length)) this.placeInitial(v.id, v.carrier, "slot", dockOf(v));
      this.notify();
      return;
    }
    for (const v of visible) {
      const want = v.status === "RAMPE" ? "dock" : "slot";
      const t = this.trucks.find((x) => x.key === v.id);
      if (t) {
        if (t.want !== "leave") t.want = want;
        t.dock = dockOf(v);
      } else if (v.status !== "RAMPE" || !this.dockOwner.has(dockOf(v))) {
        if (this.trucks.filter((x) => x.loc !== "out").length < 7) this.spawn(v.id, v.carrier, want, dockOf(v), false);
      }
    }
    for (const t of this.trucks) if (!keys.has(t.key)) t.want = "leave";
  }

  /** Nächste Etappe festlegen, wenn die aktuelle beendet ist */
  decide(t: Truck, elapsed: number) {
    const K = t.pose.K;
    switch (t.loc) {
      case "yard": {
        if (t.want === "dock" && this.reserveDock(t)) {
          // reservierten Warteplatz wieder freigeben
          if (t.slot !== undefined && this.slotOwner[t.slot] === t.id) this.slotOwner[t.slot] = null;
          t.slot = undefined;
          t.leg = leg(entryToStaging(t.dock!), { vmax: 3.4, stop: true, then: "staging" });
        } else if (t.want !== "leave" && (t.slot !== undefined || this.freeSlot() >= 0)) {
          if (t.slot === undefined) t.slot = this.freeSlot();
          this.slotOwner[t.slot] = t.id;
          t.leg = leg(entryToSlot(t.slot), { vmax: 3.4, stop: true, then: "slot" });
        } else {
          const e = exitPoints(entryToExit());
          t.leg = leg(e.pts, { vmax: 4.4, stop: false, then: "out", fastFrom: e.slowLen });
        }
        break;
      }
      case "slot": {
        const slot = t.slot!;
        if (t.want === "dock" && this.reserveDock(t)) {
          t.leg = leg(slotToStaging(slot, t.dock!), { vmax: 3.2, stop: true, then: "staging" });
          this.slotOwner[slot] = null;
          t.slot = undefined;
        } else if (t.want === "leave") {
          const e = exitPoints(slotToExit(slot));
          t.leg = leg(e.pts, { vmax: 4.4, stop: false, then: "out", fastFrom: e.slowLen });
          this.slotOwner[slot] = null;
          t.slot = undefined;
        }
        break;
      }
      case "staging":
        t.leg = leg(reversePath(t.pose.R, t.pose.ht, t.dock!), { rev: true, vmax: 1.15, stop: true, then: "dock" });
        break;
      case "dock": {
        if (!t.hold) t.hold = elapsed + (t.ambient ? 40 + rnd() * 35 : 0);
        dockBusy.add(t.dock!);
        if (t.ambient && elapsed > t.hold) t.want = "leave";
        if (t.want === "leave") {
          const e = exitPoints(departPath([K[0], K[1]], t.dock!));
          t.leg = leg(e.pts, { vmax: 4.2, stop: false, then: "out", fastFrom: e.slowLen });
          this.release(t);
        }
        break;
      }
      case "out":
        t.loc = "out";
        break;
    }
    if (t.leg) t.s = t.leg.rev ? 0 : t.leg.path.project(K[0], K[1], 0, 6);
  }

  update(raw: number, elapsed: number) {
    const dt = Math.min(raw, 0.05);
    let gateDemand = 0;
    let signalDemand = 0;
    let removed = false;
    for (const t of this.trucks) {
      if (!t.leg) {
        this.decide(t, elapsed);
        if (!t.leg) {
          bodies.set(t.id, { pts: truckBody(t.pose), r: 1.35 });
          continue;
        }
      }
      const L = t.leg!;
      const front = t.s + (L.rev ? TRUCK.rearOverhang : TRUCK.front);
      // Zielgeschwindigkeit: Abschnitt, Kurven, Haltepunkte, Schranke, Verkehr
      const fast = L.fast && t.s >= L.fast[0] && t.s < L.fast[1];
      let target = fast ? 8.2 : L.vmax;
      const turn = turnAhead(L.path, t.s, 14);
      if (turn > 0.2) target = Math.min(target, Math.max(L.rev ? 0.8 : 2.2, target * (1 - turn * 0.6)));
      if (L.stop) target = Math.min(target, stopSpeed(L.path.length - t.s, 1.4));
      if (L.barrierAt !== undefined) {
        const dist = L.barrierAt - (t.s + TRUCK.front);
        // offen halten, bis auch der Auflieger durch ist (Zuglänge ~17 m)
        if (dist > -21 && dist < 36) gateDemand++;
        // Ampel am Breiten Weg: früh Rot anfordern, bis der Zug die Einmündung geräumt hat
        if (dist > -36 && dist < 75) signalDemand++;
        if (dist > -0.5 && barrier.open < 0.97) target = Math.min(target, stopSpeed(dist, 1.6));
      }
      if (t.ghost > 0) t.ghost -= dt;
      const blocked = t.ghost <= 0 && blockedAhead(t.id, L.path, front, L.rev ? 3 : 5 + t.v * 2.2, 1.25);
      t.blocked = blocked ? t.blocked + dt : 0;
      if (t.blocked > 12) t.ghost = 4;
      if (blocked) target = 0;
      t.v = approach(t.v, target, dt, L.rev ? 0.6 : 1.1, 2.6);
      t.s = Math.min(L.path.length, t.s + t.v * dt);
      if (L.rev) truckReverse(t.pose, L.path, t.s);
      else truckForward(t.pose, L.path, t.s);
      bodies.set(t.id, { pts: truckBody(t.pose), r: 1.35 });
      if (t.s >= L.path.length - 0.05) {
        t.loc = L.then;
        t.leg = undefined;
        if (!L.stop) {
          this.decide(t, elapsed);
          if (t.loc === "out") removed = true;
        } else t.v = 0;
      }
    }
    barrier.demand = gateDemand;
    signal.demand = signalDemand;
    if (removed || this.trucks.some((t) => t.loc === "out")) {
      for (const t of this.trucks.filter((x) => x.loc === "out")) {
        this.release(t);
        bodies.delete(t.id);
      }
      this.trucks = this.trucks.filter((x) => x.loc !== "out");
      this.notify();
    }
    // Anlieferungen an freien Toren
    if (elapsed > this.nextAmbient) {
      this.nextAmbient = elapsed + 70 + rnd() * 60;
      const free = [1, 2, 3, 4, 5, 6].filter((d) => !this.dockOwner.has(d) && !this.trucks.some((t) => t.dock === d && t.want === "dock"));
      if (free.length && this.trucks.length < 7) {
        const dock = free[Math.floor(rnd() * free.length)];
        this.spawn(`amb-${elapsed.toFixed(0)}`, INBOUND[Math.floor(rnd() * INBOUND.length)], "dock", dock, true);
      }
    }
  }
}

// ---------------------------------------------------------------- Darstellung LKW

const views = new Map<number, { tractor: THREE.Group; trailer: THREE.Group }>();

const pickTruck = (key: string) => (e: ThreeEvent<MouseEvent>) => {
  e.stopPropagation();
  const st = useUi.getState();
  st.selectVisit(st.selectedVisit === key ? null : key);
};
const overTruck = (e: ThreeEvent<PointerEvent>) => {
  e.stopPropagation();
  document.body.style.cursor = "pointer";
};
const outTruck = () => {
  document.body.style.cursor = "";
};

const TruckView = memo(function TruckView({ id, vkey, carrier, selected }: { id: number; vkey: string; carrier: string; selected: boolean }) {
  const tractor = useRef<THREE.Group>(null);
  const trailer = useRef<THREE.Group>(null);
  const st = CARRIER_STYLE[carrier] ?? CARRIER_STYLE["Bergische Spedition"];
  const side = useMemo(() => trailerTexture(carrier, st.bg, st.accent), [carrier, st]);
  const onClick = useMemo(() => pickTruck(vkey), [vkey]);
  useLayoutEffect(() => {
    if (tractor.current && trailer.current) views.set(id, { tractor: tractor.current, trailer: trailer.current });
    return () => {
      views.delete(id);
    };
  }, [id]);
  // je Fahrzeugteil EIN Draw Call; Schatten als weicher Kontaktschatten (BlobShadows)
  return (
    <group>
      <group ref={tractor}>
        <mesh geometry={tractorGeo(st.cab)} onClick={onClick} onPointerOver={overTruck} onPointerOut={outTruck}>
          <meshStandardMaterial vertexColors roughness={0.42} metalness={0.3} />
        </mesh>
        {selected && (
          <>
            <mesh position={[0, 6.2, 0]} rotation-x={Math.PI}>
              <coneGeometry args={[0.9, 1.8, 16]} />
              <meshBasicMaterial color="#2b59ff" toneMapped={false} />
            </mesh>
            <mesh position={[0, 0.12, 0]} rotation-x={-Math.PI / 2}>
              <ringGeometry args={[3.1, 3.7, 40]} />
              <meshBasicMaterial color="#2b59ff" transparent opacity={0.85} depthWrite={false} toneMapped={false} />
            </mesh>
          </>
        )}
      </group>
      <group ref={trailer}>
        <mesh geometry={trailerGeo()} onClick={onClick} onPointerOver={overTruck} onPointerOut={outTruck}>
          <meshStandardMaterial map={side} vertexColors roughness={0.55} emissive={selected ? "#2b59ff" : "#000000"} emissiveIntensity={selected ? 0.18 : 0} />
        </mesh>
      </group>
    </group>
  );
});

function Trucks() {
  const mgr = useMemo(() => new TruckManager(), []);
  const [list, setList] = useState<{ id: number; key: string; carrier: string }[]>([]);
  const selected = useUi((s) => s.selectedVisit);
  const lastSnap = useRef<unknown>(null);
  useEffect(() => {
    const l = () => setList(mgr.trucks.map((t) => ({ id: t.id, key: t.key, carrier: t.carrier })));
    mgr.listeners.add(l);
    l();
    // Diagnose: window.__cortexTraffic.mgr.trucks
    (window as unknown as Record<string, unknown>).__cortexTraffic = { mgr, barrier, dockBusy };
    return () => {
      mgr.listeners.delete(l);
      mgr.trucks.forEach((t) => bodies.delete(t.id));
      dockBusy.clear();
    };
  }, [mgr]);
  useFrame(({ clock }, dt) => {
    const snap = useUi.getState().snap;
    if (snap && snap !== lastSnap.current) {
      lastSnap.current = snap;
      mgr.sync(snap.visits, snap.now, snap.speed);
    }
    mgr.update(dt, clock.elapsedTime);
    // Kontaktschatten: alte Einträge der LKW verwerfen, aktuelle setzen
    for (const k of blobs.keys()) if (k < 0) blobs.delete(k);
    for (const t of mgr.trucks) {
      const p = t.pose;
      blobs.set(-(t.id * 2 + 1), { x: p.K[0] + Math.sin(p.hc) * 2, z: p.K[1] + Math.cos(p.hc) * 2, h: p.hc, w: 3.2, l: 6.6 });
      blobs.set(-(t.id * 2 + 2), { x: p.R[0] + Math.sin(p.ht) * 3.4, z: p.R[1] + Math.cos(p.ht) * 3.4, h: p.ht, w: 3.4, l: 15 });
      const v = views.get(t.id);
      if (!v) continue;
      placeVehicle(v.tractor, p.K[0], p.K[1], p.hc, TRUCK.wheelbase);
      // Auflieger: Neigung zwischen Achse und Königszapfen
      const kx = p.R[0] + Math.sin(p.ht) * TRUCK.kingpin, kz = p.R[1] + Math.cos(p.ht) * TRUCK.kingpin;
      const yr = terrainHeight(p.R[0], p.R[1]), yk = terrainHeight(kx, kz);
      v.trailer.position.set(p.R[0], yr, p.R[1]);
      v.trailer.rotation.set(0, p.ht, 0);
      v.trailer.rotateX(-Math.atan2(yk - yr, TRUCK.kingpin));
    }
  });
  return (
    <group>
      {list.map((t) => (
        <TruckView key={t.id} id={t.id} vkey={t.key} carrier={t.carrier} selected={selected === t.key} />
      ))}
    </group>
  );
}

function Traffic({ dark }: { dark: boolean }) {
  return (
    <group>
      <CarFleet dark={dark} />
      <ParkedCars />
      <Trucks />
      <BlobShadows />
    </group>
  );
}

export default memo(Traffic);
