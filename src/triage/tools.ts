import type { ToolDefinition } from "../types.js";
import { BUSINESS_CONTEXT, KNOWLEDGE_BASE, VIP_LIST } from "./data.js";
import { isVerified } from "./identity.js";

const resourceState = {
  appointmentSlotsLeftToday: BUSINESS_CONTEXT.appointmentSlotsLeftToday,
  staffAvailable: BUSINESS_CONTEXT.staffAvailable,
};

export interface DecisionRecord {
  requestId: string;
  priority: number;
  confidence: number;
  recommendedAction: string;
  owner: string;
  suggestedResponse: string;
  reason: string;
}

/** Filled in by record_decision — the source of truth for the decision screen. */
export const decisions: DecisionRecord[] = [];

/** The CLI is one-shot per process, so this never mattered there — but a serverless
 * function instance can be reused across requests, and this module-level state would
 * otherwise leak between them (stale decisions, depleted slots). Call at the start of
 * every request. */
export function resetTriageState(): void {
  decisions.length = 0;
  resourceState.appointmentSlotsLeftToday = BUSINESS_CONTEXT.appointmentSlotsLeftToday;
  resourceState.staffAvailable = BUSINESS_CONTEXT.staffAvailable;
}

export const getResourceStatus: ToolDefinition = {
  name: "get_resource_status",
  description:
    "Get the current live count of appointment slots left today and staff available. Slot count changes as bookings are assigned — check this instead of assuming the original numbers still hold.",
  inputSchema: { type: "object", properties: {} },
  async run() {
    return {
      ok: true,
      output: { ...resourceState, refundApprovalLimit: BUSINESS_CONTEXT.refundApprovalLimit },
    };
  },
};

export const checkVipStatus: ToolDefinition<{ customerName: string }> = {
  name: "check_vip_status",
  description: "Check whether a customer is on the VIP list.",
  inputSchema: {
    type: "object",
    properties: { customerName: { type: "string" } },
    required: ["customerName"],
  },
  async run(input) {
    const isVip = VIP_LIST.some((n) => n.toLowerCase() === input.customerName.toLowerCase());
    return { ok: true, output: { customerName: input.customerName, isVip } };
  },
};

export const searchKnowledgeBase: ToolDefinition<{ topic: string }> = {
  name: "search_knowledge_base",
  description: `Look up a policy/pricing answer. Topics: ${Object.keys(KNOWLEDGE_BASE).join(", ")}.`,
  inputSchema: {
    type: "object",
    properties: { topic: { type: "string", enum: Object.keys(KNOWLEDGE_BASE) } },
    required: ["topic"],
  },
  async run(input) {
    const answer = KNOWLEDGE_BASE[input.topic];
    if (!answer) return { ok: false, output: null, error: `No KB entry for "${input.topic}"` };
    return { ok: true, output: { topic: input.topic, answer } };
  },
};

/** Automated workflow: this directly triggers a state change (slots left goes down),
 * not just a suggestion. Not risky: reversible, low-cost, and store policy already
 * grants cancelled-on clients priority rebooking, so no human checkpoint is needed. */
export const assignAppointmentSlot: ToolDefinition<{ customerName: string }> = {
  name: "assign_appointment_slot",
  description: "Automatically book the customer into the next available appointment slot today.",
  inputSchema: {
    type: "object",
    properties: { customerName: { type: "string" } },
    required: ["customerName"],
  },
  async run(input) {
    if (resourceState.appointmentSlotsLeftToday <= 0) {
      return { ok: false, output: null, error: "No appointment slots left today" };
    }
    resourceState.appointmentSlotsLeftToday -= 1;
    return {
      ok: true,
      output: {
        customerName: input.customerName,
        slotBooked: true,
        slotsLeftAfter: resourceState.appointmentSlotsLeftToday,
      },
    };
  },
};

/** Hard-capped and identity-gated in code, not just prompted — same pattern as the
 * discount cap and eligibility rule elsewhere in this kit. Two edge cases live here:
 * unverified identity (send_otp/verify_otp not done) and over-the-limit amount —
 * either one blocks the refund no matter how the model asks. */
export const processRefund: ToolDefinition<{ customerName: string; amount: number }> = {
  name: "process_refund",
  description:
    "Auto-process a refund. Requires the customer's identity to be verified first (send_otp + verify_otp). Only works at or under the approval limit — anything above it must be escalated to a manager instead.",
  inputSchema: {
    type: "object",
    properties: {
      customerName: { type: "string" },
      amount: { type: "number" },
    },
    required: ["customerName", "amount"],
  },
  risky: true,
  async run(input) {
    if (!isVerified(input.customerName)) {
      return {
        ok: false,
        output: null,
        error: `Identity not verified for ${input.customerName} — send_otp and verify_otp before processing any refund.`,
      };
    }
    if (input.amount > BUSINESS_CONTEXT.refundApprovalLimit) {
      return {
        ok: false,
        output: null,
        error: `$${input.amount} exceeds the $${BUSINESS_CONTEXT.refundApprovalLimit} auto-approval limit — requires manager sign-off. Do not process; escalate to a manager instead.`,
      };
    }
    return { ok: true, output: { customerName: input.customerName, refunded: input.amount } };
  },
};

export const escalateToStaff: ToolDefinition<{ customerName: string; reason: string }> = {
  name: "escalate_to_staff",
  description: "Assign a request to a human staff member for direct handling (only 2 staff available today).",
  inputSchema: {
    type: "object",
    properties: {
      customerName: { type: "string" },
      reason: { type: "string" },
    },
    required: ["customerName", "reason"],
  },
  async run(input) {
    return { ok: true, output: { customerName: input.customerName, assigned: true, reason: input.reason } };
  },
};

export const escalateToManager: ToolDefinition<{ customerName: string; reason: string }> = {
  name: "escalate_to_manager",
  description:
    "Flag a request for manager approval — use when a tool (e.g. process_refund) has refused because it's above the AI's authority.",
  inputSchema: {
    type: "object",
    properties: {
      customerName: { type: "string" },
      reason: { type: "string" },
    },
    required: ["customerName", "reason"],
  },
  async run(input) {
    return { ok: true, output: { customerName: input.customerName, flaggedForManager: true, reason: input.reason } };
  },
};

/** Structured-output tool: forces the model to commit to the decision-screen fields
 * per request instead of leaving them to be parsed out of free text. */
export const recordDecision: ToolDefinition<DecisionRecord> = {
  name: "record_decision",
  description: "Record the final triage decision for one request. Call this exactly once per request.",
  inputSchema: {
    type: "object",
    properties: {
      requestId: { type: "string" },
      priority: {
        type: "number",
        description: "1 = handle first across the whole batch ... 5 = last. No two requests share a priority.",
      },
      confidence: { type: "number", description: "0 to 1" },
      recommendedAction: {
        type: "string",
        enum: ["ai_auto_resolve", "ai_respond_and_escalate", "escalate_staff", "escalate_manager"],
      },
      owner: { type: "string", description: "Who handles it next, e.g. 'AI', 'Staff', 'Manager'" },
      suggestedResponse: { type: "string", description: "Customer-facing reply to actually send" },
      reason: { type: "string", description: "Why this priority/action/owner was chosen, one sentence" },
    },
    required: [
      "requestId",
      "priority",
      "confidence",
      "recommendedAction",
      "owner",
      "suggestedResponse",
      "reason",
    ],
  },
  async run(input) {
    decisions.push(input);
    return { ok: true, output: { recorded: input.requestId } };
  },
};
