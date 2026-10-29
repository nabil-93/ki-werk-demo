// Was-wäre-wenn: digitaler Zwilling rechnet 72 h ohne und mit Maßnahme durch (Kopie des Werks, Live-Zustand bleibt unberührt)
import { getPlant } from "@/lib/sim/engine";
import { whatIf } from "@/lib/sim/whatif";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { machineId?: string; findingId?: string; actionId?: string };
  if (!body.machineId) return Response.json({ error: "Maschine fehlt" }, { status: 400 });
  const r = whatIf(getPlant(), body.machineId, body.findingId, body.actionId);
  if (!r) return Response.json({ error: `Maschine ${body.machineId} nicht angebunden` }, { status: 404 });
  return Response.json(r, { headers: { "Cache-Control": "no-store" } });
}
