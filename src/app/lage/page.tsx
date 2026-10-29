"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Boxes, CalendarClock, Euro, Factory, FileText, Lightbulb, Radio, Sparkles, Truck, Volume2, VolumeX, Wrench } from "lucide-react";
import { useUi } from "@/lib/client/store";
import type { Briefing } from "@/lib/sim/reports";
import { fmtAgo, fmtEur, fmtInt, fmtKEur, fmtPct, fmtTime } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { Button, PageHeader, Panel, SourceTag, StatusDot } from "@/components/ui/ui";
import { Legend } from "@/components/ui/chartkit";

const AREA_ICON: Record<string, typeof Factory> = { Werk: Factory, Maschinen: Wrench, "LKW-Hof": Truck, "Lager & Material": Boxes, Finanzen: Euro, "KI-Prognose": Sparkles };

function useBriefing() {
  const [b, setB] = useState<Briefing | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/briefing", { cache: "no-store" });
        if (r.ok && alive) setB(await r.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return b;
}

/** Lagebericht vorlesen (Web Speech API, deutsche Stimme) */
function useSpeech() {
  const [on, setOn] = useState(false);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  const speak = (text: string) => {
    const s = window.speechSynthesis;
    if (!s) return;
    if (on) {
      s.cancel();
      setOn(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(text.replace(/T€/g, " tausend Euro").replace(/Mio\./g, "Millionen").replace(/ · /g, ", "));
    u.lang = "de-DE";
    u.rate = 1.04;
    const voice = s.getVoices().find((v) => v.lang.startsWith("de"));
    if (voice) u.voice = voice;
    u.onend = () => setOn(false);
    s.cancel();
    s.speak(u);
    setOn(true);
  };
  return { on, speak };
}

export default function LagePage() {
  const b = useBriefing();
  const now = useUi((s) => s.snap?.now);
  const openCopilot = useUi((s) => s.openCopilot);
  const { on, speak } = useSpeech();
  const [lastVisit] = useState(() => {
    try {
      const v = Number(localStorage.getItem("cortex-lage-seen") || 0);
      localStorage.setItem("cortex-lage-seen", String(Date.now()));
      return v;
    } catch {
      return 0;
    }
  });
  const k = b?.kpis;
  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Radio size={12} className="text-ok" /> Lagebericht · live aus allen Systemen
          </>
        }
        title={b ? b.headline : "Lage wird zusammengestellt …"}
        desc={b ? `${b.greeting} – so steht das Werk Nord gerade da. Aktualisiert ${fmtTime(b.now)} Uhr${lastVisit ? ` · zuletzt hier ${fmtAgo(lastVisit, now ?? Date.now())}` : ""}.` : "Die KI fasst Produktion, Instandhaltung, LKW-Hof, Lager und Finanzen in Sätzen zusammen – wie ein Schichtleiter, der berichtet."}
        actions={
          <>
            <Button onClick={() => b && speak(b.paragraphs.map((p) => p.text).join(" "))} disabled={!b}>
              {on ? <VolumeX size={14} /> : <Volume2 size={14} />} {on ? "Stopp" : "Vorlesen"}
            </Button>
            <Link href="/bericht" className="contents">
              <Button>
                <FileText size={14} /> Bericht herunterladen
              </Button>
            </Link>
            <Button variant="ai" onClick={() => openCopilot("Was ist gerade das Wichtigste im Werk und was soll ich als Nächstes tun?")}>
              <Sparkles size={14} /> Nachfragen
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-7">
        {[
          ["OEE heute", k ? fmtPct(k.oee, 1) : "–", "Ziel 85 %"],
          ["Gutteile", k ? fmtInt(k.good) : "–", "seit 06:00"],
          ["Linien", k ? `${k.running}/${k.total}` : "–", "in Produktion"],
          ["LKW auf dem Hof", k ? `${k.onSite}` : "–", "Tor · Warten · Rampe"],
          ["Fertigware", k ? `${fmtInt(k.pallets)} Pal.` : "–", "Hochregallager + Halle C"],
          ["Umsatz heute", k ? fmtKEur(k.revenue) : "–", k ? `Ergebnis ${k.result >= 0 ? "+" : ""}${fmtKEur(k.result)}` : ""],
          ["Verlust heute", k ? fmtKEur(k.loss) : "–", "entgangener DB"],
        ].map(([l, v, s]) => (
          <div key={l} className="panel px-3.5 py-2.5">
            <div className="label truncate text-[9px]">{l}</div>
            <div className={cn("num mt-0.5 truncate text-[19px] font-bold", l === "Verlust heute" && "text-crit")}>{v}</div>
            <div className="truncate text-[10.5px] text-muted">{s}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          {(b?.paragraphs ?? []).map((p) => {
            const Icon = AREA_ICON[p.area] ?? Sparkles;
            return (
              <div key={p.area} className={cn("panel fade-in flex gap-3 p-4", p.sev === "crit" && "border-crit/50", p.sev === "warn" && "border-warn/50", p.area === "KI-Prognose" && "ai-border")}>
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", p.sev === "crit" ? "bg-crit-soft text-crit" : p.sev === "warn" ? "bg-warn-soft text-warn" : p.area === "KI-Prognose" ? "bg-[linear-gradient(135deg,var(--ai-1),var(--ai-2))] text-white" : "bg-panel-2 text-ink-2")}>
                  <Icon size={17} />
                </div>
                <div className="min-w-0">
                  <div className="label flex items-center gap-1.5 text-[9.5px]">
                    {p.area} <StatusDot sev={p.sev} pulse={p.sev === "crit"} />
                  </div>
                  <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink">{p.text}</p>
                </div>
              </div>
            );
          })}
          {!b && <div className="skeleton h-[480px] rounded-2xl" />}
          {b && (
            <Legend
              className="px-1"
              items={[
                { color: "var(--ok)", kind: "dot", label: "grüner Punkt: alles im Soll" },
                { color: "var(--warn)", kind: "dot", label: "gelb: Aufmerksamkeit" },
                { color: "var(--crit)", kind: "dot", label: "rot (pulsierend): sofort handeln" },
                { color: "var(--accent)", kind: "dot", label: "blau: Information / Prognose" },
              ]}
            />
          )}
          {b && (
            <Panel title="KI-Empfehlungen" subtitle="Konkrete nächste Schritte – nach Dringlichkeit und Wirkung" icon={<Lightbulb size={16} />} ai>
              <div className="grid gap-2 md:grid-cols-2">
                {b.recommendations.map((x) => (
                  <Link key={x.id} href={x.href} className={cn("rounded-xl border p-3 transition-colors hover:bg-panel-2", x.sev === "crit" ? "border-crit/50" : x.sev === "warn" ? "border-warn/50" : "border-line")}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="label text-[9px]">{x.area}</div>
                      {x.impactEur ? <span className="num rounded-md bg-ok-soft px-1.5 py-0.5 text-[10.5px] font-bold text-ok">~{fmtEur(x.impactEur)}</span> : null}
                    </div>
                    <div className="mt-0.5 text-[12.5px] font-semibold leading-snug">{x.title}</div>
                    <div className="mt-1 text-[11.5px] text-ink-2">→ {x.action}</div>
                  </Link>
                ))}
                {!b.recommendations.length && <div className="text-[12px] text-muted">Keine offenen Maßnahmen – alles im Soll.</div>}
              </div>
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Was hat sich verändert?" subtitle="Letzte Stunde, seit Schichtbeginn und gegenüber gestern" icon={<ArrowUpRight size={16} />}>
            <div className="space-y-1">
              {(b?.changes ?? []).map((c) => (
                <div key={c.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-panel-2">
                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", c.good ? "bg-ok-soft text-ok" : "bg-crit-soft text-crit")}>{c.dir === "up" ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium">{c.text}</div>
                    <div className="label text-[9px]">{c.area}</div>
                  </div>
                  <span className={cn("num shrink-0 text-[11.5px] font-semibold", c.good ? "text-ok" : "text-crit")}>{c.value}</span>
                </div>
              ))}
              {b && !b.changes.length && <div className="text-[12px] text-muted">Keine nennenswerten Veränderungen in der letzten Stunde.</div>}
            </div>
            <Legend
              className="mt-2"
              items={[
                { color: "var(--ok)", label: "grün: Veränderung zum Guten" },
                { color: "var(--crit)", label: "rot: Veränderung zum Schlechten" },
              ]}
              note="Pfeil ↗ = gestiegen, ↘ = gesunken · rechts: vorher → jetzt"
            />
          </Panel>
          <Panel title="Als Nächstes" subtitle="Die kommenden 3 Stunden" icon={<CalendarClock size={16} />}>
            <div className="relative space-y-2 pl-4">
              <div className="absolute bottom-1 left-[5px] top-1 w-px bg-line" />
              {(b?.next ?? []).map((n, i) => (
                <div key={i} className="relative">
                  <span className="absolute -left-[14px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-accent bg-panel" />
                  <div className="num text-[10.5px] font-semibold text-muted">
                    {fmtTime(n.t)} · {n.kind}
                  </div>
                  <div className="text-[12px] text-ink-2">{n.text}</div>
                </div>
              ))}
              {b && !b.next.length && <div className="text-[12px] text-muted">Keine Termine in den nächsten 3 Stunden.</div>}
            </div>
          </Panel>
          <Panel title="Gerade passiert" subtitle="Ereignisse aus MES, IoT, SAP, TMS, CAQ" icon={<Radio size={16} />}>
            <div className="space-y-1.5">
              {(b?.events ?? []).map((e) => (
                <div key={e.id} className="flex gap-2.5">
                  <div className="num w-10 shrink-0 pt-0.5 text-[10.5px] text-faint">{fmtTime(e.t)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <SourceTag source={e.source} />
                      <span className="truncate text-[12px] font-medium">{e.title}</span>
                    </div>
                    {e.detail && <div className="line-clamp-1 text-[11px] text-muted">{e.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
