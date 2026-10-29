"use client";

// Gelände: echtes Relief (EU-DEM) mit gemalter Bodentextur, Fernzone bis zum Horizont
// und die hochaufgelöste Werksfläche.

import { memo, useEffect, useMemo } from "react";
import * as THREE from "three";
import { GROUND_HALF, groundTexture } from "./groundPaint";
import { SITE_DECAL, siteTexture } from "./sitePaint";
import { rawHeight, terrainHeight } from "./terrain";
import { gpuTier } from "./quality";
import { treeList } from "./treeData";

function Ground({ dark }: { dark: boolean }) {
  const geo = useMemo(() => {
    const seg = 160;
    const g = new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    g.computeVertexNormals();
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  // schwächere Grafik: Schatten in die Bodentextur gebacken
  const map = useMemo(() => groundTexture(dark, gpuTier().tier === "fast" ? treeList() : null), [dark]);
  return (
    <mesh geometry={geo} receiveShadow>
      <meshLambertMaterial map={map} />
    </mesh>
  );
}

/** Fernzone: Hügel und Waldkulisse bis in den Nebel, unter dem Kerngelände versenkt */
function Skirt({ dark }: { dark: boolean }) {
  const geo = useMemo(() => {
    const size = 7000, seg = 70;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const a = new THREE.Color(dark ? "#0f1a12" : "#5b7a45");
    const b = new THREE.Color(dark ? "#17231a" : "#93b26f");
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const inner = Math.max(Math.abs(x), Math.abs(z)) < GROUND_HALF - 30;
      // Rand des Rasters fortsetzen und mit sanften Hügeln überlagern
      const hills = 18 * Math.sin(x * 0.0031 + 1.3) * Math.cos(z * 0.0027 - 0.4) + 9 * Math.sin((x + z) * 0.0061);
      pos.setY(i, inner ? -60 : rawHeight(x, z) + hills * Math.min(1, (Math.max(Math.abs(x), Math.abs(z)) - GROUND_HALF) / 600) - 1.5);
      const k = 0.5 + 0.5 * Math.sin(x * 0.011) * Math.cos(z * 0.009);
      tmp.copy(a).lerp(b, k * 0.6);
      col.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, [dark]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo}>
      <meshLambertMaterial vertexColors />
    </mesh>
  );
}

/** Werksfläche (eben, y = 0) mit Markierungen */
function SiteSurface({ dark }: { dark: boolean }) {
  const map = useMemo(() => siteTexture(dark, gpuTier().tier === "fast" ? treeList() : null), [dark]);
  const w = SITE_DECAL.x1 - SITE_DECAL.x0, d = SITE_DECAL.z1 - SITE_DECAL.z0;
  return (
    <mesh rotation-x={-Math.PI / 2} position={[(SITE_DECAL.x0 + SITE_DECAL.x1) / 2, 0.04, (SITE_DECAL.z0 + SITE_DECAL.z1) / 2]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshLambertMaterial map={map} alphaTest={0.5} />
    </mesh>
  );
}

function Landscape({ dark }: { dark: boolean }) {
  return (
    <group>
      <Ground dark={dark} />
      <Skirt dark={dark} />
      <SiteSurface dark={dark} />
    </group>
  );
}

export default memo(Landscape);
