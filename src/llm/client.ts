import Anthropic from "@anthropic-ai/sdk";

/** Structural shape the agent loop depends on — LlmClient and MockLlmClient both satisfy it. */
export interface LlmClientLike {
  createMessage(params: {
    system?: string;
    messages: Anthropic.MessageParam[];
    tools?: Anthropic.Tool[];
    maxTokens?: number;
  }): Promise<Anthropic.Message>;
}

/**
 * Thin, swappable wrapper around the Anthropic SDK. Keep every direct SDK
 * call behind this module so the agent loop never imports "@anthropic-ai/sdk"
 * directly — swapping providers means editing only this file.
 */
export class LlmClient implements LlmClientLike {
  private client: Anthropic;
  private model: string;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY, model = "claude-sonnet-5") {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.");
    }
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async createMessage(params: {
    system?: string;
    messages: Anthropic.MessageParam[];
    tools?: Anthropic.Tool[];
    maxTokens?: number;
  }): Promise<Anthropic.Message> {
    return this.client.messages.create({
      model: this.model,
      max_tokens: params.maxTokens ?? 1024,
      system: params.system,
      messages: params.messages,
      tools: params.tools,
    });
  }
}
