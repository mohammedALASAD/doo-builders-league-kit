import { readFileSync, writeFileSync } from "node:fs";

const COMPLIANCE_LOG_FILE = "compliance-log.json";

export interface RejectionRecord {
  timestamp: string;
  subscriptionId: string;
  type: "identity_verification_failed" | "eligibility_failed";
  detail: string;
}

function loadLog(): RejectionRecord[] {
  try {
    return JSON.parse(readFileSync(COMPLIANCE_LOG_FILE, "utf-8"));
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
    return [];
  }
}

/** Permanent record of rejected cancellation attempts — failed identity
 * verification or failed eligibility. Unlike the per-session audit log the
 * CLI prints and discards on exit, this survives process restarts, so
 * compliance can review rejections after the fact. Append-only. */
export function logRejection(entry: Omit<RejectionRecord, "timestamp">): void {
  const log = loadLog();
  log.push({ ...entry, timestamp: new Date().toISOString() });
  writeFileSync(COMPLIANCE_LOG_FILE, JSON.stringify(log, null, 2), "utf-8");
}

export function readComplianceLog(): RejectionRecord[] {
  return loadLog();
}
