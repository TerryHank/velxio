/**
 * Phase 1b continued, step 4 — tests for connectLegacySolverToMixedMode.
 *
 * Verifies that voltages produced by the legacy CircuitScheduler reach
 * the MixedModeScheduler's voltage cache, so SpiceResolvedPinResolver
 * subscribers actually see live voltages.
 *
 * Uses fake store + fake scheduler — no Zustand, no WASM.  Real
 * EditorPage wiring is verified by manual smoke testing.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  connectLegacySolverToMixedModeFor,
  type ElectricalStoreLike,
} from '../simulation/spice/connectLegacySolverToMixedMode';

function makeStore(initial: {
  nodeVoltages: Record<string, number>;
  pinNetMap: Map<string, string>;
}): {
  store: ElectricalStoreLike;
  set(
    next: Partial<{ nodeVoltages: Record<string, number>; pinNetMap: Map<string, string> }>,
  ): void;
} {
  let state = { ...initial };
  const listeners: Array<
    (
      state: { nodeVoltages: Record<string, number>; pinNetMap: Map<string, string> },
      prev: { nodeVoltages: Record<string, number>; pinNetMap: Map<string, string> },
    ) => void
  > = [];
  return {
    store: {
      getState() {
        return state;
      },
      subscribe(listener) {
        listeners.push(listener);
        return () => {
          const i = listeners.indexOf(listener);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
    },
    set(next) {
      const prev = state;
      state = { ...state, ...next };
      for (const l of listeners) l(state, prev);
    },
  };
}

function makeScheduler(): {
  publishVoltage: (id: string, pin: string, v: number) => void;
  calls: Array<{ id: string; pin: string; v: number }>;
} {
  const calls: Array<{ id: string; pin: string; v: number }> = [];
  return {
    calls,
    publishVoltage(id, pin, v) {
      calls.push({ id, pin, v });
    },
  };
}

describe('connectLegacySolverToMixedMode', () => {
  it('publishes the initial voltages immediately on subscribe', () => {
    const { store } = makeStore({
      nodeVoltages: { net_drain: 4.2, net_gate: 0.1 },
      pinNetMap: new Map([
        ['q1:D', 'net_drain'],
        ['q1:G', 'net_gate'],
      ]),
    });
    const sched = makeScheduler();
    const cancel = connectLegacySolverToMixedModeFor(store, sched);

    expect(sched.calls).toEqual(
      expect.arrayContaining([
        { id: 'q1', pin: 'D', v: 4.2 },
        { id: 'q1', pin: 'G', v: 0.1 },
      ]),
    );
    cancel();
  });

  it('skips nets that have no voltage in the solver result', () => {
    const { store } = makeStore({
      nodeVoltages: { net_drain: 3.3 },
      pinNetMap: new Map([
        ['q1:D', 'net_drain'],
        ['q1:G', 'net_missing'],
      ]),
    });
    const sched = makeScheduler();
    connectLegacySolverToMixedModeFor(store, sched);
    expect(sched.calls).toEqual([{ id: 'q1', pin: 'D', v: 3.3 }]);
  });

  it('publishes 0 V for canonical ground pins regardless of nodeVoltages map', () => {
    const { store } = makeStore({
      nodeVoltages: {}, // ground is implicit — never appears in nodeVoltages
      pinNetMap: new Map([
        ['q1:S', '0'],
        ['q1:D', 'net_drain'],
      ]),
    });
    const sched = makeScheduler();
    connectLegacySolverToMixedModeFor(store, sched);
    expect(sched.calls).toEqual([{ id: 'q1', pin: 'S', v: 0 }]);
  });

  it('re-publishes when nodeVoltages changes (subsequent solves)', () => {
    const initial = makeStore({
      nodeVoltages: { net: 1.0 },
      pinNetMap: new Map([['c:p', 'net']]),
    });
    const sched = makeScheduler();
    connectLegacySolverToMixedModeFor(initial.store, sched);
    expect(sched.calls).toEqual([{ id: 'c', pin: 'p', v: 1.0 }]);

    initial.set({ nodeVoltages: { net: 2.5 } });
    expect(sched.calls).toEqual([
      { id: 'c', pin: 'p', v: 1.0 },
      { id: 'c', pin: 'p', v: 2.5 },
    ]);
  });

  it('re-publishes when pinNetMap changes (circuit rebuild)', () => {
    const initial = makeStore({
      nodeVoltages: { net_a: 1.5, net_b: 3.0 },
      pinNetMap: new Map([['c:p', 'net_a']]),
    });
    const sched = makeScheduler();
    connectLegacySolverToMixedModeFor(initial.store, sched);
    initial.set({ pinNetMap: new Map([['c:p', 'net_b']]) });
    expect(sched.calls.at(-1)).toEqual({ id: 'c', pin: 'p', v: 3.0 });
  });

  it('drops NaN / Infinity voltages silently — never publishes them', () => {
    const { store } = makeStore({
      nodeVoltages: { net_nan: Number.NaN, net_inf: Number.POSITIVE_INFINITY, net_ok: 1.2 },
      pinNetMap: new Map([
        ['c:a', 'net_nan'],
        ['c:b', 'net_inf'],
        ['c:c', 'net_ok'],
      ]),
    });
    const sched = makeScheduler();
    connectLegacySolverToMixedModeFor(store, sched);
    expect(sched.calls).toEqual([{ id: 'c', pin: 'c', v: 1.2 }]);
  });

  it('unsubscribe stops future updates', () => {
    const { store, set } = makeStore({
      nodeVoltages: { n: 0.5 },
      pinNetMap: new Map([['c:p', 'n']]),
    });
    const sched = makeScheduler();
    const cancel = connectLegacySolverToMixedModeFor(store, sched);
    cancel();
    set({ nodeVoltages: { n: 1.5 } });
    // Only the initial publish — no update after unsubscribe.
    expect(sched.calls).toHaveLength(1);
  });
});
