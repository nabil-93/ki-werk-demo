// Human-in-the-Loop: KI-Vorschläge freigeben/ablehnen, eigene Vorschläge anlegen
import { maintenanceOptions } from "@/lib/sim/analysis";
import { getPlant } from "@/lib/sim/engine";
import { H } from "@/lib/sim/time";
import type { MeasureEffect } from "@/lib/sim/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: "approve" | "reject" | "create-maintenance" | "create-move" | "create-measure" | "confirm-inquiry" | "qs-block";
    id?: string;
    machineId?: string;
    orderId?: string;
    targetMachineId?: string;
    startInH?: number;
    plan?: { machineId: string; qty: number }[];
    // Entwürfe aus dem KI-Wächter: Begründung, Kosten, vermiedener Verlust, Wirkung, Befund
    reason?: string;
    costEur?: number;
    savingEur?: number;
    effect?: MeasureEffect;
    source?: string;
  };
  const plant = getPlant();
  const fromGuard = body.source ? { createdBy: "KI-Wächter" as const, source: body.source } : { createdBy: "Nutzer" as const };
  switch (body.action) {
    case "approve":
    case "reject": {
      const t = plant.decideTicket(body.id ?? "", body.action === "approve");
      if (!t) return Response.json({ error: "Vorschlag nicht gefunden" }, { status: 404 });
      return Response.json({ ok: true, ticket: t });
    }
    case "create-maintenance": {
      const m = plant.findMachine(body.machineId ?? "");
      if (!m) return Response.json({ error: "Maschine unbekannt" }, { status: 404 });
      const opt = maintenanceOptions(plant, m);
      const start = typeof body.startInH === "number" ? plant.now + body.startInH * H : (opt.options.find((o) => o.recommended) ?? opt.options[0]).start;
      const t = plant.createTicket({
        kind: "wartung",
        machineId: m.id,
        start,
        durationH: opt.planned.durationH,
        reason: body.reason || "Vorausschauender Lagertausch (KI-Prognose)",
        ...fromGuard,
        costEur: body.costEur ?? opt.planned.costEur,
        savingEur: body.savingEur ?? opt.unplanned.costEur - opt.planned.costEur,
      });
      return Response.json({ ok: true, ticket: t });
    }
    case "create-move": {
      const o = plant.order(body.orderId ?? "");
      if (!o || !body.targetMachineId) return Response.json({ error: "Auftrag/Maschine fehlt" }, { status: 400 });
      const t = plant.createTicket({ kind: "umplanung", orderId: o.id, machineId: o.machineId, targetMachineId: body.targetMachineId, start: plant.now, durationH: 0, reason: body.reason || `Umplanung ${o.id} von ${o.machineId} auf ${body.targetMachineId}`, ...fromGuard, costEur: body.costEur, savingEur: body.savingEur });
      return Response.json({ ok: true, ticket: t });
    }
    case "create-measure": {
      const m = plant.findMachine(body.machineId ?? "");
      if (!m) return Response.json({ error: "Maschine unbekannt" }, { status: 404 });
      const t = plant.createTicket({ kind: "massnahme", machineId: m.id, start: plant.now + Math.max(0, body.startInH ?? 0.5) * H, durationH: 0.5, reason: body.reason || `Maßnahme an ${m.id}`, ...fromGuard, costEur: body.costEur, savingEur: body.savingEur, effect: body.effect ?? "keine" });
      return Response.json({ ok: true, ticket: t });
    }
    case "qs-block": {
      const m = plant.findMachine(body.machineId ?? "");
      if (!m) return Response.json({ error: "Maschine unbekannt" }, { status: 404 });
      const t = plant.createTicket({ kind: "qs-sperre", machineId: m.id, start: plant.now, durationH: 0.75, reason: body.reason || `Los ${m.id} seit Driftbeginn sperren, Greifer-Vakuum prüfen, 100-%-Nachsortierung per Kamera`, ...fromGuard, costEur: body.costEur, savingEur: body.savingEur });
      return Response.json({ ok: true, ticket: t });
    }
    case "confirm-inquiry": {
      plant.confirmInquiry(body.id ?? "", body.plan ?? []);
      return Response.json({ ok: true });
    }
  }
  return Response.json({ error: "Unbekannte Aktion" }, { status: 400 });
}
