// Geometrien zusammenführen: viele statische Teile → EIN Draw Call (Farbe als Vertexfarbe)

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const tmpColor = new THREE.Color();

/** nicht indizierte Kopie mit Vertexfarbe (und optional Transformation) */
export function colored(g: THREE.BufferGeometry, color: string | THREE.Color, m?: THREE.Matrix4) {
  const ng = g.index ? g.toNonIndexed() : g.clone();
  if (m) ng.applyMatrix4(m);
  const c = typeof color === "string" ? tmpColor.set(color) : color;
  const n = ng.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute("color", new THREE.BufferAttribute(a, 3));
  if (!ng.attributes.uv) ng.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!ng.attributes.normal) ng.computeVertexNormals();
  if (g !== ng && g.index) g.dispose();
  return ng;
}

/** Liste zusammenführen (alle Teile brauchen position/normal/uv/color – colored() sorgt dafür) */
export function mergeAll(list: THREE.BufferGeometry[]) {
  const clean = list.map((g) => {
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) g.deleteAttribute(k);
    return g;
  });
  const out = mergeGeometries(clean, false)!;
  clean.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const one = new THREE.Vector3(1, 1, 1);

/** Quader an Position (optional gedreht um y) – für schnelle Zusammenstellung */
export function boxAt(w: number, h: number, d: number, x: number, y: number, z: number, color: string, rotY = 0) {
  m4.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(0, rotY, 0)), one);
  return colored(new THREE.BoxGeometry(w, h, d), color, m4);
}

export function cylAt(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, color: string, rot?: [number, number, number], open = false) {
  m4.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(...(rot ?? [0, 0, 0]))), one);
  return colored(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), color, m4);
}
