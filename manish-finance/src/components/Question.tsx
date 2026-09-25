import { useId, useState } from "react";
import type { Question } from "../../shared/schemas/research";
import { apiSend } from "../app/api";
import { invalidate } from "../app/query";
import { useSession } from "../app/session";
import { Icon } from "./Icon";

/**
 * Practice question. Objective questions are checked deterministically; open questions show an
 * outline rubric for self-review (never graded as objectively correct). Progress is recorded for
 * the owner only when they answer.
 */
export function QuestionCard({ q, index }: { q: Question; index?: number }) {
  const id = useId();
  const { isOwner } = useSession();
  const [choice, setChoice] = useState<number | null>(null);
  const [numeric, setNumeric] = useState("");
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  let correct: boolean | null = null;
  if (submitted && q.kind === "mcq") correct = choice === q.answerIndex;
  if (submitted && q.kind === "numeric") {
    const v = Number(numeric.replace(/,/g, ""));
    correct = Number.isFinite(v) && q.answerValue !== null && q.answerValue !== undefined ? Math.abs(v - q.answerValue) <= (q.tolerance ?? 0.01) : false;
  }
  const submit = () => {
    setSubmitted(true);
    if (isOwner) {
      const answer = q.kind === "mcq" ? String(choice) : q.kind === "numeric" ? numeric : text.slice(0, 4000);
      const isCorrect = q.kind === "mcq" ? choice === q.answerIndex : q.kind === "numeric" ? Math.abs(Number(numeric) - (q.answerValue ?? Number.NaN)) <= (q.tolerance ?? 0.01) : null;
      void apiSend("POST", "/api/finance/progress", { itemType: "question", itemId: q.id, status: "answered", answer, correct: isCorrect })
        .then(() => invalidate("/api/finance/progress"))
        .catch(() => undefined);
    }
  };
  const canSubmit = q.kind === "mcq" ? choice !== null : q.kind === "numeric" ? numeric.trim() !== "" : text.trim().length > 0;
  return (
    <article className="mf-panel" aria-labelledby={`${id}-p`}>
      <div className="mf-panel-body mf-stack tight">
        <div className="mf-row spread">
          <span className="mf-eyebrow">
            {index !== undefined ? `Question ${index + 1} · ` : ""}
            {q.kind === "mcq" ? "Multiple choice" : q.kind === "numeric" ? "Calculation" : "Open response"} · {q.difficulty}
          </span>
        </div>
        <p id={`${id}-p`} style={{ fontWeight: 560 }}>
          {q.prompt}
        </p>
        {q.kind === "mcq" && q.options ? (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={submitted}>
            <legend className="mf-sr-only">Choose one answer</legend>
            <div className="mf-stack tight">
              {q.options.map((o, i) => {
                const state = submitted ? (i === q.answerIndex ? "positive" : i === choice ? "negative" : "") : "";
                return (
                  <label key={o} className="mf-option" style={state ? { border: `1px solid var(--mf-${state})` } : { border: "1px solid var(--mf-border)" }}>
                    <input type="radio" name={`${id}-q`} checked={choice === i} onChange={() => setChoice(i)} />
                    <span>{o}</span>
                    {submitted && i === q.answerIndex ? <Icon name="check" size={15} label="Correct answer" /> : null}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        {q.kind === "numeric" ? (
          <div className="mf-field" style={{ maxWidth: 260 }}>
            <label htmlFor={`${id}-n`}>Your answer{q.answerUnit ? ` (${q.answerUnit})` : ""}</label>
            <input id={`${id}-n`} className="mf-input num" inputMode="decimal" value={numeric} disabled={submitted} onChange={(e) => setNumeric(e.target.value)} />
          </div>
        ) : null}
        {q.kind === "open" ? (
          <div className="mf-field">
            <label htmlFor={`${id}-t`}>Your answer</label>
            <textarea id={`${id}-t`} className="mf-textarea" value={text} disabled={submitted} onChange={(e) => setText(e.target.value)} />
          </div>
        ) : null}
        {!submitted ? (
          <div className="mf-row">
            <button type="button" className="mf-btn small" disabled={!canSubmit} onClick={submit}>
              {q.kind === "open" ? "Compare with outline" : "Check answer"}
            </button>
            <button type="button" className="mf-btn small ghost" onClick={() => setSubmitted(true)}>
              Show answer
            </button>
          </div>
        ) : (
          <div className={`mf-callout ${correct === false ? "negative" : correct ? "" : "analysis"}`} role="status">
            {correct === true ? <strong>Correct. </strong> : correct === false ? <strong>Not quite. </strong> : null}
            {q.kind === "numeric" && q.answerValue !== null && q.answerValue !== undefined ? (
              <span>
                Answer: <span className="mf-mono">{q.answerValue}</span> {q.answerUnit ?? ""}.{" "}
              </span>
            ) : null}
            {q.explanation}
            {q.rubric?.length ? (
              <div style={{ marginTop: 8 }}>
                <strong>Self-review outline:</strong>
                <ul className="mf-bullets" style={{ paddingLeft: 18, marginTop: 4 }}>
                  {q.rubric.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
}
