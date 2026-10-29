"use client";

// Statische Instanzen: viele gleiche Objekte (Stützen, Regalpfosten, Markierungen) in EINEM Draw Call

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

type Geo = ["box", [number, number, number]] | ["plane", [number, number]] | ["cyl", [number, number, number, number]];

export function StaticInstances({
  geo,
  positions,
  rotation,
  color,
  roughness = 0.7,
  metalness = 0,
  basic,
  cast,
  receive,
}: {
  geo: Geo;
  positions: [number, number, number][];
  rotation?: [number, number, number];
  color: string;
  roughness?: number;
  metalness?: number;
  basic?: boolean;
  cast?: boolean;
  receive?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    if (geo[0] === "box") return new THREE.BoxGeometry(...geo[1]);
    if (geo[0] === "plane") return new THREE.PlaneGeometry(...geo[1]);
    return new THREE.CylinderGeometry(...geo[1]);
  }, [geo]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation ?? [0, 0, 0])));
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    positions.forEach((p, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(...p), q, one)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [positions, rotation, geometry]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, positions.length]} castShadow={cast} receiveShadow={receive}>
      {basic ? <meshBasicMaterial color={color} /> : <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />}
    </instancedMesh>
  );
}
