"use client";

// KI-Telefon: Gespräch mit der KI per Sprache. Gleicher Agent, gleiche Werkzeuge und gleicher Verlauf wie im Chat –
// die KI antwortet kurz und gesprochen, das Protokoll zeigt Werkzeuge und Details.

import { ArrowUp, BarChart3, ChevronDown, CircleAlert, Mic, MicOff, Phone as PhoneIcon, PhoneOff, PlayCircle, Sparkles, SquareSlash, Truck, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/client/cn";
import { useUi } from "@/lib/client/store";
import { createRecognition, recognitionSupported, speak, stopSpeaking, warmVoices } from "@/lib/client/voice";
import { speakable, toSpeech } from "@/lib/ai/speech";
import type { Snapshot } from "@/lib/sim/types";
import Markdown from "./Markdown";
import { useChat, type ChatMsg } from "./chatStore";

type CallState = "idle" | "connecting" | "listening" | "thinking" | "speaking";
type MicState = "unknown" | "ok" | "denied" | "unsupported" | "network";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HANGUP = /\b(tschüss|tschüs|tschau|ciao|auf wiederhören|auf wiederhoeren|bis später|bis spaeter|bis dann|leg auf|auflegen|das war'?s|das wars|gespräch beenden)\b/i;
const THANKS = /^(danke|vielen dank|super,? danke|okay,? danke|ok,? danke|danke schön|danke dir)[.! ]*$/i;

const STATE_TEXT: Record<CallState, string> = {
  idle: "Bereit für dein Gespräch",
  connecting: "Verbinde mit der KI …",
  listening: "Die KI hört zu …",
  thinking: "Die KI prüft die Werksdaten …",
  speaking: "Die KI spricht …",
};

const MIC_TEXT: Record<Exclude<MicState, "unknown" | "ok">, string> = {
  unsupported: "Dieser Browser hat keine Spracherkennung – nutze Chrome oder Edge oder tippe deine Frage unten ein. Die KI antwortet trotzdem per Sprache.",
  denied: "Mikrofon ist blockiert – erlaube es über das Schloss-Symbol in der Adressleiste oder tippe deine Frage unten ein.",
  network: "Die Spracherkennung des Browsers ist gerade nicht erreichbar (braucht Internet). Tippe deine Frage unten ein – die KI antwortet weiter per Sprache.",
};

function timeOf(t: number) {
  return new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}

function greeting(snap?: Snapshot | null) {
  if (!snap) return "Hallo, hier ist die KI des Werks Nord. Was möchtest du wissen?";
  const k = snap.kpis;
  const f = snap.guard?.findings?.[0];
  const hint = f
    ? `Ein Hinweis vorab: ${f.machineId}, ${f.title.replace(/^Frühwarnung:\s*/, "Frühwarnung, ")}.`
    : k.ordersAtRisk
      ? `${k.ordersAtRisk} ${k.ordersAtRisk === 1 ? "Auftrag hat" : "Aufträge haben"} ein Terminrisiko.`
      : "Gerade ist alles im grünen Bereich.";
  return `Hallo, hier ist die KI des Werks Nord. Es ist ${timeOf(snap.now)} Uhr, ${snap.shift.name}. ${k.machinesRunning} von ${k.machinesTotal} Maschinen laufen. ${hint} Was möchtest du wissen?`;
}

function demoScript(snap?: Snapshot | null) {
  const shift = snap?.shift.name ?? "Schicht";
  const f = snap?.guard?.findings?.[0];
  const s = [`Wie läuft die ${shift}?`, "Was sind gerade die größten Risiken?"];
  if (f) s.push("Was passiert, wenn wir nichts tun?", "Gut, dann leg die Maßnahme bitte als Entwurf an.");
  else s.push("Sind Aufträge gefährdet?", "Und wie sieht es beim Material aus?");
  return s;
}

/** kurzer Gesprächston (Verbinden / Auflegen) */
function tone(freqs: number[]) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      const t = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.02);
      g.gain.linearRampToValueAtTime(0, t + 0.14);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.15);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {}
}

export function Orb({ state, size = 210, onClick, orbRef }: { state: CallState; size?: number; onClick?: () => void; orbRef?: React.Ref<HTMLDivElement> }) {
  const dots = [
    [8, 30],
    [92, 26],
    [4, 64],
    [96, 70],
    [22, 6],
    [78, 94],
    [50, -4],
    [30, 98],
  ];
  return (
    <div ref={orbRef} className="orb shrink-0" data-state={state} style={{ "--orb": `${size}px` } as React.CSSProperties}>
      <div className="orb-halo" />
      {dots.map(([x, y], i) => (
        <span key={i} className="orb-dot" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.4}s` }} />
      ))}
      <div className="orb-ring" />
      <div className="orb-ring r2" />
      <div className="orb-wave" />
      <div className="orb-wave w2" />
      <div className="orb-spin" />
      <button type="button" onClick={onClick} className="orb-core cursor-pointer" aria-label={state === "speaking" ? "Unterbrechen" : "KI Voice"}>
        <span className="orb-bars">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      </button>
    </div>
  );
}

function Turn({ m, onDetails }: { m: ChatMsg; onDetails?: () => void }) {
  const [open, setOpen] = useState(false);
  if (m.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-[13px] text-bg">{m.text}</div>
      </div>
    );
  const spoken = m.speech ?? (m.done && m.text ? toSpeech(m.text) : "");
  const tools = m.steps;
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(135deg,var(--ai-1),var(--ai-2))] text-white">
        <Sparkles size={13} />
      </div>
      <div className="min-w-0 flex-1">
        {tools.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1">
            {tools.map((s) => (
              <span key={s.id} className={cn("num rounded-md px-1.5 py-0.5 text-[10px]", s.status === "running" ? "bg-accent-soft text-accent" : s.status === "ok" ? "bg-panel-3 text-muted" : "bg-crit-soft text-crit")} title={s.summary}>
                {s.status === "running" ? "⟳ " : "✓ "}
                {s.label} · {s.system}
              </span>
            ))}
          </div>
        )}
        {!m.done && !spoken && <div className="text-[12px] text-muted">prüft Werksdaten …</div>}
        {spoken && <div className="rounded-2xl rounded-tl-md bg-panel-2 px-3.5 py-2 text-[13px] leading-relaxed text-ink">{spoken}</div>}
        {m.error && <div className="mt-1 text-[11.5px] text-crit">{m.error}</div>}
        {m.done && m.text && (
          <div className="mt-1 flex items-center gap-3">
            <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-[11px] font-medium text-accent hover:underline">
              <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} /> {open ? "Details ausblenden" : "Details & Zahlen"}
            </button>
            {onDetails && (
              <button onClick={onDetails} className="text-[11px] font-medium text-muted hover:text-ink">
                im Chat mit Detailkarten öffnen
              </button>
            )}
          </div>
        )}
        {open && (
          <div className="mt-1.5 rounded-xl border border-line bg-panel p-3">
            <Markdown text={m.text} />
          </div>
        )}
      </div>
    </div>
  );
}

const EXAMPLES = (shift: string) => [
  { icon: BarChart3, q: `Wie läuft die ${shift}?`, sub: "Aktueller Produktionsstatus" },
  { icon: Wrench, q: "Welche Maschine braucht Wartung?", sub: "Auffälligkeiten und Prioritäten" },
  { icon: Truck, q: "Sind Aufträge gefährdet?", sub: "Liefertermine und Risiken" },
];

export default function Phone({ prompt, onOpenChat }: { prompt?: { text: string; nonce: number }; onOpenChat?: () => void }) {
  const snap = useUi((s) => s.snap);
  const messages = useChat((s) => s.messages);
  const send = useChat((s) => s.send);
  const [state, setStateRaw] = useState<CallState>("idle");
  const [active, setActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [mic, setMicRaw] = useState<MicState>("unknown");
  const [interim, setInterim] = useState("");
  const [caption, setCaption] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [since, setSince] = useState<number | null>(null);
  const [greet, setGreet] = useState("");
  const [demo, setDemo] = useState(false);
  const [ended, setEnded] = useState<{ dur: number; questions: number; drafts: number } | null>(null);
  const [q, setQ] = useState("");

  const activeRef = useRef(false);
  const mutedRef = useRef(false);
  const stateRef = useRef<CallState>("idle");
  const micRef = useRef<MicState>("unknown");
  const demoRef = useRef(false);
  const recRef = useRef<ReturnType<typeof createRecognition>>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastPrompt = useRef(0);
  const sinceRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const setState = (s: CallState) => {
    stateRef.current = s;
    setStateRaw(s);
  };
  const setMic = (m: MicState) => {
    micRef.current = m;
    setMicRaw(m);
  };

  useEffect(() => {
    warmVoices();
    if (!recognitionSupported()) setMic("unsupported");
  }, []);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, interim, greet]);

  const stopRec = () => {
    const r = recRef.current;
    recRef.current = null;
    if (r) {
      r.onend = null;
      r.onresult = null;
      r.onerror = null;
      try {
        r.abort();
      } catch {}
    }
  };

  const say = useCallback(async (text: string) => {
    if (!activeRef.current) return;
    setState("speaking");
    setCaption("");
    await speak(text, { transform: speakable, onSentence: (_, s) => setCaption(s) });
    setCaption("");
  }, []);

  // Pegel des Mikrofons → Orb pulsiert mit der Stimme
  const startLevel = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!activeRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (micRef.current === "unknown") setMic("ok");
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const loop = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const lvl = stateRef.current === "listening" && !mutedRef.current ? Math.min(1, Math.sqrt(sum / buf.length) * 6) : 0;
        orbRef.current?.style.setProperty("--lvl", lvl.toFixed(2));
        if (audioRef.current) audioRef.current.raf = requestAnimationFrame(loop);
      };
      audioRef.current = { ctx, raf: requestAnimationFrame(loop) };
    } catch (e) {
      const n = (e as Error).name;
      if (n === "NotAllowedError" || n === "SecurityError" || n === "NotFoundError") setMic("denied");
    }
  };

  const stopLevel = () => {
    if (audioRef.current) {
      cancelAnimationFrame(audioRef.current.raf);
      audioRef.current.ctx.close().catch(() => {});
      audioRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    orbRef.current?.style.setProperty("--lvl", "0");
  };

  const hangup = useCallback(
    (quiet = false) => {
      const was = activeRef.current;
      activeRef.current = false;
      demoRef.current = false;
      setDemo(false);
      stopSpeaking();
      stopRec();
      stopLevel();
      setActive(false);
      setState("idle");
      setInterim("");
      setCaption("");
      if (was && !quiet) tone([620, 440]);
      if (was) {
        const turns = useChat.getState().messages.slice(sinceRef.current ?? 0);
        setEnded({
          dur: Date.now() - (startedAtRef.current ?? Date.now()),
          questions: turns.filter((m) => m.role === "user").length,
          drafts: turns.reduce((n, m) => n + (m.role === "assistant" ? m.steps.filter((s) => s.name.endsWith("_vorschlagen") && s.status === "ok").length : 0), 0),
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => () => hangup(true), [hangup]);

  // eine Frage beantworten: denken → sprechen
  const exchange = useCallback(
    async (text: string) => {
      if (!activeRef.current) return;
      stopRec();
      stopSpeaking();
      setInterim("");
      if (HANGUP.test(text)) {
        await say("Gern geschehen. Ich bin jederzeit wieder für dich da – bis später!");
        hangup();
        return;
      }
      if (THANKS.test(text.trim())) {
        await say("Sehr gern. Kann ich sonst noch etwas für dich prüfen?");
        return;
      }
      setState("thinking");
      const m = await send(text, { voice: true });
      if (!activeRef.current) return;
      if (!m) {
        await say("Einen Moment bitte, ich bin noch bei der letzten Frage.");
        return;
      }
      await say(m.error ? "Da ist gerade etwas schiefgelaufen. Frag mich bitte noch einmal." : m.speech || toSpeech(m.text));
    },
    [say, send, hangup],
  );

  const listen = useCallback(() => {
    if (!activeRef.current) return;
    setState("listening");
    if (mutedRef.current || demoRef.current) return;
    if (micRef.current === "denied" || micRef.current === "unsupported" || micRef.current === "network") return;
    if (recRef.current) return;
    const r = createRecognition();
    if (!r) return setMic("unsupported");
    recRef.current = r;
    let finalText = "";
    r.onstart = () => {
      if (micRef.current === "unknown") setMic("ok");
    };
    r.onresult = (e) => {
      let it = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else it += res[0].transcript;
      }
      setInterim(`${finalText} ${it}`.trim());
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") setMic("denied");
      else if (e.error === "network") setMic("network");
    };
    r.onend = () => {
      recRef.current = null;
      if (!activeRef.current) return;
      const text = finalText.trim();
      if (text) {
        exchange(text).then(() => listenRef.current());
        return;
      }
      setInterim("");
      if (stateRef.current === "listening" && !mutedRef.current && (micRef.current === "ok" || micRef.current === "unknown"))
        setTimeout(() => {
          if (activeRef.current && stateRef.current === "listening" && !recRef.current) listenRef.current();
        }, 300);
    };
    try {
      r.start();
    } catch {
      recRef.current = null;
    }
  }, [exchange]);
  const listenRef = useRef(listen);
  useEffect(() => {
    listenRef.current = listen;
  }, [listen]);

  const ask = useCallback(
    async (text: string) => {
      await exchange(text);
      if (activeRef.current && !demoRef.current) listenRef.current();
    },
    [exchange],
  );

  const runDemo = useCallback(async () => {
    for (const line of demoScript(useUi.getState().snap)) {
      if (!activeRef.current || !demoRef.current) return;
      setState("listening");
      await sleep(500);
      for (let i = 2; i <= line.length; i += 2) {
        if (!activeRef.current) return;
        setInterim(line.slice(0, i));
        await sleep(32);
      }
      setInterim(line);
      await sleep(550);
      await exchange(line);
      await sleep(600);
    }
    if (!activeRef.current) return;
    await say("Das war der Testanruf. Du kannst mich jederzeit direkt anrufen – einfach auf Gespräch starten tippen.");
    hangup();
  }, [exchange, say, hangup]);

  const startCall = useCallback(
    async (opts: { demo?: boolean; first?: string; greet?: boolean } = {}) => {
      if (activeRef.current) return;
      activeRef.current = true;
      demoRef.current = Boolean(opts.demo);
      setDemo(Boolean(opts.demo));
      setActive(true);
      setEnded(null);
      setMuted(false);
      mutedRef.current = false;
      const t0 = Date.now();
      startedAtRef.current = t0;
      setStartedAt(t0);
      setNow(t0);
      const idx = useChat.getState().messages.length;
      sinceRef.current = idx;
      setSince(idx);
      setGreet("");
      setState("connecting");
      tone([440, 620]);
      if (!opts.demo && micRef.current !== "unsupported") startLevel();
      await sleep(650);
      if (!activeRef.current) return;
      if (opts.greet !== false) {
        const g = greeting(useUi.getState().snap);
        setGreet(g);
        await say(g);
      }
      if (!activeRef.current) return;
      if (opts.demo) return runDemo();
      if (opts.first) return ask(opts.first);
      listenRef.current();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [say, ask, runDemo],
  );

  // Frage von außen (Werkzeugliste, Beispielkarten)
  useEffect(() => {
    if (!prompt || prompt.nonce === lastPrompt.current) return;
    lastPrompt.current = prompt.nonce;
    if (activeRef.current) ask(prompt.text);
    else startCall({ first: prompt.text, greet: false });
  }, [prompt, ask, startCall]);

  const toggleMute = () => {
    const m = !mutedRef.current;
    mutedRef.current = m;
    setMuted(m);
    if (m) {
      stopRec();
      setInterim("");
    } else if (stateRef.current === "listening") listenRef.current();
  };

  const interrupt = () => {
    if (stateRef.current === "speaking") {
      stopSpeaking();
      if (!demoRef.current) setTimeout(() => listenRef.current(), 50);
    }
  };

  const submit = () => {
    const text = q.trim();
    if (!text) return;
    setQ("");
    if (activeRef.current) ask(text);
    else startCall({ first: text, greet: false });
  };

  const turns = since !== null ? messages.slice(since) : [];
  const shift = snap?.shift.name ?? "Spätschicht";
  const dur = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const micProblem = mic !== "unknown" && mic !== "ok" ? MIC_TEXT[mic] : null;
  const showIntro = !active && !ended && turns.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {/* Orb + Status */}
        <div className={cn("mx-auto flex max-w-3xl flex-col items-center text-center", showIntro ? "pt-6" : "pt-3")}>
          <Orb state={state} size={showIntro ? 210 : 148} orbRef={orbRef} onClick={() => (state === "speaking" ? interrupt() : !active ? startCall() : undefined)} />
          <div className={cn("wide font-bold tracking-[-0.02em]", showIntro ? "mt-5 text-[26px]" : "mt-3 text-[19px]")}>KI Voice</div>
          <div className="mt-1 flex items-center gap-2 text-[13px] text-ink-2">
            <span className={cn("h-2 w-2 rounded-full", state === "idle" ? "bg-ok" : state === "listening" ? (muted ? "bg-warn" : "bg-ok animate-pulse") : "bg-accent animate-pulse")} />
            {active && muted && state === "listening" ? "Mikrofon stumm – tippe deine Frage oder schalte es wieder ein" : STATE_TEXT[state]}
            {active && <span className="num text-muted">· {String(Math.floor(dur / 60)).padStart(2, "0")}:{String(dur % 60).padStart(2, "0")}</span>}
            {demo && <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-accent">Testanruf</span>}
          </div>

          {showIntro && (
            <>
              <p className="mt-1.5 text-[13px] text-muted">Frag frei heraus – die KI hört zu und antwortet mit Live-Werksdaten.</p>
              <button onClick={() => startCall()} className="mt-5 flex items-center gap-2.5 rounded-xl bg-accent px-10 py-3.5 text-[15px] font-semibold text-white shadow-[0_10px_30px_-10px_var(--ai-1)] transition hover:brightness-110">
                <PhoneIcon size={18} /> Gespräch starten
              </button>
              <button onClick={() => startCall({ demo: true })} className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline">
                <PlayCircle size={16} /> Testanruf starten
              </button>
              <div className="mt-5 flex items-center gap-1.5 text-[12.5px] text-ink-2">
                <Mic size={14} /> Sprachmodus · Mikrofon nur während des Gesprächs
              </div>
              <div className="text-[11.5px] text-muted">Dein Mikrofon wird erst nach dem Start des Gesprächs aktiviert – nichts wird aufgezeichnet.</div>
            </>
          )}

          {active && (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={toggleMute}
                disabled={demo}
                className={cn("flex h-10 items-center gap-1.5 rounded-full border px-4 text-[12.5px] font-medium transition disabled:opacity-40", muted ? "border-warn bg-warn-soft text-warn" : "border-line bg-panel hover:bg-panel-2")}
              >
                {muted ? <MicOff size={15} /> : <Mic size={15} />} {muted ? "Stumm" : "Mikrofon"}
              </button>
              <button onClick={interrupt} disabled={state !== "speaking"} className="flex h-10 items-center gap-1.5 rounded-full border border-line bg-panel px-4 text-[12.5px] font-medium transition hover:bg-panel-2 disabled:opacity-40">
                <SquareSlash size={15} /> Unterbrechen
              </button>
              <button onClick={() => hangup()} className="flex h-10 items-center gap-1.5 rounded-full bg-crit px-5 text-[12.5px] font-semibold text-white transition hover:brightness-110">
                <PhoneOff size={15} /> Auflegen
              </button>
            </div>
          )}

          {active && (caption || interim) && (
            <div className="mt-3 min-h-[24px] max-w-2xl text-[14px] leading-snug">
              {state === "listening" && interim ? <span className="text-ink">„{interim}“</span> : <span className="text-ink-2">{caption}</span>}
            </div>
          )}

          {active && micProblem && !demo && (
            <div className="mt-3 flex max-w-xl items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-left text-[12px] text-ink-2">
              <CircleAlert size={15} className="mt-0.5 shrink-0 text-warn" /> {micProblem}
            </div>
          )}

          {ended && !active && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[12px] text-muted">
              <span>
                Gespräch beendet · {String(Math.floor(ended.dur / 60000)).padStart(2, "0")}:{String(Math.floor(ended.dur / 1000) % 60).padStart(2, "0")} · {ended.questions} {ended.questions === 1 ? "Frage" : "Fragen"}
                {ended.drafts ? ` · ${ended.drafts} Entwurf zur Freigabe` : ""}
              </span>
              <button onClick={() => startCall()} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white">
                <PhoneIcon size={13} /> Neues Gespräch
              </button>
            </div>
          )}
        </div>

        {/* Gesprächsprotokoll */}
        {(greet || turns.length > 0) && (
          <div className="mx-auto mt-5 max-w-3xl space-y-3.5 border-t border-line pt-4">
            <div className="label text-center text-[9.5px]">Gesprächsprotokoll · gleiche Daten und Werkzeuge wie im Chat</div>
            {greet && (
              <div className="flex gap-2.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(135deg,var(--ai-1),var(--ai-2))] text-white">
                  <Sparkles size={13} />
                </div>
                <div className="rounded-2xl rounded-tl-md bg-panel-2 px-3.5 py-2 text-[13px] leading-relaxed">{greet}</div>
              </div>
            )}
            {turns.map((m) => (
              <Turn key={m.id} m={m} onDetails={onOpenChat} />
            ))}
          </div>
        )}

        {/* Beispielfragen */}
        {!active && (
          <div className="mx-auto mt-6 max-w-3xl">
            <div className="relative mb-2.5 text-center">
              <span className="relative z-10 bg-panel px-3 text-[11.5px] text-muted">Beispiel-Fragen für dein Gespräch</span>
              <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {EXAMPLES(shift).map((e) => (
                <button key={e.q} onClick={() => startCall({ first: e.q, greet: false })} className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/40">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <e.icon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold leading-snug text-ink">{e.q}</span>
                    <span className="block text-[11px] text-muted">{e.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Eingabe: Mikrofon + Text */}
      <div className="border-t border-line p-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <button
            onClick={() => (active ? toggleMute() : startCall())}
            className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition", active && !muted ? "border-accent bg-accent text-white" : "border-line bg-panel text-ink-2 hover:border-accent/60")}
            aria-label={active ? (muted ? "Mikrofon einschalten" : "Mikrofon stumm schalten") : "Gespräch starten"}
            title={active ? (muted ? "Mikrofon einschalten" : "Stumm schalten") : "Gespräch starten"}
          >
            {active && muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-line bg-panel-2 p-1.5 focus-within:border-accent/60">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder={active ? "Oder tippe deine Frage – die KI antwortet per Sprache …" : "Oder schreibe deine Frage …"}
              className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-[13.5px] outline-none placeholder:text-faint"
            />
            <button onClick={submit} disabled={!q.trim()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition disabled:opacity-30" aria-label="Senden">
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
