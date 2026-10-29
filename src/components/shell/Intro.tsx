"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Factory, Handshake, ScanEye, Sparkles, Truck, Workflow, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { LogoMark } from "./Logo";

const PILLARS = [
  { icon: Workflow, t: "Datenintegration", d: "SAP, MES, OPC UA, CAQ, WMS, TMS in einem Datenmodell" },
  { icon: Factory, t: "Transparenz in Echtzeit", d: "Digitaler Zwilling von Produktion, Vertrieb & Logistik" },
  { icon: Wrench, t: "Predictive Maintenance", d: "Ausfälle Stunden vorher erkennen – erklärbar" },
  { icon: ScanEye, t: "Qualitätskontrolle", d: "Bildverarbeitung + SPC-Frühwarnung" },
  { icon: Handshake, t: "Vertrieb", d: "Liefertermin-Prognose & Machbarkeit in Sekunden" },
  { icon: Truck, t: "Logistik", d: "Reichweiten, Lieferverzug, Versand" },
];

export default function Intro() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (!sessionStorage.getItem("cortex-intro")) setShow(true);
    } catch {
      setShow(true);
    }
  }, []);
  const close = () => {
    try {
      sessionStorage.setItem("cortex-intro", "1");
    } catch {}
    setShow(false);
  };
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="blueprint grain fixed inset-0 z-[100] flex items-center justify-center overflow-hidden" initial={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.02 }} transition={{ duration: 0.5 }}>
          <div className="pointer-events-none absolute -left-40 top-1/4 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,var(--ai-1)_0%,transparent_65%)] opacity-[0.13] blur-2xl" />
          <div className="pointer-events-none absolute -right-40 bottom-0 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,var(--ai-2)_0%,transparent_65%)] opacity-[0.13] blur-2xl" />
          <div className="relative mx-6 w-full max-w-5xl">
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6 }} className="flex items-center gap-3">
              <LogoMark size={40} />
              <div>
                <div className="label">Unternehmen · Werk Nord</div>
                <div className="text-[12px] text-muted">Prototyp · Unternehmens-KI</div>
              </div>
            </motion.div>
            <motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22, duration: 0.7, ease: [0.22, 1, 0.36, 1] }} className="wide mt-8 text-[clamp(40px,6.4vw,84px)] font-extrabold leading-[0.95] tracking-[-0.045em]">
              Ein Gehirn
              <br />
              für das <span className="ai-text">ganze Werk.</span>
            </motion.h1>
            <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38, duration: 0.6 }} className="mt-5 max-w-2xl text-[16px] leading-relaxed text-ink-2">
              <b>KI-Werk</b> macht Informationen aus Produktion, Vertrieb und Logistik transparent und in Echtzeit verfügbar – und setzt KI dort ein, wo sie messbar Geld spart: vorausschauende Wartung, automatisierte Qualitätskontrolle und ein KI-Werksexperte, der jede Abteilung versteht.
            </motion.p>
            <div className="mt-8 grid grid-cols-2 gap-2.5 md:grid-cols-3">
              {PILLARS.map((p, i) => (
                <motion.div key={p.t} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 + i * 0.07, duration: 0.5 }} className="panel flex gap-3 p-3.5">
                  <p.icon size={18} className="mt-0.5 shrink-0 text-accent" strokeWidth={1.8} />
                  <div>
                    <div className="text-[13px] font-semibold">{p.t}</div>
                    <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{p.d}</div>
                  </div>
                </motion.div>
              ))}
            </div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.0, duration: 0.5 }} className="mt-9 flex flex-wrap items-center gap-4">
              <button onClick={close} className="group inline-flex h-12 items-center gap-2.5 rounded-xl bg-ink px-6 text-[14.5px] font-semibold text-bg shadow-[var(--shadow-lg)] transition-transform hover:scale-[1.02]">
                Leitstand öffnen <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
              </button>
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <Sparkles size={14} className="text-accent" />
                Alle Daten sind realistisch simuliert – die Architektur ist für SAP, MES & OPC UA ausgelegt.
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
