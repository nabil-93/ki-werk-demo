"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Camera, Pause, Play, ScanLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUi } from "@/lib/client/store";
import { DEFECTS } from "@/lib/sim/catalog";
import type { DefectType } from "@/lib/sim/types";
import { DECORS, H, W, diffToImage, inspect, renderCup, type Blob } from "@/lib/client/vision";
import { cn } from "@/lib/client/cn";
import { Badge, Button, Tabs } from "@/components/ui/ui";
import { fmtNum, fmtPct } from "@/lib/ai/format";

const IML_MACHINES = ["SG-01", "SG-02", "SG-04", "SG-05", "SG-07", "SG-08"];

// Für Validierung in der Browser-Konsole: window.__vision
if (typeof window !== "undefined") (window as unknown as Record<string, unknown>).__vision = { renderCup, inspect, DECORS, W, H };
const SCALE = 2;

interface Shot {
  id: number;
  url: string;
  ok: boolean;
  type?: DefectType;
  truth: DefectType | null;
}

export default function VisionStation({ machineId, onMachine }: { machineId: string; onMachine: (id: string) => void }) {
  const main = useRef<HTMLCanvasElement>(null);
  const goldenCv = useRef<HTMLCanvasElement>(null);
  const diffCv = useRef<HTMLCanvasElement>(null);
  const work = useRef<HTMLCanvasElement | null>(null);
  const goldenData = useRef<ImageData | null>(null);
  const [running, setRunning] = useState(true);
  const [demo, setDemo] = useState<"demo" | "real">("demo");
  const [stats, setStats] = useState({ n: 0, nio: 0, correct: 0, byType: {} as Partial<Record<DefectType, number>>, ms: 0 });
  const [strip, setStrip] = useState<Shot[]>([]);
  const [gallery, setGallery] = useState<Shot[]>([]);
  const [last, setLast] = useState<{ blobs: Blob[]; ok: boolean } | null>(null);
  const seq = useRef(1);
  const productRef = useRef("P-IML500");

  const machine = useUi((s) => s.snap?.machines.find((m) => m.id === machineId));
  const productId = machine?.product.id && DECORS[machine.product.id] ? machine.product.id : "P-IML500";
  productRef.current = productId;

  // Golden Sample für das aktuelle Dekor
  useEffect(() => {
    work.current ??= document.createElement("canvas");
    work.current.width = W;
    work.current.height = H;
    const g = goldenCv.current;
    if (!g) return;
    const ctx = g.getContext("2d", { willReadFrequently: true })!;
    renderCup(ctx, DECORS[productId], null);
    goldenData.current = ctx.getImageData(0, 0, W, H);
  }, [productId]);

  useEffect(() => {
    setStats({ n: 0, nio: 0, correct: 0, byType: {}, ms: 0 });
    setStrip([]);
    setGallery([]);
  }, [machineId]);

  const step = useCallback(() => {
    const wk = work.current;
    const golden = goldenData.current;
    const mc = main.current;
    if (!wk || !golden || !mc) return;
    const snap = useUi.getState().snap;
    const m = snap?.machines.find((x) => x.id === machineId);
    // Fehlerwahrscheinlichkeit aus Live-Ausschussquote (im Demo-Modus überhöht, damit Fehler sichtbar werden)
    const base = m ? m.scrapRate : 0.006;
    const p = Math.min(0.75, demo === "demo" ? Math.max(0.06, base * 14) : base);
    let truth: DefectType | null = null;
    if (Math.random() < p && m) {
      const weights = Object.entries(m.defects).filter(([k]) => DEFECTS[k as DefectType].machineTypes.includes("SG")) as [DefectType, number][];
      const sum = weights.reduce((s, [, n]) => s + n + 1, 0);
      let r = Math.random() * sum;
      for (const [k, n] of weights) {
        r -= n + 1;
        if (r <= 0) {
          truth = k;
          break;
        }
      }
      truth ??= "schwarzpunkt";
    }
    const ctx = wk.getContext("2d", { willReadFrequently: true })!;
    renderCup(ctx, DECORS[productRef.current], truth, { noise: true, seed: Math.floor(Math.random() * 1e9) });
    const test = ctx.getImageData(0, 0, W, H);
    const res = inspect(test, golden);
    const detected = res.blobs.sort((a, b) => b.area - a.area)[0]?.type;
    const correct = (truth === null && res.ok) || (truth !== null && detected === truth);

    // Hauptanzeige
    const mctx = mc.getContext("2d")!;
    mctx.imageSmoothingEnabled = true;
    mctx.clearRect(0, 0, W * SCALE, H * SCALE);
    mctx.drawImage(wk, 0, 0, W * SCALE, H * SCALE);
    for (const b of res.blobs) {
      const pad = 4;
      mctx.strokeStyle = "#ff3b4a";
      mctx.lineWidth = 2;
      mctx.strokeRect(b.x0 * SCALE - pad, b.y0 * SCALE - pad, (b.x1 - b.x0 + 1) * SCALE + pad * 2, (b.y1 - b.y0 + 1) * SCALE + pad * 2);
      const label = DEFECTS[b.type].label.split(" /")[0];
      mctx.font = "600 11px Archivo, sans-serif";
      const tw = mctx.measureText(label).width + 10;
      const lx = Math.min(W * SCALE - tw - 2, Math.max(2, b.x0 * SCALE - pad));
      const ly = Math.max(16, b.y0 * SCALE - pad - 4);
      mctx.fillStyle = "#ff3b4a";
      mctx.fillRect(lx, ly - 14, tw, 16);
      mctx.fillStyle = "#fff";
      mctx.fillText(label, lx + 5, ly - 2);
    }
    // Differenzbild
    const dc = diffCv.current?.getContext("2d");
    if (dc) dc.putImageData(diffToImage(res.diff, res.mask), 0, 0);

    const shot: Shot = { id: seq.current++, url: wk.toDataURL("image/jpeg", 0.7), ok: res.ok, type: detected, truth };
    setLast({ blobs: res.blobs, ok: res.ok });
    setStrip((s) => [shot, ...s].slice(0, 12));
    if (!res.ok) setGallery((g) => [shot, ...g].slice(0, 6));
    setStats((s) => {
      const byType = { ...s.byType };
      if (detected && !res.ok) byType[detected] = (byType[detected] ?? 0) + 1;
      return { n: s.n + 1, nio: s.nio + (res.ok ? 0 : 1), correct: s.correct + (correct ? 1 : 0), byType, ms: res.ms };
    });
  }, [machineId, demo]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(step, 850);
    return () => clearInterval(t);
  }, [running, step]);

  const acc = stats.n ? stats.correct / stats.n : 1;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {IML_MACHINES.map((id) => (
              <button key={id} onClick={() => onMachine(id)} className={cn("num rounded-md px-2 py-1 text-[11.5px] font-semibold", id === machineId ? "bg-ink text-bg" : "bg-panel-3 text-ink-2 hover:text-ink")}>
                {id}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Tabs size="sm" value={demo} onChange={setDemo} items={[{ value: "demo", label: "Demo (Fehler ×14)" }, { value: "real", label: "Echte Rate" }]} />
            <Button size="sm" onClick={() => setRunning((r) => !r)}>
              {running ? <Pause size={13} /> : <Play size={13} />}
            </Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="relative overflow-hidden rounded-xl border border-line bg-[#1d2228]">
            <canvas ref={main} width={W * SCALE} height={H * SCALE} className="block h-[320px] w-[320px]" />
            <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-[10px] font-semibold text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> CAM-A1 · {machineId}
            </div>
            <motion.div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-cyan-400/0 via-cyan-300/25 to-cyan-400/0" animate={{ y: [-40, 320] }} transition={{ duration: 0.85, repeat: Infinity, ease: "linear" }} />
            <AnimatePresence mode="wait">
              {last && (
                <motion.div key={stats.n} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className={cn("absolute bottom-2 right-2 rounded-md px-2.5 py-1 text-[12px] font-bold text-white", last.ok ? "bg-emerald-600" : "bg-red-600")}>
                  {last.ok ? "i.O." : "n.i.O. → ausgeschleust"}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="label mb-1 text-[9px]">Golden Sample (Referenz)</div>
                <canvas ref={goldenCv} width={W} height={H} className="block aspect-square w-full rounded-lg border border-line" />
              </div>
              <div>
                <div className="label mb-1 text-[9px]">Differenz + Maske</div>
                <canvas ref={diffCv} width={W} height={H} className="block aspect-square w-full rounded-lg border border-line bg-black" />
              </div>
            </div>
            <div className="rounded-lg bg-panel-2 p-2.5 text-[11px] leading-snug text-muted">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink-2">
                <ScanLine size={13} className="text-accent" /> Pipeline je Becher ({fmtNum(stats.ms, 1)} ms im Browser)
              </div>
              Graustufen → Differenz zum Golden Sample → Schwellwert → Öffnung 3×3 → Zusammenhangskomponenten → Regelbasierte Klassifikation (Lage, Form, Helligkeit)
            </div>
          </div>
        </div>
        <div className="mt-3">
          <div className="label mb-1.5">Förderband · letzte 12 Teile</div>
          <div className="flex gap-1.5 overflow-hidden">
            <AnimatePresence initial={false}>
              {strip.map((s) => (
                <motion.div key={s.id} layout initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={cn("relative shrink-0 overflow-hidden rounded-md border-2", s.ok ? "border-ok/60" : "border-crit")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.url} alt="" className="block h-12 w-12" />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-panel-2 px-2.5 py-2">
            <div className="label text-[9px]">Geprüft</div>
            <div className="num text-[17px] font-semibold">{stats.n}</div>
          </div>
          <div className="rounded-lg bg-crit-soft px-2.5 py-2">
            <div className="label text-[9px] text-crit">n.i.O.</div>
            <div className="num text-[17px] font-semibold text-crit">{stats.nio}</div>
          </div>
          <div className="col-span-2 rounded-lg border border-line bg-panel px-2.5 py-2">
            <div className="flex items-center justify-between">
              <div className="label text-[9px]">Klassifikation korrekt</div>
              <Badge sev={acc > 0.95 ? "ok" : "warn"}>Live-Validierung</Badge>
            </div>
            <div className="num text-[17px] font-semibold">{fmtPct(acc, 1)}</div>
            <div className="text-[10.5px] leading-snug text-muted">Wahrer Fehler ist bei simulierten Bildern bekannt – so wird das Prüfsystem laufend gegengeprüft.</div>
          </div>
        </div>
        <div>
          <div className="label mb-1.5">Erkannte Fehlerarten</div>
          <div className="space-y-1">
            {Object.entries(stats.byType).length === 0 && <div className="text-[11.5px] text-muted">Noch keine Fehler erkannt.</div>}
            {(Object.entries(stats.byType) as [DefectType, number][])
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => (
                <div key={k} className="flex items-center justify-between text-[11.5px]">
                  <span className="text-ink-2">{DEFECTS[k].label}</span>
                  <span className="num font-semibold">{n}</span>
                </div>
              ))}
          </div>
        </div>
        <div>
          <div className="label mb-1.5 flex items-center gap-1.5">
            <Camera size={11} /> Ausgeschleuste Teile
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {gallery.map((g) => (
              <div key={g.id} className="overflow-hidden rounded-md border border-crit/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.url} alt="" className="block aspect-square w-full" />
                <div className="truncate bg-crit-soft px-1 py-0.5 text-[9px] font-semibold text-crit">{g.type ? DEFECTS[g.type].label.split(" /")[0] : "?"}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
