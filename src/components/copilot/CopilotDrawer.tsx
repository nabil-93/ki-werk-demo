"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Maximize2, Phone, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUi } from "@/lib/client/store";
import { TOOL_META } from "@/lib/ai/toolMeta";
import Chat from "./Chat";

export default function CopilotDrawer() {
  const open = useUi((s) => s.copilotOpen);
  const close = useUi((s) => s.closeCopilot);
  const pathname = usePathname();
  const onPage = pathname.startsWith("/werksexperte");
  return (
    <AnimatePresence>
      {open && !onPage && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] bg-black/25" onClick={close} />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 34 }}
            className="fixed bottom-0 right-0 top-0 z-[90] flex w-[min(520px,100vw)] flex-col border-l border-line bg-panel shadow-[var(--shadow-lg)]"
          >
            <div className="flex h-[60px] items-center gap-2.5 border-b border-line px-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[linear-gradient(135deg,var(--ai-1),var(--ai-2))] text-white">
                <Sparkles size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">KI-Werksexperte</div>
                <div className="text-[11px] text-muted">Agent mit Zugriff auf {Object.keys(TOOL_META).length} Werkzeuge in 8 Systemen</div>
              </div>
              <Link href="/werksexperte?modus=telefon" onClick={close} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11.5px] font-medium text-accent hover:bg-accent-soft" title="KI-Telefon">
                <Phone size={14} /> Anrufen
              </Link>
              <Link href="/werksexperte" onClick={close} className="rounded-md p-1.5 text-muted hover:bg-panel-3 hover:text-ink" title="Vollbild">
                <Maximize2 size={15} />
              </Link>
              <button onClick={close} className="rounded-md p-1.5 text-muted hover:bg-panel-3 hover:text-ink" aria-label="Schließen">
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Chat compact />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
