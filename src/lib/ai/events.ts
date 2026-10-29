import type { ToolCard } from "./tools";

export type AgentEvent =
  | { type: "status"; mode: "claude" | "offline"; model?: string; note?: string }
  | { type: "thinking"; text: string }
  | { type: "text"; delta: string }
  /** gesprochene Kurzfassung für das KI-Telefon */
  | { type: "speech"; text: string }
  | { type: "tool_start"; id: string; name: string; label: string; system: string; input: Record<string, unknown> }
  | { type: "tool_end"; id: string; name: string; ok: boolean; summary: string; card?: ToolCard; ms: number }
  | { type: "done"; usage?: { input: number; output: number; cacheRead?: number } }
  | { type: "error"; message: string };

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
