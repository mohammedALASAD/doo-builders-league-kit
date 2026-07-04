"use client";

import { useState } from "react";

interface Decision {
  requestId: string;
  customerName: string;
  priority: number;
  confidence: number;
  recommendedAction: string;
  owner: string;
  suggestedResponse: string;
  reason: string;
}

interface AuditEntry {
  tool: string;
  input: unknown;
  ok: boolean;
  output: unknown;
  error?: string;
}

export default function Home() {
  const [mode, setMode] = useState<"scenario" | "demo">("scenario");
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runTriage() {
    setLoading(true);
    setError(null);
    setReply(null);
    setDecisions([]);
    setAudit([]);
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = await res.json();
      setReply(data.reply);
      setDecisions(data.decisions);
      setAudit(data.audit);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <h1>DOO Triage — Decision Screen</h1>
      <p className="subtitle">
        Priority, AI confidence, recommended action, owner, suggested response, and the reason
        behind each — computed by an agent whose business rules (refund cap, manager escalation)
        are enforced in tool code, not just prompted. One automated workflow (VIP auto-rebooking)
        runs without approval; refunds over the cap are the case where the AI must escalate
        instead of acting.
      </p>

      <div className="controls">
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === "scenario"}
            onChange={() => setMode("scenario")}
          />
          Scenario (5 requests)
        </label>
        <label>
          <input type="radio" name="mode" checked={mode === "demo"} onChange={() => setMode("demo")} />
          Demo set (6 requests)
        </label>
        <button onClick={runTriage} disabled={loading}>
          {loading ? "Thinking…" : "Run Triage"}
        </button>
      </div>

      {error && <p className="error">Error: {error}</p>}

      {reply && (
        <div className="reasoning">
          <strong>Agent summary</strong>
          <p>{reply}</p>
        </div>
      )}

      {decisions.length > 0 && (
        <div className="grid">
          {decisions.map((d) => (
            <div key={d.requestId} className="card">
              <div className="card-header">
                <span className="priority">#{d.priority}</span>
                <span className="name">{d.customerName}</span>
              </div>
              <dl>
                <dt>AI confidence</dt>
                <dd>{Math.round(d.confidence * 100)}%</dd>
                <dt>Recommended action</dt>
                <dd>{d.recommendedAction}</dd>
                <dt>Owner</dt>
                <dd>{d.owner}</dd>
                <dt>Suggested response</dt>
                <dd>{d.suggestedResponse}</dd>
                <dt>Reason</dt>
                <dd>{d.reason}</dd>
              </dl>
            </div>
          ))}
        </div>
      )}

      {audit.length > 0 && (
        <div className="audit">
          <button onClick={() => setShowAudit((v) => !v)}>
            {showAudit ? "Hide" : "Show"} tool-call audit log ({audit.length})
          </button>
          {showAudit && (
            <ul>
              {audit.map((a, i) => (
                <li key={i}>
                  <code>{a.tool}</code>({JSON.stringify(a.input)}) →{" "}
                  {a.ok ? JSON.stringify(a.output) : `ERROR: ${a.error}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}
