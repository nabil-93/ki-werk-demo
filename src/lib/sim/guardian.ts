// KI-Wächter: analysiert alle angebundenen Maschinen laufend (alle 5 Sim-Minuten in der Engine und bei jeder Abfrage).
// Prinzip Frühwarnung: Trends statt Grenzwerte – die KI meldet sich, wenn sich ein Signal stetig verschlechtert,
// lange bevor ein klassischer Alarm anschlägt. Zu jedem Befund: was sie in den Daten sieht, die wahrscheinliche
// Ursache, Wahrscheinlichkeit und Zeithorizont, der drohende Verlust in Euro und Maßnahmen mit Alternativen
// (Kosten, vermiedener Verlust, Netto). Umgesetzt wird nur nach Freigabe durch einen Menschen.

import { DEFECTS, ENERGY_EUR_PER_KWH, PHASE2_SEEDS, PRODUCT, SENSOR_DEFS } from "./catalog";
import { alternativeMachines, maintenanceOptions, orderView } from "./analysis";
import type { Plant } from "./engine";
import { pieceEconomics, targetRate } from "./ops";
import { ISO_ZONES } from "./physics";
import { clamp, mean } from "./rng";
import { H, MIN, nextShiftChange } from "./time";
import type { DefectType, Machine, MachineStatus, MeasureEffect, Ticket } from "./types";
import { fmtDateTime, fmtDuration, fmtEur, fmtInt, fmtNum, fmtPct, fmtTime } from "../ai/format";

export type GuardKind = "ausfall" | "qualitaet" | "leistung" | "kurzstopps" | "energie" | "termin";
type Sev = "crit" | "warn" | "info";

export const GUARD_KIND: Record<GuardKind, { label: string; short: string }> = {
  ausfall: { label: "Mechanik · Ausfallrisiko", short: "Mechanik" },
  qualitaet: { label: "Prozess · Qualität", short: "Qualität" },
  leistung: { label: "Leistung · Zykluszeit", short: "Leistung" },
  kurzstopps: { label: "Verfügbarkeit · Kurzstillstände", short: "Kurzstopps" },
  energie: { label: "Energie", short: "Energie" },
  termin: { label: "Liefertermin", short: "Termin" },
};

export interface GuardTicketPayload {
  action: "create-maintenance" | "create-move" | "create-measure" | "qs-block";
  machineId: string;
  startInH?: number;
  orderId?: string;
  targetMachineId?: string;
  effect?: MeasureEffect;
  reason: string;
  costEur: number;
  savingEur: number;
  source: string;
}

export interface GuardAction {
  id: string;
  label: string;
  detail: string;
  when: string;
  costEur: number;
  avoidedEur: number;
  netEur: number;
  recommended?: boolean;
  /** Vergleichszeile „nichts tun“ */
  baseline?: boolean;
  /** Stunden bis zur Umsetzung (für die Prognosekurve) */
  startH: number;
  ticket?: GuardTicketPayload;
}

export interface GuardFinding {
  id: string;
  machineId: string;
  kind: GuardKind;
  sev: Sev;
  /** Frühwarnung: Trend erkannt, Grenzwert noch nicht erreicht */
  early: boolean;
  title: string;
  /** was die KI in den Daten sieht */
  signal: string;
  evidence: { label: string; value: string; up?: boolean }[];
  cause: string;
  confidence: number;
  probability: number;
  horizon: string;
  lossEur72: number;
  since: number;
  actions: GuardAction[];
  openTicket?: { id: string; status: Ticket["status"] };
  /** Zeitfenster im Frühwarn-Radar (Stunden ab jetzt) */
  window?: { fromH: number; toH: number; label: string };
}

export type DimState = "ok" | "info" | "warn" | "crit";

export interface GuardCheck {
  key: string;
  label: string;
  value: string;
  state: "ok" | "warn" | "crit";
}

export interface MachineGuard {
  id: string;
  type: Machine["type"];
  hall: Machine["hall"];
  maker: string;
  model: string;
  status: MachineStatus;
  product: string;
  health: number;
  scores: { mechanik: number; prozess: number; leistung: number; energie: number };
  findings: GuardFinding[];
  checks: GuardCheck[];
  lossEur72: number;
  lossWithActionsEur72: number;
  curve: { h: number; ohne: number; mit: number }[];
  connectedAt?: number;
  /** Gesundheitsmatrix: Zustand je Bereich */
  dims: Record<GuardKind, DimState>;
}

export interface GuardianView {
  now: number;
  intervalMin: number;
  machines: MachineGuard[];
  blind: { id: string; maker: string; model: string; product: string }[];
  totals: { monitored: number; signals: number; analysesToday: number; findings: number; crit: number; early: number; lossEur72: number; lossWithActionsEur72: number; avoidedTodayEur: number };
  avoided: { t: number; machineId?: string; eur: number; text: string }[];
  /** Bilanz der Prognosen (Ausfall, Qualität) der letzten 30 Tage – wie oft lag der Wächter richtig? */
  trust: { days: number; warnings: number; confirmed: number; falseAlarms: number; open: number; hitRate: number; avgLeadH: number };
  /** Schichtwechsel in den nächsten 72 h (Stunden ab jetzt) – Orientierung im Frühwarn-Radar */
  shiftMarksH: number[];
}

const fmtH = (h: number) => (h < 1 ? "unter 1 h" : h < 48 ? `ca. ${Math.round(h)} h` : `ca. ${Math.round(h / 24)} Tagen`);
const sign = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${fmtNum(v, d)}`;
/** Maßnahme wurde in den letzten 12 h umgesetzt → Befund dieser Art wird beobachtet statt erneut gemeldet */
const fixedRecently = (plant: Plant, id: string, effect: MeasureEffect) => plant.now - (plant.measureAt.get(`${id}:${effect}`) ?? -Infinity) < 12 * H;

/** Maßnahme des Wächters als Entwurf anlegen – derselbe Weg wie über /api/tickets (Freigabe durch einen Menschen) */
export function draftFromGuard(plant: Plant, t: GuardTicketPayload, createdBy: Ticket["createdBy"] = "KI-Wächter"): Ticket | undefined {
  const m = plant.findMachine(t.machineId);
  if (!m) return undefined;
  const base = { machineId: m.id, reason: t.reason || `Maßnahme an ${m.id}`, createdBy, costEur: t.costEur, savingEur: t.savingEur, source: t.source || undefined };
  switch (t.action) {
    case "create-maintenance":
      return plant.createTicket({ ...base, kind: "wartung", start: plant.now + Math.max(0, t.startInH ?? 0.5) * H, durationH: maintenanceOptions(plant, m).planned.durationH });
    case "create-measure":
      return plant.createTicket({ ...base, kind: "massnahme", start: plant.now + Math.max(0, t.startInH ?? 0.5) * H, durationH: 0.5, effect: t.effect ?? "keine" });
    case "create-move":
      return t.orderId && t.targetMachineId ? plant.createTicket({ ...base, kind: "umplanung", orderId: t.orderId, targetMachineId: t.targetMachineId, start: plant.now, durationH: 0 }) : undefined;
    case "qs-block":
      return plant.createTicket({ ...base, kind: "qs-sperre", start: plant.now, durationH: 0.75 });
  }
}

function act(a: Omit<GuardAction, "netEur">): GuardAction {
  const avoidedEur = Math.max(0, Math.round(a.avoidedEur));
  const costEur = Math.round(a.costEur);
  return { ...a, avoidedEur, costEur, netEur: avoidedEur - costEur, ticket: a.ticket && { ...a.ticket, costEur, savingEur: avoidedEur } };
}

const nothing = (loss: number): GuardAction => ({
  id: "nichts",
  label: "Nichts tun (Vergleich)",
  detail: `Weiterlaufen wie bisher – erwarteter Verlust ${fmtEur(loss)} in 72 h.`,
  when: "–",
  costEur: 0,
  avoidedEur: 0,
  netEur: 0,
  baseline: true,
  startH: 0,
});

/** Ursache aus dem stärksten Treiber des Wartungsmodells ableiten */
function mechanicalCause(m: Machine, driver?: string) {
  const d = (driver ?? "").toLowerCase();
  if (d.includes("schwingung")) return m.type === "SG" ? "Verschleiß am Spindellager des Antriebs – typisches Muster: Schwingung steigt stetig, die Lagertemperatur zieht nach" : "Verschleiß am Lager des Stanzantriebs – Schwingung steigt stetig";
  if (d.includes("temperatur")) return "Schmierung bzw. Hydraulikkühlung lässt nach – die Lager-/Öltemperatur steigt";
  if (d.includes("druck")) return "Rückstromsperre oder Dosierung verschleißt – der Einspritzdruck schwankt stärker";
  if (d.includes("zyklus")) return "Antrieb/Hydraulik verliert Leistung – der Zyklus wird länger";
  return "Allgemeiner Zustandsverlust seit der letzten Wartung";
}

const DEFECT_CAUSE: Record<DefectType, string> = {
  etikettenversatz: "Das IML-Etikett wird zunehmend versetzt eingelegt – Greifer-Vakuum oder Roboterposition driftet",
  kurzschuss: "Unvollständig gefüllte Teile – Dosierung/Rückstromsperre oder zu niedrige Massetemperatur",
  grat: "Grat an der Trennebene – Schließkraft zu gering oder Werkzeug verschlissen",
  schwarzpunkt: "Verunreinigungen – verschmutztes Granulat oder Zersetzung an der Schnecke",
  riss: "Risse beim Entformen – Werkzeugtemperatur zu niedrig oder Entformung zu schnell",
  verformung: "Verzug – Kühlzeit zu kurz oder Temperierung ungleichmäßig",
};

/** Ursache und passende Abhilfe für einen wiederholt verlängerten Zyklus (aus dem BDE-Hinweis) */
function cycleFix(m: Machine, reason: string) {
  const r = reason.toLowerCase();
  if (r.includes("feucht")) return { cause: "Granulat ist zu feucht – der Trockner erreicht den Taupunkt nicht", action: "Granulattrockner: Taupunkt und Trocknungszeit prüfen" };
  if (r.includes("greifer")) return { cause: "Der Entnahmegreifer fährt zu langsam – Vakuum oder Bewegungsprofil", action: "Entnahmeroboter: Vakuum und Bewegungsprofil optimieren" };
  if (r.includes("temperier")) return { cause: "Die Werkzeugtemperierung schwankt – die Kühlzeit muss verlängert werden", action: "Temperiergerät entkalken, Durchfluss prüfen" };
  if (r.includes("etikett")) return { cause: "Der IML-Einleger wird häufig nachjustiert – Etikettenposition ist nicht stabil", action: "IML-Einleger: Position und Taktung neu einrichten" };
  if (r.includes("spannung")) return { cause: "Die Folienspannung schwankt – der Einzug wird gebremst", action: "Bahnspannung der Folie neu einstellen" };
  if (r.includes("heizfeld")) return { cause: "Das Heizfeld regelt nach – Thermoelemente liefern ungenaue Werte", action: "Heizfeld kalibrieren, Thermoelemente prüfen" };
  if (r.includes("stapel")) return { cause: "Die Stapelstation bremst den Takt", action: "Stapelstation: Sensor und Antrieb prüfen" };
  if (r.includes("rolle")) return { cause: "Rollenwechsel kündigt sich an – der Einzug läuft verlangsamt", action: "Rollenwechsel vorziehen bzw. fliegenden Wechsel nutzen" };
  return m.type === "SG" ? { cause: "Granulat zu feucht oder Werkzeugtemperierung zu kalt", action: "Granulattrockner (Taupunkt) und Temperiergerät prüfen" } : { cause: "Folienvorwärmung bzw. Heizfeld zu schwach", action: "Heizfeld kalibrieren, Folienvorwärmung prüfen" };
}

function microFix(reason: string) {
  const r = reason.toLowerCase();
  if (r.includes("roboter") || r.includes("gegriffen")) return "Greifer reinigen, Sauger tauschen und Teile-Sensor justieren";
  if (r.includes("material")) return "Fördergerät und Saugleitung reinigen, Filter tauschen";
  if (r.includes("etikettenmagazin")) return "Etikettenmagazin vergrößern bzw. Nachfüll-Intervall im Schichtplan festlegen";
  if (r.includes("temperier")) return "Temperiergerät entkalken, Wasserdurchfluss prüfen";
  if (r.includes("folienriss")) return "Bahnspannung einstellen und Folienqualität der Charge prüfen";
  if (r.includes("stapler")) return "Stapler-Sensor reinigen und Überlauf-Grenze anpassen";
  if (r.includes("heizfeld")) return "Thermoelement im Heizfeld tauschen";
  if (r.includes("stanz")) return "Stanzwerkzeug schärfen und Schneidspalt prüfen";
  return "Ursache vor Ort prüfen und abstellen";
}

export function analyzeMachine(plant: Plant, m: Machine): MachineGuard {
  const now = plant.now;
  const ops = plant.ops;
  const pred = plant.predictions.get(m.id);
  const f = pred?.features ?? {};
  const p = PRODUCT[m.productId];
  const e = pieceEconomics(m.productId);
  const nominalRate = targetRate(m) * 3600;
  const running = m.status === "PRODUKTION";
  const findings: GuardFinding[] = [];
  const checks: GuardCheck[] = [];
  const liveRun = m.live.slice(-30).filter((s) => s.cycle > 0);
  const add = (x: Omit<GuardFinding, "id" | "machineId" | "since" | "openTicket">) => {
    const id = `${x.kind}-${m.id}`;
    const acts = x.actions.map((a) => (a.ticket ? { ...a, ticket: { ...a.ticket, source: id } } : a));
    const best = acts.filter((a) => !a.baseline).sort((a, b) => b.netEur - a.netEur)[0];
    if (best) best.recommended = true;
    const t = plant.tickets.find((k) => k.source === id && (k.status === "ENTWURF" || k.status === "FREIGEGEBEN" || k.status === "IN_ARBEIT"));
    findings.push({ ...x, actions: acts, id, machineId: m.id, since: plant.guardSeen.get(id) ?? now, openTicket: t && { id: t.id, status: t.status } });
  };
  const head = m.queue[0] ? plant.order(m.queue[0]) : undefined;

  // ---------- 1 · Mechanik: Ausfallrisiko und Frühwarnung über den Schwingungstrend
  const vib = running && liveRun.length ? mean(liveRun.map((s) => s.vib)) : (m.hist[m.hist.length - 1]?.vib ?? m.baseline.vib);
  const slope = f.vib_slope ?? 0;
  const oilDev = f.oil_dev ?? 0;
  const p72 = pred?.p72 ?? 0;
  const rul = pred?.rulH ?? null;
  const toWarnH = slope > 0.01 && vib < ISO_ZONES.BC ? (ISO_ZONES.BC - vib) / slope : null;
  checks.push({ key: "vib", label: "Schwingung", value: `${fmtNum(vib, 2)} mm/s · Zone ${pred?.zone ?? "–"}${slope > 0.02 ? ` · steigt ${fmtNum(slope, 2)}/h` : ""}`, state: pred?.zone === "D" || p72 >= 0.7 ? "crit" : pred?.zone === "C" || p72 >= 0.4 || slope > 0.05 ? "warn" : "ok" });
  checks.push({ key: "oil", label: m.type === "SG" ? "Lager-/Öltemperatur" : "Getriebeöl", value: `${sign(oilDev)} °C ggü. Normal`, state: oilDev > 6 ? "crit" : oilDev > 3 ? "warn" : "ok" });
  checks.push({ key: "press", label: "Druckschwankung", value: `σ ${fmtNum(f.press_cv ?? 0, 2)} %`, state: (f.press_cv ?? 0) > 1.6 ? "warn" : "ok" });
  const earlyMech = slope > 0.035 && vib > m.baseline.vib * 1.08 && p72 < 0.4;
  if (running && (p72 >= 0.25 || earlyMech || oilDev > 3.5)) {
    const mo = maintenanceOptions(plant, m);
    const unplanned = mo.unplanned.costEur;
    const prob = Math.max(p72, earlyMech ? 0.18 : 0.12);
    const loss = prob * unplanned;
    const driver = pred?.drivers[0]?.label;
    const actions: GuardAction[] = mo.options.map((o, i) =>
      act({
        id: `wartung-${i}`,
        label: `Wartung ${o.label.charAt(0).toLowerCase()}${o.label.slice(1)}`,
        detail: `${o.note} Lager tauschen, Schmierung und Ausrichtung prüfen (${fmtDuration(mo.planned.durationH)}).`,
        when: fmtDateTime(o.start),
        // dieselbe Kostenbasis wie überall (geplante Wartung ≈ 1,5 h Stillstand + Teile); nach dem Auftrag mit dem Rüsten kombiniert
        costEur: o.label.startsWith("Nach") ? mo.planned.costEur * 0.75 : mo.planned.costEur,
        avoidedEur: (prob - o.riskBefore) * unplanned,
        startH: (o.start - now) / H,
        ticket: { action: "create-maintenance", machineId: m.id, startInH: (o.start - now) / H, reason: `Vorausschauende Wartung (KI-Wächter): ${driver ?? "Zustand"} – Lager tauschen, Schmierung prüfen`, costEur: 0, savingEur: 0, source: "" },
      }),
    );
    if (head) {
      const alt = alternativeMachines(plant, head).find((a) => a.status !== "STOERUNG" && a.risk < 0.45);
      if (alt)
        actions.push(
          act({
            id: "umplanen",
            label: `Auftrag ${head.id} auf ${alt.machineId} verlagern`,
            detail: `Liefertermin absichern – ${m.id} kann danach ohne Zeitdruck gewartet werden${alt.changeover ? " (auf " + alt.machineId + " ist ein Werkzeugwechsel nötig)" : ""}. Frei ab ${fmtTime(alt.freeAt)}.`,
            when: `ab ${fmtTime(alt.freeAt)}`,
            costEur: alt.changeover ? 650 : 180,
            avoidedEur: prob * (0.06 * head.valueEur + 900) + prob * unplanned * 0.2,
            startH: Math.max(0, (alt.freeAt - now) / H),
            ticket: { action: "create-move", machineId: m.id, orderId: head.id, targetMachineId: alt.machineId, reason: `Umplanung ${head.id} → ${alt.machineId} (KI-Wächter: Ausfallrisiko ${m.id})`, costEur: 0, savingEur: 0, source: "" },
          }),
        );
    }
    actions.push(
      act({
        id: "ersatzteil",
        label: "Ersatzteil-Set vorsorglich bereitlegen",
        detail: "Spindellager und Dichtungen per Express bestellen – ein Ausfall dauert dann ca. 2 h statt 5 h.",
        when: "sofort (Lieferung morgen)",
        costEur: 420,
        avoidedEur: prob * unplanned * 0.45,
        startH: 0,
        ticket: { action: "create-measure", machineId: m.id, startInH: 0.25, effect: "ersatzteil", reason: `Ersatzteil-Set Spindellager für ${m.id} bereitlegen (KI-Wächter)`, costEur: 0, savingEur: 0, source: "" },
      }),
      nothing(loss),
    );
    add({
      kind: "ausfall",
      sev: p72 >= 0.7 ? "crit" : p72 >= 0.4 ? "warn" : "info",
      early: earlyMech,
      title: p72 >= 0.7 ? "Ausfall droht – Lagerschaden wahrscheinlich" : earlyMech ? "Frühwarnung: Verschleiß beginnt" : "Erhöhtes Ausfallrisiko",
      signal: earlyMech
        ? `Die Schwingung liegt noch im Normalbereich, steigt aber seit Stunden stetig um ${fmtNum(slope, 2)} mm/s pro Stunde. Ein klassischer Grenzwert-Alarm käme erst${toWarnH ? ` in ${fmtH(toWarnH)}` : " viel später"}.`
        : `Das Wartungsmodell erkennt das Muster früherer Lagerschäden: ${(pred?.drivers ?? []).slice(0, 2).map((d) => `${d.label} ${d.value}`).join(" · ") || "Zustand verschlechtert sich"}.`,
      evidence: [
        { label: "Schwingung", value: `${fmtNum(vib, 2)} mm/s (×${fmtNum(vib / m.baseline.vib, 2)} ggü. Basis)`, up: slope > 0.02 },
        { label: "Trend", value: `${sign(slope, 2)} mm/s pro h`, up: slope > 0.02 },
        { label: "Lager-/Öltemperatur", value: `${sign(oilDev)} °C`, up: oilDev > 1.5 },
        { label: "Ausfallrisiko 72 h", value: fmtPct(p72, 0) },
        { label: "seit Wartung", value: fmtDuration(f.hours_maint ?? (now - m.lastMaintenance) / H) },
      ],
      cause: mechanicalCause(m, driver),
      confidence: clamp(0.55 + 0.4 * p72 + (earlyMech ? 0.06 : 0), 0.5, 0.96),
      probability: prob,
      horizon: rul !== null && rul > 0 ? `Schadensgrenze voraussichtlich in ${fmtH(rul)}` : rul === 0 ? "Schadensgrenze erreicht" : toWarnH ? `Warngrenze 2,8 mm/s in ${fmtH(toWarnH)}` : `Risiko ${fmtPct(p72, 0)} in den nächsten 72 h`,
      lossEur72: loss,
      actions,
    });
  }

  // ---------- 2 · Prozess & Qualität: schleichende Drift (EWMA) vor dem Ausschuss
  const spec = p.spc;
  const sd = spec.tol / 4.6 / Math.sqrt(1.5);
  const ew = plant.ewma.get(m.id) ?? spec.nominal;
  const ewZ = Math.abs(ew - spec.nominal) / (sd * Math.sqrt(0.2 / 1.8));
  const scrapRate = m.goodToday + m.scrapToday > 0 ? m.scrapToday / (m.goodToday + m.scrapToday) : 0;
  const top = (Object.entries(m.defects) as [DefectType, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "grat";
  const qualityFixed = fixedRecently(plant, m.id, "qualitaet");
  checks.push({ key: "spc", label: "Ausschuss & SPC", value: `${fmtPct(scrapRate, 2)} · Drift ${fmtNum(ewZ, 1)} σ`, state: scrapRate > 0.015 || ewZ > 3.2 ? "crit" : scrapRate > 0.01 || ewZ > 2 ? "warn" : "ok" });
  if (running && (ewZ > 2 || (!qualityFixed && scrapRate > 0.011))) {
    const earlyQ = ewZ > 2 && scrapRate < 0.011;
    const prob = ewZ > 3.2 ? 0.85 : earlyQ ? clamp(0.45 + (ewZ - 2) * 0.25, 0.45, 0.8) : 0.7;
    const rate = plant.ratePerHour(m);
    const projected = Math.max(0.004, scrapRate - 0.006 + (ewZ > 2 ? 0.008 : 0));
    const claim = (p.iml ? 1800 : 1200) * (ewZ > 3.2 ? 0.35 : 0.15);
    const loss = prob * (projected * rate * 72 * e.price + claim);
    const recent = m.spc.slice(-6).map((s) => s.value);
    const cause = p.iml && spec.label.startsWith("Etikett") && ew > spec.nominal ? DEFECT_CAUSE.etikettenversatz : m.type === "TF" ? `${spec.label} driftet – Heizfeld oder Folienvorwärmung arbeiten ungleichmäßig` : DEFECT_CAUSE[top];
    add({
      kind: "qualitaet",
      sev: scrapRate > 0.02 || (ewZ > 3.2 && scrapRate > 0.012) ? "crit" : ewZ > 3.2 || scrapRate > 0.013 ? "warn" : "info",
      early: earlyQ,
      title: earlyQ ? "Frühwarnung: Prozess driftet – Ausschuss droht" : "Ausschuss erhöht",
      signal: earlyQ
        ? `Der Mittelwert „${spec.label}“ verschiebt sich langsam (EWMA ${fmtNum(ewZ, 1)} σ). Noch sind alle Teile in der Toleranz – bleibt der Trend, entsteht in einigen Stunden Ausschuss.`
        : `Ausschuss ${fmtPct(scrapRate, 2)} heute (üblich ≈ 0,6 %) – vor allem ${DEFECTS[top].label.split(" /")[0]}.`,
      evidence: [
        { label: spec.label, value: `Ø ${fmtNum(recent.length ? mean(recent) : spec.nominal, 2)} ${spec.unit} (Soll ${fmtNum(spec.nominal, 2)} ± ${fmtNum(spec.tol, 2)})`, up: ewZ > 2 },
        { label: "EWMA-Abstand", value: `${fmtNum(ewZ, 1)} σ (Grenze 3,2)`, up: ewZ > 2 },
        { label: "Ausschuss heute", value: fmtPct(scrapRate, 2), up: scrapRate > 0.01 },
        { label: "häufigster Fehler", value: DEFECTS[top].label.split(" /")[0] },
      ],
      cause,
      confidence: clamp(0.6 + Math.min(ewZ, 4) * 0.08, 0.6, 0.94),
      probability: prob,
      horizon: earlyQ ? "Ausschuss voraussichtlich in wenigen Stunden" : "Ausschuss entsteht bereits",
      lossEur72: loss,
      actions: [
        act({
          id: "nachjustieren",
          label: p.iml ? "Greifer-Vakuum prüfen, Etikettenposition nachteachen" : m.type === "TF" ? "Heizfeld kalibrieren, Folienvorwärmung prüfen" : "Prozessparameter prüfen (Masse-, Werkzeugtemperatur, Nachdruck)",
          detail: "Kurzer Eingriff durch den Einrichter, danach SPC-Karte zurücksetzen und 3 Stichproben prüfen.",
          when: "in 30 min (ca. 15 min Stopp)",
          costEur: 180 + 0.25 * rate * e.db,
          avoidedEur: loss * 0.85,
          startH: 0.5,
          ticket: { action: "create-measure", machineId: m.id, startInH: 0.5, effect: "qualitaet", reason: `${m.id}: ${p.iml ? "Greifer-Vakuum prüfen, Etikettenposition nachteachen" : "Prozessparameter korrigieren"} (KI-Wächter: ${spec.label} driftet)`, costEur: 0, savingEur: 0, source: "" },
        }),
        act({
          id: "qs-sperre",
          label: "Los seit Driftbeginn sperren + 100-%-Kamerasortierung",
          detail: "Verhindert, dass auffällige Teile zum Kunden gehen (Reklamationsrisiko) – behebt aber nicht die Ursache.",
          when: "sofort",
          costEur: 350,
          avoidedEur: Math.min(loss, claim * 2 + projected * rate * 6 * e.price),
          startH: 0,
          ticket: { action: "qs-block", machineId: m.id, reason: "", costEur: 0, savingEur: 0, source: "" },
        }),
        nothing(loss),
      ],
    });
  }

  // ---------- 3 · Leistung: Zyklus länger als geplant (fällt in keinem Alarm auf)
  const perf = plant.performance(m);
  const cycleNow = liveRun.length ? mean(liveRun.map((s) => s.cycle)) : m.targetCycle;
  const slow = ops.slow.get(m.id);
  // nur wiederkehrende Muster melden – ein einzelner langsamer Zyklus ist normal
  const slowList = (ops.buckets.get(m.id) ?? []).filter((b) => b.t >= now - 3 * H && b.slowLoss > b.target * 0.08);
  const slowBs = slowList.length;
  const cycleFixed = fixedRecently(plant, m.id, "zyklus");
  checks.push({ key: "cycle", label: "Zyklus / Leistung", value: running ? `${fmtNum(cycleNow, 2)} s · Soll ${fmtNum(m.targetCycle, 1)} s · ${fmtPct(perf, 0)}` : "Maschine steht", state: running && perf < 0.85 ? "crit" : running && perf < 0.92 ? "warn" : "ok" });
  if (running && !cycleFixed && slowBs >= 3) {
    const lostPerH = slowList.reduce((s, b) => s + b.slowLoss, 0) / 3;
    const loss = lostPerH * e.db * 24;
    const reason = slow?.reason ?? slowList[slowList.length - 1].reason ?? "";
    const fix = cycleFix(m, reason);
    add({
      kind: "leistung",
      sev: slowBs >= 5 || (perf < 0.85 && slowBs >= 4) ? "warn" : "info",
      early: false,
      title: `Wiederholt langsamer Zyklus – ${slowBs} von 12 Intervallen`,
      signal: `In den letzten 3 Stunden lief die Maschine ${slowBs}-mal deutlich langsamer als geplant. Das löst keinen Alarm aus, kostet aber im Schnitt ${fmtInt(lostPerH)} Teile pro Stunde.`,
      evidence: [
        { label: "Zyklus jetzt", value: `${fmtNum(cycleNow, 2)} s (Soll ${fmtNum(m.targetCycle, 1)} s)`, up: perf < 0.92 },
        { label: "langsame Intervalle (3 h)", value: `${slowBs} von 12`, up: true },
        { label: "Teile weniger je Stunde", value: fmtInt(lostPerH) },
        { label: "Hinweis aus dem BDE", value: reason || "Zyklus verlängert" },
      ],
      cause: fix.cause,
      confidence: reason ? 0.8 : 0.64,
      probability: 0.85,
      horizon: "Verlust entsteht laufend, solange die Ursache bleibt",
      lossEur72: loss,
      actions: [
        act({
          id: "zyklus-fix",
          label: fix.action,
          detail: "Ursache direkt beheben – der Zyklus geht zurück auf Soll.",
          when: "in 15 min (ohne Stopp)",
          costEur: 120,
          avoidedEur: loss * 0.8,
          startH: 0.25,
          ticket: { action: "create-measure", machineId: m.id, startInH: 0.25, effect: "zyklus", reason: `${m.id}: ${fix.action} (KI-Wächter: Zyklus wiederholt zu lang)`, costEur: 0, savingEur: 0, source: "" },
        }),
        act({
          id: "zyklus-spaeter",
          label: "Beim nächsten Rüsten mitprüfen",
          detail: "Kein Eingriff jetzt – bis dahin läuft der Leistungsverlust weiter.",
          when: head ? `nach ${head.id}` : "nächstes Rüsten",
          costEur: 0,
          avoidedEur: loss * 0.3,
          startH: 8,
          ticket: { action: "create-measure", machineId: m.id, startInH: 8, effect: "zyklus", reason: `${m.id}: Zyklus beim nächsten Rüsten prüfen (KI-Wächter)`, costEur: 0, savingEur: 0, source: "" },
        }),
        nothing(loss),
      ],
    });
  }

  // ---------- 4 · Verfügbarkeit: gehäufte Kurzstillstände
  const shortToday = ops.stops.filter((s) => s.machineId === m.id && s.status === "STOERUNG" && s.start >= ops.curDay && (s.end ?? now) - s.start < 25 * MIN);
  const shortYesterday = ops.stops.filter((s) => s.machineId === m.id && s.status === "STOERUNG" && s.start >= ops.curDay - 24 * H && s.start < ops.curDay && (s.end ?? now) - s.start < 25 * MIN).length;
  const usual = Math.max(4, shortYesterday || 6);
  const elapsedH = Math.max(1, (now - ops.curDay) / H);
  const perDay = (shortToday.length / elapsedH) * 24;
  const stopMin = shortToday.reduce((s, x) => s + ((x.end ?? now) - x.start) / MIN, 0);
  const stopsFixed = (plant.microFixUntil.get(m.id) ?? 0) > now;
  checks.push({ key: "stops", label: "Kurzstillstände heute", value: `${shortToday.length}× · ${fmtInt(stopMin)} min`, state: !stopsFixed && shortToday.length >= 4 && perDay > usual * 1.6 ? "warn" : "ok" });
  if (!stopsFixed && shortToday.length >= 4 && perDay > usual * 1.6 && elapsedH >= 2) {
    const reasons = new Map<string, number>();
    for (const s of shortToday) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
    const [topReason, n] = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
    const loss = (stopMin / 60 / elapsedH) * 72 * nominalRate * e.db * 0.8;
    add({
      kind: "kurzstopps",
      sev: perDay > usual * 2.5 ? "warn" : "info",
      early: true,
      title: `Kurzstillstände gehäuft – ${fmtNum(perDay / usual, 1)}× so oft wie üblich`,
      signal: `${shortToday.length} Kurzstillstände seit 06:00. Einzeln harmlos, zusammen ${fmtInt(stopMin)} Minuten ohne Produktion – und es werden mehr.`,
      evidence: [
        { label: "heute", value: `${shortToday.length}× (${fmtInt(stopMin)} min)`, up: true },
        { label: "gestern", value: `${shortYesterday}×` },
        { label: "häufigste Ursache", value: `${topReason} (${n}×)` },
      ],
      cause: `Wiederkehrend „${topReason}“ – ${microFix(topReason).split(",")[0].toLowerCase()} ist überfällig`,
      confidence: clamp(0.55 + (n / shortToday.length) * 0.35, 0.55, 0.9),
      probability: 0.8,
      horizon: "setzt sich ohne Eingriff fort",
      lossEur72: loss,
      actions: [
        act({
          id: "stopps-fix",
          label: `Ursache abstellen: ${microFix(topReason)}`,
          detail: "Gezielter Eingriff an der häufigsten Ursache – senkt die Kurzstillstände deutlich.",
          when: "in 30 min (ca. 20 min Stopp)",
          costEur: 220 + (20 / 60) * nominalRate * e.db,
          avoidedEur: loss * 0.7,
          startH: 0.5,
          ticket: { action: "create-measure", machineId: m.id, startInH: 0.5, effect: "kurzstopps", reason: `${m.id}: ${microFix(topReason)} (KI-Wächter: ${topReason} ${n}× heute)`, costEur: 0, savingEur: 0, source: "" },
        }),
        act({
          id: "stopps-5why",
          label: "5-Why im nächsten Schichtgespräch + Bediener-Checkliste",
          detail: "Kein Stopp jetzt – Ursache wird gemeinsam mit der Schicht geklärt.",
          when: `Schichtwechsel ${fmtTime(nextShiftChange(now))}`,
          costEur: 0,
          avoidedEur: loss * 0.3,
          startH: (nextShiftChange(now) - now) / H,
          ticket: { action: "create-measure", machineId: m.id, startInH: (nextShiftChange(now) - now) / H, effect: "kurzstopps", reason: `${m.id}: 5-Why zu „${topReason}“ im Schichtgespräch (KI-Wächter)`, costEur: 0, savingEur: 0, source: "" },
        }),
        nothing(loss),
      ],
    });
  }

  // ---------- 5 · Energie: Mehrverbrauch bei gleicher Leistung
  const power = liveRun.length ? mean(liveRun.map((s) => s.power)) : m.baseline.power;
  const dev = power / m.baseline.power - 1;
  const energyFixed = fixedRecently(plant, m.id, "energie");
  checks.push({ key: "energy", label: "Energie", value: running ? `${fmtNum(power, 1)} kW (${sign(dev * 100, 0)} %)` : "–", state: running && dev > 0.08 ? "warn" : "ok" });
  if (running && !energyFixed && dev > 0.05) {
    const extraKw = power - m.baseline.power;
    const loss = extraKw * 72 * ENERGY_EUR_PER_KWH;
    const yearly = extraKw * 24 * 330 * ENERGY_EUR_PER_KWH;
    const leak = m.leak >= m.heater;
    add({
      kind: "energie",
      sev: dev > 0.08 ? "warn" : "info",
      early: false,
      title: `Energieverbrauch ${sign(dev * 100, 0)} % bei gleicher Leistung`,
      signal: `Die Maschine braucht ${fmtNum(extraKw, 1)} kW mehr als ihr Referenzwert – hochgerechnet ca. ${fmtEur(yearly)} im Jahr.`,
      evidence: [
        { label: "Leistungsaufnahme", value: `${fmtNum(power, 1)} kW (Referenz ${fmtNum(m.baseline.power, 1)} kW)`, up: true },
        { label: leak ? "Öltemperatur" : "Massetemperatur", value: leak ? `${sign(oilDev)} °C` : `${sign(m.current.temp1 - m.baseline.temp1)} °C`, up: true },
        { label: "je Jahr", value: fmtEur(yearly) },
      ],
      cause: leak ? "Innere Leckage in der Hydraulik – die Pumpe muss nachfördern, die Öltemperatur steigt mit" : "Heizbänder bzw. Temperierung arbeiten gegen eine zu hohe Massetemperatur",
      confidence: 0.7,
      probability: 0.95,
      horizon: "Mehrkosten laufend",
      lossEur72: loss,
      actions: [
        act({
          id: "energie-fix",
          label: leak ? "Leckage-Ortung Hydraulik, Dichtungen tauschen" : "Heizbänder und Regelung der Massetemperatur prüfen",
          detail: `Spart ca. ${fmtEur(yearly)} pro Jahr und entlastet die Hydraulik.`,
          when: "nächste Wartungslücke",
          costEur: 160,
          avoidedEur: loss * 0.9 + yearly * 0.05,
          startH: 1,
          ticket: { action: "create-measure", machineId: m.id, startInH: 1, effect: "energie", reason: `${m.id}: ${leak ? "Leckage-Ortung Hydraulik" : "Heizbänder prüfen"} (KI-Wächter: ${sign(dev * 100, 0)} % Energie)`, costEur: 0, savingEur: 0, source: "" },
        }),
        nothing(loss),
      ],
    });
  }

  // ---------- 6 · Liefertermin des laufenden Auftrags
  if (head) {
    const v = orderView(plant, head);
    checks.push({ key: "due", label: "Liefertermin", value: `${head.id} · ${fmtPct(v.onTimeProb, 0)} pünktlich`, state: v.risk === "gefaehrdet" ? "crit" : v.risk === "beobachten" ? "warn" : "ok" });
    if (v.risk === "gefaehrdet") {
      const loss = 0.06 * head.valueEur + 900;
      const alt = alternativeMachines(plant, head).find((a) => a.status !== "STOERUNG" && a.risk < 0.45);
      add({
        kind: "termin",
        sev: "warn",
        early: false,
        title: `Liefertermin ${head.id} gefährdet`,
        signal: `Nur ${fmtPct(v.onTimeProb, 0)} Wahrscheinlichkeit für pünktliche Lieferung an ${v.customer}.`,
        evidence: [
          { label: "Pünktlichkeit", value: fmtPct(v.onTimeProb, 0) },
          { label: "Liefertermin", value: fmtDateTime(head.due) },
          { label: "Restmenge", value: `${fmtInt(head.qty - head.produced)} Stk` },
        ],
        cause: v.riskReason ?? "Warteschlange der Maschine ist zu lang für den Termin",
        confidence: 0.75,
        probability: 1 - v.onTimeProb,
        horizon: `Termin ${fmtDateTime(head.due)}`,
        lossEur72: loss * (1 - v.onTimeProb),
        actions: [
          ...(alt
            ? [
                act({
                  id: "termin-umplanen",
                  label: `Restmenge auf ${alt.machineId} umplanen`,
                  detail: `${alt.machineId} ist frei ab ${fmtTime(alt.freeAt)}${alt.changeover ? " (Werkzeugwechsel nötig)" : ""}.`,
                  when: `ab ${fmtTime(alt.freeAt)}`,
                  costEur: alt.changeover ? 650 : 180,
                  avoidedEur: loss * (1 - v.onTimeProb) * 0.85,
                  startH: Math.max(0, (alt.freeAt - now) / H),
                  ticket: { action: "create-move", machineId: m.id, orderId: head.id, targetMachineId: alt.machineId, reason: `Umplanung ${head.id} → ${alt.machineId} (KI-Wächter: Liefertermin)`, costEur: 0, savingEur: 0, source: "" },
                }),
              ]
            : []),
          act({
            id: "termin-schicht",
            label: "Zusatzschicht am Samstag (8 h)",
            detail: "Kapazität erhöhen, ohne andere Aufträge zu verschieben.",
            when: "Samstag",
            costEur: 2600,
            avoidedEur: loss * (1 - v.onTimeProb) * 0.9,
            startH: 24,
            ticket: { action: "create-measure", machineId: m.id, startInH: 0.25, effect: "keine", reason: `Zusatzschicht Samstag für ${head.id} auf ${m.id} (KI-Wächter: Liefertermin)`, costEur: 0, savingEur: 0, source: "" },
          }),
          act({ id: "termin-info", label: "Kunde proaktiv über neuen Termin informieren", detail: "Kein Mehraufwand in der Produktion – erhält das Vertrauen des Kunden.", when: "heute", costEur: 0, avoidedEur: loss * (1 - v.onTimeProb) * 0.3, startH: 0 }),
          nothing(loss * (1 - v.onTimeProb)),
        ],
      });
    }
  }

  // ---------- Zustand, Summen und Prognosekurve
  const last2h = (ops.buckets.get(m.id) ?? []).filter((b) => b.t >= now - 2 * H);
  const ran = last2h.reduce((s, b) => s + b.runSec * targetRate(m), 0);
  const perf2h = ran > 0 ? 1 - last2h.reduce((s, b) => s + b.slowLoss, 0) / ran : 0.96;
  const scores = {
    mechanik: Math.round(pred?.health ?? 80),
    prozess: Math.round(clamp(100 - Math.max(0, scrapRate - 0.006) * 4000 - Math.max(0, ewZ - 1.5) * 14, 0, 100)),
    // Leistung über die letzten 2 h (BDE-Raster) statt Momentwert – ein kurzer Einbruch ist kein Dauerproblem
    leistung: Math.round(clamp(((perf2h - 0.75) / 0.2) * 100 - shortToday.length * 1.5, 0, 100)),
    energie: Math.round(clamp(100 - Math.max(0, dev) * 600, 0, 100)),
  };
  const vals = Object.values(scores);
  const health = Math.round(Math.min(0.4 * scores.mechanik + 0.25 * scores.prozess + 0.2 * scores.leistung + 0.15 * scores.energie, Math.min(...vals) + 35));
  const order: Record<Sev, number> = { crit: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.sev] - order[b.sev] || b.lossEur72 - a.lossEur72);
  const lossEur72 = findings.reduce((s, x) => s + x.lossEur72, 0);
  const recOf = (x: GuardFinding) => x.actions.find((a) => a.recommended);
  const lossWithActionsEur72 = findings.reduce((s, x) => {
    const r = recOf(x);
    return s + (r ? Math.max(0, x.lossEur72 - r.avoidedEur) + r.costEur : x.lossEur72);
  }, 0);
  const shape = (k: GuardKind, x: number) => (k === "ausfall" ? Math.pow(x, 1.8) : x);
  const curve = Array.from({ length: 13 }, (_, i) => {
    const h = i * 6;
    const x = h / 72;
    let ohne = 0, mit = 0;
    for (const fd of findings) {
      const r = recOf(fd);
      ohne += fd.lossEur72 * shape(fd.kind, x);
      mit += (r ? Math.max(0, fd.lossEur72 - r.avoidedEur) : fd.lossEur72) * shape(fd.kind, x) + (r && h >= r.startH ? r.costEur : 0);
    }
    return { h, ohne: Math.round(ohne), mit: Math.round(mit) };
  });

  // Frühwarn-Radar: wann ist mit dem Ereignis zu rechnen?
  for (const fd of findings) {
    switch (fd.kind) {
      case "ausfall": {
        const c = rul === 0 ? 2 : (rul ?? toWarnH ?? 60);
        const from = clamp(c * 0.6, 0, 68);
        fd.window = { fromH: from, toH: clamp(c * 1.25, from + 4, 72), label: `${fd.sev === "crit" ? "Lagerschaden" : "Verschleiß"} ${fmtPct(fd.probability, 0)}` };
        break;
      }
      case "qualitaet":
        fd.window = fd.early ? { fromH: 2, toH: 10, label: "Ausschuss ab ca. +2 h" } : { fromH: 0, toH: 24, label: "Ausschuss erhöht" };
        break;
      case "termin": {
        const dueH = head ? (head.due - now) / H : 60;
        const to = clamp(dueH + 2, 6, 72);
        fd.window = { fromH: clamp(dueH - 8, 0, to - 4), toH: to, label: `Termin ${head?.id ?? ""} knapp` };
        break;
      }
      default:
        fd.window = { fromH: 0, toH: fd.kind === "energie" ? 72 : 24, label: fd.kind === "leistung" ? "Zyklus zu langsam" : fd.kind === "kurzstopps" ? "Kurzstopps gehäuft" : "Mehrverbrauch Energie" };
    }
  }
  // Gesundheitsmatrix: schlechtester Wert aus Prüfpunkten und Befunden je Bereich
  const rank: Record<DimState, number> = { ok: 0, info: 1, warn: 2, crit: 3 };
  const worst = (...s: DimState[]) => s.reduce((a, b) => (rank[b] > rank[a] ? b : a), "ok" as DimState);
  const st = (...keys: string[]) => worst(...checks.filter((c) => keys.includes(c.key)).map((c) => c.state));
  // Momentwerte (Zyklus, Stopps, Energie) schwanken – ohne Befund höchstens „Hinweis“, Warnung/kritisch nur aus Befunden
  const soft = (x: DimState): DimState => (x === "ok" ? "ok" : "info");
  const dims: Record<GuardKind, DimState> = { ausfall: st("vib", "oil", "press"), qualitaet: st("spc"), leistung: soft(st("cycle")), kurzstopps: soft(st("stops")), energie: soft(st("energy")), termin: st("due") };
  for (const fd of findings) dims[fd.kind] = worst(dims[fd.kind], fd.sev === "info" ? "info" : fd.sev);
  return { id: m.id, type: m.type, hall: m.hall, maker: m.maker, model: m.model, status: m.status, product: p.short, health, scores, findings, checks, lossEur72: Math.round(lossEur72), lossWithActionsEur72: Math.round(lossWithActionsEur72), curve, connectedAt: m.connectedAt, dims };
}

// Eine Auswertung je Sim-Sekunde und Ticketstand reicht – Snapshot, Seiten und Copilot teilen sie sich
let memo: { plant: Plant; key: string; view: GuardianView } | null = null;

export function guardianView(plant: Plant): GuardianView {
  const key = `${plant.now}|${plant.machines.length}|${plant.tickets.map((t) => t.status[0]).join("")}`;
  if (memo && memo.plant === plant && memo.key === key) return memo.view;
  const view = computeGuardian(plant);
  memo = { plant, key, view };
  return view;
}

function computeGuardian(plant: Plant): GuardianView {
  const machines = plant.machines.map((m) => analyzeMachine(plant, m)).sort((a, b) => b.lossEur72 - a.lossEur72 || a.health - b.health);
  const all = machines.flatMap((m) => m.findings);
  const avoided = plant.avoided.filter((a) => a.t >= plant.dayStart);
  const tr = plant.guardTrust;
  const shiftMarksH: number[] = [];
  for (let t = nextShiftChange(plant.now); t < plant.now + 72 * H; t = nextShiftChange(t + 60_000)) shiftMarksH.push((t - plant.now) / H);
  return {
    trust: { days: 30, warnings: tr.warnings, confirmed: tr.confirmed, falseAlarms: tr.falseAlarms, open: plant.guardOpen.size, hitRate: tr.confirmed / Math.max(1, tr.confirmed + tr.falseAlarms), avgLeadH: tr.leadH / Math.max(1, tr.leadN) },
    shiftMarksH,
    now: plant.now,
    intervalMin: 5,
    machines,
    blind: PHASE2_SEEDS.filter((s) => !plant.machines.some((m) => m.id === s.id)).map((s) => ({ id: s.id, maker: s.maker, model: s.model, product: PRODUCT[s.productId].short })),
    totals: {
      monitored: machines.length,
      signals: plant.machines.reduce((s, m) => s + SENSOR_DEFS[m.type].length, 0),
      analysesToday: Math.floor((plant.now - plant.dayStart) / (5 * MIN)) * machines.length,
      findings: all.length,
      crit: all.filter((x) => x.sev === "crit").length,
      early: all.filter((x) => x.early).length,
      lossEur72: machines.reduce((s, m) => s + m.lossEur72, 0),
      lossWithActionsEur72: machines.reduce((s, m) => s + m.lossWithActionsEur72, 0),
      avoidedTodayEur: Math.round(avoided.reduce((s, a) => s + a.eur, 0)),
    },
    avoided: avoided.slice(-12).reverse(),
  };
}

