"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useUi } from "@/lib/client/store";
import CopilotDrawer from "@/components/copilot/CopilotDrawer";
import DemoDirector from "./DemoDirector";
import Intro from "./Intro";
import LiveProvider from "./LiveProvider";
import Sidebar from "./Sidebar";
import Toasts from "./Toasts";
import Topbar from "./Topbar";
import { cn } from "@/lib/client/cn";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullBleed = pathname === "/";

  useEffect(() => {
    // Zuletzt gewählter Zustand, sonst auf kleinen Bildschirmen eingeklappt starten
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("cortex-sidebar");
    } catch {}
    useUi.setState({ sidebarCollapsed: saved ? saved === "closed" : window.innerWidth < 1280 });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useUi.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (s.copilotOpen) s.closeCopilot();
        else s.openCopilot();
      } else if (e.shiftKey && e.key.toLowerCase() === "d" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        s.toggleDirector();
      } else if (e.key === "[" && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        s.toggleSidebar();
      } else if (e.key === "Escape") {
        if (s.copilotOpen) s.closeCopilot();
        else if (s.directorOpen) s.toggleDirector(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-dvh w-full overflow-hidden print:block print:h-auto print:overflow-visible">
      <LiveProvider />
      <div className="contents print:hidden">
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col print:block">
        <div className="contents print:hidden">
          <Topbar />
        </div>
        <main className={cn("relative min-h-0 flex-1 print:overflow-visible", fullBleed ? "overflow-hidden" : "blueprint scroll-thin overflow-y-auto")}>
          {fullBleed ? children : <div className="mx-auto w-full max-w-[1480px] px-6 py-6">{children}</div>}
        </main>
      </div>
      <CopilotDrawer />
      <DemoDirector />
      <Toasts />
      <Intro />
    </div>
  );
}
