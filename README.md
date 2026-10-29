# KI-Werk Demo – Prototyp einer Unternehmens-KI

Prototyp einer KI-Plattform für ein Kunststoffverpackungswerk (Spritzguss mit IML, Thermoformen, Lager und LKW-Hof).
Alle Werks-, Kunden-, Lieferanten- und Fahrerdaten sind **simuliert** und fiktiv. Das Projekt ist ein inoffizieller, eigenständiger Prototyp – nicht von einem Unternehmen beauftragt, geprüft oder freigegeben.

## Funktionen

- **Leitstand mit 3D-Digitalzwilling** (React Three Fiber): Gebäude, Straßen und Gelände nach OpenStreetMap und EU-DEM, animierte Maschinen, LKW und Stapler, Live-KPIs.
- **Maschinengesundheit · KI-Wächter**: eigenes ML-Modell für Ausfallprognosen (72 h), Frühwarnungen, Ursachen, Maßnahmen mit Kosten/Nutzen, **Was-wäre-wenn** im digitalen Zwilling (72 h ohne vs. mit Maßnahme).
- **Qualität & Vision**: Bildprüfung im Browser, SPC mit Regelkarten und EWMA.
- **KI-Werksexperte**: Chat und **KI-Telefon** (Web Speech API) mit 22 Werkzeugen, Risiko-Radar, Kundenakten, Entwürfe nur mit Freigabe (Human-in-the-Loop). Ohne API-Schlüssel läuft ein regelbasierter Offline-Agent mit denselben Werkzeugen.
- **Vertrieb, Lager & LKW-Hof, Logistik, Finanzen, Berichte (PDF/CSV/HTML), Lagebericht, Datenintegration.**
- **Live-Demo „Alle Fälle“** (▶ Play · ⏸ Pause · ■ Stop in der Kopfzeile): alle typischen Situationen gleichzeitig – Störung, Rüsten, Wartung, Frühwarnung, Qualitätsdrift, Eilanfrage, Lieferverzug, LKW am Tor / wartend / an der Rampe / verspätet.

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ≥ 20.9

```bash
npm install
npm run dev          # Entwicklung: http://localhost:3100
```

Optimierte Version:

```bash
npm run build
npm run start        # http://localhost:3100
```

Optional: `.env.example` nach `.env.local` kopieren und `ANTHROPIC_API_KEY` eintragen – dann nutzt der KI-Werksexperte Claude mit Werkzeugaufrufen. Ohne Schlüssel funktioniert alles im Offline-Modus.

## Bedienung

- `Strg + K` – KI-Werksexperte öffnen
- `Shift + D` – Demo-Regie: Szenarien, Echtzeit/Zeitraffer, Pause, Reset, 3D-Qualität
- `[` / `]` – Navigation bzw. rechtes Panel im Leitstand ein-/ausklappen

## Technik

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Three.js / React Three Fiber, Zustand, Recharts. Die Simulation läuft serverseitig (`src/lib/sim`), die KI-Werkzeuge liegen in `src/lib/ai`.


## Daten und Lizenzen

- Kartendaten © OpenStreetMap-Mitwirkende, Lizenz ODbL
- Höhendaten: EU-DEM (Copernicus), über OpenTopoData
- Orts- und Firmennamen sind verfremdet („Werk Nord“, „Unternehmen“)
