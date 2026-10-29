"use client";

// Werksgebäude auf echten Grundrissen: Südhalle (Spritzguss), Mittelhalle
// (Thermoformen + Lager & Versand, Rampen an der Westfassade), Halle C mit Hochregallager,
// Verwaltung, Zelthalle, Technikgebäude, Silos, Zaun und Werkstor mit Schranke.
// Performance: statische Teile sind je Material zu wenigen Geometrien zusammengeführt
// (wenige Draw Calls – wichtig für integrierte Grafik).

import { useFrame } from "@react-three/fiber";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useUi } from "@/lib/client/store";
import { CAMERA_STATION, DOCKS, DOORS, GATE, HALL_A_POLY, HALL_B_POLY, HRL_POLY, SILOS, WALL_H, WAREHOUSE } from "../layout";
import type { TwinPalette } from "../palette";
import { palletLoadTexture, textTexture } from "../textures";
import { StaticInstances } from "../instances";
import { boxAt, colored, cylAt, mergeAll } from "../merge";
import { WERK, ROADS } from "./siteData";
import { decode, Polyline, type V2 } from "./geo";
import { barrierTex, claddingTex, doorTex, flatRoof, officeTex, parapet, roofTex, wallsAlong } from "./buildKit";
import { barrier, cut, dockBusy, requestShadows, signal } from "./cutaway";
import { GATE_ROAD, JUNCTION, SIGNAL_STOP } from "./plan";
import { bodies } from "./vehicles";
import { SITE_POLY, terrainHeight } from "./terrain";
import { hallFloorTex } from "./floorPaint";

const P = (k: string) => decode(WERK[k]);
const tmpO = new THREE.Object3D();

// ---------------------------------------------------------------- Hallen mit Schnittansicht

function HallShell({ poly, height, cutKey, roof, dark, wallColor, floor }: { poly: V2[]; height: number; cutKey: keyof typeof cut; roof: "shed" | "skylights"; dark: boolean; wallColor: string; floor: "A" | "B" }) {
  const geo = useMemo(() => {
    const w = wallsAlong(poly, height, DOORS, { cap: dark ? "#6b7480" : "#5a616a" });
    // Dach + Attika in einer Geometrie
    const r = flatRoof(poly, height, 12, 12);
    const p = parapet(poly, height, 0.8);
    const roofGeo = mergeGeometries([r, p], false)!;
    r.dispose();
    p.dispose();
    return { ...w, roof: roofGeo, floor: new THREE.ShapeGeometry(new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)))) };
  }, [poly, height, dark]);
  const wallsRef = useRef<THREE.Group>(null);
  const lintel = useRef<THREE.Mesh>(null);
  const roofMesh = useRef<THREE.Mesh>(null);
  const roofMat = useRef<THREE.MeshLambertMaterial>(null);
  const clad = useMemo(() => claddingTex(dark ? "#2a3038" : wallColor, dark ? "#20252b" : "#c4c9cd"), [dark, wallColor]);
  const floorMap = useMemo(() => hallFloorTex(floor, dark), [floor, dark]);
  const last = useRef(-1);
  useFrame(() => {
    const c = cut[cutKey];
    if (Math.abs(c - last.current) < 0.002) return;
    const wasShadow = last.current < 0.5;
    last.current = c;
    // Wände bis auf ~3 m absenken, Dach ausblenden
    if (wallsRef.current) wallsRef.current.scale.y = 1 - c * (1 - 3.1 / height);
    if (lintel.current) lintel.current.visible = c < 0.2;
    if (roofMesh.current && roofMat.current) {
      roofMesh.current.visible = c < 0.985;
      // nur während des Überblendens transparent (spart Sortieren und Überzeichnen)
      const fading = c > 0.002;
      if (roofMat.current.transparent !== fading) {
        roofMat.current.transparent = fading;
        roofMat.current.needsUpdate = true;
      }
      roofMat.current.opacity = 1 - c;
      roofMat.current.depthWrite = c < 0.05;
      roofMesh.current.castShadow = c < 0.5;
    }
    if (wasShadow !== c < 0.5) requestShadows();
  });
  return (
    <group>
      <mesh geometry={geo.floor} rotation-x={-Math.PI / 2} position-y={0.1} receiveShadow>
        <meshLambertMaterial map={floorMap} />
      </mesh>
      <group ref={wallsRef}>
        <mesh geometry={geo.walls} castShadow receiveShadow>
          <meshLambertMaterial map={clad} vertexColors />
        </mesh>
      </group>
      {geo.lintels && (
        <mesh ref={lintel} geometry={geo.lintels} castShadow>
          <meshLambertMaterial map={clad} vertexColors />
        </mesh>
      )}
      <mesh ref={roofMesh} geometry={geo.roof} castShadow receiveShadow>
        {/* nachts leuchten die Lichtbänder/-kuppeln der beleuchteten Halle */}
        <meshLambertMaterial ref={roofMat} map={roofTex(roof, dark)} side={THREE.DoubleSide} emissiveMap={dark ? roofTex(roof, true) : null} emissive={dark ? "#9fb3d6" : "#000000"} emissiveIntensity={dark ? 0.6 : 0} />
      </mesh>
    </group>
  );
}

/** Trennwand Thermoformen | Lager und Verbindungsgang zur Südhalle (senken sich mit Halle B ab) */
function HallBInner({ dark }: { dark: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const roof = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => {
    const part = wallsAlong(
      [
        [62.6, 13],
        [116.3, 13],
      ],
      WALL_H.hallB,
      [
        { x: 70, z: 13, w: 4.5, h: 4.5 },
        { x: 108, z: 13, w: 4.5, h: 4.5 },
      ],
      { closed: false, cap: dark ? "#6b7480" : "#5a616a" },
    );
    const conn = wallsAlong([[87.2, 65], [87.2, 70.4]], 5.5, [], { closed: false, cap: dark ? "#6b7480" : "#5a616a" });
    const conn2 = wallsAlong([[92.8, 65], [92.8, 70.4]], 5.5, [], { closed: false, cap: dark ? "#6b7480" : "#5a616a" });
    const list = [part.walls, conn.walls, conn2.walls, ...(part.lintels ? [part.lintels] : [])];
    return mergeGeometries(list, false)!;
  }, [dark]);
  const clad = useMemo(() => claddingTex(dark ? "#2a3038" : "#e2e6ea", dark ? "#20252b" : "#c4c9cd"), [dark]);
  useFrame(() => {
    if (ref.current) ref.current.scale.y = 1 - cut.hallB * (1 - 3.1 / WALL_H.hallB);
    if (roof.current) roof.current.visible = cut.hallA < 0.5 && cut.hallB < 0.5;
  });
  return (
    <group>
      <group ref={ref}>
        <mesh geometry={geo} castShadow>
          <meshLambertMaterial map={clad} vertexColors />
        </mesh>
      </group>
      <mesh ref={roof} position={[90, 5.6, 67.7]} castShadow>
        <boxGeometry args={[6, 0.25, 5.4]} />
        <meshLambertMaterial color={dark ? "#3a414a" : "#b9bec2"} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- geschlossene Gebäude

interface BlockDef {
  poly: V2[];
  height: number;
  wall: "light" | "dark" | "beige" | "office";
  roof: string | "solar";
}

/**
 * Alle geschlossenen Gebäude: Wände je Fassadenmaterial zusammengeführt (inkl. Attika),
 * Flachdächer mit Vertexfarben in einer Geometrie, PV-Dach von Halle C separat.
 */
function ClosedBuildings({ dark }: { dark: boolean }) {
  const defs = useMemo<BlockDef[]>(
    () => [
      { poly: P("hallC"), height: 9.5, wall: "light", roof: "solar" },
      { poly: HRL_POLY, height: 24, wall: "dark", roof: dark ? "#2a2f35" : "#5d646b" },
      { poly: P("workshop"), height: 7, wall: "beige", roof: dark ? "#30363d" : "#a3a7aa" },
      { poly: P("utilA"), height: 8, wall: "light", roof: dark ? "#30363d" : "#e9ebea" },
      { poly: P("utilB"), height: 6, wall: "dark", roof: dark ? "#30363d" : "#8a9196" },
      { poly: P("utilC"), height: 4, wall: "beige", roof: dark ? "#4a2a26" : "#a6473a" },
      { poly: P("office"), height: 11.2, wall: "office", roof: dark ? "#30363d" : "#8f9498" },
    ],
    [dark],
  );
  const geo = useMemo(() => {
    const walls: Record<BlockDef["wall"], THREE.BufferGeometry[]> = { light: [], dark: [], beige: [], office: [] };
    const roofs: THREE.BufferGeometry[] = [];
    let solar: THREE.BufferGeometry | null = null;
    const parapetCol = dark ? "#3a414a" : "#c3c7ca";
    for (const d of defs) {
      const w = wallsAlong(d.poly, d.height, [], { tile: d.wall === "office" ? 7.2 : 4, cap: dark ? "#3a414a" : "#b9bec2" });
      walls[d.wall].push(w.walls, colored(parapet(d.poly, d.height, 0.6, 0.35), parapetCol));
      const roof = flatRoof(d.poly, d.height, 16, 16);
      if (d.roof === "solar") solar = roof;
      else roofs.push(colored(roof, d.roof));
    }
    // Eingangsvordach der Verwaltung
    roofs.push(boxAt(3.4, 0.3, 7, 84.2, 3.6, -66, dark ? "#3a414a" : "#cfd3d6"));
    return {
      walls: Object.fromEntries(Object.entries(walls).map(([k, v]) => [k, mergeAll(v)])) as Record<BlockDef["wall"], THREE.BufferGeometry>,
      roofs: mergeAll(roofs),
      solar: solar!,
    };
  }, [defs, dark]);
  const tex = useMemo(
    () => ({
      light: claddingTex(dark ? "#2a3038" : "#e6e8e6", dark ? "#20252b" : "#c7cbcd"),
      dark: claddingTex(dark ? "#22272d" : "#7a838c", dark ? "#1a1e23" : "#6a727a"),
      beige: claddingTex(dark ? "#2c2f33" : "#ded6c5", dark ? "#222528" : "#c9c0ae"),
      office: officeTex(dark),
    }),
    [dark],
  );
  return (
    <group>
      {(Object.keys(geo.walls) as BlockDef["wall"][]).map((k) => (
        <mesh key={k} geometry={geo.walls[k]} castShadow receiveShadow>
          {/* Bürofenster leuchten nachts */}
          <meshLambertMaterial map={tex[k]} vertexColors emissiveMap={dark && k === "office" ? tex[k] : null} emissive={dark && k === "office" ? "#ffffff" : "#000000"} emissiveIntensity={dark && k === "office" ? 0.85 : 0} />
        </mesh>
      ))}
      <mesh geometry={geo.roofs} castShadow receiveShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <mesh geometry={geo.solar} castShadow receiveShadow>
        <meshLambertMaterial map={roofTex("solar", dark)} />
      </mesh>
    </group>
  );
}

function OfficeSigns({ dark }: { dark: boolean }) {
  const sign = useMemo(() => textTexture("UNTERNEHMEN", { color: dark ? "#cfe0ff" : "#0b3a8c", size: 210, w: 1200, h: 300 }), [dark]);
  const sub = useMemo(() => textTexture("Verpackungen · Werk Nord", { color: dark ? "#9fb0c8" : "#2b3a52", size: 70, w: 1400, h: 140 }), [dark]);
  // Nordfassade zum Breiten Weg
  const [ax, az] = [89.8, -89.6], [bx, bz] = [109.2, -86.7];
  const ang = Math.atan2(-(bz - az), bx - ax);
  return (
    <group position={[(ax + bx) / 2, 0, (az + bz) / 2]} rotation-y={ang}>
      <mesh position={[0, 12.8, -0.4]} rotation-y={Math.PI}>
        <planeGeometry args={[12, 3]} />
        <meshBasicMaterial map={sign} transparent toneMapped={false} />
      </mesh>
      <mesh position={[0, 10.6, -0.25]} rotation-y={Math.PI}>
        <planeGeometry args={[13, 1.3]} />
        <meshBasicMaterial map={sub} transparent />
      </mesh>
    </group>
  );
}

/** Blauer Schriftzug auf allen Fassaden des Hochregallagers (vorn zur Einfahrt, hinten zum Hof, beide Seiten) */
function HrlLogo({ dark }: { dark: boolean }) {
  const logo = useMemo(() => textTexture("UNTERNEHMEN", { color: dark ? "#9cc0ff" : "#0b3a8c", size: 250, weight: 900, w: 1200, h: 300 }), [dark]);
  const faces = useMemo(() => {
    const cx = HRL_POLY.reduce((s, p) => s + p[0], 0) / HRL_POLY.length;
    const cz = HRL_POLY.reduce((s, p) => s + p[1], 0) / HRL_POLY.length;
    return HRL_POLY.map((a, i) => {
      const b = HRL_POLY[(i + 1) % HRL_POLY.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      // Außennormale (vom Gebäudemittelpunkt weg)
      let nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
      if (nx * (mx - cx) + nz * (mz - cz) < 0) (nx = -nx), (nz = -nz);
      return { x: mx + nx * 0.3, z: mz + nz * 0.3, rot: Math.atan2(nx, nz), w: Math.min(24, len * 0.86) };
    });
  }, []);
  return (
    <group>
      {faces.map((f, i) => (
        <mesh key={i} position={[f.x, 17.6, f.z]} rotation-y={f.rot}>
          <planeGeometry args={[f.w, f.w / 4]} />
          <meshBasicMaterial map={logo} transparent alphaTest={0.3} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Zusätzlich: großer Schriftzug über die ganze weiße Südfassade von Halle C
 * (zum Hof, gut lesbar auch in der Gesamtansicht)
 */
function HallCLogo({ dark }: { dark: boolean }) {
  const logo = useMemo(() => textTexture("UNTERNEHMEN", { color: dark ? "#9cc0ff" : "#0b3a8c", size: 250, weight: 900, w: 1200, h: 300 }), [dark]);
  // Gerade durch die Fassadenpunkte (−17,2 | −75,2) und (27,6 | −73,3): liegt überall knapp vor der Wand
  const [ax, az] = [-17.2, -75.2], [bx, bz] = [27.6, -73.3];
  const ang = Math.atan2(-(bz - az), bx - ax);
  const cx = 5, cz = az + ((cx - ax) / (bx - ax)) * (bz - az);
  const off = 0.2;
  return (
    <mesh position={[cx + Math.sin(ang) * off, 5.3, cz + Math.cos(ang) * off]} rotation-y={ang}>
      <planeGeometry args={[27, 6.75]} />
      <meshBasicMaterial map={logo} transparent alphaTest={0.3} toneMapped={false} />
    </mesh>
  );
}

const FLAG_POS: [number, number, number][] = [0, 1, 2].map((i) => [80.6, 8.1, -70 - i * 2.6]);

/** Fahnen: ein InstancedMesh, wehen leicht */
function Flags() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tex = useMemo(() => textTexture("UNTERNEHMEN", { color: "#ffffff", bg: "#0b3a8c", size: 120, w: 512, h: 300 }), []);
  const geo = useMemo(() => new THREE.PlaneGeometry(1.8, 1.05).translate(0.9, 0, 0), []);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    FLAG_POS.forEach((p, i) => {
      tmpO.position.set(...p);
      tmpO.rotation.set(0, Math.sin(clock.elapsedTime * 1.7 + i) * 0.22, 0);
      tmpO.updateMatrix();
      m.setMatrixAt(i, tmpO.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[geo, undefined, FLAG_POS.length]} frustumCulled={false}>
      <meshLambertMaterial map={tex} side={THREE.DoubleSide} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------- Silos

const SILO_H = 12;

/** Granulatsilos: Füllstand und Ampelfarbe live aus dem Materialbestand */
function Silos({ pal }: { pal: TwinPalette }) {
  const fill = useRef<THREE.InstancedMesh>(null);
  const shells = useRef<THREE.InstancedMesh>(null);
  const level = useRef(SILOS.map(() => 0.5));
  const lastCol = useRef<string[]>([]);
  const color = useMemo(() => new THREE.Color(), []);
  // Stützen, Rohre, Trichter, Dächer und Laufsteg in einer Geometrie
  const frame = useMemo(() => {
    const list: THREE.BufferGeometry[] = [];
    for (const s of SILOS) {
      for (const [x, z] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) list.push(boxAt(0.22, 3, 0.22, s.x + x, 1.5, s.z + z, pal.steel));
      list.push(boxAt(0.28, 0.28, 4.4, s.x, 3.6, s.z + 3.2, pal.steel));
      list.push(cylAt(1.8, 0.35, 1.6, 24, s.x, 2.6, s.z, pal.silo));
      list.push(cylAt(0.2, 1.85, 0.7, 24, s.x, 3 + SILO_H + 0.35, s.z, pal.wallTop));
    }
    list.push(boxAt(SILOS[SILOS.length - 1].x - SILOS[0].x + 3, 0.18, 1.1, (SILOS[0].x + SILOS[SILOS.length - 1].x) / 2, 15.8, SILOS[0].z, pal.steel));
    return mergeAll(list);
  }, [pal]);
  useLayoutEffect(() => {
    const m = shells.current;
    if (!m) return;
    SILOS.forEach((s, i) => m.setMatrixAt(i, new THREE.Matrix4().makeTranslation(s.x, 3 + SILO_H / 2, s.z)));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, []);
  useFrame(() => {
    const mesh = fill.current;
    const mats = useUi.getState().snap?.materials;
    if (!mesh || !mats) return;
    let moved = false, recolor = false;
    SILOS.forEach((s, i) => {
      const mat = mats.find((m) => m.id === s.material);
      if (!mat) return;
      const target = Math.max(0.03, Math.min(1, mat.stock / mat.capacity));
      const cur = level.current[i];
      if (Math.abs(target - cur) > 0.0005 || !lastCol.current[i]) {
        level.current[i] = THREE.MathUtils.lerp(cur, target, 0.08);
        tmpO.position.set(s.x, 3 + (SILO_H * level.current[i]) / 2, s.z);
        tmpO.rotation.set(0, 0, 0);
        tmpO.scale.set(1, level.current[i], 1);
        tmpO.updateMatrix();
        mesh.setMatrixAt(i, tmpO.matrix);
        moved = true;
      }
      const c = mat.state === "crit" ? "#ff4b55" : mat.state === "warn" ? "#ffb000" : "#4c8dff";
      if (lastCol.current[i] !== c) {
        lastCol.current[i] = c;
        mesh.setColorAt(i, color.set(c));
        recolor = true;
      }
    });
    tmpO.scale.set(1, 1, 1);
    if (moved) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    if (recolor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.visible = true;
  });
  return (
    <group>
      <mesh geometry={frame} castShadow>
        <meshStandardMaterial vertexColors roughness={0.45} metalness={0.35} />
      </mesh>
      <instancedMesh ref={shells} args={[undefined, undefined, SILOS.length]}>
        <cylinderGeometry args={[1.8, 1.8, SILO_H, 28, 1, true]} />
        <meshStandardMaterial color={pal.silo} transparent opacity={0.42} side={THREE.DoubleSide} roughness={0.3} metalness={0.3} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={fill} args={[undefined, undefined, SILOS.length]} visible={false}>
        <cylinderGeometry args={[1.65, 1.65, SILO_H, 24]} />
        <meshStandardMaterial roughness={0.7} emissive="#1a3a80" emissiveIntensity={0.25 * pal.emissiveBoost} />
      </instancedMesh>
    </group>
  );
}

// ---------------------------------------------------------------- Rampen / Tore

const DOCK_OUT = DOCKS.map((d) => ({ ...d, ox: d.x - 0.35 })); // Außenkante Torabdichtung

function Docks({ dark }: { dark: boolean }) {
  const lights = useRef<THREE.InstancedMesh>(null);
  const doors = useRef<THREE.InstancedMesh>(null);
  const lastLight = useRef("");
  const open = useRef(DOCKS.map(() => 1));
  const color = useMemo(() => new THREE.Color(), []);
  // Torabdichtungen (Rahmen) und Puffer als eine Geometrie
  const frames = useMemo(() => {
    const c = dark ? "#15181c" : "#2a2e34";
    const list: THREE.BufferGeometry[] = [];
    for (const d of DOCK_OUT) {
      for (const dz of [-1.85, 1.85]) list.push(boxAt(0.7, 3.8, 0.35, d.ox - 0.3, 1.9, d.z + dz, c));
      list.push(boxAt(0.7, 0.4, 4.05, d.ox - 0.3, 3.75, d.z, c));
      for (const dz of [-1.2, 1.2]) list.push(boxAt(0.25, 0.45, 0.35, d.ox - 0.25, 1.2, d.z + dz, "#111316"));
    }
    return mergeAll(list);
  }, [dark]);
  const doorGeo = useMemo(() => new THREE.PlaneGeometry(3.2, 3.4), []);
  useLayoutEffect(() => {
    const m = lights.current;
    if (!m) return;
    DOCK_OUT.forEach((d, i) => {
      m.setMatrixAt(i, new THREE.Matrix4().makeTranslation(d.ox - 0.45, 3.1, d.z - 2.1));
      m.setColorAt(i, color.set("#19d36b"));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [color]);
  useFrame((_, dt) => {
    // Ampel rot, solange ein LKW angedockt ist; Tor fährt dann hoch
    const key = DOCKS.map((d) => (dockBusy.has(d.dock) ? 1 : 0)).join("");
    if (lights.current && key !== lastLight.current) {
      lastLight.current = key;
      DOCKS.forEach((_, i) => lights.current!.setColorAt(i, color.set(key[i] === "1" ? "#ff3b3b" : "#19d36b")));
      if (lights.current.instanceColor) lights.current.instanceColor.needsUpdate = true;
    }
    const m = doors.current;
    if (!m) return;
    let dirty = false;
    DOCKS.forEach((d, i) => {
      const target = dockBusy.has(d.dock) ? 0.12 : 1;
      const s = THREE.MathUtils.damp(open.current[i], target, 2.5, dt);
      if (Math.abs(s - open.current[i]) < 1e-4 && m.userData.init) return;
      open.current[i] = s;
      tmpO.position.set(d.x, 3.4 - (3.4 * s) / 2, d.z);
      tmpO.rotation.set(0, -Math.PI / 2, 0);
      tmpO.scale.set(1, s, 1);
      tmpO.updateMatrix();
      m.setMatrixAt(i, tmpO.matrix);
      dirty = true;
    });
    tmpO.scale.set(1, 1, 1);
    if (dirty) {
      m.userData.init = true;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  });
  return (
    <group>
      <mesh geometry={frames} castShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <instancedMesh ref={doors} args={[doorGeo, undefined, DOCKS.length]}>
        <meshLambertMaterial map={doorTex()} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={lights} args={[undefined, undefined, DOCKS.length]}>
        <boxGeometry args={[0.16, 0.3, 0.3]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {/* unsichtbare Klickflächen: Rampe anklicken → LKW dieser Rampe heute */}
      {DOCKS.map((d) => (
        <mesh
          key={d.dock}
          position={[d.x - 0.6, 2.1, d.z]}
          onClick={(e) => {
            e.stopPropagation();
            useUi.getState().openDock(d.dock);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            document.body.style.cursor = "";
          }}
        >
          <boxGeometry args={[1.6, 4.2, 4.0]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- Lager (Hochregale)

const RACK_ROWS = Array.from({ length: 8 }, (_, i) => WAREHOUSE.z0 + 4 + i * 6.2); // Doppelregale
const RACK_X0 = 76, RACK_SLOTS = 26, RACK_PITCH = 1.42, RACK_LEVELS = 5;

function Racks({ pal }: { pal: TwinPalette }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const slots = useMemo(() => {
    const out: [number, number, number][] = [];
    for (const z of RACK_ROWS)
      for (const side of [-0.68, 0.68])
        for (let i = 0; i < RACK_SLOTS; i++) for (let lvl = 0; lvl < RACK_LEVELS; lvl++) out.push([RACK_X0 + 0.7 + i * RACK_PITCH, 0.6 + lvl * 1.4, z + side]);
    return out;
  }, []);
  // Rahmen und Traversen als eine Geometrie
  const frame = useMemo(() => {
    const list: THREE.BufferGeometry[] = [];
    for (const z of RACK_ROWS) {
      for (let i = 0; i <= Math.ceil(RACK_SLOTS / 2); i++) for (const dz of [-0.68, 0.68]) list.push(boxAt(0.12, 7.2, 0.12, RACK_X0 + i * RACK_PITCH * 2, 3.6, z + dz, pal.rack));
      for (const dz of [-0.68, 0.68]) for (let l = 0; l < RACK_LEVELS; l++) list.push(boxAt(RACK_SLOTS * RACK_PITCH, 0.12, 0.12, RACK_X0 + (RACK_SLOTS * RACK_PITCH) / 2, 0.05 + l * 1.4, z + dz, "#e07a10"));
    }
    return mergeAll(list);
  }, [pal]);
  const tex = useMemo(() => palletLoadTexture(), []);
  const lastUsed = useRef(-1);
  useFrame(() => {
    const k = useUi.getState().snap?.kpis;
    if (!ref.current || !k) return;
    const used = Math.round((k.warehouseUsed / k.warehouseCapacity) * slots.length);
    if (used === lastUsed.current) return;
    lastUsed.current = used;
    slots.forEach(([x, y, z], i) => {
      tmpO.position.set(x, y, z);
      tmpO.rotation.set(0, 0, 0);
      const on = (i * 7919) % slots.length < used;
      tmpO.scale.setScalar(on ? 1 : 0.0001);
      tmpO.updateMatrix();
      ref.current!.setMatrixAt(i, tmpO.matrix);
    });
    tmpO.scale.setScalar(1);
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <mesh geometry={frame}>
        <meshLambertMaterial vertexColors />
      </mesh>
      <instancedMesh ref={ref} args={[undefined, undefined, slots.length]} castShadow>
        <boxGeometry args={[1.15, 1.05, 1.0]} />
        <meshLambertMaterial map={tex} />
      </instancedMesh>
    </group>
  );
}

// ---------------------------------------------------------------- Einbauten in den Hallen

/** Etikettenlager, Verpackung, Folienrollen, Bereitstellung, Stretchwickler, Labortisch – eine Geometrie */
function Interior({ pal, dark }: { pal: TwinPalette; dark: boolean }) {
  const geo = useMemo(() => {
    const list: THREE.BufferGeometry[] = [];
    for (const x of [-11.5, -8.3, -5.1]) {
      list.push(boxAt(1.3, 3.2, 40, x, 1.6, 95, dark ? "#2f3a55" : "#9fb2d8"));
      for (let z = 76; z < 114; z += 1.3) for (let y = 0; y < 3; y++) if ((x * 7 + z * 3 + y) % 5 > 1) list.push(boxAt(1.1, 0.8, 1.1, x, 0.45 + y * 1.05, z, dark ? "#4a4f57" : "#e8e1d0"));
    }
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) list.push(boxAt(1.2, 1.2, 1.0, 104.5 + i * 1.6, 0.6, 111.6 + j * 1.4, "#eef2f6"));
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) list.push(cylAt(0.75, 0.75, 1.5, 14, 65 + i * 1.6, 0.8, -26.5 + j * 2.3, "#f4f7fa", [Math.PI / 2, 0, 0]));
    DOCKS.forEach((d, k) => {
      for (let i = 0; i < 2 + (k % 2); i++) list.push(boxAt(1.15, 1.1, 1.0, d.x + 2.6 + i * 1.5, 0.6, d.z + (i % 2 ? 0.7 : -0.7), "#e9edf2"));
    });
    list.push(cylAt(1.3, 1.3, 0.25, 24, 109, 0.13, 117, pal.machineDark), boxAt(0.3, 3.6, 0.3, 110.7, 1.8, 117, "#e7b416"));
    list.push(boxAt(6, 0.9, 1.4, 105.5, 0.45, 79, dark ? "#3a414a" : "#e6e8ea"));
    return mergeAll(list);
  }, [pal, dark]);
  const glass = useMemo(
    () =>
      mergeAll([
        boxAt(11, 2.8, 0.06, 105.5, 1.4, 75, "#bcd8ec"),
        boxAt(11, 2.8, 0.06, 105.5, 1.4, 83, "#bcd8ec"),
        boxAt(0.06, 2.8, 8, 100, 1.4, 79, "#bcd8ec"),
      ]),
    [],
  );
  return (
    <group>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <mesh geometry={glass}>
        <meshStandardMaterial vertexColors transparent opacity={0.28} roughness={0.05} metalness={0.2} depthWrite={false} />
      </mesh>
    </group>
  );
}

function CameraGantry({ pal }: { pal: TwinPalette }) {
  const scan = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const geo = useMemo(() => {
    const { x, z } = CAMERA_STATION;
    return mergeAll([boxAt(0.2, 3, 0.2, x, 1.5, z - 1.2, pal.machineDark), boxAt(0.2, 3, 0.2, x, 1.5, z + 1.2, pal.machineDark), boxAt(0.6, 0.35, 2.7, x, 3, z, pal.machineDark), boxAt(0.36, 0.3, 0.36, x, 2.7, z, "#1fb8d4")]);
  }, [pal]);
  useFrame(({ clock }) => {
    if (scan.current) scan.current.position.x = CAMERA_STATION.x + Math.sin(clock.elapsedTime * 2.2) * 0.5;
    if (mat.current) {
      const q = useUi.getState().snap?.machines.some((m) => m.spcViolation || m.scrapRate > 0.02);
      mat.current.color.set(q ? "#ffb000" : "#22d3ee");
      mat.current.opacity = 0.32 + 0.18 * Math.sin(clock.elapsedTime * 6);
    }
  });
  const sign = useMemo(() => textTexture("KI-Kamera · QS", { color: "#ffffff", bg: "#2b59ff", size: 64, w: 700, h: 140 }), []);
  return (
    <group>
      <mesh geometry={geo} castShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <mesh ref={scan} position={[CAMERA_STATION.x, 1.9, CAMERA_STATION.z]}>
        <boxGeometry args={[0.04, 1.6, 1.8]} />
        <meshBasicMaterial ref={mat} color="#22d3ee" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <mesh position={[CAMERA_STATION.x, 3.55, CAMERA_STATION.z]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[2.4, 0.48]} />
        <meshBasicMaterial map={sign} transparent side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** Zelthalle: zwei Bogenhallen (je ~15 m Spannweite) wie im Luftbild, eine Geometrie */
function Tent({ dark }: { dark: boolean }) {
  const geo = useMemo(() => {
    const t = P("tent");
    const x0 = Math.min(...t.map((p) => p[0])), x1 = Math.max(...t.map((p) => p[0]));
    const z0 = Math.min(...t.map((p) => p[1])), z1 = Math.max(...t.map((p) => p[1]));
    const span = (z1 - z0) / 2, len = x1 - x0;
    const col = dark ? "#3a4048" : "#f6f6f3";
    const list: THREE.BufferGeometry[] = [];
    for (const k of [0, 1]) {
      const zc = z0 + span * (k + 0.5);
      list.push(boxAt(len, 4, span - 0.2, (x0 + x1) / 2, 2, zc, col));
      const arch = new THREE.CylinderGeometry(span / 2 - 0.1, span / 2 - 0.1, len, 24, 1, false, 0, Math.PI);
      arch.scale(0.55, 1, 1).rotateZ(Math.PI / 2).translate((x0 + x1) / 2, 4, zc);
      list.push(colored(arch, col));
    }
    // Tor nach Süden (Staplerweg zur Halle A)
    list.push(boxAt(4, 4, 0.1, 2, 2.05, z1 + 0.02, dark ? "#20252b" : "#5c6670"));
    return mergeAll(list);
  }, [dark]);
  return (
    <mesh geometry={geo} castShadow receiveShadow>
      <meshLambertMaterial vertexColors />
    </mesh>
  );
}

// ---------------------------------------------------------------- Zaun, Tor, Schranke, Laternen

/** Lücken im Zaun: Werkstor (Zufahrtsstraße) und Hintertor (Nebenstraße) */
const FENCE_GAPS: V2[] = [
  [84.4, -98.4],
  [-5.4, -3],
];

function Fence({ dark }: { dark: boolean }) {
  const data = useMemo(() => {
    const posts: [number, number, number][] = [];
    const panels: { x: number; z: number; len: number; a: number }[] = [];
    for (let i = 0; i < SITE_POLY.length; i++) {
      const [ax, az] = SITE_POLY[i];
      const [bx, bz] = SITE_POLY[(i + 1) % SITE_POLY.length];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 3));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const mx = ax + (bx - ax) * ((t0 + t1) / 2), mz = az + (bz - az) * ((t0 + t1) / 2);
        if (FENCE_GAPS.some(([gx, gz]) => Math.hypot(mx - gx, mz - gz) < (gx > 0 ? 6.5 : 3.5))) continue;
        posts.push([ax + (bx - ax) * t0, 1, az + (bz - az) * t0]);
        panels.push({ x: mx, z: mz, len: len / n, a: Math.atan2(-(bz - az), bx - ax) });
      }
    }
    return { posts, panels };
  }, []);
  const wire = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d")!;
    x.strokeStyle = "#ffffff";
    x.lineWidth = 3;
    for (let i = 0; i <= 64; i += 16) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i, 64);
      x.moveTo(0, i);
      x.lineTo(64, i);
      x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }, []);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    data.panels.forEach((p, i) => {
      tmpO.position.set(p.x, 1, p.z);
      tmpO.rotation.set(0, p.a, 0);
      tmpO.scale.set(p.len, 1, 1);
      tmpO.updateMatrix();
      m.setMatrixAt(i, tmpO.matrix);
    });
    tmpO.scale.set(1, 1, 1);
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [data]);
  return (
    <group>
      <StaticInstances geo={["cyl", [0.04, 0.04, 2, 6]]} positions={data.posts} color={dark ? "#4b535c" : "#5d6670"} />
      <instancedMesh ref={ref} args={[undefined, undefined, data.panels.length]}>
        <planeGeometry args={[1, 1.9]} />
        <meshLambertMaterial color={dark ? "#4b535c" : "#6c757f"} alphaMap={wire} alphaTest={0.4} side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  );
}

/** Unsichtbare Klickflächen: Hochregallager und Lager & Versand öffnen die Bestandsübersicht */
function StockHitboxes() {
  const open = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    useUi.getState().openWarehouse(true);
  };
  const over = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    document.body.style.cursor = "pointer";
  };
  const out = () => {
    document.body.style.cursor = "";
  };
  return (
    <group>
      <mesh position={[59.25, 12, -73.9]} rotation-y={0.015} onClick={open} onPointerOver={over} onPointerOut={out}>
        <boxGeometry args={[14.6, 24, 31.6]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {/* beginnt östlich der Rampen (Rampe 5/6 springen auf x = 65,8 vor), damit die Tore anklickbar bleiben */}
      <mesh position={[(67.2 + WAREHOUSE.x1) / 2, WALL_H.hallB / 2, (WAREHOUSE.z0 + WAREHOUSE.z1) / 2]} onClick={open} onPointerOver={over} onPointerOut={out}>
        <boxGeometry args={[WAREHOUSE.x1 - 67.2 - 0.5, WALL_H.hallB, WAREHOUSE.z1 - WAREHOUSE.z0 - 1]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}

const SIGN_POS: V2 = [93, -97.7];
/** Standplatz des Sicherheitsdienstes: neben dem Schrankenpfosten, Blick auf die Einfahrt */
const GUARD_POS: V2 = [77.9, -92.6];

/** Sicherheitsmann in Warnweste: dreht sich zum ankommenden LKW und winkt ihn mit der Kelle durch */
function Guard({ dark }: { dark: boolean }) {
  const root = useRef<THREE.Group>(null);
  const arm = useRef<THREE.Group>(null);
  const st = useRef({ w: 0, yaw: Math.PI / 2 + 0.4 });
  const { body, armGeo } = useMemo(() => {
    const vest = dark ? "#9fb02a" : "#d7f03c", strip = dark ? "#8d949c" : "#eef1f3", pants = "#262d38", skin = "#d9a982", cap = "#1d2a44";
    const head = colored(new THREE.SphereGeometry(0.11, 12, 10).translate(0, 1.63, 0), skin);
    const body = mergeAll([
      ...[-0.1, 0.1].flatMap((x) => [boxAt(0.15, 0.84, 0.18, x, 0.46, 0, pants), boxAt(0.16, 0.08, 0.28, x, 0.04, 0.04, "#111418")]),
      boxAt(0.42, 0.6, 0.24, 0, 1.16, 0, vest),
      boxAt(0.43, 0.05, 0.25, 0, 1.0, 0, strip),
      boxAt(0.43, 0.05, 0.25, 0, 1.2, 0, strip),
      boxAt(0.1, 0.62, 0.11, -0.27, 1.15, 0, vest),
      boxAt(0.09, 0.09, 0.1, -0.27, 0.8, 0, skin),
      cylAt(0.05, 0.06, 0.1, 8, 0, 1.5, 0, skin),
      head,
      cylAt(0.12, 0.12, 0.07, 12, 0, 1.73, 0, cap),
      boxAt(0.2, 0.02, 0.12, 0, 1.71, 0.12, cap),
    ]);
    // Winkarm mit Kelle, Ursprung im Schultergelenk
    const armGeo = mergeAll([
      boxAt(0.1, 0.62, 0.11, 0, -0.3, 0, vest),
      boxAt(0.09, 0.09, 0.1, 0, -0.65, 0, skin),
      cylAt(0.015, 0.015, 0.32, 6, 0, -0.84, 0, "#30343a"),
      cylAt(0.15, 0.15, 0.02, 16, 0, -1.08, 0, "#f4f4f4", [Math.PI / 2, 0, 0]),
      cylAt(0.115, 0.115, 0.028, 16, 0, -1.08, 0, "#d42a2a", [Math.PI / 2, 0, 0]),
    ]);
    return { body, armGeo };
  }, [dark]);
  useFrame((state, dt) => {
    const g = root.current, a = arm.current;
    if (!g || !a) return;
    const s = st.current;
    const active = barrier.demand > 0;
    s.w = THREE.MathUtils.clamp(s.w + (active ? dt * 2.5 : -dt * 1.5), 0, 1);
    // zum nächsten LKW im Torbereich drehen, sonst Blick auf die Einfahrt
    let yaw = Math.PI / 2 + 0.4;
    if (active) {
      let best = 30 * 30;
      for (const b of bodies.values()) {
        if (b.r < 1.2) continue;
        const [x, z] = b.pts[0];
        const d = (x - GUARD_POS[0]) ** 2 + (z - GUARD_POS[1]) ** 2;
        if (d < best) {
          best = d;
          yaw = Math.atan2(x - GUARD_POS[0], z - GUARD_POS[1]);
        }
      }
    }
    const dy = Math.atan2(Math.sin(yaw - s.yaw), Math.cos(yaw - s.yaw));
    s.yaw += dy * Math.min(1, dt * 3);
    g.rotation.y = s.yaw;
    a.rotation.z = s.w * (2.45 + Math.sin(state.clock.elapsedTime * 6) * 0.45);
  });
  return (
    <group ref={root} position={[GUARD_POS[0], 0, GUARD_POS[1]]}>
      <mesh geometry={body} castShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <group ref={arm} position={[0.27, 1.43, 0]}>
        <mesh geometry={armGeo} castShadow>
          <meshLambertMaterial vertexColors />
        </mesh>
      </group>
    </group>
  );
}

const LAMP = {
  red: { on: "#ff2b1c", off: "#3a1411" },
  amber: { on: "#ffb300", off: "#3a2a0a" },
  green: { on: "#19e36e", off: "#0e2c1a" },
};

/**
 * Ampel an der Einmündung in den Breiten Weg: je ein Mast auf dem Gehweg links und rechts der Einfahrt,
 * Signalköpfe in beide Fahrtrichtungen. Fordert ein LKW an, schaltet sie über Gelb auf Rot – die Pkw halten
 * an der Haltelinie; danach Rot-Gelb und wieder Grün.
 */
function TrafficSignal({ dark }: { dark: boolean }) {
  const red = useRef<THREE.MeshBasicMaterial>(null);
  const amber = useRef<THREE.MeshBasicMaterial>(null);
  const green = useRef<THREE.MeshBasicMaterial>(null);
  const layout = useMemo(() => {
    // Richtung des Breiten Wegs an der Einmündung aus den OSM-Straßen
    let best = Infinity, u: V2 = [1, 0];
    for (const r of ROADS) {
      if (!r.main) continue;
      const pts = decode(r.p);
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((JUNCTION[0] - ax) * dx + (JUNCTION[1] - az) * dz) / l2));
        const d = Math.hypot(JUNCTION[0] - (ax + t * dx), JUNCTION[1] - (az + t * dz));
        if (d < best) {
          best = d;
          const l = Math.sqrt(l2);
          u = [dx / l, dz / l];
        }
      }
    }
    // Normale zur Werksseite
    const g: V2 = [GATE_ROAD[1][0] - GATE_ROAD[0][0], GATE_ROAD[1][1] - GATE_ROAD[0][1]];
    let n: V2 = [-u[1], u[0]];
    if (n[0] * g[0] + n[1] * g[1] < 0) n = [-n[0], -n[1]];
    const at = (along: number, side: number): V2 => [JUNCTION[0] + u[0] * along + n[0] * side, JUNCTION[1] + u[1] * along + n[1] * side];
    const poles = [at(-9.5, 4.7), at(9.5, 4.7)];
    const right = (d: V2): V2 => [-d[1], d[0]];
    const ru = right(u), rmu = right([-u[0], -u[1]]);
    const stops = [
      { p: [at(-SIGNAL_STOP, 0)[0] + ru[0] * 1.75, at(-SIGNAL_STOP, 0)[1] + ru[1] * 1.75] as V2, r: ru },
      { p: [at(SIGNAL_STOP, 0)[0] + rmu[0] * 1.75, at(SIGNAL_STOP, 0)[1] + rmu[1] * 1.75] as V2, r: rmu },
    ];
    return { u, poles, stops, yaw: Math.atan2(u[0], u[1]) };
  }, []);
  const { mast, lamps, lines } = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const lampGeo: Record<"red" | "amber" | "green", THREE.BufferGeometry[]> = { red: [], amber: [], green: [] };
    for (const [x, z] of layout.poles) {
      const y0 = terrainHeight(x, z);
      parts.push(cylAt(0.075, 0.09, 3.5, 8, x, y0 + 1.75, z, dark ? "#59626c" : "#8b949d"));
      parts.push(boxAt(0.44, 1.14, 0.34, x, y0 + 3.15, z, "#1b2026", layout.yaw));
      // Kontrastblende
      parts.push(boxAt(0.66, 1.36, 0.06, x, y0 + 3.15, z, dark ? "#2b3138" : "#f2f4f5", layout.yaw));
      for (const face of [1, -1]) {
        ([["red", 0.34], ["amber", 0], ["green", -0.34]] as const).forEach(([c, dy]) => {
          const off = 0.19 * face;
          const px = x + layout.u[0] * off, pz = z + layout.u[1] * off;
          const disc = new THREE.CylinderGeometry(0.12, 0.12, 0.03, 16).rotateX(Math.PI / 2).rotateY(layout.yaw).translate(px, y0 + 3.15 + dy, pz);
          lampGeo[c].push(colored(disc, "#ffffff"));
          disc.dispose();
          // Schute über der Leuchte
          parts.push(boxAt(0.3, 0.035, 0.14, x + layout.u[0] * 0.25 * face, y0 + 3.15 + dy + 0.15, z + layout.u[1] * 0.25 * face, "#1b2026", layout.yaw));
        });
      }
    }
    const lines = layout.stops.map(({ p, r }) => {
      const pl = new THREE.PlaneGeometry(3.3, 0.45).rotateX(-Math.PI / 2).rotateY(Math.atan2(-r[1], r[0]));
      pl.translate(p[0], terrainHeight(p[0], p[1]) + 0.07, p[1]);
      return pl;
    });
    return { mast: mergeAll(parts), lamps: { red: mergeAll(lampGeo.red), amber: mergeAll(lampGeo.amber), green: mergeAll(lampGeo.green) }, lines: mergeGeometries(lines)! };
  }, [layout, dark]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const s = signal;
    const el = t - s.since;
    let next = s.phase;
    if (s.phase === "green" && s.demand > 0 && el > 6) next = "amber";
    else if (s.phase === "amber" && el > 3) next = "red";
    else if (s.phase === "red" && s.demand === 0 && el > 5) next = "redamber";
    else if (s.phase === "redamber" && el > 1.5) next = "green";
    if (next !== s.phase) {
      s.phase = next;
      s.since = t;
    }
    const ph = s.phase;
    red.current?.color.set(ph === "red" || ph === "redamber" ? LAMP.red.on : LAMP.red.off);
    amber.current?.color.set(ph === "amber" || ph === "redamber" ? LAMP.amber.on : LAMP.amber.off);
    green.current?.color.set(ph === "green" ? LAMP.green.on : LAMP.green.off);
  });
  return (
    <group>
      <mesh geometry={mast} castShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <mesh geometry={lamps.red}>
        <meshBasicMaterial ref={red} color={LAMP.red.off} toneMapped={false} />
      </mesh>
      <mesh geometry={lamps.amber}>
        <meshBasicMaterial ref={amber} color={LAMP.amber.off} toneMapped={false} />
      </mesh>
      <mesh geometry={lamps.green}>
        <meshBasicMaterial ref={green} color={LAMP.green.on} toneMapped={false} />
      </mesh>
      <mesh geometry={lines}>
        <meshBasicMaterial color={dark ? "#9aa1a8" : "#f4f4f0"} />
      </mesh>
    </group>
  );
}

function Gate({ dark }: { dark: boolean }) {
  const arm = useRef<THREE.Group>(null);
  const lamp = useRef<THREE.MeshBasicMaterial>(null);
  const tex = useMemo(() => barrierTex(), []);
  const sign = useMemo(() => textTexture("UNTERNEHMEN", { color: "#ffffff", bg: "#0b3a8c", size: 120, w: 700, h: 220, sub: "Werk Nord · LKW bitte anmelden" }), []);
  const [bx, bz] = GATE.booth;
  // Pförtnerhaus (Dach, Pfosten, Schildpfosten, Fahnenmasten) als eine Geometrie
  const geo = useMemo(() => {
    // Schild auf dem Gehweg am Breiten Weg, östlich der Einfahrt (nicht auf der Fahrbahn)
    const ang = 0.21, sx = SIGN_POS[0], sz = SIGN_POS[1];
    const list = [
      boxAt(3.8, 0.25, 5.4, bx, 3.12, bz, dark ? "#3a414a" : "#cfd3d6"),
      boxAt(0.45, 1.1, 0.45, GATE.x - 3.9, 0.55, GATE.z, "#d8dde2"),
      ...[-1.6, 1.6].map((o) => boxAt(0.12, 2.4, 0.12, sx + Math.cos(ang) * o, 1.2, sz - Math.sin(ang) * o, "#8a939c", ang)),
      ...FLAG_POS.map(([x, , z]) => cylAt(0.05, 0.06, 9, 8, x, 4.5, z, dark ? "#6a737d" : "#d7dbdf")),
    ];
    return mergeAll(list);
  }, [bx, bz, dark]);
  const booth = useMemo(() => officeTex(dark), [dark]);
  useFrame((_, dt) => {
    // Schranke: 2,5 s für eine Öffnung, schließt etwas langsamer
    const target = barrier.demand > 0 ? 1 : 0;
    const before = barrier.open;
    barrier.open = THREE.MathUtils.clamp(barrier.open + Math.sign(target - barrier.open) * dt * (target ? 0.45 : 0.35), 0, 1);
    if (barrier.open === before) return;
    if (arm.current) arm.current.rotation.z = barrier.open * (Math.PI / 2 - 0.08);
    if (lamp.current) lamp.current.color.set(barrier.open > 0.95 ? "#19d36b" : "#ff3b3b");
  });
  return (
    <group>
      <mesh geometry={geo} castShadow>
        <meshLambertMaterial vertexColors />
      </mesh>
      <mesh
        position={[bx, 1.5, bz]}
        castShadow
        onClick={(e) => {
          // Pförtnerhaus anklicken → Pförtnerbuch (Ein-/Ausfahrten heute)
          e.stopPropagation();
          useUi.getState().openGate(true);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <boxGeometry args={[2.8, 3, 4.2]} />
        <meshLambertMaterial map={booth} />
      </mesh>
      <group ref={arm} position={[GATE.x - 3.9, 1.0, GATE.z]}>
        <mesh position={[GATE.armLen / 2, 0, 0]}>
          <boxGeometry args={[GATE.armLen, 0.12, 0.12]} />
          <meshLambertMaterial map={tex} />
        </mesh>
      </group>
      <mesh position={[GATE.x - 4.4, 1.6, GATE.z - 0.6]}>
        <boxGeometry args={[0.2, 0.5, 0.2]} />
        <meshBasicMaterial ref={lamp} color="#ff3b3b" toneMapped={false} />
      </mesh>
      <mesh position={[SIGN_POS[0], 2.3, SIGN_POS[1]]} rotation-y={0.21 + Math.PI}>
        <planeGeometry args={[3.8, 1.2]} />
        <meshBasicMaterial map={sign} side={THREE.DoubleSide} />
      </mesh>
      <Guard dark={dark} />
      <TrafficSignal dark={dark} />
    </group>
  );
}

function Lamps({ dark }: { dark: boolean }) {
  const pos = useMemo(() => {
    const out: [number, number, number][] = [];
    const along = (pts: V2[], every: number, side: number) => {
      const pl = new Polyline(pts);
      for (let s = every / 2; s < pl.length; s += every) {
        const a = pl.at(s);
        // seitlich versetzt
        const x = a.x + Math.cos(a.h) * side, z = a.z - Math.sin(a.h) * side;
        out.push([x, terrainHeight(x, z) + 3.6, z]);
      }
    };
    along(GATE_ROAD, 22, 4.6);
    for (const r of ROADS) {
      if (!r.main) continue;
      const pts = decode(r.p).filter(([x, z]) => Math.abs(x - 20) < 230 && Math.abs(z) < 230);
      if (pts.length > 1) along(pts, 34, 4.8);
    }
    return out;
  }, []);
  const geo = useMemo(() => mergeAll(pos.flatMap(([x, y, z]) => [cylAt(0.07, 0.1, 7.2, 6, x, y, z, dark ? "#56606a" : "#7a838c"), boxAt(0.5, 0.18, 0.5, x, y + 3.7, z, dark ? "#ffe1a8" : "#c9ced3")])), [pos, dark]);
  const pools = useMemo(() => pos.map(([x, y, z]) => [x, y - 3.45, z] as [number, number, number]), [pos]);
  return (
    <group>
      <mesh geometry={geo}>{dark ? <meshBasicMaterial vertexColors /> : <meshLambertMaterial vertexColors />}</mesh>
      {dark && <LightPools positions={pools} />}
    </group>
  );
}

/** Lichtkegel der Laternen am Boden (additiv, ohne echte Lichtquellen – kostet fast nichts) */
function LightPools({ positions }: { positions: [number, number, number][] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,214,150,0.55)");
    g.addColorStop(0.45, "rgba(255,200,130,0.22)");
    g.addColorStop(1, "rgba(255,190,120,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }, []);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    positions.forEach((p, i) => {
      tmpO.position.set(...p);
      tmpO.rotation.set(-Math.PI / 2, 0, 0);
      tmpO.updateMatrix();
      m.setMatrixAt(i, tmpO.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [positions]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, positions.length]} renderOrder={2}>
      <planeGeometry args={[18, 18]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </instancedMesh>
  );
}

/** Firmenschriftzug an der Ostfassade (zur Hauptstraße) */
function FacadeLogo({ dark }: { dark: boolean }) {
  const tex = useMemo(() => textTexture("UNTERNEHMEN", { color: dark ? "#9cc0ff" : "#0b3a8c", size: 230, w: 1300, h: 320 }), [dark]);
  return (
    <mesh position={[116.95, 7.6, 18]} rotation-y={Math.PI / 2}>
      <planeGeometry args={[22, 5.4]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}

function Plant({ pal, dark }: { pal: TwinPalette; dark: boolean }) {
  return (
    <group>
      <HallShell poly={HALL_A_POLY} height={WALL_H.hallA} cutKey="hallA" roof="shed" dark={dark} wallColor="#e8eaea" floor="A" />
      <HallShell poly={HALL_B_POLY} height={WALL_H.hallB} cutKey="hallB" roof="skylights" dark={dark} wallColor="#e2e6ea" floor="B" />
      <HallBInner dark={dark} />
      <ClosedBuildings dark={dark} />
      <OfficeSigns dark={dark} />
      <HallCLogo dark={dark} />
      <HrlLogo dark={dark} />
      <StockHitboxes />
      <Flags />
      <Tent dark={dark} />
      <Silos pal={pal} />
      <Docks dark={dark} />
      <Racks pal={pal} />
      <Interior pal={pal} dark={dark} />
      <CameraGantry pal={pal} />
      <Fence dark={dark} />
      <Gate dark={dark} />
      <Lamps dark={dark} />
      <FacadeLogo dark={dark} />
    </group>
  );
}

export default memo(Plant);
