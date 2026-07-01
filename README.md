# doo-agent-kit

Reusable AI-agent starter kit for the DOO Builders League selection day.

## Setup

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY
npm run dev             # CLI chat loop
npm run dev -- --dry-run  # same, but risky tools simulate instead of executing
```

## Layout

- `src/llm/client.ts` — thin wrapper around the Anthropic SDK. Swap providers here only.
- `src/tools/registry.ts` — register/execute tools; add a new one in `src/tools/*.ts` and `register()` it in `src/cli/index.ts`.
- `src/agent/loop.ts` — plan → act → observe loop. Handles the max-step guard, the approval gate (guardrail), dry-run mode, and the audit log.
- `src/memory/store.ts` — confidence-tagged fact store, optionally persisted to `memory.json`.
- `src/cli/index.ts` — CLI entrypoint; wires everything together, prompts for approval on risky tools.

## Adding a tool (should take < 5 min)

1. Write a `ToolDefinition` in `src/tools/*.ts` (name, description, inputSchema, `run`). Mark `risky: true` if it has a real side effect.
2. `tools.register(yourTool)` in `src/cli/index.ts`.
3. Done — the LLM sees it automatically via `tools.toAnthropicTools()`.
