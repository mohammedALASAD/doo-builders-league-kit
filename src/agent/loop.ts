import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient } from "../llm/client.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AuditEntry, ToolDefinition } from "../types.js";

export type ApprovalFn = (tool: ToolDefinition, input: unknown) => boolean | Promise<boolean>;

/** Default guardrail: anything not marked risky is auto-approved; risky tools are blocked
 * unless the caller supplies its own ApprovalFn (e.g. a CLI prompt or a policy check). */
const autoApproveNonRisky: ApprovalFn = (tool) => !tool.risky;

export interface AgentLoopOptions {
  llm: LlmClient;
  tools: ToolRegistry;
  systemPrompt?: string;
  maxSteps?: number;
  dryRun?: boolean;
  approve?: ApprovalFn;
}

export interface AgentRunResult {
  reply: string;
  steps: number;
  audit: AuditEntry[];
}

/**
 * The plan -> act -> observe -> repeat loop. Every tool call is approval-gated
 * and recorded to an in-memory audit log before/after execution, so callers
 * can render or export the audit trail regardless of how the run ends.
 */
export class AgentLoop {
  private llm: LlmClient;
  private tools: ToolRegistry;
  private systemPrompt?: string;
  private maxSteps: number;
  private dryRun: boolean;
  private approve: ApprovalFn;
  private messages: Anthropic.MessageParam[] = [];
  readonly audit: AuditEntry[] = [];

  constructor(opts: AgentLoopOptions) {
    this.llm = opts.llm;
    this.tools = opts.tools;
    this.systemPrompt = opts.systemPrompt;
    this.maxSteps = opts.maxSteps ?? 10;
    this.dryRun = opts.dryRun ?? false;
    this.approve = opts.approve ?? autoApproveNonRisky;
  }

  async run(userInput: string): Promise<AgentRunResult> {
    this.messages.push({ role: "user", content: userInput });

    for (let step = 1; step <= this.maxSteps; step++) {
      const response = await this.llm.createMessage({
        system: this.systemPrompt,
        messages: this.messages,
        tools: this.tools.toAnthropicTools(),
      });

      this.messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length === 0) {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        return { reply: text, steps: step, audit: this.audit };
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const tool = this.tools.get(use.name);
        const approved = tool ? await this.approve(tool, use.input) : false;

        const result = approved
          ? await this.tools.execute(use.name, use.input, { dryRun: this.dryRun })
          : { ok: false, output: null, error: "Blocked: not approved by guardrail" };

        this.audit.push({
          step,
          timestamp: new Date().toISOString(),
          tool: use.name,
          input: use.input,
          result,
          approved,
          dryRun: this.dryRun,
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(result.ok ? result.output : { error: result.error }),
          is_error: !result.ok,
        });
      }

      this.messages.push({ role: "user", content: toolResults });
    }

    return {
      reply: `Stopped after hitting the ${this.maxSteps}-step guard without a final answer.`,
      steps: this.maxSteps,
      audit: this.audit,
    };
  }
}
