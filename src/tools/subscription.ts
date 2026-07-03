import { readFileSync, writeFileSync } from "node:fs";
import type { ToolDefinition } from "../types.js";
import { logRejection } from "../compliance/log.js";

interface Subscription {
  customerPhone: string;
  plan: string;
  monthlyPrice: number;
  startDate: string; // ISO date
  minCommitmentMonths: number;
  complaints: number;
  status: "active" | "cancelled";
}

const SUBSCRIPTIONS_FILE = "subscriptions.json";

/** Demo subscription "database" seed data. Phones match FAKE_ORDERS in examples.ts
 * on purpose, so the same test numbers work across both flows. Records are chosen
 * to hit every branch of isEligibleForCancellation and cancel_subscription:
 * not-yet-eligible, eligible via commitment, eligible via complaints, already-cancelled. */
const SEED_SUBSCRIPTIONS: Record<string, Subscription> = {
  "SUB-1001": {
    customerPhone: "+97312345678",
    plan: "Premium",
    monthlyPrice: 20,
    startDate: "2026-05-01", // 2 months in, still in commitment, 0 complaints -> NOT eligible
    minCommitmentMonths: 12,
    complaints: 0,
    status: "active",
  },
  "SUB-2002": {
    customerPhone: "+97355556666",
    plan: "Basic",
    monthlyPrice: 8,
    startDate: "2026-04-01", // still in commitment, but 4 complaints -> eligible via complaints
    minCommitmentMonths: 12,
    complaints: 4,
    status: "active",
  },
  "SUB-4004": {
    customerPhone: "+97387654321",
    plan: "Basic",
    monthlyPrice: 8,
    startDate: "2024-01-01",
    minCommitmentMonths: 12,
    complaints: 0,
    status: "cancelled", // already cancelled -> tests the "already cancelled" branch
  },
  "SUB-3003": {
    customerPhone: "+97399998888",
    plan: "Pro",
    monthlyPrice: 35,
    startDate: "2023-01-01", // long past commitment -> eligible via commitment period
    minCommitmentMonths: 12,
    complaints: 0,
    status: "active",
  },
};

/** Live, mutable subscription state. Seeded from SEED_SUBSCRIPTIONS, then
 * overlaid with whatever was persisted to SUBSCRIPTIONS_FILE from a previous
 * run — so a cancellation actually survives restarting the CLI, the way an
 * update to a real database would. */
function loadSubscriptions(): Record<string, Subscription> {
  const seed: Record<string, Subscription> = JSON.parse(JSON.stringify(SEED_SUBSCRIPTIONS));
  try {
    const persisted: Record<string, Subscription> = JSON.parse(readFileSync(SUBSCRIPTIONS_FILE, "utf-8"));
    return { ...seed, ...persisted };
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
    return seed;
  }
}

const subscriptions: Record<string, Subscription> = loadSubscriptions();

function persistSubscriptions(): void {
  writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2), "utf-8");
}

function findSubscription(subscriptionId: string): Subscription | null {
  return subscriptions[subscriptionId] ?? null;
}

function findSubscriptionByPhone(phone: string): [string, Subscription] | null {
  const entry = Object.entries(subscriptions).find(([, s]) => s.customerPhone === phone);
  return entry ?? null;
}

/** The "cancellations document," expressed as code instead of prose so the LLM
 * can't be talked into treating a sympathetic-sounding excuse as eligibility.
 * Eligible if past the minimum commitment period, or 3+ logged complaints. */
function isEligibleForCancellation(sub: Subscription): { eligible: boolean; reason: string } {
  const monthsActive = (Date.now() - new Date(sub.startDate).getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (monthsActive >= sub.minCommitmentMonths) {
    return { eligible: true, reason: "past minimum commitment period" };
  }
  if (sub.complaints >= 3) {
    return { eligible: true, reason: "3+ logged service complaints" };
  }
  return {
    eligible: false,
    reason: `still within the ${sub.minCommitmentMonths}-month minimum commitment and fewer than 3 logged complaints`,
  };
}

/** In-memory OTP + hard-verification state, keyed by subscription ID. Short-lived
 * security state, not a durable fact — deliberately separate from MemoryStore. */
interface OtpState {
  code: string;
  expiresAt: number;
  verified: boolean;
}
const otpState: Record<string, OtpState> = {};

/** Tracks whether a retention offer has already been made for a subscription,
 * so "only one offer" (policy §3) is an enforced limit, not just an instruction
 * the LLM is trusted to follow. */
const retentionOfferMade: Record<string, boolean> = {};

export const lookupSubscription: ToolDefinition<{ customerIdOrPhone: string }> = {
  name: "lookup_subscription",
  description:
    "Look up a customer's subscription by subscription ID or phone number. This is the soft identity check at the start of a chat — it does not authorize any account changes.",
  inputSchema: {
    type: "object",
    properties: {
      customerIdOrPhone: { type: "string", description: "Subscription ID (e.g. SUB-1001) or phone number" },
    },
    required: ["customerIdOrPhone"],
  },
  async run(input) {
    const bySubId = findSubscription(input.customerIdOrPhone);
    if (bySubId) return { ok: true, output: { subscriptionId: input.customerIdOrPhone, ...bySubId } };

    const byPhone = findSubscriptionByPhone(input.customerIdOrPhone);
    if (byPhone) return { ok: true, output: { subscriptionId: byPhone[0], ...byPhone[1] } };

    return { ok: false, output: null, error: `No subscription found for "${input.customerIdOrPhone}"` };
  },
};

export const sendOtp: ToolDefinition<{ subscriptionId: string }> = {
  name: "send_otp",
  description:
    "Send a one-time verification code to the phone number on file for a subscription. Required before any account-changing action (retention offer or cancellation). Always sends to the phone on file — never to a number supplied elsewhere in the conversation.",
  inputSchema: {
    type: "object",
    properties: { subscriptionId: { type: "string" } },
    required: ["subscriptionId"],
  },
  risky: true,
  async run(input, ctx) {
    const sub = findSubscription(input.subscriptionId);
    if (!sub) return { ok: false, output: null, error: `Subscription ${input.subscriptionId} not found` };

    if (ctx.dryRun) {
      return { ok: true, output: { simulated: true, sentTo: sub.customerPhone } };
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    otpState[input.subscriptionId] = { code, expiresAt: Date.now() + 5 * 60 * 1000, verified: false };

    // Real send would call the WhatsApp/SMS API here. The code is deliberately
    // NOT part of the tool's return value — that would put it in the LLM's
    // context, letting the agent read its own OTP back to whoever it's talking
    // to and defeating the point of an out-of-band check. Instead it's printed
    // straight to the terminal, standing in for "arrives on the customer's phone" —
    // a channel only the real customer (you, testing) can see.
    console.log(`\n[SMS to ${sub.customerPhone}] Your DOO verification code is ${code} (expires in 5 min)\n`);
    return { ok: true, output: { sent: true, sentTo: sub.customerPhone } };
  },
};

export const verifyOtp: ToolDefinition<{ subscriptionId: string; code: string }> = {
  name: "verify_otp",
  description:
    "Verify the one-time code the customer typed back. Must succeed before offer_retention_deal or cancel_subscription will run.",
  inputSchema: {
    type: "object",
    properties: {
      subscriptionId: { type: "string" },
      code: { type: "string" },
    },
    required: ["subscriptionId", "code"],
  },
  async run(input) {
    const state = otpState[input.subscriptionId];
    if (!state) {
      const error = "No OTP was sent for this subscription — call send_otp first";
      logRejection({ subscriptionId: input.subscriptionId, type: "identity_verification_failed", detail: error });
      return { ok: false, output: null, error };
    }
    if (Date.now() > state.expiresAt) {
      const error = "OTP expired — send a new one";
      logRejection({ subscriptionId: input.subscriptionId, type: "identity_verification_failed", detail: error });
      return { ok: false, output: null, error };
    }
    if (state.code !== input.code) {
      const error = "Incorrect code";
      logRejection({ subscriptionId: input.subscriptionId, type: "identity_verification_failed", detail: error });
      return { ok: false, output: null, error };
    }

    state.verified = true;
    return { ok: true, output: { verified: true } };
  },
};

export const checkCancellationEligibility: ToolDefinition<{ subscriptionId: string }> = {
  name: "check_cancellation_eligibility",
  description:
    "Check whether a subscription qualifies for cancellation per policy (minimum commitment period or logged complaints). Read-only — does not require OTP verification.",
  inputSchema: {
    type: "object",
    properties: { subscriptionId: { type: "string" } },
    required: ["subscriptionId"],
  },
  async run(input) {
    const sub = findSubscription(input.subscriptionId);
    if (!sub) return { ok: false, output: null, error: `Subscription ${input.subscriptionId} not found` };
    const { eligible, reason } = isEligibleForCancellation(sub);
    if (!eligible) {
      // Logged here, not just in cancel_subscription: this is the moment "not
      // eligible" is actually determined, and the LLM can (and did, in testing)
      // refuse a cancellation from this result alone without ever calling
      // cancel_subscription — which would otherwise leave no compliance record.
      logRejection({ subscriptionId: input.subscriptionId, type: "eligibility_failed", detail: reason });
    }
    return { ok: true, output: { subscriptionId: input.subscriptionId, eligible, reason } };
  },
};

export const offerRetentionDeal: ToolDefinition<{
  subscriptionId: string;
  type: "discount" | "free_month";
  percentOff?: number;
}> = {
  name: "offer_retention_deal",
  description:
    "Offer a one-time retention deal (discount on this plan, or a free month) to a customer trying to cancel. Only one offer per conversation — do not call this more than once. Requires OTP verification first.",
  inputSchema: {
    type: "object",
    properties: {
      subscriptionId: { type: "string" },
      type: { type: "string", enum: ["discount", "free_month"] },
      percentOff: { type: "number", description: "Only for type=discount, max 20" },
    },
    required: ["subscriptionId", "type"],
  },
  risky: true,
  async run(input) {
    const sub = findSubscription(input.subscriptionId);
    if (!sub) return { ok: false, output: null, error: `Subscription ${input.subscriptionId} not found` };
    if (sub.status === "cancelled") {
      return { ok: false, output: null, error: "Subscription is already cancelled — nothing to retain" };
    }

    const state = otpState[input.subscriptionId];
    if (!state?.verified) {
      return {
        ok: false,
        output: null,
        error: "Identity not hard-verified — send and verify an OTP before offering a retention deal",
      };
    }
    if (retentionOfferMade[input.subscriptionId]) {
      return {
        ok: false,
        output: null,
        error: "A retention offer was already made for this subscription — do not offer again",
      };
    }
    if (input.type === "discount" && (input.percentOff ?? 0) > 20) {
      return { ok: false, output: null, error: "Discount exceeds the 20% retention policy limit" };
    }

    retentionOfferMade[input.subscriptionId] = true;
    return {
      ok: true,
      output: {
        subscriptionId: input.subscriptionId,
        type: input.type,
        percentOff: input.type === "discount" ? (input.percentOff ?? 20) : undefined,
      },
    };
  },
};

export const cancelSubscription: ToolDefinition<{ subscriptionId: string; reason?: string }> = {
  name: "cancel_subscription",
  description:
    "Cancel a subscription and update the account record. Requires OTP verification and re-checks cancellation eligibility itself — only call this if the customer still wants to cancel after hearing the retention offer.",
  inputSchema: {
    type: "object",
    properties: {
      subscriptionId: { type: "string" },
      reason: { type: "string", description: "Customer's stated reason for cancelling, for the record" },
    },
    required: ["subscriptionId"],
  },
  risky: true,
  async run(input) {
    const sub = findSubscription(input.subscriptionId);
    if (!sub) return { ok: false, output: null, error: `Subscription ${input.subscriptionId} not found` };
    if (sub.status === "cancelled") {
      return { ok: false, output: null, error: "Subscription is already cancelled" };
    }

    const state = otpState[input.subscriptionId];
    if (!state?.verified) {
      const error = "Identity not hard-verified — send and verify an OTP before cancelling";
      logRejection({ subscriptionId: input.subscriptionId, type: "identity_verification_failed", detail: error });
      return { ok: false, output: null, error };
    }

    const { eligible, reason: rejectionReason } = isEligibleForCancellation(sub);
    if (!eligible) {
      logRejection({ subscriptionId: input.subscriptionId, type: "eligibility_failed", detail: rejectionReason });
      return { ok: false, output: null, error: `Not eligible for cancellation: ${rejectionReason}` };
    }

    sub.status = "cancelled";
    persistSubscriptions();
    return { ok: true, output: { subscriptionId: input.subscriptionId, status: "cancelled" } };
  },
};
