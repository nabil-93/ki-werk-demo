"use client";

import { create } from "zustand";
import type { Snapshot } from "@/lib/sim/types";

export interface UiState {
  snap: Snapshot | null;
  connected: boolean;
  lastError?: string;
  copilotOpen: boolean;
  copilotPrompt?: { text: string; nonce: number };
  directorOpen: boolean;
  theme: "light" | "dark";
  sidebarCollapsed: boolean;
  selectedMachine: string | null;
  /** angeklickter LKW (Zeitfenster-ID) im 3D-Zwilling */
  selectedVisit: string | null;
  /** Lagerübersicht im rechten Panel des Leitstands */
  warehouseOpen: boolean;
  /** Pförtnerbuch (Werkstor) im rechten Panel */
  gateOpen: boolean;
  openGate: (v: boolean) => void;
  /** angeklickte Verladerampe (1–6) im rechten Panel */
  dockOpen: number | null;
  openDock: (d: number | null) => void;
  /** Artikel-Detail (aus der Lagerübersicht) */
  selectedProduct: string | null;
  selectProduct: (id: string | null) => void;
  selectVisit: (id: string | null) => void;
  openWarehouse: (v: boolean) => void;
  /** Rollout-Demo: Maschine, die gerade angebunden wird (Datenstrom-Effekt im 3D-Zwilling) */
  linking: string | null;
  setLinking: (id: string | null) => void;
  /** Reiter im rechten Panel des Leitstands (Zurück aus einer Detailansicht landet hier) */
  rightTab: "hinweise" | "hof" | "feed";
  setRightTab: (t: "hinweise" | "hof" | "feed") => void;
  /** Kameraansicht des 3D-Zwillings; n ändert sich bei jedem Klick (auch auf dieselbe Ansicht) */
  twinView: { key: string; n: number };
  /** Dächer der Hallen dauerhaft ausblenden */
  roofsOff: boolean;
  setTwinView: (key: string) => void;
  toggleRoofs: () => void;
  setSnap: (s: Snapshot) => void;
  setError: (e?: string) => void;
  openCopilot: (prompt?: string) => void;
  closeCopilot: () => void;
  toggleDirector: (v?: boolean) => void;
  setTheme: (t: "light" | "dark") => void;
  toggleSidebar: () => void;
  selectMachine: (id: string | null) => void;
}

export const useUi = create<UiState>((set) => ({
  snap: null,
  connected: false,
  copilotOpen: false,
  directorOpen: false,
  theme: "light",
  sidebarCollapsed: false,
  selectedMachine: null,
  selectedVisit: null,
  warehouseOpen: false,
  gateOpen: false,
  // LKW-Detail aus dem Pförtnerbuch: Pförtnerbuch bleibt offen und erscheint beim Zurückgehen wieder
  openGate: (gateOpen) => set(gateOpen ? { gateOpen, selectedMachine: null, selectedVisit: null, warehouseOpen: false, dockOpen: null, selectedProduct: null } : { gateOpen }),
  dockOpen: null,
  selectedProduct: null,
  selectProduct: (selectedProduct) => set(selectedProduct ? { selectedProduct, selectedVisit: null, selectedMachine: null } : { selectedProduct }),
  // LKW-Detail aus der Rampenliste: Rampe bleibt gemerkt und erscheint beim Zurückgehen wieder
  openDock: (dockOpen) => set(dockOpen ? { dockOpen, selectedMachine: null, selectedVisit: null, warehouseOpen: false, gateOpen: false, selectedProduct: null } : { dockOpen }),
  // die vorherige Ansicht (Lager, Artikel, Pförtnerbuch, Rampe) bleibt darunter – „Zurück“ führt dorthin
  selectVisit: (selectedVisit) => set(selectedVisit ? { selectedVisit, selectedMachine: null } : { selectedVisit }),
  openWarehouse: (warehouseOpen) => set(warehouseOpen ? { warehouseOpen, selectedMachine: null, selectedVisit: null, gateOpen: false, dockOpen: null } : { warehouseOpen, selectedProduct: null }),
  linking: null,
  setLinking: (linking) => set({ linking }),
  rightTab: "hinweise",
  setRightTab: (rightTab) => set({ rightTab }),
  twinView: { key: "gesamt", n: 0 },
  roofsOff: false,
  setTwinView: (key) => set({ twinView: { key, n: Date.now() }, selectedMachine: null }),
  toggleRoofs: () => set((s) => ({ roofsOff: !s.roofsOff })),
  setSnap: (snap) => set({ snap, connected: true, lastError: undefined }),
  setError: (lastError) => set({ connected: false, lastError }),
  openCopilot: (prompt) => set({ copilotOpen: true, copilotPrompt: prompt ? { text: prompt, nonce: Date.now() } : undefined }),
  closeCopilot: () => set({ copilotOpen: false }),
  toggleDirector: (v) => set((s) => ({ directorOpen: v ?? !s.directorOpen })),
  setTheme: (theme) => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", theme === "dark");
      try {
        localStorage.setItem("cortex-theme", theme);
      } catch {}
    }
    set({ theme });
  },
  toggleSidebar: () =>
    set((s) => {
      try {
        localStorage.setItem("cortex-sidebar", s.sidebarCollapsed ? "open" : "closed");
      } catch {}
      return { sidebarCollapsed: !s.sidebarCollapsed };
    }),
  selectMachine: (selectedMachine) => set(selectedMachine ? { selectedMachine, selectedVisit: null, warehouseOpen: false, gateOpen: false, dockOpen: null, selectedProduct: null } : { selectedMachine }),
}));

export async function control(action: string, extra: Record<string, unknown> = {}) {
  const res = await fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
  return res.json();
}

export async function ticketAction(action: string, extra: Record<string, unknown> = {}) {
  const res = await fetch("/api/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
  return res.json();
}

/** Snapshot sofort neu laden (z. B. nach einer Aktion) */
export async function refreshSnapshot() {
  try {
    const res = await fetch("/api/snapshot", { cache: "no-store" });
    if (res.ok) useUi.getState().setSnap(await res.json());
  } catch {}
}
