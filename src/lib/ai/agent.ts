// LLM-Agent mit Claude: manueller Streaming-Loop mit Werkzeugaufrufen.
// Fällt bei fehlendem Schlüssel oder Verbindungsproblemen automatisch auf den Offline-Agenten zurück.

import Anthropic from "@anthropic-ai/sdk";
import type { Plant } from "../sim/engine";
import { shiftOf } from "../sim/time";
import type { AgentEvent, ChatTurn } from "./events";
import { fmtDateTime } from "./format";
import { runOffline } from "./offline";
import { SYSTEM_PROMPT, TOOLS, TOOL_META, runTool } from "./tools";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORT = (process.env.CORTEX_EFFORT as Effort) || "medium";
const MAX_ITER = 8;

export function hasCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic({ timeout: 120_000, maxRetries: 1 });
  return client;
}

export async function* runAgent(plant: Plant, history: ChatTurn[], question: string, forceOffline = false, voice = false): AsyncGenerator<AgentEvent> {
  if (forceOffline || !hasCredentials()) {
    yield* runOffline(plant, question, history, voice);
    return;
  }

  yield { type: "status", mode: "claude", model: MODEL };
  const shift = shiftOf(plant.now);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.slice(-12).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: question },
    {
      role: "system",
      content: `Kontext: Aktuelle Werkszeit ${fmtDateTime(plant.now)} (${shift.name}). Die Werksdaten laufen live; rufe Werkzeuge auf, statt Werte zu schätzen.${voice ? " SPRACHMODUS (KI-Telefon): Antworte in 2–4 kurzen, gesprochenen Sätzen ohne Markdown, Listen oder Tabellen. Zahlen gerundet, Maschinen als „SG 4“. Zuerst die Antwort, dann der wichtigste Grund, dann die Empfehlung; biete an, Details zu nennen oder einen Entwurf anzulegen." : ""}`,
    },
  ];
  let usage = { input: 0, output: 0, cacheRead: 0 };
  let produced = false;

  try {
    for (let iter = 0; iter < MAX_ITER; iter++) {
      const stream = getClient().beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: EFFORT },
        messages,
      });

      for await (const ev of stream) {
        if (ev.type === "content_block_delta") {
          if (ev.delta.type === "text_delta") {
            produced = true;
            yield { type: "text", delta: ev.delta.text };
          } else if (ev.delta.type === "thinking_delta" && ev.delta.thinking) {
            yield { type: "thinking", text: ev.delta.thinking };
          }
        }
      }

      const msg = await stream.finalMessage();
      usage.input += msg.usage.input_tokens;
      usage.output += msg.usage.output_tokens;
      usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0;

      if (msg.stop_reason === "refusal") {
        yield { type: "text", delta: "\n\nDiese Anfrage kann ich leider nicht beantworten." };
        break;
      }
      if (msg.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      const toolUses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) break;
      if (msg.stop_reason === "max_tokens") {
        yield { type: "text", delta: "\n\n(Antwort wurde gekürzt.)" };
        break;
      }

      messages.push({ role: "assistant", content: msg.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const meta = TOOL_META[tu.name] ?? { label: tu.name, system: "" };
        const input = tu.input && typeof tu.input === "object" ? (tu.input as Record<string, unknown>) : {};
        yield { type: "tool_start", id: tu.id, name: tu.name, label: meta.label, system: meta.system, input };
        const t0 = Date.now();
        try {
          const out = runTool(plant, tu.name, input);
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out.data) });
          yield { type: "tool_end", id: tu.id, name: tu.name, ok: true, summary: out.summary, card: out.card, ms: Date.now() - t0 };
        } catch (e) {
          const message = (e as Error).message;
          results.push({ type: "tool_result", tool_use_id: tu.id, content: message, is_error: true });
          yield { type: "tool_end", id: tu.id, name: tu.name, ok: false, summary: message, ms: Date.now() - t0 };
        }
      }
      messages.push({ role: "user", content: results });
    }
    yield { type: "done", usage };
  } catch (err) {
    let reason = "Claude nicht erreichbar";
    if (err instanceof Anthropic.AuthenticationError) reason = "API-Schlüssel ungültig";
    else if (err instanceof Anthropic.RateLimitError) reason = "Rate-Limit erreicht";
    else if (err instanceof Anthropic.APIConnectionError) reason = "Keine Verbindung zur Claude-API";
    else if (err instanceof Anthropic.APIError) reason = `API-Fehler ${err.status ?? ""}`.trim();
    if (produced) {
      yield { type: "error", message: `${reason} – Antwort unvollständig.` };
      return;
    }
    yield { type: "status", mode: "offline", note: `${reason} – automatisch auf Offline-Modus gewechselt` };
    yield* runOffline(plant, question, history, voice);
  }
}
