import { describe, expect, it } from "vitest";
import { addDays, localDate } from "../../shared/dates";
import { isDue, LADDER_DAYS, scheduleReview } from "../../shared/review/scheduler";

describe("spaced review ladder (1, 3, 7, 14, 30, 60)", () => {
  const today = "2026-09-25";
  it("new card: Good → stage 0 due in 1 day; Easy → stage 1 due in 3 days", () => {
    expect(scheduleReview({ stage: -1, dueDate: today }, "good", today)).toMatchObject({ stageAfter: 0, dueAfter: "2026-09-26", intervalDays: 1 });
    expect(scheduleReview({ stage: -1, dueDate: today }, "easy", today)).toMatchObject({ stageAfter: 1, dueAfter: "2026-09-28", intervalDays: 3 });
  });
  it("Good advances one stage, Easy two stages", () => {
    expect(scheduleReview({ stage: 1, dueDate: today }, "good", today)).toMatchObject({ stageAfter: 2, intervalDays: 7 });
    expect(scheduleReview({ stage: 1, dueDate: today }, "easy", today)).toMatchObject({ stageAfter: 3, intervalDays: 14 });
  });
  it("Hard stays at the stage with half the interval (rounded up, minimum 1)", () => {
    expect(scheduleReview({ stage: 3, dueDate: today }, "hard", today)).toMatchObject({ stageAfter: 3, intervalDays: 7 });
    expect(scheduleReview({ stage: 0, dueDate: today }, "hard", today)).toMatchObject({ stageAfter: 0, intervalDays: 1 });
    expect(scheduleReview({ stage: 1, dueDate: today }, "hard", today)).toMatchObject({ stageAfter: 1, intervalDays: 2 });
    expect(scheduleReview({ stage: -1, dueDate: today }, "hard", today)).toMatchObject({ stageAfter: 0, intervalDays: 1 });
  });
  it("Again resets to a one-day review from any stage", () => {
    expect(scheduleReview({ stage: 5, dueDate: today }, "again", today)).toMatchObject({ stageAfter: 0, dueAfter: "2026-09-26" });
  });
  it("caps at stage 5 / 60 days", () => {
    expect(scheduleReview({ stage: 5, dueDate: today }, "good", today)).toMatchObject({ stageAfter: 5, intervalDays: 60 });
    expect(scheduleReview({ stage: 4, dueDate: today }, "easy", today)).toMatchObject({ stageAfter: 5, intervalDays: 60 });
  });
  it("intervals count from the review date, including early reviews", () => {
    const r = scheduleReview({ stage: 2, dueDate: "2026-10-10" }, "good", today);
    expect(r.dueAfter).toBe(addDays(today, 14));
    expect(r.dueBefore).toBe("2026-10-10");
  });
  it("rejects invalid stages", () => {
    expect(() => scheduleReview({ stage: 9, dueDate: today }, "good", today)).toThrow();
  });
  it("uses the ladder constants", () => {
    expect([...LADDER_DAYS]).toEqual([1, 3, 7, 14, 30, 60]);
  });
  it("due comparison uses local calendar dates", () => {
    expect(isDue({ stage: 0, dueDate: "2026-09-25" }, "2026-09-25")).toBe(true);
    expect(isDue({ stage: 0, dueDate: "2026-09-26" }, "2026-09-25")).toBe(false);
  });
});

describe("timezone-aware local dates", () => {
  it("19:00 UTC on 25 Sep is already 26 Sep in Asia/Kolkata", () => {
    const now = new Date("2026-09-25T19:00:00Z");
    expect(localDate(now, "Asia/Kolkata")).toBe("2026-09-26");
    expect(localDate(now, "UTC")).toBe("2026-09-25");
    expect(localDate(now, "America/New_York")).toBe("2026-09-25");
  });
  it("calendar arithmetic crosses month and year boundaries", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
