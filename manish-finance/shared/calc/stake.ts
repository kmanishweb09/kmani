import { type CalcIssue, type CalcResult, fail, ok, requireNumbers } from "./result";

/**
 * Value implied by the price paid for a stake.
 *
 *   secondary (existing shares bought): implied 100% equity value = consideration ÷ stake
 *   primary (new shares issued):        post-money = consideration ÷ stake; pre-money = post-money − consideration
 *
 * Proportional extrapolation assumes the stake carries no special rights, control premium, earn-out
 * or put/call terms. A stake must be above 0% and at most 100%, and the consideration positive.
 */

export interface StakeValueInput {
  consideration: number | null;
  /** Percentage of the company's equity acquired (0 < stake ≤ 100). */
  stakePct: number | null;
  structure: "secondary" | "primary";
}

export interface StakeValueOutput {
  impliedEquityValue: number;
  basis: "implied_100pct" | "post_money";
  preMoney: number | null;
}

export function impliedValueFromStake(input: StakeValueInput): CalcResult<StakeValueOutput> {
  const errors: CalcIssue[] = requireNumbers({ consideration: input.consideration, stakePct: input.stakePct });
  if (errors.length) return fail(errors);
  const consideration = input.consideration as number;
  const stake = input.stakePct as number;
  if (consideration <= 0) errors.push({ code: "INVALID_CONSIDERATION", field: "consideration", message: "Consideration must be a positive amount." });
  if (stake <= 0 || stake > 100) errors.push({ code: "INVALID_STAKE", field: "stakePct", message: "Stake acquired must be above 0% and at most 100%." });
  if (input.structure === "primary" && stake >= 100) {
    errors.push({ code: "INVALID_PRIMARY_STAKE", field: "stakePct", message: "New shares cannot give the investor 100% of the post-money equity; existing holders keep a share." });
  }
  if (errors.length) return fail(errors);
  const warnings: CalcIssue[] = [];
  if (stake >= 50) {
    warnings.push({ code: "CONTROL_STAKE", message: "At 50% or more this is a control stake: the price may include a control premium, so the implied value is not a minority valuation." });
  }
  if (stake < 1) warnings.push({ code: "SMALL_STAKE", message: "A stake below 1% magnifies rounding in the implied value." });
  const implied = consideration / (stake / 100);
  if (!Number.isFinite(implied)) return fail({ code: "NOT_FINITE", message: "The implied value is not a finite number." });
  return ok(
    input.structure === "primary"
      ? { impliedEquityValue: implied, basis: "post_money", preMoney: implied - consideration }
      : { impliedEquityValue: implied, basis: "implied_100pct", preMoney: null },
    warnings,
  );
}
