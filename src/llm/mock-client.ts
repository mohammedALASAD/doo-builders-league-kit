
import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClientLike } from "./client.js";

/**
 * Canned-response stand-in for LlmClient — no API key, no network call, no cost.
 * Keyword-matches the user's message to drive the same tool-call loop (approval
 * gate, dry-run, audit log) that the real LLM would, so the kit's mechanics can
 * be built and tested before spending real API credits.
 */
export class MockLlmClient implements LlmClientLike {
  /** Cheap state so the mock can chain a multi-turn flow (lookup -> otp -> retention ->
   * cancel) without real reasoning — just enough to smoke-test tool wiring for free. */
  private lastSubscriptionId: string | null = null;
  private lastReason: string | null = null;

  async createMessage(params: {
    system?: string;
    messages: Anthropic.MessageParam[];
    tools?: Anthropic.Tool[];
    maxTokens?: number;
  }): Promise<Anthropic.Message> {
    const last = params.messages[params.messages.length - 1];
    const lastBlocks = Array.isArray(last?.content) ? (last!.content as any[]) : [];
    const respondingToToolResult = lastBlocks.some((b) => b?.type === "tool_result");
    const sawFailure = lastBlocks.some((b) => b?.type === "tool_result" && b.is_error);

    const content = respondingToToolResult
      ? [
          textBlock(
            sawFailure
              ? "[mock] Noticed that failed — that's the reflection/re-planning pattern reacting. A real LLM would revise its plan here (e.g. double-check the ID with the user, or try a different lookup) instead of repeating the same call."
              : "[mock] Tool ran — see the audit log below. (No real LLM was called; drop --mock with a funded ANTHROPIC_API_KEY for real reasoning.)",
          ),
        ]
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
    if (/order/i.test(text)) {
      const orderId = text.match(/order\s*(?:id\s*)?[:#]?\s*([\w-]+)/i)?.[1] ?? "ORD-1234";
      return [toolUseBlock("lookup_order", { orderId })];
    }
    const remember = text.match(/remember (?:that )?([\w-]+) is (.+)$/i);
    if (remember) {
      return [toolUseBlock("remember_fact", { key: remember[1], value: remember[2].trim(), confidence: 0.9 })];
    }
    const recall = text.match(/(?:recall|what do you know about)\s+([\w-]+)\??$/i);
    if (recall) {
      return [toolUseBlock("recall_fact", { key: recall[1] })];
    }

    // --- subscription cancellation flow ---
    const reasonMatch = text.match(/(?:because|reason(?:\s+is)?:?)\s+(.+)$/i);
    if (reasonMatch) this.lastReason = reasonMatch[1].trim();

    const otpCode = text.match(/\b(\d{6})\b/)?.[1];
    if (otpCode) {
      return [toolUseBlock("verify_otp", { subscriptionId: this.lastSubscriptionId ?? "SUB-1001", code: otpCode })];
    }
    if (/cancel/i.test(text) && /\b(confirm|proceed|still want|go ahead|yes)\b/i.test(text)) {
      return [
        toolUseBlock("cancel_subscription", {
          subscriptionId: this.lastSubscriptionId ?? "SUB-1001",
          reason: this.lastReason ?? undefined,
        }),
      ];
    }
    if (/retention|discount|free month|stay with us/i.test(text)) {
      const freeMonth = /free month/i.test(text);
      return [
        toolUseBlock("offer_retention_deal", {
          subscriptionId: this.lastSubscriptionId ?? "SUB-1001",
          type: freeMonth ? "free_month" : "discount",
          percentOff: freeMonth ? undefined : 15,
        }),
      ];
    }
    if (/eligib|can i cancel|qualify/i.test(text)) {
      return [toolUseBlock("check_cancellation_eligibility", { subscriptionId: this.lastSubscriptionId ?? "SUB-1001" })];
    }
    if (/\b(otp|one[- ]time code|verify my identity|send.*code)\b/i.test(text)) {
      return [toolUseBlock("send_otp", { subscriptionId: this.lastSubscriptionId ?? "SUB-1001" })];
    }
    if (/cancel/i.test(text) && /(subscription|service|plan)/i.test(text)) {
      const subId = text.match(/SUB-\d+/i)?.[0]?.toUpperCase();
      const phone = text.match(/(\+?\d[\d\s-]{6,}\d)/)?.[1]?.trim();
      const id = subId ?? this.lastSubscriptionId ?? "SUB-1001";
      this.lastSubscriptionId = id;
      return [toolUseBlock("lookup_subscription", { customerIdOrPhone: phone ?? id })];
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
