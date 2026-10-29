"use client";

// Letzte Fehlerebene (ersetzt das Root-Layout): gleiche Selbstheilung wie error.tsx, Styles inline,
// weil hier das App-CSS nicht sicher geladen ist.

import { useEffect, useState } from "react";
import { healOnce, isChunkError } from "@/lib/client/heal";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const chunk = isChunkError(error);
  const [reloading, setReloading] = useState(chunk);

  useEffect(() => {
    if (chunk) setReloading(healOnce());
    else console.error(error);
  }, [chunk, error]);

  return (
    <html lang="de">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f6f9fb", fontFamily: "Segoe UI, Arial, sans-serif", color: "#172033" }}>
        <div style={{ background: "#fff", border: "1px solid #dce2e8", borderRadius: 14, padding: 28, maxWidth: 420, textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{reloading ? "Neue Version – die Seite wird neu geladen …" : "KI-Werk konnte nicht geladen werden."}</div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#5b6478" }}>{reloading ? "Einen Moment bitte." : "Bitte neu laden. Die Werksdaten laufen im Hintergrund weiter."}</div>
          {!reloading && (
            <button onClick={() => window.location.reload()} style={{ marginTop: 16, background: "#172033", color: "#fff", border: 0, borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Neu laden
            </button>
          )}
        </div>
      </body>
    </html>
  );
}
