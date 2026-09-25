import Anthropic from "@anthropic-ai/sdk";

/**
 * Provider interface for optional AI. Adapters know nothing about finance schemas: they take a system
 * prompt, a user message and a JSON schema, and return the model's JSON plus actual token usage.
 * No tools are ever passed to the model, so retrieved text cannot trigger actions.
 */

export interface AiRequest {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
}

export interface AiResponse {
  json: unknown;
  stopReason: string | null;
  refusalCategory: string | null;
  /** Model that actually served the request (may differ from the configured model after a server-side fallback). */
  servedModel: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

export type AiErrorCode = "RATE_LIMITED" | "OVERLOADED" | "AUTH" | "BAD_REQUEST" | "TIMEOUT" | "NETWORK" | "UPSTREAM" | "REFUSED" | "INCOMPLETE" | "INVALID_OUTPUT";

export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly status: number | null = null,
    readonly retryAfterSec: number | null = null,
    readonly usage: AiResponse["usage"] | null = null,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface AiProvider {
  name: "anthropic";
  model: string;
  generate(req: AiRequest): Promise<AiResponse>;
}

/** Models for which the server-side refusal fallback ("default" routing) is enabled. */
const FALLBACK_MODELS = new Set(["claude-opus-5", "claude-fable-5-1"]);

function retryAfter(headers: Headers | undefined): number | null {
  const v = headers?.get("retry-after");
  return v && /^\d{1,6}$/.test(v.trim()) ? Number(v.trim()) : null;
}

/** Maps SDK errors to stable codes. Messages never include the API key or request body. */
export function mapAnthropicError(e: unknown): AiProviderError {
  if (e instanceof AiProviderError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new AiProviderError("TIMEOUT", "The AI provider did not respond in time.");
  if (e instanceof Anthropic.APIConnectionError) return new AiProviderError("NETWORK", "Could not reach the AI provider.");
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new AiProviderError("AUTH", "The AI provider rejected the configured credentials. Check the FINANCE_AI_API_KEY secret.", e.status ?? null);
  if (e instanceof Anthropic.RateLimitError) return new AiProviderError("RATE_LIMITED", "The AI provider is rate limiting requests.", 429, retryAfter(e.headers));
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError || e instanceof Anthropic.UnprocessableEntityError) {
    return new AiProviderError("BAD_REQUEST", `The AI provider rejected the request (HTTP ${e.status}). Check FINANCE_AI_MODEL.`, e.status ?? null);
  }
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529 || e.status === 503) return new AiProviderError("OVERLOADED", "The AI provider is temporarily overloaded.", e.status, retryAfter(e.headers));
    return new AiProviderError("UPSTREAM", `The AI provider returned HTTP ${e.status ?? "error"}.`, e.status ?? null);
  }
  return new AiProviderError("UPSTREAM", "The AI request failed.");
}

export function createAnthropicProvider(cfg: { apiKey: string; model: string; fetcher: typeof fetch }): AiProvider {
  return {
    name: "anthropic",
    model: cfg.model,
    async generate(req: AiRequest): Promise<AiResponse> {
      // Explicit baseURL/authToken so host environment variables can never redirect the key or add credentials.
      // No automatic retries: a Retry-After of tens of seconds would hold the owner's request open; the UI offers a retry.
      const client = new Anthropic({ apiKey: cfg.apiKey, authToken: null, baseURL: "https://api.anthropic.com", fetch: cfg.fetcher, maxRetries: 0, timeout: req.timeoutMs });
      const base = {
        model: cfg.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user" as const, content: req.user }],
        output_config: { format: { type: "json_schema" as const, schema: req.jsonSchema } },
      };
      let msg: { content: Array<{ type: string; text?: string }>; stop_reason: string | null; stop_details?: { category?: string | null } | null; model: string; usage: { input_tokens: number; output_tokens: number } };
      try {
        msg = FALLBACK_MODELS.has(cfg.model)
          ? await client.beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
          : await client.messages.create(base);
      } catch (e) {
        throw mapAnthropicError(e);
      }
      const usage = { inputTokens: msg.usage?.input_tokens ?? null, outputTokens: msg.usage?.output_tokens ?? null };
      if (msg.stop_reason === "refusal") {
        throw new AiProviderError("REFUSED", `The model declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ""}.`, null, null, usage);
      }
      if (msg.stop_reason === "max_tokens") throw new AiProviderError("INCOMPLETE", "The response hit the output limit before finishing.", null, null, usage);
      const text = msg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AiProviderError("INVALID_OUTPUT", "The model's response was not valid JSON.", null, null, usage);
      }
      return { json, stopReason: msg.stop_reason, refusalCategory: null, servedModel: msg.model, usage };
    },
  };
}
