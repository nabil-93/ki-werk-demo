"use client";

// Produktzeichnungen der Artikel des Werks (SVG): IML-Becher, Deckel, Eisbecher, Dessertbecher,
// thermogeformte Joghurtbecher, Feinkost- und Salatschalen. Keine Fotos – stilisiert, aber erkennbar.

import { useId } from "react";

type Cup = { kind: "cup"; topR: number; botR: number; top: number; bottom: number; label: [string, string]; accent: string; text: string; sub: string; iml: boolean; ribs?: boolean };
type Lid = { kind: "lid"; r: number; color: string; ring: string };
type Tray = { kind: "tray"; w: number; d: number; h: number; tint: string; flange: number };
type Art = Cup | Lid | Tray;

const ART: Record<string, Art> = {
  "P-IML500": { kind: "cup", topR: 35, botR: 26, top: 20, bottom: 100, label: ["#1e40af", "#3b82f6"], accent: "#ffffff", text: "Joghurt", sub: "500 ml", iml: true },
  "P-IML250": { kind: "cup", topR: 30, botR: 22, top: 34, bottom: 100, label: ["#be123c", "#fb7185"], accent: "#fff1f2", text: "Erdbeer", sub: "250 ml", iml: true },
  "P-EIS1000": { kind: "cup", topR: 42, botR: 34, top: 34, bottom: 100, label: ["#92400e", "#f59e0b"], accent: "#fef3c7", text: "Vanille-Eis", sub: "1 Liter", iml: true },
  "P-DES125": { kind: "cup", topR: 25, botR: 18, top: 48, bottom: 100, label: ["#5b21b6", "#a78bfa"], accent: "#f5f3ff", text: "Dessert", sub: "125 ml", iml: true },
  "P-JOG150": { kind: "cup", topR: 27, botR: 19, top: 36, bottom: 100, label: ["#15803d", "#86efac"], accent: "#f0fdf4", text: "Joghurt", sub: "150 g", iml: false, ribs: true },
  "P-DK95": { kind: "lid", r: 40, color: "#f8fafc", ring: "#cbd5e1" },
  "P-DK75": { kind: "lid", r: 32, color: "#eef2ff", ring: "#a5b4fc" },
  "P-FK200": { kind: "tray", w: 70, d: 40, h: 22, tint: "#93c5fd", flange: 4 },
  "P-SAL375": { kind: "tray", w: 78, d: 46, h: 30, tint: "#86efac", flange: 7 },
};

export default function ProductArt({ productId, size = 72, className }: { productId: string; size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const art = ART[productId] ?? ART["P-IML500"];
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" className={className} role="img" aria-label="Produktzeichnung">
      <defs>
        <linearGradient id={`body${id}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.28" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.32" />
        </linearGradient>
        {art.kind === "cup" && (
          <linearGradient id={`lab${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={art.label[1]} />
            <stop offset="1" stopColor={art.label[0]} />
          </linearGradient>
        )}
        {art.kind === "tray" && (
          <linearGradient id={`tr${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={art.tint} stopOpacity="0.25" />
            <stop offset="1" stopColor={art.tint} stopOpacity="0.55" />
          </linearGradient>
        )}
      </defs>
      <ellipse cx="60" cy="108" rx="40" ry="6" fill="#000" opacity="0.12" />
      {art.kind === "cup" && <CupArt a={art} id={id} />}
      {art.kind === "lid" && <LidArt a={art} id={id} />}
      {art.kind === "tray" && <TrayArt a={art} id={id} />}
    </svg>
  );
}

function CupArt({ a, id }: { a: Cup; id: string }) {
  const cx = 60;
  const ry = a.topR * 0.2;
  const by = a.bottom - 4;
  const bry = a.botR * 0.2;
  const body = `M${cx - a.topR},${a.top} L${cx - a.botR},${by} A${a.botR},${bry} 0 0 0 ${cx + a.botR},${by} L${cx + a.topR},${a.top} Z`;
  // Etikettenband (IML: fast bis an den Rand, gedruckt: schmaler)
  const l0 = a.top + (a.bottom - a.top) * (a.iml ? 0.12 : 0.18);
  const l1 = a.top + (a.bottom - a.top) * (a.iml ? 0.9 : 0.74);
  const rAt = (y: number) => a.topR + ((a.botR - a.topR) * (y - a.top)) / (by - a.top);
  const r0 = rAt(l0), r1 = rAt(l1);
  const band = `M${cx - r0},${l0} A${r0},${r0 * 0.2} 0 0 0 ${cx + r0},${l0} L${cx + r1},${l1} A${r1},${r1 * 0.2} 0 0 1 ${cx - r1},${l1} Z`;
  const mid = (l0 + l1) / 2;
  const fs = Math.max(7, a.topR * 0.32);
  return (
    <g>
      <path d={body} fill="#f8fafc" stroke="#94a3b8" strokeWidth="1" />
      <path d={band} fill={`url(#lab${id})`} />
      {/* Dekor: Welle und Frucht-/Motivkreis */}
      <path d={`M${cx - r0 + 2},${mid + 6} q${r0 * 0.5},-9 ${r0},0 t${r0},0`} fill="none" stroke={a.accent} strokeWidth="2.2" opacity="0.85" />
      <circle cx={cx + r0 * 0.42} cy={l0 + (l1 - l0) * 0.3} r={Math.max(4, r0 * 0.17)} fill={a.accent} opacity="0.9" />
      <text x={cx - 2} y={mid - 2} textAnchor="middle" fontSize={fs} fontWeight="800" fill={a.accent} style={{ fontFamily: "Archivo, system-ui, sans-serif" }}>
        {a.text}
      </text>
      <text x={cx} y={mid + fs * 1.35} textAnchor="middle" fontSize={fs * 0.62} fontWeight="700" fill={a.accent} opacity="0.9" style={{ fontFamily: "Archivo, system-ui, sans-serif" }}>
        {a.sub}
      </text>
      {a.ribs && [0, 1, 2].map((i) => <path key={i} d={`M${cx - rAt(l1 + 4 + i * 4)},${l1 + 4 + i * 4} A${rAt(l1 + 4 + i * 4)},${rAt(l1 + 4 + i * 4) * 0.2} 0 0 0 ${cx + rAt(l1 + 4 + i * 4)},${l1 + 4 + i * 4}`} fill="none" stroke="#94a3b8" strokeWidth="0.8" />)}
      <path d={body} fill={`url(#body${id})`} />
      {/* Öffnung mit Stapelrand */}
      <ellipse cx={cx} cy={a.top} rx={a.topR + 2.5} ry={ry + 0.6} fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" />
      <ellipse cx={cx} cy={a.top + 0.6} rx={a.topR - 1.5} ry={ry - 1} fill="#cbd5e1" />
      <ellipse cx={cx} cy={a.top + 1.4} rx={a.topR - 4} ry={ry - 2.2} fill="#f1f5f9" />
    </g>
  );
}

function LidArt({ a, id }: { a: Lid; id: string }) {
  const cx = 60;
  const ry = a.r * 0.3;
  return (
    <g>
      {[0, 1, 2].map((k) => {
        const cy = 92 - k * 13;
        return (
          <g key={k}>
            <path d={`M${cx - a.r},${cy - 6} L${cx - a.r},${cy} A${a.r},${ry} 0 0 0 ${cx + a.r},${cy} L${cx + a.r},${cy - 6} Z`} fill={a.ring} />
            <path d={`M${cx - a.r},${cy - 6} L${cx - a.r},${cy} A${a.r},${ry} 0 0 0 ${cx + a.r},${cy} L${cx + a.r},${cy - 6} Z`} fill={`url(#body${id})`} />
            <ellipse cx={cx} cy={cy - 6} rx={a.r} ry={ry} fill={a.color} stroke={a.ring} strokeWidth="1" />
            <ellipse cx={cx} cy={cy - 6} rx={a.r * 0.78} ry={ry * 0.78} fill="none" stroke={a.ring} strokeWidth="1.4" />
            <ellipse cx={cx} cy={cy - 6} rx={a.r * 0.55} ry={ry * 0.55} fill="none" stroke={a.ring} strokeWidth="0.8" opacity="0.7" />
            {/* Aufreißlasche */}
            <path d={`M${cx + a.r - 2},${cy - 6} l9,1.5 l-1,4 l-9,-1.5 Z`} fill={a.color} stroke={a.ring} strokeWidth="0.8" />
          </g>
        );
      })}
    </g>
  );
}

function TrayArt({ a, id }: { a: Tray; id: string }) {
  // isometrische Schale: Oberkante als Parallelogramm, Boden kleiner
  const cx = 60, top = 52;
  const k = 0.5;
  const P = (x: number, z: number, y: number) => `${cx + x - z * k},${top + y + z * k * 0.9}`;
  const w = a.w / 2, d = a.d / 2, f = a.flange;
  const inset = 0.78;
  const rim = [P(-w - f, -d - f, 0), P(w + f, -d - f, 0), P(w + f, d + f, 0), P(-w - f, d + f, 0)].join(" ");
  const open = [P(-w, -d, 0), P(w, -d, 0), P(w, d, 0), P(-w, d, 0)].join(" ");
  const bot = [P(-w * inset, -d * inset, a.h), P(w * inset, -d * inset, a.h), P(w * inset, d * inset, a.h), P(-w * inset, d * inset, a.h)];
  const front = [P(-w, d, 0), P(w, d, 0), bot[2], bot[3]].join(" ");
  const side = [P(w, -d, 0), P(w, d, 0), bot[2], bot[1]].join(" ");
  return (
    <g>
      <polygon points={bot.join(" ")} fill={a.tint} opacity="0.35" />
      <polygon points={side} fill={`url(#tr${id})`} stroke="#64748b" strokeWidth="0.8" />
      <polygon points={front} fill={`url(#tr${id})`} stroke="#64748b" strokeWidth="0.8" />
      <polygon points={rim} fill="#f8fafc" fillOpacity="0.8" stroke="#64748b" strokeWidth="1" />
      <polygon points={open} fill={a.tint} fillOpacity="0.18" stroke="#64748b" strokeWidth="0.9" />
      {/* Glanzkante */}
      <line x1={Number(P(-w + 4, d, 4).split(",")[0])} y1={Number(P(-w + 4, d, 4).split(",")[1])} x2={Number(P(w - 6, d, 4).split(",")[0])} y2={Number(P(w - 6, d, 4).split(",")[1])} stroke="#fff" strokeWidth="2" opacity="0.7" />
    </g>
  );
}
