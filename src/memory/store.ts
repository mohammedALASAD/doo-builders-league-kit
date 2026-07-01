import { readFile, writeFile } from "node:fs/promises";
import type { MemoryFact } from "../types.js";

/**
 * Confidence-tagged fact store: in-memory, optionally persisted to a JSON
 * file. Facts below CONFIDENCE_FLAG_THRESHOLD are surfaced by lowConfidence()
 * so the agent (or a human) can decide whether to double check them.
 */
const CONFIDENCE_FLAG_THRESHOLD = 0.5;

export class MemoryStore {
  private facts = new Map<string, MemoryFact>();

  constructor(private filePath?: string) {}

  set(key: string, value: unknown, confidence: number, source: string): void {
    this.facts.set(key, { key, value, confidence, source, updatedAt: new Date().toISOString() });
  }

  get(key: string): MemoryFact | undefined {
    return this.facts.get(key);
  }

  all(): MemoryFact[] {
    return [...this.facts.values()];
  }

  lowConfidence(threshold = CONFIDENCE_FLAG_THRESHOLD): MemoryFact[] {
    return this.all().filter((f) => f.confidence < threshold);
  }

  async load(): Promise<void> {
    if (!this.filePath) return;
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed: MemoryFact[] = JSON.parse(raw);
      this.facts = new Map(parsed.map((f) => [f.key, f]));
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  async save(): Promise<void> {
    if (!this.filePath) return;
    await writeFile(this.filePath, JSON.stringify(this.all(), null, 2), "utf-8");
  }
}
