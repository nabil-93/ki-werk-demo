"use client";

// Etiketten als DOM-Ebene über dem Canvas (scharf, gut lesbar, klickbar):
//  - Maschinen-Etiketten (nur aus der Nähe)
//  - Gebäude-Etiketten mit Live-Status (aus der Ferne); Klick fliegt zur Halle

import { useFrame } from "@react-three/fiber";
import { memo, useRef } from "react";
import * as THREE from "three";
import { useUi } from "@/lib/client/store";
import { MACHINE_SPOTS, PHASE2_SPOTS } from "./layout";

const ALL_SPOTS = [...MACHINE_SPOTS, ...PHASE2_SPOTS];
const PHASE2_IDS = new Set(PHASE2_SPOTS.map((s) => s.id));
import { cn } from "@/lib/client/cn";
import { STATUS_META } from "@/components/ui/ui";
import type { MachineStatus } from "@/lib/sim/types";

const nodes = new Map<string, HTMLDivElement>();
const last = new Map<string, string>();

/** Gebäude: Position des Etiketts (x, y, z) und Zielansicht */
export const BUILDING_LABELS: { id: string; name: string; x: number; y: number; z: number; view?: string; panel?: "lager" | "tor"; kind?: "A" | "B" | "L" | "S" | "H" | "W" | "T" }[] = [
  { id: "b-hallA", name: "Halle A · Spritzguss", x: 51, y: 13, z: 95, view: "hallA", kind: "A" },
  { id: "b-hallB", name: "Halle B · Thermoformen", x: 89, y: 14, z: -8, view: "hallB", kind: "B" },
  { id: "b-lager", name: "Lager & Versand", x: 90, y: 14, z: 40, view: "versand", panel: "lager", kind: "L" },
  { id: "b-hof", name: "LKW-Hof · 6 Rampen", x: 34, y: 3, z: 24, view: "versand", kind: "H" },
  { id: "b-silo", name: "Granulatsilos", x: 78, y: 18.5, z: -34.5, kind: "S" },
  { id: "b-tor", name: "Werkstor · Schranke", x: 82.7, y: 5, z: -94, view: "tor", panel: "tor", kind: "T" },
  { id: "b-office", name: "Verwaltung", x: 101, y: 14, z: -72 },
  { id: "b-hrl", name: "Hochregallager", x: 59, y: 26.5, z: -74, panel: "lager", kind: "W" },
  { id: "b-hallC", name: "Halle C", x: -40, y: 12, z: -92 },
  { id: "b-tent", name: "Zelthalle", x: -2, y: 9.5, z: 30 },
];

const MACHINE_NEAR = 230; // Maschinen-Etiketten bis zu dieser Kameradistanz
const BUILDING_FAR = 150; // Gebäude-Etiketten ab dieser Kameradistanz
const placed: [number, number][] = [];

export function LabelProjector() {
  const v = useRef(new THREE.Vector3());
  const write = (id: string, next: string) => {
    const el = nodes.get(id);
    if (!el || last.get(id) === next) return;
    last.set(id, next);
    if (next === "hidden") el.style.visibility = "hidden";
    else {
      el.style.visibility = "visible";
      el.style.transform = next;
    }
  };
  useFrame(({ camera, size, controls }) => {
    const project = (x: number, y: number, z: number, maxD: number, minD: number) => {
      const d = camera.position.distanceTo(v.current.set(x, y, z));
      if (d > maxD || d < minD) return "hidden";
      v.current.project(camera);
      if (v.current.z > 1 || Math.abs(v.current.x) > 1.15 || Math.abs(v.current.y) > 1.15) return "hidden";
      const px = Math.round(((v.current.x + 1) / 2) * size.width);
      const py = Math.round(((1 - v.current.y) / 2) * size.height);
      return `translate(${px}px, ${py}px) translate(-50%, -100%)`;
    };
    // Nur schreiben, wenn sich etwas geändert hat (spart Style-Neuberechnungen)
    for (const s of ALL_SPOTS) write(s.id, project(s.x, s.id.startsWith("SG") ? 5.2 : 4.6, s.z, MACHINE_NEAR, 0));
    // Gebäude-Etiketten nur in der Übersicht: beim Heranzoomen (Halle, Werkstor, Maschine) ausblenden –
    // sonst schweben weit entfernte Etiketten (z. B. LKW-Hof) dauerhaft über der Detailansicht
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target;
    const overview = !target || camera.position.distanceTo(target) >= BUILDING_FAR;
    // Gebäude-Etiketten in Listenreihenfolge platzieren; überlappende (unwichtigere) ausblenden
    placed.length = 0;
    for (const b of BUILDING_LABELS) {
      let next = overview ? project(b.x, b.y, b.z, Infinity, BUILDING_FAR) : "hidden";
      if (next !== "hidden") {
        const px = ((v.current.x + 1) / 2) * size.width, py = ((1 - v.current.y) / 2) * size.height;
        if (placed.some(([x, y]) => Math.abs(x - px) < 150 && Math.abs(y - py) < 40)) next = "hidden";
        else placed.push([px, py]);
      }
      write(b.id, next);
    }
  });
  return null;
}

const register = (id: string) => (el: HTMLDivElement | null) => {
  if (el) nodes.set(id, el);
  else {
    nodes.delete(id);
    last.delete(id);
  }
};

const Label = memo(function Label({ id, status, risk, selected, offline, onSelect }: { id: string; status?: MachineStatus; risk: number; selected: boolean; offline?: boolean; onSelect: (id: string) => void }) {
  const showRisk = status === "PRODUKTION" && risk >= 45;
  const meta = status ? STATUS_META[status] : undefined;
  return (
    <div ref={register(id)} className="absolute left-0 top-0 will-change-transform" style={{ visibility: "hidden" }}>
      <button
        onClick={() => onSelect(id)}
        title={offline ? `${id} produziert, liefert aber noch keine Daten – Klick: Anbindung` : undefined}
        className={cn(
          "pointer-events-auto flex items-center gap-1.5 rounded-lg border bg-[var(--glass)] px-2 py-1 text-[11px] font-semibold shadow-[var(--shadow-sm)] transition-transform hover:scale-105",
          selected ? "border-accent ring-2 ring-accent/30" : offline ? "border-dashed border-faint" : showRisk ? (risk >= 75 ? "border-crit/60" : "border-warn/60") : "border-line",
        )}
      >
        <span className="relative flex h-2 w-2">
          {(status === "STOERUNG" || showRisk) && <span className={cn("pulse-ring absolute inset-0 rounded-full", status === "STOERUNG" || risk >= 75 ? "text-crit" : "text-warn")} />}
          <span className="relative h-2 w-2 rounded-full" style={{ background: meta?.color ?? "var(--faint)" }} />
        </span>
        <span className={cn("num", offline ? "text-muted" : "text-ink")}>{id}</span>
        {offline && <span className="text-[10px] font-medium text-muted">nicht angebunden</span>}
        {showRisk && <span className={cn("num rounded px-1 text-[10px]", risk >= 75 ? "bg-crit-soft text-crit" : "bg-warn-soft text-warn")}>KI {risk} %</span>}
        {status && status !== "PRODUKTION" && <span className="text-[10px] font-medium text-muted">{meta?.label}</span>}
      </button>
      <div className="mx-auto h-3 w-px bg-ink/30" />
    </div>
  );
});

const BuildingLabel = memo(function BuildingLabel({ id, name, sub, sev, view, panel }: { id: string; name: string; sub?: string; sev?: "ok" | "warn" | "crit"; view?: string; panel?: "lager" | "tor" }) {
  const click = view || panel;
  const Tag = click ? "button" : "div";
  return (
    <div ref={register(id)} className="absolute left-0 top-0 will-change-transform" style={{ visibility: "hidden" }}>
      <Tag
        {...(click
          ? {
              onClick: () => {
                const st = useUi.getState();
                if (view) st.setTwinView(view);
                // Lager: Bestände mit Produktzeichnungen im rechten Panel
                if (panel === "lager") st.openWarehouse(true);
                // Werkstor: Pförtnerbuch mit Ein- und Ausfahrten des Tages
                if (panel === "tor") st.openGate(true);
              },
              title: panel === "lager" ? "Bestände im Lager anzeigen" : panel === "tor" ? "Pförtnerbuch: Ein- und Ausfahrten heute" : undefined,
            }
          : {})}
        className={cn(
          "flex items-center gap-1.5 whitespace-nowrap rounded-lg border bg-[var(--glass)] px-2.5 py-1 text-left shadow-[var(--shadow-sm)]",
          click ? "pointer-events-auto cursor-pointer transition-transform hover:scale-105" : "pointer-events-none",
          sev === "crit" ? "border-crit/60" : sev === "warn" ? "border-warn/60" : "border-line",
        )}
      >
        {sev && <span className={cn("h-2 w-2 shrink-0 rounded-full", sev === "crit" ? "bg-crit" : sev === "warn" ? "bg-warn" : "bg-ok")} />}
        <span className="leading-tight">
          <span className="block text-[11.5px] font-semibold text-ink">{name}</span>
          {sub && <span className="block text-[10px] text-muted">{sub}</span>}
        </span>
      </Tag>
      <div className="mx-auto h-4 w-px bg-ink/30" />
    </div>
  );
});

// stabile Referenz, damit memo(Label) greift
function onSelect(id: string) {
  const st = useUi.getState();
  st.selectMachine(st.selectedMachine === id ? null : id);
}

export function LabelLayer() {
  // kompakte Signatur: nur neu rendern, wenn sich Status oder gerundetes Risiko ändern
  const sig = useUi((s) => s.snap?.machines.map((m) => `${m.id}:${m.status}:${Math.round((m.prediction?.p72 ?? 0) * 100)}`).join("|") ?? "");
  const extra = useUi((s) => {
    const snap = s.snap;
    if (!snap) return "";
    const loading = snap.visits.filter((x) => x.status === "RAMPE").length;
    const silos = snap.materials.filter((m) => m.id === "M-PPH" || m.id === "M-PPR");
    const minFill = silos.length ? Math.round(Math.min(...silos.map((m) => m.stock / m.capacity)) * 100) : 0;
    const siloSev = silos.some((m) => m.state === "crit") ? "crit" : silos.some((m) => m.state === "warn") ? "warn" : "ok";
    const pallets = snap.stock.reduce((a, x) => a + x.pallets, 0);
    const stockSev = snap.stock.some((x) => x.state === "crit") ? "crit" : snap.stock.some((x) => x.state === "warn") ? "warn" : "ok";
    return `${loading}|${minFill}|${siloSev}|${pallets}|${stockSev}|${snap.yard.onSite}|${snap.yard.late + snap.yard.overstay}|${snap.yard.expectedToday}|${snap.yard.doneToday}`;
  });
  const selected = useUi((s) => s.selectedMachine);
  const byId = new Map(
    sig
      .split("|")
      .filter(Boolean)
      .map((x) => {
        const [id, status, risk] = x.split(":");
        return [id, { status: status as MachineStatus, risk: Number(risk) }] as const;
      }),
  );
  const [loading, minFill, siloSev, pallets, stockSev, onSite, yardIssues, expected, done] = extra.split("|");
  const hall = (prefix: string) => {
    const ms = [...byId.entries()].filter(([id]) => id.startsWith(prefix)).map(([, m]) => m);
    const run = ms.filter((m) => m.status === "PRODUKTION").length;
    const sev: "ok" | "warn" | "crit" = ms.some((m) => m.status === "STOERUNG" || (m.status === "PRODUKTION" && m.risk >= 75)) ? "crit" : ms.some((m) => m.status === "PRODUKTION" && m.risk >= 45) ? "warn" : "ok";
    // Rollout Phase 2: Maschinen ohne Datenanschluss mitzählen
    const blind = prefix === "SG" ? [...PHASE2_IDS].filter((id) => !byId.has(id)).length : 0;
    return { sub: ms.length ? `${run}/${ms.length} in Produktion${blind ? ` · ${blind} ohne Daten` : ""}` : undefined, sev };
  };
  const status: Record<string, { sub?: string; sev?: "ok" | "warn" | "crit" }> = {
    A: hall("SG"),
    B: hall("TF"),
    L: { sub: pallets ? `${pallets} Pal. Fertigware · ${loading} ${loading === "1" ? "Rampe" : "Rampen"} aktiv` : undefined, sev: (stockSev as "ok" | "warn" | "crit") || "ok" },
    S: { sub: minFill ? `min. Füllstand ${minFill} %` : undefined, sev: (siloSev as "ok" | "warn" | "crit") || undefined },
    H: { sub: onSite ? `${onSite} LKW auf dem Hof${Number(yardIssues) ? ` · heute ${yardIssues} verspätet/überzogen` : ""}` : undefined, sev: Number(yardIssues) ? "warn" : "ok" },
    W: { sub: "Klick: Bestände je Produkt", sev: (stockSev as "ok" | "warn" | "crit") || "ok" },
    T: { sub: expected ? `${done} raus · ${onSite} drin · ${expected} kommen noch` : undefined, sev: Number(yardIssues) ? "warn" : "ok" },
  };
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {ALL_SPOTS.map((s) => {
        const m = byId.get(s.id);
        return <Label key={s.id} id={s.id} status={m?.status} risk={m?.risk ?? 0} selected={selected === s.id} offline={!m && PHASE2_IDS.has(s.id)} onSelect={onSelect} />;
      })}
      {BUILDING_LABELS.map((b) => (
        <BuildingLabel key={b.id} id={b.id} name={b.name} view={b.view} panel={b.panel} sub={b.kind ? status[b.kind].sub : undefined} sev={b.kind ? status[b.kind].sev : undefined} />
      ))}
    </div>
  );
}
