# doo-agent-kit

Reusable AI-agent starter kit for the DOO Builders League selection day.

## Setup

```bash
npm install
npm run dev -- --mock     # no API key needed — canned LLM responses, real tool/approval/audit loop
cp .env.example .env      # fill in ANTHROPIC_API_KEY when you're ready to pay for real API access
npm run dev                # CLI chat loop (real LLM)
npm run dev -- --dry-run  # same, but risky tools simulate instead of executing
```

Note: a Claude Pro subscription does **not** include API access — `ANTHROPIC_API_KEY` is billed
separately via console.anthropic.com. Use `--mock` to build and test the whole kit for free; only
fund a real key when you need genuine LLM reasoning (a full test session costs fractions of a cent).

## Layout

- `src/llm/client.ts` — thin wrapper around the Anthropic SDK. Swap providers here only.
- `src/llm/mock-client.ts` — canned-response stand-in for `LlmClient`, used by `--mock`. Keyword-matches user text to drive the same tool-call loop for free.
- `src/tools/registry.ts` — register/execute tools; add a new one in `src/tools/*.ts` and `register()` it in `src/cli/index.ts`.
- `src/tools/examples.ts` — order lookup/compensation demo tools (delayed-order support flow).
- `src/tools/subscription.ts` — subscription cancellation demo tools: soft lookup, hard OTP verification, retention offer, eligibility check, and cancellation. Every guardrail (OTP required, one retention offer, eligibility) is enforced in the tool code itself, not just prompted — see the comments for why. Live state persists to `subscriptions.json` (gitignored), so changes survive restarting the CLI.
- `docs/cancellation-policy.md` — the actual policy the LLM is given for the cancellation flow, loaded into the system prompt at startup. The tools re-check everything it describes rather than trusting the LLM's read of it.
- `src/compliance/log.ts` — permanent record of rejected cancellation attempts (failed identity verification or failed eligibility), persisted to `compliance-log.json` (gitignored) so it survives restarts and can't be skipped just because the LLM answers from context instead of calling the enforcing tool.
- `src/agent/loop.ts` — plan → act → observe loop. Handles the max-step guard, the approval gate (guardrail), dry-run mode, the audit log, and reflection/re-planning (detects when a step's tool results diverge from the plan — default: any tool failure — and injects a re-planning nudge instead of blindly continuing).
- `src/memory/store.ts` — confidence-tagged fact store, optionally persisted to `memory.json`. Exposed to the agent as tools in `src/tools/memory.ts` (`remember_fact` / `recall_fact`); facts below the confidence threshold are flagged when the CLI exits.
- `src/cli/index.ts` — CLI entrypoint; wires everything together, prompts for approval on risky tools.

## Adding a tool (should take < 5 min)

1. Write a `ToolDefinition` in `src/tools/*.ts` (name, description, inputSchema, `run`). Mark `risky: true` if it has a real side effect.
2. `tools.register(yourTool)` in `src/cli/index.ts`.
3. Done — the LLM sees it automatically via `tools.toAnthropicTools()`.
