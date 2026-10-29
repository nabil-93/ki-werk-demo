"use client";

// Fehlerseite innerhalb der App: Nach einem neuen Build fehlen alte JS-Dateien → automatisch neu laden.
// Andere Fehler zeigen eine verständliche Meldung statt einer leeren Seite.

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { healOnce, isChunkError } from "@/lib/client/heal";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const chunk = isChunkError(error);
  const [reloading, setReloading] = useState(chunk);

  useEffect(() => {
    if (chunk) setReloading(healOnce());
    else console.error(error);
  }, [chunk, error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="panel max-w-md p-6 text-center">
        <RefreshCw size={22} className={reloading ? "mx-auto animate-spin text-accent" : "mx-auto text-accent"} />
        <div className="mt-3 text-[15px] font-semibold">{reloading ? "Neue Version – die Seite wird neu geladen …" : "Diese Ansicht konnte nicht geladen werden."}</div>
        <div className="mt-1 text-[12.5px] text-muted">{reloading ? "Einen Moment bitte." : "Bitte neu laden. Die Werksdaten laufen im Hintergrund weiter."}</div>
        {!reloading && (
          <div className="mt-4 flex justify-center gap-2">
            <button onClick={() => window.location.reload()} className="rounded-lg bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-bg">
              Neu laden
            </button>
            <button onClick={() => reset()} className="rounded-lg border border-line px-3.5 py-2 text-[12.5px] font-semibold">
              Nochmal versuchen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
