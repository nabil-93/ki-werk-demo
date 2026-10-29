// Anforderungs-Übersetzer: Fachbereichs-Anliegen (Freitext) -> technisches Lösungskonzept.
// Genau die Rolle "Schnittstelle zwischen IT und Fachabteilungen" aus der Stellenanzeige.

import Anthropic from "@anthropic-ai/sdk";
import { MODEL, hasCredentials } from "./agent";

export interface Spec {
  titel: string;
  fachbereich: string;
  problem: string;
  ziel: string;
  user_story: string;
  kpis: { kpi: string; ist: string; ziel: string }[];
  datenquellen: { system: string; daten: string; zugriff: string }[];
  ki_ansatz: { methode: string; begruendung: string; alternative: string };
  mvp_schritte: { phase: string; inhalt: string; dauer: string }[];
  aufwand_personentage: number;
  risiken: { risiko: string; massnahme: string }[];
  akzeptanzkriterien: string[];
  datenschutz_governance: string;
  nutzen: number;
  machbarkeit: number;
  rueckfragen: string[];
}

const str = { type: "string" };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items: unknown) => ({ type: "array", items });

const SCHEMA = obj({
  titel: str,
  fachbereich: str,
  problem: str,
  ziel: str,
  user_story: str,
  kpis: arr(obj({ kpi: str, ist: str, ziel: str })),
  datenquellen: arr(obj({ system: str, daten: str, zugriff: str })),
  ki_ansatz: obj({ methode: str, begruendung: str, alternative: str }),
  mvp_schritte: arr(obj({ phase: str, inhalt: str, dauer: str })),
  aufwand_personentage: { type: "integer" },
  risiken: arr(obj({ risiko: str, massnahme: str })),
  akzeptanzkriterien: arr(str),
  datenschutz_governance: str,
  nutzen: { type: "integer" },
  machbarkeit: { type: "integer" },
  rueckfragen: arr(str),
});

const SYSTEM = `Du bist Requirements Engineer für KI-Projekte im Unternehmen (Kunststoffverpackungen für die Lebensmittelindustrie, Werk Nord: IML-Spritzguss und Thermoformen, ca. 800 Mitarbeitende).
Übersetze ein Anliegen aus einer Fachabteilung (Produktion, Instandhaltung, Qualität, Vertrieb, Logistik, Einkauf, Geschäftsführung) in ein knappes, umsetzbares technisches Lösungskonzept.
Verfügbare Systeme: SAP S/4HANA (ERP), MES/BDE, OPC-UA-Gateway (EUROMAP 77), CAQ, Lagerverwaltung, Speditionsportal, CRM, CMMS (Instandhaltung), SharePoint/DMS.
Regeln: realistisch für einen Mittelständler, mit kleinem MVP beginnen (4–8 Wochen), KI nur wo sie echten Mehrwert hat (sonst ehrlich klassische Lösung empfehlen), Human-in-the-Loop, DSGVO und Betriebsrat beachten, keine Leistungsüberwachung einzelner Beschäftigter.
Nutzen und Machbarkeit als Ganzzahl 1–5. Schreibe auf Deutsch, präzise, ohne Marketing-Sprache. 3–4 KPIs, 3–5 Datenquellen, 3–4 MVP-Phasen, 3 Risiken, 4–5 Akzeptanzkriterien, 2–3 Rückfragen an den Fachbereich.`;

export async function translateRequirement(text: string): Promise<{ spec: Spec; mode: "claude" | "offline"; note?: string }> {
  if (hasCredentials()) {
    try {
      const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 12000,
        system: SYSTEM,
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        messages: [{ role: "user", content: `Anliegen aus dem Fachbereich:\n"""${text}"""` }],
      });
      const block = res.content.find((b) => b.type === "text");
      if (res.stop_reason === "refusal" || !block || block.type !== "text") throw new Error("Keine Antwort");
      return { spec: JSON.parse(block.text) as Spec, mode: "claude" };
    } catch (e) {
      return { spec: offlineSpec(text), mode: "offline", note: `Claude nicht verfügbar (${(e as Error).message}) – Vorlage verwendet.` };
    }
  }
  return { spec: offlineSpec(text), mode: "offline" };
}

// ---------------- Offline-Vorlagen ----------------

function offlineSpec(text: string): Spec {
  const t = text.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  if (has("kaputt", "ausfall", "wartung", "lager", "früher wissen", "stillstand", "maschine"))
    return {
      titel: "Vorausschauende Wartung für Spritzgieß- und Thermoformmaschinen",
      fachbereich: "Instandhaltung / Produktion",
      problem: "Ungeplante Maschinenausfälle (z. B. Lagerschäden) verursachen Stillstand, Eilteile und Lieferverzug. Heute wird erst reagiert, wenn die Maschine steht.",
      ziel: "Ausfälle 24–72 h vorher erkennen und Wartung in Schichtwechsel oder Rüstvorgänge legen.",
      user_story: "Als Schichtleiter der Instandhaltung möchte ich frühzeitig gewarnt werden, wenn eine Maschine auf einen Ausfall zusteuert, damit ich den Eingriff planen kann, statt nachts reagieren zu müssen.",
      kpis: [
        { kpi: "Ungeplante Stillstandsstunden / Monat", ist: "ca. 38 h", ziel: "−40 %" },
        { kpi: "Vorwarnzeit vor Ausfall", ist: "0 h", ziel: "≥ 24 h" },
        { kpi: "Fehlalarme je Woche", ist: "–", ziel: "≤ 2" },
        { kpi: "OEE Halle A", ist: "82 %", ziel: "85 %" },
      ],
      datenquellen: [
        { system: "OPC-UA-Gateway (EUROMAP 77)", daten: "Schwingung, Temperaturen, Druck, Zykluszeit, Leistung", zugriff: "Streaming 1 s, Edge-Aggregation 5 min" },
        { system: "CMMS", daten: "Wartungshistorie, Schadensbilder, Ersatzteile", zugriff: "REST, täglicher Export" },
        { system: "MES/BDE", daten: "Maschinenstatus, Stillstandsgründe", zugriff: "REST/Webhooks" },
        { system: "SAP PM (optional)", daten: "Instandhaltungsaufträge, Kosten", zugriff: "OData" },
      ],
      ki_ansatz: {
        methode: "Zeitreihen-Merkmale (Pegel, Trend, Streuung) + Klassifikationsmodell (Start: logistische Regression, später Gradient Boosting) mit Restlaufzeit-Schätzung",
        begruendung: "Erklärbar, wenig Daten nötig, Treiber direkt für Instandhalter verständlich; Grenzwerte nach ISO 10816 als Rückfallebene.",
        alternative: "Reine Grenzwertüberwachung ohne ML – günstiger, aber ohne Vorwarnzeit.",
      },
      mvp_schritte: [
        { phase: "1. Daten anbinden", inhalt: "OPC UA für 2 Pilotmaschinen, Speicherung im Data Lake", dauer: "2 Wochen" },
        { phase: "2. Labeln & Modell", inhalt: "Ausfälle aus CMMS zuordnen, Merkmale berechnen, Modell trainieren", dauer: "2 Wochen" },
        { phase: "3. Pilotbetrieb", inhalt: "Warnungen im Cockpit, Feedback der Instandhaltung", dauer: "4 Wochen" },
        { phase: "4. Rollout", inhalt: "Alle 12 Maschinen, Anbindung CMMS-Auftrag per Freigabe", dauer: "3 Wochen" },
      ],
      aufwand_personentage: 45,
      risiken: [
        { risiko: "Zu wenige historische Ausfälle zum Lernen", massnahme: "Mit Grenzwerten + Anomalieerkennung starten, Labels laufend ergänzen" },
        { risiko: "Fehlalarme senken Akzeptanz", massnahme: "Schwellwert gemeinsam mit Instandhaltung kalibrieren, Feedback-Knopf" },
        { risiko: "Ältere Maschinen ohne Sensorik", massnahme: "Nachrüst-Schwingungssensoren (ca. 400 € je Lager)" },
      ],
      akzeptanzkriterien: [
        "Warnung mindestens 24 h vor ≥ 70 % der Lagerausfälle im Pilot",
        "Jede Warnung nennt die 3 wichtigsten Einflussfaktoren",
        "Wartungsauftrag wird nur nach Freigabe im CMMS angelegt",
        "Dashboard-Aktualisierung ≤ 5 Minuten",
      ],
      datenschutz_governance: "Nur Maschinendaten, keine personenbezogenen Daten. Betriebsrat informieren, da Schichtplanung betroffen sein kann. Kein Hochrisiko-System nach AI Act.",
      nutzen: 5,
      machbarkeit: 4,
      rueckfragen: ["Welche Maschinen hatten in den letzten 2 Jahren die meisten Lagerschäden?", "Gibt es eine Ausfallhistorie im CMMS mit Datum und Ursache?", "Wer soll die Warnungen erhalten – Schichtleitung oder Instandhaltung?"],
    };
  if (has("liefertermin", "kunde fragt", "wann kommt", "zusage", "anfrage", "vertrieb"))
    return {
      titel: "Liefertermin-Auskunft und Machbarkeitsprüfung für den Vertrieb",
      fachbereich: "Vertrieb / Innendienst",
      problem: "Kundenanfragen zu Lieferterminen und Eilaufträgen erfordern heute Rückfragen bei Fertigungssteuerung, Lager und Versand – Antwortzeit oft ein halber Tag.",
      ziel: "Belastbare Lieferzusage in unter 5 Minuten, inklusive Auswirkungen auf andere Aufträge.",
      user_story: "Als Vertriebsinnendienst möchte ich bei einer Kundenanfrage sofort sehen, ob Menge und Termin machbar sind, damit ich dem Kunden noch im Telefonat eine verbindliche Antwort geben kann.",
      kpis: [
        { kpi: "Antwortzeit auf Terminanfragen", ist: "4–6 h", ziel: "< 5 min" },
        { kpi: "Liefertreue", ist: "96,7 %", ziel: "98 %" },
        { kpi: "Rückfragen an Fertigungssteuerung / Woche", ist: "ca. 60", ziel: "−70 %" },
      ],
      datenquellen: [
        { system: "SAP S/4HANA", daten: "Aufträge, Kunden, Materialbestand, Zulauf", zugriff: "OData v4" },
        { system: "MES", daten: "Maschinenbelegung, Taktzeiten, Status", zugriff: "REST" },
        { system: "Speditionsportal", daten: "Transportzeiten, Ladeslots", zugriff: "API" },
        { system: "KI-Wartungsprognose", daten: "Ausfallrisiko je Maschine", zugriff: "intern" },
      ],
      ki_ansatz: {
        methode: "Regelbasierte Kapazitätsrechnung (Capable-to-Promise) + Termintreue-Wahrscheinlichkeit; Sprachassistent (LLM mit Werkzeugen) als Oberfläche",
        begruendung: "Die Rechnung selbst muss nachvollziehbar und deterministisch sein; das Sprachmodell übersetzt nur Frage und Ergebnis.",
        alternative: "SAP-Standard ATP – prüft Material, aber nicht Maschinenzustand und Ausfallrisiko.",
      },
      mvp_schritte: [
        { phase: "1. Datenmodell", inhalt: "Aufträge, Maschinen, Takte zusammenführen", dauer: "2 Wochen" },
        { phase: "2. CTP-Logik", inhalt: "Kapazität, Material, Transport, Vorziehen mit Auswirkungen", dauer: "2 Wochen" },
        { phase: "3. Oberfläche (Chat & Telefon)", inhalt: "Frage in natürlicher Sprache, Ergebnis mit Plan", dauer: "2 Wochen" },
      ],
      aufwand_personentage: 35,
      risiken: [
        { risiko: "Stammdaten (Taktzeiten, Kavitäten) ungenau", massnahme: "Ist-Takte aus MES statt Soll-Werten verwenden" },
        { risiko: "Zusagen ohne Rücksprache", massnahme: "Zusage erst nach Freigabe durch Vertriebsleitung bei Konflikten" },
        { risiko: "Akzeptanz im Vertrieb", massnahme: "Pilot mit 2 Key-Account-Managern" },
      ],
      akzeptanzkriterien: [
        "Antwort für 90 % der Anfragen in < 1 Minute",
        "Abweichung Prognose zu Ist-Lieferung < 8 h",
        "Auswirkungen auf andere Aufträge werden angezeigt",
        "Keine automatische Zusage ohne Bestätigung",
      ],
      datenschutz_governance: "Kunden- und Auftragsdaten bleiben im Unternehmen (EU-Hosting bzw. On-Premise). Rollenbasierter Zugriff wie in SAP.",
      nutzen: 4,
      machbarkeit: 4,
      rueckfragen: ["Welche Kunden fragen am häufigsten kurzfristig an?", "Wer darf Zusagen bei Konflikten freigeben?"],
    };
  if (has("qualität", "fehler", "ausschuss", "kamera", "reklamation", "etikett"))
    return {
      titel: "KI-gestützte Qualitätsprüfung mit Inline-Kamera und SPC-Frühwarnung",
      fachbereich: "Qualitätssicherung",
      problem: "Fehler wie Etikettenversatz oder schwarze Punkte werden teils erst bei Stichproben oder Reklamationen erkannt; ganze Paletten müssen nachsortiert werden.",
      ziel: "100-%-Prüfung inline und Frühwarnung bei Prozessdrift, bevor Ausschuss entsteht.",
      user_story: "Als Qualitätsingenieurin möchte ich sofort sehen, wenn ein Merkmal driftet, damit wir eingreifen, bevor fehlerhafte Becher in den Versand gehen.",
      kpis: [
        { kpi: "Reklamationen (ppm)", ist: "ca. 120 ppm", ziel: "< 50 ppm" },
        { kpi: "Ausschussquote", ist: "0,8 %", ziel: "0,6 %" },
        { kpi: "Zeit bis Fehlererkennung", ist: "bis 2 h", ziel: "< 5 min" },
      ],
      datenquellen: [
        { system: "Inline-Kamera", daten: "Bilder je Becher, Prüfergebnis", zugriff: "GigE Vision / Edge-PC" },
        { system: "CAQ", daten: "Prüfmerkmale, Stichproben, Toleranzen", zugriff: "SQL-Replikation" },
        { system: "MES", daten: "Maschine, Auftrag, Los", zugriff: "REST" },
      ],
      ki_ansatz: {
        methode: "Klassische Bildverarbeitung (Golden-Sample-Vergleich) + CNN-Klassifikation der Fehlerart; SPC-Regeln (Western Electric) für Drift",
        begruendung: "Golden-Sample braucht kaum Trainingsdaten; CNN unterscheidet Fehlerarten für die Ursachenanalyse.",
        alternative: "Nur SPC auf Stichproben – günstiger, aber keine 100-%-Prüfung.",
      },
      mvp_schritte: [
        { phase: "1. Bilddaten sammeln", inhalt: "1 Kamera an einer IML-Linie, 2 Wochen Bilder + Labels", dauer: "3 Wochen" },
        { phase: "2. Modell & Schwellwerte", inhalt: "Fehlerklassen trainieren, Fehlausschleusung messen", dauer: "3 Wochen" },
        { phase: "3. Integration", inhalt: "Ausschleusung, CAQ-Buchung, Alarm an Linie", dauer: "2 Wochen" },
      ],
      aufwand_personentage: 50,
      risiken: [
        { risiko: "Reflexionen auf glänzenden Bechern", massnahme: "Diffuse Beleuchtung, Polfilter" },
        { risiko: "Zu viele Pseudofehler", massnahme: "Schwellwert pro Dekor, Nachprüfplatz" },
        { risiko: "Taktzeit < 4 s", massnahme: "Inferenz auf Edge-GPU" },
      ],
      akzeptanzkriterien: ["Erkennungsrate ≥ 98 % für Etikettenversatz", "Pseudofehlerrate ≤ 0,5 %", "Prüfung innerhalb der Taktzeit", "Lückenlose Zuordnung zu Los und Maschine"],
      datenschutz_governance: "Kameras erfassen nur Produkte, keine Personen (Bildausschnitt). Abstimmung mit Betriebsrat zur Kamerapositionierung.",
      nutzen: 4,
      machbarkeit: 3,
      rueckfragen: ["Welche Fehlerart verursacht die meisten Reklamationen?", "Gibt es bereits Kameras an den Linien?"],
    };
  return {
    titel: "Automatisierter Bericht statt manueller Excel-Auswertung",
    fachbereich: "Fachbereich (allgemein)",
    problem: `Anliegen: „${text.slice(0, 160)}${text.length > 160 ? "…" : ""}“ – Informationen werden heute manuell aus mehreren Systemen zusammengetragen.`,
    ziel: "Automatisch aktualisierte Auswertung mit klaren Kennzahlen und Rückfragen per Sprachassistent.",
    user_story: "Als Mitarbeiter im Fachbereich möchte ich die benötigten Kennzahlen jederzeit aktuell sehen, damit ich keine Zeit mit dem Zusammenkopieren verliere.",
    kpis: [
      { kpi: "Aufwand je Bericht", ist: "ca. 3 h / Woche", ziel: "< 15 min" },
      { kpi: "Aktualität", ist: "wöchentlich", ziel: "stündlich" },
      { kpi: "Fehler durch Copy & Paste", ist: "gelegentlich", ziel: "0" },
    ],
    datenquellen: [
      { system: "SAP S/4HANA", daten: "Stammdaten, Aufträge", zugriff: "OData" },
      { system: "MES", daten: "Produktionsdaten", zugriff: "REST" },
      { system: "Excel/SharePoint", daten: "bestehende Auswertungen", zugriff: "Graph API" },
    ],
    ki_ansatz: { methode: "Zunächst klassische Datenintegration + Dashboard; LLM-Assistent für Fragen in natürlicher Sprache", begruendung: "Der größte Hebel ist die automatische Datenzusammenführung – KI ergänzt die Bedienung.", alternative: "Power-BI-Bericht ohne KI" },
    mvp_schritte: [
      { phase: "1. Anforderungs-Workshop", inhalt: "Kennzahlen, Empfänger, Häufigkeit klären", dauer: "1 Woche" },
      { phase: "2. Datenpipeline", inhalt: "Quellen anbinden, Datenqualität prüfen", dauer: "2 Wochen" },
      { phase: "3. Dashboard + Assistent", inhalt: "Visualisierung, Fragefunktion", dauer: "2 Wochen" },
    ],
    aufwand_personentage: 20,
    risiken: [
      { risiko: "Unklare Kennzahldefinitionen", massnahme: "Glossar mit Fachbereich abstimmen" },
      { risiko: "Datenqualität in Quellsystemen", massnahme: "Plausibilitätsprüfungen in der Pipeline" },
      { risiko: "Schatten-Excel bleibt bestehen", massnahme: "Altbericht nach Abnahme abschalten" },
    ],
    akzeptanzkriterien: ["Alle Kennzahlen stimmen mit Stichprobe überein", "Aktualisierung automatisch", "Fachbereich nutzt Bericht 4 Wochen ohne Excel"],
    datenschutz_governance: "Zugriff nur für berechtigte Rollen; keine personenbezogenen Leistungsdaten.",
    nutzen: 3,
    machbarkeit: 5,
    rueckfragen: ["Welche Entscheidung soll mit dem Bericht getroffen werden?", "Wer nutzt ihn und wie oft?", "Aus welchen Dateien/Systemen kommen die Daten heute?"],
  };
}
