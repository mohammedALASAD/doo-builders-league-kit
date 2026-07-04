# What I Learned Building doo-agent-kit

Notes from building and stress-testing an AI support agent (DOO Builders League prep) —
specifically from adding a subscription cancellation & retention flow under a timed,
Selection-Day-style rehearsal.

## The agent patterns in play

- **Tool registry** — each capability is a small `{ name, description, inputSchema, run }`
  object. Adding a new one should take under 5 minutes.
- **Plan → act → observe loop**, with a max-step guard so the agent can't spin forever.
- **Approval/guardrail gate** — any tool with a real side effect is marked `risky` and
  pauses for a human y/n before running.
- **Reflection / re-planning** — when a tool call fails, the loop notices and injects a
  nudge instead of blindly repeating the same plan.
- **Confidence-tagged memory** — facts get stored with a confidence score; low-confidence
  ones are flagged for a human to double check later.
- **Action audit log** — every tool call, input, and result gets recorded. Doubles as the
  build/testing log.
- **Dry-run / simulate mode** — preview what a risky action would do before it actually runs.

## The feature: subscription cancellation & retention

Spec: verify identity (twice — a soft check up front, a hard OTP check before any real
action), find out why the customer wants to cancel, offer one retention deal before
touching cancellation, only cancel if the account is actually eligible, and keep a
permanent record of rejections.

Six tools came out of that: `lookup_subscription` (soft check), `send_otp` / `verify_otp`
(hard check), `check_cancellation_eligibility` (deterministic policy rule), `offer_retention_deal`
(one-shot, capped), `cancel_subscription` (re-checks everything itself before mutating anything).

## The big lesson: defense-in-depth

**Never trust the LLM to enforce a rule on its own — enforce it in code.** Every real bug
found while building this traced back to relying on the model instead of the tool:

1. **A discount cap.** Asked for "up to X% off," the model defaulted to the maximum
   without asking. Fix: hard-cap it in the tool, not just in the prompt.
2. **A leaked OTP.** The verification code was returned inside the tool's own result —
   which means it entered the LLM's context, so the agent could just read its own
   verification code back to whoever it was chatting with. That defeats the entire point
   of an out-of-band check. Fix: never put the code in the tool's return value; deliver it
   through a channel the LLM never sees.
3. **A silently-reset database.** The demo "database" was a plain in-memory object, so a
   successful cancellation looked fine right up until the process restarted and forgot
   everything. Fix: persist it to a file, load it back on startup — same pattern as the
   memory store already used for facts.
4. **A skippable audit trail.** The agent could refuse a cancellation purely from
   remembering an earlier eligibility check, without ever calling the tool that logs
   rejections — meaning the compliance record could be silently skipped. Fix: log at the
   moment the answer is actually determined, not just inside the action tool.

None of these were found by reading the code carefully. All four were found by actually
running the thing and asking "would this survive someone trying to break it?"

## Testing habits that actually worked

- **Run it, don't just read it.** Every bug above surfaced through live testing, not review.
- **"Can I test every scenario?"** — build the demo dataset to deliberately hit every
  branch (not-eligible, eligible via each different reason, already-cancelled), instead of
  one happy-path record.
- **"How would this work for real?"** — asking this about the OTP flow specifically is
  what surfaced the leak. Realism as a testing lens finds things code review misses.
- **Verify a fix from a fresh process, not the one you're already in.** The database
  persistence bug only became visible by restarting and checking again.

## Process habits

- **Commit often, with a note on what you asked the model and what you fixed.** That log
  *is* the deliverable in a build-with-AI context — treat it as documentation, not an
  afterthought.
- **Budget real cleanup time before calling something "done."** Re-read your own diff.
  This came up twice across two separate rehearsals — worth building into a personal habit
  rather than relying on someone else to catch it.
- **Mock mode for free plumbing tests, real LLM for real reasoning gaps.** A keyword-matching
  mock can prove the tool-calling wiring works without spending anything; it can't tell you
  whether the model will actually follow a policy under pressure.

## MCP (Model Context Protocol) — for later, not urgent

A standard way to expose a set of tools to any LLM client, instead of wiring them into one
specific app. Worth knowing: a tool registry shaped like `{ name, description, inputSchema, run }`
is already close to what an MCP server's tool list looks like — wrapping it as one later is
mostly a transport layer, not a redesign.
