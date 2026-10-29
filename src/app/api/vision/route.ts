import { inspectImage } from "@/lib/ai/vision";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export async function POST(request: Request) {
  const { data, mediaType } = (await request.json().catch(() => ({}))) as { data?: string; mediaType?: string };
  if (!data || !TYPES.includes(mediaType as (typeof TYPES)[number])) return Response.json({ error: "Bild fehlt oder Format nicht unterstützt (PNG, JPEG, WebP)." }, { status: 400 });
  if (data.length > 7_000_000) return Response.json({ error: "Bild zu groß (max. ca. 5 MB)." }, { status: 413 });
  try {
    const result = await inspectImage(data, mediaType as (typeof TYPES)[number]);
    return Response.json({ result });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
}
