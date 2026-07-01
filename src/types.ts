export interface ToolDefinition<Input = any> {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Marks a tool as having real-world side effects (payments, messages, DB writes...).
   * Risky tools are the ones guardrails/approval gates and dry-run mode care about. */
  risky?: boolean;
  run: (input: Input, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  dryRun: boolean;
}

export interface ToolResult {
  ok: boolean;
  output: unknown;
  error?: string;
}

export interface AuditEntry {
  step: number;
  timestamp: string;
  tool: string;
  input: unknown;
  result: ToolResult;
  approved: boolean;
  dryRun: boolean;
}

/** Emitted when a step's tool outcomes diverge from what the plan assumed —
 * see ReflectionTrigger in agent/loop.ts. */
export interface ReflectionEvent {
  step: number;
  timestamp: string;
  reason: string;
}

export interface MemoryFact {
  key: string;
  value: unknown;
  confidence: number; // 0..1 — how sure the agent is this fact is still true
  source: string; // where it came from: a tool name, "user", "inference"
  updatedAt: string;
}
