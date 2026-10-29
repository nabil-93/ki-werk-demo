"use client";

import { Activity, ArrowRight, BarChart3, Boxes, Building2, CalendarCheck, ChevronRight, CircleHelp, Cpu, FileText, MessageSquare, Phone as PhoneIcon, Play, ScanEye, Search, ShieldAlert, ShieldCheck, Sparkles, Truck, Wrench, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useUi } from "@/lib/client/store";
import { cn } from "@/lib/client/cn";
import { TOOL_META } from "@/lib/ai/toolMeta";
import Chat from "@/components/copilot/Chat";
import Phone from "@/components/copilot/Phone";
import { TicketView } from "@/components/copilot/ToolCards";
import { useChat } from "@/components/copilot/chatStore";
import { Panel } from "@/components/ui/ui";

type Mode = "chat" | "telefon";

// Werkzeuge mit Beispielfrage – ein Klick stellt die Frage im aktuellen Modus
const TOOLS_UI: { icon: typeof Cpu; label: string; system: string; q: string }[] = [
  { icon: BarChart3, label: "Produktionsdaten abrufen", system: "MES · SAP", q: "Wie läuft die aktuelle Schicht?" },
  { icon: Cpu, label: "Maschinenstatus lesen", system: "MES · OPC UA", q: "Wie geht es SG-04?" },
  { icon: Activity, label: "Wartungsprognose berechnen", system: "KI-Modell", q: "Welche Maschine braucht als Nächstes Wartung?" },
  { icon: ShieldAlert, label: "Risiko-Radar: Experteneinschätzung", system: "alle Systeme", q: "Was sind gerade die größten Risiken?" },
  { icon: Play, label: "Was-wäre-wenn simulieren", system: "Digitaler Zwilling", q: "Was passiert, wenn wir bei SG-04 nichts tun?" },
  { icon: Search, label: "Aufträge durchsuchen", system: "SAP S/4HANA", q: "Welche Aufträge sind terminlich gefährdet?" },
  { icon: CalendarCheck, label: "Liefertermine & Machbarkeit", system: "SAP · MES · TMS", q: "Können wir die Eilanfrage zusagen?" },
  { icon: ScanEye, label: "Qualitätsdaten auswerten", system: "CAQ · Kamera", q: "Wie ist die Qualität heute?" },
  { icon: Boxes, label: "Bestände & Material prüfen", system: "WMS · SAP MM", q: "Wie lange reicht unser Material noch?" },
  { icon: Truck, label: "LKW-Hof & Zeitfenster", system: "Yard · Telematik", q: "Welche LKW kommen heute noch?" },
  { icon: Building2, label: "Kundenakte lesen", system: "SAP SD · FI/CO", q: "Wie läuft es bei Alpenmilch?" },
  { icon: FileText, label: "KPI und Berichte erstellen", system: "MES · SAP · WMS", q: "Erstelle den Tagesbericht." },
];

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="panel scroll-thin max-h-[86dvh] w-full max-w-2xl overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <CircleHelp size={18} className="text-accent" />
          <div className="text-[16px] font-bold">So arbeitest du mit dem KI-Werksexperten</div>
          <button onClick={onClose} className="ml-auto rounded-md p-1 text-muted hover:bg-panel-3 hover:text-ink" aria-label="Schließen">
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-4 text-[12.5px] leading-relaxed text-ink-2 sm:grid-cols-2">
          <div>
            <div className="label mb-1">Chat & KI-Telefon</div>
            <ul className="space-y-1">
              <li>• Beide nutzen denselben Agenten, dieselben {Object.keys(TOOL_META).length} Werkzeuge und denselben Gesprächsverlauf.</li>
              <li>• Die KI antwortet nur mit Daten aus dem Werk – Fachbegriffe erklärt er am aktuellen Werksbeispiel.</li>
              <li>• Folgefragen funktionieren: „Und SG-03?“, „Warum?“, „Was passiert, wenn wir nichts tun?“, „Ja, mach das.“</li>
            </ul>
          </div>
          <div>
            <div className="label mb-1">KI-Telefon</div>
            <ul className="space-y-1">
              <li>• „Gespräch starten“, Mikrofon erlauben, frei sprechen.</li>
              <li>• Auf den Orb tippen unterbricht die KI; „Tschüss“ oder der rote Knopf legt auf.</li>
              <li>• „Testanruf“ zeigt ein Beispielgespräch – ganz ohne Mikrofon.</li>
              <li>• Im Protokoll stehen Werkzeuge, Zahlen und Details jeder Antwort.</li>
            </ul>
          </div>
          <div>
            <div className="label mb-1">Gute Fragen</div>
            <ul className="space-y-1">
              <li>• „Was sind gerade die größten Risiken?“</li>
              <li>• „Welche Maschine macht uns Sorgen – und warum?“</li>
              <li>• „Können wir die Eilanfrage zusagen?“</li>
              <li>• „Wie läuft es bei Alpenmilch?“ · „Was kostet eine Stunde Stillstand?“</li>
            </ul>
          </div>
          <div>
            <div className="label mb-1">Leitplanken</div>
            <ul className="space-y-1">
              <li>• Zahlen nur aus Werkzeugen, Quellen mit Dokument-ID</li>
              <li>• Aktionen nur als Entwurf – ein Mensch gibt frei</li>
              <li>• Keine Leistungsdaten von Personen (Betriebsrat, DSGVO)</li>
              <li>• Sprachausgabe lokal im Browser; Spracherkennung über den Browser-Dienst – im Werksbetrieb lokal (z. B. Whisper on-premise), keine Aufzeichnung</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WerksexpertePage() {
  const raw = useUi((s) => s.snap?.tickets);
  const send = useChat((s) => s.send);
  const [mode, setModeRaw] = useState<Mode>("chat");
  const [phonePrompt, setPhonePrompt] = useState<{ text: string; nonce: number }>();
  const [help, setHelp] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [allDone, setAllDone] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("modus") === "telefon") setModeRaw("telefon");
  }, []);

  const setMode = (m: Mode) => {
    setModeRaw(m);
    const u = new URL(window.location.href);
    if (m === "telefon") u.searchParams.set("modus", "telefon");
    else u.searchParams.delete("modus");
    window.history.replaceState(null, "", u);
  };

  const askTool = (q: string) => {
    if (mode === "telefon") setPhonePrompt({ text: q, nonce: Date.now() });
    else send(q);
  };

  const tickets = raw ?? [];
  const open = tickets.filter((t) => t.status === "ENTWURF");
  const recent = tickets.filter((t) => t.status !== "ENTWURF");

  return (
    <div className="grid h-[calc(100dvh-60px-48px)] gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--ai-1),var(--ai-2))] text-white shadow-[0_8px_24px_-8px_var(--ai-1)]">
            <Sparkles size={19} />
          </div>
          <div className="min-w-0">
            <div className="wide text-[17px] font-bold tracking-[-0.02em]">KI-Werksexperte</div>
            <div className="truncate text-[11.5px] text-muted">Kennt dein Werk live und berät wie ein Experte – Produktion, Wartung, Qualität, Logistik, Vertrieb und Zahlen.</div>
          </div>
          <button onClick={() => setHelp(true)} className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-ink-2 hover:bg-panel-3 hover:text-ink">
            <CircleHelp size={16} /> Hilfe
          </button>
        </div>

        <div className="flex justify-center border-b border-line px-4 py-2.5">
          <div className="flex rounded-xl bg-panel-2 p-1">
            {(
              [
                ["chat", "Chat", MessageSquare],
                ["telefon", "KI-Telefon", PhoneIcon],
              ] as const
            ).map(([k, label, Icon]) => (
              <button
                key={k}
                onClick={() => setMode(k)}
                className={cn("flex min-w-[150px] items-center justify-center gap-2 rounded-lg px-5 py-2 text-[13px] font-semibold transition", mode === k ? "bg-accent text-white shadow-[0_6px_18px_-8px_var(--ai-1)]" : "text-ink-2 hover:text-ink")}
              >
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1">{mode === "chat" ? <Chat /> : <Phone prompt={phonePrompt} onOpenChat={() => setMode("chat")} />}</div>
      </section>

      <div className="scroll-thin flex min-h-0 flex-col gap-4 overflow-y-auto">
        <div id="freigaben">
          <Panel
            title={`Freigaben · ${open.length} offen`}
            subtitle="Human-in-the-Loop, wo wichtig, mit klaren Nachweisen."
            icon={<ShieldCheck size={16} />}
            actions={
              open.length > 2 ? (
                <button onClick={() => setAllOpen((v) => !v)} className="flex items-center gap-1 text-[11.5px] font-semibold text-accent">
                  {allOpen ? "Weniger" : "Alle anzeigen"} <ArrowRight size={12} />
                </button>
              ) : undefined
            }
          >
            <div className="space-y-2">
              {open.length === 0 && (
                <div className="flex items-start gap-2.5 rounded-lg bg-panel-2 p-3 text-[12px] text-muted">
                  <ShieldCheck size={16} className="mt-0.5 shrink-0" /> Keine offenen Vorgänge. Bitte den Werksexperten z. B.: „Plane eine Wartung für SG-04.“
                </div>
              )}
              {(allOpen ? open : open.slice(0, 2)).map((t) => (
                <TicketView key={t.id} ticket={t} />
              ))}
              {recent.length > 0 && (
                <div className="flex items-center justify-between pt-2">
                  <span className="label">Zuletzt in Bearbeitung</span>
                  {recent.length > 2 && (
                    <button onClick={() => setAllDone((v) => !v)} className="flex items-center gap-1 text-[11px] font-semibold text-accent">
                      {allDone ? "Weniger" : "Verlauf"} <ArrowRight size={11} />
                    </button>
                  )}
                </div>
              )}
              {recent.slice(0, allDone ? 8 : 2).map((t) => (
                <TicketView key={t.id} ticket={t} />
              ))}
            </div>
          </Panel>
        </div>

        <Panel title="Werkzeuge des Agenten" subtitle={`Direkter Zugriff auf Werksdaten und Systeme · ${Object.keys(TOOL_META).length} Werkzeuge – Klick stellt eine Beispielfrage`} icon={<Wrench size={16} />}>
          <div className="-mx-1.5 space-y-0.5">
            {TOOLS_UI.map((t) => (
              <button key={t.label} onClick={() => askTool(t.q)} className="group flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-panel-2" title={`„${t.q}“`}>
                <t.icon size={15} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{t.label}</span>
                  <span className="num block truncate text-[10px] text-muted">{t.system}</span>
                </span>
                <ChevronRight size={14} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </Panel>
      </div>

      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  );
}
