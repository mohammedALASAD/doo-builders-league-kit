import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { LlmClient } from "../llm/client.js";
import { ToolRegistry } from "../tools/registry.js";
import { AgentLoop } from "../agent/loop.js";
import { SCENARIO_REQUESTS, DEMO_REQUESTS, BUSINESS_CONTEXT, VIP_LIST } from "./data.js";
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
} from "./tools.js";
import { lookupCustomer, sendOtp, verifyOtp, setRequireVerification } from "./identity.js";
import type { ToolDefinition } from "../types.js";

const dryRun = process.argv.includes("--dry-run");

const rl = createInterface({ input: stdin, output: stdout });

const modeAnswer = await rl.question(
  "Choose what to run:\n  1) Scenario — the actual challenge dataset (5 requests)\n  2) Demo set — broader test coverage (6 requests)\nEnter 1 or 2: ",
);
const useDemo = modeAnswer.trim() === "2";
const ALL_REQUESTS = useDemo ? DEMO_REQUESTS : SCENARIO_REQUESTS;

let REQUESTS = ALL_REQUESTS;
if (useDemo) {
  const clientList = ALL_REQUESTS.map((r, i) => `  ${i + 1}) ${r.customerName} — ${r.category}`).join("\n");
  const pickAnswer = await rl.question(
    `\nWhich client do you want to run?\n${clientList}\n  0) All of them (full batch)\nEnter a number: `,
  );
  const pickIdx = parseInt(pickAnswer.trim(), 10);
  REQUESTS =
    Number.isInteger(pickIdx) && pickIdx >= 1 && pickIdx <= ALL_REQUESTS.length
      ? [ALL_REQUESTS[pickIdx - 1]]
      : ALL_REQUESTS;
}
console.log(`\nLoaded ${REQUESTS.length} request(s) — ${useDemo ? "demo set" : "scenario"}.\n`);

setRequireVerification(useDemo);

const tools = new ToolRegistry();
tools.register(getResourceStatus);
tools.register(checkVipStatus);
tools.register(searchKnowledgeBase);
tools.register(assignAppointmentSlot);
tools.register(processRefund);
tools.register(escalateToStaff);
tools.register(escalateToManager);
tools.register(recordDecision);
if (useDemo) {
  tools.register(lookupCustomer);
  tools.register(sendOtp);
  tools.register(verifyOtp);
}

/** Human-in-the-loop checkpoint: only process_refund is risky, so this is the only
 * tool that ever pauses for a y/n — everything else (including the auto-booking
 * workflow) runs without a human checkpoint. */
async function approveInTerminal(tool: ToolDefinition, input: unknown): Promise<boolean> {
  if (!tool.risky) return true;
  const answer = await rl.question(
    `\n[approval needed] run "${tool.name}" with ${JSON.stringify(input)}? (y/n) `,
  );
  return answer.trim().toLowerCase() === "y";
}

/** Lets the agent go back to the actual customer instead of guessing when a
 * request is ambiguous, and doubles as the channel for reading back an OTP code —
 * not risky, no side effect, it just pauses for a real reply (type it in, playing
 * the customer) which flows back into the agent's context. */
const askCustomer: ToolDefinition<{ requestId: string; question: string }> = {
  name: "ask_customer",
  description:
    "Ask the customer a clarifying question — either because their request is ambiguous, or to read back a verification code they were sent. Pauses for their real reply. Use sparingly for clarification; always use it to relay an OTP code.",
  inputSchema: {
    type: "object",
    properties: {
      requestId: { type: "string" },
      question: { type: "string" },
    },
    required: ["requestId", "question"],
  },
  async run(input) {
    const req = REQUESTS.find((r) => r.id === input.requestId);
    const name = req?.customerName ?? input.requestId;
    const answer = await rl.question(`\n[agent asks ${name}] ${input.question}\n${name}> `);
    return { ok: true, output: { requestId: input.requestId, question: input.question, answer } };
  },
};
if (useDemo) tools.register(askCustomer);

const identityLine = useDemo
  ? "- Every refund also requires verified identity first: lookup_customer (soft check), then send_otp, then ask_customer to get the code back from them, then verify_otp. process_refund will refuse if identity isn't verified yet, regardless of amount."
  : "";

const investigateLine = useDemo
  ? "For every one of the requests, gather what you need to judge it properly (check_vip_status, search_knowledge_base, get_resource_status, as relevant). If a request is genuinely ambiguous and you can't judge its priority or the right action from the message alone, use ask_customer to get a real clarifying answer directly from them — don't guess, and don't overuse it either. Do this for ALL requests before moving on."
  : "For every one of the requests, gather what you need to judge it properly (check_vip_status, search_knowledge_base, get_resource_status, as relevant). Do this for ALL requests before moving on.";

const refundActionLine = useDemo
  ? "for a billing issue, verify identity first (lookup_customer, send_otp, ask_customer for the code, verify_otp), then process_refund (escalate_to_manager only after it refuses);"
  : "for a billing issue, process_refund directly (escalate_to_manager only after it refuses);";

const systemPrompt = `You are the triage decision engine for a small salon/service business.

Business constraints right now:
- ${BUSINESS_CONTEXT.staffAvailable} staff members available today.
- ${BUSINESS_CONTEXT.appointmentSlotsLeftToday} appointment slots left today (call get_resource_status for the live count — it changes as you book).
- Refunds above $${BUSINESS_CONTEXT.refundApprovalLimit} need manager approval — process_refund will refuse them itself; don't try to work around that, escalate instead.
${identityLine}
- VIP list: ${VIP_LIST.join(", ")}.

You'll be given a batch of customer requests. Work in two phases — do not skip ahead:

PHASE 1 — Investigate everything first.
${investigateLine} Do NOT call assign_appointment_slot, process_refund, escalate_to_staff, escalate_to_manager, or record_decision during this phase.

PHASE 2 — Decide, in priority order.
Only once you've investigated everything, compare all the requests against each other and decide the batch's priority order (1=handle first ... last, no duplicates — this requires knowing all of them to rank any one). Then, starting from priority 1, take the right action for each request: assign_appointment_slot for a cancelled booking; ${refundActionLine} escalate_to_staff for anything needing a human; or resolve directly for a simple question. Call record_decision for it before moving to the next request.

When all requests are recorded, give a short paragraph summarizing your overall reasoning.`;

const agent = new AgentLoop({
  llm: new LlmClient(),
  tools,
  systemPrompt,
  maxSteps: 30,
  dryRun,
  approve: approveInTerminal,
  onToolCall(entry) {
    const detail = entry.result.ok ? JSON.stringify(entry.result.output) : `ERROR: ${entry.result.error}`;
    console.log(`  [tool] ${entry.tool}(${JSON.stringify(entry.input)}) -> ${detail}`);
  },
});

const batch = REQUESTS.map(
  (r) =>
    `[${r.id}] ${r.customerName} (${r.tier}) via ${r.channel}: "${r.message}"` +
    (r.refundAmount ? ` (amount in question: $${r.refundAmount})` : ""),
).join("\n");

console.log(`doo-agent-kit — live triage prototype${dryRun ? " (dry-run mode)" : ""}`);
console.log("Thinking...\n");

const result = await agent.run(`Here is today's request queue:\n\n${batch}`);

console.log(`agent> ${result.reply}\n`);

console.log(`[audit] ${result.audit.length} tool call(s):`);
for (const entry of result.audit) {
  const detail = entry.result.ok ? `output=${JSON.stringify(entry.result.output)}` : `error=${entry.result.error}`;
  console.log(`  - ${entry.tool} approved=${entry.approved} ok=${entry.result.ok} ${detail}`);
}

if (result.reflections.length > 0) {
  console.log(`\n[reflect] ${result.reflections.length} plan revision(s):`);
  for (const r of result.reflections) console.log(`  - step ${r.step}: ${r.reason}`);
}

console.log("\n===== DECISION SCREEN =====\n");
const sorted = [...decisions].sort((a, b) => a.priority - b.priority);
for (const d of sorted) {
  const req = REQUESTS.find((r) => r.id === d.requestId);
  console.log(`#${d.priority}  ${d.requestId} — ${req?.customerName ?? "?"}`);
  console.log(`  AI confidence: ${Math.round(d.confidence * 100)}%`);
  console.log(`  Recommended action: ${d.recommendedAction}`);
  console.log(`  Owner: ${d.owner}`);
  console.log(`  Suggested response: ${d.suggestedResponse}`);
  console.log(`  Reason: ${d.reason}`);
  console.log("");
}

rl.close();
