// Offline-Modus: regelbasierter Agent mit denselben Werkzeugen und Daten wie der LLM-Agent.
// Sorgt dafür, dass die Demo auch ohne Internet oder API-Schlüssel funktioniert – im Chat und am KI-Telefon.
// Er versteht Folgefragen („und SG-03?“, „warum?“, „mach das“) über den Gesprächsverlauf und beantwortet
// jede Frage mit Bezug zum Werk: Fachbegriffe am aktuellen Werksbeispiel, fremde Themen mit freundlichem Hinweis.

import { alternativeMachines, maintenanceOptions } from "../sim/analysis";
import { CUSTOMERS, ENERGY_EUR_PER_KWH, PHASE2_SEED, PRODUCT, PRODUCTS } from "../sim/catalog";
import type { Plant } from "../sim/engine";
import type { AgentEvent, ChatTurn } from "./events";
import { TOOL_META, resolveProduct, runTool, type ToolOutput } from "./tools";
import { fmtEur, fmtInt, fmtNum } from "./format";
import { normalizeSpoken, plainText, toSpeech } from "./speech";

type Step = { name: string; input: Record<string, unknown> };
type Plan = { steps: Step[]; intent: string; term?: string };
type Out = { name: string; out?: ToolOutput; error?: string };

// ---------------- Erkennung von Maschinen, Aufträgen, Kunden ----------------

function detectMachine(q: string) {
  const m = q.toUpperCase().match(/\b(SG|TF)[\s-]?(0?[1-9]|1[0-4])\b/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}` : undefined;
}

function detectOrder(q: string) {
  return q.toUpperCase().match(/FA-\d{4,6}/)?.[0];
}

const GENERIC = new Set(["molkerei", "feinkost", "gmbh", "desserts", "dairy", "a.s.", "b.v.", "des", "prés"]);
function detectCustomer(q: string) {
  const t = q.toLowerCase();
  return CUSTOMERS.find((c) =>
    c.name
      .toLowerCase()
      .split(/\s+/)
      .some((w) => w.length > 3 && !GENERIC.has(w) && t.includes(w)),
  );
}

const MATERIAL_WORDS: [RegExp, string][] = [
  [/etikett/, "M-IML"],
  [/folie|ps-folie|pp-folie/, "M-PSF"],
  [/masterbatch|farbe/, "M-MB"],
  [/homopolymer|deckel-granulat/, "M-PPH"],
  [/granulat|copolymer|rohstoff/, "M-PPR"],
];
const detectMaterial = (t: string) => MATERIAL_WORDS.find(([re]) => re.test(t))?.[1];

// ---------------- Gesprächskontext ----------------

interface Ctx {
  prevQ?: string;
  prevIntent?: string;
  machine?: string;
  order?: string;
  customer?: string;
  material?: string;
}

function context(plant: Plant, history: ChatTurn[]): Ctx {
  const turns = history.slice(-10);
  const ctx: Ctx = {};
  for (let i = turns.length - 1; i >= 0; i--) {
    const c = normalizeSpoken(turns[i].content);
    if (turns[i].role === "user" && !ctx.prevQ) ctx.prevQ = c;
    ctx.machine ??= detectMachine(c);
    ctx.order ??= detectOrder(c);
    ctx.customer ??= detectCustomer(c)?.name;
    ctx.material ??= turns[i].role === "user" ? detectMaterial(c.toLowerCase()) : undefined;
    if (ctx.prevQ && ctx.machine && ctx.order) break;
  }
  if (ctx.prevQ) ctx.prevIntent = plan(plant, ctx.prevQ, {}).intent;
  return ctx;
}

const FOLLOW =
  /^(und|aber|also|ok|okay|gut|ja|nein|warum|wieso|weshalb|woher|wie kommst|was heißt|was heisst|was bedeutet das|erklär|genauer|mehr|details|dann)\b|\b(sie|ihr|ihm|ihn|diese[rmns]?|dort|dafür|dafuer|davon|damit|darüber|dazu|das|es)\b/;
const CONFIRM =
  /^(ja|jo|jep|jawohl|okay|ok|gut|passt|einverstanden|genau|mach|dann mach|leg|plan|plane|bereite|bitte (mach|leg|plan|anlegen|einplanen|umsetzen))\b|\b(mach (das|es|bitte)|leg (das|es|ihn|sie)? ?an|anlegen|einplanen|plane (das|es|sie|ihn) ein|bereite (das|es)? ?vor|vorbereiten|umsetzen|beauftragen)\b/;
const WHY = /^(warum|wieso|weshalb|woher|wie kommst du)|\b(warum|wieso|weshalb|woher weißt|woher weisst|begründ|erklär|ursache)/;
const WHATIF = /was passiert,? wenn|was wäre,? wenn|was waere,? wenn|nichts (tun|machen|unternehmen)|simulier|lohnt sich|durchrechn|zukunft|was bringt (die|das|eine)/;
const OFFTOPIC =
  /\b(wetter|regnet|fußball|fussball|bundesliga|champions league|rezept|kochen|witz|hauptstadt|präsident|praesident|bundeskanzler|politik|wahlen|kinofilm|netflix|musik|lied|songtext|urlaub|bitcoin|krypto|aktienkurs|börse|horoskop|gedicht|liebesbrief)\b/;

const TERMS: [RegExp, string][] = [
  [/\boee\b|gesamtanlageneffektiv/, "oee"],
  [/\bcpk\b|prozessfähigkeit|prozessfaehigkeit/, "cpk"],
  [/\bewma\b/, "spc"],
  [/\bspc\b|regelkarte|statistische prozess/, "spc"],
  [/\brul\b|restlaufzeit/, "rul"],
  [/\biml\b|in-mould|in mould|inmould/, "iml"],
  [/iso[\s-]?10816|schwingungszone/, "iso"],
  [/predictive maintenance|vorausschauende wartung/, "pm"],
  [/digitale[rn]? zwilling|digital twin/, "zwilling"],
  [/deckungsbeitrag/, "db"],
  [/liefertreue|otif/, "liefertreue"],
  [/human[\s-]in[\s-]the[\s-]loop/, "hitl"],
];

// ---------------- Planung ----------------

function plan(plant: Plant, raw: string, ctx: Ctx): Plan {
  const q = normalizeSpoken(raw);
  const t = q.toLowerCase();
  const words = t.split(/\s+/).filter(Boolean).length;
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  const explicitMachine = detectMachine(q);
  const fa = detectOrder(q);
  const customer = detectCustomer(q);
  const explicit = Boolean(explicitMachine || fa || customer);
  const follow = !explicit && words <= 12 && FOLLOW.test(t);
  const machine = explicitMachine ?? (follow || (!explicit && words <= 8 && WHY.test(t)) ? ctx.machine : undefined);
  const machineOk = machine && plant.findMachine(machine);

  // Phase-2-Maschine ohne Datenanschluss
  if (explicitMachine && !plant.findMachine(explicitMachine) && PHASE2_SEED[explicitMachine]) return { intent: "blind", steps: [{ name: "ki_waechter", input: {} }] };

  // Fremde Themen: freundlich ablehnen, Bezug zum Werk herstellen
  if (OFFTOPIC.test(t) && !has("lkw", "maschine", "werk", "auftrag", "lager")) return { intent: "offtopic", steps: [{ name: "werk_uebersicht", input: {} }] };

  // Gesprächsfloskeln: Begrüßung, Dank, Ablehnung eines Vorschlags
  if (/^(hallo|hi|hey|servus|moin|guten (morgen|tag|abend)|grüß dich|gruess dich)\b/.test(t) && words <= 5) return { intent: "hallo", steps: [{ name: "werk_uebersicht", input: {} }] };
  if (/^(danke|vielen dank|super|top|perfekt|klasse|prima)\b/.test(t) && words <= 5 && !CONFIRM.test(t)) return { intent: "danke", steps: [] };
  if (/^(nein|nee|nö|noe|noch nicht|später|spaeter|lieber nicht|nicht nötig|nicht noetig|erstmal nicht)\b/.test(t) && words <= 7) return { intent: "ablehnen", steps: [] };

  // Bestätigung einer vorgeschlagenen Maßnahme („ja, mach das“)
  if (CONFIRM.test(t) && words <= 12 && !has("bericht", "lagebild")) {
    const m = explicitMachine ?? ctx.machine;
    const p = ctx.prevIntent;
    if (p === "material" || (!m && ctx.material)) {
      const mat = ctx.material ?? "M-PPR";
      return { intent: "aktion", steps: [{ name: "bestellung_vorschlagen", input: { material: mat, menge: mat === "M-IML" ? 250000 : 20000, begruendung: "Expressbestellung nach Reichweitenwarnung (KI-Werksexperte)" } }] };
    }
    if ((p === "liefertermin" || p === "auftraege") && ctx.order) {
      const o = plant.order(ctx.order);
      const alt = o && alternativeMachines(plant, o).find((a) => a.status !== "STOERUNG");
      if (o && alt) return { intent: "aktion", steps: [{ name: "umplanung_vorschlagen", input: { auftrag_id: o.id, ziel_maschine_id: alt.machineId, begruendung: `Terminrisiko ${o.id} – Umplanung auf ${alt.machineId}` } }] };
    }
    if (m && plant.findMachine(m)) {
      if (has("wartung", "lager tauschen", "instandhaltung")) return { intent: "aktion", steps: [{ name: "wartung_vorschlagen", input: { maschine_id: m, begruendung: "Vorausschauende Wartung nach KI-Prognose" } }] };
      return { intent: "aktion", steps: [{ name: "massnahme_vorschlagen", input: { maschine_id: m } }] };
    }
    if (!has("?")) return { intent: "risiken", steps: [{ name: "risiko_radar", input: {} }] };
  }

  // Fachbegriffe immer am aktuellen Werksbeispiel erklären
  if (/was (ist|sind|bedeutet|heißt|heisst)|erklär|definier|wofür steht|wofuer steht/.test(t)) {
    const term = TERMS.find(([re]) => re.test(t))?.[1];
    if (term) {
      const steps: Record<string, Step[]> = {
        oee: [{ name: "werk_uebersicht", input: {} }, { name: "maschinen_status", input: {} }],
        cpk: [{ name: "qualitaetsbericht", input: {} }],
        spc: [{ name: "qualitaetsbericht", input: {} }, { name: "wissen_suchen", input: { frage: "SPC Eingriffsregeln Regelkarte EWMA" } }],
        rul: [{ name: "wartungsprognose", input: {} }],
        iml: [{ name: "qualitaetsbericht", input: {} }],
        iso: [{ name: "wartungsprognose", input: {} }, { name: "wissen_suchen", input: { frage: "Schwingung ISO 10816 Zonen Grenzwert" } }],
        pm: [{ name: "wartungsprognose", input: {} }],
        zwilling: [{ name: "werk_uebersicht", input: {} }],
        db: [{ name: "finanzen", input: { tage: 30 } }],
        liefertreue: [{ name: "werk_uebersicht", input: {} }, { name: "auftraege_suchen", input: { nur_gefaehrdet: true } }],
        hitl: [{ name: "werk_uebersicht", input: {} }],
      };
      return { intent: "begriff", term, steps: steps[term] };
    }
  }

  // Wer bin ich / was kann ich – und Fragen zum Unternehmen
  if (/wer bist du|was bist du|was kannst du|wie funktionierst du|stell dich vor|was ist cortex|was machst du|wie kannst du (mir )?helfen|was weißt du|was weisst du|^hilfe\b/.test(t)) return { intent: "about", steps: [{ name: "werk_uebersicht", input: {} }] };
  if (/\bki-werk\b|unser(e|em|en)? (werk|unternehmen|firma)|was (produzieren|stellen) wir|welche produkte|welche maschinen haben|wie viele maschinen haben|welche kunden haben|wie viele kunden|wo ist (das|unser) werk|standort/.test(t))
    return { intent: "firma", steps: [{ name: "werk_uebersicht", input: {} }] };

  // Personen: keine Leistungsdaten von Mitarbeitenden
  if (/mitarbeiter|mitarbeitende|kollegen|wer arbeitet|schichtführer|schichtfuehrer|leistung von (herrn|frau)|überwach|ueberwach/.test(t) && !has("kosten"))
    return { intent: "personal", steps: [{ name: "wissen_suchen", input: { frage: "KI-Richtlinie Betriebsrat Leistungsdaten Mitarbeiter Datenschutz" } }] };

  if (has("wartung anlegen", "wartungsauftrag", "plane die wartung", "plane eine wartung", "wartung planen", "wartung einplanen") && machineOk)
    return { intent: "wartung_anlegen", steps: [{ name: "wartungsprognose", input: { maschine_id: machine } }, { name: "wartung_vorschlagen", input: { maschine_id: machine, begruendung: "Vorausschauender Lagertausch nach KI-Prognose" } }] };

  // Was-wäre-wenn im digitalen Zwilling
  if (WHATIF.test(t)) {
    const m = machineOk ? machine : ctx.machine && plant.findMachine(ctx.machine) ? ctx.machine : undefined;
    const want = has("wartung") ? "wartung" : has("umplan") ? "umplan" : has("zyklus") ? "zyklus" : undefined;
    return { intent: "whatif", steps: [{ name: "was_waere_wenn", input: { ...(m ? { maschine_id: m } : {}), ...(want ? { massnahme: want } : {}) } }] };
  }

  // Warum? – Begründung zum Auftrag bzw. zur Maschine aus dem Gespräch
  if (WHY.test(t) && follow && ctx.order && ["auftraege", "liefertermin", "kunde"].includes(ctx.prevIntent ?? "")) return { intent: "liefertermin", steps: [{ name: "liefertermin_pruefen", input: { auftrag_id: ctx.order } }] };
  if (WHY.test(t) && machineOk && !has("ausschuss", "etikett", "qualität", "qualitaet"))
    return { intent: "warum", steps: [{ name: "ki_waechter", input: { maschine_id: machine } }, { name: "wartungsprognose", input: { maschine_id: machine } }] };
  if (WHY.test(t) && follow && ctx.order) return { intent: "liefertermin", steps: [{ name: "liefertermin_pruefen", input: { auftrag_id: ctx.order } }] };

  if (has("eilauftrag", "anfrage", "machbar", "schaffen wir", "zusagen", "können wir liefern", "koennen wir liefern", "lieferbar")) {
    const inq = plant.inquiries.find((i) => i.status === "OFFEN");
    const qty = Math.max(0, ...(t.match(/\d[\d.]*/g) ?? []).map((n) => Number(n.replace(/\./g, ""))).filter((n) => n >= 1000));
    const prod = resolveProduct(q);
    const days = Number(t.match(/in\s*(\d+)\s*tag/)?.[1]);
    if (!inq || (prod && qty)) return { intent: "machbarkeit", steps: [{ name: "machbarkeit_pruefen", input: { produkt: prod?.id ?? "P-IML500", menge: qty || 300000, in_tagen: days || 4, ...(customer ? { kunde: customer.name } : {}) } }] };
    return { intent: "machbarkeit", steps: [{ name: "machbarkeit_pruefen", input: { anfrage_id: inq.id } }, { name: "wissen_suchen", input: { frage: "Eilauftrag Lieferzusage Zuschlag Teilmenge" } }] };
  }

  if (fa) return { intent: "liefertermin", steps: [{ name: "liefertermin_pruefen", input: { auftrag_id: fa } }] };

  // Kennzeichen (z. B. „GM-AB 1234“) → Fahrzeugdetails aus dem Yard-Management
  const plate = q.toUpperCase().match(/\b([A-ZÄÖÜ]{1,3})-([A-Z]{1,2})\s?(\d{1,4})\b/);
  if (plate && !/^(SG|TF|FA|ZF|LS|WE|AN)$/.test(plate[1])) return { intent: "hof", steps: [{ name: "lkw_hof", input: { kennzeichen: `${plate[1]}-${plate[2]} ${plate[3]}` } }] };

  if (customer && !has("umsatz", "marge") ) return { intent: "kunde", steps: [{ name: "kunde_info", input: { kunde: customer.name } }] };

  // Gesamtrisiko: Experteneinschätzung über alle Bereiche
  if (
    !machine &&
    !has("maschine", "anlage") &&
    (has("risiken", "was kann passieren", "was kann schief", "schiefgehen", "worauf", "achten", "sorgen", "gefahr", "größte problem", "groesste problem", "größten problem", "wo brennt", "was brennt", "an meiner stelle", "was würdest du", "was wuerdest du", "einschätzung", "einschaetzung", "experte", "wie wahrscheinlich", "was kommt auf uns", "vorhersage", "kritisch") ||
      has("probleme", "risiko"))
  )
    return { intent: "risiken", steps: [{ name: "risiko_radar", input: {} }] };

  // KI-Wächter: Frühwarnungen, drohender Verlust, Maßnahmen mit Alternativen
  if (has("wächter", "waechter", "verlier", "verlust", "droht", "verhinder", "alternativ", "probleme", "frühwarn", "fruehwarn", "auffällig", "auffaellig", "was sollen wir tun", "macht probleme", "macht sorgen", "sorgen"))
    return { intent: "waechter", steps: [{ name: "ki_waechter", input: machineOk ? { maschine_id: machine } : {} }] };

  if (has("energie", "strom", "kwh", "co2", "co₂", "lastspitze"))
    return { intent: "energie", steps: [{ name: "werk_uebersicht", input: {} }, { name: "ki_waechter", input: {} }, { name: "wissen_suchen", input: { frage: "Energiemanagement ISO 50001 Lastspitzen Standby" } }] };

  if ((has("stillstand", "stillstände", "ausfall") && has("kostet", "kosten", "teuer")) && !machineOk)
    return { intent: "stillstandskosten", steps: [{ name: "wissen_suchen", input: { frage: "Kostenansätze Stillstand Instandhaltung Stundensatz" } }, { name: "finanzen", input: { tage: 1 } }] };

  if (has("umsatz", "gewinn", "verdien", "marge", "deckungsbeitrag", "finanz", "ergebnis", "budget", "rentab", "profit", "geld"))
    return { intent: "finanzen", steps: [{ name: "finanzen", input: { tage: has("heute") ? 1 : has("woche") ? 7 : 30 } }] };

  if (has("bericht", "zusammenfass", "rapport", "report", "was ist heute passiert", "tagesbilanz"))
    return { intent: "bericht", steps: [{ name: "bericht_erstellen", input: { zeitraum: has("monat") ? "monat" : has("woche") ? "woche" : has("gestern") ? "gestern" : "tag" } }] };

  if (has("lkw", "hof", "zeitfenster", "fahrer", "kennzeichen", "anlieferung", "abholung", "rampe", "kamion", "truck") && !has("versand", "sendung"))
    return { intent: "hof", steps: [{ name: "lkw_hof", input: { zeitraum: has("monat") ? "monat" : has("woche") ? "woche" : has("morgen") ? "morgen" : "heute" } }] };

  const prod = !machine ? resolveProduct(q) : undefined;
  if (prod && !has("qualität", "qualitaet", "ausschuss")) return { intent: "produkt", steps: [{ name: "fertigwarenlager", input: { produkt: prod.id } }, { name: "auftraege_suchen", input: { produkt: prod.id } }] };

  if (!machine && has("fertigware", "palette", "lagerbestand", "hochregal", "im lager", "auf lager", "stock", "bestand je", "wie viel liegt", "lager voll", "lagerauslastung", "wie voll"))
    return { intent: "lager", steps: [{ name: "fertigwarenlager", input: {} }] };

  // Zuständigkeiten und Abläufe stehen in den Dokumenten
  if (/zuständig|zustaendig|verantwortlich|ansprechpartner|wen (muss|soll) ich|wer kümmert|wer entscheidet/.test(t))
    return { intent: "wissen", steps: [{ name: "wissen_suchen", input: { frage: q } }, { name: "werk_uebersicht", input: {} }] };

  if (has("liefertreue") && !has("gefährdet", "gefaehrdet"))
    return { intent: "begriff", term: "liefertreue", steps: [{ name: "werk_uebersicht", input: {} }, { name: "auftraege_suchen", input: { nur_gefaehrdet: true } }] };

  if (has("gefährdet", "gefaehrdet", "verspät", "verspaet", "termin", "liefertreue", "kunde", "pünktlich", "puenktlich"))
    return { intent: "auftraege", steps: [{ name: "auftraege_suchen", input: { nur_gefaehrdet: true } }] };

  if (has("qualität", "qualitaet", "ausschuss", "spc", "etikett", "fehler", "cpk", "kamera", "reklamation"))
    return {
      intent: "qualitaet",
      steps: [
        { name: "qualitaetsbericht", input: machineOk ? { maschine_id: machine } : {} },
        { name: "wissen_suchen", input: { frage: t.includes("etikett") || machine === "SG-02" ? "Etikettenversatz Ursachen Maßnahmen Greifer Vakuum" : "SPC Eingriffsregeln Regelkarte" } },
      ],
    };

  if (has("material", "granulat", "silo", "reichweite", "folie", "rohstoff", "bestand", "lieferverzug", "etiketten", "nachschub", "lieferant"))
    return { intent: "material", steps: [{ name: "material_und_lager", input: {} }, { name: "wissen_suchen", input: { frage: "Lieferverzug Granulat Meldebestand Notfallplan Alternativlieferant" } }] };

  if (has("versand", "spedition", "sendung", "verladung", "abfahrt"))
    return { intent: "versand", steps: [{ name: "versand_uebersicht", input: {} }] };

  if (machineOk && has("wartung", "ausfall", "risiko", "lager", "schwing", "prognose", "kaputt", "zustand", "rul", "kritisch", "wahrscheinlich", "kostet", "kosten"))
    return { intent: "prognose", steps: [{ name: "wartungsprognose", input: { maschine_id: machine } }, { name: "wissen_suchen", input: { frage: "Schwingung steigender Trend Lager Grenzwert ISO 10816" } }] };

  if (machineOk) return { intent: "maschine", steps: [{ name: "maschinen_status", input: { maschine_id: machine } }, { name: "wartungsprognose", input: { maschine_id: machine } }] };

  if (has("wartung", "ausfall", "predictive", "risiko", "instandhaltung", "fällt", "faellt"))
    return { intent: "flotte", steps: [{ name: "wartungsprognose", input: {} }] };

  if (has("schicht", "läuft", "laeuft", "oee", "ausbringung", "stückzahl", "stueckzahl", "produktion", "lagebild", "status", "überblick", "ueberblick", "wie steht", "was ist los", "was gibt", "neuigkeit"))
    return { intent: "briefing", steps: [{ name: "werk_uebersicht", input: {} }, { name: "wartungsprognose", input: {} }] };

  if (has("empfiehl", "empfehl", "was soll ich", "nächste schritte", "naechste schritte", "das wichtigste", "prognose", "priorit"))
    return { intent: "risiken", steps: [{ name: "risiko_radar", input: {} }] };

  if (has("wie ", "warum", "richtlinie", "vorgehen", "was tun", "was mache", "grenzwert", "regel", "dsgvo", "ai act", "betriebsrat", "zuständig", "zustaendig", "wer ist"))
    return { intent: "wissen", steps: [{ name: "wissen_suchen", input: { frage: q } }, { name: "werk_uebersicht", input: {} }] };

  // Folgefrage ohne eigenes Thema: mit der vorherigen Frage zusammen verstehen
  if (follow && ctx.prevQ && ctx.prevQ !== raw) {
    const p = plan(plant, `${q} ${ctx.prevQ}`, {});
    if (p.intent !== "unbekannt") return p;
  }

  return { intent: "unbekannt", steps: [{ name: "wissen_suchen", input: { frage: q } }, { name: "werk_uebersicht", input: {} }, { name: "risiko_radar", input: {} }] };
}

// ---------------- Antworten ----------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type D = any;
const pnum = (s: unknown) => parseFloat(String(s ?? "").replace(/\./g, "").replace(",", ".")) || 0;
const actionWhat = (t: D) =>
  t.massnahme ?? (t.material ? `Expressbestellung ${t.menge} ${t.material}` : t.auftrag ? `Umplanung ${t.auftrag} von ${t.von} auf ${t.nach}` : `Wartung ${t.maschine} (Start ${t.start}, Dauer ${t.dauer})`);
const oneLiner = (w: D) => `${w.schicht}: ${w.maschinen_in_produktion} Maschinen in Produktion, OEE ${w.oee}, ${w.auftraege_mit_terminrisiko ? `${w.auftraege_mit_terminrisiko} ${w.auftraege_mit_terminrisiko === 1 ? "Auftrag" : "Aufträge"} mit Terminrisiko` : "keine Aufträge mit Terminrisiko"}`;

function compose(plant: Plant, p: Plan, outs: Out[]): string {
  const get = (n: string): D => outs.find((o) => o.name === n)?.out?.data;
  const card = (n: string): D => outs.find((o) => o.name === n)?.out?.card?.data;
  const docs = ((get("wissen_suchen") as D[] | undefined) ?? []).filter((d) => d.quelle);
  const cite = docs.length ? `\n\nQuelle: ${docs.slice(0, 2).map((d) => `[${String(d.quelle).split(" – ")[0]}] ${d.abschnitt}`).join(" · ")}` : "";
  const err = outs.find((o) => o.error);
  if (err && !outs.some((o) => o.out)) {
    if (p.intent === "aktion") return `Das habe ich **nicht angelegt**: ${err.error}`;
    return `Das konnte ich nicht prüfen: ${err.error}`;
  }

  switch (p.intent) {
    case "briefing": {
      const w = get("werk_uebersicht")!;
      const ranking = (get("wartungsprognose") as D[] | undefined) ?? [];
      const top = ranking[0];
      const lines = [
        `**Lagebild ${w.schicht} · ${w.werkszeit}**`,
        "",
        `- OEE Werk: **${w.oee}** · Ausbringung heute **${w.ausbringung_heute_stk} Stk** · Ausschuss **${w.ausschussquote}**`,
        `- Maschinen: **${w.maschinen_in_produktion}** in Produktion${(w.maschinen_nicht_in_produktion as string[]).length ? ` – ${(w.maschinen_nicht_in_produktion as string[]).join("; ")}` : ""}`,
        `- Liefertreue (30 Tage): **${w.liefertreue_30_tage}** · Aufträge mit Terminrisiko: **${w.auftraege_mit_terminrisiko}**`,
      ];
      if (top) lines.push(`- Höchstes Ausfallrisiko: **${top.id}** mit **${top.ausfallrisiko_72h}** (Zone ${top.zone}${top.treiber ? `, ${top.treiber}` : ""})`);
      const warn = w.warnungen as string[];
      if (warn.length) lines.push("", "**Wichtigste Hinweise**", ...warn.slice(0, 4).map((x) => `- ${x.replace(/^\[[^\]]+\]\s*/, "")}`));
      const inq = w.offene_kundenanfragen as D[];
      if (inq.length) lines.push(`- Offene Kundenanfrage: **${inq[0].kunde}** – ${fmtInt(inq[0].menge)} Stk ${inq[0].produkt} bis ${inq[0].termin}`);
      const recs: string[] = [];
      if (top && parseInt(top.ausfallrisiko_72h) >= 45) recs.push(`Wartung an ${top.id} einplanen`);
      if (inq.length) recs.push("Kundenanfrage per Machbarkeitsprüfung beantworten");
      if ((w.ki_vorschlaege_zur_freigabe as string[]).length) recs.push("offene KI-Vorschläge freigeben oder ablehnen");
      lines.push("", `Empfehlung: ${recs.length ? recs.join(", ") + "." : "Keine akuten Maßnahmen – Schicht läuft stabil."}`);
      return lines.join("\n");
    }
    case "prognose":
    case "wartung_anlegen":
    case "maschine": {
      const pr = get("wartungsprognose")!;
      const st = get("maschinen_status");
      const t = get("wartung_vorschlagen");
      const rec = (pr.wartungsfenster as D[]).find((o) => o.empfohlen);
      const risk = parseInt(pr.ausfallwahrscheinlichkeit_72h);
      const head =
        risk >= 75
          ? `**${pr.maschine}** wird mit hoher Wahrscheinlichkeit in den nächsten 72 h ausfallen, wenn nichts passiert.`
          : risk >= 45
            ? `**${pr.maschine}** zeigt einen deutlichen Verschleißtrend – Wartung sollte zeitnah eingeplant werden.`
            : `**${pr.maschine}** läuft im grünen Bereich – kein akuter Handlungsbedarf.`;
      const lines = [
        head,
        "",
        `- Ausfallwahrscheinlichkeit (72 h): **${pr.ausfallwahrscheinlichkeit_72h}** · Zustandsindex **${pr.zustandsindex_0_100}/100**`,
        `- Schwingung: **${pr.schwingung_aktuell}** – ISO-10816-Zone **${pr.iso_10816_zone}** · Restlaufzeit bis Schadensgrenze: **${pr.restlaufzeit_bis_schadensgrenze}**`,
      ];
      if (st) lines.push(`- Status: ${st.status}${st.grund ? ` (${st.grund})` : ""} · Auftrag ${st.auftrag ?? "–"} · OEE heute ${st.oee_heute}`);
      if ((pr.einflussfaktoren as string[]).length) lines.push(`- Treiber laut Modell: ${(pr.einflussfaktoren as string[]).join(" · ")}`);
      if (risk >= 45) lines.push(`- Kosten: geplante Wartung **${pr.kosten_geplante_wartung}** vs. ungeplanter Ausfall **${pr.kosten_ungeplanter_ausfall}** → Ersparnis je vermiedenem Ausfall **${pr.ersparnis_je_vermiedenem_ausfall}**`);
      if (risk >= 45) lines.push(`- KI-Wächter: erwarteter Verlust 72 h **${pr.erwarteter_verlust_72h}** · Empfehlung: ${pr.empfehlung_ki_waechter}`);
      if (t) lines.push("", `Ich habe den Wartungsauftrag **${t.ticket}** als Entwurf angelegt (Start ${t.start}, Dauer ${t.dauer}). **Freigabe durch die Instandhaltung erforderlich** – bitte unter Freigaben bestätigen.`);
      else if (risk >= 45 && rec) lines.push("", `Empfehlung: Lagertausch **${rec.bezeichnung.toLowerCase()}** (${rec.zeitpunkt}) – Risiko eines Ausfalls vorher nur ${rec.risiko_ausfall_vorher}. Soll ich den Wartungsauftrag vorbereiten?`);
      else lines.push("", "Empfehlung: Weiter beobachten, nächste Regelwartung wie geplant.");
      return lines.join("\n") + cite;
    }
    case "flotte": {
      const r = get("wartungsprognose") as D[];
      const crit = r.filter((x) => parseInt(x.ausfallrisiko_72h) >= 45);
      return [
        crit.length ? `**${crit.length} Maschine${crit.length > 1 ? "n" : ""}** mit erhöhtem Ausfallrisiko:` : "Alle Maschinen laufen ohne erhöhtes Ausfallrisiko.",
        "",
        ...r.slice(0, 5).map((x) => `- **${x.id}**: ${x.ausfallrisiko_72h} Risiko · Zustand ${x.zustandsindex}/100 · Zone ${x.zone} · RUL ${x.restlaufzeit}`),
        "",
        `Empfehlung: ${crit.length ? `Wartung für ${crit.map((x) => x.id).join(", ")} einplanen.` : "Regelwartungsplan beibehalten."}`,
      ].join("\n");
    }
    case "machbarkeit": {
      const f = get("machbarkeit_pruefen")!;
      const e = f.ergebnis as string;
      const wer = f.kunde ? ` für ${f.kunde}` : "";
      const head =
        e === "MACHBAR"
          ? `**Ja – zusagen.** ${f.menge} Stk ${f.produkt}${wer} sind bis **${f.liefertermin}** lieferbar, ohne andere Kunden zu gefährden.`
          : e === "MACHBAR NUR MIT KONFLIKTEN"
            ? `**Die Vollmenge ist nur mit Konflikten machbar.** ${f.menge} Stk${wer} bis ${f.liefertermin} gingen nur, wenn wir andere Aufträge nach hinten schieben – das würde Zusagen an andere Kunden brechen.`
            : e === "TEILWEISE MACHBAR"
              ? `**Teilweise machbar:** bis ${f.liefertermin} sind **${f.einplanbare_menge} von ${f.menge} Stk** darstellbar.`
              : `**Nicht machbar** zum Wunschtermin ${f.liefertermin}.`;
      const lines = [head, ""];
      if (e !== "MACHBAR" && f.restmenge !== "0") {
        lines.push("**Optionen für den Vertrieb**");
        lines.push(`- **A · Konfliktfrei (empfohlen):** **${f.konfliktfreie_teilmenge_zum_termin} Stk** zum Wunschtermin${f.restmenge_lieferbar_bis ? `, Restmenge **${f.restmenge} Stk** bis **${f.restmenge_lieferbar_bis}**` : ""}`);
        const imp = f.auswirkungen_auf_andere_auftraege as string[];
        if (imp.length) lines.push(`- **B · Vollmenge mit Vorziehen:** verschiebt ${imp.slice(0, 3).map((x) => x.split(" →")[0]).join(", ")}`);
        lines.push("- **C · Sonderschicht am Wochenende** auf SG-01/SG-02 prüfen (Betriebsrat, Personalplanung)");
        lines.push("");
      }
      lines.push("**Geprüft**");
      lines.push(...(f.plan as D[]).slice(0, 4).map((x) => `- **${x.maschine}**: ${x.menge} Stk · ${x.von} → ${x.bis} (${x.art})`));
      lines.push(...(f.material as D[]).map((m) => `- ${m.material}: Bedarf ${m.bedarf}, verfügbar ${m.verfuegbar}${m.zulauf_bis_termin.startsWith("0") ? "" : ` + Zulauf ${m.zulauf_bis_termin}`} → ${m.ausreichend ? "**ausreichend**" : "**Engpass**"}`));
      lines.push(`- Spätestes Produktionsende ${f.spaetestes_produktionsende} · Transport ${f.transportzeit} · Auftragswert **${f.umsatz}**`);
      lines.push(
        "",
        e === "MACHBAR"
          ? "Empfehlung: Zusage mit Eilzuschlag (6–8 %) – die Aufträge können direkt aus der Machbarkeitsprüfung in SAP angelegt werden."
          : "Empfehlung: Option A anbieten – Teillieferung zum Wunschtermin und verbindlicher Folgetermin für die Restmenge. So bleiben alle bestehenden Zusagen gültig.",
      );
      return lines.join("\n") + cite;
    }
    case "liefertermin": {
      const d = get("liefertermin_pruefen")!;
      const alts = d.alternative_maschinen as D[];
      return [
        `**${d.auftrag}** für ${d.kunde} (${d.ort}): Termintreue-Wahrscheinlichkeit **${d.termintreue_wahrscheinlichkeit}**.`,
        "",
        `- ${d.produkt} · ${d.produziert} von ${d.menge} Stk produziert auf **${d.maschine}** (${d.status})`,
        `- Liefertermin **${d.liefertermin}** · Prognose Lieferung **${d.prognose_lieferung}** (${d.puffer})`,
        d.ursache ? `- Ursache: ${d.ursache}` : "- Kein erkennbares Risiko.",
        alts.length ? `- Alternative: **${alts[0].maschine}** frei ab ${alts[0].frei_ab}${alts[0].ruesten_noetig ? " (Rüsten nötig)" : ""}` : "",
        "",
        d.risiko !== "ok" && alts.length ? `Empfehlung: Umplanung auf ${alts[0].maschine} prüfen – soll ich den Vorschlag zur Freigabe vorbereiten?` : "Empfehlung: Keine Maßnahme nötig.",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "auftraege": {
      const a = get("auftraege_suchen")!;
      const list = a.auftraege as D[];
      if (!list.length) return "Aktuell ist **kein Auftrag** terminlich gefährdet. Alle Prognosen liegen innerhalb der Liefertermine.";
      return [
        `**${a.anzahl} ${a.anzahl > 1 ? "Aufträge" : "Auftrag"}** mit Terminrisiko:`,
        "",
        ...list.slice(0, 5).map((o) => `- **${o.id}** · ${o.kunde} · ${o.menge} Stk ${o.produkt} auf ${o.maschine} – Termintreue **${o.termintreue_wahrscheinlichkeit}**${o.grund ? ` (${o.grund})` : ""}`),
        "",
        "Empfehlung: Ursache an der Maschine beheben oder Aufträge auf freie, kompatible Maschinen umplanen.",
      ].join("\n");
    }
    case "qualitaet": {
      const q = get("qualitaetsbericht")!;
      const ms = (q.maschinen as D[]).filter((m) => m.spc_regelverletzung !== "keine" || pnum(m.ausschuss) > 1.5);
      return (
        [
          `Ausschussquote **${q.bereich}** heute: **${q.ausschussquote_heute}**.`,
          "",
          `- Häufigste Fehler: ${(q.fehler_pareto as D[]).slice(0, 3).map((f) => `${f.fehlerart} (${f.stueck} Stk)`).join(" · ") || "keine"}`,
          ...ms.slice(0, 4).map((m) => `- **${m.id}** (${m.produkt}): Ausschuss ${m.ausschuss} · Cpk **${m.cpk}** · SPC ${m.spc_regelverletzung === "keine" ? "i.O." : `Regel **${m.spc_regelverletzung}** verletzt`}`),
          ms.length ? "" : "- Alle Prozesse stabil, keine SPC-Regelverletzung.",
          "",
          ms.length
            ? `Empfehlung: ${ms[0].id} prüfen – bei Etikettenversatz zuerst Vakuum und Saugnäpfe des IML-Greifers kontrollieren, betroffene Teile sperren und nachsortieren.`
            : "Empfehlung: Keine Maßnahme nötig.",
        ].join("\n") + cite
      );
    }
    case "material": {
      const m = get("material_und_lager")!;
      const mats = m.materialien as D[];
      const crit = mats.filter((x) => x.zustand !== "ok");
      return (
        [
          crit.length ? `**${crit.length} Material${crit.length > 1 ? "ien" : ""}** unter Meldebestand:` : "Alle Materialien sind ausreichend bevorratet.",
          "",
          ...mats.map((x) => `- ${x.zustand !== "ok" ? "**" : ""}${x.name}${x.zustand !== "ok" ? "**" : ""}: ${x.bestand} · Reichweite **${x.reichweite}**${(x.zulauf as string[]).length ? ` · Zulauf: ${(x.zulauf as string[])[0].split(": ")[1]}` : ""}`),
          `- Fertigwarenlager: ${m.fertigwarenlager}`,
          "",
          crit.length ? "Empfehlung: Expressbestellung beim Alternativlieferanten auslösen (Freigabe Einkauf) und Aufträge nach Kundenpriorität reihen. Soll ich die Bestellung vorbereiten?" : "Empfehlung: Keine Maßnahme nötig.",
        ].join("\n") + cite
      );
    }
    case "versand": {
      const s = get("versand_uebersicht") as D[];
      return [`**${s.length} Sendungen** im Versand-Cockpit:`, "", ...s.slice(0, 6).map((x) => `- ${x.status} · **${x.kunde}** (${x.ziel}) · ${x.paletten} Pal. · ${x.spedition} · Tor ${x.tor} · ${x.eta ? `ETA ${x.eta}` : `Abfahrt ${x.abfahrt}`}`)].join("\n");
    }
    case "hof": {
      const h = get("lkw_hof")!;
      if (h.kennzeichen) {
        const lines = [
          `**${h.kennzeichen}** (${h.spedition}, Fahrer ${h.fahrer}) – ${h.status}.`,
          "",
          `- ${h.art === "abholung" ? "Abholung" : h.art === "anlieferung" ? "Anlieferung" : "Entsorgung"} für **${h.partner}**: ${h.ware}`,
          `- Von ${h.von} → nach ${h.nach}`,
          `- Zeitfenster ${h.zeitfenster_von_bis}${h.rampe ? ` · Rampe ${h.rampe}` : ""}`,
        ];
        if (h.angekommen) lines.push(`- Angekommen ${h.angekommen}${h.verspaetung_min ? ` · **${h.verspaetung_min} min nach Zeitfenster**` : " · pünktlich"}${h.standzeit_min !== undefined ? ` · Standzeit **${h.standzeit_min} min**` : ""}${h.ueberzogen_min ? ` (**+${h.ueberzogen_min} min über Plan**)` : ""}`);
        else if (h.verspaetung_min) lines.push(`- **Verspätung ca. ${h.verspaetung_min} min**`);
        if (h.abgefahren) lines.push(`- Abgefahren ${h.abgefahren}`);
        lines.push("", h.ueberzogen_min ? "Empfehlung: Verladung priorisieren bzw. Folgefahrzeug auf eine freie Rampe umdisponieren, um Standgeld zu vermeiden." : h.verspaetung_min ? "Empfehlung: Rampe für das nächste Fahrzeug freigeben und den Empfänger über die spätere Ankunft informieren." : "Empfehlung: Keine Maßnahme nötig.");
        return lines.join("\n");
      }
      const site = h.fahrzeuge_auf_dem_hof as D[];
      const next = h.naechste as D[];
      return [
        `Auf dem Hof ${h.auf_dem_hof === 1 ? "steht **1 LKW**" : `stehen **${h.auf_dem_hof} LKW**`} · heute noch **${h.heute_noch_erwartet}** erwartet · **${h.heute_abgefertigt}** abgefertigt · **${h.verspaetet}** verspätet · **${h.standzeit_ueberzogen}** mit überzogener Standzeit.`,
        "",
        ...site.map((v) => `- **${v.kennzeichen}** (${v.spedition}, ${v.fahrer}) · ${v.partner} · ${v.ware} · ${v.status}${v.ueberzogen_min ? ` · **+${v.ueberzogen_min} min**` : ""}`),
        "",
        next.length ? `**Als Nächstes (${h.zeitraum})**` : "",
        ...next.slice(0, 6).map((v) => `- ${v.zeitfenster_von_bis} · **${v.kennzeichen === "–" ? "Fahrzeug offen" : v.kennzeichen}** · ${v.art === "abholung" ? `Abholung ${v.partner} → ${v.nach.split(", ").pop()}` : `Anlieferung ${v.ware}`}${v.verspaetung_min ? ` · +${v.verspaetung_min} min` : ""}${v.prognose ? " (Prognose)" : ""}`),
        "",
        h.standzeit_ueberzogen ? "Empfehlung: Überzogene Fahrzeuge zuerst abfertigen – sonst blockieren sie die Rampen für die nächsten Zeitfenster." : "Empfehlung: Hof läuft im Plan – keine Maßnahme nötig.",
      ]
        .filter((x, i, a) => x !== "" || (i > 0 && a[i - 1] !== ""))
        .join("\n");
    }
    case "lager": {
      const l = get("fertigwarenlager")!;
      const arts = l.artikel as D[];
      const low = arts.filter((a) => a.zustand !== "ok");
      return [
        `Im Fertigwarenlager liegen **${fmtInt(l.paletten_gesamt)} Paletten** (Warenwert **${l.warenwert}**).`,
        "",
        ...arts.map((a) => `- ${a.zustand !== "ok" ? "**" : ""}${a.artikel}${a.zustand !== "ok" ? "**" : ""}: **${a.paletten} Pal.** (${a.stueck} Stk) · frei ${a.frei_paletten} / reserviert ${a.reserviert_paletten} · min. ${a.sicherheitsbestand_paletten} · ${a.lagerort}`),
        "",
        low.length ? `Empfehlung: ${low.map((a) => a.artikel).join(", ")} liegt unter Sicherheitsbestand – Fertigung vorziehen oder Abrufmengen mit den Kunden abstimmen.` : "Empfehlung: Alle Artikel über Sicherheitsbestand – keine Maßnahme nötig.",
      ].join("\n");
    }
    case "finanzen": {
      const f = get("finanzen")!;
      const top = f.top_kunden as D[];
      const low = [...top].sort((a, b) => parseFloat(a.marge) - parseFloat(b.marge))[0];
      return [
        `In den letzten **${f.zeitraum_tage} Tagen**: Umsatz **${f.umsatz}**, Deckungsbeitrag **${f.deckungsbeitrag}**, Ergebnis nach Fixkosten **${f.ergebnis_nach_fixkosten}**.`,
        "",
        `- Heute: Umsatz **${f.heute.umsatz}** · DB **${f.heute.deckungsbeitrag}** · Ergebnis **${f.heute.ergebnis}** · Verlust (entg. DB) **${f.heute.verlust}**`,
        `- Monat: bisher **${f.monat.bisher}** · Prognose **${f.monat.prognose}** · Budget **${f.monat.budget}**`,
        `- Verlust durch Stillstand und Ausschuss: ${f.verlust_entgangener_db}`,
        "",
        "**Top-Kunden**",
        ...top.map((c) => `- **${c.kunde}** (${c.ort}): ${c.umsatz} · ${c.stueck} Stk · DB ${c.db} (**${c.marge}**)`),
        "",
        `Empfehlung: ${low ? `Bei ${low.kunde} ist die Marge mit ${low.marge} am geringsten – Frachtpauschale bzw. größere Abrufmengen prüfen. ` : ""}Größter Hebel bleibt der Stillstandsverlust.`,
      ].join("\n");
    }
    case "bericht": {
      const b = get("bericht_erstellen")!;
      const recs = b.empfehlungen as D[];
      return [
        `**${b.bericht === "tag" ? "Tagesbericht" : b.bericht === "woche" ? "Wochenbericht" : "Monatsbericht"} · ${b.zeitraum}**`,
        "",
        ...(b.zusammenfassung as string[]).map((s) => `- ${s}`),
        "",
        "**Was jetzt zu tun ist**",
        ...(recs.length ? recs.slice(0, 5).map((r) => `- **${r.titel}** → ${r.massnahme}${r.wirkung ? ` (~${r.wirkung})` : ""}`) : ["- Keine Maßnahmen nötig – alles im Soll."]),
        "",
        `Den vollständigen Bericht gibt es unter **Berichte** als PDF, Excel oder HTML.`,
      ].join("\n");
    }
    case "waechter": {
      const w = get("ki_waechter")!;
      const ms = w.maschinen as D[];
      const found = ms.filter((m) => (m.befunde as D[]).length);
      if (!found.length) return `Der KI-Wächter überwacht **${w.ueberwacht}** – aktuell **keine Auffälligkeiten**. Alle Prüfpunkte liegen im Normalbereich, kein Trend zeigt Richtung Grenzwert.`;
      const lines = [`Der KI-Wächter sieht **${w.befunde} ${w.befunde === 1 ? "Befund" : "Befunde"}**${w.kritisch ? ` (davon **${w.kritisch} kritisch**)` : ""}. Drohender Verlust in 72 h: **${w.drohender_verlust_72h}** – mit den empfohlenen Maßnahmen nur **${w.mit_empfohlenen_massnahmen}**.`, ""];
      for (const m of found.slice(0, 3))
        for (const f of (m.befunde as D[]).slice(0, 2)) {
          lines.push(`**${m.maschine} · ${f.titel}**${f.fruehwarnung ? " · Frühwarnung" : ""}`);
          lines.push(`- Was ich in den Daten sehe: ${f.was_die_ki_sieht}`);
          lines.push(`- Warum: ${f.ursache} (Sicherheit ${f.sicherheit}) · Eintritt ${f.wahrscheinlichkeit_72h} · ${f.horizont}`);
          lines.push(`- Drohender Verlust: **${f.verlust_72h}**`);
          if (f.empfehlung) lines.push(`- Empfehlung: **${f.empfehlung.massnahme}** (${f.empfehlung.wann}) – Kosten ${f.empfehlung.kosten}, vermeidet **${f.empfehlung.vermeidet}**`);
          if ((f.alternativen as D[]).length) lines.push(`- Alternativen: ${(f.alternativen as D[]).slice(0, 2).map((a) => `${a.massnahme} (netto ${a.netto})`).join(" · ")}`);
          lines.push("");
        }
      lines.push(`Soll ich die empfohlene Maßnahme für **${found[0].maschine}** als Entwurf anlegen? Freigeben muss ein Mensch.`);
      return lines.join("\n");
    }
    case "wissen": {
      if (!docs.length) {
        const w = get("werk_uebersicht");
        return `Dazu habe ich in unseren Dokumenten nichts Passendes gefunden.${w ? `\n\nAktuell im Werk: ${oneLiner(w)}.` : ""}`;
      }
      return [`Laut interner Dokumentation:`, "", ...docs.map((d) => `- **${d.abschnitt}** – ${d.inhalt} [${String(d.quelle).split(" – ")[0]}]`)].join("\n");
    }

    // ---------- neue Absichten ----------

    case "risiken": {
      const r = get("risiko_radar")!;
      const items = r.risiken as D[];
      const lines: string[] = [];
      if (!items.length) {
        lines.push(`**Lage stabil.** In den nächsten 72 h sehe ich kein relevantes Risiko – Maschinen, Liefertermine, Material und Logistik liegen im Plan.`);
      } else {
        lines.push(`**Lage ${r.lage}.** Erwarteter Verlust in den nächsten 72 h: **${r.erwarteter_verlust_72h}** – mit den empfohlenen Maßnahmen nur **${r.mit_empfohlenen_massnahmen}**.`, "", "**Die größten Risiken (Wahrscheinlichkeit × Auswirkung)**");
        for (const x of items.slice(0, 5)) lines.push(`- **${x.risiko}** – Eintritt **${x.wahrscheinlichkeit}**, erwartet **${x.erwarteter_verlust}** · ${x.wann}. Ursache: ${x.ursache}. → ${x.empfehlung}`);
      }
      lines.push("", "**Meine Einschätzung**");
      if (items[0]) lines.push(`- Zuerst: ${items[0].empfehlung.split(" – ")[0]} (${items[0].risiko.split(":")[0]}).`);
      if (items[1]) lines.push(`- Danach: ${items[1].empfehlung.split(" – ")[0]} (${items[1].risiko.split(":")[0]}).`);
      if (r.datenluecken !== "keine") lines.push(`- Blinder Fleck: ${r.datenluecken}.`);
      if (r.monatsziel) lines.push(`- Monatsziel: ${r.monatsziel}.`);
      const top = r.risiken?.[0];
      if (top && /^(SG|TF)-\d\d:/.test(top.risiko)) lines.push("", `Soll ich die Maßnahme für **${top.risiko.split(":")[0]}** als Entwurf anlegen?`);
      return lines.join("\n");
    }
    case "whatif": {
      const w = get("was_waere_wenn")!;
      const r = card("was_waere_wenn");
      const saved = r ? r.without.lossEur - r.with.lossEur : 0;
      if (w.massnahme === "keine Maßnahme")
        return `**${w.maschine} läuft unauffällig.** Ich habe die nächsten 72 h trotzdem im digitalen Zwilling durchgerechnet: ${w.ohne_massnahme.ausfaelle ? `Ausfall ${w.ohne_massnahme.erster_ausfall}` : "kein Ausfall"}, Verlust nur **${w.ohne_massnahme.verlust}** (normaler Ausschuss und Kurzstopps). Eine Maßnahme ist nicht nötig.`;
      const o = w.ohne_massnahme, m = w.mit_massnahme;
      return [
        `**Ich habe die nächsten 72 Stunden für ${w.maschine} zweimal durchgerechnet** – ohne Maßnahme und mit „${w.massnahme}“. Gleicher Ausgangszustand, nur die Entscheidung ist anders.`,
        "",
        `- **Ohne Maßnahme:** Verlust **${o.verlust}** · Stillstand **${o.stillstand}** · ${o.ausfaelle ? `Ausfall **${o.erster_ausfall}**` : "kein Ausfall"}${o.auftrag ? ` · ${o.auftrag}` : ""}`,
        `- **Mit Maßnahme:** Verlust **${m.verlust}** · Stillstand **${m.stillstand}** · ${m.ausfaelle ? `Ausfall ${m.erster_ausfall}` : "kein Ausfall"}${m.auftrag ? ` · ${m.auftrag}` : ""}`,
        `- Unterschied: **${w.ersparnis} weniger Verlust** · ${w.weniger_stillstand} weniger Stillstand · ${pnum(w.mehr_gutteile) >= 0 ? "+" : ""}${w.mehr_gutteile} Gutteile`,
        "",
        saved > 0 ? `Empfehlung: „${w.massnahme}“ umsetzen – soll ich den Entwurf anlegen? Die Freigabe macht die Instandhaltung.` : `Empfehlung: „${w.massnahme}“ lohnt sich in diesen 72 h nicht – weiter beobachten.`,
        "",
        `Methode: ${w.methode} · Rechenzeit ${w.rechenzeit}. Der Live-Betrieb bleibt unberührt.`,
      ].join("\n");
    }
    case "warum": {
      const g = get("ki_waechter")!;
      const pr = get("wartungsprognose");
      const m = (g.maschinen as D[])[0];
      const f = m?.befunde?.[0];
      if (!m || !f)
        return [
          `**${m?.maschine ?? "Die Maschine"}** zeigt aktuell keinen Befund – deshalb warne ich hier nicht.`,
          "",
          ...((m?.pruefpunkte as string[] | undefined) ?? []).slice(0, 5).map((x) => `- ${x}`),
          "",
          `**Woher ich das weiß:** Sensorik über OPC UA (Schwingung, Temperaturen, Druck, Zyklus), Stillstände aus dem MES und Qualitätsdaten aus dem CAQ – bewertet mit dem Modell ${pr?.modell ?? "pm-lager"}.`,
        ].join("\n");
      return [
        `**Warum ich bei ${m.maschine} warne:** ${f.was_die_ki_sieht}`,
        "",
        "**Belege aus den Daten**",
        ...(f.belege as string[]).slice(0, 4).map((b) => `- ${b}`),
        `- Wahrscheinliche Ursache: **${f.ursache}** (Sicherheit ${f.sicherheit})`,
        ...(pr && (pr.einflussfaktoren as string[]).length ? [`- Treiber laut Modell: ${(pr.einflussfaktoren as string[]).join(" · ")}`] : []),
        "",
        `**Woher ich das weiß:** Sensorik über OPC UA im Sekundentakt, Stillstände aus dem MES, Qualitätsdaten aus dem CAQ – bewertet mit ${pr?.modell ?? "dem Wartungsmodell"}. Die Trefferquote der letzten 30 Tage steht unter Maschinengesundheit → Modell & Vertrauen.`,
        "",
        f.empfehlung ? `Empfehlung: **${f.empfehlung.massnahme}** (${f.empfehlung.wann}) – vermeidet ${f.empfehlung.vermeidet}. Soll ich das vorbereiten?` : "Empfehlung: weiter beobachten.",
      ].join("\n");
    }
    case "aktion": {
      const t = get("massnahme_vorschlagen") ?? get("wartung_vorschlagen") ?? get("bestellung_vorschlagen") ?? get("umplanung_vorschlagen");
      if (!t) return `Das habe ich **nicht angelegt**: ${err?.error ?? "unbekannter Fehler"}`;
      if (String(t.status).startsWith("existiert")) return `Für **${t.maschine}** gibt es dafür schon den Vorgang **${t.ticket}** (${t.status.replace("existiert bereits ", "")}) – ich lege nichts doppelt an.`;
      return [
        `**Erledigt – Entwurf ${t.ticket} ist angelegt:** ${actionWhat(t)}.`,
        "",
        ...(t.kosten ? [`- Kosten **${t.kosten}**${t.vermeidet ? ` · vermeidet **${t.vermeidet}**` : t.vermiedene_kosten ? ` · vermeidet **${t.vermiedene_kosten}**` : ""}${t.netto ? ` · netto **${t.netto}**` : ""}`] : []),
        ...(t.wann ? [`- Zeitpunkt: ${t.wann}`] : []),
        `- Status: **wartet auf Freigabe** – ${t.material ? "Einkauf" : t.auftrag ? "Fertigungssteuerung" : "Instandhaltung"} entscheidet (Human-in-the-Loop).`,
        "",
        "Du findest den Entwurf rechts unter **Freigaben**.",
      ].join("\n");
    }
    case "kunde": {
      const k = get("kunde_info")!;
      const orders = k.offene_auftraege as D[];
      const risky = orders.filter((o) => o.risiko !== "ok");
      const recs: string[] = [];
      if (risky.length) recs.push(`${risky[0].id} absichern (Umplanung prüfen) und den Kunden proaktiv informieren`);
      if ((k.offene_anfragen as D[]).length) recs.push("offene Anfrage per Machbarkeitsprüfung beantworten");
      if (pnum(k.marge) > 0 && pnum(k.marge) < 30) recs.push("Marge unter Schnitt – Frachtkosten und Abrufmengen nachverhandeln");
      return [
        `**${k.kunde}** (${k.ort}, ${k.segment}) – Rang **${k.rang_nach_umsatz}** nach Umsatz.`,
        "",
        `- Umsatz 30 Tage **${k.umsatz_30_tage}** · Deckungsbeitrag **${k.deckungsbeitrag_30_tage}** · Marge **${k.marge}**`,
        ...orders.slice(0, 4).map((o) => `- **${o.id}**: ${o.menge} Stk ${o.produkt} auf ${o.maschine} · Termin ${o.liefertermin} · Termintreue **${o.termintreue}**${o.grund ? ` (${o.grund})` : ""}`),
        ...(k.offene_anfragen as D[]).map((a) => `- Offene Anfrage **${a.id}**: ${a.menge} Stk ${a.produkt} bis ${a.termin}`),
        ...(k.naechste_abholungen as D[]).slice(0, 1).map((v) => `- Nächste Abholung: ${v.zeitfenster} · ${[v.spedition, v.kennzeichen].filter((x) => x && x !== "–").join(" · ")} · ${v.ware}`),
        "",
        `Einschätzung: ${k.einschaetzung}.`,
        `Empfehlung: ${recs.length ? recs.join("; ") + "." : "Keine Maßnahme nötig – Kunde läuft im Plan."}`,
      ].join("\n");
    }
    case "produkt": {
      const l = get("fertigwarenlager")!;
      const a = (l.artikel as D[])[0];
      const o = get("auftraege_suchen");
      const list = (o?.auftraege as D[] | undefined) ?? [];
      const risky = list.filter((x) => x.risiko !== "ok");
      if (!a) return "Zu diesem Produkt habe ich keinen Lagerbestand gefunden.";
      return [
        `**${a.artikel}:** ${a.paletten} Paletten (${a.stueck} Stk) im Lager, davon **${a.frei_paletten} frei** · Sicherheitsbestand ${a.sicherheitsbestand_paletten} Pal. · Reichweite **${a.reichweite_tage} Tage**.`,
        "",
        `- In Produktion auf: **${a.in_produktion_auf}** · heute +${a.heute_zugang_paletten} / −${a.heute_abgang_paletten} Pal.`,
        `- Nächste Abholung: ${a.naechste_abholung}`,
        `- Offene Aufträge: **${o?.anzahl ?? 0}**${risky.length ? `, davon **${risky.length} mit Terminrisiko** (${risky.slice(0, 2).map((x) => `${x.id} ${x.kunde}`).join(", ")})` : ", alle im Plan"}`,
        "",
        `Empfehlung: ${a.zustand !== "ok" ? "Bestand unter Minimum – Fertigung vorziehen oder Abrufmengen abstimmen." : risky.length ? "Terminrisiken an der Maschine beheben oder umplanen." : "Keine Maßnahme nötig."}`,
      ].join("\n");
    }
    case "energie": {
      const k = card("werk_uebersicht")?.kpis;
      const g = get("ki_waechter");
      const ef = ((g?.maschinen as D[] | undefined) ?? []).flatMap((m) => (m.befunde as D[]).filter((b) => b.bereich === "energie").map((b) => ({ m: m.maschine, ...b })));
      const kwh = k?.energyKwhToday ?? 0;
      return (
        [
          `Heute bisher **${fmtInt(kwh)} kWh** Strom – rund **${fmtEur(kwh * ENERGY_EUR_PER_KWH)}** und **${fmtNum((k?.co2kgToday ?? 0) / 1000, 1)} t CO₂e**.`,
          "",
          ...(ef.length ? ef.slice(0, 3).map((f) => `- **${f.m}**: ${f.titel} – ${f.was_die_ki_sieht} · ${f.verlust_72h} in 72 h${f.empfehlung ? ` → ${f.empfehlung.massnahme}` : ""}`) : ["- Kein Mehrverbrauch auffällig – alle Maschinen im Energie-Soll ihres Produkts."]),
          `- Größte Verbraucher sind die Spritzgießmaschinen in Halle A (Heizung, Hydraulik) – Standby in Rüst- und Wartezeiten ist der schnellste Hebel.`,
          "",
          `Empfehlung: ${ef.length ? `${ef[0].m} prüfen (${ef[0].empfehlung?.massnahme ?? "Ursache suchen"}).` : "Lastspitzen beim Schichtanlauf staffeln und Standby-Regeln konsequent nutzen."}`,
        ].join("\n") + cite
      );
    }
    case "stillstandskosten": {
      const f = get("finanzen");
      const rates = plant.machines.map((m) => m.costPerHour);
      const sg = plant.machines.find((m) => m.type === "SG");
      const mo = sg && maintenanceOptions(plant, sg);
      return (
        [
          `Eine Stunde Stillstand kostet uns je nach Maschine **${fmtEur(Math.min(...rates))} bis ${fmtEur(Math.max(...rates))}** (entgangener Deckungsbeitrag, Personal, Anlaufverluste).`,
          "",
          ...(mo ? [`- Ungeplanter Lagerschaden an einer Spritzgießmaschine: **${fmtEur(mo.unplanned.costEur)}** (≈ ${mo.unplanned.durationH} h Stillstand + Ersatzteile) – geplante Wartung dagegen **${fmtEur(mo.planned.costEur)}**.`] : []),
          ...(f ? [`- Heute bisher: Verlust durch Stillstand und Ausschuss **${f.heute.verlust}** · 30 Tage: ${f.verlust_entgangener_db}`] : []),
          "",
          `Empfehlung: Ausfälle früh erkennen und Wartung planen – jeder vermiedene Ausfall spart rund ${fmtEur(mo ? mo.unplanned.costEur - mo.planned.costEur : 15000)}.`,
        ].join("\n") + cite
      );
    }
    case "hallo": {
      const w = get("werk_uebersicht")!;
      return `Hallo! Hier ist die **KI des Werks Nord**.\n\nKurz zum Werk: ${oneLiner(w)}.\n\nWas möchtest du wissen?`;
    }
    case "danke":
      return "Gern geschehen! Sag Bescheid, wenn ich noch etwas prüfen soll – ich behalte das Werk im Blick.";
    case "ablehnen":
      return "Alles klar – ich lege nichts an. Der KI-Wächter beobachtet weiter und meldet sich, wenn sich die Lage verschärft. Was kann ich sonst für dich prüfen?";
    case "begriff": {
      return explainTerm(plant, p.term!, get, card) + cite;
    }
    case "about": {
      const w = get("werk_uebersicht")!;
      return [
        `**Ich bin der KI-Werksexperte des Werks Nord des Unternehmens.**`,
        "",
        `Ich bin an SAP, MES, OPC-UA-Sensorik, CAQ/Kamera, WMS, TMS, Yard-Management und die Dokumentenbasis angebunden und arbeite mit **${Object.keys(TOOL_META).length} Werkzeugen**. Jede Zahl kommt aus diesen Systemen – nicht aus dem Internet.`,
        "",
        "- **Produktion & Maschinen:** Status, OEE, Ausfallprognosen, KI-Wächter mit Frühwarnungen",
        "- **Qualität:** Ausschuss, SPC, Cpk, Kameraprüfung",
        "- **Vertrieb:** Liefertermine, Machbarkeit von Eilaufträgen, Kundenakten",
        "- **Logistik:** Material-Reichweiten, Fertigwaren, LKW-Hof und Zeitfenster",
        "- **Management:** Berichte, Finanzen, Risiko-Radar, Was-wäre-wenn im digitalen Zwilling",
        "- **Handeln:** Wartung, Umplanung, Bestellung, Maßnahmen – immer nur als Entwurf, ein Mensch gibt frei",
        "",
        `Gerade jetzt: ${oneLiner(w)}. Frag mich per Chat oder am **KI-Telefon**.`,
      ].join("\n");
    }
    case "firma": {
      const w = get("werk_uebersicht")!;
      const sg = plant.machines.filter((m) => m.type === "SG").map((m) => m.id);
      const tf = plant.machines.filter((m) => m.type === "TF").map((m) => m.id);
      const blind = Object.keys(PHASE2_SEED).filter((id) => !plant.findMachine(id));
      const countries = new Set(CUSTOMERS.map((c) => c.country)).size;
      return [
        `**Unternehmen · Werk Nord** – Kunststoffverpackungen für die Lebensmittelindustrie.`,
        "",
        `- **Halle A · Spritzguss mit IML:** ${sg.join(", ")} angebunden${blind.length ? `; ${blind.join(", ")} laufen noch ohne Datenanschluss (Phase 2)` : ""}`,
        `- **Halle B · Thermoformen:** ${tf.join(", ")}`,
        `- **Produkte:** ${PRODUCTS.map((p) => p.short).join(", ")}`,
        `- **Kunden:** ${CUSTOMERS.length} Kunden in ${countries} Ländern – Molkereien, Feinkost, Desserts, Speiseeis (u. a. ${CUSTOMERS.slice(0, 3).map((c) => c.name).join(", ")})`,
        `- **Jetzt:** ${oneLiner(w)} · Liefertreue ${w.liefertreue_30_tage}`,
        "",
        "Frag mich zu jeder Maschine, jedem Auftrag oder Kunden – ich antworte mit den Live-Daten.",
      ].join("\n");
    }
    case "personal": {
      return [
        "**Leistungsdaten von Personen werte ich bewusst nicht aus.** Ich arbeite nur mit Maschinen-, Prozess- und Geschäftsdaten – so ist es in der KI-Richtlinie mit dem Betriebsrat vereinbart (DSGVO, Mitbestimmung).",
        "",
        ...docs.slice(0, 2).map((d) => `- **${d.abschnitt}** – ${d.inhalt} [${String(d.quelle).split(" – ")[0]}]`),
        "",
        "Was ich dir sagen kann: wie die Schicht läuft, welche Maschine Unterstützung braucht und wo Personal am meisten bewirkt.",
      ].join("\n");
    }
    case "offtopic": {
      const w = get("werk_uebersicht")!;
      return [
        "Dazu habe ich keine Daten – ich bin **die KI für das Werk Nord**, und antworte nur mit Werks- und Unternehmensdaten.",
        "",
        `Kurz zum Werk: ${oneLiner(w)}.`,
        "",
        `Frag mich zum Beispiel: „Was sind gerade die größten Risiken?“ oder „Wie läuft die ${w.schicht}?“`,
      ].join("\n");
    }
    case "blind": {
      const g = get("ki_waechter");
      const ids = (g?.ohne_datenanschluss as string[] | undefined) ?? Object.keys(PHASE2_SEED);
      const s = Object.values(PHASE2_SEED).find((x) => ids.includes(x.id));
      return [
        `**Diese Maschine ist noch nicht an die KI angebunden.** In Halle A laufen ${ids.length} Maschinen (${ids.join(", ")}) ohne Datenanschluss – sie produzieren, aber ich sehe weder Zustand noch Ausbringung.`,
        "",
        s ? `- Beispiel ${s.id}: ${s.maker} ${s.model}, fertigt ${PRODUCT[s.productId]?.short ?? "–"}` : "",
        "- Ohne Daten keine Prognose: Ein Lagerschaden dort käme ohne Vorwarnung.",
        "- Anbindung über OPC UA dauert in der Demo einen Klick: Produktion → Maschine wählen → „Jetzt anbinden“.",
        "",
        "Empfehlung: Phase 2 starten – die Maschinen mit dem höchsten Auftragswert zuerst anbinden.",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "unbekannt": {
      const w = get("werk_uebersicht");
      const r = get("risiko_radar");
      const items = (r?.risiken as D[] | undefined) ?? [];
      if (docs.length)
        return [
          "Dazu steht in unserer Dokumentation:",
          "",
          ...docs.slice(0, 2).map((d) => `- **${d.abschnitt}** – ${d.inhalt} [${String(d.quelle).split(" – ")[0]}]`),
          ...(w ? ["", `Aktuell im Werk: ${oneLiner(w)}.`] : []),
        ].join("\n");
      return [
        "Dazu habe ich keine eigene Auswertung gefunden – so steht das Werk gerade da:",
        "",
        ...(w ? [`- ${oneLiner(w)} · Ausschuss ${w.ausschussquote}`] : []),
        ...items.slice(0, 2).map((x) => `- Risiko: **${x.risiko}** – ${x.wahrscheinlichkeit}, erwartet ${x.erwarteter_verlust}`),
        "",
        "Frag mich gern konkreter – z. B. zu einer Maschine („Wie geht es SG-04?“), einem Kunden, einem Auftrag, Material, LKW oder Finanzen.",
      ].join("\n");
    }
  }
  return "Dazu habe ich keine passende Auswertung.";
}

/** Fachbegriff erklären – immer mit dem aktuellen Wert aus dem Werk */
function explainTerm(plant: Plant, term: string, get: (n: string) => D, card: (n: string) => D): string {
  switch (term) {
    case "oee": {
      const w = get("werk_uebersicht");
      const ms = ((get("maschinen_status") as D[]) ?? []).filter((m) => m.status === "PRODUKTION").sort((a, b) => pnum(b.oee_heute) - pnum(a.oee_heute));
      return [
        `**OEE (Gesamtanlageneffektivität)** = Verfügbarkeit × Leistung × Qualität – also wie viel Gutteile eine Maschine im Verhältnis zum theoretischen Maximum macht.`,
        "",
        `- **Bei uns gerade: ${w?.oee ?? "–"}** im ganzen Werk (Weltklasse liegt bei etwa 85 %)`,
        ...(ms.length ? [`- Beste Maschine heute: **${ms[0].id}** mit ${ms[0].oee_heute} · schwächste: **${ms[ms.length - 1].id}** mit ${ms[ms.length - 1].oee_heute}`] : []),
        "",
        `Empfehlung: An ${ms.length ? ms[ms.length - 1].id : "der schwächsten Maschine"} ansetzen – Stillstände und Kurzstopps zuerst, dort ist der Hebel am größten.`,
      ].join("\n");
    }
    case "cpk": {
      const q = get("qualitaetsbericht");
      const ms = ((q?.maschinen as D[]) ?? []).sort((a, b) => pnum(a.cpk) - pnum(b.cpk));
      return [
        `**Cpk (Prozessfähigkeit)** zeigt, wie sicher ein Prozess innerhalb der Toleranz bleibt. Ab **1,33** gilt er als fähig, unter **1,0** entsteht sicher Ausschuss.`,
        "",
        ...(ms.length ? [`- Niedrigster Cpk bei uns: **${ms[0].id}** (${ms[0].produkt}) mit **${ms[0].cpk}**`, `- Höchster: **${ms[ms.length - 1].id}** mit ${ms[ms.length - 1].cpk}`] : []),
        "",
        ms.length && pnum(ms[0].cpk) < 1.33 ? `Empfehlung: ${ms[0].id} stabilisieren – Ursache über die SPC-Karte eingrenzen.` : "Empfehlung: Alle Prozesse fähig – keine Maßnahme nötig.",
      ].join("\n");
    }
    case "spc": {
      const q = get("qualitaetsbericht");
      const v = ((q?.maschinen as D[]) ?? []).filter((m) => m.spc_regelverletzung !== "keine");
      return [
        `**SPC (Statistische Prozesslenkung)** überwacht Messwerte auf Regelkarten und schlägt an, bevor Ausschuss entsteht. Bei uns gelten: ${q?.spc_regeln ?? "R1, R2, R3 und EWMA"}.`,
        "",
        v.length ? `- Aktuell verletzt: ${v.map((m) => `**${m.id}** (Regel ${m.spc_regelverletzung})`).join(", ")}` : "- Aktuell keine Regelverletzung – alle Prozesse stabil.",
        "- Die EWMA-Karte erkennt kleine, schleichende Verschiebungen – z. B. einen langsam wandernden Etikettenversatz.",
      ].join("\n");
    }
    case "rul": {
      const r = (get("wartungsprognose") as D[]) ?? [];
      return [
        `**RUL (Remaining Useful Life)** ist die geschätzte Restlaufzeit bis zur Schadensgrenze – bei uns aus dem Schwingungstrend der Spindellager.`,
        "",
        ...r.slice(0, 3).map((x) => `- **${x.id}**: ${x.restlaufzeit} · Ausfallrisiko 72 h ${x.ausfallrisiko_72h}`),
        "",
        "Empfehlung: Wartung so legen, dass sie vor dem Ende der Restlaufzeit und möglichst in einen Rüst- oder Schichtwechsel fällt.",
      ].join("\n");
    }
    case "iml": {
      const q = get("qualitaetsbericht");
      const iml = PRODUCTS.filter((p) => p.iml);
      const ev = ((q?.fehler_pareto as D[]) ?? []).find((f) => /etikett/i.test(f.fehlerart));
      return [
        `**IML (In-Mould-Labeling):** Das Etikett wird ins Werkzeug eingelegt und beim Spritzgießen mit dem Becher verschmolzen – fälschungssicher, spülmaschinenfest, ohne Kleber.`,
        "",
        `- Bei uns: ${iml.map((p) => p.short).join(", ")} auf ${[...new Set(iml.flatMap((p) => p.machines))].join(", ")}`,
        `- Häufigster IML-Fehler: Etikettenversatz${ev ? ` – heute **${ev.stueck} Stk**` : ""} (Toleranz ±0,4 mm, per Inline-Kamera geprüft)`,
      ].join("\n");
    }
    case "iso": {
      const r = (get("wartungsprognose") as D[]) ?? [];
      const bad = r.filter((x) => x.zone !== "A");
      return [
        `**ISO 10816-3** bewertet Maschinenschwingung in Zonen: **A** neuwertig, **B** unbegrenzter Dauerbetrieb, **C** nur eingeschränkt, **D** Schadensgefahr.`,
        "",
        bad.length ? `- Bei uns außerhalb Zone A: ${bad.slice(0, 4).map((x) => `**${x.id}** (Zone ${x.zone})`).join(", ")}` : "- Bei uns laufen alle Maschinen in Zone A.",
        "- Die KI warnt nicht erst an der Zonengrenze, sondern schon beim steigenden Trend (Frühwarnung).",
      ].join("\n");
    }
    case "pm": {
      const r = (get("wartungsprognose") as D[]) ?? [];
      return [
        `**Predictive Maintenance** heißt: warten, wenn die Daten es sagen – nicht nach Kalender und nicht erst nach dem Ausfall.`,
        "",
        r[0] ? `- Bei uns gerade: höchstes Risiko **${r[0].id}** mit ${r[0].ausfallrisiko_72h} in 72 h (Zone ${r[0].zone}, RUL ${r[0].restlaufzeit})` : "",
        `- Geplante Wartung kostet bei uns rund 4.800 €, ein ungeplanter Lagerschaden rund 19.800 €.`,
        `- Unser Modell ${plant.model.card.version} erkennt Ausfälle mit Recall ${Math.round(plant.model.card.metrics.recall * 100)} %.`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "zwilling": {
      const w = get("werk_uebersicht");
      return [
        `**Der digitale Zwilling** ist das virtuelle Abbild unseres Werks – echte Gebäude, Hallen, Maschinen und LKW-Wege rund ums Werk, gespeist mit Live-Daten.`,
        "",
        `- Gerade abgebildet: ${w ? oneLiner(w) : "alle angebundenen Maschinen"}`,
        "- Mit Was-wäre-wenn rechnet er 72 h in die Zukunft – ohne und mit Maßnahme, ohne den Live-Betrieb zu stören.",
        "",
        "Frag mich z. B.: „Was passiert, wenn wir bei SG-04 nichts tun?“",
      ].join("\n");
    }
    case "db": {
      const f = get("finanzen");
      return [
        `**Deckungsbeitrag** = Umsatz minus variable Kosten (Material, Energie, Fracht) – das Geld, das die Fixkosten deckt.`,
        "",
        f ? `- Bei uns in 30 Tagen: Umsatz **${f.umsatz}**, Deckungsbeitrag **${f.deckungsbeitrag}**, Ergebnis nach Fixkosten **${f.ergebnis_nach_fixkosten}**` : "",
        f ? `- Heute: DB **${f.heute.deckungsbeitrag}**, entgangen durch Stillstand und Ausschuss **${f.heute.verlust}**` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "liefertreue": {
      const w = get("werk_uebersicht");
      const a = get("auftraege_suchen");
      return [
        `**Liefertreue** = Anteil der Lieferungen, die pünktlich beim Kunden ankommen.`,
        "",
        `- Bei uns (30 Tage): **${w?.liefertreue_30_tage ?? "–"}**`,
        `- Aktuell mit Terminrisiko: **${a?.anzahl ?? 0} Aufträge**${a?.auftraege?.[0] ? ` – zuerst ${a.auftraege[0].id} (${a.auftraege[0].kunde}, ${a.auftraege[0].termintreue_wahrscheinlichkeit} pünktlich)` : ""}`,
      ].join("\n");
    }
    case "hitl": {
      const w = get("werk_uebersicht");
      const n = (w?.ki_vorschlaege_zur_freigabe as string[] | undefined)?.length ?? 0;
      return [
        `**Human-in-the-Loop** heißt: Die KI schlägt vor, ein Mensch entscheidet. Die KI legt Wartungen, Umplanungen und Bestellungen nur als Entwurf an.`,
        "",
        `- Gerade warten **${n} Vorschläge** auf Freigabe.`,
        "- Jede Entscheidung wird protokolliert – so lernt das Modell und die Verantwortung bleibt beim Fachbereich.",
      ].join("\n");
    }
  }
  void card;
  return "Dazu habe ich keine Erklärung.";
}

// ---------------- gesprochene Fassung (KI-Telefon) ----------------

function speech(plant: Plant, p: Plan, outs: Out[], text: string): string {
  const get = (n: string): D => outs.find((o) => o.name === n)?.out?.data;
  const card = (n: string): D => outs.find((o) => o.name === n)?.out?.card?.data;
  const s = (x: string) => plainText(x);
  try {
    switch (p.intent) {
      case "briefing": {
        const w = get("werk_uebersicht");
        const top = (get("wartungsprognose") as D[] | undefined)?.[0];
        const down = (w.maschinen_nicht_in_produktion as string[]).map((x) => x.split(":")[0]);
        return s(
          `${w.schicht}: ${w.maschinen_in_produktion} Maschinen laufen, die OEE liegt bei ${w.oee}, heute ${w.ausbringung_heute_stk} Stück. ` +
            (down.length ? `Nicht in Produktion: ${down.join(", ")}. ` : "") +
            (w.auftraege_mit_terminrisiko ? `${w.auftraege_mit_terminrisiko} Aufträge haben ein Terminrisiko. ` : "Alle Aufträge liegen im Termin. ") +
            (top && parseInt(top.ausfallrisiko_72h) >= 45 ? `Mein Hinweis: ${top.id} hat ${top.ausfallrisiko_72h} Ausfallrisiko in 72 Stunden – ich würde die Wartung einplanen.` : "Akut ist nichts zu tun."),
        );
      }
      case "risiken": {
        const r = get("risiko_radar");
        const x = (r.risiken as D[])[0];
        if (!x) return s(`Die Lage ist stabil. In den nächsten 72 Stunden sehe ich kein relevantes Risiko.${r.datenluecken !== "keine" ? " Nur ein blinder Fleck: In Halle A senden einige Maschinen noch keine Daten." : ""}`);
        return s(
          `Die Lage ist ${r.lage}. Größtes Risiko: ${x.risiko}. Wahrscheinlichkeit ${x.wahrscheinlichkeit}, erwarteter Verlust ${x.erwarteter_verlust}. Ursache: ${String(x.ursache).split(" – ")[0]}. Meine Empfehlung: ${x.empfehlung.split(" – ")[0].replace(/\s*\((?:Mo|Di|Mi|Do|Fr|Sa|So)\.,[^)]*\)/g, "")}. ` +
            `Insgesamt drohen ${r.erwarteter_verlust_72h} in 72 Stunden, mit den Maßnahmen nur ${r.mit_empfohlenen_massnahmen}. Soll ich die erste Maßnahme vorbereiten?`,
        );
      }
      case "whatif": {
        const w = get("was_waere_wenn");
        const r = card("was_waere_wenn");
        if (w.massnahme === "keine Maßnahme") return s(`${w.maschine} läuft unauffällig. Ich habe die nächsten 72 Stunden durchgerechnet: kein Ausfall, keine Maßnahme nötig.`);
        const o = w.ohne_massnahme;
        return s(
          `Ich habe die nächsten 72 Stunden für ${w.maschine} zweimal durchgerechnet. Ohne Maßnahme: ${o.ausfaelle ? `Ausfall ${o.erster_ausfall}, ` : ""}Verlust ${o.verlust}. Mit ${w.massnahme}: Verlust ${w.mit_massnahme.verlust}. ` +
            (r && r.without.lossEur > r.with.lossEur
              ? `Das spart ${w.ersparnis}${/^0,0/.test(w.weniger_stillstand) ? "" : ` und ${w.weniger_stillstand} Stillstand`}. Soll ich den Entwurf anlegen?`
              : "Die Maßnahme lohnt sich in diesem Zeitraum nicht."),
        );
      }
      case "waechter": {
        const w = get("ki_waechter");
        const m = (w.maschinen as D[]).find((x) => (x.befunde as D[]).length);
        if (!m) return s("Der KI-Wächter sieht gerade keine Auffälligkeiten. Alle Maschinen laufen im Normalbereich.");
        const f = m.befunde[0];
        return s(
          `Ich sehe ${w.befunde} ${w.befunde === 1 ? "Befund" : "Befunde"}. Am wichtigsten: ${m.maschine}, ${f.titel}. ${f.ursache}. Eintrittswahrscheinlichkeit ${f.wahrscheinlichkeit_72h}, drohender Verlust ${f.verlust_72h}. ` +
            (f.empfehlung ? `Meine Empfehlung: ${f.empfehlung.massnahme}, ${f.empfehlung.wann}. Soll ich das als Entwurf anlegen?` : ""),
        );
      }
      case "prognose":
      case "maschine":
      case "wartung_anlegen": {
        const pr = get("wartungsprognose");
        const t = get("wartung_vorschlagen");
        const risk = parseInt(pr.ausfallwahrscheinlichkeit_72h);
        const id = String(pr.maschine).split(" – ")[0];
        return s(
          `${id}: Ausfallrisiko ${pr.ausfallwahrscheinlichkeit_72h} in 72 Stunden, Zustand ${pr.zustandsindex_0_100} von 100, Schwingungszone ${pr.iso_10816_zone}. ` +
            (t ? `Ich habe den Wartungsauftrag ${t.ticket} als Entwurf angelegt. Die Instandhaltung muss ihn freigeben.` : risk >= 45 ? `Geplante Wartung kostet ${pr.kosten_geplante_wartung}, ein Ausfall ${pr.kosten_ungeplanter_ausfall}. Ich empfehle die Wartung – soll ich sie vorbereiten?` : "Kein akuter Handlungsbedarf."),
        );
      }
      case "aktion": {
        const t = get("massnahme_vorschlagen") ?? get("wartung_vorschlagen") ?? get("bestellung_vorschlagen") ?? get("umplanung_vorschlagen");
        if (!t) return s(text);
        if (String(t.status).startsWith("existiert")) return s(`Dafür gibt es schon den Vorgang ${t.ticket}. Ich lege nichts doppelt an.`);
        return s(`Erledigt. Der Entwurf ${t.ticket} ist angelegt: ${actionWhat(t)}. Freigeben muss ein Mensch – du findest ihn rechts unter Freigaben.`);
      }
      case "finanzen": {
        const f = get("finanzen");
        return s(`In den letzten ${f.zeitraum_tage} Tagen: Umsatz ${f.umsatz}, Deckungsbeitrag ${String(f.deckungsbeitrag).split(" (")[0]}, Ergebnis nach Fixkosten ${String(f.ergebnis_nach_fixkosten).split(" (")[0]}. Für den Monat rechne ich mit ${f.monat.prognose} gegenüber einem Budget von ${f.monat.budget}. Größter Hebel bleibt der Stillstandsverlust.`);
      }
      case "firma": {
        const sg = plant.machines.filter((m) => m.type === "SG").length;
        const tf = plant.machines.filter((m) => m.type === "TF").length;
        const blind = Object.keys(PHASE2_SEED).filter((id) => !plant.findMachine(id)).length;
        const w = get("werk_uebersicht");
        return s(`Unternehmen, Werk Nord: Wir fertigen IML-Becher, Deckel und thermogeformte Schalen für die Lebensmittelindustrie. Angebunden sind ${sg} Spritzgießmaschinen in Halle A und ${tf} Thermoformer in Halle B${blind ? `, ${blind} weitere laufen noch ohne Datenanschluss` : ""}. Wir beliefern ${CUSTOMERS.length} Kunden in ${new Set(CUSTOMERS.map((c) => c.country)).size} Ländern. Gerade: ${oneLiner(w)}.`);
      }
      case "kunde": {
        const k = get("kunde_info");
        const e = String(k.einschaetzung);
        return s(`${k.kunde} aus ${k.ort.split(" (")[0]}: Umsatz ${k.umsatz_30_tage} in 30 Tagen, Marge ${k.marge}, Rang ${k.rang_nach_umsatz}. ${e.charAt(0).toUpperCase() + e.slice(1)}.`);
      }
      case "warum": {
        const m = (get("ki_waechter").maschinen as D[])[0];
        const f = m?.befunde?.[0];
        if (!f) return s(`${m?.maschine ?? "Die Maschine"} zeigt keinen Befund, alle Prüfpunkte liegen im Normalbereich.`);
        return s(`${f.was_die_ki_sieht} Wahrscheinliche Ursache: ${String(f.ursache).split(" – ")[0]}. Ich bin mir zu ${f.sicherheit} sicher – die Daten kommen live aus der Sensorik über OPC UA. ${f.empfehlung ? `Deshalb empfehle ich: ${f.empfehlung.massnahme}.` : ""}`);
      }
      case "about":
        return s("Ich bin der KI-Werksexperte des Werks Nord. Ich kenne Maschinen, Aufträge, Kunden, Material, Logistik und Zahlen live aus SAP, MES und der Sensorik – und lege Maßnahmen nur als Entwurf an. Frag mich einfach.");
      case "hallo":
        return s(`Hallo, hier ist die KI des Werks. Kurz zum Werk: ${oneLiner(get("werk_uebersicht"))}. Was möchtest du wissen?`);
      case "offtopic": {
        const w = get("werk_uebersicht");
        return s(`Dazu habe ich keine Daten – ich bin die KI für das Werk Nord. Kurz zum Werk: ${oneLiner(w)}.`);
      }
    }
  } catch {
    // Fallback auf die allgemeine Kurzfassung
  }
  return toSpeech(text);
}

// ---------------- Ablauf ----------------

export async function* runOffline(plant: Plant, question: string, history: ChatTurn[] = [], voice = false): AsyncGenerator<AgentEvent> {
  yield { type: "status", mode: "offline", note: "Offline-Modus: regelbasierter Agent mit denselben Werkzeugen" };
  const ctx = context(plant, history);
  const p = plan(plant, question, ctx);
  const outs: Out[] = [];
  let i = 0;
  for (const s of p.steps) {
    const id = `off_${Date.now()}_${i++}`;
    const meta = TOOL_META[s.name];
    yield { type: "tool_start", id, name: s.name, label: meta.label, system: meta.system, input: s.input };
    await new Promise((r) => setTimeout(r, voice ? 160 + Math.random() * 160 : 380 + Math.random() * 380));
    const t0 = Date.now();
    try {
      const out = runTool(plant, s.name, s.input);
      outs.push({ name: s.name, out });
      yield { type: "tool_end", id, name: s.name, ok: true, summary: out.summary, card: out.card, ms: Date.now() - t0 + 40 };
    } catch (e) {
      outs.push({ name: s.name, error: (e as Error).message });
      yield { type: "tool_end", id, name: s.name, ok: false, summary: (e as Error).message, ms: Date.now() - t0 };
    }
  }
  const text = compose(plant, p, outs);
  if (voice) yield { type: "speech", text: speech(plant, p, outs, text) };
  // Wortweise ausgeben – wirkt wie Streaming
  const parts = text.split(/(\s+)/);
  for (let k = 0; k < parts.length; k += 3) {
    yield { type: "text", delta: parts.slice(k, k + 3).join("") };
    await new Promise((r) => setTimeout(r, voice ? 4 : 12));
  }
  yield { type: "done" };
}

/** nur für Tests: welche Absicht erkennt der Offline-Agent? */
export function offlineIntent(plant: Plant, question: string, history: ChatTurn[] = []) {
  return plan(plant, question, context(plant, history)).intent;
}
