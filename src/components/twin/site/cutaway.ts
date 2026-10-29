// Gemeinsamer Zustand der 3D-Szene, der jedes Bild aktualisiert wird (ohne React-Renders)

/** 0 = Halle geschlossen (Dach sichtbar), 1 = aufgeschnitten (Dach weg, Wände niedrig) */
export const cut = { hallA: 0, hallB: 0 };

/** Schranke am Werkstor: open 0…1 (aktueller Winkel), wird vom Verkehr gesteuert */
export const barrier = { open: 0, demand: 0 };

/**
 * Ampel an der Werkseinfahrt (Zufahrtsstraße): LKW, die ein- oder ausfahren, fordern Rot an.
 * Phasen wie in Deutschland: Grün → Gelb → Rot → Rot-Gelb → Grün
 */
export type SignalPhase = "green" | "amber" | "red" | "redamber";
export const signal = { demand: 0, phase: "green" as SignalPhase, since: -100 };

/** Belegte Tore (Tornummer → Zeitpunkt der Ankunft), vom Verkehr gepflegt */
export const dockBusy = new Set<number>();

/** Schattenkarte nur bei Bedarf neu zeichnen (teuer auf integrierter Grafik) */
export const shadowState = { pending: true };
export function requestShadows() {
  shadowState.pending = true;
}
