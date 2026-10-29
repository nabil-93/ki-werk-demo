import { getPlant } from "@/lib/sim/engine";
import { buildBriefing } from "@/lib/sim/reports";

export const dynamic = "force-dynamic";

/** Lagebericht: Was passiert gerade im Werk, was hat sich verändert, was kommt als Nächstes */
export async function GET() {
  return Response.json(buildBriefing(getPlant()), { headers: { "Cache-Control": "no-store" } });
}
