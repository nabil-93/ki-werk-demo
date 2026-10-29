import type { ScenarioId } from "./types";

export const SCENARIO_INFO: Record<ScenarioId, { title: string; short: string; area: string; desc: string; watch: string; href: string; ask: string }> = {
  lager: {
    title: "Lagerschaden an SG-04",
    short: "Predictive Maintenance",
    area: "Produktion",
    desc: "Das Spindellager der Netstal ELION 3200 (SG-04) beginnt zu verschleißen. Die Schwingung steigt langsam – für das Auge unsichtbar. Das KI-Modell erkennt den Trend und warnt Stunden vor dem Ausfall.",
    watch: "Nach ca. 1–2 Minuten: KI-Warnung, Risiko steigt, Liefertermine auf SG-04 werden gelb.",
    href: "/waechter?tab=akte&m=SG-04",
    ask: "Wie kritisch ist SG-04 und wann sollten wir die Wartung machen?",
  },
  etikett: {
    title: "Etikettenversatz an SG-02",
    short: "Qualitätskontrolle",
    area: "Qualität",
    desc: "Der Greifer des IML-Roboters an SG-02 verliert Vakuum: Etiketten werden zunehmend versetzt eingelegt. SPC-Regeln erkennen die Drift, bevor Ausschuss entsteht – danach sieht es auch die Kamera.",
    watch: "SPC-Karte driftet nach oben, Regel R2/R3 schlägt an, danach steigt Etikettenversatz in der Kamera.",
    href: "/qualitaet?m=SG-02",
    ask: "Warum steigt der Ausschuss an SG-02 und was sollen wir tun?",
  },
  eilauftrag: {
    title: "Eilauftrag Alpenmilch eG",
    short: "Vertrieb & Kapazität",
    area: "Vertrieb",
    desc: "Der Großkunde fragt kurzfristig 280.000 IML-Becher 500 ml an – Liefertermin in 5 Tagen. Die KI prüft Kapazität, Material, Auswirkungen auf andere Kunden und Transport in Sekunden.",
    watch: "Neue Kundenanfrage im Vertrieb – Machbarkeitsprüfung mit Maschinenplan und Materialcheck.",
    href: "/vertrieb",
    ask: "Können wir die Eilanfrage von Alpenmilch zusagen?",
  },
  granulat: {
    title: "Lieferverzug PP-Granulat",
    short: "Logistik & Material",
    area: "Logistik",
    desc: "Der Lieferant meldet 48 h Verspätung für Random-Copolymer (IML-Granulat). Die KI berechnet die Reichweite der Silos, erkennt betroffene Aufträge und schlägt eine Expressbestellung vor.",
    watch: "Silo 3+4 wird rot, Bestellvorschlag der KI-Regel erscheint zur Freigabe.",
    href: "/logistik?mat=M-PPR",
    ask: "Wie lange reicht unser IML-Granulat noch und was schlägst du vor?",
  },
};
