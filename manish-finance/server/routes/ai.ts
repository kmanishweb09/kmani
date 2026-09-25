import { requireOwner } from "../auth";
import { readAiConfig } from "../ai/config";
import {
  AI_OPERATIONS,
  type AiOperation,
  aiDay,
  buildPack,
  estimateCostUsd,
  estimateTokens,
  newUsageId,
  OPERATION_LABEL,
  reserveBudget,
  SYSTEM_PROMPT,
  usageToday,
  userMessage,
  validateOutput,
  zAiRequest,
} from "../ai/operations";
import { AiProviderError, createAnthropicProvider } from "../ai/provider";
import { idempotent, parseJsonColumn, rateLimit, requireDb } from "../db";
import { HttpError, privateJson, readJson, sha256Hex, validationError } from "../http";
import { evidenceMap, getResearch } from "../research";
import type { Router } from "../router";
import { redact } from "../sources/collect";
import type { RequestContext } from "../types";

/**
 * Optional AI endpoints (owner only). Off unless fully configured; every request is previewable,
 * budget-reserved before the call, grounded after it and logged with actual token usage.
 */

const MAX_BODY = 16 * 1024;
const TIMEOUT_MS = 45_000;
const HOURLY_LIMIT = 30;

const ALTERNATIVE: Record<AiOperation, string> = {
  summarize: "The deal, company and sector pages already show every sourced fact with its evidence.",
  explain: "The glossary gives the definition, context and common confusion for each term.",
  draft_note: "Notebook templates (deal note, company note, sector thesis) give the same structure to fill in yourself.",
  questions: "Autopsies and sector playbooks list diligence questions and falsifiers.",
  interview_feedback: "The self-review rubric and the evidence-linked answer outline are available without AI.",
  extract: "The manual source form records an event with its link for review.",
};

function operationOf(c: RequestContext): AiOperation {
  const op = c.params.op ?? "";
  if (!(AI_OPERATIONS as readonly string[]).includes(op)) throw new HttpError(404, "NOT_FOUND", "Unknown AI operation.");
  return op as AiOperation;
}

async function parseBody(c: RequestContext) {
  const r = zAiRequest.safeParse(await readJson(c.request, MAX_BODY));
  if (!r.success) throw validationError(r.error.issues);
  return r.data;
}

export function registerAiRoutes(r: Router): void {
  r.add({
    method: "GET",
    pattern: "/api/finance/ai/status",
    access: "owner",
    handler: async (c) => {
      const cfg = readAiConfig(c.env);
      const db = requireDb(c);
      const today = await usageToday(db, aiDay(c.now));
      return privateJson({
        enabled: cfg.enabled,
        reason: cfg.reason,
        provider: cfg.provider,
        model: cfg.model,
        dailyBudgetUsd: cfg.dailyBudgetUsd,
        spentTodayUsd: Number(today.spentUsd.toFixed(4)),
        requestsToday: today.requests,
        dailyRequestCap: cfg.dailyRequestCap,
        maxOutputTokens: cfg.maxOutputTokens,
        priceDate: cfg.priceDate,
        costLabel: "Estimated from the configured, dated price table; not a bill.",
        operations: AI_OPERATIONS.map((id) => ({ id, label: OPERATION_LABEL[id], alternative: ALTERNATIVE[id] })),
      });
    },
  });

  r.add({
    method: "GET",
    pattern: "/api/finance/ai/history",
    access: "owner",
    handler: async (c) => {
      const userId = requireOwner(c);
      const rows = (await requireDb(c).prepare("SELECT * FROM finance_ai_usage WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").bind(userId).all<Record<string, unknown>>()).results ?? [];
      return privateJson({
        items: rows.map((x) => ({
          id: x.id,
          operation: x.operation,
          model: x.model,
          status: x.status,
          subject: x.subject,
          inputTokens: x.input_tokens,
          outputTokens: x.output_tokens,
          estCostUsd: x.est_cost_usd,
          priceTableDate: x.price_table_date,
          evidenceVersion: x.evidence_version,
          error: x.error,
          createdAt: x.created_at,
          result: parseJsonColumn(x.result_json as string | null, null),
        })),
      });
    },
  });

  // Shows exactly what would be sent, without calling the provider (works while AI is off).
  r.add({
    method: "POST",
    pattern: "/api/finance/ai/:op/preview",
    access: "owner",
    handler: async (c) => {
      const userId = requireOwner(c);
      const op = operationOf(c);
      const body = await parseBody(c);
      const db = requireDb(c);
      const cfg = readAiConfig(c.env);
      const pack = await buildPack(op, body, await getResearch(db), db, userId);
      const inputTokens = estimateTokens(SYSTEM_PROMPT + userMessage(pack));
      return privateJson({
        operation: op,
        enabled: cfg.enabled,
        reason: cfg.reason,
        alternative: ALTERNATIVE[op],
        header: pack.header,
        items: pack.items.map((i) => ({ id: i.id, label: i.label, chars: i.text.length, private: i.id.startsWith("note:") || i.id === "answer:self" })),
        instruction: pack.operationInstruction,
        estimatedInputTokens: inputTokens,
        maxOutputTokens: cfg.maxOutputTokens,
        estimatedMaxCostUsd: cfg.enabled ? Number(estimateCostUsd(cfg, inputTokens, cfg.maxOutputTokens).toFixed(4)) : null,
        priceDate: cfg.priceDate,
      });
    },
  });

  r.add({
    method: "POST",
    pattern: "/api/finance/ai/:op",
    access: "owner",
    handler: async (c) => {
      const userId = requireOwner(c);
      const op = operationOf(c);
      const cfg = readAiConfig(c.env);
      if (!cfg.enabled || !cfg.apiKey || !cfg.model) throw new HttpError(503, "AI_DISABLED", cfg.reason, { alternative: ALTERNATIVE[op] });
      const body = await parseBody(c);
      const db = requireDb(c);
      return idempotent(c, userId, `ai.${op}`, body, async () => {
        await rateLimit(c, "ai", await sha256Hex(userId, 16), HOURLY_LIMIT, 3600);
        const view = await getResearch(db);
        const pack = await buildPack(op, body, view, db, userId);
        const user = userMessage(pack);
        const inputEstimate = estimateTokens(SYSTEM_PROMPT + user);
        const reserve = estimateCostUsd(cfg, inputEstimate, cfg.maxOutputTokens);
        const usageId = newUsageId();
        const day = aiDay(c.now);
        const subject = body.subject ? `${body.subject.type}:${body.subject.id}` : body.attemptId ? `interview:${body.attemptId}` : null;
        const ok = await reserveBudget(db, { id: usageId, userId, day, op, model: cfg.model as string, reserveUsd: reserve, budgetUsd: cfg.dailyBudgetUsd, maxRequests: cfg.dailyRequestCap, priceDate: cfg.priceDate, subject, nowIso: c.now.toISOString() });
        if (!ok) {
          const t = await usageToday(db, day);
          throw new HttpError(429, "AI_BUDGET_EXHAUSTED", `Today's AI limit is reached (estimated US$${t.spentUsd.toFixed(2)} of US$${cfg.dailyBudgetUsd.toFixed(2)}, ${t.requests} of ${cfg.dailyRequestCap} requests). ${ALTERNATIVE[op]}`);
        }
        const provider = createAnthropicProvider({ apiKey: cfg.apiKey as string, model: cfg.model as string, fetcher: c.options.fetcher });
        const finish = async (status: string, usage: { inputTokens: number | null; outputTokens: number | null } | null, result: unknown, error: string | null) => {
          const cost = usage && (usage.inputTokens !== null || usage.outputTokens !== null) ? estimateCostUsd(cfg, usage.inputTokens ?? 0, usage.outputTokens ?? 0) : 0;
          await db
            .prepare("UPDATE finance_ai_usage SET status = ?, input_tokens = ?, output_tokens = ?, est_cost_usd = ?, evidence_version = ?, result_json = ?, error = ? WHERE id = ?")
            .bind(status, usage?.inputTokens ?? null, usage?.outputTokens ?? null, cost, pack.version, result === null ? null : JSON.stringify(result).slice(0, 60_000), error, usageId)
            .run();
          return cost;
        };
        let response;
        try {
          response = await provider.generate({ system: SYSTEM_PROMPT, user, jsonSchema: pack.schema, maxTokens: cfg.maxOutputTokens, timeoutMs: TIMEOUT_MS });
        } catch (e) {
          const err = e instanceof AiProviderError ? e : new AiProviderError("UPSTREAM", "The AI request failed.");
          const message = redact(err.message, c.env);
          await finish(err.code === "REFUSED" ? "refused" : "error", err.usage, null, `${err.code}: ${message}`);
          const status = err.code === "RATE_LIMITED" ? 429 : err.code === "OVERLOADED" ? 503 : err.code === "TIMEOUT" ? 504 : err.code === "REFUSED" || err.code === "INVALID_OUTPUT" || err.code === "INCOMPLETE" ? 422 : 502;
          throw new HttpError(status, `AI_${err.code}`, `${message} ${ALTERNATIVE[op]}`, undefined, err.retryAfterSec ? { "Retry-After": String(err.retryAfterSec) } : undefined);
        }
        let result;
        try {
          result = validateOutput(op, response.json, pack);
        } catch (e) {
          await finish("rejected", response.usage, null, e instanceof Error ? e.message : "invalid output");
          throw new HttpError(422, "AI_OUTPUT_REJECTED", `The AI response did not match the expected structure and was discarded. ${ALTERNATIVE[op]}`);
        }
        const empty = op === "interview_feedback" ? !result.criteria?.length : op === "extract" ? false : !result.sections.length;
        const meta = { provider: "anthropic", model: cfg.model, servedModel: response.servedModel, generatedAt: c.now.toISOString(), evidenceVersion: pack.version, method: "ai_synthesis" };
        if (empty) {
          await finish("rejected", response.usage, { ...result, meta }, "No section passed grounding checks.");
          throw new HttpError(422, "AI_OUTPUT_REJECTED", `Every part of the AI response failed the grounding checks (unknown citations or unsupported numbers), so nothing is shown as a finding. ${ALTERNATIVE[op]}`, { held: result.held.slice(0, 10) });
        }
        // Accepted extraction proposals go to the owner review queue; nothing is published automatically.
        const queued: string[] = [];
        if (op === "extract" && result.proposals?.length && pack.dealId && pack.documentId) {
          const d = view.dealById.get(pack.dealId);
          for (const p of result.proposals) {
            const dedupe = `ai:${pack.documentId}:${pack.dealId}:${p.eventType}:${p.date}`;
            const id = `rv_${await sha256Hex(dedupe, 24)}`;
            const res = await db
              .prepare("INSERT INTO finance_review_queue (id, kind, subject_type, subject_id, field, proposal_json, evidence_json, origin, status, dedupe_key, created_at) VALUES (?, 'ai_extraction', 'deal', ?, 'events', ?, ?, ?, 'pending', ?, ?) ON CONFLICT(dedupe_key) DO NOTHING")
              .bind(
                id,
                pack.dealId,
                JSON.stringify({ dealId: pack.dealId, dealTitle: d?.title ?? pack.dealId, event: { type: p.eventType, date: p.date, title: p.title.slice(0, 200), statusAfter: null }, note: `Proposed by AI (${response.servedModel}) from the cited document. Read the document before publishing.` }),
                JSON.stringify({ documentId: pack.documentId, citations: p.citations }),
                `ai:${response.servedModel}`,
                dedupe,
                c.now.toISOString(),
              )
              .run();
            if (res.meta.changes) queued.push(id);
          }
        }
        if (op === "interview_feedback" && pack.attempt) {
          await db.prepare("UPDATE finance_interview_attempts SET ai_feedback_json = ? WHERE id = ? AND user_id = ?").bind(JSON.stringify({ ...result, meta }), pack.attempt.id, userId).run();
        }
        const cost = await finish(result.held.length ? "partial" : "ok", response.usage, { ...result, meta }, null);
        const cited = [...new Set([...result.sections.flatMap((s) => s.citations), ...(result.criteria ?? []).flatMap((x) => x.citations)])];
        return {
          status: 200,
          body: {
            ...result,
            meta,
            queuedReviewItems: queued,
            evidence: evidenceMap(view, cited.filter((id) => id.startsWith("ev-") && !id.startsWith("ev-u-"))),
            packLabels: Object.fromEntries(pack.items.map((i) => [i.id, i.label])),
            usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens, estCostUsd: Number(cost.toFixed(5)), estimate: true, priceDate: cfg.priceDate },
          },
        };
      });
    },
  });
}
