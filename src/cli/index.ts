import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { LlmClient } from "../llm/client.js";
import { MockLlmClient } from "../llm/mock-client.js";
import { ToolRegistry } from "../tools/registry.js";
import { getCurrentTime, lookupOrder, sendWhatsappMessage } from "../tools/examples.js";
import { MemoryStore } from "../memory/store.js";
import { AgentLoop } from "../agent/loop.js";
import type { ToolDefinition } from "../types.js";

const dryRun = process.argv.includes("--dry-run");
const mock = process.argv.includes("--mock");

const tools = new ToolRegistry();
tools.register(getCurrentTime);
tools.register(sendWhatsappMessage);
tools.register(lookupOrder);

const memory = new MemoryStore("memory.json");
await memory.load();

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
  systemPrompt: "You are a helpful support agent for DOO. Be concise.",
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
      console.log(`  - ${entry.tool} approved=${entry.approved} ok=${entry.result.ok}`);
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
rl.close();
