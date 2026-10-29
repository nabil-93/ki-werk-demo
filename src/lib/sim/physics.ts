// Physikalisches Ersatzmodell: latente Zustände (Lagerverschleiß, Heizung, Leckage) -> Sensorwerte.
// Wird sowohl von der Live-Simulation als auch zur Erzeugung der Trainingsdaten genutzt.

import { SENSOR_DEFS } from "./catalog";
import { Rng } from "./rng";
import type { MachineType, SensorValues } from "./types";

export function nominalBaseline(type: MachineType, rng: Rng, targetCycle?: number): SensorValues {
  const d = Object.fromEntries(SENSOR_DEFS[type].map((s) => [s.key, s.nominal])) as SensorValues;
  return {
    vib: d.vib * rng.range(0.9, 1.08),
    temp1: d.temp1 + rng.range(-2, 2),
    temp2: d.temp2 + rng.range(-1, 1),
    oil: d.oil + rng.range(-1.5, 1.5),
    pressure: d.pressure * rng.range(0.97, 1.03),
    cycle: targetCycle ?? d.cycle,
    power: d.power * rng.range(0.94, 1.06),
  };
}

export interface Latent {
  wear: number;
  heater: number;
  leak: number;
}

export function sensorValues(base: SensorValues, s: Latent, rng: Rng): SensorValues {
  const w = Math.max(0, s.wear);
  return {
    vib: Math.max(0.3, base.vib * (1 + 2.2 * Math.pow(w, 2.2)) + rng.gauss(0, 0.05 + 0.05 * w)),
    temp1: base.temp1 + 4 * s.heater + rng.gauss(0, 0.7),
    temp2: base.temp2 + 1.6 * s.heater + rng.gauss(0, 0.25),
    oil: base.oil + 9 * w * w + 6 * s.leak + rng.gauss(0, 0.3),
    pressure: base.pressure * (1 + rng.gauss(0, 0.006 * (1 + 2.5 * w))),
    cycle: base.cycle * (1 + 0.035 * w * w + 0.05 * s.heater) + rng.gauss(0, 0.008 * base.cycle),
    power: base.power * (1 + 0.07 * w + 0.08 * s.heater + 0.04 * s.leak) + rng.gauss(0, 0.7),
  };
}

/** Schwingungszonen nach ISO 10816-3 (Gruppe 2, starre Aufstellung) */
export const ISO_ZONES = { AB: 1.4, BC: 2.8, CD: 4.5 };

export function isoZone(vib: number): "A" | "B" | "C" | "D" {
  if (vib <= ISO_ZONES.AB) return "A";
  if (vib <= ISO_ZONES.BC) return "B";
  if (vib <= ISO_ZONES.CD) return "C";
  return "D";
}
