// Werkslayout des digitalen Zwillings – Weltkoordinaten in Metern (y = oben).
// Grundlage sind die echten Gebäudegrundrisse aus OpenStreetMap (site/siteData.ts), um 16,6° gedreht,
// damit die Hallen achsparallel liegen: x ≈ Ost, z ≈ Süd, Ursprung = Mitte des Werksgeländes.
// Die Nutzung der Hallen (Spritzguss, Thermoformen, Lager) ist für die Demo zugeordnet.

import type { V2 } from "./site/geo";

export interface MachineSpot {
  id: string;
  x: number;
  z: number;
  rot: number; // Rotation um y
}

/** Innenbereiche (für Böden, Gänge, Einbauten) */
export const HALL_A = { x0: -13.8, x1: 116.1, z0: 70.3, z1: 119.2 }; // Spritzguss (Südhalle)
export const HALL_B = { x0: 62.4, x1: 116.4, z0: -28.9, z1: 13 }; // Thermoformen (Nordteil Mittelhalle)
export const WAREHOUSE = { x0: 62.4, x1: 116.3, z0: 13, z1: 65.1 }; // Lager & Versand (Südteil Mittelhalle)
export const WALL_H = { hallA: 10.5, hallB: 11.5 };

/** Außenwände der Hallen (vereinfachte Grundrisse, Westfassade von Halle B mit Rampen begradigt) */
export const HALL_A_POLY: V2[] = [
  [116.4, 120.2], [42.3, 118.9], [-13.8, 121.1], [-14.8, 72.2], [-13.8, 71.9], [-14.6, 60.8], [-9.2, 60.4], [-8.8, 66.2],
  [34.3, 63.9], [34.7, 69.0], [41.8, 68.7], [41.8, 69.7], [116.1, 70.3],
];
/** Hochregallager am Ostende von Halle C (im Luftbild der hohe, dunkle Baukörper an der Einfahrt) */
export const HRL_POLY: V2[] = [
  [51.8, -89.6],
  [66.6, -89.9],
  [66.2, -58.2],
  [52.4, -58.0],
];

export const HALL_B_POLY: V2[] = [
  [65.8, 64.8], [65.8, 51.6], [62.4, 51.6], [62.4, -22.6], [65.7, -22.7], [65.8, -29.6], [116.6, -28.7], [116.3, 65.3],
];

export const MACHINE_SPOTS: MachineSpot[] = [
  { id: "SG-01", x: 54, z: 85, rot: 0 },
  { id: "SG-02", x: 68, z: 85, rot: 0 },
  { id: "SG-03", x: 82, z: 85, rot: 0 },
  { id: "SG-04", x: 96, z: 85, rot: 0 },
  { id: "SG-05", x: 54, z: 104, rot: Math.PI },
  { id: "SG-06", x: 68, z: 104, rot: Math.PI },
  { id: "SG-07", x: 82, z: 104, rot: Math.PI },
  { id: "SG-08", x: 96, z: 104, rot: Math.PI },
  { id: "TF-01", x: 80, z: -19, rot: 0 },
  { id: "TF-02", x: 102, z: -19, rot: 0 },
  { id: "TF-03", x: 80, z: 2, rot: 0 },
  { id: "TF-04", x: 102, z: 2, rot: 0 },
];

/** Weitere Maschinen der Halle, im Rollout noch nicht angebunden (Phase 2) – lassen sich in der Demo anbinden */
export const PHASE2_SPOTS: MachineSpot[] = [
  { id: "SG-09", x: 0, z: 85, rot: 0 },
  { id: "SG-10", x: 14, z: 85, rot: 0 },
  { id: "SG-11", x: 28, z: 85, rot: 0 },
  { id: "SG-12", x: 0, z: 104, rot: Math.PI },
  { id: "SG-13", x: 14, z: 104, rot: Math.PI },
  { id: "SG-14", x: 28, z: 104, rot: Math.PI },
];

export const SPOT = Object.fromEntries([...MACHINE_SPOTS, ...PHASE2_SPOTS].map((m) => [m.id, m])) as Record<string, MachineSpot>;

/** Förderband in Halle A (Mittelgang) zur KI-Kamera-Prüfstation */
export const CONVEYOR_A = { x0: 46, x1: 110, z: 94.5, y: 0.95 };
export const CAMERA_STATION = { x: 106, z: 94.5 };
/** Förderband Halle B */
export const CONVEYOR_B = { x0: 68, x1: 113, z: -8.5, y: 0.95 };

/** Granulatsilos an der Nordwestecke der Mittelhalle (wie im Luftbild) */
export const SILOS = [
  { id: "S1", label: "Silo 1 · PP-H", material: "M-PPH", x: 68, z: -34.5 },
  { id: "S2", label: "Silo 2 · PP-H", material: "M-PPH", x: 72, z: -34.5 },
  { id: "S3", label: "Silo 3 · PP-H", material: "M-PPH", x: 76, z: -34.5 },
  { id: "S4", label: "Silo 4 · PP-R", material: "M-PPR", x: 80, z: -34.5 },
  { id: "S5", label: "Silo 5 · PP-R", material: "M-PPR", x: 84, z: -34.5 },
  { id: "S6", label: "Silo 6 · PP-R", material: "M-PPR", x: 88, z: -34.5 },
];

/** Verladetore an der Westfassade der Mittelhalle (Tor öffnet nach Westen, −x) */
export const DOCKS = [
  { dock: 1, x: 62.4, z: 21.6 },
  { dock: 2, x: 62.4, z: 30.5 },
  { dock: 3, x: 62.4, z: 39.0 },
  { dock: 4, x: 62.4, z: 47.7 },
  { dock: 5, x: 65.8, z: 56.0 },
  { dock: 6, x: 65.8, z: 61.6 },
];

/** Werkstor mit Schranke an der Zufahrt vom Breiten Weg */
export const GATE = { x: 82.7, z: -90.5, booth: [77.4, -85.5] as V2, armLen: 7.4 };

/** Fahrerlose Transportfahrzeuge: Rundkurs um das Förderband in Halle A */
export const AGV_LOOP: V2[] = [
  [43, 90.4],
  [111.6, 90.4],
  [111.6, 98.6],
  [43, 98.6],
];

/** Türen/Tore (Mitte, Breite, Höhe) – Lücken in den Außenwänden */
export const DOORS: { x: number; z: number; w: number; h: number }[] = [
  { x: 90, z: 70.3, w: 4.5, h: 4.5 }, // Halle A → Verbindungsgang
  { x: 90, z: 65.1, w: 4.5, h: 4.5 }, // Verbindungsgang → Lager
  { x: 2, z: 65.6, w: 4.5, h: 4.5 }, // Halle A Nordtor (Stapler von der Zelthalle)
  { x: 52, z: 69.9, w: 5, h: 5 }, // Halle A Nordtor Ost
  { x: 62.4, z: -12, w: 5, h: 5 }, // Halle B Westtor (Folienrollen)
  ...DOCKS.map((d) => ({ x: d.x, z: d.z, w: 3.2, h: 3.4 })),
];

export const VIEWS: Record<string, { target: [number, number, number]; radius: number; phi: number; theta: number; label: string }> = {
  gesamt: { target: [44, 0, -2], radius: 440, phi: 0.86, theta: -0.62, label: "Gesamtwerk" },
  hallA: { target: [52, 0, 95], radius: 118, phi: 0.82, theta: -0.35, label: "Halle A · Spritzguss" },
  hallB: { target: [89, 0, -8], radius: 78, phi: 0.86, theta: -0.75, label: "Halle B · Thermoformen" },
  versand: { target: [62, 0, 36], radius: 92, phi: 0.9, theta: -1.05, label: "Lager & Versand" },
  tor: { target: [70, 0, -95], radius: 96, phi: 0.9, theta: -2.4, label: "Werkstor" },
};

/** Fokuspunkte der Hallen (Dächer öffnen sich, wenn die Kamera nah ist) */
export const HALL_FOCUS = {
  hallA: { x: 51, z: 95, r: 150 },
  hallB: { x: 89, z: 18, r: 135 },
};
