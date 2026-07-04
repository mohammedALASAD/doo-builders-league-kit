export interface TriageRequest {
  id: string;
  customerName: string;
  tier: "vip" | "new" | "regular";
  channel: string;
  category: "booking_cancelled" | "billing_dispute" | "pricing_question" | "urgent_complaint";
  message: string;
  refundAmount?: number;
}

/** The actual challenge dataset. */
export const SCENARIO_REQUESTS: TriageRequest[] = [
  {
    id: "R1",
    customerName: "Layla Al-Sayed",
    tier: "vip",
    channel: "WhatsApp",
    category: "booking_cancelled",
    message:
      "My appointment today got cancelled on me with no warning. I need this sorted today, I've been a client for years.",
  },
  {
    id: "R2",
    customerName: "Ahmed Yusuf",
    tier: "new",
    channel: "Instagram",
    category: "pricing_question",
    message: "Hi! First time booking with you — how much is the full package?",
  },
  {
    id: "R3",
    customerName: "Noor Hassan",
    tier: "regular",
    channel: "WhatsApp",
    category: "billing_dispute",
    message:
      "I was charged TWICE for the same session, $85 extra on my card. This needs to be refunded now, not happy about this.",
    refundAmount: 85,
  },
  {
    id: "R4",
    customerName: "Sara Khalfan",
    tier: "regular",
    channel: "Email",
    category: "pricing_question",
    message: "Quick question — do you offer a student discount?",
  },
  {
    id: "R5",
    customerName: "Khalid Mannai",
    tier: "regular",
    channel: "Instagram",
    category: "urgent_complaint",
    message:
      "This is the second time my service was rushed and cut short. Fix this today or I'm leaving a 1-star review tonight.",
  },
];

/** Broader coverage for self-testing: a refund under the cap (happy path with identity
 * verification), a non-VIP cancelled booking (priority comparison against a VIP one),
 * and a deliberately vague request (should force ask_customer), on top of the same
 * shapes as the scenario set. */
export const DEMO_REQUESTS: TriageRequest[] = [
  {
    id: "D1",
    customerName: "Fatima Al-Zayani",
    tier: "vip",
    channel: "WhatsApp",
    category: "booking_cancelled",
    message: "My slot today was cancelled without notice — I need to be rebooked, I'm a VIP client.",
  },
  {
    id: "D2",
    customerName: "Yousif Ahmed",
    tier: "regular",
    channel: "WhatsApp",
    category: "billing_dispute",
    message: "I think I was overcharged by $30 on my last visit, can you check and refund the difference?",
    refundAmount: 30,
  },
  {
    id: "D3",
    customerName: "Maryam Isa",
    tier: "regular",
    channel: "Instagram",
    category: "billing_dispute",
    message: "You charged my card $120 for a service I never received. I want that back.",
    refundAmount: 120,
  },
  {
    id: "D4",
    customerName: "Hassan Ali",
    tier: "new",
    channel: "Email",
    category: "urgent_complaint",
    message: "Something happened during my last visit and I'm really not happy about it. Need this sorted.",
  },
  {
    id: "D5",
    customerName: "Aisha Buhindi",
    tier: "regular",
    channel: "Instagram",
    category: "pricing_question",
    message: "Do you guys take walk-ins, or is it appointment only?",
  },
  {
    id: "D6",
    customerName: "Ali Buali",
    tier: "regular",
    channel: "WhatsApp",
    category: "booking_cancelled",
    message: "My appointment got cancelled today too — can someone rebook me?",
  },
];

export const BUSINESS_CONTEXT = {
  staffAvailable: 2,
  appointmentSlotsLeftToday: 3,
  refundApprovalLimit: 50,
};

export const VIP_LIST = ["Layla Al-Sayed", "Omar Al-Fardan", "Fatima Al-Zayani"];

export const KNOWLEDGE_BASE: Record<string, string> = {
  pricing: "Full package: $120. Single session: $45. Student discount: 15% off with valid student ID.",
  refund_policy:
    "Refunds up to $50 can be auto-approved by AI. Anything above that requires manager sign-off before processing.",
  cancellation_policy:
    "If we cancel on a client, they get priority rebooking into the next available slot at no charge.",
};

/** Soft-check directory for identity verification — phone on file per customer, used
 * by lookup_customer/send_otp. Covers both datasets. */
export const CUSTOMER_DIRECTORY: Record<string, string> = {
  "Layla Al-Sayed": "+97312345678",
  "Ahmed Yusuf": "+97355556666",
  "Noor Hassan": "+97399998888",
  "Sara Khalfan": "+97387654321",
  "Khalid Mannai": "+97366665555",
  "Fatima Al-Zayani": "+97311112222",
  "Yousif Ahmed": "+97322223333",
  "Maryam Isa": "+97333334444",
  "Hassan Ali": "+97344445555",
  "Aisha Buhindi": "+97355559999",
  "Ali Buali": "+97366661111",
};
