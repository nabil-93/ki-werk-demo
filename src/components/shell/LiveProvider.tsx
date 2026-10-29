"use client";

import { useEffect } from "react";
import { useUi } from "@/lib/client/store";

/** Holt jede Sekunde den Werkszustand (wie ein MQTT/WebSocket-Feed in der Produktion). */
export default function LiveProvider() {
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let inflight = false;
    const tick = async () => {
      if (!alive) return;
      if (!inflight && document.visibilityState === "visible") {
        inflight = true;
        try {
          const res = await fetch("/api/snapshot", { cache: "no-store" });
          if (res.ok) useUi.getState().setSnap(await res.json());
          else useUi.getState().setError(`HTTP ${res.status}`);
        } catch (e) {
          useUi.getState().setError((e as Error).message);
        } finally {
          inflight = false;
        }
      }
      timer = setTimeout(tick, 1000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    try {
      const t = localStorage.getItem("cortex-theme");
      if (t === "dark" || t === "light") useUi.getState().setTheme(t);
    } catch {}
  }, []);
  return null;
}
