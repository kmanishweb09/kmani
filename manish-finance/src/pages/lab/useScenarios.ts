import { useCallback, useEffect, useMemo, useState } from "react";
import { readLocal, writeLocal } from "../../app/storage";

/**
 * Scenario state for a Lab model. Scenarios hold only assumptions; reported inputs live outside and
 * never change when a scenario is edited. Drafts are kept on this device until saved to the account.
 */

export interface Scenario<T> {
  name: string;
  assumptions: T;
}

export interface ScenarioState<T> {
  scenarios: Array<Scenario<T>>;
  active: number;
}

export const MAX_SCENARIOS = 4;

function base<T>(make: () => T): ScenarioState<T> {
  return { scenarios: [{ name: "Base case", assumptions: make() }], active: 0 };
}

export function useScenarios<T>(storageKey: string, make: () => T) {
  const [state, setState] = useState<ScenarioState<T>>(() => {
    const saved = readLocal<ScenarioState<T> | null>(storageKey, null);
    if (saved && Array.isArray(saved.scenarios) && saved.scenarios.length) return { ...saved, active: Math.min(saved.active, saved.scenarios.length - 1) };
    return base(make);
  });

  useEffect(() => {
    writeLocal(storageKey, state);
  }, [storageKey, state]);

  const current = (state.scenarios[state.active] ?? state.scenarios[0]) as Scenario<T>;
  const baseCase = state.scenarios[0] as Scenario<T>;

  const update = useCallback((fn: (a: T) => T) => {
    setState((s) => ({ ...s, scenarios: s.scenarios.map((sc, i) => (i === s.active ? { ...sc, assumptions: fn(sc.assumptions) } : sc)) }));
  }, []);

  const api = useMemo(
    () => ({
      select: (i: number) => setState((s) => ({ ...s, active: Math.max(0, Math.min(i, s.scenarios.length - 1)) })),
      reset: () => setState(base(make)),
      duplicate: () =>
        setState((s) => {
          if (s.scenarios.length >= MAX_SCENARIOS) return s;
          const src = s.scenarios[s.active] as Scenario<T>;
          const copy: Scenario<T> = { name: `Scenario ${s.scenarios.length + 1}`, assumptions: structuredClone(src.assumptions) };
          return { scenarios: [...s.scenarios, copy], active: s.scenarios.length };
        }),
      rename: (i: number, name: string) => setState((s) => ({ ...s, scenarios: s.scenarios.map((sc, j) => (j === i ? { ...sc, name: name.slice(0, 80) || sc.name } : sc)) })),
      remove: (i: number) =>
        setState((s) => {
          if (i === 0 || s.scenarios.length <= 1) return s;
          const scenarios = s.scenarios.filter((_, j) => j !== i);
          return { scenarios, active: Math.min(s.active, scenarios.length - 1) };
        }),
      replaceAll: (scenarios: Array<Scenario<T>>) => setState({ scenarios: scenarios.length ? scenarios.slice(0, MAX_SCENARIOS) : base(make).scenarios, active: 0 }),
    }),
    [make],
  );

  return { state, current, baseCase, update, ...api };
}

export type ScenarioApi<T> = ReturnType<typeof useScenarios<T>>;
