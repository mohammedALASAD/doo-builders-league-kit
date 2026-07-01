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
- `src/tools/registry.ts` — register/execute tools; add a new one in `src/tools/*.ts` and `register()` it in `src/cli/index.ts`.
- `src/agent/loop.ts` — plan → act → observe loop. Handles the max-step guard, the approval gate (guardrail), dry-run mode, the audit log, and reflection/re-planning (detects when a step's tool results diverge from the plan — default: any tool failure — and injects a re-planning nudge instead of blindly continuing).
- `src/memory/store.ts` — confidence-tagged fact store, optionally persisted to `memory.json`.
- `src/cli/index.ts` — CLI entrypoint; wires everything together, prompts for approval on risky tools.

## Adding a tool (should take < 5 min)

1. Write a `ToolDefinition` in `src/tools/*.ts` (name, description, inputSchema, `run`). Mark `risky: true` if it has a real side effect.
2. `tools.register(yourTool)` in `src/cli/index.ts`.
3. Done — the LLM sees it automatically via `tools.toAnthropicTools()`.
