import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClientLike } from "../llm/client.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AuditEntry, ReflectionEvent, ToolDefinition, ToolResult } from "../types.js";

export type ApprovalFn = (tool: ToolDefinition, input: unknown) => boolean | Promise<boolean>;

/** Default guardrail: anything not marked risky is auto-approved; risky tools are blocked
 * unless the caller supplies its own ApprovalFn (e.g. a CLI prompt or a policy check). */
const autoApproveNonRisky: ApprovalFn = (tool) => !tool.risky;

export interface ToolOutcome {
  tool: string;
  input: unknown;
  result: ToolResult;
}

/** Inspects a step's tool outcomes and returns a reason string if reality
 * diverged from what the plan assumed, or null if nothing looks off. Swap
 * this out for domain-specific checks (e.g. "inventory count went negative"). */
export type ReflectionTrigger = (outcomes: ToolOutcome[]) => string | null;

/** Default trigger: flag the step whenever a tool call failed — the clearest
 * signal available that the plan needs to change, not just be retried. */
export const defaultReflectionTrigger: ReflectionTrigger = (outcomes) => {
  const failed = outcomes.filter((o) => !o.result.ok);
  if (failed.length === 0) return null;
  const detail = failed.map((f) => `${f.tool} (${f.result.error ?? "unknown error"})`).join(", ");
  return `${failed.length} tool call(s) failed: ${detail}`;
};

export interface AgentLoopOptions {
  llm: LlmClientLike;
  tools: ToolRegistry;
  systemPrompt?: string;
  maxSteps?: number;
  dryRun?: boolean;
  approve?: ApprovalFn;
  /** Reflection / re-planning: detects when a step's results diverged from
   * the plan and, if so, nudges the model to reassess before continuing
   * instead of blindly repeating the same action. Defaults to flagging any
   * tool failure; pass your own to react to domain-specific "reality changed"
   * signals. */
  reflect?: ReflectionTrigger;
}

export interface AgentRunResult {
  reply: string;
  steps: number;
  audit: AuditEntry[];
  reflections: ReflectionEvent[];
}

/**
 * The plan -> act -> observe -> repeat loop. Every tool call is approval-gated
 * and recorded to an in-memory audit log before/after execution, so callers
 * can render or export the audit trail regardless of how the run ends.
 * After each step's tool calls, a ReflectionTrigger checks whether reality
 * diverged from the plan (default: any tool failure) and, if so, injects a
 * re-planning nudge before the loop continues.
 */
export class AgentLoop {
  private llm: LlmClientLike;
  private tools: ToolRegistry;
  private systemPrompt?: string;
  private maxSteps: number;
  private dryRun: boolean;
  private approve: ApprovalFn;
  private reflect: ReflectionTrigger;
  private messages: Anthropic.MessageParam[] = [];
  readonly audit: AuditEntry[] = [];
  readonly reflections: ReflectionEvent[] = [];

  constructor(opts: AgentLoopOptions) {
    this.llm = opts.llm;
    this.tools = opts.tools;
    this.systemPrompt = opts.systemPrompt;
    this.maxSteps = opts.maxSteps ?? 10;
    this.dryRun = opts.dryRun ?? false;
    this.approve = opts.approve ?? autoApproveNonRisky;
    this.reflect = opts.reflect ?? defaultReflectionTrigger;
  }

  async run(userInput: string): Promise<AgentRunResult> {
    this.messages.push({ role: "user", content: userInput });
    const auditStart = this.audit.length;
    const reflectionStart = this.reflections.length;

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
        return {
          reply: text,
          steps: step,
          audit: this.audit.slice(auditStart),
          reflections: this.reflections.slice(reflectionStart),
        };
      }

      const toolResults: Anthropic.ContentBlockParam[] = [];
      const outcomes: ToolOutcome[] = [];
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
        outcomes.push({ tool: use.name, input: use.input, result });

        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(result.ok ? result.output : { error: result.error }),
          is_error: !result.ok,
        });
      }

      const reason = this.reflect(outcomes);
      if (reason) {
        this.reflections.push({ step, timestamp: new Date().toISOString(), reason });
        toolResults.push({
          type: "text",
          text: `[reflection] ${reason}. This diverges from the plan — don't just retry the same action. Reassess: consider why it happened, try an alternative approach, or ask the user for clarification.`,
        });
      }

      this.messages.push({ role: "user", content: toolResults });
    }

    return {
      reply: `Stopped after hitting the ${this.maxSteps}-step guard without a final answer.`,
      steps: this.maxSteps,
      audit: this.audit.slice(auditStart),
      reflections: this.reflections.slice(reflectionStart),
    };
  }
}
