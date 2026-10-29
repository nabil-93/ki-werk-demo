import { getPlant } from "@/lib/sim/engine";
import { productionOverview } from "@/lib/sim/reports";

export const dynamic = "force-dynamic";

/** Tagesverlauf aller Maschinen im 15-Minuten-Raster (BDE) */
export async function GET() {
  const plant = getPlant();
  return Response.json({ now: plant.now, day: plant.ops.curDay, machines: productionOverview(plant) }, { headers: { "Cache-Control": "no-store" } });
}
