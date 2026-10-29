"use client";

import { create } from "zustand";
import type { AgentEvent } from "@/lib/ai/events";
import type { ToolCard } from "@/lib/ai/tools";
import { refreshSnapshot } from "@/lib/client/store";

export interface Step {
  id: string;
  name: string;
  label: string;
  system: string;
  input: Record<string, unknown>;
  status: "running" | "ok" | "error";
  summary?: string;
  card?: ToolCard;
  ms?: number;
}

export type ChatMsg =
  | { id: string; role: "user"; text: string; via?: "telefon" }
  | {
      id: string;
      role: "assistant";
      text: string;
      /** gesprochene Kurzfassung (KI-Telefon) */
      speech?: string;
      via?: "telefon";
      thinking: string;
      steps: Step[];
      mode?: "claude" | "offline";
      model?: string;
      note?: string;
      done: boolean;
      error?: string;
      usage?: { input: number; output: number; cacheRead?: number };
      startedAt: number;
      endedAt?: number;
    };

interface ChatState {
  messages: ChatMsg[];
  busy: boolean;
  offline: boolean;
  setOffline: (v: boolean) => void;
  /** Frage senden; mit voice: true antwortet der Agent zusätzlich in gesprochener Kurzform */
  send: (q: string, opts?: { voice?: boolean }) => Promise<Extract<ChatMsg, { role: "assistant" }> | null>;
  reset: () => void;
}

let controller: AbortController | null = null;

export const useChat = create<ChatState>((set, get) => ({
  messages: [],
  busy: false,
  offline: false,
  setOffline: (offline) => set({ offline }),
  reset: () => {
    controller?.abort();
    set({ messages: [], busy: false });
  },
  send: async (question: string, opts?: { voice?: boolean }) => {
    const q = question.trim();
    if (!q || get().busy) return null;
    const via = opts?.voice ? ("telefon" as const) : undefined;
    const history = get()
      .messages.filter((m) => (m.role === "user" ? m.text : m.done && !m.error && m.text))
      .map((m) => ({ role: m.role, content: m.text }));
    const uid = `u${Date.now()}`;
    const aid = `a${Date.now()}`;
    set((s) => ({
      busy: true,
      messages: [...s.messages, { id: uid, role: "user", text: q, via }, { id: aid, role: "assistant", text: "", thinking: "", steps: [], done: false, startedAt: Date.now(), via }],
    }));
    const patch = (fn: (m: Extract<ChatMsg, { role: "assistant" }>) => Extract<ChatMsg, { role: "assistant" }>) =>
      set((s) => ({ messages: s.messages.map((m) => (m.id === aid && m.role === "assistant" ? fn(m) : m)) }));

    controller = new AbortController();
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history, offline: get().offline, voice: Boolean(opts?.voice) }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6)) as AgentEvent;
          switch (ev.type) {
            case "status":
              patch((m) => ({ ...m, mode: ev.mode, model: ev.model ?? m.model, note: ev.note ?? m.note }));
              break;
            case "thinking":
              patch((m) => ({ ...m, thinking: m.thinking + ev.text }));
              break;
            case "speech":
              patch((m) => ({ ...m, speech: ev.text }));
              break;
            case "text":
              patch((m) => ({ ...m, text: m.text + ev.delta }));
              break;
            case "tool_start":
              patch((m) => ({ ...m, steps: [...m.steps, { id: ev.id, name: ev.name, label: ev.label, system: ev.system, input: ev.input, status: "running" }] }));
              break;
            case "tool_end":
              patch((m) => ({ ...m, steps: m.steps.map((s) => (s.id === ev.id ? { ...s, status: ev.ok ? "ok" : "error", summary: ev.summary, card: ev.card, ms: ev.ms } : s)) }));
              if (ev.name.endsWith("_vorschlagen")) refreshSnapshot();
              break;
            case "done":
              patch((m) => ({ ...m, usage: ev.usage }));
              break;
            case "error":
              patch((m) => ({ ...m, error: ev.message }));
              break;
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") patch((m) => ({ ...m, error: (e as Error).message }));
    } finally {
      patch((m) => ({ ...m, done: true, endedAt: Date.now() }));
      set({ busy: false });
      controller = null;
    }
    const done = get().messages.find((m) => m.id === aid);
    return done && done.role === "assistant" ? done : null;
  },
}));
