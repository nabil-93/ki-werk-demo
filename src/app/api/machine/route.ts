import { maintenanceOptions } from "@/lib/sim/analysis";
import { getPlant } from "@/lib/sim/engine";
import { analyzeMachine } from "@/lib/sim/guardian";
import { machineDayDetail } from "@/lib/sim/reports";
import { machineDetail } from "@/lib/sim/views";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const id = sp.get("id") ?? "";
  const plant = getPlant();
  const detail = machineDetail(plant, id);
  if (!detail) return Response.json({ error: `Maschine ${id} nicht gefunden` }, { status: 404 });
  const m = plant.findMachine(id)!;
  const pred = plant.predictions.get(m.id);
  const contributions = pred ? plant.model.contributions(pred.features as Parameters<typeof plant.model.contributions>[0]) : [];
  const offset = sp.get("day") === "-1" ? -1 : 0;
  return Response.json({ ...detail, maintenance: maintenanceOptions(plant, m), contributions, now: plant.now, day: machineDayDetail(plant, m.id, offset), guard: analyzeMachine(plant, m) }, { headers: { "Cache-Control": "no-store" } });
}
