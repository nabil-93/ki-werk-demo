// Werkzeuge des KI-Copilots. Jedes Werkzeug liest echte (simulierte) Systemdaten
// oder legt einen Vorschlag an, der von einem Menschen freigegeben werden muss.

import type Anthropic from "@anthropic-ai/sdk";
import { CUSTOMERS, CUSTOMER, DEFECTS, MATERIAL_SEEDS, PRODUCT, PRODUCTS, SENSOR_DEFS } from "../sim/catalog";
import { alternativeMachines, checkFeasibility, maintenanceOptions, orderView } from "../sim/analysis";
import type { Plant } from "../sim/engine";
import { H, atDayHour } from "../sim/time";
import type { DefectType, VisitView } from "../sim/types";
import { buildSnapshot, machineView, materialViews, shipmentViews } from "../sim/views";
import { buildReport, financeView, schedule, stockViews, visitView, yardSummary } from "../sim/reports";
import { analyzeMachine, draftFromGuard, guardianView } from "../sim/guardian";
import { riskRadar, riskRadarData } from "../sim/risks";
import { whatIf, type WhatIfBranch } from "../sim/whatif";
import { searchKnowledge } from "../knowledge";
import { fmtDateTime, fmtDuration, fmtEur, fmtInt, fmtNum, fmtPct } from "./format";

export type CardKind =
  | "overview"
  | "machines"
  | "prediction"
  | "orders"
  | "delivery"
  | "feasibility"
  | "quality"
  | "materials"
  | "shipments"
  | "docs"
  | "ticket"
  | "risks"
  | "whatif";

export interface ToolCard {
  kind: CardKind;
  data: unknown;
}

export interface ToolOutput {
  data: unknown;
  card?: ToolCard;
  summary: string;
}

type Input = Record<string, unknown>;

export { TOOL_META } from "./toolMeta";
import { TOOL_META } from "./toolMeta";

const S = (description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "object" as const,
  properties,
  required,
});

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "werk_uebersicht",
    description:
      "Liefert den aktuellen Gesamtzustand des Werks Nord: Schicht, OEE, Ausbringung, Ausschuss, Liefertreue, Energie, Maschinen in Störung, aktive Warnungen, offene Kundenanfragen und KI-Vorschläge. Gut als Einstieg für Lagebilder und Schichtbriefings.",
    input_schema: S("keine Parameter"),
  },
  {
    name: "maschinen_status",
    description:
      "Status einer oder aller Maschinen (Spritzgießen SG-01…SG-08, Thermoformen TF-01…TF-04): Zustand, laufender Auftrag, Produkt, OEE, Ausschuss, aktuelle Sensorwerte (Schwingung, Temperaturen, Druck, Zyklus, Leistung).",
    input_schema: S("", { maschine_id: { type: "string", description: "z. B. SG-04. Weglassen für alle Maschinen." } }),
  },
  {
    name: "wartungsprognose",
    description:
      "Predictive Maintenance: Ausfallwahrscheinlichkeit in 72 h, Zustandsindex, Restlaufzeit (RUL) bis zur Schadensgrenze nach ISO 10816-3 und die wichtigsten Einflussfaktoren. Mit maschine_id zusätzlich Wartungsfenster-Optionen und Kostenvergleich geplant vs. ungeplant.",
    input_schema: S("", { maschine_id: { type: "string", description: "optional, z. B. SG-04" } }),
  },
  {
    name: "auftraege_suchen",
    description:
      "Sucht Fertigungs-/Kundenaufträge aus SAP mit Fortschritt, Maschine, Liefertermin, prognostizierter Lieferung und Termintreue-Wahrscheinlichkeit.",
    input_schema: S("", {
      kunde: { type: "string", description: "Kundenname oder Teil davon" },
      maschine_id: { type: "string" },
      nur_gefaehrdet: { type: "boolean", description: "nur Aufträge mit Terminrisiko" },
      produkt: { type: "string" },
    }),
  },
  {
    name: "liefertermin_pruefen",
    description: "Detailprüfung eines Auftrags: prognostizierte Fertigstellung und Lieferung, Risiko, Ursache und alternative Maschinen.",
    input_schema: S("", { auftrag_id: { type: "string", description: "z. B. FA-48215" } }, ["auftrag_id"]),
  },
  {
    name: "machbarkeit_pruefen",
    description:
      "Capable-to-Promise-Prüfung für eine (neue) Anfrage: Kann Menge X von Produkt Y bis Termin Z geliefert werden? Prüft Maschinenkapazität, Vorziehen mit Auswirkungen auf andere Aufträge, Material inkl. Zulauf und Transportzeit. Für offene Kundenanfragen anfrage_id angeben.",
    input_schema: S("", {
      anfrage_id: { type: "string", description: "z. B. AN-90 (offene Kundenanfrage)" },
      produkt: { type: "string", description: "Produktname oder ID, z. B. 'IML-Becher 500 ml' oder P-IML500" },
      menge: { type: "number", description: "Stückzahl" },
      liefertermin_iso: { type: "string", description: "ISO-Datum/Zeit, z. B. 2026-10-23T08:00" },
      in_tagen: { type: "number", description: "alternativ: Liefertermin in N Tagen um 08:00 Uhr" },
      kunde: { type: "string" },
    }),
  },
  {
    name: "qualitaetsbericht",
    description:
      "Qualitätsdaten aus CAQ und Inline-Kamera: Ausschussquote, Fehlerarten (Pareto), SPC-Status mit Regelverletzungen, Prozessfähigkeit Cpk – für eine Maschine oder das ganze Werk.",
    input_schema: S("", { maschine_id: { type: "string" } }),
  },
  {
    name: "material_und_lager",
    description: "Bestände und Reichweiten von Granulat, Folie, IML-Etiketten, Masterbatch inkl. Zulauf/Lieferverzug sowie Fertigwarenlager-Auslastung.",
    input_schema: S("", { material: { type: "string", description: "optional: Materialname oder ID (M-PPR, M-PPH, M-PSF, M-PPF, M-IML, M-MB)" } }),
  },
  {
    name: "versand_uebersicht",
    description: "Sendungen von heute: Verladung, unterwegs, zugestellt, Spedition, Tor, ETA, Termintreue.",
    input_schema: S(""),
  },
  {
    name: "wissen_suchen",
    description:
      "Durchsucht interne Dokumente (Wartungshandbücher, Fehlerkataloge, QS-Richtlinien, Vertriebsrichtlinie, Notfallpläne, KI-Richtlinie). Nutze das für Vorgehensweisen, Grenzwerte, Zuständigkeiten. Quellen immer mit Dokument-ID zitieren.",
    input_schema: S("", { frage: { type: "string" } }, ["frage"]),
  },
  {
    name: "wartung_vorschlagen",
    description:
      "Legt einen Wartungsauftrag als ENTWURF an (Freigabe durch Instandhaltung erforderlich – Human-in-the-Loop). Nur verwenden, wenn der Nutzer es wünscht oder es klar empfohlen ist.",
    input_schema: S(
      "",
      {
        maschine_id: { type: "string" },
        start_in_stunden: { type: "number", description: "Start ab jetzt in Stunden (z. B. 0.5)" },
        dauer_stunden: { type: "number", description: "Standard 1.5" },
        begruendung: { type: "string" },
      },
      ["maschine_id", "begruendung"],
    ),
  },
  {
    name: "umplanung_vorschlagen",
    description: "Schlägt vor, einen Auftrag auf eine andere kompatible Maschine umzuplanen (ENTWURF, Freigabe durch Fertigungssteuerung).",
    input_schema: S(
      "",
      { auftrag_id: { type: "string" }, ziel_maschine_id: { type: "string" }, begruendung: { type: "string" } },
      ["auftrag_id", "ziel_maschine_id", "begruendung"],
    ),
  },
  {
    name: "bestellung_vorschlagen",
    description: "Bereitet eine Material-Expressbestellung vor (ENTWURF, Freigabe durch Einkauf).",
    input_schema: S(
      "",
      { material: { type: "string" }, menge: { type: "number" }, begruendung: { type: "string" } },
      ["material", "menge", "begruendung"],
    ),
  },
  {
    name: "lkw_hof",
    description:
      "Yard-Management: LKW auf dem Hof (Tor, Warten, Rampe) mit Standzeit, Überziehung und Verspätung, erwartete Zeitfenster (heute, Woche, Monat) mit Spedition, Kennzeichen, Fahrer, Ware, Menge, Herkunft/Ziel. Mit kennzeichen die Details eines Fahrzeugs.",
    input_schema: S("", { zeitraum: { type: "string", description: "heute | morgen | woche | monat" }, kennzeichen: { type: "string", description: "z. B. GM-AB 1234" } }),
  },
  {
    name: "fertigwarenlager",
    description: "Fertigwarenbestand je Artikel im Hochregallager: Paletten, Stück, frei vs. reserviert, Sicherheitsbestand, Reichweite, Zugang aus Produktion, nächste Abholung.",
    input_schema: S("", { produkt: { type: "string", description: "optional: Produktname oder ID" } }),
  },
  {
    name: "finanzen",
    description: "Umsatz (fakturiert bei Abfahrt), Deckungsbeitrag, Ergebnis nach Fixkosten, Verlust aus Stillständen/Ausschuss, Umsatz und Marge je Kunde und Produkt, Monatsprognose vs. Budget.",
    input_schema: S("", { tage: { type: "number", description: "1, 7 oder 30 (Standard 30)" } }),
  },
  {
    name: "bericht_erstellen",
    description: "Tages-, Wochen- oder Monatsbericht mit Management-Zusammenfassung, Maschinen, Stillständen, LKW, Lager, Kunden, KI-Prognose und priorisierten Handlungsempfehlungen.",
    input_schema: S("", { zeitraum: { type: "string", description: "tag | gestern | woche | monat" } }),
  },
  {
    name: "ki_waechter",
    description:
      "KI-Wächter: laufende Analyse aller angebundenen Maschinen. Liefert je Maschine Zustand (0–100), Befunde mit Frühwarnungen (Trend statt Grenzwert), was die KI in den Daten sieht, wahrscheinliche Ursache, Eintrittswahrscheinlichkeit, Zeithorizont, drohenden Verlust in € (72 h) und Maßnahmen mit Alternativen (Kosten, vermiedener Verlust, Netto). Für „Welche Maschine macht Probleme?“, „Wo verlieren wir Geld?“, „Wie verhindern wir den Verlust?“.",
    input_schema: S("", { maschine_id: { type: "string", description: "z. B. SG-04. Weglassen für alle Maschinen." } }),
  },
  {
    name: "massnahme_vorschlagen",
    description:
      "Legt die vom KI-Wächter empfohlene (oder eine genannte) Maßnahme für eine Maschine als ENTWURF an – z. B. Wartung, Umplanung, Zyklus-Korrektur, QS-Sperre, Ersatzteil bereitlegen. Freigabe durch einen Menschen erforderlich. Nutze das, wenn der Nutzer eine empfohlene Maßnahme umsetzen will („mach das“, „leg das an“).",
    input_schema: S("", { maschine_id: { type: "string" }, massnahme: { type: "string", description: "optional: Teil der Maßnahmenbezeichnung" } }, ["maschine_id"]),
  },
  {
    name: "kunde_info",
    description: "Kundenakte: Stammdaten (Ort, Entfernung, Segment), Umsatz, Deckungsbeitrag und Marge der letzten 30 Tage, Rang nach Umsatz, offene Aufträge mit Termintreue und Risiko, offene Anfragen und nächste Abholungen.",
    input_schema: S("", { kunde: { type: "string", description: "Kundenname oder Teil davon, z. B. Alpenmilch" } }, ["kunde"]),
  },
  {
    name: "risiko_radar",
    description:
      "Experteneinschätzung über alle Bereiche: Was kann in den nächsten 72 h schiefgehen? Liefert die Risiken sortiert nach erwartetem Verlust (Wahrscheinlichkeit × Auswirkung in €) – Maschinen (KI-Wächter), Qualität, Liefertermine, Material, Fertigware, LKW-Hof – mit Ursache, Zeitpunkt und Empfehlung, dazu Datenlücken und Monatsziel. Für „Was sind die größten Risiken?“, „Worauf muss ich achten?“, „Was würdest du an meiner Stelle tun?“, „Wie wahrscheinlich ist …?“.",
    input_schema: S(""),
  },
  {
    name: "was_waere_wenn",
    description:
      "Was-wäre-wenn im digitalen Zwilling: kopiert den kompletten Werkszustand und rechnet 72 h zweimal durch – ohne Maßnahme und mit der empfohlenen (oder gewählten) Maßnahme des KI-Wächters. Liefert Verlust in €, Stillstand, Gutteile, Ausfälle und Pünktlichkeit des laufenden Auftrags für beide Varianten. Der Live-Betrieb bleibt unberührt. Für „Was passiert, wenn wir nichts tun?“, „Lohnt sich die Wartung?“, „Simuliere …“.",
    input_schema: S("", {
      maschine_id: { type: "string", description: "optional; Standard: Maschine mit dem größten drohenden Verlust" },
      massnahme: { type: "string", description: "optional: Teil der Maßnahmenbezeichnung, z. B. Wartung, Zyklus, umplanen" },
    }),
  },
].map((t) => ({ ...t, eager_input_streaming: true }));

// ---------------- Auflösung von Freitext ----------------

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined);

export function resolveProduct(text: string) {
  const t = text.toLowerCase();
  const byId = PRODUCTS.find((p) => p.id.toLowerCase() === t);
  if (byId) return byId;
  let best: (typeof PRODUCTS)[number] | undefined;
  let bestScore = 0;
  for (const p of PRODUCTS) {
    const words = `${p.name} ${p.short}`.toLowerCase().split(/[\s\-]+/);
    let score = 0;
    for (const w of words) if (w.length > 1 && t.includes(w)) score += /\d/.test(w) ? 3 : 1;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= 2 ? best : undefined;
}

export function resolveCustomer(text: string) {
  const t = text.toLowerCase();
  return CUSTOMERS.find((c) => c.id.toLowerCase() === t || c.name.toLowerCase().includes(t) || t.includes(c.name.toLowerCase().split(" ")[0]));
}

export function resolveMaterial(text: string) {
  const t = text.toLowerCase();
  return (
    MATERIAL_SEEDS.find((m) => m.id.toLowerCase() === t) ??
    MATERIAL_SEEDS.find((m) => m.name.toLowerCase().includes(t)) ??
    (t.includes("random") || t.includes("copolymer") || t.includes("iml-granulat") ? MATERIAL_SEEDS.find((m) => m.id === "M-PPR") : undefined) ??
    (t.includes("homo") ? MATERIAL_SEEDS.find((m) => m.id === "M-PPH") : undefined) ??
    (t.includes("etikett") ? MATERIAL_SEEDS.find((m) => m.id === "M-IML") : undefined) ??
    (t.includes("ps") ? MATERIAL_SEEDS.find((m) => m.id === "M-PSF") : undefined) ??
    (t.includes("granulat") ? MATERIAL_SEEDS.find((m) => m.id === "M-PPR") : undefined)
  );
}

function machineOrError(plant: Plant, id: unknown) {
  const m = plant.findMachine(str(id));
  if (!m) throw new Error(`Maschine "${str(id)}" nicht gefunden. Gültig: ${plant.machines.map((x) => x.id).join(", ")}`);
  return m;
}

// ---------------- Ausführung ----------------

export function runTool(plant: Plant, name: string, input: Input): ToolOutput {
  plant.sync();
  switch (name) {
    case "werk_uebersicht": {
      const s = buildSnapshot(plant);
      const k = s.kpis;
      const data = {
        werkszeit: fmtDateTime(s.now),
        schicht: s.shift.name,
        oee: fmtPct(k.oee),
        ausbringung_heute_stk: fmtInt(k.outputToday),
        ausschussquote: fmtPct(k.scrapRate, 2),
        liefertreue_30_tage: fmtPct(k.onTimeDelivery),
        auftragsbestand: fmtEur(k.backlogEur),
        energie_heute_kwh: fmtInt(k.energyKwhToday),
        maschinen_in_produktion: `${k.machinesRunning} von ${k.machinesTotal}`,
        maschinen_nicht_in_produktion: s.machines.filter((m) => m.status !== "PRODUKTION").map((m) => `${m.id}: ${m.status}${m.statusReason ? ` (${m.statusReason})` : ""}`),
        warnungen: s.alerts.slice(0, 8).map((a) => `[${a.severity.toUpperCase()}|${a.source}] ${a.title} – ${a.detail}`),
        offene_kundenanfragen: s.inquiries.filter((i) => i.status === "OFFEN").map((i) => ({ id: i.id, kunde: CUSTOMER[i.customerId].name, produkt: PRODUCT[i.productId].name, menge: i.qty, termin: fmtDateTime(i.due), notiz: i.note })),
        ki_vorschlaege_zur_freigabe: s.tickets.filter((t) => t.status === "ENTWURF").map((t) => `${t.id} (${t.kind}): ${t.reason}`),
        auftraege_mit_terminrisiko: k.ordersAtRisk,
      };
      return { data, card: { kind: "overview", data: { kpis: k, shift: s.shift.name, alerts: s.alerts.slice(0, 5) } }, summary: `OEE ${data.oee} · ${data.maschinen_in_produktion} in Produktion · ${s.alerts.length} Hinweise` };
    }

    case "maschinen_status": {
      const ids = str(input.maschine_id) ? [machineOrError(plant, input.maschine_id).id] : plant.machines.map((m) => m.id);
      const views = ids.map((id) => machineView(plant, plant.machine(id)));
      const data = views.map((v) => ({
        id: v.id,
        typ: v.type === "SG" ? "Spritzgießmaschine (IML)" : "Thermoformer",
        hersteller_modell: `${v.maker} ${v.model} (Bj. ${v.year})`,
        status: v.status,
        grund: v.statusReason,
        produkt: v.product.name,
        auftrag: v.orderId,
        auftragsfortschritt: v.orderProgress !== undefined ? fmtPct(v.orderProgress, 0) : undefined,
        oee_heute: fmtPct(v.oee),
        ausschuss_heute: fmtPct(v.scrapRate, 2),
        stueck_pro_h: fmtInt(v.outputPerHour),
        sensoren: Object.fromEntries(SENSOR_DEFS[v.type].map((d) => [d.label, `${fmtNum(v.current[d.key], d.digits)} ${d.unit}`])),
        ausfallrisiko_72h: fmtPct(v.prediction.p72, 0),
        zustandsindex: v.prediction.health,
      }));
      return { data: ids.length === 1 ? data[0] : data, card: { kind: "machines", data: views }, summary: ids.length === 1 ? `${views[0].id}: ${views[0].status}` : `${views.length} Maschinen gelesen` };
    }

    case "wartungsprognose": {
      if (str(input.maschine_id)) {
        const m = machineOrError(plant, input.maschine_id);
        const v = machineView(plant, m);
        const opt = maintenanceOptions(plant, m);
        const p = v.prediction;
        // dieselbe Empfehlung und Kostenbasis wie im KI-Wächter
        const gf = analyzeMachine(plant, m).findings.find((f) => f.kind === "ausfall");
        const rec = gf?.actions.find((a) => a.recommended);
        const data = {
          maschine: `${m.id} – ${m.maker} ${m.model}`,
          status: m.status,
          ausfallwahrscheinlichkeit_72h: fmtPct(p.p72, 0),
          zustandsindex_0_100: p.health,
          schwingung_aktuell: `${fmtNum(v.current.vib, 2)} mm/s`,
          iso_10816_zone: p.zone,
          restlaufzeit_bis_schadensgrenze: p.rulH === null ? "> 30 Tage (kein steigender Trend)" : fmtDuration(p.rulH),
          einflussfaktoren: p.drivers.map((d) => `${d.label}: ${d.value}`),
          wartungsfenster: opt.options.map((o) => ({ zeitpunkt: fmtDateTime(o.start), bezeichnung: o.label, risiko_ausfall_vorher: fmtPct(o.riskBefore, 0), produktionsverlust_stk: fmtInt(o.lostPieces), empfohlen: o.recommended, hinweis: o.note })),
          kosten_geplante_wartung: fmtEur(opt.planned.costEur),
          kosten_ungeplanter_ausfall: fmtEur(opt.unplanned.costEur),
          ersparnis_je_vermiedenem_ausfall: fmtEur(opt.unplanned.costEur - opt.planned.costEur),
          erwarteter_verlust_72h: fmtEur(gf?.lossEur72 ?? 0),
          empfehlung_ki_waechter: rec ? `${rec.label} (${rec.when}) – Kosten ${fmtEur(rec.costEur)}, vermeidet ${fmtEur(rec.avoidedEur)}, netto ${fmtEur(rec.netEur)}` : "keine Maßnahme nötig",
          betroffene_auftraege: m.queue.map((id) => plant.order(id)).filter(Boolean).map((o) => `${o!.id} (${CUSTOMER[o!.customerId].name}, Liefertermin ${fmtDateTime(o!.due)})`),
          modell: `${plant.model.card.version} · AUC ${fmtNum(plant.model.card.metrics.auc, 3)} · Recall ${fmtPct(plant.model.card.metrics.recall, 0)}`,
        };
        return { data, card: { kind: "prediction", data: { view: v, options: opt } }, summary: `${m.id}: Risiko ${fmtPct(p.p72, 0)}` };
      }
      const views = plant.machines.map((m) => machineView(plant, m)).sort((a, b) => b.prediction.p72 - a.prediction.p72);
      const data = views.map((v) => ({
        id: v.id,
        ausfallrisiko_72h: fmtPct(v.prediction.p72, 0),
        zustandsindex: v.prediction.health,
        zone: v.prediction.zone,
        restlaufzeit: v.prediction.rulH === null ? "> 30 Tage" : fmtDuration(v.prediction.rulH),
        treiber: v.prediction.drivers.map((d) => `${d.label} ${d.value}`).join("; "),
      }));
      return { data, card: { kind: "machines", data: views.slice(0, 6) }, summary: `Höchstes Risiko: ${views[0].id} (${fmtPct(views[0].prediction.p72, 0)})` };
    }

    case "auftraege_suchen": {
      let orders = plant.openOrders().map((o) => orderView(plant, o));
      if (str(input.kunde)) {
        const q = str(input.kunde).toLowerCase();
        orders = orders.filter((o) => o.customer.toLowerCase().includes(q));
      }
      if (str(input.maschine_id)) orders = orders.filter((o) => o.machineId === machineOrError(plant, input.maschine_id).id);
      if (str(input.produkt)) {
        const p = resolveProduct(str(input.produkt));
        if (p) orders = orders.filter((o) => o.productId === p.id);
      }
      if (input.nur_gefaehrdet === true) orders = orders.filter((o) => o.risk !== "ok");
      orders.sort((a, b) => a.onTimeProb - b.onTimeProb || a.due - b.due);
      const data = orders.slice(0, 15).map((o) => ({
        id: o.id,
        kunde: o.customer,
        produkt: o.product,
        menge: fmtInt(o.qty),
        fortschritt: fmtPct(o.progress, 0),
        maschine: o.machineId,
        status: o.status,
        liefertermin: fmtDateTime(o.due),
        prognose_lieferung: fmtDateTime(o.projectedDone),
        termintreue_wahrscheinlichkeit: fmtPct(o.onTimeProb, 0),
        risiko: o.risk,
        grund: o.riskReason,
        wert: fmtEur(o.valueEur),
      }));
      return { data: { anzahl: orders.length, auftraege: data }, card: { kind: "orders", data: orders.slice(0, 8) }, summary: `${orders.length} Aufträge gefunden` };
    }

    case "liefertermin_pruefen": {
      const o = plant.order(str(input.auftrag_id));
      if (!o) throw new Error(`Auftrag ${str(input.auftrag_id)} nicht gefunden.`);
      const ov = orderView(plant, o);
      const alts = alternativeMachines(plant, o);
      const data = {
        auftrag: o.id,
        kunde: ov.customer,
        ort: ov.city,
        produkt: ov.product,
        menge: fmtInt(o.qty),
        produziert: fmtInt(o.produced),
        maschine: o.machineId,
        status: o.status,
        liefertermin: fmtDateTime(o.due),
        prognose_lieferung: fmtDateTime(ov.projectedDone),
        puffer: fmtDuration(Math.abs(o.due - ov.projectedDone) / H) + (o.due >= ov.projectedDone ? " vor Termin" : " zu spät"),
        termintreue_wahrscheinlichkeit: fmtPct(ov.onTimeProb, 0),
        risiko: ov.risk,
        ursache: ov.riskReason,
        alternative_maschinen: alts.map((a) => ({ maschine: a.machineId, frei_ab: fmtDateTime(a.freeAt), ausfallrisiko: fmtPct(a.risk, 0), ruesten_noetig: a.changeover, status: a.status })),
      };
      return { data, card: { kind: "delivery", data: { order: ov, alternatives: alts } }, summary: `${o.id}: ${fmtPct(ov.onTimeProb, 0)} termintreu` };
    }

    case "machbarkeit_pruefen": {
      let productId: string | undefined;
      let qty = num(input.menge);
      let due: number | undefined;
      let customerId: string | undefined;
      const inq = str(input.anfrage_id) ? plant.inquiries.find((i) => i.id.toUpperCase() === str(input.anfrage_id).toUpperCase()) : undefined;
      if (inq) {
        productId = inq.productId;
        qty = qty ?? inq.qty;
        due = inq.due;
        customerId = inq.customerId;
      }
      if (str(input.produkt)) productId = resolveProduct(str(input.produkt))?.id ?? productId;
      if (str(input.kunde)) customerId = resolveCustomer(str(input.kunde))?.id ?? customerId;
      if (str(input.liefertermin_iso)) {
        const d = Date.parse(str(input.liefertermin_iso));
        if (!Number.isNaN(d)) due = d;
      }
      const days = num(input.in_tagen);
      if (days !== undefined) due = atDayHour(plant.now, days, 8);
      if (!productId) throw new Error(`Produkt unbekannt. Verfügbar: ${PRODUCTS.map((p) => `${p.id} (${p.name})`).join(", ")}`);
      if (!qty || qty <= 0) throw new Error("Menge fehlt.");
      if (!due) due = atDayHour(plant.now, 5, 8);
      const r = checkFeasibility(plant, productId, qty, due, customerId);
      const data = {
        ergebnis: { machbar: "MACHBAR", konflikt: "MACHBAR NUR MIT KONFLIKTEN", teilweise: "TEILWEISE MACHBAR", nicht: "NICHT MACHBAR" }[r.verdict],
        konfliktfreie_teilmenge_zum_termin: fmtInt(r.freeQty),
        restmenge: fmtInt(r.restQty),
        restmenge_lieferbar_bis: r.restDelivery ? fmtDateTime(r.restDelivery) : undefined,
        produkt: r.productName,
        menge: fmtInt(r.qty),
        kunde: r.customer,
        liefertermin: fmtDateTime(r.due),
        spaetestes_produktionsende: fmtDateTime(r.latestFinish),
        transportzeit: fmtDuration(r.transportH),
        einplanbare_menge: fmtInt(r.plannedQty),
        plan: r.plan.map((p) => ({ maschine: p.machineId, menge: fmtInt(p.qty), von: fmtDateTime(p.start), bis: fmtDateTime(p.end), art: p.mode === "frei" ? "freie Kapazität" : "vorgezogen vor geplante Aufträge" })),
        material: r.material.map((m) => ({ material: m.name, bedarf: `${fmtInt(m.needed)} ${m.unit}`, verfuegbar: `${fmtInt(m.available)} ${m.unit}`, zulauf_bis_termin: `${fmtInt(m.inbound)} ${m.unit}`, ausreichend: m.ok })),
        auswirkungen_auf_andere_auftraege: r.impacts.map((i) => `${i.orderId} (${i.customer}) +${fmtDuration(i.delayH)} → ${i.stillOnTime ? "weiterhin termingerecht" : "TERMIN GEFÄHRDET"}`),
        umsatz: fmtEur(r.revenueEur),
        hinweise: r.notes,
        anfrage_id: inq?.id,
      };
      return { data, card: { kind: "feasibility", data: { ...r, inquiryId: inq?.id } }, summary: `${data.ergebnis}: ${fmtInt(r.plannedQty)} von ${fmtInt(r.qty)} Stk` };
    }

    case "qualitaetsbericht": {
      const views = (str(input.maschine_id) ? [machineOrError(plant, input.maschine_id)] : plant.machines).map((m) => machineView(plant, m));
      const sum: Record<string, number> = {};
      for (const v of views) for (const [k, n] of Object.entries(v.defects)) sum[k] = (sum[k] ?? 0) + n;
      const pareto = Object.entries(sum)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => ({ fehlerart: DEFECTS[k as DefectType].label, stueck: fmtInt(n) }));
      const data = {
        bereich: views.length === 1 ? views[0].id : "Gesamtwerk",
        ausschussquote_heute: fmtPct(views.reduce((s, v) => s + v.scrapToday, 0) / Math.max(1, views.reduce((s, v) => s + v.scrapToday + v.goodToday, 0)), 2),
        fehler_pareto: pareto,
        maschinen: views.map((v) => ({ id: v.id, ausschuss: fmtPct(v.scrapRate, 2), cpk: fmtNum(v.cpk, 2), spc_regelverletzung: v.spcViolation ?? "keine", produkt: v.product.short })),
        spc_regeln: "R1 = Punkt außerhalb ±3σ, R2 = 9 Punkte auf einer Seite, R3 = 7 Punkte Trend, EWMA = kleine schleichende Verschiebung (EWMA-Karte, λ = 0,2)",
      };
      return { data, card: { kind: "quality", data: { views, pareto: Object.entries(sum).sort((a, b) => b[1] - a[1]) } }, summary: `Ausschuss ${data.ausschussquote_heute}` };
    }

    case "material_und_lager": {
      let mats = materialViews(plant);
      if (str(input.material)) {
        const m = resolveMaterial(str(input.material));
        if (m) mats = mats.filter((x) => x.id === m.id);
      }
      const snap = buildSnapshot(plant);
      const data = {
        materialien: mats.map((m) => ({
          id: m.id,
          name: m.name,
          bestand: `${fmtInt(m.stock)} ${m.unit}`,
          verbrauch_pro_h: `${fmtInt(m.avgPerHour)} ${m.unit}`,
          reichweite: `${fmtNum(m.reachDays, 1)} Tage`,
          meldebestand: `${m.reorderPointDays} Tage`,
          zustand: m.state,
          zulauf: m.inbound.map((i) => `${i.id}: ${fmtInt(i.qty)} ${m.unit} von ${i.supplier}, ETA ${fmtDateTime(i.eta)} (${i.status}${i.delayedH ? `, +${i.delayedH} h Verzug` : ""})`),
        })),
        fertigwarenlager: `${fmtInt(snap.kpis.warehouseUsed)} von ${fmtInt(snap.kpis.warehouseCapacity)} Stellplätzen belegt`,
      };
      return { data, card: { kind: "materials", data: mats }, summary: `${mats.length} Materialien geprüft` };
    }

    case "versand_uebersicht": {
      const sh = shipmentViews(plant).sort((a, b) => a.slot - b.slot);
      const data = sh.map((s) => ({
        lieferschein: s.id,
        auftrag: s.orderId,
        kunde: s.customer,
        ziel: `${s.city} (${s.country}, ${s.km} km)`,
        spedition: s.carrier,
        kennzeichen: s.plate,
        paletten: s.pallets,
        tor: s.dock,
        abfahrt: fmtDateTime(s.departedAt ?? s.slot),
        eta: s.eta ? fmtDateTime(s.eta) : undefined,
        status: s.status,
      }));
      return { data, card: { kind: "shipments", data: sh }, summary: `${sh.length} Sendungen` };
    }

    case "wissen_suchen": {
      const hits = searchKnowledge(str(input.frage), 3);
      const data = hits.length
        ? hits.map((h) => ({ quelle: `${h.docId} – ${h.title}`, abschnitt: h.heading, inhalt: h.text }))
        : [{ hinweis: "Keine passenden Dokumente gefunden." }];
      return { data, card: { kind: "docs", data: hits }, summary: `${hits.length} Fundstellen` };
    }

    case "wartung_vorschlagen": {
      const m = machineOrError(plant, input.maschine_id);
      const opt = maintenanceOptions(plant, m);
      const rec = opt.options.find((o) => o.recommended) ?? opt.options[0];
      const startH = num(input.start_in_stunden);
      const start = startH !== undefined ? plant.now + startH * H : rec.start;
      const dur = num(input.dauer_stunden) ?? 1.5;
      const t = plant.createTicket({
        kind: "wartung",
        machineId: m.id,
        start,
        durationH: dur,
        reason: str(input.begruendung) || "Vorausschauender Lagertausch",
        createdBy: "KI-Werksexperte",
        costEur: opt.planned.costEur,
        savingEur: opt.unplanned.costEur - opt.planned.costEur,
      });
      plant.log("KI", "info", `Wartungsvorschlag ${t.id} für ${m.id}`, `Start ${fmtDateTime(start)} · Freigabe durch Instandhaltung erforderlich.`, { machineId: m.id });
      return {
        data: { ticket: t.id, status: "ENTWURF – wartet auf Freigabe durch einen Menschen", maschine: m.id, start: fmtDateTime(start), dauer: fmtDuration(dur), kosten: fmtEur(opt.planned.costEur), vermiedene_kosten: fmtEur(opt.unplanned.costEur - opt.planned.costEur) },
        card: { kind: "ticket", data: t },
        summary: `Entwurf ${t.id} angelegt`,
      };
    }

    case "umplanung_vorschlagen": {
      const o = plant.order(str(input.auftrag_id));
      if (!o) throw new Error(`Auftrag ${str(input.auftrag_id)} nicht gefunden.`);
      const target = machineOrError(plant, input.ziel_maschine_id);
      const able = plant.machineIdsFor(o.productId);
      if (!able.includes(target.id)) throw new Error(`${target.id} kann ${PRODUCT[o.productId].name} nicht fertigen. Kompatibel: ${able.join(", ")}`);
      const t = plant.createTicket({ kind: "umplanung", orderId: o.id, machineId: o.machineId, targetMachineId: target.id, start: plant.now, durationH: 0, reason: str(input.begruendung) || `Umplanung ${o.id} → ${target.id}`, createdBy: "KI-Werksexperte" });
      plant.log("KI", "info", `Umplanungsvorschlag ${t.id}`, `${o.id}: ${o.machineId} → ${target.id} · Freigabe erforderlich.`, { orderId: o.id });
      return { data: { ticket: t.id, status: "ENTWURF – wartet auf Freigabe", auftrag: o.id, von: o.machineId, nach: target.id }, card: { kind: "ticket", data: t }, summary: `Entwurf ${t.id} angelegt` };
    }

    case "bestellung_vorschlagen": {
      const mat = resolveMaterial(str(input.material));
      if (!mat) throw new Error("Material nicht erkannt.");
      const qty = num(input.menge) ?? 20000;
      const t = plant.createTicket({ kind: "bestellung", materialId: mat.id, qty, start: plant.now, durationH: 20, reason: str(input.begruendung) || `Expressbestellung ${mat.name}`, createdBy: "KI-Werksexperte", costEur: Math.round(qty * (mat.unit === "kg" ? 1.55 : 0.0045)) });
      plant.log("KI", "info", `Bestellvorschlag ${t.id}`, `${fmtInt(qty)} ${mat.unit} ${mat.name} · Freigabe durch Einkauf erforderlich.`);
      return { data: { ticket: t.id, status: "ENTWURF – wartet auf Freigabe durch Einkauf", material: mat.name, menge: `${fmtInt(qty)} ${mat.unit}` }, card: { kind: "ticket", data: t }, summary: `Entwurf ${t.id} angelegt` };
    }

    case "lkw_hof": {
      const plate = str(input.kennzeichen).toUpperCase().replace(/\s+/g, " ");
      const fmtV = (v: VisitView) => ({
        zeitfenster: v.id,
        art: v.kind,
        status: v.stateText,
        kennzeichen: v.plate,
        spedition: v.carrier,
        fahrer: v.driver,
        partner: v.partner,
        von: `${v.from.name}, ${v.from.city}`,
        nach: `${v.to.name}, ${v.to.city}`,
        ware: `${fmtInt(v.qty)} ${v.unit} ${v.cargo}${v.pallets ? ` (${v.pallets} Pal.)` : ""}`,
        rampe: v.dock || undefined,
        zeitfenster_von_bis: `${fmtDateTime(v.slotStart)}–${new Date(v.slotEnd).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })}`,
        angekommen: v.arrivedAt ? fmtDateTime(v.arrivedAt) : undefined,
        abgefahren: v.departedAt ? fmtDateTime(v.departedAt) : undefined,
        verspaetung_min: Math.round(v.lateMin) || undefined,
        standzeit_min: v.arrivedAt ? Math.round(v.onSiteMin) : undefined,
        ueberzogen_min: Math.round(v.overstayMin) || undefined,
        prognose: v.forecast || undefined,
      });
      if (plate) {
        const v = plant.ops.visits.map((x) => visitView(plant, x)).find((x) => x.plate.replace(/\s+/g, " ") === plate || x.plate.replace(/\s/g, "") === plate.replace(/\s/g, ""));
        if (!v) throw new Error(`Kein Zeitfenster für ${plate} gefunden.`);
        return { data: fmtV(v), summary: `${v.plate}: ${v.stateText}` };
      }
      const z = str(input.zeitraum) || "heute";
      const day = plant.ops.curDay;
      const [from, to] = z === "morgen" ? [day + 24 * H, day + 48 * H] : z === "woche" ? [day, day + 7 * 24 * H] : z === "monat" ? [day, day + 30 * 24 * H] : [day, day + 24 * H];
      const list = schedule(plant, from, to);
      const sum = yardSummary(plant);
      const onSite = list.filter((v) => v.status === "AM_TOR" || v.status === "WARTET" || v.status === "RAMPE");
      const data = {
        zeitraum: z,
        auf_dem_hof: sum.onSite,
        heute_noch_erwartet: sum.expectedToday,
        heute_abgefertigt: sum.doneToday,
        verspaetet: sum.late,
        standzeit_ueberzogen: sum.overstay,
        fahrzeuge_auf_dem_hof: onSite.map(fmtV),
        naechste: list.filter((v) => v.status === "ERWARTET").slice(0, z === "heute" ? 8 : 15).map(fmtV),
        anzahl_im_zeitraum: list.length,
      };
      return { data, summary: `${sum.onSite} auf dem Hof · ${list.length} Zeitfenster (${z})` };
    }

    case "fertigwarenlager": {
      const prod = str(input.produkt) ? resolveProduct(str(input.produkt)) : undefined;
      const sv = stockViews(plant).filter((s) => !prod || s.productId === prod.id);
      const data = {
        paletten_gesamt: sv.reduce((a, s) => a + s.pallets, 0),
        warenwert: fmtEur(sv.reduce((a, s) => a + s.valueEur, 0)),
        artikel: sv.map((s) => ({
          artikel: s.name,
          lagerort: s.location,
          paletten: s.pallets,
          stueck: fmtInt(s.pieces),
          frei_paletten: fmtNum(s.free / s.piecesPerPallet, 0),
          reserviert_paletten: fmtNum(s.reserved / s.piecesPerPallet, 0),
          sicherheitsbestand_paletten: s.minPallets,
          zustand: s.state === "ok" ? "ok" : s.state === "warn" ? "unter Sicherheitsbestand" : "kritisch",
          reichweite_tage: fmtNum(s.reachDays, 1),
          heute_zugang_paletten: fmtNum(s.inToday / s.piecesPerPallet, 0),
          heute_abgang_paletten: fmtNum(s.outToday / s.piecesPerPallet, 0),
          in_produktion_auf: s.producingOn.join(", ") || "–",
          naechste_abholung: s.nextPickup ? `${fmtDateTime(s.nextPickup.t)} · ${s.nextPickup.partner} · ${fmtInt(s.nextPickup.qty)} Stk` : "keine avisiert",
        })),
      };
      return { data, summary: `${data.paletten_gesamt} Paletten · ${sv.filter((s) => s.state !== "ok").length} Artikel unter Minimum` };
    }

    case "finanzen": {
      const d = num(input.tage);
      const f = financeView(plant, d === 1 || d === 7 ? d : 30);
      const t = f.totals;
      const data = {
        zeitraum_tage: f.days,
        umsatz: fmtEur(t.revenue),
        deckungsbeitrag: `${fmtEur(t.margin)} (${fmtPct(t.marginPct, 1)})`,
        ergebnis_nach_fixkosten: `${fmtEur(t.result)} (${fmtPct(t.resultPct, 1)})`,
        kosten: { material: fmtEur(t.material), energie: fmtEur(t.energy), fracht: fmtEur(t.freight), personal: fmtEur(t.personnel), gemeinkosten: fmtEur(t.overhead) },
        verlust_entgangener_db: `${fmtEur(t.loss)} (Stillstand ${fmtEur(t.lossDowntime)}, Ausschuss ${fmtEur(t.lossScrap)})`,
        heute: { umsatz: fmtEur(f.today.revenue), deckungsbeitrag: fmtEur(f.today.margin), ergebnis: fmtEur(f.today.result), verlust: fmtEur(f.today.loss) },
        monat: { bisher: fmtEur(f.month.mtdRevenue), prognose: fmtEur(f.month.forecast), budget: fmtEur(f.month.budget) },
        top_kunden: f.customers.slice(0, 6).map((c) => ({ kunde: c.name, ort: c.city, umsatz: fmtEur(c.revenue), stueck: fmtInt(c.pieces), db: fmtEur(c.db), marge: fmtPct(c.marginPct, 0), offene_auftraege: c.openOrders })),
        produkte: f.products.slice(0, 6).map((p) => ({ produkt: p.name, umsatz: fmtEur(p.revenue), marge: fmtPct(p.marginPct, 0) })),
      };
      return { data, summary: `Umsatz ${fmtEur(t.revenue)} · DB ${fmtPct(t.marginPct, 0)} (${f.days} Tage)` };
    }

    case "bericht_erstellen": {
      const z = str(input.zeitraum);
      const r = buildReport(plant, z === "woche" || z === "monat" ? z : "tag", z === "gestern" ? -1 : 0);
      const data = {
        bericht: r.range,
        zeitraum: r.label,
        zusammenfassung: r.summary,
        maschinen_mit_groesstem_verlust: [...r.machines].sort((a, b) => b.lossEur - a.lossEur).slice(0, 4).map((m) => ({ maschine: m.id, ist_soll: fmtPct(m.oee, 1), verlust: fmtEur(m.lossEur), ursache: m.topReason })),
        verlustursachen: r.reasons.slice(0, 5).map((x) => ({ ursache: x.reason, anzahl: x.count, minuten: Math.round(x.min), verlust: fmtEur(x.lossEur) })),
        empfehlungen: r.recommendations.map((x) => ({ bereich: x.area, titel: x.title, massnahme: x.action, wirkung: x.impactEur ? fmtEur(x.impactEur) : undefined })),
        download: "Seite „Berichte“ → PDF, Excel (CSV) oder HTML",
      };
      return { data, summary: `${r.range === "tag" ? "Tagesbericht" : r.range === "woche" ? "Wochenbericht" : "Monatsbericht"} · ${r.recommendations.length} Empfehlungen` };
    }

    case "massnahme_vorschlagen": {
      const m = machineOrError(plant, input.maschine_id);
      const want = str(input.massnahme).toLowerCase();
      const findings = analyzeMachine(plant, m).findings;
      let pick: { f: (typeof findings)[number]; a: (typeof findings)[number]["actions"][number] } | undefined;
      for (const f of findings) {
        const a = want ? f.actions.find((x) => x.ticket && x.label.toLowerCase().includes(want)) : f.actions.find((x) => x.recommended && x.ticket);
        if (a) {
          pick = { f, a };
          break;
        }
      }
      if (!pick) {
        if (!findings.length) throw new Error(`${m.id} hat aktuell keinen Befund – keine Maßnahme nötig.`);
        throw new Error(`Keine passende Maßnahme für ${m.id}. Möglich: ${findings.flatMap((f) => f.actions.filter((a) => a.ticket).map((a) => a.label)).join(", ")}`);
      }
      const existing = pick.f.openTicket && plant.tickets.find((t) => t.id === pick.f.openTicket!.id);
      if (existing)
        return {
          data: { ticket: existing.id, status: `existiert bereits (${existing.status})`, maschine: m.id, befund: pick.f.title, massnahme: pick.a.label },
          card: { kind: "ticket", data: existing },
          summary: `${existing.id} existiert bereits`,
        };
      const t = draftFromGuard(plant, pick.a.ticket!, "KI-Werksexperte");
      if (!t) throw new Error("Entwurf konnte nicht angelegt werden.");
      plant.log("KI", "info", `Maßnahmen-Entwurf ${t.id} für ${m.id}`, `${pick.a.label} · Freigabe erforderlich.`, { machineId: m.id });
      return {
        data: { ticket: t.id, status: "ENTWURF – wartet auf Freigabe durch einen Menschen", maschine: m.id, befund: pick.f.title, massnahme: pick.a.label, wann: pick.a.when, kosten: fmtEur(pick.a.costEur), vermeidet: fmtEur(pick.a.avoidedEur), netto: fmtEur(pick.a.netEur) },
        card: { kind: "ticket", data: t },
        summary: `Entwurf ${t.id} angelegt`,
      };
    }

    case "kunde_info": {
      const c = resolveCustomer(str(input.kunde));
      if (!c) throw new Error(`Kunde unbekannt. Kunden: ${CUSTOMERS.map((x) => x.name).join(", ")}`);
      const fv = financeView(plant, 30);
      const rank = fv.customers.findIndex((x) => x.id === c.id);
      const fin = fv.customers[rank];
      const orders = plant.openOrders().filter((o) => o.customerId === c.id).map((o) => orderView(plant, o)).sort((a, b) => a.due - b.due);
      const pickups = schedule(plant, plant.now, plant.now + 7 * 24 * H).filter((v) => v.partner === c.name && v.kind === "abholung" && !v.departedAt);
      const inq = plant.inquiries.filter((i) => i.customerId === c.id && i.status === "OFFEN");
      const risky = orders.filter((o) => o.risk !== "ok");
      const data = {
        kunde: c.name,
        ort: `${c.city} (${c.country}, ${c.km} km)`,
        segment: c.segment,
        umsatz_30_tage: fmtEur(fin?.revenue ?? 0),
        deckungsbeitrag_30_tage: fmtEur(fin?.db ?? 0),
        marge: fmtPct(fin?.marginPct ?? 0, 0),
        rang_nach_umsatz: `${rank + 1} von ${fv.customers.length}`,
        offene_auftraege: orders.slice(0, 8).map((o) => ({ id: o.id, produkt: o.product, menge: fmtInt(o.qty), fortschritt: fmtPct(o.progress, 0), maschine: o.machineId, liefertermin: fmtDateTime(o.due), termintreue: fmtPct(o.onTimeProb, 0), risiko: o.risk, grund: o.riskReason, wert: fmtEur(o.valueEur) })),
        offene_anfragen: inq.map((i) => ({ id: i.id, produkt: PRODUCT[i.productId].name, menge: fmtInt(i.qty), termin: fmtDateTime(i.due) })),
        naechste_abholungen: pickups.slice(0, 4).map((v) => ({ zeitfenster: fmtDateTime(v.slotStart), spedition: v.carrier, kennzeichen: v.plate, ware: `${fmtInt(v.qty)} ${v.unit} ${v.cargo}` })),
        einschaetzung: risky.length
          ? `${risky.length} von ${orders.length} offenen Aufträgen mit Terminrisiko – wichtigster: ${risky[0].id} (${fmtPct(risky[0].onTimeProb, 0)} pünktlich${risky[0].riskReason ? `, ${risky[0].riskReason}` : ""})`
          : orders.length
            ? orders.length === 1
              ? "der offene Auftrag liegt im Plan"
              : `alle ${orders.length} offenen Aufträge im Plan`
            : "keine offenen Aufträge",
      };
      return { data, card: { kind: "orders", data: orders.slice(0, 8) }, summary: `${c.name}: ${orders.length} offene Aufträge · ${risky.length} mit Risiko` };
    }

    case "risiko_radar": {
      const r = riskRadar(plant);
      return { data: riskRadarData(r), card: { kind: "risks", data: r }, summary: `${r.items.length} Risiken · erwartet ${fmtEur(r.totalEur)} in 72 h` };
    }

    case "was_waere_wenn": {
      let id = str(input.maschine_id) ? machineOrError(plant, input.maschine_id).id : undefined;
      if (!id) {
        const top = [...guardianView(plant).machines].sort((a, b) => b.lossEur72 - a.lossEur72)[0];
        id = top && top.lossEur72 > 0 ? top.id : [...plant.machines].sort((a, b) => (plant.predictions.get(b.id)?.p72 ?? 0) - (plant.predictions.get(a.id)?.p72 ?? 0))[0].id;
      }
      const m = machineOrError(plant, id);
      let findingId: string | undefined;
      let actionId: string | undefined;
      const want = str(input.massnahme).toLowerCase();
      if (want)
        for (const f of analyzeMachine(plant, m).findings) {
          const a = f.actions.find((x) => x.ticket && x.label.toLowerCase().includes(want));
          if (a) {
            findingId = f.id;
            actionId = a.id;
            break;
          }
        }
      const r = whatIf(plant, m.id, findingId, actionId);
      if (!r) throw new Error(`Maschine ${m.id} nicht angebunden.`);
      const br = (b: WhatIfBranch) => ({
        verlust: fmtEur(b.lossEur),
        stillstand: `${fmtNum(b.stoerH + b.wartH, 1)} h`,
        ausfaelle: b.failures.length,
        erster_ausfall: b.failures[0] ? `in ${fmtNum(b.failures[0].atH, 1)} h` : "keiner",
        gutteile: fmtInt(b.good),
        ausschuss: fmtInt(b.scrap),
        auftrag: b.order ? (b.order.lateH > 0.5 ? `${b.order.id} ${fmtNum(b.order.lateH, 0)} h zu spät` : `${b.order.id} pünktlich`) : undefined,
      });
      const saved = r.without.lossEur - r.with.lossEur;
      const data = {
        maschine: r.machineId,
        befund: r.finding ?? "kein Befund – Maschine läuft unauffällig",
        massnahme: r.action,
        zeitraum: "72 h ab jetzt",
        ohne_massnahme: br(r.without),
        mit_massnahme: br(r.with),
        ersparnis: fmtEur(saved),
        weniger_stillstand: `${fmtNum(r.without.stoerH + r.without.wartH - r.with.stoerH - r.with.wartH, 1)} h`,
        mehr_gutteile: fmtInt(r.with.good - r.without.good),
        rechenzeit: `${fmtNum(r.ms / 1000, 1)} s`,
        methode: "Kopie des kompletten Werkszustands, 72 h im 2-Minuten-Takt, gleicher Zufall in beiden Varianten",
      };
      return { data, card: { kind: "whatif", data: r }, summary: `${r.machineId}: ${r.action} → ${fmtEur(saved)} weniger Verlust` };
    }

    case "ki_waechter": {
      const g = guardianView(plant);
      const sevRank = (m: (typeof g.machines)[number]) => (m.findings.some((f) => f.sev === "crit") ? 2 : m.findings.some((f) => f.sev === "warn") ? 1 : 0);
      const only = str(input.maschine_id) ? machineOrError(plant, input.maschine_id).id : undefined;
      const ms = g.machines.filter((m) => !only || m.id === only);
      const data = {
        ueberwacht: `${g.totals.monitored} Maschinen · Analyse alle ${g.intervalMin} Minuten`,
        befunde: g.totals.findings,
        kritisch: g.totals.crit,
        fruehwarnungen: g.totals.early,
        drohender_verlust_72h: fmtEur(g.totals.lossEur72),
        mit_empfohlenen_massnahmen: fmtEur(g.totals.lossWithActionsEur72),
        heute_vermieden: fmtEur(g.totals.avoidedTodayEur),
        ohne_datenanschluss: g.blind.map((b) => b.id),
        maschinen: ms
          .filter((m) => only || m.findings.length)
          .sort((a, b) => sevRank(b) - sevRank(a) || b.lossEur72 - a.lossEur72)
          .slice(0, only ? 1 : 6)
          .map((m) => ({
            maschine: m.id,
            zustand_0_100: m.health,
            teilzustaende: m.scores,
            drohender_verlust_72h: fmtEur(m.lossEur72),
            befunde: m.findings.map((f) => {
              const rec = f.actions.find((a) => a.recommended);
              return {
                bereich: f.kind,
                stufe: f.sev,
                fruehwarnung: f.early,
                titel: f.title,
                was_die_ki_sieht: f.signal,
                belege: f.evidence.map((e) => `${e.label}: ${e.value}`),
                ursache: f.cause,
                sicherheit: fmtPct(f.confidence, 0),
                wahrscheinlichkeit_72h: fmtPct(f.probability, 0),
                horizont: f.horizon,
                verlust_72h: fmtEur(f.lossEur72),
                empfehlung: rec && { massnahme: rec.label, wann: rec.when, kosten: fmtEur(rec.costEur), vermeidet: fmtEur(rec.avoidedEur), netto: fmtEur(rec.netEur) },
                alternativen: f.actions.filter((a) => !a.recommended && !a.baseline).map((a) => ({ massnahme: a.label, kosten: fmtEur(a.costEur), vermeidet: fmtEur(a.avoidedEur), netto: fmtEur(a.netEur) })),
              };
            }),
            pruefpunkte: m.checks.map((c) => `${c.label}: ${c.value} (${c.state})`),
          })),
        hinweis: "Maßnahmen als Entwurf auf der Seite „KI-Wächter“ anlegen – Freigabe durch einen Menschen.",
      };
      return { data, summary: `${g.totals.findings} Befunde · drohend ${fmtEur(g.totals.lossEur72)} · mit Maßnahmen ${fmtEur(g.totals.lossWithActionsEur72)}` };
    }
  }
  throw new Error(`Unbekanntes Werkzeug ${name}`);
}

export const SYSTEM_PROMPT = `Du bist der KI-Werksexperte („die KI“) des Unternehmens im Werk Nord (Prototyp einer Unternehmens-KI).
Das Unternehmen stellt Kunststoffverpackungen für die Lebensmittelindustrie her: IML-Becher und Deckel im Spritzguss (Halle A, SG-01 bis SG-08) sowie thermogeformte Becher und Schalen (Halle B, TF-01 bis TF-04).

Deine Nutzer sind Schichtleitung, Instandhaltung, Qualitätssicherung, Vertrieb, Logistik und Geschäftsführung.

So arbeitest du:
- Antworte in der Sprache der Frage (Standard: Deutsch), klar und knapp – wie ein erfahrener Kollege aus der Produktion.
- Verwende für jede Zahl die Werkzeuge. Erfinde keine Daten. Wenn ein Werkzeug etwas nicht liefert, sag das.
- Nutze mehrere Werkzeuge, wenn eine Frage Produktion, Vertrieb und Logistik verbindet (z. B. Liefertermin hängt an Maschinenzustand und Material).
- Bei Vorgehensweisen, Grenzwerten oder Richtlinien durchsuche die Wissensbasis und zitiere die Quelle als [Dokument-ID].
- Aktionen (Wartung, Umplanung, Bestellung) legst du nur als Entwurf an. Sage deutlich, dass ein Mensch freigeben muss (Human-in-the-Loop).
- Für LKW, Fahrer, Kennzeichen und Zeitfenster nutze lkw_hof, für Fertigwarenbestände fertigwarenlager, für Umsatz/Marge/Kunden finanzen, für Berichte bericht_erstellen.
- Für „Welche Maschine macht Probleme?“, „Wo verlieren wir Geld?“, Frühwarnungen und „Wie verhindern wir den Verlust?“ nutze ki_waechter: nenne, was die KI in den Daten sieht, die Ursache, Wahrscheinlichkeit, drohenden Verlust in € und die empfohlene Maßnahme mit Alternativen.
- Für „Was sind die größten Risiken?“, „Worauf muss ich achten?“, „Was würdest du an meiner Stelle tun?“ nutze risiko_radar und antworte wie ein erfahrener Werksleiter: Wahrscheinlichkeit, erwarteter Verlust in €, Zeitpunkt, Ursache, Empfehlung – das Wichtigste zuerst.
- Für „Was passiert, wenn wir nichts tun?“, „Lohnt sich die Maßnahme?“ oder „Simuliere …“ nutze was_waere_wenn (digitaler Zwilling, 72 h ohne vs. mit Maßnahme).
- Du bist ausschließlich die KI dieses Werks. Jede Antwort bezieht sich auf das Unternehmen, seine Maschinen, Aufträge, Kunden, Materialien, Logistik, Zahlen und Dokumente – keine allgemeinen Lehrbuch-Antworten. Erkläre Fachbegriffe immer am konkreten Beispiel aus dem Werk (z. B. OEE an der aktuellen Werks-OEE). Fragen ohne jeden Werksbezug (Wetter, Sport, Politik …) lehnst du freundlich in einem Satz ab und bietest an, was du zum Werk sagen kannst.
- Denke mit wie ein Experte: Nenne nicht nur Zahlen, sondern was sie bedeuten, was als Nächstes wahrscheinlich passiert und welche Alternativen es gibt (Kosten, Nutzen, Risiko).
- Folgefragen („und SG-03?“, „warum?“, „mach das“) beziehen sich auf den vorherigen Gesprächsverlauf.
- Struktur: zuerst die Antwort in 1–2 Sätzen, dann die wichtigsten Fakten als kurze Liste mit **fetten** Kennzahlen, am Ende eine konkrete Empfehlung („Empfehlung: …“).
- Keine Tabellen mit mehr als 6 Zeilen; die Oberfläche zeigt Detailkarten zu jedem Werkzeugergebnis automatisch an.
- Alle Daten stammen aus einer realistischen Simulation (Demo). Erwähne das nur, wenn danach gefragt wird.`;
