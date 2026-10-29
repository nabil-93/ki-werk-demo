import { getPlant } from "@/lib/sim/engine";
import { financeView } from "@/lib/sim/reports";

export const dynamic = "force-dynamic";

/** Umsatz, Deckungsbeitrag, Ergebnis je Tag, Kunde und Produkt: ?days=7|30 */
export async function GET(request: Request) {
  const d = Number(new URL(request.url).searchParams.get("days"));
  const days = d === 7 || d === 1 ? d : 30;
  return Response.json(financeView(getPlant(), days), { headers: { "Cache-Control": "no-store" } });
}
