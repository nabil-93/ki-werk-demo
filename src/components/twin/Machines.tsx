"use client";

// 3D-Modelle der Spritzgießmaschinen (IML) und Thermoformer mit Live-Status.
// Performance: Jedes Bauteil wird als InstancedMesh für ALLE Maschinen eines Typs gezeichnet
// (1 Draw Call je Bauteil statt 1 je Bauteil und Maschine).
// Rollout Phase 2: Die noch nicht angebundenen Maschinen laufen mit (sie produzieren ja),
// haben aber eine dunkle Signalsäule und einen gestrichelten Rahmen – die KI hat von ihnen keine Daten.

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useUi } from "@/lib/client/store";
import { PHASE2_SEED } from "@/lib/sim/catalog";
import { colored, mergeAll } from "./merge";
import type { MachineStatus, MachineView } from "@/lib/sim/types";
import { MACHINE_SPOTS, PHASE2_SPOTS, SPOT, type MachineSpot } from "./layout";
import type { TwinPalette } from "./palette";

// ---------------------------------------------------------------- Bauteil-Definitionen

type Geo = ["box", [number, number, number]] | ["cyl", [number, number, number, number]] | ["plane", [number, number]];

interface MatDef {
  color: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  wireframe?: boolean;
  /** leuchtendes Bauteil: Basic-Material, Farbe je Instanz */
  glow?: boolean;
  double?: boolean;
}

interface Ctx {
  m?: Pick<MachineView, "status" | "targetCycle">;
  t: number; // Zeit inkl. Phasenversatz
  /** nicht angebundene Maschine: läuft, liefert aber keine Daten */
  ghost?: boolean;
}

/** Ersatzzustand für nicht angebundene Maschinen: Bewegung im Solltakt, ohne Live-Status */
const GHOST: Record<string, Ctx["m"]> = Object.fromEntries(Object.values(PHASE2_SEED).map((s) => [s.id, { status: "PRODUKTION" as const, targetCycle: s.targetCycle }]));
const GHOST_TOWER = "#3a3f47";

interface PartDef {
  key: string;
  geo: Geo;
  pos: [number, number, number];
  rot?: [number, number, number];
  mat: MatDef;
  cast?: boolean;
  /** dynamischer Versatz (lokal) je Frame */
  offset?: (c: Ctx) => [number, number, number];
  /** Farbe je Instanz (nur glow-Teile) */
  color?: (c: Ctx) => string;
}

const ON = { red: "#ff3b3b", amber: "#ffb000", green: "#19d36b", blue: "#3b82ff" };
const OFF = { red: "#5a2a2a", amber: "#5a4a22", green: "#21452f", blue: "#22355a" };

function towerOn(status: MachineStatus | undefined, k: keyof typeof ON, t: number) {
  if (!status) return false;
  if (k === "green") return status === "PRODUKTION";
  if (k === "amber") return status === "RUESTEN";
  if (k === "blue") return status === "WARTUNG";
  return status === "STOERUNG" && Math.sin(t * 9) > 0;
}

function towerParts(base: [number, number, number], pal: TwinPalette): PartDef[] {
  const [x, y, z] = base;
  const seg = (k: keyof typeof ON, dy: number): PartDef => ({
    key: `tower-${k}`,
    geo: ["cyl", [0.13, 0.13, 0.17, 14]],
    pos: [x, y + dy, z],
    mat: { color: "#ffffff", glow: true },
    color: ({ m, t, ghost }) => (ghost ? GHOST_TOWER : towerOn(m?.status, k, t) ? ON[k] : OFF[k]),
  });
  return [
    { key: "tower-pole", geo: ["cyl", [0.04, 0.04, 0.4, 8]], pos: [x, y + 0.2, z], mat: { color: pal.steel } },
    seg("blue", 0.48),
    seg("green", 0.66),
    seg("amber", 0.84),
    seg("red", 1.02),
    { key: "tower-cap", geo: ["cyl", [0.13, 0.13, 0.04, 14]], pos: [x, y + 1.13, z], mat: { color: pal.machineDark } },
  ];
}

/** Roboter-Bewegung: Einfahren in die Form im Takt der Maschine */
function robotInOut({ m, t }: Ctx) {
  if (m?.status !== "PRODUKTION") return 0;
  const cyc = m.targetCycle || 4;
  return Math.max(0, Math.sin(((t % cyc) / cyc) * Math.PI * 2));
}

function sgParts(pal: TwinPalette): PartDef[] {
  const heat = ({ m, t }: Ctx) => (m?.status === "PRODUKTION" ? (Math.sin(t * 2) > -0.2 ? "#ff7a1a" : "#ff8c33") : m?.status === "RUESTEN" ? "#a8501f" : "#4a3426");
  return [
    { key: "bed", geo: ["box", [8, 0.9, 2.2]], pos: [0, 0.45, 0], mat: { color: pal.machineDark, roughness: 0.6 }, cast: true },
    { key: "body", geo: ["box", [7.0, 0.9, 1.9]], pos: [0.4, 1.35, 0], mat: { color: pal.machineBody, roughness: 0.45 }, cast: true },
    { key: "clamp", geo: ["box", [2.8, 1.5, 2.05]], pos: [-2.2, 2.15, 0], mat: { color: pal.machineBody, roughness: 0.4 }, cast: true },
    { key: "door", geo: ["plane", [2.3, 1.05]], pos: [-2.2, 2.15, 1.035], mat: { color: "#1c2733", roughness: 0.1, metalness: 0.4, opacity: 0.85 } },
    { key: "clamp-top", geo: ["box", [2.9, 0.06, 2.1]], pos: [-2.2, 2.92, 0], mat: { color: pal.machineAccent } },
    { key: "barrel", geo: ["cyl", [0.26, 0.26, 3.2, 18]], pos: [1.7, 2.12, 0], rot: [0, 0, Math.PI / 2], mat: { color: pal.steel, metalness: 0.6, roughness: 0.35 } },
    ...[0.6, 1.3, 2.0].map<PartDef>((x, i) => ({ key: `band-${i}`, geo: ["cyl", [0.31, 0.31, 0.26, 18]], pos: [x, 2.12, 0], rot: [0, 0, Math.PI / 2], mat: { color: "#ffffff", glow: true }, color: heat })),
    { key: "hopper", geo: ["cyl", [0.46, 0.14, 0.85, 14]], pos: [2.55, 2.85, 0], mat: { color: pal.machineAccent, roughness: 0.4 } },
    { key: "loader", geo: ["cyl", [0.2, 0.2, 0.4, 12]], pos: [2.55, 3.45, 0], mat: { color: pal.steel } },
    { key: "terminal", geo: ["box", [0.9, 0.75, 0.12]], pos: [3.5, 1.75, 1.2], mat: { color: pal.machineDark } },
    {
      key: "screen",
      geo: ["plane", [0.78, 0.55]],
      pos: [3.5, 1.78, 1.265],
      mat: { color: "#ffffff", glow: true },
      color: ({ m, t, ghost }) => (ghost ? "#262d37" : m?.status === "STOERUNG" ? (Math.sin(t * 8) > 0 ? "#ff3b3b" : "#7a1d1d") : m?.status === "PRODUKTION" ? "#3b82ff" : "#1f3a6b"),
    },
    { key: "robot-post", geo: ["box", [0.28, 3.4, 0.28]], pos: [-2.2, 2.4, -1.55], mat: { color: "#e7b416", roughness: 0.5 } },
    { key: "robot-beam", geo: ["box", [0.32, 0.32, 2.4]], pos: [-2.2, 4.0, -0.5], mat: { color: "#e7b416", roughness: 0.5 } },
    { key: "robot-carriage", geo: ["box", [0.46, 0.34, 0.4]], pos: [-2.2, 3.8, -0.6], mat: { color: pal.machineDark }, offset: (c) => [0, 0, robotInOut(c) * 1.25] },
    {
      key: "robot-arm",
      geo: ["box", [0.12, 0.9, 0.12]],
      pos: [-2.2, 3.25, -0.6],
      mat: { color: pal.steel, metalness: 0.5 },
      offset: (c) => {
        const k = robotInOut(c);
        return [0, c.m?.status === "PRODUKTION" ? -0.15 - k * 0.55 : 0, k * 1.25];
      },
    },
    {
      key: "robot-grip",
      geo: ["box", [0.5, 0.08, 0.32]],
      pos: [-2.2, 2.78, -0.6],
      mat: { color: pal.machineDark },
      offset: (c) => {
        const k = robotInOut(c);
        return [0, c.m?.status === "PRODUKTION" ? -0.15 - k * 0.55 : 0, k * 1.25];
      },
    },
    { key: "box-wire", geo: ["box", [0.95, 0.95, 0.75]], pos: [-3.6, 0.5, 1.75], mat: { color: "#8d97a3", wireframe: true } },
    { key: "box-fill", geo: ["box", [0.85, 0.6, 0.65]], pos: [-3.6, 0.35, 1.75], mat: { color: "#f4f6f8" } },
    ...towerParts([-3.75, 2.9, -0.75], pal),
  ];
}

function tfParts(pal: TwinPalette): PartDef[] {
  return [
    { key: "bed", geo: ["box", [12, 1.0, 2.4]], pos: [0, 0.5, 0], mat: { color: pal.machineDark, roughness: 0.6 }, cast: true },
    { key: "body", geo: ["box", [11.2, 0.7, 2.2]], pos: [0.2, 1.35, 0], mat: { color: pal.machineBody, roughness: 0.45 }, cast: true },
    { key: "roll", geo: ["cyl", [0.75, 0.75, 2.0, 24]], pos: [-6.3, 1.45, 0], rot: [Math.PI / 2, 0, 0], mat: { color: "#eef3f8", roughness: 0.25, metalness: 0.05 } },
    { key: "roll-core", geo: ["cyl", [0.2, 0.2, 2.15, 10]], pos: [-6.3, 1.45, 0], rot: [Math.PI / 2, 0, 0], mat: { color: pal.steel } },
    { key: "film", geo: ["box", [7.2, 0.02, 1.8]], pos: [-2.6, 1.72, 0], mat: { color: "#f6f8fb", opacity: 0.9 } },
    { key: "heater", geo: ["box", [3.2, 0.7, 2.3]], pos: [-3.2, 2.35, 0], mat: { color: pal.machineBody } },
    {
      key: "heater-glow",
      geo: ["plane", [3.0, 2.1]],
      pos: [-3.2, 1.98, 0],
      rot: [Math.PI / 2, 0, 0],
      mat: { color: "#ffffff", glow: true, double: true },
      color: ({ m, t }) => (m?.status === "PRODUKTION" ? (Math.sin(t * 3) > 0 ? "#ff6a10" : "#ff7f2a") : m?.status === "RUESTEN" ? "#a8461a" : "#3a1a0a"),
    },
    { key: "forming", geo: ["box", [2.6, 1.7, 2.5]], pos: [0.6, 2.4, 0], mat: { color: pal.machineBody, roughness: 0.35 }, cast: true },
    {
      key: "press",
      geo: ["box", [2.0, 0.35, 2.0]],
      pos: [0.6, 3.35, 0],
      mat: { color: pal.steel, metalness: 0.55, roughness: 0.35 },
      offset: ({ m, t }) => {
        if (m?.status !== "PRODUKTION") return [0, 0, 0];
        const cyc = m.targetCycle || 2.4;
        return [0, -Math.abs(Math.sin(((t % cyc) / cyc) * Math.PI)) * 0.45, 0];
      },
    },
    { key: "rod-a", geo: ["cyl", [0.12, 0.12, 0.8, 10]], pos: [0.6, 3.8, -0.75], mat: { color: pal.steel, metalness: 0.6 } },
    { key: "rod-b", geo: ["cyl", [0.12, 0.12, 0.8, 10]], pos: [0.6, 3.8, 0.75], mat: { color: pal.steel, metalness: 0.6 } },
    { key: "stacker", geo: ["box", [2.8, 1.1, 2.1]], pos: [4.4, 1.95, 0], mat: { color: pal.machineAccent } },
    ...[-0.55, 0, 0.55].map<PartDef>((z, i) => ({ key: `stack-${i}`, geo: ["cyl", [0.16, 0.12, 0.55, 10]], pos: [5.6, 2.75, z], mat: { color: "#ffffff", roughness: 0.3 } })),
    { key: "terminal", geo: ["box", [0.8, 0.65, 0.1]], pos: [2.6, 1.8, 1.25], mat: { color: "#ffffff", glow: true }, color: ({ m }) => (m?.status === "STOERUNG" ? "#b42323" : "#2b4fa8") },
    ...towerParts([2.2, 3.25, -1.0], pal),
  ];
}

// ---------------------------------------------------------------- Instanziertes Bauteil

const tmpM = new THREE.Matrix4();
const tmpLocal = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const tmpColor = new THREE.Color();

function spotMatrix(s: MachineSpot) {
  return new THREE.Matrix4().compose(new THREE.Vector3(s.x, 0, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot), ONE);
}

function makeGeo(g: Geo) {
  if (g[0] === "box") return new THREE.BoxGeometry(...g[1]);
  if (g[0] === "plane") return new THREE.PlaneGeometry(...g[1]);
  return new THREE.CylinderGeometry(g[1][0], g[1][1], g[1][2], g[1][3]);
}

/**
 * Bewegte/leuchtende Bauteile: gleichartige Teile (z. B. alle 4 Leuchten der Signalsäule, alle Heizbänder)
 * teilen sich EIN InstancedMesh über alle Maschinen – Instanz = Maschine × Teil.
 */
function PartGroup({ defs, spots, phases }: { defs: PartDef[]; spots: MachineSpot[]; phases: number[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => makeGeo(defs[0].geo), [defs]);
  useEffect(() => () => geo.dispose(), [geo]);
  const bases = useMemo(() => spots.map(spotMatrix), [spots]);
  const lastColor = useRef<string[]>([]);
  const n = defs.length;

  const writeMatrix = (i: number, k: number, off?: [number, number, number]) => {
    const def = defs[k];
    tmpE.set(def.rot?.[0] ?? 0, def.rot?.[1] ?? 0, def.rot?.[2] ?? 0);
    tmpQ.setFromEuler(tmpE);
    tmpV.set(def.pos[0] + (off?.[0] ?? 0), def.pos[1] + (off?.[1] ?? 0), def.pos[2] + (off?.[2] ?? 0));
    tmpLocal.compose(tmpV, tmpQ, ONE);
    tmpM.multiplyMatrices(bases[i], tmpLocal);
    ref.current!.setMatrixAt(i * n + k, tmpM);
  };

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < spots.length; i++)
      for (let k = 0; k < n; k++) {
        writeMatrix(i, k, defs[k].offset?.({ t: 0 }));
        if (defs[k].color) mesh.setColorAt(i * n + k, tmpColor.set("#333333"));
      }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [spots, bases]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const machines = useUi.getState().snap?.machines;
    let mDirty = false;
    let cDirty = false;
    for (let i = 0; i < spots.length; i++) {
      const m = machines?.find((x) => x.id === spots[i].id);
      const ghost = !m && !!GHOST[spots[i].id];
      const ctx: Ctx = { m: m ?? GHOST[spots[i].id], t: clock.elapsedTime + phases[i], ghost };
      for (let k = 0; k < n; k++) {
        const def = defs[k];
        if (def.offset) {
          writeMatrix(i, k, def.offset(ctx));
          mDirty = true;
        }
        if (def.color) {
          const col = def.color(ctx);
          if (lastColor.current[i * n + k] !== col) {
            lastColor.current[i * n + k] = col;
            mesh.setColorAt(i * n + k, tmpColor.set(col));
            cDirty = true;
          }
        }
      }
    }
    if (mDirty) mesh.instanceMatrix.needsUpdate = true;
    if (cDirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  const mt = defs[0].mat;
  return (
    <instancedMesh ref={ref} args={[geo, undefined, spots.length * n]} castShadow={defs[0].cast} frustumCulled={false}>
      {mt.glow ? (
        <meshBasicMaterial color={mt.color} toneMapped={false} side={mt.double ? THREE.DoubleSide : THREE.FrontSide} />
      ) : (
        <meshStandardMaterial color={mt.color} roughness={mt.roughness ?? 0.6} metalness={mt.metalness ?? 0} />
      )}
    </instancedMesh>
  );
}

const isStatic = (p: PartDef) => !p.offset && !p.color && !p.mat.glow && !p.mat.wireframe;

/** Flotte: alle statischen Teile in einer Geometrie, bewegte Teile gruppiert instanziert */
function MachineFleet({ parts, spots }: { parts: PartDef[]; spots: MachineSpot[] }) {
  const phases = useMemo(() => spots.map((_, i) => i * 1.37), [spots]);
  const { stat, groups } = useMemo(() => {
    const dyn = new Map<string, PartDef[]>();
    for (const p of parts) {
      if (isStatic(p) || p.mat.wireframe) continue;
      const k = JSON.stringify([p.geo, p.mat, p.rot ?? null, Boolean(p.offset), Boolean(p.cast)]);
      dyn.set(k, [...(dyn.get(k) ?? []), p]);
    }
    return { stat: parts.filter(isStatic), groups: [...dyn.values()] };
  }, [parts]);
  return (
    <group>
      <StaticFleet parts={stat} spots={spots} />
      {groups.map((g) => (
        <PartGroup key={g[0].key} defs={g} spots={spots} phases={phases} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- Bodenplatte + Treffer

/** gestrichelter Rahmen (Quads in der xy-Ebene) – Kennzeichen „nicht angebunden“ */
function dashedRect(w: number, d: number, dash = 0.75, gap = 0.45, th = 0.16) {
  const pos: number[] = [];
  const quad = (x0: number, y0: number, x1: number, y1: number) => pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
  const side = (len: number, put: (a: number, b: number) => void) => {
    for (let s = 0; s < len; s += dash + gap) put(s, Math.min(len, s + dash));
  };
  const x = -w / 2, y = -d / 2;
  side(w, (a, b) => {
    quad(x + a, y, x + b, y + th);
    quad(x + a, y + d - th, x + b, y + d);
  });
  side(d, (a, b) => {
    quad(x, y + a, x + th, y + b);
    quad(x + w - th, y + a, x + w, y + b);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Bodenplatte: Status-Rahmen + KI-Risiko-Halo + Auswahl (+ gestrichelt, solange nicht angebunden) */
function FloorRing({ id, w, d, pal, phase2 }: { id: string; w: number; d: number; pal: TwinPalette; phase2?: boolean }) {
  const plateMesh = useRef<THREE.Mesh>(null);
  const plate = useRef<THREE.MeshBasicMaterial>(null);
  const halo = useRef<THREE.Mesh>(null);
  const haloMat = useRef<THREE.MeshBasicMaterial>(null);
  const sel = useRef<THREE.Mesh>(null);
  const dash = useRef<THREE.Mesh>(null);
  const dashGeo = useMemo(() => (phase2 ? dashedRect(w + 0.6, d + 0.6) : null), [phase2, w, d]);
  useEffect(() => () => dashGeo?.dispose(), [dashGeo]);
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    const r = 0.6;
    const x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r);
    s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d);
    s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    const hole = new THREE.Path();
    const t = 0.18;
    hole.moveTo(x + t + r, y + t);
    hole.lineTo(x + w - t - r, y + t);
    hole.quadraticCurveTo(x + w - t, y + t, x + w - t, y + t + r);
    hole.lineTo(x + w - t, y + d - t - r);
    hole.quadraticCurveTo(x + w - t, y + d - t, x + w - t - r, y + d - t);
    hole.lineTo(x + t + r, y + d - t);
    hole.quadraticCurveTo(x + t, y + d - t, x + t, y + d - t - r);
    hole.lineTo(x + t, y + t + r);
    hole.quadraticCurveTo(x + t, y + t, x + t + r, y + t);
    s.holes.push(hole);
    return s;
  }, [w, d]);

  useFrame(({ clock }) => {
    const st = useUi.getState();
    if (sel.current) sel.current.visible = st.selectedMachine === id;
    const m = st.snap?.machines.find((x) => x.id === id);
    if (dash.current) dash.current.visible = !m;
    if (!m) return;
    const p = m.prediction?.p72 ?? 0;
    if (plate.current && plateMesh.current && plate.current.userData.s !== m.status) {
      plate.current.userData.s = m.status;
      const c = m.status === "STOERUNG" ? "#ff3b3b" : m.status === "WARTUNG" ? "#3b82ff" : m.status === "RUESTEN" ? "#ffb000" : pal.aisle;
      plate.current.color.set(c);
      // unsichtbare Platte gar nicht erst zeichnen
      plateMesh.current.visible = !(m.status === "PRODUKTION" || m.status === "STILLSTAND");
    }
    if (halo.current && haloMat.current) {
      const show = p >= 0.45 && m.status === "PRODUKTION";
      halo.current.visible = show;
      if (show) {
        const k = (Math.sin(clock.elapsedTime * (p >= 0.75 ? 5 : 3)) + 1) / 2;
        haloMat.current.color.set(p >= 0.75 ? "#ff3b3b" : "#ffb000");
        haloMat.current.opacity = 0.35 + 0.55 * k;
        const s = 1 + 0.035 * k;
        halo.current.scale.set(s, s, 1);
      }
    }
  });

  return (
    <group rotation-x={-Math.PI / 2} position={[0, 0.14, 0]}>
      <mesh ref={plateMesh} visible={false}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial ref={plate} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {dashGeo && (
        <mesh ref={dash} geometry={dashGeo} position={[0, 0, 0.004]}>
          <meshBasicMaterial color="#7d8896" transparent opacity={0.95} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      <mesh ref={halo} position={[0, 0, 0.005]} visible={false}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial ref={haloMat} color="#ffb000" transparent opacity={0.6} depthWrite={false} />
      </mesh>
      <mesh ref={sel} position={[0, 0, 0.01]} scale={[1.06, 1.12, 1]} visible={false}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color="#2b59ff" transparent opacity={0.95} depthWrite={false} />
      </mesh>
    </group>
  );
}

function onClick(id: string) {
  return (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const st = useUi.getState();
    st.selectMachine(st.selectedMachine === id ? null : id);
  };
}
const over = (e: ThreeEvent<PointerEvent>) => {
  e.stopPropagation();
  document.body.style.cursor = "pointer";
};
const out = () => {
  document.body.style.cursor = "";
};

function MachineSlot({ spot, pal, phase2 }: { spot: MachineSpot; pal: TwinPalette; phase2?: boolean }) {
  const sg = spot.id.startsWith("SG");
  return (
    <group position={[spot.x, 0, spot.z]} rotation-y={spot.rot}>
      <FloorRing id={spot.id} w={sg ? 9.2 : 13.4} d={sg ? 4.6 : 4.2} pal={pal} phase2={phase2} />
      {/* unsichtbare Trefferbox: 1 Raycast je Maschine, wird nicht gezeichnet */}
      <mesh position={[0, 2, 0]} onClick={onClick(spot.id)} onPointerOver={over} onPointerOut={out}>
        <boxGeometry args={sg ? [8.6, 4.2, 3.4] : [13, 4.2, 3]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}

// Rollout-Maschinen laufen in derselben Flotte mit (mehr Instanzen, keine zusätzlichen Draw Calls)
const SG_SPOTS = [...MACHINE_SPOTS.filter((s) => s.id.startsWith("SG")), ...PHASE2_SPOTS];
const TF_SPOTS = MACHINE_SPOTS.filter((s) => s.id.startsWith("TF"));

/** Statische Bauteile aller Maschinen einer Flotte in EINER Geometrie (1 Draw Call) */
function StaticFleet({ parts, spots }: { parts: PartDef[]; spots: MachineSpot[] }) {
  const geo = useMemo(() => {
    const list: THREE.BufferGeometry[] = [];
    for (const s of spots) {
      const base = spotMatrix(s);
      for (const p of parts) {
        if (p.mat.wireframe) continue;
        tmpE.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0);
        tmpLocal.compose(tmpV.set(...p.pos), tmpQ.setFromEuler(tmpE), ONE);
        list.push(colored(makeGeo(p.geo), p.mat.glow ? "#3d434b" : p.mat.color, tmpM.multiplyMatrices(base, tmpLocal)));
      }
    }
    return mergeAll(list);
  }, [parts, spots]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} castShadow receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.55} />
    </mesh>
  );
}

/** Datenstrom beim Anbinden einer Rollout-Maschine: Lichtsäule, aufsteigende Datenpakete, Pulsringe */
function LinkFx() {
  const group = useRef<THREE.Group>(null);
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const packets = useRef<(THREE.Mesh | null)[]>([]);
  const start = useRef({ id: null as string | null, t: 0 });
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const id = useUi.getState().linking;
    const s = id ? SPOT[id] : undefined;
    g.visible = !!s;
    if (!s) {
      start.current.id = null;
      return;
    }
    if (start.current.id !== id) {
      start.current = { id, t: clock.elapsedTime };
      g.position.set(s.x, 0, s.z);
    }
    const t = clock.elapsedTime - start.current.t;
    if (beam.current) beam.current.opacity = Math.min(1, t * 1.5) * (0.3 + 0.12 * Math.sin(t * 6));
    rings.current.forEach((r, i) => {
      if (!r) return;
      const k = (t * 0.8 + i / 3) % 1;
      r.scale.set(1 + k * 7, 1 + k * 7, 1);
      (r.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.7;
    });
    packets.current.forEach((p, i) => {
      if (!p) return;
      const k = (t * 0.55 + i / packets.current.length) % 1;
      p.position.y = 2.5 + k * 22;
      (p.material as THREE.MeshBasicMaterial).opacity = k < 0.85 ? 1 : (1 - k) / 0.15;
    });
  });
  return (
    <group ref={group} visible={false}>
      <mesh position={[0, 13, 0]}>
        <cylinderGeometry args={[0.45, 0.45, 26, 16, 1, true]} />
        <meshBasicMaterial ref={beam} color="#3b82ff" transparent opacity={0} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={`r${i}`} ref={(el) => void (rings.current[i] = el)} rotation-x={-Math.PI / 2} position={[0, 0.2, 0]}>
          <ringGeometry args={[0.9, 1.1, 48]} />
          <meshBasicMaterial color="#3b82ff" transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={`p${i}`} ref={(el) => void (packets.current[i] = el)} position={[0, 3, 0]}>
          <boxGeometry args={[0.42, 0.42, 0.42]} />
          <meshBasicMaterial color="#9cc2ff" transparent toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

export default function Machines({ pal }: { pal: TwinPalette }) {
  const sg = useMemo(() => sgParts(pal), [pal]);
  const tf = useMemo(() => tfParts(pal), [pal]);
  return (
    <group>
      <MachineFleet parts={sg} spots={SG_SPOTS} />
      <MachineFleet parts={tf} spots={TF_SPOTS} />
      {MACHINE_SPOTS.map((s) => (
        <MachineSlot key={s.id} spot={s} pal={pal} />
      ))}
      {PHASE2_SPOTS.map((s) => (
        <MachineSlot key={s.id} spot={s} pal={pal} phase2 />
      ))}
      <LinkFx />
    </group>
  );
}
