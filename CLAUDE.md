# CLAUDE.md — DOO Builders League Prep

## Mission
Prepare me (Mohammed Majeed Alasad) for the **DOO Builders League Selection Day**
(Sat 4 July 2026, AUBH). Build a reusable AI-agent starter kit and get fast at agentic
building, so I can clone-and-adapt it live during the selection mini-challenge, get
selected into Phase 1, and work toward a full-time role at DOO.

## About me
- Cybersecurity graduate, University of Bahrain. Bilingual Arabic (Gulf dialect) + English.
- Founder of Notati (notati.app) — study-notes platform, 600+ UoB users.
- Strong with: TypeScript, React, NestJS, PostgreSQL, Python, SQL. Deploy via Vercel.
- I build with AI (Claude, Cursor) as a co-engineer — expected and required by DOO.

## About DOO (the target company)
- Bahraini, Arabic-first AI customer-experience platform. AI agents that handle support
  across WhatsApp, Instagram, email, and voice, natively in Gulf Arabic dialects.
- Agents connect to CRM and ecommerce systems and take real actions/workflows.
- Program funnel: builder profile → selection mini-challenge → matched to a challenge →
  Phase 1 (25 builders ship plugins) → Phase 2 (top 10 ship SDKs/MCP servers) → up to 5 hired.
- They REQUIRE building with AI and logging it: an **AI Usage Log per commit** documenting
  how I prompted, debugged, and collaborated with the LLM. The build log is the résumé.

## What we're building: the Agent Starter Kit
A small, reusable **TypeScript (Node)** repo I can clone and adapt under a 3.5-hour clock.
Python is an acceptable alternative if a specific challenge favors it.

Core components:
- LLM client (Anthropic SDK) with a clean, swappable wrapper.
- Tool / function-calling registry — adding a new tool should take under 5 minutes.
- Agent loop: plan → act → observe → repeat, with a max-step guard.
- Simple memory store (in-memory + JSON file) for conversation and facts.
- Minimal UI: CLI first; optional lightweight React web UI if time allows.

Agent patterns to have ready (these mirror DOO's season challenges):
- **Approval / guardrail gate** — agent checks whether it's allowed to act before acting.
  ("Decision Engine")
- **Reflection / re-planning** — detect when reality changed and revise the plan.
  ("Adaptive Agent")
- **Human-in-the-loop checkpoint** — pause for approval on risky actions.
  ("Agent Control Tower")
- **Action audit log** — every tool call recorded with inputs/outputs; doubles as the
  AI Usage Log. ("The Agent That Earns Trust")
- **Dry-run / simulate mode** — preview an action's effect before committing.
  ("Simulate Before You Act")
- **Confidence-tagged memory** — store facts with a confidence level; flag uncertainty.
  ("Memory That Knows It Might Be Wrong")
- Optional stretch: expose the tools as an **MCP server** (Phase 2 is MCP — bonus signal).

## Conventions
- TypeScript, 2-space indentation, ESLint. Keep modules small and composable.
- Never hardcode secrets — use environment variables (`.env`, gitignored).
- Commit often with clear messages. In each commit body add a short `AI-Usage:` note
  (what I asked the LLM, what I fixed) — this becomes my DOO AI Usage Log.
- Prefer readable, adaptable code over cleverness — I need to change it fast on the day.

## How to help me
- On request, act as an examiner: give a realistic DOO-style agent problem, timebox it,
  then review my build and debrief.
- Explain the "why" behind each agent pattern as we build, so I can reason out loud Saturday.
- Flag anything that would specifically impress — or concern — a DOO reviewer.
