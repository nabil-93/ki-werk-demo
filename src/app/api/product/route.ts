import { getPlant } from "@/lib/sim/engine";
import { productDetail } from "@/lib/sim/reports";

export const dynamic = "force-dynamic";

/** Artikel-Detail: Bestand, Chargen (wann, wo, welche Maschine), Gut-/Schlechtteile, Aufträge: ?id=P-IML500 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const d = productDetail(getPlant(), id);
  if (!d) return Response.json({ error: `Artikel ${id} nicht gefunden` }, { status: 404 });
  return Response.json(d, { headers: { "Cache-Control": "no-store" } });
}
