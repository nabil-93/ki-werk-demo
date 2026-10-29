import { getPlant } from "@/lib/sim/engine";
import { buildSnapshot } from "@/lib/sim/views";

export const dynamic = "force-dynamic";

export async function GET() {
  const plant = getPlant();
  return Response.json(buildSnapshot(plant), { headers: { "Cache-Control": "no-store" } });
}
