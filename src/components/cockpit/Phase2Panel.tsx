"use client";

// Rollout Phase 2: Detailpanel einer Maschine, die produziert, aber noch keine Daten liefert.
// „Jetzt anbinden“ spielt die Inbetriebnahme durch (Gateway, Signale, SAP-Verknüpfung) und schaltet
// die Maschine in der Simulation live – danach zeigt der Leitstand die normale Maschinenansicht.

import { useState } from "react";
import { Cable, Check, EyeOff, Loader2, PlugZap, Unplug, X } from "lucide-react";
import { control, refreshSnapshot, useUi } from "@/lib/client/store";
import { MACHINE_SEEDS, PHASE2_SEED, PHASE2_SEEDS, PRODUCT, type Phase2Seed } from "@/lib/sim/catalog";
import { fmtEur, fmtNum } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { Button } from "@/components/ui/ui";
import { Fraction } from "@/components/ops/Visit";
import { BackButton } from "./OpsPanels";

const SG_TOTAL = MACHINE_SEEDS.filter((s) => s.type === "SG").length + PHASE2_SEEDS.length;

const steps = (s: Phase2Seed) => [
  `Werksnetz und ${s.link.via === "Retrofit-Box" ? "IoT-Gateway" : "Steuerung"} erkannt`,
  `${s.link.via} verbunden`,
  `${s.link.signals} Signale zugeordnet (Schwingung, Temperaturen, Druck, Zyklus, Energie)`,
  "Stammdaten aus SAP verknüpft (Auftrag, Artikel, Kostenstelle)",
  "Live-Daten fließen in MES und in die KI",
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmtDays = (d: number) => (d < 1 ? "½ Tag" : d === 1 ? "1 Tag" : `${fmtNum(d, 0)} Tage`);

const MISSING = [
  ["Live-Status und Stillstände", "nur auf dem Schichtzettel – in SAP erst am nächsten Tag"],
  ["KI-Frühwarnung (Predictive Maintenance)", "ohne Sensordaten nicht möglich – Ausfälle kommen überraschend"],
  ["Ausschuss und Qualität", "erst bei der Endkontrolle sichtbar, nicht in der Linie"],
  ["OEE, Energie und Verlust in €", "unbekannt – fehlen im Werksbericht"],
];

export default function Phase2Panel({ id }: { id: string }) {
  const s = PHASE2_SEED[id];
  const select = useUi((st) => st.selectMachine);
  const setLinking = useUi((st) => st.setLinking);
  const connectedSg = useUi((st) => st.snap?.machines.filter((m) => m.type === "SG").length ?? 0);
  // -1 = bereit, 0..n-1 = Schritt läuft, n = fertig
  const [step, setStep] = useState(-1);
  if (!s) return null;
  const list = steps(s);
  const busy = step >= 0;

  const connect = async () => {
    if (busy) return;
    setLinking(s.id);
    for (let i = 0; i < list.length; i++) {
      setStep(i);
      // vor dem letzten Schritt wird die Maschine in der Simulation tatsächlich angebunden
      if (i === list.length - 1) {
        await control("connect", { machine: s.id });
        await refreshSnapshot();
      }
      await wait(i === list.length - 1 ? 600 : 750);
    }
    setStep(list.length);
    await wait(1500);
    // Panel wechselt danach in die normale Maschinenansicht
    setLinking(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <BackButton onClick={() => select(null)} label="Zurück zur Übersicht" />
          <div className="flex items-center gap-2">
            <span className="num text-[17px] font-bold">{s.id}</span>
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold", step >= list.length ? "border-ok/40 bg-ok-soft text-ok" : "border-dashed border-faint text-muted")}>
              {step >= list.length ? <PlugZap size={11} /> : <Unplug size={11} />} {step >= list.length ? "angebunden" : "nicht angebunden"}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted">
            {s.maker} {s.model} · Bj. {s.year} · {s.cavities}-fach · Halle {s.hall} · Rollout Phase 2
          </div>
        </div>
        <button onClick={() => select(null)} className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-ink" aria-label="Schließen">
          <X size={16} />
        </button>
      </div>

      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-4 py-3.5">
        <div className="rounded-xl border border-dashed border-faint bg-panel-2 p-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <EyeOff size={15} className="shrink-0 text-muted" /> Die Maschine produziert – aber die KI sieht sie nicht.
          </div>
          <div className="mt-1 text-[11.5px] leading-snug text-muted">
            Laut SAP läuft hier <span className="font-semibold text-ink-2">{PRODUCT[s.productId].name}</span>. Wie gut, wie schnell und ob sie gerade steht, weiß niemand – bis der Schichtzettel abgegeben ist.
          </div>
        </div>

        <div>
          <div className="label mb-1.5">Was ohne Anbindung fehlt</div>
          <div className="space-y-1.5">
            {MISSING.map(([t, d]) => (
              <div key={t} className="flex gap-2 text-[11.5px]">
                <X size={13} className="mt-0.5 shrink-0 text-crit" />
                <span>
                  <span className="font-semibold">{t}</span> <span className="text-muted">– {d}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-line p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold">
            <Cable size={13} className="text-accent" /> So wird sie angebunden: {s.link.via}
          </div>
          <div className="text-[11.5px] leading-snug text-muted">{s.link.detail}</div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              ["Signale", `${s.link.signals}`],
              ["Aufwand", `ca. ${fmtEur(s.link.costEur)}`],
              ["Dauer", fmtDays(s.link.days)],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-panel-2 px-2.5 py-1.5">
                <div className="label text-[8.5px]">{l}</div>
                <div className="num text-[13px] font-semibold">{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11.5px] text-ink-2">
            Ein vermiedener ungeplanter Ausfall (ca. 5 h) spart hier rund <span className="num font-semibold">{fmtEur(s.costPerHour * 5)}</span> – die Anbindung hat sich damit schon beim ersten Mal bezahlt gemacht.
          </div>
        </div>

        <Fraction label="Spritzgießmaschinen in Halle A mit Datenanschluss" done={connectedSg} total={SG_TOTAL} big />
      </div>

      <div className="border-t border-line p-3">
        {busy && (
          <div className="ai-border mb-3 rounded-xl bg-panel p-3">
            <div className="label mb-2">Inbetriebnahme</div>
            <div className="space-y-1.5">
              {list.map((t, i) => (
                <div key={t} className={cn("flex items-start gap-2 text-[11.5px] transition-opacity", i > step && "opacity-35")}>
                  {i < step || step >= list.length ? <Check size={14} className="mt-px shrink-0 text-ok" /> : i === step ? <Loader2 size={14} className="mt-px shrink-0 animate-spin text-accent" /> : <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-faint" />}
                  <span className={cn(i === step && step < list.length && "font-semibold")}>{t}</span>
                </div>
              ))}
            </div>
            {step >= list.length && <div className="mt-2 text-[11.5px] font-semibold text-ok">{s.id} ist live – ab jetzt mit Status, Sensorik, 15-Minuten-Raster und KI-Prognose.</div>}
          </div>
        )}
        <Button variant="primary" className="w-full" onClick={connect} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} {busy ? "Wird angebunden …" : "Jetzt anbinden (Demo)"}
        </Button>
        <div className="mt-1.5 text-center text-[10.5px] text-faint">In echt: Netzwerk, Gateway, Signal-Mapping und Test – ca. {fmtDays(s.link.days)} je Maschine.</div>
      </div>
    </div>
  );
}
