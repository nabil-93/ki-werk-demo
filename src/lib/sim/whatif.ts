// Was-wäre-wenn mit dem digitalen Zwilling: Die KI kopiert den kompletten Werkszustand und rechnet 72 h in die Zukunft –
// einmal ohne Maßnahme, einmal mit der gewählten Maßnahme. Gleicher Ausgangszustand, gleicher Zufall: der Unterschied
// kommt allein von der Entscheidung. Bewertet wird mit derselben Kostenbasis wie überall (Stillstand × Kosten je Stunde,
// Reparatur- bzw. Wartungsteile, Ausschuss).

import { orderView } from "./analysis";
import { Plant } from "./engine";
import { analyzeMachine, draftFromGuard, type GuardTicketPayload } from "./guardian";
import { Ops, pieceEconomics } from "./ops";
import { Rng } from "./rng";
import { H } from "./time";
import type { MachineStatus } from "./types";

export const WHATIF_HORIZON_H = 72;
const STEP_SEC = 120;
const REPAIR_PARTS_EUR = 11_900; // Ersatzteile + Fremdleistung bei ungeplantem Ausfall (wie im Wartungsmodell)
const MAINT_PARTS_EUR = 2_400; // Teile + Personal bei geplanter Wartung

export interface WhatIfBranch {
  label: string;
  segments: { fromH: number; toH: number; status: MachineStatus }[];
  failures: { atH: number; reason: string }[];
  /** Stillstand durch das Ereignis selbst (Lagerschaden, QS-Sperre) */
  stoerH: number;
  wartH: number;
  /** zufällige Kurzstillstände – in beiden Varianten ähnlich, nicht Teil des Vergleichs */
  microH: number;
  good: number;
  scrap: number;
  costs: { stillstand: number; reparatur: number; wartung: number; ausschuss: number; massnahme: number };
  lossEur: number;
  order?: { id: string; due: number; projected: number; lateH: number };
  endRiskP72: number;
}

export interface WhatIfResult {
  machineId: string;
  finding?: string;
  action: string;
  startedAt: number;
  horizonH: number;
  ms: number;
  without: WhatIfBranch;
  with: WhatIfBranch;
}

/** vollständige, unabhängige Kopie des Werks (Modell wird geteilt – es ändert sich nicht) */
export function forkPlant(p: Plant): Plant {
  const model = p.model;
  const holder = p as unknown as { model: unknown };
  holder.model = null;
  let c: Plant;
  try {
    c = structuredClone(p);
  } finally {
    holder.model = model;
  }
  Object.setPrototypeOf(c, Plant.prototype);
  Object.setPrototypeOf(c.ops, Ops.prototype);
  Object.setPrototypeOf(c.rng, Rng.prototype);
  Object.setPrototypeOf(c.ops.rng, Rng.prototype);
  c.model = model;
  // die Kopie läuft nur über tick(), ohne Kopplung an die echte Uhr und ohne Wächter-Meldungen
  c.paused = true;
  c.quiet = true;
  return c;
}

/** Maßnahme in der Kopie anlegen und sofort freigeben (dieselben Wege wie über /api/tickets) */
function apply(c: Plant, t: GuardTicketPayload) {
  const k = draftFromGuard(c, { ...t, reason: t.reason || "Maßnahme (Was-wäre-wenn)" });
  if (k) c.decideTicket(k.id, true);
}

function run(c: Plant, machineId: string, label: string, headId: string | undefined, measureEur: number): WhatIfBranch {
  const m = c.findMachine(machineId)!;
  const e = pieceEconomics(m.productId);
  const steps = Math.round((WHATIF_HORIZON_H * 3600) / STEP_SEC);
  const segments: WhatIfBranch["segments"] = [{ fromH: 0, toH: WHATIF_HORIZON_H, status: m.status }];
  const failures: WhatIfBranch["failures"] = [];
  let stoerH = 0, wartH = 0, microH = 0, good = 0, scrap = 0, maint = 0;
  let lastGood = m.goodToday, lastScrap = m.scrapToday;
  let order: WhatIfBranch["order"];
  const check = () => {
    if (!headId || order) return;
    const o = c.order(headId);
    if (o && o.status !== "GEPLANT" && o.status !== "PRODUKTION") {
      const v = orderView(c, o);
      order = { id: o.id, due: o.due, projected: v.projectedDone, lateH: (v.projectedDone - o.due) / H };
    }
  };
  for (let i = 0; i < steps; i++) {
    const before = m.status;
    c.tick(STEP_SEC);
    const h = ((i + 1) * STEP_SEC) / 3600;
    // Tageszähler werden um 06:00 zurückgesetzt
    const dg = m.goodToday - lastGood;
    const ds = m.scrapToday - lastScrap;
    good += dg >= 0 ? dg : m.goodToday;
    scrap += ds >= 0 ? ds : m.scrapToday;
    lastGood = m.goodToday;
    lastScrap = m.scrapToday;
    // nur ereignisbedingte Stillstände vergleichen; zufällige Kurzstopps getrennt ausweisen
    if (m.status === "STOERUNG") {
      if (/Lagerschaden|Notabschaltung|QS-Sperre/.test(m.statusReason ?? "")) stoerH += STEP_SEC / 3600;
      else microH += STEP_SEC / 3600;
    }
    if (m.status === "WARTUNG") wartH += STEP_SEC / 3600;
    if (m.status !== before) {
      const cur = segments[segments.length - 1];
      cur.toH = h;
      segments.push({ fromH: h, toH: WHATIF_HORIZON_H, status: m.status });
      if (m.status === "STOERUNG" && /Lagerschaden/.test(m.statusReason ?? "")) failures.push({ atH: h, reason: m.statusReason ?? "Störung" });
      if (m.status === "WARTUNG") maint++;
    }
    check();
  }
  if (headId && !order) {
    const o = c.order(headId);
    if (o) {
      const v = orderView(c, o);
      order = { id: o.id, due: o.due, projected: v.projectedDone, lateH: (v.projectedDone - o.due) / H };
    }
  }
  const costs = {
    stillstand: Math.round((stoerH + wartH) * m.costPerHour),
    reparatur: failures.length * REPAIR_PARTS_EUR,
    wartung: maint * MAINT_PARTS_EUR,
    ausschuss: Math.round(scrap * e.price),
    massnahme: Math.round(measureEur),
  };
  return {
    label,
    segments: segments.filter((s) => s.toH - s.fromH > 0.01),
    failures,
    stoerH,
    wartH,
    microH,
    good: Math.round(good),
    scrap: Math.round(scrap),
    costs,
    lossEur: Object.values(costs).reduce((a, b) => a + b, 0),
    order,
    endRiskP72: c.predictions.get(m.id)?.p72 ?? 0,
  };
}

/** Zukunft zweimal durchrechnen: ohne Maßnahme vs. mit der gewählten (Standard: empfohlenen) Maßnahme */
export function whatIf(plant: Plant, machineId: string, findingId?: string, actionId?: string): WhatIfResult | null {
  const t0 = Date.now();
  plant.sync();
  const m = plant.findMachine(machineId);
  if (!m) return null;
  const g = analyzeMachine(plant, m);
  const f = g.findings.find((x) => x.id === findingId) ?? g.findings[0];
  const a = f?.actions.find((x) => x.id === actionId && x.ticket) ?? f?.actions.find((x) => x.recommended && x.ticket) ?? f?.actions.find((x) => x.ticket);
  const headId = m.queue[0];
  const without = forkPlant(plant);
  const withAction = forkPlant(plant);
  if (a?.ticket) apply(withAction, a.ticket);
  // Wartungs- und Teilekosten der Maßnahme stecken bereits im Stillstand bzw. in den Wartungsteilen
  const measureEur = a?.ticket && a.ticket.action !== "create-maintenance" && a.ticket.action !== "qs-block" ? a.costEur : 0;
  return {
    machineId: m.id,
    finding: f?.title,
    action: a?.label ?? "keine Maßnahme",
    startedAt: plant.now,
    horizonH: WHATIF_HORIZON_H,
    without: run(without, m.id, "Ohne Maßnahme", headId, 0),
    with: run(withAction, m.id, a?.label ?? "Mit Maßnahme", headId, measureEur),
    ms: Date.now() - t0,
  };
}
