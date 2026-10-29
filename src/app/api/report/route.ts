import { getPlant } from "@/lib/sim/engine";
import { buildReport, type ReportRange } from "@/lib/sim/reports";

export const dynamic = "force-dynamic";

/** Bericht: ?range=tag|woche|monat&offset=0|-1 (Vortag) */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const r = sp.get("range");
  const range: ReportRange = r === "woche" || r === "monat" ? r : "tag";
  const offset = range === "tag" && sp.get("offset") === "-1" ? -1 : 0;
  return Response.json(buildReport(getPlant(), range, offset), { headers: { "Cache-Control": "no-store" } });
}
