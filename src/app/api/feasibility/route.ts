import { alternativeMachines, checkFeasibility, orderView } from "@/lib/sim/analysis";
import { PRODUCT } from "@/lib/sim/catalog";
import { getPlant } from "@/lib/sim/engine";
import { atDayHour } from "@/lib/sim/time";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { inquiryId?: string; productId?: string; qty?: number; days?: number; customerId?: string; orderId?: string };
  const plant = getPlant();
  if (body.orderId) {
    const o = plant.order(body.orderId);
    if (!o) return Response.json({ error: "Auftrag nicht gefunden" }, { status: 404 });
    return Response.json({ order: orderView(plant, o), alternatives: alternativeMachines(plant, o) });
  }
  if (body.inquiryId) {
    const inq = plant.inquiries.find((i) => i.id === body.inquiryId);
    if (!inq) return Response.json({ error: "Anfrage nicht gefunden" }, { status: 404 });
    return Response.json({ result: { ...checkFeasibility(plant, inq.productId, inq.qty, inq.due, inq.customerId), inquiryId: inq.id } });
  }
  if (!body.productId || !PRODUCT[body.productId] || !body.qty || body.qty <= 0) return Response.json({ error: "Produkt und Menge erforderlich" }, { status: 400 });
  const due = atDayHour(plant.now, Math.max(1, Math.min(21, body.days ?? 5)), 8);
  return Response.json({ result: checkFeasibility(plant, body.productId, Math.round(body.qty), due, body.customerId) });
}
