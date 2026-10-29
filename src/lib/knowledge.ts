// Wissensbasis (RAG) mit fiktiven Beispieldokumenten + BM25-Suche.
// In der Realität: SharePoint/DMS, Wartungshandbücher, QM-Handbuch – indiziert in einer Vektor-/Hybridsuche.

export interface KnowledgeDoc {
  id: string;
  title: string;
  area: "Instandhaltung" | "Qualität" | "Vertrieb" | "Logistik" | "Produktion" | "Nachhaltigkeit" | "Governance";
  version: string;
  owner: string;
  sections: { heading: string; text: string }[];
}

export const DOCS: KnowledgeDoc[] = [
  {
    id: "IH-SG-012",
    title: "Wartungshandbuch Spritzgießmaschinen – Spindellager & Schwingungsüberwachung",
    area: "Instandhaltung",
    version: "3.2",
    owner: "Instandhaltung Halle A",
    sections: [
      {
        heading: "4.1 Grenzwerte nach ISO 10816-3",
        text: "Die Schwinggeschwindigkeit (RMS) am Spindellager wird kontinuierlich gemessen. Zone A bis 1,4 mm/s: Neuzustand. Zone B bis 2,8 mm/s: unbeschränkter Dauerbetrieb. Zone C bis 4,5 mm/s: eingeschränkter Betrieb, Wartung innerhalb von 72 Stunden planen. Zone D über 4,5 mm/s: Schadensgefahr, Maschine abstellen.",
      },
      {
        heading: "4.2 Vorgehen bei steigendem Schwingungstrend",
        text: "Steigt die Schwingung um mehr als 0,1 mm/s pro Stunde, ist von fortschreitendem Lagerverschleiß auszugehen. Maßnahme: Schmierzustand prüfen, Lagertemperatur kontrollieren, Lagertausch als geplante Wartung einplanen – bevorzugt zum Schichtwechsel oder beim nächsten Werkzeugwechsel. Ein geplanter Lagertausch dauert ca. 1,5 Stunden.",
      },
      {
        heading: "4.3 Ersatzteile",
        text: "Spindellager-Set ELION 3200 (Mat.-Nr. 400-118-22) und e-speed 420 (Mat.-Nr. 400-120-07) sind je zweimal am Lager. Wiederbeschaffungszeit 5 Arbeitstage. Bei ungeplantem Lagerschaden sind Folgeschäden an Spindel und Kupplung möglich; Reparaturdauer dann 4 bis 6 Stunden.",
      },
    ],
  },
  {
    id: "IH-KO-004",
    title: "Kostenansätze für Stillstände und Instandhaltung",
    area: "Instandhaltung",
    version: "1.4",
    owner: "Controlling",
    sections: [
      {
        heading: "Stillstandskosten",
        text: "Für die Bewertung von Stillständen gilt der entgangene Deckungsbeitrag je Maschinenstunde: Spritzgießmaschinen 1.290 bis 1.650 €/h, Thermoformer 1.540 bis 1.720 €/h. Ungeplante Stillstände verursachen zusätzlich Kosten für Eilteile, Überstunden und Anfahrausschuss von durchschnittlich 2.100 €.",
      },
      {
        heading: "Geplante vs. ungeplante Wartung",
        text: "Ein geplanter Lagertausch kostet inklusive Material ca. 2.400 € zuzüglich 1,5 h Stillstand. Ein ungeplanter Lagerschaden kostet erfahrungsgemäß 9.800 € Material und Fremdleistung zuzüglich ca. 5 h Stillstand. Vorausschauende Wartung lohnt sich daher in fast allen Fällen.",
      },
    ],
  },
  {
    id: "QS-IML-007",
    title: "Fehlerkatalog IML – Etikettenversatz und Etikettenfehler",
    area: "Qualität",
    version: "2.0",
    owner: "Qualitätssicherung",
    sections: [
      {
        heading: "Fehlerbild Etikettenversatz",
        text: "Das In-Mould-Label liegt nicht exakt am Formkern an und ist im fertigen Becher verschoben oder verdreht. Toleranz: ±0,4 mm Versatz. Größere Abweichungen gelten als Ausschuss, da das Dekor sichtbar schief ist und die Siegelzone betroffen sein kann.",
      },
      {
        heading: "Häufigste Ursachen",
        text: "1. Vakuumverlust am Greifer des IML-Roboters (Saugnapf verschlissen, Leckage). 2. Elektrostatische Aufladung zu schwach – Etikett haftet nicht am Kern. 3. Etikettenmagazin falsch eingestellt oder Etikettenstapel verzogen. 4. Positionsversatz des Roboters nach Werkzeugwechsel.",
      },
      {
        heading: "Maßnahmen",
        text: "Bei schleichender Drift zuerst Vakuumwerte und Saugnäpfe des Greifers prüfen (Dauer ca. 20 bis 45 Minuten). Danach Aufladeelektrode reinigen. Betroffene Teile seit Beginn der Drift sind zu sperren und per 100-%-Kamerakontrolle nachzusortieren.",
      },
    ],
  },
  {
    id: "QS-SPC-002",
    title: "Qualitätsrichtlinie: Statistische Prozesslenkung (SPC)",
    area: "Qualität",
    version: "4.1",
    owner: "Qualitätssicherung",
    sections: [
      {
        heading: "Regelkarten",
        text: "Für jedes kritische Merkmal wird eine Mittelwertkarte geführt (Stichprobe n=5). Eingriffsgrenzen liegen bei ±3 Sigma um den Sollwert. Ziel ist ein Prozessfähigkeitsindex Cpk von mindestens 1,33.",
      },
      {
        heading: "Eingriffsregeln",
        text: "Regel 1: Ein Punkt außerhalb der Eingriffsgrenzen. Regel 2: Neun aufeinanderfolgende Punkte auf einer Seite der Mittellinie (Lageverschiebung). Regel 3: Sieben Punkte in Folge steigend oder fallend (Trend). Zusätzlich überwacht eine EWMA-Karte (λ = 0,2) kleine, schleichende Verschiebungen. Bei Regel 2 und 3 ist der Prozess zu prüfen, obwohl noch kein Ausschuss vorliegt – so werden Fehler verhindert statt aussortiert.",
      },
    ],
  },
  {
    id: "QS-SPR-011",
    title: "Sperr- und Freigabeprozess für Fertigungslose",
    area: "Qualität",
    version: "2.3",
    owner: "Qualitätssicherung",
    sections: [
      {
        heading: "Sperrung",
        text: "Besteht der Verdacht auf fehlerhafte Ware, wird das betroffene Los im CAQ gesperrt. Die Sperre ist mit Fehlerbild, Zeitraum und Maschine zu dokumentieren. Gesperrte Ware darf nicht versendet werden.",
      },
      {
        heading: "Freigabe",
        text: "Jedes fertige Los durchläuft eine Prüfung nach Prüfplan (ca. 45 Minuten). Erst nach Freigabe wird die Ware versandbereit gemeldet. Für Lebensmittelverpackungen gelten zusätzlich die Anforderungen der Verordnung (EU) Nr. 10/2011.",
      },
    ],
  },
  {
    id: "VT-RL-003",
    title: "Vertriebsrichtlinie: Eilaufträge und Lieferzusagen",
    area: "Vertrieb",
    version: "1.8",
    owner: "Vertriebsleitung",
    sections: [
      {
        heading: "Lieferzusage",
        text: "Liefertermine werden nur nach Kapazitätsprüfung (Capable-to-Promise) zugesagt. Berücksichtigt werden Maschinenbelegung, Material inklusive Zulauf, Qualitätsfreigabe (ca. 45 min) und Transportzeit. Eilaufträge dürfen bestehende Zusagen anderer Kunden nicht gefährden, ohne dass die Vertriebsleitung zustimmt.",
      },
      {
        heading: "Eilzuschlag und Teilmengen",
        text: "Für Eilaufträge mit weniger als 5 Arbeitstagen Vorlauf kann ein Zuschlag von 6 bis 8 % vereinbart werden. Ist die Gesamtmenge nicht rechtzeitig darstellbar, wird dem Kunden eine Teillieferung zum Wunschtermin und die Restmenge mit verbindlichem Folgetermin angeboten.",
      },
    ],
  },
  {
    id: "LG-NP-005",
    title: "Notfallplan Rohstoffversorgung (Granulat und Folie)",
    area: "Logistik",
    version: "2.1",
    owner: "Einkauf & Logistik",
    sections: [
      {
        heading: "Meldebestand",
        text: "Der Meldebestand für Granulat liegt bei 3 Tagesbedarfen, für Folie bei 4 Tagesbedarfen. Wird er unterschritten, ist umgehend eine Bestellung auszulösen. Unter 1,5 Tagen Reichweite wird der Notfallplan aktiviert.",
      },
      {
        heading: "Maßnahmen bei Lieferverzug",
        text: "1. Expressbestellung beim freigegebenen Alternativlieferanten Polymer Trade Benelux (Lieferzeit ca. 20 Stunden, Aufpreis ca. 9 %). 2. Produktion nach Kundenpriorität und Liefertermin reihen. 3. Materialwechsel auf alternative Typen nur nach Freigabe durch die Qualitätssicherung, da IML-Becher Random-Copolymer benötigen.",
      },
    ],
  },
  {
    id: "LG-VS-009",
    title: "Versandrichtlinie und Speditionssteuerung",
    area: "Logistik",
    version: "1.2",
    owner: "Versand",
    sections: [
      {
        heading: "Ladeslots",
        text: "Der Versand verfügt über sechs Verladetore. Ladeslots werden im Speditionsportal gebucht. Die Beladung beginnt ca. 45 Minuten vor Abfahrt. Für die Transportzeitplanung gilt eine Durchschnittsgeschwindigkeit von 65 km/h zuzüglich Pausen.",
      },
      {
        heading: "Hygiene",
        text: "Lebensmittelverpackungen werden ausschließlich in sauberen, geruchsneutralen Fahrzeugen transportiert. Paletten werden foliert und mit Los-Etikett (GS1-128) versehen.",
      },
    ],
  },
  {
    id: "PR-RU-014",
    title: "Rüstanleitung Werkzeugwechsel (SMED)",
    area: "Produktion",
    version: "2.6",
    owner: "Produktionsleitung",
    sections: [
      {
        heading: "Zielzeiten",
        text: "Ein Werkzeugwechsel an IML-Spritzgießzellen soll 60 bis 90 Minuten dauern. Externe Rüstschritte wie Vorwärmen des Werkzeugs und Bereitstellen der Etiketten erfolgen vor dem Stopp der Maschine. Wartungsarbeiten sollten mit Rüstvorgängen kombiniert werden.",
      },
    ],
  },
  {
    id: "PR-TF-010",
    title: "Thermoformen: Folienriss und Heizfeldstörungen",
    area: "Produktion",
    version: "1.5",
    owner: "Produktion Halle B",
    sections: [
      {
        heading: "Folienriss",
        text: "Folienrisse entstehen meist durch zu hohe Heiztemperatur, Feuchtigkeit in der Folie oder beschädigte Kettenführungen. Maßnahme: Heizfeldtemperatur prüfen, Folie konditionieren, Einzug kontrollieren.",
      },
      {
        heading: "Wandstärke",
        text: "Die Bodenwandstärke ist das kritische Merkmal bei Joghurtbechern. Sie wird über Vorstreckstempel und Formluft beeinflusst. Abweichungen größer 0,05 mm führen zu Stabilitätsproblemen beim Stapeln.",
      },
    ],
  },
  {
    id: "NH-RZ-001",
    title: "Nachhaltigkeit: Rezyklateinsatz und Design for Recycling",
    area: "Nachhaltigkeit",
    version: "1.1",
    owner: "Nachhaltigkeitsmanagement",
    sections: [
      {
        heading: "Ziele",
        text: "Die EU-Verpackungsverordnung (PPWR) fordert recyclingfähige Verpackungen und Mindestrezyklatanteile. Monomaterial-Lösungen aus PP mit IML-Etikett aus PP sind gut recyclingfähig. Energieverbrauch und CO2-Fußabdruck je 1.000 Teile werden pro Maschine ausgewiesen.",
      },
    ],
  },
  {
    id: "EN-EM-003",
    title: "Energiemanagement nach ISO 50001",
    area: "Nachhaltigkeit",
    version: "2.0",
    owner: "Energiemanagement",
    sections: [
      {
        heading: "Kennzahlen",
        text: "Wichtigste Kennzahl ist der spezifische Energieverbrauch in kWh je 1.000 Teile. Ein Mehrverbrauch einer Maschine von über 5 % gegenüber der Basis weist häufig auf Verschleiß, Leckagen in der Hydraulik oder falsche Temperierung hin.",
      },
    ],
  },
  {
    id: "GV-KI-001",
    title: "KI-Richtlinie (Entwurf): Einsatz von KI-Systemen im Unternehmen",
    area: "Governance",
    version: "0.9",
    owner: "IT & Geschäftsführung",
    sections: [
      {
        heading: "Grundsätze",
        text: "KI-Systeme unterstützen Entscheidungen, sie treffen keine verbindlichen Entscheidungen allein. Alle Aktionen mit Wirkung auf Produktion, Bestellungen oder Kunden erfordern eine Freigabe durch einen Menschen (Human-in-the-Loop). Empfehlungen müssen nachvollziehbar begründet werden.",
      },
      {
        heading: "Datenschutz und Mitbestimmung",
        text: "Es werden ausschließlich Maschinen-, Prozess- und Geschäftsdaten verarbeitet, keine Leistungsdaten einzelner Beschäftigter. Vor Einführung neuer KI-Systeme wird der Betriebsrat beteiligt. Die Anforderungen der EU-KI-Verordnung (AI Act) und der DSGVO werden geprüft und dokumentiert.",
      },
    ],
  },
];

// ---------------- BM25 ----------------

const STOP = new Set(
  "der die das und oder ein eine einer eines einem einen ist sind wird werden wurde zu zum zur im in am an auf aus bei mit nach von vor für über unter bis als auch nicht nur noch wie was wer wann wo welche welcher welches sich es ich du wir ihr sie man kann können soll sollte muss müssen dem den des dass da so dann wenn ob um durch gegen ohne sehr mehr ca bzw z b".split(" "),
);

function stem(w: string) {
  return w
    .replace(/(ungen|ung|heit|keit|lich|isch|ern|en|er|es|e|n|s)$/u, "")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss");
}

export function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\- ]+/gu, " ")
    .split(/[\s\-]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem)
    .filter((w) => w.length > 1);
}

interface Chunk {
  docId: string;
  title: string;
  area: string;
  heading: string;
  text: string;
  tokens: string[];
}

const CHUNKS: Chunk[] = DOCS.flatMap((d) =>
  d.sections.map((s) => ({ docId: d.id, title: d.title, area: d.area, heading: s.heading, text: s.text, tokens: tokenize(`${d.title} ${s.heading} ${s.text}`) })),
);
const N = CHUNKS.length;
const avgLen = CHUNKS.reduce((s, c) => s + c.tokens.length, 0) / N;
const df = new Map<string, number>();
for (const c of CHUNKS) for (const t of new Set(c.tokens)) df.set(t, (df.get(t) ?? 0) + 1);

export interface SearchHit {
  docId: string;
  title: string;
  area: string;
  heading: string;
  text: string;
  score: number;
}

export function searchKnowledge(query: string, k = 3): SearchHit[] {
  const q = tokenize(query);
  const k1 = 1.4;
  const b = 0.75;
  const scored = CHUNKS.map((c) => {
    let score = 0;
    for (const term of q) {
      const f = c.tokens.filter((t) => t === term || (term.length > 4 && t.startsWith(term))).length;
      if (!f) continue;
      const n = df.get(term) ?? 1;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * c.tokens.length) / avgLen));
    }
    return { docId: c.docId, title: c.title, area: c.area, heading: c.heading, text: c.text, score };
  });
  return scored
    .filter((s) => s.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
