import type { FinanceEnv } from "../types";

/**
 * Optional AI configuration. AI is off unless every required value is present: provider, model,
 * API key (server secret), a positive daily budget and a dated price table used for cost estimates.
 * Configuring a model name is not proof of a working connection; the first real call records the outcome.
 */

export interface AiConfig {
  enabled: boolean;
  reason: string;
  provider: "anthropic" | "none";
  model: string | null;
  apiKey: string | null;
  dailyBudgetUsd: number;
  priceInputPerMTok: number | null;
  priceOutputPerMTok: number | null;
  priceDate: string | null;
  /** Output-token ceiling per request (also the worst case reserved against the budget). */
  maxOutputTokens: number;
  /** Global cap on AI requests per day (Asia/Kolkata calendar). */
  dailyRequestCap: number;
}

function num(v: unknown): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function readAiConfig(env: FinanceEnv): AiConfig {
  const provider = (typeof env.FINANCE_AI_PROVIDER === "string" ? env.FINANCE_AI_PROVIDER.trim().toLowerCase() : "") || "none";
  const model = typeof env.FINANCE_AI_MODEL === "string" && env.FINANCE_AI_MODEL.trim() ? env.FINANCE_AI_MODEL.trim() : null;
  const apiKey = typeof env.FINANCE_AI_API_KEY === "string" && env.FINANCE_AI_API_KEY.trim() ? env.FINANCE_AI_API_KEY.trim() : null;
  const budget = num(env.FINANCE_AI_DAILY_BUDGET) ?? 0;
  const pin = num(env.FINANCE_AI_PRICE_INPUT_PER_MTOK);
  const pout = num(env.FINANCE_AI_PRICE_OUTPUT_PER_MTOK);
  const pdate = typeof env.FINANCE_AI_PRICE_DATE === "string" && /^\d{4}-\d{2}-\d{2}$/.test(env.FINANCE_AI_PRICE_DATE) ? env.FINANCE_AI_PRICE_DATE : null;
  const maxOut = Math.min(32_000, Math.max(1_000, Math.round(num(env.FINANCE_AI_MAX_OUTPUT_TOKENS) ?? 8_000)));
  const cap = Math.min(1_000, Math.max(1, Math.round(num(env.FINANCE_AI_DAILY_REQUESTS) ?? 60)));
  const base = { model, apiKey, dailyBudgetUsd: budget, priceInputPerMTok: pin, priceOutputPerMTok: pout, priceDate: pdate, maxOutputTokens: maxOut, dailyRequestCap: cap };
  if (provider === "none") return { ...base, provider: "none", enabled: false, reason: "AI is off (FINANCE_AI_PROVIDER is not set). All research, models, notes, review and compiled briefs work without it." };
  if (provider !== "anthropic") return { ...base, provider: "none", enabled: false, reason: `Unsupported AI provider "${provider}". Only "anthropic" is implemented.` };
  if (!model) return { ...base, provider: "anthropic", enabled: false, reason: "Set FINANCE_AI_MODEL to an explicit model ID." };
  if (!apiKey) return { ...base, provider: "anthropic", enabled: false, reason: "Set the FINANCE_AI_API_KEY server secret." };
  if (!(budget > 0)) return { ...base, provider: "anthropic", enabled: false, reason: "Set FINANCE_AI_DAILY_BUDGET (USD per day) above zero to allow paid requests." };
  if (pin === null || pout === null || !pdate) {
    return { ...base, provider: "anthropic", enabled: false, reason: "Set FINANCE_AI_PRICE_INPUT_PER_MTOK, FINANCE_AI_PRICE_OUTPUT_PER_MTOK and FINANCE_AI_PRICE_DATE so spend can be estimated and capped." };
  }
  return { ...base, provider: "anthropic", enabled: true, reason: `Enabled: ${model} via Anthropic, daily cap US$${budget.toFixed(2)} (estimated with prices dated ${pdate}).` };
}
