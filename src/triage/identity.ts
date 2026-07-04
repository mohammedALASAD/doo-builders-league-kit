import type { ToolDefinition } from "../types.js";
import { CUSTOMER_DIRECTORY } from "./data.js";

interface OtpEntry {
  code: string;
  verified: boolean;
}

/** In-memory only, by design — short-lived, never persisted. */
const otpState: Record<string, OtpEntry> = {};

/** Off by default in the real challenge scenario (fast, non-interactive run);
 * on in demo mode where the OTP relay is actually exercised for testing. */
let requireVerification = false;

export function setRequireVerification(v: boolean): void {
  requireVerification = v;
}

/** Hard-verification check other tools (process_refund) gate on. Enforced in code,
 * not left to the model's memory of "I already checked this" — same pattern as the
 * subscription cancellation flow's OTP gate. */
export function isVerified(customerName: string): boolean {
  return !requireVerification || otpState[customerName]?.verified === true;
}

export const lookupCustomer: ToolDefinition<{ customerName: string }> = {
  name: "lookup_customer",
  description:
    "Soft identity check — confirm a customer exists on file and see their phone on file (masked). Does NOT verify identity by itself; use send_otp + verify_otp for that.",
  inputSchema: {
    type: "object",
    properties: { customerName: { type: "string" } },
    required: ["customerName"],
  },
  async run(input) {
    const phone = CUSTOMER_DIRECTORY[input.customerName];
    if (!phone) return { ok: false, output: null, error: `No customer on file named "${input.customerName}"` };
    const masked = phone.slice(0, -4).replace(/\d/g, "*") + phone.slice(-4);
    return { ok: true, output: { customerName: input.customerName, found: true, phoneOnFile: masked } };
  },
};

/** The code is deliberately never in this tool's return value — it goes to the
 * terminal only, standing in for an out-of-band SMS, so it never enters the LLM's
 * context. The agent has to get it back from the customer via ask_customer. */
export const sendOtp: ToolDefinition<{ customerName: string }> = {
  name: "send_otp",
  description:
    "Send a one-time verification code to the customer's phone on file. Required before process_refund will accept any refund for them.",
  inputSchema: {
    type: "object",
    properties: { customerName: { type: "string" } },
    required: ["customerName"],
  },
  async run(input) {
    const phone = CUSTOMER_DIRECTORY[input.customerName];
    if (!phone) {
      return { ok: false, output: null, error: `No customer on file named "${input.customerName}" — cannot send OTP` };
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    otpState[input.customerName] = { code, verified: false };
    console.log(`\n[SMS to ${phone}] Your DOO verification code is ${code} (expires in 5 min)`);
    return { ok: true, output: { sent: true, sentTo: phone } };
  },
};

export const verifyOtp: ToolDefinition<{ customerName: string; code: string }> = {
  name: "verify_otp",
  description:
    "Verify the one-time code the customer provided (get it from them via ask_customer). Required before process_refund will proceed.",
  inputSchema: {
    type: "object",
    properties: {
      customerName: { type: "string" },
      code: { type: "string" },
    },
    required: ["customerName", "code"],
  },
  async run(input) {
    const entry = otpState[input.customerName];
    if (!entry) return { ok: false, output: null, error: "No OTP was sent for this customer yet" };
    if (entry.code !== input.code.trim()) {
      return { ok: false, output: null, error: "Incorrect verification code — identity not confirmed" };
    }
    entry.verified = true;
    return { ok: true, output: { customerName: input.customerName, verified: true } };
  },
};
