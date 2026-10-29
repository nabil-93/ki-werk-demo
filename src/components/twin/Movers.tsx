"use client";

// Bewegte Elemente in den Hallen: Förderbänder mit Bechern, fahrerlose Transportsysteme (AGV).
// Beide Bänder in einer Geometrie, Becher und AGVs instanziert (wenige Draw Calls).

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useUi } from "@/lib/client/store";
import { AGV_LOOP, CAMERA_STATION, CONVEYOR_A, CONVEYOR_B } from "./layout";
import type { TwinPalette } from "./palette";
import { boxAt, colored, cylAt, mergeAll } from "./merge";

const dummy = new THREE.Object3D();

/** Bandkörper, Seitenführungen, Stützen beider Bänder und Ausschleusbehälter */
function Belts({ pal }: { pal: TwinPalette }) {
  const geo = useMemo(() => {
    const list: THREE.BufferGeometry[] = [];
    for (const { x0, x1, z, y } of [CONVEYOR_A, CONVEYOR_B]) {
      const len = x1 - x0, cx = (x0 + x1) / 2;
      list.push(boxAt(len, 0.12, 0.8, cx, y - 0.08, z, pal.machineDark));
      for (const dz of [-0.45, 0.45]) list.push(boxAt(len, 0.12, 0.06, cx, y + 0.02, z + dz, pal.steel));
      for (let x = x0; x <= x1; x += 3) list.push(boxAt(0.1, y - 0.14, 0.7, x, (y - 0.14) / 2, z, pal.steel));
    }
    list.push(boxAt(1.2, 1.0, 0.9, CAMERA_STATION.x + 1.2, 0.5, CONVEYOR_A.z + 1.6, "#ff4b55"));
    return mergeAll(list);
  }, [pal]);
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.7} metalness={0.25} />
    </mesh>
  );
}

interface Cup {
  x: number;
  dz: number;
  defect: boolean;
  checked: boolean;
}

/** Becher (Etikett = Instanzfarbe); Ausschuss wird an der KI-Kamera ausgeschleust */
function CupStream({ conv, kind, n }: { conv: typeof CONVEYOR_A; kind: "SG" | "TF"; n: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const cups = useMemo<Cup[]>(() => Array.from({ length: n }, (_, i) => ({ x: conv.x0 + ((conv.x1 - conv.x0) * i) / n, dz: 0, defect: false, checked: false })), [conv, n]);
  const colors = useMemo(() => {
    const palette = kind === "SG" ? ["#2b59ff", "#e5484d", "#16a34a", "#f59e0b", "#7c3aed"] : ["#f3f4f6"];
    return cups.map((_, i) => new THREE.Color(palette[i % palette.length]));
  }, [cups, kind]);
  const geo = useMemo(() => mergeAll([cylAt(0.2, 0.15, 0.4, 12, 0, 0, 0, "#ffffff"), cylAt(0.205, 0.165, 0.2, 12, 0, -0.02, 0, kind === "SG" ? "#ffffff" : "#e9edf2", undefined, true)]), [kind]);
  const red = useMemo(() => new THREE.Color("#ff2d3a"), []);
  const last = useRef<boolean[]>([]);

  useFrame((_, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    const snap = useUi.getState().snap;
    const ms = snap?.machines.filter((m) => m.type === kind) ?? [];
    const running = ms.filter((m) => m.status === "PRODUKTION").length / Math.max(1, ms.length);
    const speed = 2.2 * running;
    // sichtbare Fehlerquote (überhöht, damit man sie sieht)
    const worst = Math.max(0, ...ms.map((m) => (m.spcViolation ? m.scrapRate * 6 : m.scrapRate * 2)));
    const pDefect = Math.min(0.45, worst);
    const len = conv.x1 - conv.x0;
    let recolor = false;
    cups.forEach((c, i) => {
      c.x += speed * Math.min(dt, 0.05);
      if (kind === "SG" && !c.checked && c.x > CAMERA_STATION.x - 0.2) {
        c.checked = true;
        c.defect = Math.random() < pDefect;
      }
      if (c.defect && c.checked) c.dz = Math.min(1.4, c.dz + dt * 2.5);
      if (c.x > conv.x1) {
        c.x -= len;
        c.checked = false;
        c.defect = false;
        c.dz = 0;
      }
      dummy.position.set(c.x, conv.y + 0.2, conv.z + c.dz);
      dummy.scale.setScalar(c.dz >= 1.4 ? 0.0001 : 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (last.current[i] !== c.defect || last.current.length < n) {
        last.current[i] = c.defect;
        mesh.setColorAt(i, c.defect ? red : colors[i]);
        recolor = true;
      }
    });
    dummy.scale.setScalar(1);
    mesh.instanceMatrix.needsUpdate = true;
    if (recolor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[geo, undefined, n]} frustumCulled={false}>
      <meshStandardMaterial vertexColors roughness={0.35} />
    </instancedMesh>
  );
}

// ---------------- AGV ----------------

const LOOP_LEN = (() => {
  let s = 0;
  for (let i = 0; i < AGV_LOOP.length; i++) {
    const a = AGV_LOOP[i];
    const b = AGV_LOOP[(i + 1) % AGV_LOOP.length];
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
})();

function pointOnLoop(d: number): { x: number; z: number; h: number } {
  let rest = ((d % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  for (let i = 0; i < AGV_LOOP.length; i++) {
    const a = AGV_LOOP[i];
    const b = AGV_LOOP[(i + 1) % AGV_LOOP.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (rest <= l) {
      const t = rest / l;
      return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, h: Math.atan2(b[0] - a[0], b[1] - a[1]) };
    }
    rest -= l;
  }
  return { x: AGV_LOOP[0][0], z: AGV_LOOP[0][1], h: 0 };
}

const AGVS = [
  { offset: 0, loaded: true },
  { offset: LOOP_LEN / 3, loaded: false },
  { offset: (2 * LOOP_LEN) / 3, loaded: true },
];

/** Fahrerlose Transportfahrzeuge: Fahrzeug, Ladung und Rundumleuchte je als ein InstancedMesh */
function Agvs() {
  const body = useRef<THREE.InstancedMesh>(null);
  const load = useRef<THREE.InstancedMesh>(null);
  const beacon = useRef<THREE.InstancedMesh>(null);
  const state = useRef(AGVS.map((a) => ({ d: a.offset, h: 0 })));
  const geos = useMemo(
    () => ({
      body: mergeAll([boxAt(1.15, 0.42, 1.7, 0, 0.28, 0, "#f2a516"), cylAt(0.12, 0.12, 0.1, 12, 0, 0.52, 0.55, "#111111")]),
      load: mergeAll([boxAt(1.0, 0.12, 1.2, 0, 0.56, 0, "#b98a52"), boxAt(0.95, 0.9, 1.15, 0, 1.05, 0, "#eef2f6")]),
      beacon: colored(new THREE.SphereGeometry(0.08, 8, 8).translate(0.4, 0.55, -0.6), "#ffffff"),
    }),
    [],
  );
  const color = useMemo(() => new THREE.Color(), []);
  useLayoutEffect(() => {
    AGVS.forEach((a, i) => beacon.current?.setColorAt(i, color.set("#ff8a00")));
  }, [color]);
  useFrame(({ clock }, raw) => {
    const dt = Math.min(raw, 0.05);
    AGVS.forEach((a, i) => {
      const s = state.current[i];
      s.d += dt * 3.2;
      const p = pointOnLoop(s.d);
      let diff = p.h - s.h;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      s.h += diff * Math.min(1, dt * 8);
      dummy.position.set(p.x, 0.1, p.z);
      dummy.rotation.set(0, s.h, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      body.current?.setMatrixAt(i, dummy.matrix);
      beacon.current?.setMatrixAt(i, dummy.matrix);
      if (!a.loaded) {
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
      }
      load.current?.setMatrixAt(i, dummy.matrix);
      dummy.scale.setScalar(1);
      beacon.current?.setColorAt(i, color.set(Math.sin(clock.elapsedTime * 7 + a.offset) > 0 ? "#ff8a00" : "#4a2a00"));
    });
    for (const m of [body.current, load.current, beacon.current]) if (m) m.instanceMatrix.needsUpdate = true;
    if (beacon.current?.instanceColor) beacon.current.instanceColor.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={body} args={[geos.body, undefined, AGVS.length]} frustumCulled={false}>
        <meshStandardMaterial vertexColors roughness={0.45} />
      </instancedMesh>
      <instancedMesh ref={load} args={[geos.load, undefined, AGVS.length]} frustumCulled={false}>
        <meshStandardMaterial vertexColors roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={beacon} args={[geos.beacon, undefined, AGVS.length]} frustumCulled={false}>
        <meshBasicMaterial vertexColors toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

export default function Movers({ pal }: { pal: TwinPalette }) {
  return (
    <group>
      <Belts pal={pal} />
      <CupStream conv={CONVEYOR_A} kind="SG" n={64} />
      <CupStream conv={CONVEYOR_B} kind="TF" n={48} />
      <Agvs />
    </group>
  );
}
