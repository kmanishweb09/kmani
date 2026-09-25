/** Interview practice prompts and the self-review rubric (shared by the UI and optional AI feedback). */

export type InterviewSubjectKind = "deal" | "sector";

export const INTERVIEW_PROMPTS: Array<{ id: string; text: string; subject: InterviewSubjectKind; target: number }> = [
  { id: "walk-deal", text: "Walk me through a deal you followed.", subject: "deal", target: 120 },
  { id: "why-buyer", text: "Why this buyer and this target?", subject: "deal", target: 90 },
  { id: "valued-financed", text: "How was it valued and financed?", subject: "deal", target: 90 },
  { id: "argument-against", text: "What is the strongest argument against the transaction?", subject: "deal", target: 90 },
  { id: "sector-update", text: "What is happening in a sector you follow?", subject: "sector", target: 120 },
  { id: "metric-choice", text: "Which metric would you use here, and which would mislead you?", subject: "sector", target: 90 },
];

export const INTERVIEW_RUBRIC = [
  { id: "accuracy", label: "Factual accuracy", strong: "Names, dates, value and basis correct", weak: "Wrong or unsourced numbers" },
  { id: "structure", label: "Structure", strong: "Clear order: situation → rationale → price → risk → view", weak: "Jumps around" },
  { id: "evidence", label: "Evidence", strong: "Cites the filing/announcement and dates", weak: "Opinion without support" },
  { id: "valuation", label: "Valuation understanding", strong: "Right basis (EV vs equity vs stake) and method for the sector", weak: "Mixes bases or uses the wrong multiple" },
  { id: "risk", label: "Risk", strong: "Names a specific, testable risk and a falsifier", weak: "Generic 'integration risk'" },
] as const;
