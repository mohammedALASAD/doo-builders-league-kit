import type Anthropic from "@anthropic-ai/sdk";
import type { ToolContext, ToolDefinition, ToolResult } from "../types.js";

/**
 * Central place tools get registered and executed. Adding a new tool should
 * take under 5 minutes: write a ToolDefinition, call registry.register(it).
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Anthropic-shaped tool specs for the messages.create({ tools }) call. */
  toAnthropicTools(): Anthropic.Tool[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  async execute(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, output: null, error: `Unknown tool: ${name}` };
    }
    try {
      return await tool.run(input, ctx);
    } catch (err) {
      return { ok: false, output: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
