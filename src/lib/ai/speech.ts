// Sprachausgabe: macht aus einer Copilot-Antwort (Markdown) einen kurzen, gut vorlesbaren Text
// und aus gesprochener Eingabe eine Frage, die der Agent versteht („es ge vier“ → SG-04).

const NUM_WORDS: Record<string, number> = {
  null: 0, eins: 1, ein: 1, eine: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7,
  acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, zwoelf: 12, dreizehn: 13, vierzehn: 14,
};

/** gesprochene Maschinen- und Auftragsnummern normalisieren */
export function normalizeSpoken(q: string) {
  return q
    .replace(/\b(?:s\s?g|es\s?ge|esge|ess\s?ge)\b(?=[\s-]*(?:\d|null|eins|ein|zwei|zwo|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|dreizehn|vierzehn)\b)/gi, "SG")
    .replace(/\b(?:t\s?f|te\s?ef|tee\s?eff)\b(?=[\s-]*(?:\d|null|eins|ein|zwei|zwo|drei|vier)\b)/gi, "TF")
    .replace(/\b(SG|TF)[\s-]*(?:null\s+)?(eins|ein|eine|zwei|zwo|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|dreizehn|vierzehn)\b/gi, (_, p: string, w: string) => `${p.toUpperCase()}-${String(NUM_WORDS[w.toLowerCase()]).padStart(2, "0")}`)
    .replace(/\b(?:FA|Auftrag(?:snummer)?)[\s-]*(\d)\s?(\d)\s?(\d)\s?(\d)\s?(\d)\b/gi, "FA-$1$2$3$4$5");
}

/** Markdown entfernen – lesbarer Klartext für Untertitel und Gesprächsprotokoll */
export function plainText(s: string) {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[[A-Z]{2,}-[\w-]+\]/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1$2")
    .replace(/\s+·\s+/g, ", ")
    .replace(/\s*(?:→|->)\s*/g, " – ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Abkürzungen und Zeichen so umschreiben, dass eine deutsche Stimme sie sauber ausspricht */
export function speakable(s: string) {
  return plainText(s)
    .replace(/\b(SG|TF)-0?(\d{1,2})\b/g, (_, p: string, n: string) => `${p.split("").join(" ")} ${Number(n)}`)
    .replace(/\bFA-(\d+)/g, "Auftrag $1")
    .replace(/\bT-(\d+)/g, "Vorgang $1")
    .replace(/(\d)\s?T€/g, "$1 tausend Euro")
    .replace(/(\d)\s?€/g, "$1 Euro")
    .replace(/(\d)\s?h\b/g, "$1 Stunden")
    .replace(/(\d)\s?min\b/g, "$1 Minuten")
    .replace(/(\d)\s?kWh\b/g, "$1 Kilowattstunden")
    .replace(/(\d)\s?mm\/s\b/g, "$1 Millimeter pro Sekunde")
    .replace(/\s?\((?:Mo|Di|Mi|Do|Fr|Sa|So)\.,[^)]*\)/g, "")
    .replace(/pro h\b/g, "pro Stunde")
    .replace(/(\d)\s?°C\b/g, "$1 Grad")
    .replace(/×\s?/g, "mal ")
    .replace(/\bggü\./g, "gegenüber")
    .replace(/≈\s?/g, "etwa ")
    .replace(/\s\+\s/g, " plus ")
    .replace(/(\d+)\/(\d+)\b/g, "$1 von $2")
    .replace(/\bStk\.?/g, "Stück")
    .replace(/\bPal\./g, "Paletten")
    .replace(/\bz\.\s?B\./g, "zum Beispiel")
    .replace(/\bca\./g, "circa")
    .replace(/\bbzw\./g, "beziehungsweise")
    .replace(/\binkl\./g, "inklusive")
    .replace(/\bvs\./g, "gegenüber")
    .replace(/\bggf\./g, "gegebenenfalls")
    .replace(/\bu\.\s?a\./g, "unter anderem")
    .replace(/(\d)\s?t CO₂e?/g, "$1 Tonnen C O 2")
    .replace(/CO₂e?/g, "C O 2")
    .replace(/\bDB\b/g, "Deckungsbeitrag")
    .replace(/\bOEE\b/g, "O E E")
    .replace(/\bCpk\b/gi, "C P K")
    .replace(/\bRUL\b/g, "Restlaufzeit")
    .replace(/\bKI\b/g, "K I")
    .replace(/\bOPC UA\b/g, "O P C U A")
    .replace(/\b(SAP|MES|CAQ|WMS|TMS|SPC|EWMA)\b/g, (x) => x.split("").join(" "))
    .replace(/\+(\d)/g, "plus $1")
    .replace(/\s*(?:→|->)\s*/g, ", dann ")
    .replace(/\s+·\s+/g, ", ")
    .replace(/\s+[–—]\s+/g, ", ")
    .replace(/Ø\s?/g, "Durchmesser ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** kurze Fassung einer Markdown-Antwort fürs Telefon (Klartext): Kernaussage, zwei Fakten, Empfehlung */
export function toSpeech(md: string, maxChars = 480) {
  const lines = md.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const body = lines.filter((l) => !/^Quelle:/i.test(l) && !/^_.*_$/.test(l));
  const firstPara: string[] = [];
  for (const l of body) {
    if (!l) {
      if (firstPara.length) break;
      continue;
    }
    if (/^[-*•]\s|^\d+\.\s/.test(l) && firstPara.length) break;
    if (/^\*\*[^*]+\*\*$/.test(l) && firstPara.length) break;
    firstPara.push(l.replace(/^[-*•]\s|^\d+\.\s/, ""));
  }
  const bullets = body.filter((l) => /^[-*•]\s/.test(l)).map((l) => l.replace(/^[-*•]\s+/, ""));
  const rec = body.find((l) => /^Empfehlung:/i.test(l));
  const parts = [firstPara.join(" ")];
  if (parts[0].length < 160) parts.push(...bullets.slice(0, 2));
  if (rec && !parts.includes(rec)) parts.push(rec);
  let out = "";
  for (const p of parts.map((x) => plainText(x)).filter(Boolean)) {
    const sentence = /[.!?:]$/.test(p) ? p : `${p}.`;
    if (out && (out + " " + sentence).length > maxChars) break;
    out = out ? `${out} ${sentence}` : sentence;
  }
  return out || plainText(md).slice(0, maxChars);
}

/** Text in Sätze teilen – lange Äußerungen brechen in manchen Browsern ab */
export function sentences(text: string) {
  return text
    .split(/(?<=[.!?])(?<!\b(?:z|B|u|a|ca|bzw|ggf|inkl|vs|Nr|Mo|Di|Mi|Do|Fr|Sa|So)\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
