// Demo-Regie: Echtzeit/Zeitraffer, Pause, Szenarien, Reset
import { getPlant, resetPlant, SCENARIO_SPEED } from "@/lib/sim/engine";
import { startShowcase } from "@/lib/sim/showcase";
import type { ScenarioId } from "@/lib/sim/types";

export const dynamic = "force-dynamic";

const SCENARIOS: ScenarioId[] = ["lager", "etikett", "eilauftrag", "granulat"];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { action?: string; speed?: number; scenario?: string; paused?: boolean; machine?: string };
  let plant = getPlant();
  switch (body.action) {
    case "speed":
      if (typeof body.speed === "number") plant.setSpeed(body.speed);
      break;
    case "realtime":
      plant.realtime();
      break;
    case "pause":
      plant.setPaused(Boolean(body.paused));
      break;
    case "scenario-start":
      if (SCENARIOS.includes(body.scenario as ScenarioId)) {
        // In Echtzeit würde ein Lagerschaden Stunden dauern – für die Demo automatisch in den Zeitraffer
        if (plant.speed === 1) plant.setSpeed(SCENARIO_SPEED);
        plant.startScenario(body.scenario as ScenarioId);
      }
      break;
    case "scenario-stop":
      if (SCENARIOS.includes(body.scenario as ScenarioId)) plant.stopScenario(body.scenario as ScenarioId);
      break;
    case "jump": {
      // Zeit vorspulen (z. B. 30 Sim-Minuten), um Effekte schneller zu zeigen
      const minutes = Math.min(240, Math.max(5, Number(body.speed) || 30));
      const step = Math.max(plant.speed, 30);
      const steps = Math.ceil((minutes * 60) / step);
      for (let i = 0; i < steps; i++) plant.tick(step);
      break;
    }
    case "reset":
      plant = resetPlant();
      break;
    // Live-Demo „Alle Fälle“: Play startet bzw. setzt fort, Pause friert das Werk ein, Stop führt zurück in den Normalbetrieb
    case "showcase-play":
      if (!plant.showcase.active) startShowcase(plant);
      else plant.realtime();
      break;
    case "showcase-pause":
      plant.setPaused(true);
      break;
    case "showcase-stop":
      plant = resetPlant();
      break;
    case "connect":
      // Rollout Phase 2: eine bisher nicht angebundene Maschine live schalten
      if (!body.machine || !plant.connectMachine(body.machine)) return Response.json({ error: "Unbekannte Maschine" }, { status: 400 });
      break;
    case "disconnect":
      // … und die Anbindung wieder trennen (nur bei im Rollout angebundenen Maschinen)
      if (!body.machine || !plant.disconnectMachine(body.machine)) return Response.json({ error: "Maschine ist keine angebundene Rollout-Maschine" }, { status: 400 });
      break;
    default:
      return Response.json({ error: "Unbekannte Aktion" }, { status: 400 });
  }
  return Response.json({ ok: true, speed: plant.speed, paused: plant.paused, now: plant.now, realtime: plant.isRealtime() });
}
