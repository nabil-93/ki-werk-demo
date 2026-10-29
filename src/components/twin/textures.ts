// Prozedurale Texturen (Canvas) – keine externen Bilder nötig

import * as THREE from "three";

const cache = new Map<string, THREE.Texture>();
const FONT = '"Archivo", "Segoe UI", system-ui, sans-serif';

function tex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  draw(ctx);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  cache.set(key, t);
  return t;
}

/** Schriftzug auf transparentem Grund (Bodenmarkierung, Schilder) */
export function textTexture(text: string, opts: { color?: string; bg?: string; size?: number; weight?: number; w?: number; h?: number; sub?: string; align?: CanvasTextAlign } = {}) {
  const { color = "#ffffff", bg, size = 84, weight = 800, w = 1024, h = 192, sub, align = "center" } = opts;
  return tex(`text:${text}:${color}:${bg}:${size}:${sub}:${w}:${h}`, w, h, (c) => {
    c.clearRect(0, 0, w, h);
    if (bg) {
      c.fillStyle = bg;
      c.beginPath();
      c.roundRect(4, 4, w - 8, h - 8, 26);
      c.fill();
    }
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = "middle";
    // lange Namen passen sich der Schildbreite an
    let fs = size;
    c.font = `${weight} ${fs}px ${FONT}`;
    while (fs > 24 && c.measureText(text).width > w - 70) c.font = `${weight} ${(fs -= 6)}px ${FONT}`;
    const x = align === "center" ? w / 2 : 40;
    c.fillText(text, x, sub ? h * 0.4 : h / 2 + 4);
    if (sub) {
      c.globalAlpha = 0.75;
      c.font = `600 ${Math.round(Math.min(size, fs * 1.4) * 0.42)}px ${FONT}`;
      c.fillText(sub, x, h * 0.76);
    }
  });
}

/** Seitenwand Sattelauflieger (fiktive Spedition) */
export function trailerTexture(name: string, bg: string, accent: string) {
  return tex(`trailer:${name}`, 1024, 256, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, 1024, 256);
    c.fillStyle = accent;
    c.fillRect(0, 210, 1024, 46);
    c.globalAlpha = 0.12;
    c.beginPath();
    c.moveTo(560, 210);
    c.lineTo(1024, 90);
    c.lineTo(1024, 210);
    c.fill();
    c.globalAlpha = 1;
    c.fillStyle = accent;
    c.font = `800 78px ${FONT}`;
    c.textBaseline = "middle";
    c.fillText(name, 60, 100);
    c.globalAlpha = 0.65;
    c.font = `600 30px ${FONT}`;
    c.fillText("Lebensmittelverpackung · hygienisch · temperiert", 64, 165);
  });
}

/** Palettenladung (foliert, Becherkartons) */
export function palletLoadTexture() {
  return tex("load", 128, 128, (c) => {
    c.fillStyle = "#e9edf2";
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = "rgba(120,140,170,0.28)";
    for (let y = 4; y < 128; y += 12) c.fillRect(0, y, 128, 4);
    c.fillStyle = "rgba(255,255,255,0.8)";
    for (let x = 8; x < 128; x += 40) c.fillRect(x, 0, 5, 128);
  });
}
