"use client";

import { MapControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useRef, useState, type ComponentRef } from "react";
import * as THREE from "three";
import { useUi } from "@/lib/client/store";
import { LabelLayer, LabelProjector } from "./Labels";
import { HALL_FOCUS, SPOT, VIEWS } from "./layout";
import Machines from "./Machines";
import Movers from "./Movers";
import { DARK, LIGHT } from "./palette";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { cut, requestShadows, shadowState } from "./site/cutaway";
import { gpuTier } from "./site/quality";
import Forklifts from "./site/Forklifts";
import Houses from "./site/Houses";
import Plant from "./site/Plant";
import Landscape from "./site/Landscape";
import Traffic from "./site/Traffic";
import Trees from "./site/Trees";

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
type ViewKey = keyof typeof VIEWS;

function CameraRig({ intro }: { intro?: boolean }) {
  const controls = useRef<ComponentRef<typeof MapControls>>(null);
  const camera = useThree((s) => s.camera);
  const selected = useUi((s) => s.selectedMachine);
  const view = useUi((s) => s.twinView);
  const viewRef = useRef<ViewKey>(view.key as ViewKey);
  viewRef.current = (view.key in VIEWS ? view.key : "gesamt") as ViewKey;
  const prevSelected = useRef<string | null>(null);
  const anim = useRef<{ t: number; fromT: THREE.Vector3; toT: THREE.Vector3; from: THREE.Spherical; to: THREE.Spherical; dur: number } | null>(null);

  const go = (target: THREE.Vector3, sph: THREE.Spherical, dur = 1.1) => {
    const c = controls.current;
    if (!c) return;
    const off = new THREE.Vector3().subVectors(camera.position, c.target);
    const from = new THREE.Spherical().setFromVector3(off);
    const to = sph.clone();
    to.theta = from.theta + THREE.MathUtils.euclideanModulo(to.theta - from.theta + Math.PI, Math.PI * 2) - Math.PI;
    anim.current = { t: 0, fromT: c.target.clone(), toT: target, from, to, dur };
  };
  const goView = (key: ViewKey, dur = 1.3) => {
    const v = VIEWS[key];
    go(new THREE.Vector3(...v.target), new THREE.Spherical(v.radius, v.phi, v.theta), dur);
  };

  useEffect(() => {
    const v = VIEWS.gesamt;
    const start = new THREE.Spherical(intro ? Math.min(700, v.radius * 1.6) : v.radius, intro ? 0.55 : v.phi, v.theta - (intro ? 0.9 : 0));
    camera.position.copy(new THREE.Vector3().setFromSpherical(start).add(new THREE.Vector3(...v.target)));
    controls.current?.target.set(...v.target);
    controls.current?.update();
    if (intro) setTimeout(() => go(new THREE.Vector3(...v.target), new THREE.Spherical(v.radius, v.phi, v.theta), 2.8), 50);
  }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ansicht gewählt – auch erneuter Klick auf dieselbe Ansicht (n) fliegt zurück
  useEffect(() => {
    if (view.n) goView(viewRef.current);
  }, [view.key, view.n]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const was = prevSelected.current;
    prevSelected.current = selected;
    if (!selected) {
      // Auswahl aufgehoben → zurück zur zuletzt gewählten Ansicht (Herauszoomen)
      if (was) goView(viewRef.current, 0.9);
      return;
    }
    const s = SPOT[selected];
    if (!s) return;
    const c = controls.current;
    if (!c) return;
    const off = new THREE.Vector3().subVectors(camera.position, c.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.radius = Math.min(sph.radius, 34);
    sph.phi = Math.min(sph.phi, 0.95);
    go(new THREE.Vector3(s.x + 3, 0, s.z), sph, 1.0);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, raw) => {
    // Kameraflug in Echtzeit (auch wenn einzelne Bilder länger dauern)
    const dt = Math.min(raw, 0.25);
    const c = controls.current;
    if (!c) return;
    const a = anim.current;
    if (a) {
      a.t = Math.min(1, a.t + dt / a.dur);
      const e = ease(a.t);
      c.target.lerpVectors(a.fromT, a.toT, e);
      const s = new THREE.Spherical(THREE.MathUtils.lerp(a.from.radius, a.to.radius, e), THREE.MathUtils.lerp(a.from.phi, a.to.phi, e), THREE.MathUtils.lerp(a.from.theta, a.to.theta, e));
      camera.position.copy(new THREE.Vector3().setFromSpherical(s).add(c.target));
      c.update();
      if (a.t >= 1) anim.current = null;
    }
    // Schwenkbereich begrenzen (Gelände endet bei ±800 m)
    const lim = 420;
    if (Math.abs(c.target.x - 40) > lim || Math.abs(c.target.z) > lim) {
      const dx = THREE.MathUtils.clamp(c.target.x, 40 - lim, 40 + lim) - c.target.x;
      const dz = THREE.MathUtils.clamp(c.target.z, -lim, lim) - c.target.z;
      c.target.x += dx;
      c.target.z += dz;
      camera.position.x += dx;
      camera.position.z += dz;
    }
    // Hallen öffnen sich, wenn die Kamera nah ist (oder eine Maschine darin gewählt ist)
    const st = useUi.getState();
    for (const key of Object.keys(HALL_FOCUS) as (keyof typeof HALL_FOCUS)[]) {
      const f = HALL_FOCUS[key];
      const d = Math.hypot(camera.position.x - f.x, camera.position.y, camera.position.z - f.z);
      const sel = st.selectedMachine;
      const inside = sel && ((key === "hallA" && sel.startsWith("SG")) || (key === "hallB" && sel.startsWith("TF")));
      const want = st.roofsOff || inside || d < f.r ? 1 : 0;
      cut[key] += (want - cut[key]) * Math.min(1, dt * 2.2);
      if (Math.abs(want - cut[key]) < 0.002) cut[key] = want;
    }
  });

  return (
    <MapControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={9}
      maxDistance={720}
      maxPolarAngle={1.3}
      minPolarAngle={0.15}
      zoomSpeed={1.1}
      onStart={() => {
        anim.current = null;
      }}
    />
  );
}

/** Sonne folgt dem Blickpunkt: Schattenbereich passt sich der Zoomstufe an (nah = scharf) */
function Sun({ intensity, shadows }: { intensity: number; shadows: boolean }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const lastKey = useRef("");
  useFrame(() => {
    const l = light.current;
    if (!l || !controls) return;
    const t = controls.target;
    const dist = camera.position.distanceTo(t);
    const half = THREE.MathUtils.clamp(dist * 0.7, 45, 300);
    // nur bei merklicher Änderung neu ausrichten (Schattenkarte wird gedrosselt aktualisiert)
    const step = half / 8;
    const key = `${Math.round(t.x / step)}:${Math.round(t.z / step)}:${Math.round(half / 10)}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    const cx = Math.round(t.x / step) * step, cz = Math.round(t.z / step) * step;
    l.position.set(cx - 90, 190, cz + 120);
    l.target.position.set(cx, 0, cz);
    l.target.updateMatrixWorld();
    const cam = l.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 20;
    cam.far = 520;
    cam.updateProjectionMatrix();
    l.shadow.bias = -0.0002 - half * 0.000004;
    l.shadow.normalBias = 0.02 + half * 0.0004;
    requestShadows();
  });
  return <directionalLight ref={light} intensity={intensity} castShadow={shadows} shadow-mapSize={[2048, 2048]} />;
}

/**
 * Schatten nur bei Bedarf neu zeichnen (Kameraschwenk, Dach auf/zu) und sonst alle paar Sekunden –
 * ein Schattendurchgang kostet auf integrierter Grafik so viel wie mehrere normale Bilder.
 */
function ShadowManager({ every = 6 }: { every?: number }) {
  const gl = useThree((s) => s.gl);
  const last = useRef(0);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);
  useFrame(({ clock }) => {
    if (shadowState.pending || clock.elapsedTime - last.current > every) {
      shadowState.pending = false;
      last.current = clock.elapsedTime;
      gl.shadowMap.needsUpdate = true;
    }
  });
  return null;
}

/**
 * Shader parallel übersetzen und Texturen hochladen, bevor das erste Bild gezeichnet wird.
 * ANGLE (Chrome/Firefox unter Windows) braucht auf integrierter Grafik ~0,1 s je Shader –
 * synchron im ersten Bild wären das mehrere Sekunden Standbild.
 */
function Warmup({ onReady }: { onReady: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let alive = true;
    // kurz warten, bis Umgebungskarte und Texturen der Unterkomponenten gesetzt sind
    const t = setTimeout(() => {
      gl.compileAsync(scene, camera)
        .catch(() => undefined)
        .then(() => {
          const seen = new Set<THREE.Texture>();
          scene.traverse((o) => {
            const m = (o as THREE.Mesh).material;
            for (const mat of m ? (Array.isArray(m) ? m : [m]) : []) {
              for (const k of ["map", "emissiveMap", "alphaMap"] as const) {
                const tex = (mat as THREE.MeshStandardMaterial)[k];
                if (tex && !seen.has(tex)) {
                  seen.add(tex);
                  gl.initTexture(tex);
                }
              }
            }
          });
        })
        .finally(() => alive && onReady());
    }, 60);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Auflösung an die Grafikleistung anpassen (nur integrierte Grafik): fällt die Bildrate unter 40 FPS, wird etwas gröber
 * gerendert; läuft sie stabil bei 60, wird schärfer (bis 1,25-fach) – ersetzt dort die teure Kantenglättung.
 */
function AdaptiveDpr({ native }: { native: number }) {
  const setDpr = useThree((s) => s.setDpr);
  const st = useRef({ i: 2, frames: 0, t0: 0, cool: 6 });
  useFrame(({ clock }) => {
    const s = st.current;
    const t = clock.elapsedTime;
    if (!s.t0) {
      s.t0 = t;
      return;
    }
    s.frames++;
    const dt = t - s.t0;
    if (dt < 2) return;
    const fps = s.frames / dt;
    s.frames = 0;
    s.t0 = t;
    // nach Hintergrund-Tab oder Ladepause nicht reagieren
    if (dt > 4 || t < s.cool) return;
    const i = fps < 40 && s.i > 0 ? s.i - 1 : fps > 57 && s.i < DPR_STEPS.length - 1 ? s.i + 1 : s.i;
    if (i === s.i) return;
    s.i = i;
    s.cool = t + 4;
    setDpr(Math.min(2, native * DPR_STEPS[i]));
  });
  return null;
}
const DPR_STEPS = [0.7, 0.85, 1, 1.15, 1.25];

/** Umgebungslicht für Spiegelungen (Lack, Metall, Glas) – lokal erzeugt, kein Download */
function Environment({ intensity }: { intensity: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = intensity;
    pmrem.dispose();
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, scene, intensity]);
  return null;
}

function TwinScene({ intro }: { intro?: boolean }) {
  const theme = useUi((s) => s.theme);
  const dark = theme === "dark";
  const pal = dark ? DARK : LIGHT;
  const select = useUi((s) => s.selectMachine);
  // Echtzeitschatten nur auf starker Grafik – sonst sind sie in die Bodentexturen gebacken
  const [{ tier }] = useState(() => gpuTier());
  const rtShadows = tier === "high";
  // Starke Grafik: Kantenglättung (MSAA) und überabgetastet. Integrierte Grafik: MSAA kostet dort über die Hälfte
  // der Bildzeit (gemessen auf Intel UHD: 22 → 50–60 FPS ohne) – stattdessen passt sich die Auflösung der Bildrate an.
  const native = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const dpr = rtShadows ? Math.min(2, native * 1.25) : native;
  // erst rendern, wenn alle Shader im Hintergrund übersetzt sind (sonst friert der erste Aufbau ein)
  const [ready, setReady] = useState(false);
  return (
    <div className="absolute inset-0">
      <Canvas
        shadows={rtShadows ? { type: THREE.PCFShadowMap } : false}
        dpr={dpr}
        frameloop={ready ? "always" : "never"}
        camera={{ fov: 32, near: 0.8, far: 5000, position: [-200, 220, 300] }}
        gl={{ antialias: rtShadows, preserveDrawingBuffer: false, powerPreference: "high-performance" }}
        onCreated={({ gl, scene, camera }) => {
          // Diagnose in der Konsole: window.__cortexGl.info.render, window.__cortexScene, window.__cortexCamera
          (window as unknown as Record<string, unknown>).__cortexGl = gl;
          (window as unknown as Record<string, unknown>).__cortexScene = scene;
          (window as unknown as Record<string, unknown>).__cortexCamera = camera;
        }}
        onPointerMissed={(e) => {
          if (e.button === 0) {
            select(null);
            useUi.getState().selectVisit(null);
          }
        }}
      >
        {rtShadows ? <ShadowManager /> : <AdaptiveDpr native={native} />}
        <Environment intensity={dark ? 0.25 : 0.55} />
        <color attach="background" args={[pal.bg]} />
        <fog attach="fog" args={[pal.fog, 520, 1650]} />
        <hemisphereLight args={[pal.hemiSky, pal.hemiGround, pal.hemiIntensity]} />
        <Sun intensity={pal.sunIntensity} shadows={rtShadows} />
        {dark && <pointLight position={[51, 9, 95]} intensity={900} distance={95} decay={1.6} color="#c9d6ff" />}
        {dark && <pointLight position={[89, 10, 10]} intensity={700} distance={80} decay={1.6} color="#c9d6ff" />}
        <CameraRig intro={intro} />
        <Landscape dark={dark} />
        <Houses dark={dark} />
        <Trees dark={dark} />
        <Plant pal={pal} dark={dark} />
        <Machines pal={pal} />
        <Movers pal={pal} />
        <Forklifts />
        <Traffic dark={dark} />
        <LabelProjector />
        <Warmup onReady={() => setReady(true)} />
      </Canvas>
      <LabelLayer />
      {!ready && (
        <div className="blueprint absolute inset-0 flex items-center justify-center">
          <div className="text-[12px] text-muted">3D-Werk wird vorbereitet …</div>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-muted opacity-70">Kartendaten © OpenStreetMap-Mitwirkende (ODbL) · Höhen: EU-DEM (Copernicus)</div>
    </div>
  );
}

// memo: Eltern-Re-Renders (Live-Daten) sollen den Szenengraph nicht neu abgleichen
export default memo(TwinScene);
