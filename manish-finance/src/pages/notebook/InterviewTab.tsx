import { useEffect, useMemo, useRef, useState } from "react";
import type { DealDetail, DealSummary, Page } from "../../../shared/api";
import type { CompiledSector } from "../../../shared/archive/compile";
import { DEAL_STATUS_LABEL, SECTOR_NAMES, SECTOR_SLUGS } from "../../../shared/labels";
import { apiSend, errorMessage, newIdempotencyKey } from "../../app/api";
import { invalidate, useQuery } from "../../app/query";
import { Link } from "../../app/router";
import { useToast } from "../../app/toast";
import { Ev, useRegisterEvidence } from "../../components/Evidence";
import { Icon } from "../../components/Icon";
import { useConfirm } from "../../components/Overlay";
import { EmptyState, Skeleton } from "../../components/ui";
import { asReported, dateLabel, headlineText } from "../../lib/format";

type SubjectKind = "deal" | "sector";

const PROMPTS: Array<{ id: string; text: string; subject: SubjectKind; target: number }> = [
  { id: "walk-deal", text: "Walk me through a deal you followed.", subject: "deal", target: 120 },
  { id: "why-buyer", text: "Why this buyer and this target?", subject: "deal", target: 90 },
  { id: "valued-financed", text: "How was it valued and financed?", subject: "deal", target: 90 },
  { id: "argument-against", text: "What is the strongest argument against the transaction?", subject: "deal", target: 90 },
  { id: "sector-update", text: "What is happening in a sector you follow?", subject: "sector", target: 120 },
  { id: "metric-choice", text: "Which metric would you use here, and which would mislead you?", subject: "sector", target: 90 },
];

const RUBRIC = [
  { id: "accuracy", label: "Factual accuracy", strong: "Names, dates, value and basis correct", weak: "Wrong or unsourced numbers" },
  { id: "structure", label: "Structure", strong: "Clear order: situation → rationale → price → risk → view", weak: "Jumps around" },
  { id: "evidence", label: "Evidence", strong: "Cites the filing/announcement and dates", weak: "Opinion without support" },
  { id: "valuation", label: "Valuation understanding", strong: "Right basis (EV vs equity vs stake) and method for the sector", weak: "Mixes bases or uses the wrong multiple" },
  { id: "risk", label: "Risk", strong: "Names a specific, testable risk and a falsifier", weak: "Generic 'integration risk'" },
];

interface AutopsyShape {
  asAnnounced?: { whatBuyerIsBuying?: string; risksAtAnnouncement?: string[]; falsifiers?: string[]; priceAndStructure?: string };
  analysis?: { risks?: string[]; falsifiers?: string[]; alternatives?: string[] };
}

function dealOutline(prompt: string, d: DealDetail): Array<{ text: string; ev?: string[] }> {
  const head = d.headline ? headlineText(d.headline) : null;
  const a = (d.autopsy ?? null) as AutopsyShape | null;
  const terms = d.terms.slice(0, 3).map((t) => ({ text: `${t.label}: ${t.amount !== null ? asReported(t.amount, t.currency, t.unit) : (t.text ?? "")} (${t.kind}, as of ${t.asOf})`, ev: t.ev }));
  const situation = { text: `${d.acquirer.name} → ${d.target.name}. Announced ${dateLabel(d.announced)}; status ${DEAL_STATUS_LABEL[d.status]} as of ${d.statusAsOf}.${head ? ` Headline ${head.value} (${head.basis}).` : ""}`, ev: [...d.announced.ev, ...d.statusEv] };
  const why = d.rationale.slice(0, 2).map((r) => ({ text: `Stated rationale: ${r.text}`, ev: r.ev }));
  switch (prompt) {
    case "why-buyer":
      return [situation, ...why, ...(a?.asAnnounced?.whatBuyerIsBuying ? [{ text: `What the buyer is buying (analysis): ${a.asAnnounced.whatBuyerIsBuying}` }] : []), ...(d.sectorContext ? [{ text: `Sector context (analysis): ${d.sectorContext}` }] : [])];
    case "valued-financed":
      return [situation, ...terms, { text: `Consideration: ${d.payment.text}`, ev: d.payment.ev }, ...(d.financing ? [{ text: `Financing: ${d.financing.text}`, ev: d.financing.ev }] : [{ text: "Financing: not disclosed in the archive — say so rather than guessing." }])];
    case "argument-against": {
      const risks = [...(a?.asAnnounced?.risksAtAnnouncement ?? []), ...(a?.analysis?.risks ?? [])].slice(0, 3);
      const fals = [...(a?.asAnnounced?.falsifiers ?? []), ...(a?.analysis?.falsifiers ?? [])].slice(0, 2);
      return [situation, ...(risks.length ? risks.map((r) => ({ text: `Risk (analysis): ${r}` })) : [{ text: "No autopsy for this deal — build the argument from price paid versus what could go wrong after closing." }]), ...fals.map((f) => ({ text: `What would prove the bear case: ${f}` }))];
    }
    default: {
      const after = d.afterDeal.slice(-1).map((x) => ({ text: `After the deal (${x.kind}): ${x.text}`, ev: x.ev }));
      return [situation, ...why, ...terms.slice(0, 2), ...after, { text: "Close with your view and one falsifiable risk." }];
    }
  }
}

function sectorOutline(prompt: string, s: CompiledSector): Array<{ text: string; ev?: string[] }> {
  if (prompt === "metric-choice") {
    return [
      { text: `How the sector makes money: ${s.howItMakesMoney.split(". ").slice(0, 2).join(". ")}.` },
      ...s.valuation.slice(0, 3).map((v) => ({ text: `${v.method} — useful when: ${v.whenUseful} Misleading when: ${v.whenMisleading}` })),
      { text: `Metrics to name: ${s.metrics.slice(0, 5).map((m) => m.name).join(", ")}.` },
    ];
  }
  const changes = [...s.whatChanged].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  return [
    { text: `Where value accrues: ${s.valueAccrual.split(". ")[0]}.` },
    ...changes.map((w) => ({ text: `${w.date} (${w.stage}): ${w.title}`, ev: w.ev })),
    { text: `Deal motives: ${s.mnaMotives.slice(0, 2).join(" ")}` },
    { text: "Close with what you are watching next and what would change your view." },
  ];
}

function useTimer() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  return { seconds, running, start: () => setRunning(true), pause: () => setRunning(false), reset: () => (setRunning(false), setSeconds(0)) };
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function InterviewTab() {
  const { notify } = useToast();
  const { confirm, element } = useConfirm();
  const [promptId, setPromptId] = useState(PROMPTS[0]?.id ?? "walk-deal");
  const prompt = PROMPTS.find((p) => p.id === promptId) ?? (PROMPTS[0] as (typeof PROMPTS)[number]);
  const deals = useQuery<Page<DealSummary>>("/api/finance/deals?pageSize=100&sort=announced&dir=desc");
  const memory = useQuery<{ items: Array<{ subjectType: string; subjectId: string }> }>("/api/finance/memory", { scope: "private" });
  const [dealId, setDealId] = useState<string>("");
  const [sectorSlug, setSectorSlug] = useState<string>("fig");
  const memoryDealIds = new Set((memory.data?.items ?? []).filter((m) => m.subjectType === "deal").map((m) => m.subjectId));
  const dealOptions = [...(deals.data?.items ?? [])].sort((a, b) => Number(memoryDealIds.has(b.id)) - Number(memoryDealIds.has(a.id)));
  const subjectId = prompt.subject === "deal" ? dealId || (dealOptions[0]?.id ?? "") : sectorSlug;
  const dealQ = useQuery<DealDetail>(prompt.subject === "deal" && subjectId ? `/api/finance/deals/${encodeURIComponent(subjectId)}` : null);
  const sectorQ = useQuery<{ sector: CompiledSector; evidence: Record<string, never> }>(prompt.subject === "sector" ? `/api/finance/sectors/${sectorSlug}` : null);
  useRegisterEvidence(dealQ.data?.evidence);
  useRegisterEvidence(sectorQ.data?.evidence);
  const history = useQuery<{ items: Array<{ id: string; promptId: string; subject: { type: string; id: string } | null; response: string; durationSec: number; selfRubric: Record<string, number>; reflection: string; createdAt: string }> }>("/api/finance/interview", { scope: "private" });

  const timer = useTimer();
  const [response, setResponse] = useState("");
  const [showOutline, setShowOutline] = useState(false);
  const [rubric, setRubric] = useState<Record<string, number>>({});
  const [reflection, setReflection] = useState("");
  const [saving, setSaving] = useState(false);
  const keyRef = useRef(newIdempotencyKey());

  const outline = useMemo(() => {
    if (prompt.subject === "deal" && dealQ.data) return dealOutline(prompt.id, dealQ.data);
    if (prompt.subject === "sector" && sectorQ.data) return sectorOutline(prompt.id, sectorQ.data.sector);
    return [];
  }, [prompt, dealQ.data, sectorQ.data]);

  const resetAttempt = () => {
    timer.reset();
    setResponse("");
    setShowOutline(false);
    setRubric({});
    setReflection("");
    keyRef.current = newIdempotencyKey();
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiSend("POST", "/api/finance/interview", { promptId: prompt.id, subject: subjectId ? { type: prompt.subject, id: subjectId } : null, response, durationSec: timer.seconds, selfRubric: rubric, reflection }, { idempotencyKey: keyRef.current });
      invalidate("/api/finance/interview");
      notify("Attempt saved to your account.", "success");
      resetAttempt();
    } catch (e) {
      notify(`Save failed: ${errorMessage(e)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const removeAttempt = async (id: string) => {
    if (!(await confirm({ title: "Delete this attempt?", message: "The typed response and self-review will be removed.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await apiSend("DELETE", `/api/finance/interview/${id}`);
      invalidate("/api/finance/interview");
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  };

  const score = Object.values(rubric).reduce((s, x) => s + x, 0);

  return (
    <div className="mf-interview-layout">
      {element}
      <div className="mf-stack">
        <div className="mf-row mf-wrap">
          <label className="mf-field">
            <span>Question</span>
            <select
              className="mf-select"
              value={promptId}
              onChange={(e) => {
                setPromptId(e.target.value);
                resetAttempt();
              }}
            >
              {PROMPTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.text}
                </option>
              ))}
            </select>
          </label>
          {prompt.subject === "deal" ? (
            <label className="mf-field">
              <span>Deal (Deal Memory first)</span>
              <select className="mf-select" value={subjectId} onChange={(e) => setDealId(e.target.value)}>
                {dealOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {memoryDealIds.has(d.id) ? "★ " : ""}
                    {d.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="mf-field">
              <span>Sector</span>
              <select className="mf-select" value={sectorSlug} onChange={(e) => setSectorSlug(e.target.value)}>
                {SECTOR_SLUGS.map((s) => (
                  <option key={s} value={s}>
                    {SECTOR_NAMES[s]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <section className="mf-review-card" aria-labelledby="iv-q">
          <h2 id="iv-q" className="mf-review-prompt">
            “{prompt.text}”
          </h2>
          <div className="mf-row spread">
            <div className="mf-row" role="group" aria-label="Timer">
              <span className={`mf-timer mf-num${timer.seconds > prompt.target ? " over" : ""}`} aria-live="off">
                <Icon name="timer" size={16} /> {mmss(timer.seconds)} / {mmss(prompt.target)}
              </span>
              {timer.running ? (
                <button type="button" className="mf-btn small" onClick={timer.pause}>
                  <Icon name="pause" size={14} /> Pause
                </button>
              ) : (
                <button type="button" className="mf-btn small" onClick={timer.start}>
                  <Icon name="play" size={14} /> {timer.seconds ? "Resume" : "Start"}
                </button>
              )}
              <button type="button" className="mf-btn small ghost" onClick={timer.reset}>
                Reset
              </button>
            </div>
            <span className="mf-xsmall mf-muted">Typed answers only; nothing is sent to an AI model.</span>
          </div>
          <label className="mf-field">
            <span>Your answer</span>
            <textarea className="mf-input mf-textarea" rows={9} value={response} onChange={(e) => setResponse(e.target.value)} onFocus={() => !timer.running && timer.seconds === 0 && timer.start()} />
          </label>
          <button type="button" className="mf-btn small" onClick={() => setShowOutline((s) => !s)} aria-expanded={showOutline}>
            {showOutline ? "Hide answer outline" : "Show answer outline"}
          </button>
          {showOutline ? (
            <div className="mf-answer-box">
              <p className="mf-xsmall mf-muted">Outline built from archive facts (with evidence) and labelled analysis. Use it to check your answer, not to memorise.</p>
              {outline.length ? (
                <ol className="mf-list numbered">
                  {outline.map((o, i) => (
                    <li key={i} className="mf-small">
                      {o.text} {o.ev?.length ? <Ev ids={o.ev} label={o.text.slice(0, 60)} /> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <Skeleton lines={3} />
              )}
              {prompt.subject === "deal" && subjectId ? (
                <p className="mf-xsmall">
                  <Link to={`/finance/deals/${subjectId}`}>Open the deal record</Link>
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
        <section className="mf-panel">
          <div className="mf-panel-head">
            <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
              Self-review rubric (0–3 each)
            </h2>
            <span className="mf-small mf-num">
              {score} / {RUBRIC.length * 3}
            </span>
          </div>
          <div className="mf-panel-body mf-stack">
            {RUBRIC.map((r) => (
              <fieldset key={r.id} className="mf-rubric-row">
                <legend>
                  <strong>{r.label}</strong> <span className="mf-xsmall mf-muted">Strong: {r.strong}. Weak: {r.weak}.</span>
                </legend>
                <div className="mf-row">
                  {[0, 1, 2, 3].map((n) => (
                    <label key={n} className="mf-chip">
                      <input type="radio" name={`rub-${r.id}`} checked={rubric[r.id] === n} onChange={() => setRubric((x) => ({ ...x, [r.id]: n }))} /> {n}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <label className="mf-field">
              <span>Reflection: what would you say differently?</span>
              <textarea className="mf-input mf-textarea" rows={3} value={reflection} onChange={(e) => setReflection(e.target.value)} />
            </label>
            <div className="mf-row">
              <button type="button" className="mf-btn primary" disabled={saving || !response.trim()} onClick={() => void save()}>
                Save attempt
              </button>
              <button type="button" className="mf-btn ghost" onClick={resetAttempt}>
                Start over
              </button>
            </div>
            <p className="mf-xsmall mf-muted">Self-assessment, not a hiring prediction.</p>
          </div>
        </section>
      </div>
      <aside className="mf-panel">
        <div className="mf-panel-head">
          <h2 className="mf-panel-title" style={{ fontSize: 16 }}>
            Past attempts
          </h2>
        </div>
        <div className="mf-panel-body">
          {!history.data ? (
            <Skeleton lines={4} />
          ) : history.data.items.length === 0 ? (
            <EmptyState title="No attempts yet">Saved attempts appear here with their self-review scores.</EmptyState>
          ) : (
            <ul className="mf-list">
              {history.data.items.map((h) => (
                <li key={h.id}>
                  <div className="mf-row spread">
                    <strong className="mf-small">{PROMPTS.find((p) => p.id === h.promptId)?.text ?? h.promptId}</strong>
                    <button type="button" className="mf-btn small ghost icon" aria-label="Delete attempt" onClick={() => void removeAttempt(h.id)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                  <p className="mf-xsmall mf-muted">
                    {h.createdAt.slice(0, 10)} · {h.subject ? `${h.subject.type}: ${h.subject.id}` : "no subject"} · {mmss(h.durationSec)} · score {Object.values(h.selfRubric).reduce((s, x) => s + x, 0)}/{RUBRIC.length * 3}
                  </p>
                  <details>
                    <summary className="mf-xsmall">Show answer</summary>
                    <p className="mf-small" style={{ whiteSpace: "pre-wrap" }}>
                      {h.response}
                    </p>
                    {h.reflection ? <p className="mf-xsmall mf-muted">Reflection: {h.reflection}</p> : null}
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
