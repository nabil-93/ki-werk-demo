import { getPlant } from "@/lib/sim/engine";
import { stockViews } from "@/lib/sim/reports";

export const dynamic = "force-dynamic";

/** Fertigwarenlager mit stündlichem Bestandsverlauf (7 Tage) */
export async function GET() {
  const plant = getPlant();
  return Response.json({ now: plant.now, stock: stockViews(plant, true) }, { headers: { "Cache-Control": "no-store" } });
}
