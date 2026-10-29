import { getPlant } from "@/lib/sim/engine";
import { FEATURES } from "@/lib/sim/ml";

export const dynamic = "force-dynamic";

export async function GET() {
  const plant = getPlant();
  return Response.json({ card: plant.model.card, features: FEATURES });
}
