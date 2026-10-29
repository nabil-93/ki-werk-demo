import { translateRequirement } from "@/lib/ai/translate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const { text } = (await request.json().catch(() => ({}))) as { text?: string };
  const t = (text ?? "").toString().trim().slice(0, 3000);
  if (t.length < 8) return Response.json({ error: "Bitte das Anliegen etwas ausführlicher beschreiben." }, { status: 400 });
  const result = await translateRequirement(t);
  return Response.json(result);
}
