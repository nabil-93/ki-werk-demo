"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Bringt eine Detailansicht ins Bild, sobald eine Auswahl getroffen wird.
 * Gescrollt wird nur, wenn der Anfang des Elements nicht schon im oberen Drittel
 * des sichtbaren Bereichs liegt (Scroll-Container ist <main> der AppShell).
 * `key` = aktuelle Auswahl, null = nichts tun. `bump()` nach jedem Klick aufrufen,
 * damit auch ein erneuter Klick auf dieselbe Auswahl wieder hinscrollt.
 */
export function useRevealOnSelect<T extends HTMLElement = HTMLDivElement>(key: string | null | undefined) {
  const ref = useRef<T>(null);
  const [n, setN] = useState(0);
  const bump = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    if (key == null) return;
    const f = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const main = el.closest("main");
      const top0 = main ? main.getBoundingClientRect().top : 0;
      const h = main ? main.clientHeight : window.innerHeight;
      const top = el.getBoundingClientRect().top - top0;
      if (top < -2 || top > h * 0.33) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(f);
  }, [key, n]);
  return { ref, bump };
}
