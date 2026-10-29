// Bildprüfung mit Claude Vision: echtes Foto eines Bechers/Deckels -> strukturierter Prüfbefund.

import Anthropic from "@anthropic-ai/sdk";
import { MODEL, hasCredentials } from "./agent";

export interface VisionResult {
  urteil: "IO" | "NIO" | "UNKLAR";
  objekt: string;
  befunde: { fehlerart: string; schwere: "gering" | "mittel" | "kritisch"; ort: string; beschreibung: string }[];
  konfidenz: number;
  empfehlung: string;
}

const str = { type: "string" };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["urteil", "objekt", "befunde", "konfidenz", "empfehlung"],
  properties: {
    urteil: { type: "string", enum: ["IO", "NIO", "UNKLAR"] },
    objekt: str,
    befunde: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fehlerart", "schwere", "ort", "beschreibung"],
        properties: { fehlerart: str, schwere: { type: "string", enum: ["gering", "mittel", "kritisch"] }, ort: str, beschreibung: str },
      },
    },
    konfidenz: { type: "number" },
    empfehlung: str,
  },
};

export async function inspectImage(base64: string, mediaType: "image/png" | "image/jpeg" | "image/webp"): Promise<VisionResult> {
  if (!hasCredentials()) throw new Error("Für die Prüfung echter Fotos wird ein ANTHROPIC_API_KEY benötigt (siehe .env.local). Die Kamera-Simulation funktioniert ohne Schlüssel.");
  const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system:
      "Du bist ein Prüfsystem der Qualitätssicherung bei einem Hersteller von Lebensmittelverpackungen aus Kunststoff (IML-Becher, Deckel, thermogeformte Schalen). Beurteile das Foto wie eine Inline-Kamera: Fehlerarten u. a. Etikettenversatz, Kurzschuss/unvollständige Füllung, Gratbildung, schwarzer Punkt/Einschluss, Riss, Verformung, Verschmutzung. Wenn das Bild kein Verpackungsteil zeigt, setze urteil=UNKLAR und erkläre es. Konfidenz 0–1. Antworte auf Deutsch.",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: "Prüfe dieses Teil und gib den Prüfbefund zurück." },
        ],
      },
    ],
  });
  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Keine Antwort vom Prüfmodell.");
  return JSON.parse(block.text) as VisionResult;
}
