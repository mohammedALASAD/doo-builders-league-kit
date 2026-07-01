import type { ToolDefinition } from "../types.js";

export const getCurrentTime: ToolDefinition = {
  name: "get_current_time",
  description: "Get the current date and time in ISO 8601 format.",
  inputSchema: { type: "object", properties: {} },
  async run() {
    return { ok: true, output: new Date().toISOString() };
  },
};

/** Stands in for any real customer-facing send action (WhatsApp/Instagram/email).
 * Marked risky so the approval gate and dry-run mode both apply to it. */
export const sendWhatsappMessage: ToolDefinition<{ to: string; body: string }> = {
  name: "send_whatsapp_message",
  description: "Send a WhatsApp message to a customer. Has a real side effect — use with care.",
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "string", description: "Customer phone number, e.g. +973XXXXXXXX" },
      body: { type: "string", description: "Message text to send" },
    },
    required: ["to", "body"],
  },
  risky: true,
  async run(input, ctx) {
    if (ctx.dryRun) {
      return { ok: true, output: { simulated: true, to: input.to, body: input.body } };
    }
    // Real send would call the WhatsApp Business API here.
    return { ok: true, output: { sent: true, to: input.to, body: input.body } };
  },
};

/** Stands in for a CRM/ecommerce order lookup. Fails on purpose for IDs
 * containing "999" so there's a concrete, repeatable way to trigger the
 * reflection/re-planning pattern in agent/loop.ts without needing a real LLM. */
export const lookupOrder: ToolDefinition<{ orderId: string }> = {
  name: "lookup_order",
  description: "Look up an order's status by order ID in the CRM/ecommerce system.",
  inputSchema: {
    type: "object",
    properties: {
      orderId: { type: "string", description: "Order ID, e.g. ORD-1234" },
    },
    required: ["orderId"],
  },
  async run(input) {
    if (input.orderId.includes("999")) {
      return { ok: false, output: null, error: `Order ${input.orderId} not found` };
    }
    return { ok: true, output: { orderId: input.orderId, status: "shipped", eta: "2 days" } };
  },
};
