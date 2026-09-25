import { addDays } from "../dates";

/**
 * Spaced-review scheduler (self-assessed recall), version 1.
 *
 * Interval ladder (days): 1, 3, 7, 14, 30, 60 — stage index 0..5. A new card has stage −1 and is due
 * on the day it is created.
 *
 *   Again → stage 0, due in 1 day (reset)
 *   Hard  → stay at the current stage (a new card moves to stage 0), due in ceil(interval / 2) days (minimum 1)
 *   Good  → advance one stage (capped at stage 5), due in that stage's interval
 *   Easy  → advance two stages (capped at stage 5), due in that stage's interval
 *
 * Intervals are counted from the review date (the user's local calendar date in their configured
 * timezone, computed from the server clock), not from the previous due date. Early reviews are
 * allowed and scheduled the same way. The maximum interval is 60 days.
 */

export const SCHEDULER_VERSION = "ladder-v1";
export const LADDER_DAYS = [1, 3, 7, 14, 30, 60] as const;
export const MAX_STAGE = LADDER_DAYS.length - 1;

export type Rating = "again" | "hard" | "good" | "easy";

export interface CardSchedule {
  /** −1 for a new card, else 0..5. */
  stage: number;
  dueDate: string;
}

export interface ReviewOutcome {
  stageBefore: number;
  stageAfter: number;
  dueBefore: string;
  dueAfter: string;
  intervalDays: number;
  reviewDate: string;
  rating: Rating;
  schedulerVersion: string;
}

export function intervalForStage(stage: number): number {
  const s = Math.max(0, Math.min(MAX_STAGE, stage));
  return LADDER_DAYS[s] as number;
}

export function scheduleReview(card: CardSchedule, rating: Rating, reviewDate: string): ReviewOutcome {
  if (!Number.isInteger(card.stage) || card.stage < -1 || card.stage > MAX_STAGE) {
    throw new Error(`Invalid stage ${card.stage}`);
  }
  let stageAfter: number;
  let interval: number;
  switch (rating) {
    case "again":
      stageAfter = 0;
      interval = intervalForStage(0);
      break;
    case "hard":
      stageAfter = Math.max(card.stage, 0);
      interval = Math.max(1, Math.ceil(intervalForStage(stageAfter) / 2));
      break;
    case "good":
      stageAfter = Math.min(card.stage + 1, MAX_STAGE);
      interval = intervalForStage(stageAfter);
      break;
    case "easy":
      stageAfter = Math.min(card.stage + 2, MAX_STAGE);
      interval = intervalForStage(stageAfter);
      break;
    default:
      throw new Error(`Unknown rating ${String(rating)}`);
  }
  return {
    stageBefore: card.stage,
    stageAfter,
    dueBefore: card.dueDate,
    dueAfter: addDays(reviewDate, interval),
    intervalDays: interval,
    reviewDate,
    rating,
    schedulerVersion: SCHEDULER_VERSION,
  };
}

export function isDue(card: CardSchedule, today: string): boolean {
  return card.dueDate <= today;
}

export const RATINGS: ReadonlyArray<{ id: Rating; label: string; help: string }> = [
  { id: "again", label: "Again", help: "Could not recall. Review tomorrow." },
  { id: "hard", label: "Hard", help: "Recalled with difficulty. Same stage, shorter repeat." },
  { id: "good", label: "Good", help: "Recalled correctly. Next stage." },
  { id: "easy", label: "Easy", help: "Recalled instantly. Skip a stage." },
];
