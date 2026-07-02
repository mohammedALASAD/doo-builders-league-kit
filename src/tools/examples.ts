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

/** Small fake order "database" shared by lookup_order and offer_compensation,
 * so offer_compensation can verify a customer's identity (phone on file) and
 * an order's existence server-side, rather than trusting the LLM's word for it. */
const FAKE_ORDERS: Record<string, { status: string; eta: string; customerPhone: string }> = {
  "ORD-1234": { status: "shipped", eta: "2 days", customerPhone: "+97312345678" },
  "ORD-5678": { status: "delayed", eta: "5 days", customerPhone: "+97355556666" },
  "ORD-4321": { status: "delivered", eta: "arrived", customerPhone: "+97399998888" },
};

function findFakeOrder(orderId: string): { status: string; eta: string; customerPhone: string } | null {
  return FAKE_ORDERS[orderId] ?? null;
}

export const lookupOrder: ToolDefinition<{ orderId: string }> = {
  name: "lookup_order",
  description: "Look up an order's status by order ID in the CRM/ecommerce system.",
  inputSchema: {
    type: "object",
    properties: { orderId: { type: "string", description: "Order ID, e.g. ORD-1234" } },
    required: ["orderId"],
  },
  async run(input) {
    const order = findFakeOrder(input.orderId);
    if (!order) return { ok: false, output: null, error: `Order ${input.orderId} not found` };
    return { ok: true, output: { orderId: input.orderId, ...order } };
  },
};

export const offerCompensation: ToolDefinition<{
  orderId: string;
  customerPhone: string;
  type: "discount" | "replacement";
  percentOff?: number;
}> = {
  name: "offer_compensation",
  description:
    "Offer a discount or replacement to a customer for a delayed order. Never issues a cash refund. Requires the order ID and the customer's phone number to verify their identity against the order on file.",
  inputSchema: {
    type: "object",
    properties: {
      orderId: { type: "string" },
      customerPhone: { type: "string", description: "Phone number of the person you're chatting with" },
      type: { type: "string", enum: ["discount", "replacement"] },
      percentOff: { type: "number", description: "Only for type=discount, max 10" },
    },
    required: ["orderId", "customerPhone", "type"],
  },
  risky: true,
  async run(input) {
    const order = findFakeOrder(input.orderId);
    if (!order) return { ok: false, output: null, error: `Order ${input.orderId} not found — cannot verify identity` };
    if (order.customerPhone !== input.customerPhone) {
      return { ok: false, output: null, error: "Phone number doesn't match the order on file — possible impersonation, do not proceed" };
    }
    if (input.type === "discount" && (input.percentOff ?? 0) > 10) {
      return { ok: false, output: null, error: "Discount exceeds the 10% policy limit" };
    }
    return { ok: true, output: { orderId: input.orderId, type: input.type, percentOff: input.type === "discount" ? (input.percentOff ?? 10) : undefined } };
  },
};
