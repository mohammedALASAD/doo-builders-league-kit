import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LlmClient } from "../llm/client.js";
import { MockLlmClient } from "../llm/mock-client.js";
import { ToolRegistry } from "../tools/registry.js";
import { getCurrentTime, lookupOrder, offerCompensation, sendWhatsappMessage } from "../tools/examples.js";
import {
  lookupSubscription,
  sendOtp,
  verifyOtp,
  checkCancellationEligibility,
  offerRetentionDeal,
  cancelSubscription,
} from "../tools/subscription.js";
import { createMemoryTools } from "../tools/memory.js";
import { MemoryStore } from "../memory/store.js";
import { readComplianceLog } from "../compliance/log.js";
import { AgentLoop } from "../agent/loop.js";
import type { ToolDefinition } from "../types.js";

const dryRun = process.argv.includes("--dry-run");
const mock = process.argv.includes("--mock");

const cancellationPolicy = readFileSync(
  fileURLToPath(new URL("../../docs/cancellation-policy.md", import.meta.url)),
  "utf-8",
);

const memory = new MemoryStore("memory.json");
await memory.load();

const tools = new ToolRegistry();
tools.register(getCurrentTime);
tools.register(sendWhatsappMessage);
tools.register(lookupOrder);
tools.register(offerCompensation);
tools.register(lookupSubscription);
tools.register(sendOtp);
tools.register(verifyOtp);
tools.register(checkCancellationEligibility);
tools.register(offerRetentionDeal);
tools.register(cancelSubscription);
for (const tool of createMemoryTools(memory)) tools.register(tool);

const rl = createInterface({ input: stdin, output: stdout });

/** Human-in-the-loop checkpoint: risky tools pause for a y/n in the terminal. */
async function approveInTerminal(tool: ToolDefinition, input: unknown): Promise<boolean> {
  if (!tool.risky) return true;
  const answer = await rl.question(
    `\n[approval needed] run "${tool.name}" with ${JSON.stringify(input)}? (y/n) `,
  );
  return answer.trim().toLowerCase() === "y";
}

const agent = new AgentLoop({
  llm: mock ? new MockLlmClient() : new LlmClient(),
  tools,
  systemPrompt:
    "You are a helpful support agent for DOO. Be concise. " +
    "When a customer wants to cancel their subscription, follow this policy document:\n\n" +
    cancellationPolicy,
  maxSteps: 8,
  dryRun,
  approve: approveInTerminal,
});

console.log(
  `doo-agent-kit CLI${dryRun ? " (dry-run mode)" : ""}${mock ? " (mock LLM — no API key, no cost)" : ""} — type "exit" to quit.\n`,
);

while (true) {
  const input = await rl.question("you> ");
  if (input.trim().toLowerCase() === "exit") break;

  const result = await agent.run(input);
  console.log(`\nagent> ${result.reply}\n`);

  if (result.audit.length > 0) {
    console.log(`[audit] ${result.audit.length} tool call(s) this turn:`);
    for (const entry of result.audit) {
      const detail = entry.result.ok
        ? `output=${JSON.stringify(entry.result.output)}`
        : `error=${entry.result.error}`;
      console.log(`  - ${entry.tool} approved=${entry.approved} ok=${entry.result.ok} ${detail}`);
    }
    console.log("");
  }

  if (result.reflections.length > 0) {
    console.log(`[reflect] ${result.reflections.length} plan revision(s) triggered:`);
    for (const r of result.reflections) {
      console.log(`  - step ${r.step}: ${r.reason}`);
    }
    console.log("");
  }
}

await memory.save();

const uncertain = memory.lowConfidence();
if (uncertain.length > 0) {
  console.log(`[memory] ${uncertain.length} fact(s) below confidence threshold — worth reconfirming next time:`);
  for (const f of uncertain) {
    console.log(`  - ${f.key}: ${JSON.stringify(f.value)} (confidence ${f.confidence})`);
  }
}

const rejections = readComplianceLog();
if (rejections.length > 0) {
  console.log(`[compliance] ${rejections.length} rejected attempt(s) on file (compliance-log.json):`);
  for (const r of rejections) {
    console.log(`  - ${r.timestamp} ${r.subscriptionId} [${r.type}] ${r.detail}`);
  }
}

rl.close();

