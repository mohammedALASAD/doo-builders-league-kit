import type { ToolDefinition } from "../types.js";
import type { MemoryStore } from "../memory/store.js";

/**
 * Confidence-tagged memory tools: give the agent a way to actually use
 * MemoryStore, instead of it just sitting there loaded/saved but unused.
 * Closes over one MemoryStore instance so the CLI's single shared store
 * (persisted to memory.json) is what the agent reads and writes.
 */
export function createMemoryTools(memory: MemoryStore): ToolDefinition<any>[] {
  const rememberFact: ToolDefinition<{ key: string; value: string; confidence: number }> = {
    name: "remember_fact",
    description:
      "Store a fact about the current customer or conversation for later turns. Tag it with how confident you are it's true, from 0 (a guess) to 1 (the customer confirmed it directly).",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: 'Short identifier, e.g. "preferred_language"' },
        value: { type: "string", description: "The fact itself" },
        confidence: { type: "number", description: "0 to 1" },
      },
      required: ["key", "value", "confidence"],
    },
    async run(input) {
      memory.set(input.key, input.value, input.confidence, "agent");
      return { ok: true, output: { stored: input.key, confidence: input.confidence } };
    },
  };

  const recallFact: ToolDefinition<{ key: string }> = {
    name: "recall_fact",
    description: "Look up a previously remembered fact by its key.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
    async run(input) {
      const fact = memory.get(input.key);
      if (!fact) return { ok: false, output: null, error: `No fact stored for "${input.key}"` };
      return { ok: true, output: fact };
    },
  };

  return [rememberFact, recallFact];
}
