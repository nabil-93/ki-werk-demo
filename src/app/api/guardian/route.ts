// KI-Wächter: laufende Analyse aller angebundenen Maschinen (Befunde, Ursachen, drohender Verlust, Maßnahmen)
import { getPlant } from "@/lib/sim/engine";
import { analyzeMachine, guardianView } from "@/lib/sim/guardian";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  const plant = getPlant();
  if (id) {
    const m = plant.findMachine(id);
    if (!m) return Response.json({ error: `Maschine ${id} nicht angebunden` }, { status: 404 });
    return Response.json(analyzeMachine(plant, m), { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(guardianView(plant), { headers: { "Cache-Control": "no-store" } });
}
