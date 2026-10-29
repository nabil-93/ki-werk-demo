// Predictive Maintenance: Merkmalsberechnung, Training (logistische Regression) und Erklärung.
// Bewusst ohne Bibliothek implementiert, damit jede Zahl nachvollziehbar ist.

import { ISO_ZONES, isoZone, nominalBaseline, sensorValues } from "./physics";
import { Rng, clamp, linSlope, mean, std } from "./rng";
import type { MachineType, Prediction, SensorSample, SensorValues } from "./types";

export const HIST_STEP_MIN = 5; // Rasterabstand der Historie
export const WINDOW = 24; // 24 × 5 min = 2 h Merkmalsfenster
export const HORIZON_H = 72;

export const FEATURES = [
  { key: "vib_ratio", label: "Schwingungspegel", unit: "× Basis" },
  { key: "vib_slope", label: "Schwingungstrend", unit: "mm/s pro h" },
  { key: "oil_dev", label: "Lager-/Öltemperatur über Normal", unit: "°C" },
  { key: "oil_slope", label: "Temperaturtrend", unit: "°C pro h" },
  { key: "press_cv", label: "Druckschwankung", unit: "%" },
  { key: "cycle_dev", label: "Zykluszeit-Abweichung", unit: "%" },
  { key: "power_dev", label: "Mehrverbrauch Energie", unit: "%" },
  { key: "hours_maint", label: "Betriebsstunden seit Wartung", unit: "h" },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export type FeatureVec = Record<FeatureKey, number>;

export function computeFeatures(window: SensorValues[], base: SensorValues, hoursSinceMaint: number): FeatureVec {
  const w = window.slice(-WINDOW);
  const recent = w.slice(-6);
  const dtH = HIST_STEP_MIN / 60;
  const vib = mean(recent.map((s) => s.vib));
  const press = w.map((s) => s.pressure);
  return {
    vib_ratio: vib / base.vib,
    vib_slope: linSlope(w.map((s) => s.vib), dtH),
    oil_dev: mean(recent.map((s) => s.oil)) - base.oil,
    oil_slope: linSlope(w.map((s) => s.oil), dtH),
    press_cv: (std(press) / Math.max(1e-6, mean(press))) * 100,
    cycle_dev: (mean(recent.map((s) => s.cycle)) / base.cycle - 1) * 100,
    power_dev: (mean(recent.map((s) => s.power)) / base.power - 1) * 100,
    hours_maint: hoursSinceMaint,
  };
}

// ---------- Trainingsdaten (simulierte Run-to-Failure-Historien) ----------

interface Sample {
  x: FeatureVec;
  y: 0 | 1;
}

function synthSample(rng: Rng): Sample {
  const type: MachineType = rng.chance(0.65) ? "SG" : "TF";
  const base = nominalBaseline(type, rng);
  const r = rng.next();
  let wear: number, rate: number;
  if (r < 0.5) {
    // gesunde Maschinen
    wear = rng.range(0.02, 0.6);
    rate = rng.range(0.0002, 0.0018);
  } else {
    // Degradation mit log-gleichverteilter Geschwindigkeit -> viele Grenzfälle um 72 h
    wear = rng.range(0.2, 0.97);
    rate = Math.exp(rng.range(Math.log(0.0015), Math.log(0.12)));
  }
  const heater = rng.chance(0.25) ? rng.range(0.1, 0.6) : rng.range(0, 0.1);
  const leak = rng.chance(0.2) ? rng.range(0.1, 0.5) : rng.range(0, 0.08);
  const dtH = HIST_STEP_MIN / 60;
  const win: SensorValues[] = [];
  for (let j = 0; j < WINDOW; j++) {
    const wj = Math.max(0, wear - rate * (WINDOW - 1 - j) * dtH);
    win.push(sensorValues(base, { wear: wj, heater, leak }, rng));
  }
  const hours = wear * rng.range(1800, 4200);
  const ttf = (1 - wear) / rate;
  // 3 % Label-Rauschen: Wartungsprotokolle sind in der Praxis nie perfekt
  const y = (ttf < HORIZON_H ? 1 : 0) ^ (rng.chance(0.03) ? 1 : 0);
  return { x: computeFeatures(win, base, hours), y: y as 0 | 1 };
}

// ---------- Logistische Regression ----------

export interface ModelCard {
  version: string;
  algorithm: string;
  trainedAt: string;
  nTrain: number;
  nTest: number;
  horizonH: number;
  threshold: number;
  metrics: { accuracy: number; precision: number; recall: number; f1: number; auc: number };
  confusion: { tp: number; fp: number; tn: number; fn: number };
  roc: { fpr: number; tpr: number }[];
  weights: { key: FeatureKey; label: string; weight: number; importance: number }[];
  bias: number;
}

export class PmModel {
  mu: number[] = [];
  sd: number[] = [];
  w: number[] = [];
  b = 0;
  card!: ModelCard;

  private vec(x: FeatureVec) {
    return FEATURES.map((f) => x[f.key]);
  }

  private z(x: FeatureVec) {
    return this.vec(x).map((v, i) => (v - this.mu[i]) / this.sd[i]);
  }

  logit(x: FeatureVec) {
    const z = this.z(x);
    return z.reduce((s, v, i) => s + v * this.w[i], this.b);
  }

  predict(x: FeatureVec) {
    return 1 / (1 + Math.exp(-this.logit(x)));
  }

  contributions(x: FeatureVec) {
    const z = this.z(x);
    return FEATURES.map((f, i) => ({ key: f.key, label: f.label, c: z[i] * this.w[i] }));
  }

  train(seed = 7, n = 5000) {
    const rng = new Rng(seed);
    const data: Sample[] = Array.from({ length: n }, () => synthSample(rng));
    const nTest = Math.floor(n * 0.25);
    const test = data.slice(0, nTest);
    const trainSet = data.slice(nTest);
    const X = trainSet.map((s) => this.vec(s.x));
    const d = FEATURES.length;
    this.mu = Array.from({ length: d }, (_, i) => mean(X.map((r) => r[i])));
    this.sd = Array.from({ length: d }, (_, i) => std(X.map((r) => r[i])) || 1);
    const Z = X.map((r) => r.map((v, i) => (v - this.mu[i]) / this.sd[i]));
    const Y = trainSet.map((s) => s.y);
    this.w = new Array(d).fill(0);
    this.b = 0;
    const lr = 0.4;
    const l2 = 0.01;
    for (let epoch = 0; epoch < 700; epoch++) {
      const gw = new Array(d).fill(0);
      let gb = 0;
      for (let k = 0; k < Z.length; k++) {
        const zk = Z[k];
        let s = this.b;
        for (let i = 0; i < d; i++) s += zk[i] * this.w[i];
        const p = 1 / (1 + Math.exp(-s));
        const e = p - Y[k];
        for (let i = 0; i < d; i++) gw[i] += e * zk[i];
        gb += e;
      }
      for (let i = 0; i < d; i++) this.w[i] -= lr * (gw[i] / Z.length + l2 * this.w[i]);
      this.b -= lr * (gb / Z.length);
    }

    // Evaluation auf Testdaten
    const threshold = 0.5;
    const scored = test.map((s) => ({ p: this.predict(s.x), y: s.y }));
    let tp = 0, fp = 0, tn = 0, fn = 0;
    for (const s of scored) {
      const yhat = s.p >= threshold ? 1 : 0;
      if (yhat === 1 && s.y === 1) tp++;
      else if (yhat === 1) fp++;
      else if (s.y === 0) tn++;
      else fn++;
    }
    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, tp + fn);
    const roc: { fpr: number; tpr: number }[] = [];
    const P = scored.filter((s) => s.y === 1).length;
    const N = scored.length - P;
    for (let t = 1; t >= -0.0001; t -= 0.05) {
      let a = 0, c = 0;
      for (const s of scored) {
        if (s.p >= t) {
          if (s.y === 1) a++;
          else c++;
        }
      }
      roc.push({ fpr: c / Math.max(1, N), tpr: a / Math.max(1, P) });
    }
    // AUC über Rangstatistik (Mann-Whitney)
    const sorted = [...scored].sort((x, y) => x.p - y.p);
    let rankSum = 0;
    sorted.forEach((s, i) => {
      if (s.y === 1) rankSum += i + 1;
    });
    const auc = (rankSum - (P * (P + 1)) / 2) / Math.max(1, P * N);
    const maxW = Math.max(...this.w.map(Math.abs));
    this.card = {
      version: "pm-lager-v1.3",
      algorithm: "Logistische Regression (L2-regularisiert) auf standardisierten Zeitreihen-Merkmalen",
      trainedAt: new Date().toISOString(),
      nTrain: trainSet.length,
      nTest,
      horizonH: HORIZON_H,
      threshold,
      metrics: {
        accuracy: (tp + tn) / scored.length,
        precision,
        recall,
        f1: (2 * precision * recall) / Math.max(1e-9, precision + recall),
        auc,
      },
      confusion: { tp, fp, tn, fn },
      roc,
      weights: FEATURES.map((f, i) => ({ key: f.key, label: f.label, weight: this.w[i], importance: Math.abs(this.w[i]) / maxW })).sort(
        (a, b) => b.importance - a.importance,
      ),
      bias: this.b,
    };
    return this;
  }
}

// ---------- Prognose für eine Maschine ----------

function fmt(n: number, d = 1) {
  return n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function predictMachine(
  model: PmModel,
  machineId: string,
  hist: SensorSample[],
  base: SensorValues,
  hoursSinceMaint: number,
  prev?: { pred: Prediction; elapsedH: number },
): Prediction {
  const win = hist.slice(-WINDOW);
  const x = computeFeatures(win, base, hoursSinceMaint);
  const raw = model.predict(x);
  // Glättung über die Zeit (exponentiell) – verhindert Springen der Anzeige
  const p = Math.min(0.99, prev ? 0.6 * prev.pred.p72 + 0.4 * raw : raw);
  const vibNow = mean(win.slice(-3).map((s) => s.vib));
  const longWin = hist.slice(-36);
  const slope = 0.5 * x.vib_slope + 0.5 * linSlope(longWin.map((s) => s.vib), HIST_STEP_MIN / 60);
  let rulH: number | null = null;
  if (vibNow >= ISO_ZONES.CD) rulH = 0;
  else if (slope > 0.02) rulH = (ISO_ZONES.CD - vibNow) / slope;
  if (rulH !== null && prev && prev.pred.rulH !== null && prev.pred.rulH > 0) {
    rulH = Math.max(0, 0.6 * Math.max(0, prev.pred.rulH - prev.elapsedH) + 0.4 * rulH);
  }
  if (rulH !== null && rulH > 720) rulH = null;

  const vibScore = clamp(1 - (vibNow - base.vib) / (ISO_ZONES.CD - base.vib), 0, 1);
  const health = Math.round(clamp(100 * (0.55 * (1 - p) + 0.45 * vibScore), 0, 100));

  const contrib = model
    .contributions(x)
    .filter((c) => c.c > 0.15)
    .sort((a, b) => b.c - a.c)
    .slice(0, 3);
  const valueOf = (k: FeatureKey) => {
    switch (k) {
      case "vib_ratio":
        return `${fmt(vibNow, 2)} mm/s (×${fmt(x.vib_ratio, 2)})`;
      case "vib_slope":
        return `${x.vib_slope >= 0 ? "+" : ""}${fmt(x.vib_slope, 2)} mm/s pro h`;
      case "oil_dev":
        return `${x.oil_dev >= 0 ? "+" : ""}${fmt(x.oil_dev, 1)} °C`;
      case "oil_slope":
        return `${x.oil_slope >= 0 ? "+" : ""}${fmt(x.oil_slope, 2)} °C pro h`;
      case "press_cv":
        return `σ ${fmt(x.press_cv, 2)} %`;
      case "cycle_dev":
        return `${x.cycle_dev >= 0 ? "+" : ""}${fmt(x.cycle_dev, 1)} %`;
      case "power_dev":
        return `${x.power_dev >= 0 ? "+" : ""}${fmt(x.power_dev, 1)} %`;
      case "hours_maint":
        return `${Math.round(x.hours_maint).toLocaleString("de-DE")} h`;
    }
  };
  return {
    machineId,
    p72: p,
    health,
    rulH,
    zone: isoZone(vibNow),
    drivers: contrib.map((c) => ({ label: c.label, value: valueOf(c.key), impact: c.c })),
    features: x,
  };
}
