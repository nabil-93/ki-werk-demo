"use client";

// Vereinfachtes Schema: Daten von außen (Bereiche) → KI-Werk (sammeln, prüfen, verbinden) → was daraus wird

import { useMemo } from "react";
import type { ConnectorView } from "@/lib/sim/types";
import { fmtInt } from "@/lib/ai/format";

const VW = 1200;
const VH = 470;
const COL = { src: 20, mid: 470, out: 900 };
const SRC_W = 270;
const MID_W = 260;
const OUT_W = 280;

// Bereiche statt Systemnamen – jede Gruppe bündelt die angebundenen Quellen eines Fachbereichs
export const AREAS = [
  { id: "auftraege", label: "Aufträge & Kunden", sub: "Aufträge, Kunden, Preise, Anfragen", sources: ["sap", "crm"] },
  { id: "maschinen", label: "Maschinen & Sensoren", sub: "Status, Stückzahlen, Schwingung, Temperatur", sources: ["mes", "iot"] },
  { id: "qualitaet", label: "Qualität", sub: "Prüfungen, Kamerabefunde", sources: ["caq"] },
  { id: "lager", label: "Lager & Material", sub: "Bestände, Lagerplätze, Wareneingang", sources: ["wms"] },
  { id: "transport", label: "Transport & LKW", sub: "Sendungen, Ankunftszeiten", sources: ["tms"] },
  { id: "wartung", label: "Wartung", sub: "Wartungsaufträge, Ersatzteile", sources: ["cmms"] },
];

const STEPS = [
  ["Sammeln", "alle Daten an einem Ort"],
  ["Prüfen", "vollständig, aktuell, plausibel"],
  ["Verbinden", "ein Auftrag – ein Bild"],
];

const OUTPUTS = [
  ["Live-Lagebild", "Leitstand · 3D-Werk"],
  ["Frühwarnung Maschinen", "KI-Wächter"],
  ["Qualitätskontrolle", "Kamera + Statistik"],
  ["Liefertermine", "Vertrieb"],
  ["Berichte & Zahlen", "Tag, Woche, Monat"],
  ["KI-Werksexperte", "Fragen in normaler Sprache"],
];

function curve(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

export function areaStats(connectors: ConnectorView[]) {
  return AREAS.map((a) => {
    const cs = connectors.filter((c) => a.sources.includes(c.id));
    return {
      ...a,
      perMin: cs.reduce((s, c) => s + c.recordsPerMin, 0),
      ok: cs.every((c) => c.status === "online"),
    };
  });
}

export default function Pipeline({ connectors }: { connectors: ConnectorView[] }) {
  const areas = useMemo(() => areaStats(connectors), [connectors]);
  const rowY = AREAS.map((_, i) => 60 + i * ((VH - 100) / (AREAS.length - 1)));
  const midY = VH / 2 + 10;
  const midH = 250;

  return (
    <div className="relative w-full overflow-x-auto">
      <svg viewBox={`0 0 ${VW} ${VH}`} className="h-auto w-full min-w-[900px]">
        <defs>
          <linearGradient id="beam" x1="0" x2="1">
            <stop offset="0%" stopColor="var(--ai-1)" stopOpacity="0.2" />
            <stop offset="50%" stopColor="var(--ai-1)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--ai-2)" stopOpacity="0.2" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Spaltenüberschriften */}
        {[
          [COL.src + SRC_W / 2, "Daten von außen"],
          [COL.mid + MID_W / 2, "KI-Werk"],
          [COL.out + OUT_W / 2, "Was daraus wird"],
        ].map(([x, t]) => (
          <text key={String(t)} x={Number(x)} y={18} textAnchor="middle" className="fill-[var(--muted)]" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {t}
          </text>
        ))}

        {/* Bereiche → KI-Werk */}
        {areas.map((a, i) => {
          const d = curve(COL.src + SRC_W, rowY[i], COL.mid, midY - 60 + i * 24);
          // stabile Dauer (Größenordnung), damit Animationen bei Live-Updates nicht neu starten
          const dur = Math.max(1, 3.2 - Math.round(Math.log10(a.perMin + 1)) * 0.6);
          return (
            <g key={a.id}>
              <path d={d} fill="none" stroke="var(--line)" strokeWidth={1.5} />
              <path d={d} fill="none" stroke={a.ok ? "var(--accent)" : "var(--warn)"} strokeOpacity={0.35} strokeWidth={1.5} className="flow-dash" />
              {[0, 1, 2].map((k) => (
                <circle key={k} r={3} fill={a.ok ? "var(--accent)" : "var(--warn)"} filter="url(#glow)">
                  <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={d} begin={`${(k * dur) / 3}s`} />
                </circle>
              ))}
            </g>
          );
        })}

        {/* KI-Werk → Ergebnisse */}
        {OUTPUTS.map((_, i) => {
          const d = curve(COL.mid + MID_W, midY - 60 + i * 24, COL.out, rowY[i]);
          return (
            <g key={i}>
              <path d={d} fill="none" stroke="var(--line)" strokeWidth={1.5} />
              <circle r={3} fill="var(--ok)" filter="url(#glow)">
                <animateMotion dur="1.8s" repeatCount="indefinite" path={d} begin={`${i * 0.3}s`} />
              </circle>
            </g>
          );
        })}

        {/* Bereiche */}
        {areas.map((a, i) => (
          <g key={a.id} transform={`translate(${COL.src}, ${rowY[i] - 25})`}>
            <rect width={SRC_W} height={50} rx={10} className="fill-[var(--panel)] stroke-[var(--line)]" />
            <circle cx={16} cy={25} r={4.5} fill={a.ok ? "var(--ok)" : "var(--warn)"} />
            <text x={30} y={21} className="fill-[var(--ink)]" style={{ fontSize: 13, fontWeight: 650 }}>
              {a.label}
            </text>
            <text x={30} y={38} className="fill-[var(--muted)]" style={{ fontSize: 10.5 }}>
              {a.sub}
            </text>
          </g>
        ))}

        {/* KI-Werk: sammeln, prüfen, verbinden */}
        <g transform={`translate(${COL.mid}, ${midY - midH / 2})`}>
          <rect width={MID_W} height={midH} rx={16} className="fill-[var(--panel)]" stroke="url(#beam)" strokeWidth={2} />
          <text x={MID_W / 2} y={32} textAnchor="middle" className="fill-[var(--ink)]" style={{ fontSize: 15, fontWeight: 750 }}>
            KI-Werk
          </text>
          <text x={MID_W / 2} y={50} textAnchor="middle" className="fill-[var(--muted)]" style={{ fontSize: 10.5 }}>
            ein gemeinsamer Datenbestand
          </text>
          {STEPS.map(([t, s], i) => (
            <g key={t} transform={`translate(16, ${68 + i * 58})`}>
              <rect width={MID_W - 32} height={48} rx={9} className="fill-[var(--panel-2)]" />
              <circle cx={20} cy={24} r={11} fill="var(--accent)" />
              <text x={20} y={28} textAnchor="middle" fill="#fff" style={{ fontSize: 11, fontWeight: 700 }}>
                {i + 1}
              </text>
              <text x={40} y={21} className="fill-[var(--ink)]" style={{ fontSize: 12.5, fontWeight: 650 }}>
                {t}
              </text>
              <text x={40} y={37} className="fill-[var(--muted)]" style={{ fontSize: 10.5 }}>
                {s}
              </text>
            </g>
          ))}
        </g>

        {/* Ergebnisse */}
        {OUTPUTS.map(([t, s], i) => (
          <g key={t} transform={`translate(${COL.out}, ${rowY[i] - 25})`}>
            <rect width={OUT_W} height={50} rx={10} className="fill-[var(--panel)] stroke-[var(--line)]" />
            <circle cx={16} cy={25} r={4.5} fill="var(--ok)" />
            <text x={30} y={21} className="fill-[var(--ink)]" style={{ fontSize: 13, fontWeight: 650 }}>
              {t}
            </text>
            <text x={30} y={38} className="fill-[var(--muted)]" style={{ fontSize: 10.5 }}>
              {s}
            </text>
          </g>
        ))}

        {/* Datenaufkommen je Bereich */}
        {areas.map((a, i) => (
          <text key={a.id} x={COL.src + SRC_W - 10} y={rowY[i] - 6} textAnchor="end" className="fill-[var(--faint)]" style={{ fontSize: 9.5, fontFamily: "var(--font-jetbrains)" }}>
            {fmtInt(a.perMin)}/min
          </text>
        ))}
      </svg>
    </div>
  );
}
