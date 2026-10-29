"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Brain, Check, ChevronRight, CircleDot, Loader2, Mic, Phone, RotateCcw, Sparkles, Square, TriangleAlert, Wifi, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/client/cn";
import { useUi } from "@/lib/client/store";
import { createRecognition, recognitionSupported } from "@/lib/client/voice";
import { Badge } from "@/components/ui/ui";
import Markdown from "./Markdown";
import ToolCardView from "./ToolCards";
import { useChat, type ChatMsg, type Step } from "./chatStore";

// modulweit, damit ein Prompt nicht zweimal gesendet wird (Drawer + Seite)
let lastPromptNonce = 0;

export const SUGGESTIONS: { role: string; q: string }[] = [
  { role: "Schichtleitung", q: "Erstelle das Lagebild für die aktuelle Schicht." },
  { role: "Instandhaltung", q: "Welche Maschine fällt als Nächstes aus – und was kostet es, wenn wir nichts tun?" },
  { role: "Werksleitung", q: "Was sind gerade die größten Risiken – und was würdest du tun?" },
  { role: "Instandhaltung", q: "Was passiert, wenn wir bei SG-04 nichts tun?" },
  { role: "Qualität", q: "Warum steigt der Ausschuss an SG-02 und was sollen wir tun?" },
  { role: "Vertrieb", q: "Können wir die Eilanfrage von Alpenmilch zusagen?" },
  { role: "Vertrieb", q: "Welche Aufträge sind terminlich gefährdet?" },
  { role: "Logistik", q: "Wie lange reicht unser IML-Granulat noch und was schlägst du vor?" },
  { role: "Wissen", q: "Was sagt unsere KI-Richtlinie zu Datenschutz und Betriebsrat?" },
];

function StepRow({ s }: { s: Step }) {
  const [open, setOpen] = useState(false);
  const input = Object.entries(s.input).filter(([, v]) => v !== undefined && v !== "");
  return (
    <div className="relative pl-6">
      <div className="absolute left-[7px] top-0 h-full w-px bg-line" />
      <div className={cn("absolute left-0 top-[5px] flex h-[15px] w-[15px] items-center justify-center rounded-full border bg-panel", s.status === "running" ? "border-accent text-accent" : s.status === "ok" ? "border-ok text-ok" : "border-crit text-crit")}>
        {s.status === "running" ? <Loader2 size={9} className="animate-spin" /> : s.status === "ok" ? <Check size={9} strokeWidth={3} /> : <TriangleAlert size={8} />}
      </div>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 py-1 text-left">
        <span className="text-[12px] font-semibold text-ink">{s.label}</span>
        <span className="num truncate text-[10.5px] text-muted">{s.system}</span>
        {s.summary && <span className="hidden truncate text-[11px] text-ink-2 sm:inline">· {s.summary}</span>}
        <span className="num ml-auto shrink-0 text-[10px] text-faint">{s.ms !== undefined ? `${s.ms} ms` : ""}</span>
        {(s.card || input.length > 0) && <ChevronRight size={13} className={cn("shrink-0 text-faint transition-transform", open && "rotate-90")} />}
      </button>
      {input.length > 0 && open && (
        <div className="num mb-1 flex flex-wrap gap-1 text-[10px]">
          {input.map(([k, v]) => (
            <span key={k} className="rounded bg-panel-3 px-1.5 py-0.5 text-muted">
              {k}=<span className="text-ink-2">{String(v)}</span>
            </span>
          ))}
        </div>
      )}
      <AnimatePresence initial={false}>
        {s.card && (open || s.card.kind === "ticket" || s.card.kind === "feasibility" || s.card.kind === "prediction" || s.card.kind === "risks" || s.card.kind === "whatif") && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden pb-2 pt-1">
            <ToolCardView card={s.card} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AssistantBubble({ m }: { m: Extract<ChatMsg, { role: "assistant" }> }) {
  const [showThinking, setShowThinking] = useState(false);
  const elapsed = ((m.endedAt ?? Date.now()) - m.startedAt) / 1000;
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(135deg,var(--ai-1),var(--ai-2))] text-white shadow-[0_4px_14px_-4px_var(--ai-1)]">
        <Sparkles size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[12.5px] font-semibold">KI-Werksexperte</span>
          {m.mode === "claude" && <Badge sev="info">{m.model ?? "Claude"}</Badge>}
          {m.mode === "offline" && <Badge sev="neutral">Offline-Modus</Badge>}
          {m.via === "telefon" && (
            <Badge sev="info">
              <Phone size={10} /> KI-Telefon
            </Badge>
          )}
          {m.done && <span className="num text-[10.5px] text-faint">{elapsed.toFixed(1)} s</span>}
        </div>
        {m.note && <div className="mb-1.5 text-[11px] text-muted">{m.note}</div>}
        {m.thinking && (
          <button onClick={() => setShowThinking((v) => !v)} className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted hover:text-ink">
            <Brain size={12} /> Gedankengang {showThinking ? "ausblenden" : "anzeigen"}
          </button>
        )}
        {showThinking && <div className="mb-2 max-h-48 overflow-y-auto rounded-lg border border-line-2 bg-panel-2 p-2.5 text-[11.5px] leading-relaxed text-muted whitespace-pre-wrap">{m.thinking}</div>}
        {m.steps.length > 0 && <div className="mb-2">{m.steps.map((s) => <StepRow key={s.id} s={s} />)}</div>}
        {!m.text && !m.done && m.steps.every((s) => s.status !== "running") && (
          <div className="flex items-center gap-2 py-1 text-[12px] text-muted">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-accent" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }} />
              ))}
            </span>
            {m.steps.length ? "formuliert Antwort…" : "analysiert die Frage…"}
          </div>
        )}
        {m.text && <Markdown text={m.text} streaming={!m.done} />}
        {m.error && <div className="mt-2 rounded-lg bg-crit-soft px-3 py-2 text-[12px] text-crit">{m.error}</div>}
      </div>
    </div>
  );
}

export default function Chat({ compact }: { compact?: boolean }) {
  const { messages, busy, send, reset, offline, setOffline } = useChat();
  const prompt = useUi((s) => s.copilotPrompt);
  const [q, setQ] = useState("");
  const [online, setOnline] = useState<boolean | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [canDictate, setCanDictate] = useState(false);
  const [dictating, setDictating] = useState(false);
  const rec = useRef<ReturnType<typeof createRecognition>>(null);

  useEffect(() => setCanDictate(recognitionSupported()), []);
  useEffect(() => () => rec.current?.abort(), []);

  // Diktat: gesprochene Frage ins Eingabefeld schreiben
  const dictate = () => {
    if (dictating) return rec.current?.stop();
    const r = createRecognition();
    if (!r) return;
    const base = q ? `${q.trim()} ` : "";
    let fin = "";
    r.onresult = (e) => {
      let it = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else it += e.results[i][0].transcript;
      }
      setQ(base + `${fin} ${it}`.trim());
    };
    r.onerror = () => setDictating(false);
    r.onend = () => {
      setDictating(false);
      rec.current = null;
    };
    rec.current = r;
    try {
      r.start();
      setDictating(true);
    } catch {
      setDictating(false);
    }
  };

  useEffect(() => {
    fetch("/api/copilot")
      .then((r) => r.json())
      .then((d) => setOnline(Boolean(d.online)))
      .catch(() => setOnline(false));
  }, []);

  useEffect(() => {
    if (prompt && prompt.nonce !== lastPromptNonce) {
      lastPromptNonce = prompt.nonce;
      send(prompt.text);
    }
  }, [prompt, send]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = () => {
    if (!q.trim()) return;
    send(q);
    setQ("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
          {online && !offline ? <Wifi size={13} className="text-ok" /> : <WifiOff size={13} />}
          {online === null ? "prüfe Verbindung…" : online && !offline ? "Claude Opus · Live-Werkzeuge" : online ? "Offline-Modus (manuell)" : "Offline-Modus · kein API-Schlüssel"}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {online && (
            <button onClick={() => setOffline(!offline)} className="rounded-md px-2 py-1 text-[11px] font-medium text-muted hover:bg-panel-3 hover:text-ink" title="Für Präsentationen ohne Internet">
              {offline ? "Live nutzen" : "Offline testen"}
            </button>
          )}
          {messages.length > 0 && (
            <button onClick={reset} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted hover:bg-panel-3 hover:text-ink">
              <RotateCcw size={12} /> Neu
            </button>
          )}
        </div>
      </div>

      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-xl">
            <div className="mb-5 mt-2 flex flex-col items-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--ai-1),var(--ai-2))] text-white shadow-[0_10px_30px_-10px_var(--ai-1)]">
                <Sparkles size={22} />
              </div>
              <div className="wide text-[18px] font-bold tracking-[-0.02em]">Frag dein Werk.</div>
              <p className="mt-1 max-w-sm text-[12.5px] text-muted">Die KI verbindet SAP, MES, Sensorik, Qualität und Logistik – und begründet jede Antwort mit Daten und Quellen.</p>
            </div>
            <div className={cn("grid gap-2", !compact && "sm:grid-cols-2")}>
              {SUGGESTIONS.slice(0, compact ? 6 : 9).map((s) => (
                <button key={s.q} onClick={() => send(s.q)} className="group rounded-xl border border-line bg-panel p-3 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/40">
                  <div className="label mb-1 text-[9px]">{s.role}</div>
                  <div className="text-[12.5px] leading-snug text-ink-2 group-hover:text-ink">{s.q}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            {messages.map((m) =>
              m.role === "user" ? (
                <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-end justify-end gap-1.5">
                  {m.via === "telefon" && <Phone size={12} className="mb-2 text-muted" aria-label="per KI-Telefon" />}
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-[13.5px] text-bg">{m.text}</div>
                </motion.div>
              ) : (
                <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                  <AssistantBubble m={m} />
                </motion.div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="border-t border-line p-3">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-xl border border-line bg-panel-2 p-1.5 focus-within:border-accent/60">
            <textarea
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="Frage zu Produktion, Wartung, Qualität, Vertrieb oder Logistik…"
              className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-[13.5px] outline-none placeholder:text-faint"
            />
            {canDictate && (
              <button
                onClick={dictate}
                className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition", dictating ? "bg-crit text-white" : "text-muted hover:bg-panel-3 hover:text-ink")}
                aria-label={dictating ? "Diktat beenden" : "Frage diktieren"}
                title={dictating ? "Diktat beenden" : "Frage diktieren"}
              >
                {dictating ? <Square size={13} /> : <Mic size={16} />}
              </button>
            )}
            <button onClick={submit} disabled={busy || !q.trim()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink text-bg transition-opacity disabled:opacity-30" aria-label="Senden">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} />}
            </button>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 px-1 text-[10.5px] text-faint">
            <CircleDot size={10} /> Aktionen werden nur als Entwurf angelegt – Freigabe durch einen Menschen (Human-in-the-Loop).
          </div>
        </div>
      </div>
    </div>
  );
}
