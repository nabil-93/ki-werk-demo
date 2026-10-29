// Inline-Kamera: synthetische Prüfbilder + echte Bildverarbeitung (Golden-Sample-Vergleich)
// Pipeline: Graustufen → Differenzbild → Schwellwert → Öffnung (Erosion/Dilatation) → Zusammenhangskomponenten → Klassifikation

import type { DefectType } from "@/lib/sim/types";

export const W = 160;
export const H = 160;

const CUP = { cx: 80, rimY: 28, botY: 140, topHalf: 50, botHalf: 35 };
const LABEL = { y0: 54, y1: 122, inset: 7 };

export interface Decor {
  colors: [string, string, string];
  text: string;
}

export const DECORS: Record<string, Decor> = {
  "P-IML500": { colors: ["#1d4ed8", "#facc15", "#ffffff"], text: "NATUR" },
  "P-IML250": { colors: ["#16a34a", "#fde68a", "#ffffff"], text: "BIO" },
  "P-EIS1000": { colors: ["#db2777", "#fbcfe8", "#ffffff"], text: "EIS" },
  "P-DES125": { colors: ["#7c2d12", "#fdba74", "#ffffff"], text: "CREME" },
};

function halfWidthAt(y: number) {
  const t = (y - CUP.rimY) / (CUP.botY - CUP.rimY);
  return CUP.topHalf + (CUP.botHalf - CUP.topHalf) * t;
}

function cupPath(ctx: CanvasRenderingContext2D, deform = 0) {
  ctx.beginPath();
  ctx.moveTo(CUP.cx - CUP.topHalf, CUP.rimY);
  ctx.lineTo(CUP.cx + CUP.topHalf, CUP.rimY);
  ctx.lineTo(CUP.cx + CUP.botHalf, CUP.botY);
  ctx.lineTo(CUP.cx - CUP.botHalf + deform, CUP.botY);
  ctx.closePath();
}

export interface Injected {
  type: DefectType | null;
}

/** Zeichnet einen Becher; optional mit Fehler. jitter/noise simulieren reale Kamerabedingungen. */
export function renderCup(ctx: CanvasRenderingContext2D, decor: Decor, defect: DefectType | null, opts: { noise?: boolean; seed?: number } = {}) {
  const rnd = mulberry(opts.seed ?? 1);
  const jx = opts.noise ? Math.round((rnd() - 0.5) * 2) : 0;
  const jy = opts.noise ? Math.round((rnd() - 0.5) * 2) : 0;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  // Prüfkabine (diffuses Licht)
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#2a3038");
  g.addColorStop(1, "#1d2228");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.translate(jx, jy);

  const deform = defect === "verformung" ? 6 + Math.round(rnd() * 4) : 0;
  // Becherkörper
  cupPath(ctx, deform);
  const body = ctx.createLinearGradient(CUP.cx - CUP.topHalf, 0, CUP.cx + CUP.topHalf, 0);
  body.addColorStop(0, "#d9dde2");
  body.addColorStop(0.45, "#f7f8fa");
  body.addColorStop(1, "#cfd4da");
  ctx.fillStyle = body;
  ctx.fill();

  // IML-Etikett (im Becherkörper eingeschlossen)
  ctx.save();
  cupPath(ctx, deform);
  ctx.clip();
  let dx = 0, dy = 0, rot = 0;
  if (defect === "etikettenversatz") {
    const mode = rnd();
    if (mode < 0.45) dx = (rnd() < 0.5 ? -1 : 1) * (5 + Math.round(rnd() * 4));
    else if (mode < 0.8) dy = (rnd() < 0.5 ? -1 : 1) * (5 + Math.round(rnd() * 3));
    else rot = (rnd() < 0.5 ? -1 : 1) * (0.1 + rnd() * 0.05);
  }
  ctx.translate(CUP.cx + dx, (LABEL.y0 + LABEL.y1) / 2 + dy);
  ctx.rotate(rot);
  ctx.translate(-CUP.cx, -(LABEL.y0 + LABEL.y1) / 2);
  const lw0 = halfWidthAt(LABEL.y0) - LABEL.inset;
  const lw1 = halfWidthAt(LABEL.y1) - LABEL.inset;
  ctx.beginPath();
  ctx.moveTo(CUP.cx - lw0, LABEL.y0);
  ctx.lineTo(CUP.cx + lw0, LABEL.y0);
  ctx.lineTo(CUP.cx + lw1, LABEL.y1);
  ctx.lineTo(CUP.cx - lw1, LABEL.y1);
  ctx.closePath();
  ctx.fillStyle = decor.colors[0];
  ctx.fill();
  ctx.fillStyle = decor.colors[1];
  ctx.fillRect(CUP.cx - lw0, LABEL.y0 + 8, lw0 * 2, 9);
  ctx.beginPath();
  ctx.arc(CUP.cx + 18, LABEL.y0 + 44, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = decor.colors[2];
  ctx.font = "800 15px Archivo, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(decor.text, CUP.cx - 6, LABEL.y0 + 42);
  ctx.restore();

  // Rand (Lippe)
  ctx.fillStyle = "#eef0f3";
  ctx.beginPath();
  ctx.ellipse(CUP.cx, CUP.rimY, CUP.topHalf + 3, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c3c9d0";
  ctx.beginPath();
  ctx.ellipse(CUP.cx, CUP.rimY - 1, CUP.topHalf - 2, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Fehler
  if (defect === "schwarzpunkt") {
    const y = 40 + rnd() * 92;
    const hw = halfWidthAt(y) - 10;
    const x = CUP.cx + (rnd() * 2 - 1) * hw;
    ctx.fillStyle = "#121212";
    ctx.beginPath();
    ctx.arc(x, y, 2.4 + rnd() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (defect === "riss") {
    // Spannungsriss (Weißbruch) im Etikettenbereich
    const y = 66 + rnd() * 42;
    const x = CUP.cx + (rnd() * 2 - 1) * (halfWidthAt(y) - LABEL.inset - 16);
    const a = rnd() * Math.PI;
    const len = 14 + rnd() * 10;
    // Kontrast zum Untergrund: auf dunklem Dekor hell (Weißbruch), auf hellem dunkel
    // stückweise zeichnen, Farbe je Abschnitt nach lokalem Untergrund
    const under = ctx.getImageData(0, 0, W, H).data;
    const pts: [number, number][] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      pts.push([x + Math.cos(a) * len * t, y + Math.sin(a) * len * t + 2 * Math.sin(t * Math.PI)]);
    }
    ctx.lineWidth = 3.4;
    ctx.lineCap = "round";
    for (let k = 0; k < pts.length - 1; k++) {
      const [px, py] = pts[k];
      const o = (Math.round(py) * W + Math.round(px)) * 4;
      const l = 0.299 * under[o] + 0.587 * under[o + 1] + 0.114 * under[o + 2];
      ctx.strokeStyle = l > 140 ? "#33383f" : "#f4f6f9";
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(pts[k + 1][0], pts[k + 1][1]);
      ctx.stroke();
    }
  } else if (defect === "kurzschuss") {
    const x = CUP.cx + (rnd() * 2 - 1) * 30;
    const w = 10 + rnd() * 10;
    ctx.fillStyle = "#262b32";
    ctx.beginPath();
    ctx.moveTo(x - w / 2, CUP.rimY - 8);
    ctx.lineTo(x + w / 2, CUP.rimY - 8);
    ctx.lineTo(x + w / 3, CUP.rimY + 7);
    ctx.lineTo(x - w / 3, CUP.rimY + 7);
    ctx.closePath();
    ctx.fill();
  } else if (defect === "grat") {
    const right = rnd() < 0.5;
    const y = CUP.rimY + 4 + rnd() * 20;
    const x = CUP.cx + (right ? 1 : -1) * (halfWidthAt(y) + 1);
    ctx.fillStyle = "#f2f4f7";
    ctx.fillRect(right ? x : x - 9 - rnd() * 6, y, 9 + rnd() * 6, 4);
  }
  ctx.restore();

  // Sensorrauschen
  if (opts.noise) {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const gain = (rnd() - 0.5) * 10;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 9 + gain;
      d[i] = clamp8(d[i] + n);
      d[i + 1] = clamp8(d[i + 1] + n);
      d[i + 2] = clamp8(d[i + 2] + n);
    }
    ctx.putImageData(img, 0, 0);
  }
}

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function luma(img: ImageData) {
  const out = new Float32Array(W * H);
  const d = img.data;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) out[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return out;
}

export interface Blob {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
  cx: number;
  cy: number;
  darker: number; // mittlere Helligkeitsänderung (negativ = dunkler als Referenz)
  type: DefectType;
  score: number;
}

export interface InspectResult {
  ok: boolean;
  blobs: Blob[];
  diff: Float32Array;
  mask: Uint8Array;
  ms: number;
}

/** Vergleicht ein Prüfbild mit dem Golden Sample und klassifiziert Abweichungen */
export function inspect(test: ImageData, golden: ImageData, threshold = 40): InspectResult {
  const t0 = performance.now();
  const a = luma(test);
  const b = luma(golden);
  // 1) Bildregistrierung: beste Verschiebung (±2 px) per Summe absoluter Differenzen auf grobem Raster
  let best = { dx: 0, dy: 0, sad: Infinity };
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      let sad = 0;
      for (let y = 4; y < H - 4; y += 3)
        for (let x = 4; x < W - 4; x += 3) sad += Math.abs(a[y * W + x] - b[(y - dy) * W + (x - dx)]);
      if (sad < best.sad) best = { dx, dy, sad };
    }
  // 2) Helligkeitsausgleich (Median der Differenz statt Mittelwert – robust gegen Fehlerstellen)
  const samples: number[] = [];
  for (let y = 4; y < H - 4; y += 5) for (let x = 4; x < W - 4; x += 5) samples.push(a[y * W + x] - b[(y - best.dy) * W + (x - best.dx)]);
  samples.sort((p, q) => p - q);
  const gain = samples[samples.length >> 1] ?? 0;
  const diff = new Float32Array(W * H);
  const raw = new Uint8Array(W * H);
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      const dd = a[i] - b[(y - best.dy) * W + (x - best.dx)] - gain;
      diff[i] = dd;
      raw[i] = Math.abs(dd) > threshold ? 1 : 0;
    }
  // Öffnung 3×3 (entfernt Rauschen und 1-px-Kanten durch Bildversatz)
  const er = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      let all = 1;
      for (let k = -1; k <= 1 && all; k++) for (let l = -1; l <= 1; l++) if (!raw[(y + k) * W + x + l]) { all = 0; break; }
      er[y * W + x] = all;
    }
  const mask = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      let any = 0;
      for (let k = -1; k <= 1 && !any; k++) for (let l = -1; l <= 1; l++) if (er[(y + k) * W + x + l]) { any = 1; break; }
      mask[y * W + x] = any;
    }
  // Zusammenhangskomponenten (8er-Nachbarschaft) mit Form- und Helligkeitsmerkmalen
  const seen = new Uint8Array(W * H);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || seen[i]) continue;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sd = 0;
    let lost = 0, gain2 = 0, veryDark = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p / W) | 0;
      area++;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
      sd += diff[p];
      const gl = b[Math.max(0, Math.min(H - 1, y - best.dy)) * W + Math.max(0, Math.min(W - 1, x - best.dx))];
      if (a[p] < 62 && gl > 150) lost++;
      if (diff[p] > 40) gain2++;
      if (a[p] < 42) veryDark++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let k = -1; k <= 1; k++)
        for (let l = -1; l <= 1; l++) {
          const q = p + k * W + l;
          const qx = x + l;
          if (qx < 0 || qx >= W || q < 0 || q >= W * H || seen[q] || !mask[q]) continue;
          seen[q] = 1;
          stack.push(q);
        }
    }
    if (area < 14) continue;
    const cx = sx / area;
    const cy = sy / area;
    // Hauptachsen aus zweiten Momenten -> Elongation (lang/dünn vs. kompakt)
    const vxx = sxx / area - cx * cx;
    const vyy = syy / area - cy * cy;
    const vxy = sxy / area - cx * cy;
    const tr = vxx + vyy;
    const det = vxx * vyy - vxy * vxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = Math.max(0.25, tr / 2 - disc);
    const f: Feat = { x0, y0, x1, y1, area, cx, cy, meanDiff: sd / area, elong: Math.sqrt(l1 / l2), lostFrac: lost / area, gainFrac: gain2 / area, darkFrac: veryDark / area };
    blobs.push({ x0, y0, x1, y1, area, cx, cy, darker: sd / area, type: classify(f), score: Math.min(1, area / 60 + Math.abs(sd / area) / 200) });
  }
  // Teilstücke desselben Etikettenversatzes zusammenfassen
  const labelBlobs = blobs.filter((bb) => bb.type === "etikettenversatz");
  const others = blobs.filter((bb) => bb.type !== "etikettenversatz");
  const merged = labelBlobs.length > 1 ? [mergeBlobs(labelBlobs), ...others] : blobs;
  return { ok: merged.length === 0, blobs: merged, diff, mask, ms: performance.now() - t0 };
}

interface Feat {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
  cx: number;
  cy: number;
  meanDiff: number;
  elong: number;
  lostFrac: number;
  gainFrac: number;
  darkFrac: number;
}

function mergeBlobs(bs: Blob[]): Blob {
  const x0 = Math.min(...bs.map((q) => q.x0));
  const y0 = Math.min(...bs.map((q) => q.y0));
  const x1 = Math.max(...bs.map((q) => q.x1));
  const y1 = Math.max(...bs.map((q) => q.y1));
  const area = bs.reduce((s, q) => s + q.area, 0);
  return { x0, y0, x1, y1, area, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, darker: 0, type: "etikettenversatz", score: Math.min(1, area / 80) };
}

/** Regelbasierte Fehlerklassifikation – nachvollziehbar wie in klassischer Industrie-Bildverarbeitung */
function classify(f: Feat): DefectType {
  const halfW = halfWidthAt(Math.min(Math.max(f.cy, CUP.rimY), CUP.botY));
  const edgeDist = halfW - Math.abs(f.cx - CUP.cx); // > 0 innen, < 0 außerhalb der Kontur
  const labelHalf = halfWidthAt(f.cy) - LABEL.inset;
  const nearLabelEdge =
    Math.abs(f.cy - LABEL.y0) < 6 || Math.abs(f.cy - LABEL.y1) < 6 || Math.abs(Math.abs(f.cx - CUP.cx) - labelHalf) < 6 || f.y1 - f.y0 > 40 || f.x1 - f.x0 > 40;
  // 1) Rand mit fehlendem Material
  if (f.cy < CUP.rimY + 9 && (f.lostFrac > 0.35 || f.meanDiff < -25)) return "kurzschuss";
  // 2) Zusätzliches Material außerhalb der Kontur
  if (edgeDist < -0.5 && f.gainFrac > 0.4) return "grat";
  // 3) sehr dunkel und kompakt
  if (f.darkFrac > 0.45 && f.elong < 2.6 && f.area < 120) return "schwarzpunkt";
  // 4) Fehlende Körperfläche am unteren Seitenrand (keilförmig)
  if (f.lostFrac > 0.35 && edgeDist < 14 && f.cy > LABEL.y0 + 18 && (f.elong > 2.2 || f.area > 150)) return "verformung";
  // 5) lang und dünn, nicht an der Etikettenkante
  if (f.elong > 2.8 && f.area < 220 && (!nearLabelEdge || f.elong > 5)) return "riss";
  // 6) Etikettenbereich
  if (f.cy > LABEL.y0 - 10 && f.cy < LABEL.y1 + 10 && (nearLabelEdge || f.area > 120)) return "etikettenversatz";
  return f.elong > 2.2 ? "riss" : "schwarzpunkt";
}
/** Differenzbild als Heatmap (für die Anzeige) */
export function diffToImage(diff: Float32Array, mask: Uint8Array): ImageData {
  const img = new ImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const v = Math.min(255, Math.abs(diff[i]) * 3);
    const j = i * 4;
    if (mask[i]) {
      img.data[j] = 255;
      img.data[j + 1] = 60;
      img.data[j + 2] = 70;
    } else {
      img.data[j] = v * 0.4;
      img.data[j + 1] = v * 0.75;
      img.data[j + 2] = v;
    }
    img.data[j + 3] = 255;
  }
  return img;
}
