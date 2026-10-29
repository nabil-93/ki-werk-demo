"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Camera, ChartColumn, Lock, ScanEye, Sparkles, TriangleAlert } from "lucide-react";
import { refreshSnapshot, ticketAction, useUi } from "@/lib/client/store";
import { DEFECTS, PRODUCT } from "@/lib/sim/catalog";
import type { DefectType, SpcPoint } from "@/lib/sim/types";
import { fmtInt, fmtNum, fmtPct } from "@/lib/ai/format";
import { cn } from "@/lib/client/cn";
import { useRevealOnSelect } from "@/lib/client/reveal";
import { Badge, Button, PageHeader, Panel, StatusPill } from "@/components/ui/ui";
import { ChartTip, Legend, axisTick, gridProps } from "@/components/ui/chartkit";
import VisionStation from "@/components/quality/VisionStation";
import SpcChart from "@/components/quality/SpcChart";
import PhotoCheck from "@/components/quality/PhotoCheck";
import { TicketView } from "@/components/copilot/ToolCards";

function useSpc(id: string) {
  const [d, setD] = useState<{ spc: SpcPoint[]; spcSpec: { label: string; unit: string; nominal: number; tol: number } } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/machine?id=${id}`, { cache: "no-store" });
        if (r.ok && alive) setD(await r.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);
  return d;
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const snap = useUi((s) => s.snap);
  const openCopilot = useUi((s) => s.openCopilot);
  const fromUrl = sp.get("m");
  const [cam, setCam] = useState(fromUrl && ["SG-01", "SG-02", "SG-04", "SG-05", "SG-07", "SG-08"].includes(fromUrl) ? fromUrl : "SG-02");
  const spcId = fromUrl ?? cam;
  const spc = useSpc(spcId);
  const m = snap?.machines.find((x) => x.id === spcId);
  const [busy, setBusy] = useState(false);
  // Klick in „Qualität je Maschine“ → SPC-Regelkarte ins Bild scrollen (Kamera-Wechsel oben scrollt nicht)
  const [qPick, setQPick] = useState<string | null>(null);
  const reveal = useRevealOnSelect(qPick);

  const pareto = useMemo(() => {
    const sum: Partial<Record<DefectType, number>> = {};
    for (const x of snap?.machines ?? []) for (const [k, v] of Object.entries(x.defects)) sum[k as DefectType] = (sum[k as DefectType] ?? 0) + v;
    const rows = (Object.entries(sum) as [DefectType, number][]).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((s, r) => s + r[1], 0) || 1;
    let cum = 0;
    return rows.map(([k, v]) => {
      cum += v;
      return { k, label: DEFECTS[k].label.split(" /")[0], v, cum: cum / total };
    });
  }, [snap]);

  const totalScrap = snap ? snap.machines.reduce((s, x) => s + x.scrapToday, 0) : 0;
  const totalGood = snap ? snap.machines.reduce((s, x) => s + x.goodToday, 0) : 0;
  const ppm = totalScrap + totalGood > 0 ? (totalScrap / (totalScrap + totalGood)) * 1e6 : 0;
  const blocks = (snap?.tickets ?? []).filter((t) => t.kind === "qs-sperre" && t.machineId === spcId).slice(0, 1);

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <ScanEye size={12} /> Use-Case · Automatisierte Qualitätskontrolle
          </>
        }
        title="Jeder Becher geprüft. Drift erkannt, bevor Ausschuss entsteht."
        desc="Zwei Ebenen: Inline-Bildverarbeitung prüft jedes Teil (100 %-Kontrolle), statistische Prozesslenkung (SPC) erkennt schleichende Veränderungen im Prozess – oft Stunden bevor ein Teil außerhalb der Toleranz liegt."
        actions={
          <Button variant="ai" onClick={() => openCopilot(`Warum steigt der Ausschuss an ${spcId} und was sollen wir tun?`)}>
            <Sparkles size={15} /> Ursache analysieren
          </Button>
        }
      />

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Inline-Kamera · IML-Prüfstation" subtitle="Live-Bildverarbeitung im Browser · Golden-Sample-Vergleich" icon={<Camera size={16} />}>
          <VisionStation
            machineId={cam}
            onMachine={(id) => {
              setCam(id);
              router.replace(`/qualitaet?m=${id}`);
            }}
          />
        </Panel>
        <div className="grid gap-4">
          <Panel title="Qualität heute" subtitle="Gesamtwerk · CAQ + Kamera" icon={<ChartColumn size={16} />}>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-panel-2 px-2.5 py-2">
                <div className="label text-[9px]">Ausschuss</div>
                <div className="num text-[16px] font-semibold">{snap ? fmtPct(snap.kpis.scrapRate, 2) : "–"}</div>
              </div>
              <div className="rounded-lg bg-panel-2 px-2.5 py-2">
                <div className="label text-[9px]">Fehler-ppm</div>
                <div className="num text-[16px] font-semibold">{fmtInt(ppm)}</div>
              </div>
              <div className="rounded-lg bg-panel-2 px-2.5 py-2">
                <div className="label text-[9px]">SPC-Alarme</div>
                <div className={cn("num text-[16px] font-semibold", snap?.machines.some((x) => x.spcViolation) && "text-warn")}>{snap?.machines.filter((x) => x.spcViolation).length ?? 0}</div>
              </div>
            </div>
            <div className="label mb-1 mt-3">Fehler-Pareto (Stück heute)</div>
            <div className="h-[170px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pareto} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid {...gridProps} horizontal={false} vertical />
                  <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => fmtInt(v)} />
                  <YAxis type="category" dataKey="label" tick={{ ...axisTick, fontFamily: "var(--font-archivo)" }} width={118} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTip valueFormat={(v) => `${fmtInt(v)} Stk`} />} cursor={{ fill: "var(--panel-3)" }} />
                  <Bar dataKey="v" name="Fehler" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {pareto.map((p) => (
                      <Cell key={p.k} fill={p.k === "etikettenversatz" && pareto[0]?.k === p.k ? "var(--warn)" : "var(--accent)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Legend
              className="mt-1"
              items={[
                { color: "var(--accent)", label: "blauer Balken: Fehlerart (Stück heute)" },
                { color: "var(--warn)", label: "gelb: Etikettenversatz ist Hauptfehler" },
              ]}
              note="sortiert nach Häufigkeit (Pareto) – oben anfangen"
            />
          </Panel>
          <Panel title="Echtes Foto prüfen" subtitle="Multimodale KI (Claude Vision) · strukturierter Prüfbefund" icon={<Sparkles size={16} />}>
            <PhotoCheck />
          </Panel>
        </div>
      </div>

      <div ref={reveal.ref} className="mt-4 grid scroll-mt-4 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title={
            <span className="flex items-center gap-2">
              SPC-Regelkarte · {spcId} {m && <StatusPill status={m.status} />}
            </span>
          }
          subtitle={spc ? `${spc.spcSpec.label} (${spc.spcSpec.unit}) · ${m ? PRODUCT[m.product.id].name : ""} · Stichprobe n=5 alle 5 Minuten` : "…"}
          icon={<ChartColumn size={16} />}
          actions={
            <div className="flex flex-wrap gap-1">
              {(snap?.machines ?? []).map((x) => (
                <button key={x.id} onClick={() => router.replace(`/qualitaet?m=${x.id}`, { scroll: false })} className={cn("num rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold", x.id === spcId ? "bg-ink text-bg" : x.spcViolation ? "bg-warn-soft text-warn" : "text-muted hover:bg-panel-3")}>
                  {x.id}
                </button>
              ))}
            </div>
          }
        >
          {spc ? <SpcChart points={spc.spc} spec={spc.spcSpec} /> : <div className="skeleton h-[240px]" />}
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg bg-panel-2 px-3 py-2">
              <div className="label text-[9px]">Prozessfähigkeit Cpk</div>
              <div className={cn("num text-[16px] font-semibold", m && m.cpk < 1.33 ? (m.cpk < 1 ? "text-crit" : "text-warn") : "text-ok")}>{m ? fmtNum(m.cpk, 2) : "–"}</div>
              <div className="text-[10.5px] text-muted">Ziel ≥ 1,33 [QS-SPC-002]</div>
            </div>
            <div className="rounded-lg bg-panel-2 px-3 py-2">
              <div className="label text-[9px]">Regelstatus</div>
              <div className={cn("text-[13px] font-semibold", m?.spcViolation ? "text-warn" : "text-ok")}>{m?.spcViolation ? `Regel ${m.spcViolation} verletzt` : "Prozess beherrscht"}</div>
              <div className="text-[10.5px] text-muted">R1 ±3σ · R2 9 einseitig · R3 Trend · EWMA Drift</div>
            </div>
            <div className="rounded-lg bg-panel-2 px-3 py-2">
              <div className="label text-[9px]">Ausschuss {spcId}</div>
              <div className="num text-[16px] font-semibold">{m ? fmtPct(m.scrapRate, 2) : "–"}</div>
              <div className="text-[10.5px] text-muted">{m ? `${fmtInt(m.scrapToday)} Stk heute` : ""}</div>
            </div>
          </div>
          {m?.spcViolation && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn-soft/50 p-3">
              <TriangleAlert size={18} className="text-warn" />
              <div className="min-w-0 flex-1 text-[12px] leading-snug text-ink-2">
                <b>KI-Frühwarnung:</b> Das Merkmal driftet systematisch. Häufigste Ursache bei Etikettenversatz: Vakuumverlust am IML-Greifer [QS-IML-007]. Empfehlung: Los seit Driftbeginn sperren, Greifer prüfen, 100-%-Nachsortierung.
              </div>
              <Button
                size="sm"
                variant="primary"
                disabled={busy || blocks.some((t) => t.status === "ENTWURF")}
                onClick={async () => {
                  setBusy(true);
                  await ticketAction("qs-block", { machineId: spcId });
                  await refreshSnapshot();
                  setBusy(false);
                }}
              >
                <Lock size={13} /> Los sperren & prüfen
              </Button>
            </div>
          )}
          {blocks.map((t) => (
            <div key={t.id} className="mt-3">
              <TicketView ticket={t} />
            </div>
          ))}
        </Panel>

        <Panel title="Qualität je Maschine" subtitle="Ausschuss, Cpk und SPC-Status" icon={<ScanEye size={16} />} bodyClassName="px-2 pb-2">
          {(snap?.machines ?? []).map((x) => (
            <button
              key={x.id}
              onClick={() => {
                router.replace(`/qualitaet?m=${x.id}`, { scroll: false });
                setQPick(x.id);
                reveal.bump();
              }}
              className={cn("grid w-full grid-cols-[50px_minmax(0,1fr)_56px_52px] items-center gap-2 rounded-lg px-2 py-1.5 text-left", x.id === spcId ? "bg-accent-soft" : "hover:bg-panel-2")}>
              <span className="num text-[12px] font-semibold">{x.id}</span>
              <span className="truncate text-[11.5px] text-muted">{x.product.short}</span>
              <span className={cn("num text-right text-[11.5px]", x.scrapRate > 0.02 ? "font-semibold text-crit" : "text-ink-2")}>{fmtPct(x.scrapRate, 2)}</span>
              {x.spcViolation ? <Badge sev="warn">{x.spcViolation}</Badge> : <span className={cn("num text-right text-[11px]", x.cpk < 1.33 ? "text-warn" : "text-muted")}>{fmtNum(x.cpk, 2)}</span>}
            </button>
          ))}
        </Panel>
      </div>
    </div>
  );
}

export default function QualitaetPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-2xl" />}>
      <Inner />
    </Suspense>
  );
}
