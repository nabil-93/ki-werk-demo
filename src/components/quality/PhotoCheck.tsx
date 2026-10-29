"use client";

import { Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { VisionResult } from "@/lib/ai/vision";
import { cn } from "@/lib/client/cn";
import { Badge, Button } from "@/components/ui/ui";
import { fmtPct } from "@/lib/ai/format";

/** Echtes Foto eines Bechers prüfen (Claude Vision, strukturierte Ausgabe) */
export default function PhotoCheck() {
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<VisionResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const onFile = async (f: File) => {
    setErr(null);
    setRes(null);
    if (!/image\/(png|jpeg|webp)/.test(f.type)) {
      setErr("Bitte PNG, JPEG oder WebP verwenden.");
      return;
    }
    const url = await new Promise<string>((ok) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.readAsDataURL(f);
    });
    setImg(url);
    setBusy(true);
    try {
      const resp = await fetch("/api/vision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: url.split(",")[1], mediaType: f.type }) });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j.error ?? "Fehler");
      setRes(j.result);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
      <button
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
        className={cn("relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-line bg-panel-2 text-center hover:border-accent/60")}
      >
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="Prüfbild" className="h-full w-full object-cover" />
        ) : (
          <div className="px-3 text-[11.5px] text-muted">
            <Upload size={20} className="mx-auto mb-1.5 text-faint" />
            Foto eines Bechers oder Deckels hierher ziehen oder klicken
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
            <Loader2 className="animate-spin" />
          </div>
        )}
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <div className="min-w-0">
        {!res && !err && (
          <div className="text-[12px] leading-relaxed text-muted">
            Für neue Fehlerbilder ohne Trainingsdaten kann ein multimodales Modell (Claude) das Foto wie ein Prüfer bewerten und einen <b className="text-ink-2">strukturierten Prüfbefund</b> (JSON-Schema) liefern – ideal als Vorstufe, bevor ein eigenes Bildmodell trainiert wird.
            <div className="mt-2">
              <Button size="sm" onClick={() => input.current?.click()}>
                <Upload size={13} /> Foto auswählen
              </Button>
            </div>
          </div>
        )}
        {err && <div className="rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-warn">{err}</div>}
        {res && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge sev={res.urteil === "IO" ? "ok" : res.urteil === "NIO" ? "crit" : "neutral"}>{res.urteil === "IO" ? "i.O." : res.urteil === "NIO" ? "n.i.O." : "unklar"}</Badge>
              <span className="text-[12.5px] font-semibold">{res.objekt}</span>
              <span className="num ml-auto text-[11px] text-muted">Konfidenz {fmtPct(res.konfidenz, 0)}</span>
            </div>
            {res.befunde.map((b, i) => (
              <div key={i} className="rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[11.5px]">
                <div className="flex items-center gap-2">
                  <b>{b.fehlerart}</b>
                  <Badge sev={b.schwere === "kritisch" ? "crit" : b.schwere === "mittel" ? "warn" : "neutral"}>{b.schwere}</Badge>
                  <span className="ml-auto text-muted">{b.ort}</span>
                </div>
                <div className="mt-0.5 text-ink-2">{b.beschreibung}</div>
              </div>
            ))}
            <div className="rounded-lg bg-accent-soft/60 px-2.5 py-1.5 text-[11.5px] text-ink">Empfehlung: {res.empfehlung}</div>
          </div>
        )}
      </div>
    </div>
  );
}
