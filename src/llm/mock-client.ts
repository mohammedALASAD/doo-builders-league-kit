import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClientLike } from "./client.js";

/**
 * Canned-response stand-in for LlmClient — no API key, no network call, no cost.
 * Keyword-matches the user's message to drive the same tool-call loop (approval
 * gate, dry-run, audit log) that the real LLM would, so the kit's mechanics can
 * be built and tested before spending real API credits.
 */
export class MockLlmClient implements LlmClientLike {
  async createMessage(params: {
    system?: string;
    messages: Anthropic.MessageParam[];
    tools?: Anthropic.Tool[];
    maxTokens?: number;
  }): Promise<Anthropic.Message> {
    const last = params.messages[params.messages.length - 1];
    const respondingToToolResult =
      !!last && Array.isArray(last.content) && last.content.some((b: any) => b?.type === "tool_result");

    const content = respondingToToolResult
      ? [textBlock("[mock] Tool ran — see the audit log below. (No real LLM was called; drop --mock with a funded ANTHROPIC_API_KEY for real reasoning.)")]
      : this.planFrom(latestUserText(params.messages));

    return {
      id: `msg_mock_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: "mock",
      content,
      stop_reason: content.some((b: any) => b.type === "tool_use") ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as Anthropic.Message;
  }

  private planFrom(text: string): any[] {
    if (/\btime\b/i.test(text)) {
      return [toolUseBlock("get_current_time", {})];
    }
    if (/whatsapp/i.test(text)) {
      const to = text.match(/(\+?\d[\d\s-]{6,}\d)/)?.[1]?.trim() ?? "+97300000000";
      const body = text.match(/(?:saying|that says)\s+(.+)$/i)?.[1]?.trim() ?? text;
      return [toolUseBlock("send_whatsapp_message", { to, body })];
    }
    return [
      textBlock(
        `[mock] No real LLM connected — canned reply to: "${text}". Set ANTHROPIC_API_KEY and drop --mock for real reasoning.`,
      ),
    ];
  }
}

function latestUserText(messages: Anthropic.MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

function textBlock(text: string) {
  return { type: "text", text };
}

function toolUseBlock(name: string, input: unknown) {
  return { type: "tool_use", id: `toolu_mock_${Date.now()}`, name, input };
}
