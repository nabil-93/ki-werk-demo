"use client";

// Bäume: Wald (Fichte/Buche wie im Mittelgebirge), Stadtwald, Gärten und Pflanzstreifen im Werk.
// Standorte aus treeData (OSM-Dichtemaske); je Baumart zwei Detailstufen (nah/fern).

import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { isNear, treeList, type Tree } from "./treeData";
import { terrainHeight } from "./terrain";

function colored(g: THREE.BufferGeometry, hex: string) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return g.index ? g.toNonIndexed() : g;
}

/** Einheitsbäume (Höhe 1) */
function geometries() {
  // offene Mantelflächen (ohne Deckel) – spart Dreiecke bei tausenden Bäumen
  const trunk = (r: number, h: number) => colored(new THREE.CylinderGeometry(r * 0.7, r, h, 5, 1, true).translate(0, h / 2, 0), "#6b4f3a");
  const cone = (r: number, h: number, y: number, seg: number, col: string) => colored(new THREE.ConeGeometry(r, h, seg, 1, true).translate(0, y + h / 2, 0), col);
  const blob = (r: number, x: number, y: number, z: number, col: string) => colored(new THREE.IcosahedronGeometry(r, 0).scale(1, 0.85, 1).translate(x, y, z), col);
  const coniferNear = mergeGeometries([trunk(0.028, 0.22), cone(0.2, 0.58, 0.14, 7, "#3f6b3a"), cone(0.13, 0.46, 0.52, 7, "#477642")])!;
  const coniferFar = mergeGeometries([cone(0.19, 0.92, 0.08, 5, "#406c3b")])!;
  const leafNear = mergeGeometries([trunk(0.035, 0.42), blob(0.34, 0, 0.6, 0, "#5f8a3f"), blob(0.24, 0.12, 0.82, 0.06, "#6a9446"), blob(0.22, -0.15, 0.72, -0.1, "#58833b")])!;
  const leafFar = colored(new THREE.OctahedronGeometry(0.36, 0).scale(1, 0.95, 1).translate(0, 0.62, 0), "#5f8a3f");
  return { coniferNear, coniferFar, leafNear, leafFar };
}

const dummy = new THREE.Object3D();
const color = new THREE.Color();

function TreeSet({ geo, list, shadow, dark }: { geo: THREE.BufferGeometry; list: Tree[]; shadow: boolean; dark: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    list.forEach((t, i) => {
      dummy.position.set(t.x, terrainHeight(t.x, t.z) - 0.3, t.z);
      dummy.rotation.set(0, t.rot, 0);
      dummy.scale.set(t.w, t.h, t.w);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      // leichte Farbvariation (Helligkeit und Gelbstich)
      const k = 0.82 + t.tint * 0.3;
      color.setRGB(k * (0.96 + t.tint * 0.08), k, k * (0.9 + t.tint * 0.06));
      if (dark) color.multiplyScalar(0.32);
      m.setColorAt(i, color);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [list, dark]);
  if (!list.length) return null;
  return (
    <instancedMesh ref={ref} args={[geo, undefined, list.length]} castShadow={shadow} receiveShadow={shadow}>
      <meshLambertMaterial vertexColors flatShading />
    </instancedMesh>
  );
}

let geoCache: ReturnType<typeof geometries> | null = null;

function Trees({ dark }: { dark: boolean }) {
  const data = useMemo(() => ({ geo: (geoCache ??= geometries()), trees: treeList() }), []);
  const sets = useMemo(
    () => ({
      cn: data.trees.filter((t) => t.conifer && isNear(t)),
      cf: data.trees.filter((t) => t.conifer && !isNear(t)),
      ln: data.trees.filter((t) => !t.conifer && isNear(t)),
      lf: data.trees.filter((t) => !t.conifer && !isNear(t)),
    }),
    [data],
  );
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__cortexTrees = { total: data.trees.length, near: sets.cn.length + sets.ln.length };
  }, [data, sets]);
  return (
    <group>
      <TreeSet geo={data.geo.coniferNear} list={sets.cn} shadow dark={dark} />
      <TreeSet geo={data.geo.leafNear} list={sets.ln} shadow dark={dark} />
      <TreeSet geo={data.geo.coniferFar} list={sets.cf} shadow={false} dark={dark} />
      <TreeSet geo={data.geo.leafFar} list={sets.lf} shadow={false} dark={dark} />
    </group>
  );
}

export default memo(Trees);
