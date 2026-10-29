"use client";

// Gabelstapler auf festen Routen durch die echten Tore: Verpackung (Halle A) → Verbindungsgang → Lager,
// Regal → Bereitstellung vor den Rampen, Folienrollen → Thermoformer, Zelthalle → Halle A.
// Vorwärts/rückwärts, Wenden auf der Stelle, Gabel heben/senken, Palette aufnehmen/absetzen.

import { useFrame } from "@react-three/fiber";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { palletLoadTexture } from "../textures";

type Act = "pick" | "drop";
/** Wegpunkt: Ziel, Fahrtrichtung zum Ziel (rückwärts?), Aktion am Ziel */
type Wp = [x: number, z: number, rev?: boolean, act?: Act];

const ROUTES: { wps: Wp[]; color: string }[] = [
  {
    // Halle A: Fertigpaletten von der Verpackung ins Lager
    color: "#f2a516",
    wps: [
      [102.4, 113, false, "pick"],
      [97.5, 113, true],
      [97.5, 108],
      [114, 108],
      [114, 73.5],
      [92, 73.5],
      [90, 71],
      [90, 62.6],
      [90, 57.3],
      [84.5, 57.3, false, "drop"],
      [90, 57.3, true],
      [90, 62.6],
      [90, 71],
      [92, 73.5],
      [114, 73.5],
      [114, 108],
      [97.5, 108],
      [97.5, 113],
    ],
  },
  {
    // Lager: Regal → Bereitstellung vor Tor 2 und Tor 4
    color: "#f2c316",
    wps: [
      [74.5, 32.5],
      [98, 32.5],
      [98, 33.4, false, "pick"],
      [98, 32.5, true],
      [74.5, 32.5],
      [74.5, 30.5],
      [70.2, 30.5, false, "drop"],
      [74.5, 30.5, true],
      [74.5, 44.9],
      [104, 44.9],
      [104, 45.8, false, "pick"],
      [104, 44.9, true],
      [74.5, 44.9],
      [74.5, 47.7],
      [70.2, 47.7, false, "drop"],
      [74.5, 47.7, true],
    ],
  },
  {
    // Thermoformen: Folienrolle zum Abwickler
    color: "#e8961a",
    wps: [
      [70, -18.6, false, "pick"],
      [70, -13.4, true],
      [95.7, -13.4],
      [95.7, -16.3, false, "drop"],
      [95.7, -13.4, true],
      [70, -13.4],
    ],
  },
  {
    // Hof: Verpackungsmaterial aus der Zelthalle in Halle A
    color: "#f2a516",
    wps: [
      [2, 46.6, false, "pick"],
      [2, 52, true],
      [2, 73.5],
      [2, 75.2, false, "drop"],
      [2, 70, true],
      [2, 52],
    ],
  },
];

function geo() {
  const vc = (g: THREE.BufferGeometry, hex: string) => {
    const ng = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color(hex);
    const a = new Float32Array(ng.attributes.position.count * 3);
    for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
    ng.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return ng;
  };
  const b = (w: number, h: number, d: number, x: number, y: number, z: number, col: string) => vc(new THREE.BoxGeometry(w, h, d).translate(x, y, z), col);
  const wh = (r: number, x: number, z: number) => vc(new THREE.CylinderGeometry(r, r, 0.22, 10).rotateZ(Math.PI / 2).translate(x, r, z), "#1b1e22");
  // Fahrgestell (Front +z, Gabel vorn), Farbe Körper = weiß (wird je Stapler eingefärbt)
  const body = mergeGeometries([
    b(1.12, 0.85, 1.9, 0, 0.62, -0.1, "#ffffff"),
    b(1.12, 0.5, 0.6, 0, 0.95, -0.95, "#2b3038"), // Gegengewicht
    b(0.55, 0.5, 0.55, 0, 1.25, -0.25, "#20304a"), // Sitz/Fahrer
    b(0.36, 0.38, 0.3, 0, 1.7, -0.2, "#e8c39a"),
    ...[[-0.5, 0.55], [0.5, 0.55], [-0.5, -0.75], [0.5, -0.75]].map(([x, z]) => b(0.06, 1.2, 0.06, x, 1.65, z, "#2b3038")),
    b(1.1, 0.05, 1.4, 0, 2.27, -0.1, "#2b3038"),
    ...[-0.36, 0.36].map((x) => b(0.09, 2.3, 0.12, x, 1.2, 0.98, "#3a4048")), // Hubmast
    wh(0.3, 0.5, 0.6),
    wh(0.3, -0.5, 0.6),
    wh(0.24, 0.5, -0.7),
    wh(0.24, -0.5, -0.7),
  ])!;
  const forks = mergeGeometries([b(0.9, 0.5, 0.06, 0, 0.3, 1.08, "#2b3038"), b(0.12, 0.05, 1.1, 0.24, 0.03, 1.65, "#3a4048"), b(0.12, 0.05, 1.1, -0.24, 0.03, 1.65, "#3a4048")])!;
  const beacon = new THREE.BoxGeometry(0.12, 0.12, 0.12).translate(0.35, 2.36, -0.6);
  return { body, forks, beacon };
}

interface State {
  i: number; // Zielindex
  x: number;
  z: number;
  h: number;
  wait: number;
  act?: Act;
  t: number; // Fortschritt der Aktion (s)
  loaded: boolean;
  fork: number;
}

/** Ein Simulationsschritt für einen Stapler */
function step(s: State, route: (typeof ROUTES)[number], dt: number) {
  const [tx, tz, rev, act] = route.wps[s.i];
  if (s.act) {
    // Lastaufnahme / Absetzen
    s.t += dt;
    if (s.act === "pick") {
      s.fork = THREE.MathUtils.damp(s.fork, s.t < 1 ? 0.12 : 0.32, 5, dt);
      if (s.t > 1) s.loaded = true;
      if (s.t > 2.4) s.act = undefined;
    } else {
      s.fork = THREE.MathUtils.damp(s.fork, s.t < 1.9 ? 1.45 : 0.12, 3.2, dt);
      if (s.t > 1.9) s.loaded = false;
      if (s.t > 3.6) s.act = undefined;
    }
    if (!s.act) s.i = (s.i + 1) % route.wps.length;
    return;
  }
  const dx = tx - s.x, dz = tz - s.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) {
    s.x = tx;
    s.z = tz;
    if (act) {
      s.act = act;
      s.t = 0;
    } else s.i = (s.i + 1) % route.wps.length;
    return;
  }
  // Ausrichten (vorwärts: Gabel voran, rückwärts: Heck voran), dann fahren
  const want = Math.atan2(dx, dz) + (rev ? Math.PI : 0);
  let e = Math.atan2(Math.sin(want - s.h), Math.cos(want - s.h));
  const turn = Math.sign(e) * Math.min(Math.abs(e), dt * 2.4);
  s.h += turn;
  e -= turn;
  if (Math.abs(e) < 0.35) {
    const v = Math.min(rev ? 1.1 : 2.2, d * 1.6 + 0.25) * (1 - Math.abs(e));
    const move = Math.min(d, v * dt);
    s.x += (dx / d) * move;
    s.z += (dz / d) * move;
  }
}

const tmpO = new THREE.Object3D();
const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();

/** Alle Stapler: Fahrgestell, Gabel, Palette und Rundumleuchte je ein InstancedMesh */
function Forklifts() {
  const geos = useMemo(() => geo(), []);
  const load = useMemo(() => palletLoadTexture(), []);
  const n = ROUTES.length;
  const states = useRef<State[]>(ROUTES.map((r) => ({ i: 0, x: r.wps[r.wps.length - 1][0], z: r.wps[r.wps.length - 1][1], h: 0, wait: 0, t: 0, loaded: false, fork: 0.12 })));
  const body = useRef<THREE.InstancedMesh>(null);
  const forks = useRef<THREE.InstancedMesh>(null);
  const pallet = useRef<THREE.InstancedMesh>(null);
  const beacon = useRef<THREE.InstancedMesh>(null);
  const palletGeo = useMemo(() => {
    // Palette (Holz) unten, foliierte Ladung oben – UV nur für die Ladung sinnvoll
    const wood = new THREE.BoxGeometry(1.0, 0.14, 1.2).translate(0, 0.17, 1.68);
    const goods = new THREE.BoxGeometry(0.96, 0.95, 1.15).translate(0, 0.72, 1.68);
    const g = mergeGeometries([wood.toNonIndexed(), goods.toNonIndexed()])!;
    // Holz dunkel einfärben über Vertexfarbe
    const col = new Float32Array(g.attributes.position.count * 3);
    const woodCount = wood.toNonIndexed().attributes.position.count;
    for (let i = 0; i < col.length / 3; i++) col.set(i < woodCount ? [0.73, 0.54, 0.32] : [1, 1, 1], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  useLayoutEffect(() => {
    ROUTES.forEach((r, i) => body.current?.setColorAt(i, tmpC.set(r.color)));
    if (body.current?.instanceColor) body.current.instanceColor.needsUpdate = true;
  }, []);
  useFrame(({ clock }, raw) => {
    const dt = Math.min(raw, 0.05);
    states.current.forEach((s, i) => {
      step(s, ROUTES[i], dt);
      tmpO.position.set(s.x, 0.1, s.z);
      tmpO.rotation.set(0, s.h, 0);
      tmpO.scale.setScalar(1);
      tmpO.updateMatrix();
      body.current?.setMatrixAt(i, tmpO.matrix);
      beacon.current?.setMatrixAt(i, tmpO.matrix);
      beacon.current?.setColorAt(i, tmpC.set(Math.sin(clock.elapsedTime * 8 + i * 1.7) > 0 ? "#ff9a1a" : "#5a3608"));
      tmpM.makeTranslation(0, s.fork, 0).premultiply(tmpO.matrix);
      forks.current?.setMatrixAt(i, tmpM);
      if (!s.loaded) tmpM.scale(new THREE.Vector3(0.0001, 0.0001, 0.0001));
      pallet.current?.setMatrixAt(i, tmpM);
    });
    for (const m of [body.current, forks.current, pallet.current, beacon.current]) if (m) m.instanceMatrix.needsUpdate = true;
    if (beacon.current?.instanceColor) beacon.current.instanceColor.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={body} args={[geos.body, undefined, n]} frustumCulled={false}>
        <meshStandardMaterial vertexColors roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={forks} args={[geos.forks, undefined, n]} frustumCulled={false}>
        <meshStandardMaterial vertexColors roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={pallet} args={[palletGeo, undefined, n]} frustumCulled={false}>
        <meshLambertMaterial map={load} vertexColors />
      </instancedMesh>
      <instancedMesh ref={beacon} args={[geos.beacon, undefined, n]} frustumCulled={false}>
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

export default memo(Forklifts);
