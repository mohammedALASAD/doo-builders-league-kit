import { NextResponse } from "next/server";
import { LlmClient } from "../../../../src/llm/client.js";
import { ToolRegistry } from "../../../../src/tools/registry.js";
import { AgentLoop } from "../../../../src/agent/loop.js";
import { SCENARIO_REQUESTS, DEMO_REQUESTS, BUSINESS_CONTEXT, VIP_LIST } from "../../../../src/triage/data.js";
import {
  getResourceStatus,
  checkVipStatus,
  searchKnowledgeBase,
  assignAppointmentSlot,
  processRefund,
  escalateToStaff,
  escalateToManager,
  recordDecision,
  decisions,
  resetTriageState,
} from "../../../../src/triage/tools.js";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const useDemo = body?.mode === "demo";
  const REQUESTS = useDemo ? DEMO_REQUESTS : SCENARIO_REQUESTS;

  // A warm serverless instance can be reused across requests — reset the shared
  // module state every time instead of carrying over a previous run's decisions
  // or depleted appointment slots.
  resetTriageState();

  const tools = new ToolRegistry();
  tools.register(getResourceStatus);
  tools.register(checkVipStatus);
  tools.register(searchKnowledgeBase);
  tools.register(assignAppointmentSlot);
  tools.register(processRefund);
  tools.register(escalateToStaff);
  tools.register(escalateToManager);
  tools.register(recordDecision);

  const systemPrompt = `You are the triage decision engine for a small salon/service business.

Business constraints right now:
- ${BUSINESS_CONTEXT.staffAvailable} staff members available today.
- ${BUSINESS_CONTEXT.appointmentSlotsLeftToday} appointment slots left today (call get_resource_status for the live count — it changes as you book).
- Refunds above $${BUSINESS_CONTEXT.refundApprovalLimit} need manager approval — process_refund refuses them itself; escalate instead of retrying.
- VIP list: ${VIP_LIST.join(", ")}.

You'll be given a batch of customer requests. Work in two phases — do not skip ahead:

PHASE 1 — Investigate everything first.
For every request, gather what you need to judge it properly (check_vip_status, search_knowledge_base, get_resource_status, as relevant). Do this for ALL requests before moving on. Do NOT call assign_appointment_slot, process_refund, escalate_to_staff, escalate_to_manager, or record_decision during this phase.

PHASE 2 — Decide, in priority order.
Compare all requests against each other and decide the batch's priority order (1=handle first ... last, no duplicates). Then, starting from priority 1, take the right action for each request: assign_appointment_slot for a cancelled booking; process_refund for a billing issue (escalate_to_manager only after it refuses); escalate_to_staff for anything needing a human; or resolve directly for a simple question. Call record_decision for each request before moving to the next.

When all requests are recorded, give a short paragraph summarizing your overall reasoning.`;

  const agent = new AgentLoop({
    llm: new LlmClient(),
    tools,
    systemPrompt,
    maxSteps: 24,
    // Stateless HTTP endpoint — no terminal to pause a risky tool for. The tool-level
    // cap and eligibility checks (see process_refund) still enforce the real rules
    // regardless of approval; the CLI keeps the actual human-in-the-loop gate.
    approve: () => true,
  });

  const batch = REQUESTS.map(
    (r) =>
      `[${r.id}] ${r.customerName} (${r.tier}) via ${r.channel}: "${r.message}"` +
      (r.refundAmount ? ` (amount in question: $${r.refundAmount})` : ""),
  ).join("\n");

  let result = await agent.run(`Here is today's request queue:\n\n${batch}`);

  // The model sometimes pauses mid-batch to narrate a phase transition in plain text
  // ("Now let me proceed to Phase 2...") with no tool calls in that turn — AgentLoop
  // treats any text-only turn as the final answer, which would cut the run short
  // before record_decision has been called for everything. Nudge it to keep going
  // (same agent instance, so its own conversation history carries over) until the
  // decision screen is actually complete.
  let nudges = 0;
  while (decisions.length < REQUESTS.length && nudges < 4) {
    nudges++;
    result = await agent.run(
      `You still need to record a decision for every request — ${decisions.length}/${REQUESTS.length} done so far. Continue: take the right action and call record_decision for each remaining request now.`,
    );
  }

  const requestsById = Object.fromEntries(REQUESTS.map((r) => [r.id, r]));
  const sortedDecisions = [...decisions]
    .sort((a, b) => a.priority - b.priority)
    .map((d) => ({ ...d, customerName: requestsById[d.requestId]?.customerName ?? d.requestId }));

  return NextResponse.json({
    reply: result.reply,
    decisions: sortedDecisions,
    audit: result.audit.map((a) => ({
      tool: a.tool,
      input: a.input,
      ok: a.result.ok,
      output: a.result.output,
      error: a.result.error,
    })),
  });
}
