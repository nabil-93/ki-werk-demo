"use client";

// Sprache im Browser: deutsche Stimme für Antworten (Web Speech API, läuft lokal) und Spracherkennung für Fragen.
// Die Erkennung nutzt den Dienst des Browsers (Chrome/Edge); ohne ihn bleibt die Texteingabe.

import { sentences } from "@/lib/ai/speech";

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

export function recognitionSupported() {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function createRecognition(): Rec | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!C) return null;
  const r = new C();
  r.lang = "de-DE";
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  return r;
}

// ---------------- Sprachausgabe ----------------

const badVoices = new Set<string>();

/** beste verfügbare deutsche Stimme: natürliche (Edge/Windows) vor Google vor lokalen Systemstimmen */
export function germanVoice(): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !window.speechSynthesis) return undefined;
  const vs = window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("de") && !badVoices.has(v.name));
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural/i.test(v.name) ? 6 : 0) + (/online/i.test(v.name) ? 2 : 0) + (/katja|amala|seraphina|florian|conrad|killian|louisa/i.test(v.name) ? 2 : 0) + (/google/i.test(v.name) ? 3 : 0) + (/hedda|stefan|katja|anna/i.test(v.name) ? 1 : 0) + (v.lang === "de-DE" ? 0.5 : 0);
  return vs.sort((a, b) => score(b) - score(a))[0];
}

export function ttsSupported() {
  return typeof window !== "undefined" && Boolean(window.speechSynthesis);
}

/** Stimmen werden in Chrome asynchron geladen */
export function warmVoices() {
  if (!ttsSupported()) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

let speakToken = 0;
let pending: (() => void) | null = null;

/** laufende Ausgabe abbrechen – das offene speak()-Promise endet sofort */
export function stopSpeaking() {
  speakToken++;
  if (ttsSupported()) window.speechSynthesis.cancel();
  const p = pending;
  pending = null;
  p?.();
}

/** Text satzweise vorlesen; Promise endet nach dem letzten Satz (oder bei Abbruch) */
export function speak(text: string, opts: { rate?: number; transform?: (s: string) => string; onSentence?: (i: number, s: string) => void } = {}): Promise<void> {
  const token = ++speakToken;
  const parts = sentences(text);
  pending?.();
  pending = null;
  if (!ttsSupported() || !parts.length) {
    // ohne Sprachausgabe: Lesedauer simulieren, damit der Gesprächsablauf gleich bleibt
    return new Promise((res) => {
      pending = res;
      setTimeout(() => {
        if (pending === res) pending = null;
        res();
      }, Math.min(9000, 600 + text.length * 45));
    });
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  return new Promise((done) => {
    const resolve = () => {
      if (pending === done) pending = null;
      done();
    };
    pending = done;
    let i = 0;
    let retried = false;
    const next = () => {
      if (token !== speakToken) return resolve();
      if (i >= parts.length) return resolve();
      const u = new SpeechSynthesisUtterance(opts.transform ? opts.transform(parts[i]) : parts[i]);
      const v = germanVoice();
      if (v) u.voice = v;
      u.lang = v?.lang ?? "de-DE";
      u.rate = opts.rate ?? 1.05;
      u.pitch = 1;
      opts.onSentence?.(i, parts[i]);
      // Wächter: manche Browser melden das Satzende nicht – dann nach der erwarteten Sprechdauer weiter
      let settled = false;
      const advance = () => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        i++;
        next();
      };
      const guard = setTimeout(advance, 2500 + parts[i].length * 95);
      u.onend = advance;
      u.onerror = (e) => {
        if (settled) return;
        // Online-Stimme ohne Netz → einmal mit lokaler Stimme wiederholen
        if (!retried && v && e.error !== "interrupted" && e.error !== "canceled") {
          settled = true;
          clearTimeout(guard);
          retried = true;
          badVoices.add(v.name);
          next();
          return;
        }
        advance();
      };
      synth.speak(u);
    };
    next();
  });
}
