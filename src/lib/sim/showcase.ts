// Live-Demo „Alle Fälle“: ein Schalter, und in jeder Rubrik ist gleichzeitig zu sehen, was das System kann –
// Lagerschaden-Frühwarnung, Etikettenversatz, Eilanfrage, Lieferverzug, echte Störung, Rüsten, Wartung,
// Leistungsverlust, Mehrverbrauch Energie, frisch angebundene Rollout-Maschine, LKW am Tor / wartend / an der Rampe /
// verspätet / mit überzogener Standzeit, Fertigware unter Minimum und offene Freigaben.
// Ein Regisseur prüft jede Sim-Minute, ob ein Fall verschwunden ist, und stellt ihn wieder her – die Werksuhr läuft in Echtzeit.

import { alternativeMachines } from "./analysis";
import { CARRIERS, PRODUCT } from "./catalog";
import type { Plant } from "./engine";
import { draftFromGuard, guardianView } from "./guardian";
import { stockViews, visitView } from "./reports";
import { H, MIN } from "./time";
import type { Machine, ScenarioId, TruckVisit } from "./types";

const SCENARIOS: ScenarioId[] = ["lager", "etikett", "eilauftrag", "granulat"];
/** Maschinen, an denen die Szenarien laufen – dort keine zusätzlichen Fälle */
const BUSY = new Set(["SG-04", "SG-02"]);
const BREAK_ON = ["SG-06", "TF-03", "SG-03", "SG-08"];
const RUESTEN_ON = ["TF-02", "SG-05", "TF-03"];
const WARTUNG_ON = ["TF-04", "SG-01", "TF-01"];
const SLOW_ON = "SG-07";
const ENERGY_ON = "TF-01";
const PHASE2_ON = "SG-09";
const STOCK_LOW = "P-EIS1000";

const BREAK_REASON: Record<Machine["type"], string[]> = {
  SG: ["Hydraulik-Leckage am Schließzylinder – Notabschaltung", "Heißkanal-Regler Zone 4 ausgefallen", "Servoantrieb Einspritzachse: Überstrom"],
  TF: ["Heizfeld 3 ausgefallen – Folie formt nicht aus", "Stanzwerkzeug gebrochen", "Kettenführung am Einzug blockiert"],
};

export interface ShowcaseCase {
  key: string;
  label: string;
  area: string;
  on: boolean;
  href: string;
}

export function startShowcase(p: Plant) {
  p.realtime();
  for (const id of SCENARIOS) p.startScenario(id);
  stageSlow(p);
  // 90 Sim-Minuten vorspulen, damit Trends, SPC-Verletzungen und Prognosen schon sichtbar sind – danach zurück auf die echte Uhr
  for (let i = 0; i < 180; i++) p.tick(30);
  p.realtime();
  p.showcase.active = true;
  p.showcase.startedAt = p.now;
  p.showcase.nextCheck = 0;
  p.showcase.last = {};
  stageInstant(p);
  p.log("KI", "info", "Live-Demo: alle Fälle aktiv", "Störung, Frühwarnung, Qualität, Eilanfrage, Lieferverzug, LKW-Hof und Freigaben laufen gleichzeitig.");
}

/** wird jede Sim-Minute aufgerufen, solange die Live-Demo läuft */
export function maintainShowcase(p: Plant) {
  stageSlow(p);
  stageInstant(p);
}

const since = (p: Plant, key: string) => p.now - (p.showcase.last[key] ?? -Infinity);
const mark = (p: Plant, key: string) => (p.showcase.last[key] = p.now);
/** nächste freie Maschine aus der Liste – reihum, damit es nicht immer dieselbe trifft */
function pickRot(p: Plant, key: string, ids: string[]) {
  const start = p.showcase.last[`${key}#`] ?? 0;
  for (let k = 0; k < ids.length; k++) {
    const i = (start + k) % ids.length;
    const m = running(p, ids[i]);
    if (m && !BUSY.has(m.id) && !(m.id === ENERGY_ON && key === "wartung")) {
      p.showcase.last[`${key}#`] = (i + 1) % ids.length;
      return m;
    }
  }
}
const running = (p: Plant, id: string) => {
  const m = p.findMachine(id);
  return m && m.status === "PRODUKTION" && m.queue.length > 0 ? m : undefined;
};

/** Zustände, die über längere Zeit wirken (bleiben, bis eine Maßnahme sie behebt) */
function stageSlow(p: Plant) {
  const fixed = (id: string, effect: string) => p.now - (p.measureAt.get(`${id}:${effect}`) ?? -Infinity) < 6 * H;
  // Leistungsverlust (langsamer Zyklus) an SG-07
  if (!fixed(SLOW_ON, "zyklus")) {
    const s = p.ops.slow.get(SLOW_ON);
    if (!s || s.until - p.now < 2 * H) p.ops.slow.set(SLOW_ON, { factor: 1.36, until: p.now + 6 * H, reason: s?.reason ?? "Material feucht – Trockner läuft unter Solltemperatur" });
  }
  // Mehrverbrauch Energie an TF-01 (Heizband + Hydraulik)
  const e = p.findMachine(ENERGY_ON);
  if (e && !fixed(ENERGY_ON, "energie")) {
    e.heater = Math.max(e.heater, 0.7);
    e.leak = Math.max(e.leak, 0.6);
  }
  // Rollout Phase 2: eine Maschine frisch angebunden, die übrigen bleiben „nicht angebunden“
  if (!p.findMachine(PHASE2_ON) && !p.showcase.last.phase2) {
    p.connectMachine(PHASE2_ON);
    mark(p, "phase2");
  }
  // Szenarien wieder scharf schalten, wenn sie behoben wurden (nach einer Weile, damit der Erfolg sichtbar bleibt)
  const sc = p.scenarios;
  const s04 = p.findMachine("SG-04");
  if (!sc.lager.active && s04?.status === "PRODUKTION" && since(p, "lager-off") > 45 * MIN) p.startScenario("lager");
  if (sc.lager.active) mark(p, "lager-off");
  const s02 = p.findMachine("SG-02");
  if (!sc.etikett.active && s02?.status === "PRODUKTION" && since(p, "etikett-off") > 45 * MIN) p.startScenario("etikett");
  if (sc.etikett.active) mark(p, "etikett-off");
  if (!sc.granulat.active) p.startScenario("granulat");
  if (!p.inquiries.some((i) => i.status === "OFFEN") && since(p, "inquiry") > 30 * MIN) {
    p.stopScenario("eilauftrag");
    p.startScenario("eilauftrag");
    mark(p, "inquiry");
  }
}

/** Momentaufnahmen, die sich im Betrieb schnell auflösen (Störung, Rüsten, LKW …) – immer wieder neu stellen */
function stageInstant(p: Plant) {
  const now = p.now;

  // echte Störung mit Reparatur (2,5–3,5 h) – reihum an verschiedenen Maschinen
  if (p.machines.some((m) => m.status === "STOERUNG" && (p.timers.get(m.id)?.until ?? 0) - now > 15 * MIN)) mark(p, "break-seen");
  else if (since(p, "break-seen") > 5 * MIN) {
    const m = pickRot(p, "break", BREAK_ON);
    if (m) {
      const reason = p.rng.pick(BREAK_REASON[m.type]);
      m.failureCount++;
      p.forceStatus(m, "STOERUNG", reason, p.rng.range(2.5, 3.5), true);
      p.log("IoT", "crit", `${m.id}: ${reason.split(" – ")[0]}`, "Ungeplanter Stillstand – Instandhaltung alarmiert.", { machineId: m.id });
      p.log("CMMS", "warn", `Störungsauftrag ${m.id} angelegt`, "Reparatur ca. 3 h · betroffene Aufträge werden neu bewertet.", { machineId: m.id });
      mark(p, "break-seen");
    }
  }

  // Rüsten (Werkzeug- bzw. Formatwechsel) – reihum
  if (p.machines.some((m) => m.status === "RUESTEN")) mark(p, "ruesten-seen");
  else if (since(p, "ruesten-seen") > 8 * MIN) {
    const m = pickRot(p, "ruesten", RUESTEN_ON);
    if (m) {
      p.forceStatus(m, "RUESTEN", `Werkzeugwechsel auf ${PRODUCT[m.productId].short} (Formatwechsel)`, p.rng.range(0.9, 1.4));
      p.log("MES", "info", `${m.id}: Rüsten gestartet`, "Werkzeugwechsel nach SMED-Standard · ca. 1 h", { machineId: m.id });
      mark(p, "ruesten-seen");
    }
  }

  // geplante Wartung (freigegebener Auftrag) – reihum
  if (p.machines.some((m) => m.status === "WARTUNG") || p.tickets.some((t) => t.kind === "wartung" && t.status === "FREIGEGEBEN")) mark(p, "wartung-seen");
  else if (since(p, "wartung-seen") > 10 * MIN) {
    const m = pickRot(p, "wartung", WARTUNG_ON);
    if (m) {
      const t = p.createTicket({ kind: "wartung", machineId: m.id, start: now, durationH: 1.5, reason: m.type === "TF" ? "Geplante Wartung: Heizfelder reinigen, Ketten schmieren" : "Geplante Wartung: Schmierung, Filter, Düsen prüfen", createdBy: "Nutzer" });
      p.decideTicket(t.id, true);
      mark(p, "wartung-seen");
    }
  }

  // Freigaben: mindestens zwei offene KI-Vorschläge
  if (p.tickets.filter((t) => t.status === "ENTWURF").length < 2 && since(p, "draft") > 15 * MIN) {
    stageDrafts(p);
    mark(p, "draft");
  }

  // Fertigware unter Sicherheitsbestand
  const sv = stockViews(p).find((s) => s.productId === STOCK_LOW);
  const st = p.ops.stock.get(STOCK_LOW);
  if (sv && st && sv.state === "ok") st.pieces = Math.round(sv.minPallets * sv.piecesPerPallet * 0.55);

  stageYard(p);
}

function stageDrafts(p: Plant) {
  // 1 · empfohlene Maßnahme zum wichtigsten Maschinenbefund
  const g = guardianView(p);
  for (const m of [...g.machines].sort((a, b) => b.lossEur72 - a.lossEur72)) {
    const f = m.findings.find((x) => !x.openTicket && x.actions.some((a) => a.recommended && a.ticket));
    const a = f?.actions.find((x) => x.recommended && x.ticket);
    if (f && a?.ticket) {
      draftFromGuard(p, a.ticket, "KI-Wächter");
      break;
    }
  }
  // 2 · Umplanung eines gefährdeten Auftrags
  const mach = p.findMachine("SG-04");
  const head = mach?.queue[0] ? p.order(mach.queue[0]) : undefined;
  const alt = head && alternativeMachines(p, head).find((x) => x.status !== "STOERUNG" && x.risk < 0.45);
  if (head && alt && !p.tickets.some((t) => t.kind === "umplanung" && t.orderId === head.id && t.status === "ENTWURF"))
    p.createTicket({ kind: "umplanung", orderId: head.id, machineId: head.machineId, targetMachineId: alt.machineId, start: p.now, durationH: 0, reason: `Umplanung ${head.id} → ${alt.machineId} (Ausfallrisiko ${head.machineId})`, createdBy: "KI-Werksexperte" });
}

// ---------------- LKW-Hof ----------------

function freeDock(p: Plant) {
  const busy = new Set(p.ops.visits.filter((v) => v.status === "RAMPE" || v.status === "WARTET").map((v) => v.dock));
  return [1, 2, 3, 4, 5, 6].find((d) => !busy.has(d)) ?? 1 + (p.showcase.seq % 6);
}

/** zusätzliches Fahrzeug für die Live-Demo (ohne Sendung – bucht keinen Umsatz und keinen Lagerabgang) */
function extraTruck(p: Plant, slotStart: number, arriveAt: number) {
  const tpl = p.ops.visits.filter((v) => v.kind === "abholung" && !v.forecast && v.plate !== "–");
  const base = tpl[p.showcase.seq % Math.max(1, tpl.length)];
  if (!base) return;
  const c = CARRIERS[p.showcase.seq % CARRIERS.length];
  const n = p.showcase.seq++;
  const letters = "ABCDEFGHKLMNPRSTUVWXYZ";
  const plate = `${c.plate}-${letters[(n * 7) % letters.length]}${letters[(n * 11 + 3) % letters.length]} ${1000 + ((n * 7919) % 8999)}`;
  const v: TruckVisit = {
    ...base,
    id: `ZF-${p.ops.seq.visit++}`,
    carrier: c.name,
    plate,
    shipmentId: undefined,
    orderId: undefined,
    inboundId: undefined,
    productId: undefined,
    materialId: undefined,
    forecast: undefined,
    status: "ERWARTET",
    arrivedAt: undefined,
    dockAt: undefined,
    doneAt: undefined,
    departedAt: undefined,
    slotStart,
    slotEnd: slotStart + 30 * MIN,
    arriveAt,
    plannedDepart: slotStart + base.dwellMin * MIN,
    dock: freeDock(p),
    ref: "Live-Demo",
    // Papiere und Ladeliste beim Pförtner – das Fahrzeug bleibt sichtbar am Tor
    gateMin: 8,
  };
  p.ops.visits.push(v);
  return v;
}

function stageYard(p: Plant) {
  const now = p.now;
  const vs = p.ops.visits;
  const views = () => vs.map((v) => ({ v, x: visitView(p, v) }));

  // ankommen (am Tor) – ungefähr alle 8 Minuten ein Fahrzeug
  if (!vs.some((v) => v.status === "AM_TOR") && since(p, "gate") > 6 * MIN) {
    const next = vs.filter((v) => v.status === "ERWARTET" && !v.forecast && v.kind === "abholung" && v.slotStart - now < 35 * MIN && v.slotStart - now > -15 * MIN && v.arriveAt - now < 40 * MIN).sort((a, b) => a.arriveAt - b.arriveAt)[0];
    if (next) next.arriveAt = Math.min(next.arriveAt, now);
    // zu früh angekommen: erst Anmeldung am Tor, danach Warten auf die Rampe
    else extraTruck(p, now + p.rng.range(40, 50) * MIN, now);
    mark(p, "gate");
  }

  // verspätet: Telematik meldet Stau – ETA deutlich nach dem Zeitfenster
  const late = views().some(({ v, x }) => v.status === "ERWARTET" && !v.forecast && x.lateMin > 15 && v.arriveAt - now < 3 * H);
  if (!late && since(p, "late") > 5 * MIN) {
    const cand = vs.filter((v) => v.status === "ERWARTET" && !v.forecast && v.slotStart > now + 10 * MIN && v.slotStart < now + 2 * H).sort((a, b) => a.slotStart - b.slotStart)[0];
    if (cand) cand.arriveAt = cand.slotEnd + p.rng.range(35, 55) * MIN;
    else extraTruck(p, now - 40 * MIN, now + p.rng.range(20, 30) * MIN);
    mark(p, "late");
  }

  // an der Rampe: mindestens zwei Fahrzeuge in Beladung
  const atRamp = vs.filter((v) => v.status === "RAMPE" && !v.doneAt).length;
  if (atRamp < 1 && since(p, "ramp") > 4 * MIN) {
    const t = extraTruck(p, now - 20 * MIN, now - 12 * MIN);
    if (t) {
      t.status = "RAMPE";
      t.arrivedAt = now - 12 * MIN;
      t.dockAt = now - 6 * MIN;
    }
    mark(p, "ramp");
  }

  // wartet auf die Rampe (zu früh oder Rampe belegt)
  if (!vs.some((v) => v.status === "WARTET") && since(p, "wait") > 6 * MIN) {
    const t = extraTruck(p, now + p.rng.range(25, 35) * MIN, now - 8 * MIN);
    if (t) {
      t.status = "WARTET";
      t.arrivedAt = now - 8 * MIN;
    }
    mark(p, "wait");
  }

  // überzogene Standzeit: ein Fahrzeug steht deutlich länger als geplant an der Rampe
  const over = views().some(({ v, x }) => (v.status === "RAMPE" || v.status === "WARTET") && x.overstayMin > 0);
  if (!over && since(p, "over") > 10 * MIN) {
    const v = vs.find((x) => x.status === "RAMPE" && !x.doneAt && x.ref === "Live-Demo") ?? extraTruck(p, now - 90 * MIN, now - 80 * MIN);
    if (v) {
      v.status = "RAMPE";
      v.arrivedAt = now - (v.dwellMin + 22) * MIN;
      v.dockAt = now - v.dwellMin * MIN;
      v.handleMin = v.dwellMin + 18;
      v.doneAt = undefined;
    }
    mark(p, "over");
  }
}

// ---------------- Übersicht für die Oberfläche ----------------

export function showcaseCases(p: Plant): ShowcaseCase[] {
  const ms = p.machines;
  const g = guardianView(p);
  const vv = p.ops.visits.map((v) => ({ v, x: visitView(p, v) }));
  const has = (fn: (m: Machine) => boolean) => ms.some(fn);
  const finding = (kind: string) => g.machines.some((m) => m.findings.some((f) => f.kind === kind && (f.sev !== "info" || f.early)));
  return [
    { key: "stoerung", area: "Produktion", label: "Maschine in Störung", on: has((m) => m.status === "STOERUNG"), href: "/produktion" },
    { key: "fruehwarnung", area: "Maschinengesundheit", label: "KI-Frühwarnung Lagerschaden", on: finding("ausfall"), href: "/waechter" },
    { key: "qualitaet", area: "Qualität", label: "Etikettenversatz / SPC", on: finding("qualitaet") || has((m) => Boolean(m.spc[m.spc.length - 1]?.violation)), href: "/qualitaet" },
    { key: "ruesten", area: "Produktion", label: "Rüsten", on: has((m) => m.status === "RUESTEN"), href: "/produktion" },
    { key: "wartung", area: "Produktion", label: "Geplante Wartung", on: has((m) => m.status === "WARTUNG"), href: "/produktion" },
    { key: "leistung", area: "Maschinengesundheit", label: "Langsamer Zyklus", on: p.ops.slow.has(SLOW_ON), href: "/waechter" },
    { key: "energie", area: "Maschinengesundheit", label: "Mehrverbrauch Energie", on: finding("energie"), href: "/waechter" },
    { key: "termin", area: "Vertrieb", label: "Liefertermin gefährdet", on: finding("termin") || p.openOrders().some((o) => p.projectFinish(o) > o.due), href: "/vertrieb" },
    { key: "anfrage", area: "Vertrieb", label: "Eilanfrage offen", on: p.inquiries.some((i) => i.status === "OFFEN"), href: "/vertrieb" },
    { key: "material", area: "Logistik", label: "Lieferverzug Granulat", on: p.inbound.some((i) => i.status === "VERSPAETET"), href: "/logistik" },
    { key: "lager", area: "Lager", label: "Fertigware unter Minimum", on: stockViews(p).some((s) => s.state !== "ok"), href: "/lager" },
    { key: "tor", area: "LKW-Hof", label: "LKW am Werkstor", on: vv.some(({ v }) => v.status === "AM_TOR"), href: "/lager" },
    { key: "wartet", area: "LKW-Hof", label: "LKW wartet auf Rampe", on: vv.some(({ v }) => v.status === "WARTET"), href: "/lager" },
    { key: "rampe", area: "LKW-Hof", label: "LKW wird beladen", on: vv.some(({ v }) => v.status === "RAMPE"), href: "/lager" },
    { key: "verspaetet", area: "LKW-Hof", label: "LKW verspätet", on: vv.some(({ v, x }) => v.status === "ERWARTET" && !v.forecast && x.lateMin > 15), href: "/lager" },
    { key: "standzeit", area: "LKW-Hof", label: "Standzeit überzogen", on: vv.some(({ v, x }) => v.status !== "ABGEFAHREN" && x.overstayMin > 0), href: "/lager" },
    { key: "freigabe", area: "Freigaben", label: "KI-Vorschlag zur Freigabe", on: p.tickets.some((t) => t.status === "ENTWURF"), href: "/werksexperte#freigaben" },
    { key: "phase2", area: "Datenintegration", label: "Maschine frisch angebunden", on: Boolean(p.findMachine(PHASE2_ON)), href: "/produktion" },
  ].map((c) => ({ ...c, on: Boolean(c.on) }));
}
