import { getPlant } from "@/lib/sim/engine";
import { DAY } from "@/lib/sim/ops";
import { schedule, visitView, yardSummary } from "@/lib/sim/reports";

export const dynamic = "force-dynamic";

/** LKW-Zeitfenster: ?range=heute|morgen|woche|monat oder ?id=ZF-… für ein einzelnes Fahrzeug */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const plant = getPlant();
  const id = sp.get("id");
  if (id) {
    const v = plant.ops.visits.find((x) => x.id === id);
    if (!v) return Response.json({ error: `Zeitfenster ${id} nicht gefunden` }, { status: 404 });
    return Response.json({ now: plant.now, visit: visitView(plant, v) }, { headers: { "Cache-Control": "no-store" } });
  }
  const range = sp.get("range") ?? "heute";
  const day = plant.ops.curDay;
  const [from, to] = range === "morgen" ? [day + DAY, day + 2 * DAY] : range === "woche" ? [day, day + 7 * DAY] : range === "monat" ? [day, day + 30 * DAY] : [day, day + DAY];
  return Response.json({ now: plant.now, range, from, to, summary: yardSummary(plant), visits: schedule(plant, from, to) }, { headers: { "Cache-Control": "no-store" } });
}
