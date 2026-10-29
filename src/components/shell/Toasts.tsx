"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useUi } from "@/lib/client/store";
import type { PlantEvent } from "@/lib/sim/types";
import { SourceTag, StatusDot } from "@/components/ui/ui";
import { cn } from "@/lib/client/cn";

/** Zeigt neue Warnungen/Alarme als Benachrichtigung (wie Push auf Schichtleiter-Tablet). */
export default function Toasts() {
  const events = useUi((s) => s.snap?.events);
  const lastId = useRef<number | null>(null);
  const [items, setItems] = useState<PlantEvent[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!events?.length) return;
    if (lastId.current === null) {
      lastId.current = events[0].id;
      return;
    }
    const fresh = events.filter((e) => e.id > (lastId.current ?? 0) && (e.severity === "crit" || e.severity === "warn" || (e.source === "KI" && e.severity !== "ok")));
    lastId.current = events[0].id;
    if (fresh.length) setItems((prev) => [...fresh.slice(0, 3).reverse(), ...prev].slice(0, 4));
  }, [events]);

  useEffect(() => {
    if (!items.length) return;
    const t = setTimeout(() => setItems((prev) => prev.slice(0, -1)), 7000);
    return () => clearTimeout(t);
  }, [items]);

  const go = (e: PlantEvent) => {
    setItems((prev) => prev.filter((x) => x.id !== e.id));
    if (e.machineId) router.push(e.source === "CAQ" ? `/qualitaet?m=${e.machineId}` : e.source === "KI" || e.source === "CMMS" || e.source === "IoT" ? `/waechter?tab=akte&m=${e.machineId}` : `/produktion?m=${e.machineId}`);
    else if (e.orderId) router.push(`/vertrieb?o=${e.orderId}`);
    else if (e.source === "TMS" || e.source === "WMS") router.push("/logistik");
    else if (e.source === "CRM") router.push("/vertrieb");
  };

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[360px] flex-col-reverse gap-2">
      <AnimatePresence initial={false}>
        {items.map((e) => (
          <motion.div
            key={e.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className={cn("glass pointer-events-auto cursor-pointer overflow-hidden rounded-xl", e.severity === "crit" && "border-crit/40")}
            onClick={() => go(e)}
          >
            <div className={cn("h-0.5 w-full", e.severity === "crit" ? "bg-crit" : e.severity === "warn" ? "bg-warn" : "bg-accent")} />
            <div className="flex items-start gap-2.5 px-3.5 py-3">
              <StatusDot sev={e.severity} pulse={e.severity === "crit"} className="mt-1" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <SourceTag source={e.source} />
                  <div className="truncate text-[12.5px] font-semibold">{e.title}</div>
                </div>
                {e.detail && <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-muted">{e.detail}</div>}
              </div>
              <button
                onClick={(ev) => {
                  ev.stopPropagation();
                  setItems((prev) => prev.filter((x) => x.id !== e.id));
                }}
                className="rounded p-0.5 text-faint hover:text-ink"
                aria-label="Schließen"
              >
                <X size={14} />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
