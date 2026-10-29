// KI-Copilot: Server-Sent Events mit Text, Gedankengang und Werkzeugaufrufen
import { runAgent } from "@/lib/ai/agent";
import type { ChatTurn } from "@/lib/ai/events";
import { getPlant } from "@/lib/sim/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { question?: string; history?: ChatTurn[]; offline?: boolean; voice?: boolean };
  const question = (body.question ?? "").toString().slice(0, 4000).trim();
  if (!question) return Response.json({ error: "Frage fehlt" }, { status: 400 });
  const history = Array.isArray(body.history)
    ? body.history.filter((h) => (h.role === "user" || h.role === "assistant") && typeof h.content === "string" && h.content.trim()).slice(-12)
    : [];
  const plant = getPlant();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      try {
        for await (const ev of runAgent(plant, history, question, Boolean(body.offline), Boolean(body.voice))) send(ev);
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}

export async function GET() {
  const { hasCredentials, MODEL } = await import("@/lib/ai/agent");
  return Response.json({ online: hasCredentials(), model: MODEL });
}
