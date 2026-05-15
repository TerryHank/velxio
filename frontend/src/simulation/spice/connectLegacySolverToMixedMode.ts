/**
 * Bridges the legacy electrical solver's output into the MixedModeScheduler's
 * voltage cache.  Phase 1b continued, step 4.
 *
 * Why:
 *   The Phase 1b skeleton introduced `SpiceResolvedPinResolver`, which lets a
 *   component pin downstream of a BJT/MOSFET/op-amp consume voltages from a
 *   SpiceVoltageSource (the scheduler).  Until step 4, nothing wrote to that
 *   cache, so SPICE-resolved components saw FLOATING forever.
 *
 *   The cleanest first wiring is to reuse the existing solver: every time
 *   the legacy `CircuitScheduler` produces fresh `nodeVoltages`, walk the
 *   pinNetMap and republish each (component, pin) voltage into the mixed-mode
 *   scheduler.  The legacy ADC injection path is unchanged.
 *
 * What this does NOT do:
 *   - It does not call `scheduler.loadCircuit` or `scheduler.onMcuPinChange`
 *     (the WASM-driven path).  Those wait until we're ready to replace the
 *     legacy CircuitScheduler entirely.
 *   - It does not start the WASM engine.  `getMixedModeScheduler()` is used
 *     purely as a fan-out for voltage events.
 *
 * Lifecycle:
 *   Call from `EditorPage` alongside `wireElectricalSolver()`.  Returns an
 *   unsubscribe function for cleanup on unmount.
 */
import { useElectricalStore } from '../../store/useElectricalStore';
import { getMixedModeScheduler } from './MixedModeScheduler';

/** Stripped-down store shape so this module can be unit-tested with a fake. */
export interface ElectricalStoreLike {
  getState(): {
    nodeVoltages: Record<string, number>;
    pinNetMap: Map<string, string>;
  };
  subscribe(
    listener: (
      state: { nodeVoltages: Record<string, number>; pinNetMap: Map<string, string> },
      prev: { nodeVoltages: Record<string, number>; pinNetMap: Map<string, string> },
    ) => void,
  ): () => void;
}

interface SchedulerLike {
  publishVoltage(componentId: string, pinName: string, voltage: number): void;
}

function publishOnce(store: ElectricalStoreLike, scheduler: SchedulerLike): void {
  const { nodeVoltages, pinNetMap } = store.getState();
  for (const [key, net] of pinNetMap) {
    const idx = key.indexOf(':');
    if (idx < 0) continue;
    const componentId = key.slice(0, idx);
    const pinName = key.slice(idx + 1);
    if (net === '0') {
      scheduler.publishVoltage(componentId, pinName, 0);
      continue;
    }
    const v = nodeVoltages[net];
    if (typeof v === 'number' && Number.isFinite(v)) {
      scheduler.publishVoltage(componentId, pinName, v);
    }
  }
}

/**
 * Default entry point — subscribes against the live useElectricalStore and
 * the singleton MixedModeScheduler.  Returns an unsubscribe handle.
 */
export function connectLegacySolverToMixedMode(): () => void {
  return connectLegacySolverToMixedModeFor(
    useElectricalStore as unknown as ElectricalStoreLike,
    getMixedModeScheduler(),
  );
}

/**
 * Lower-level form for tests — accepts the store and scheduler explicitly.
 */
export function connectLegacySolverToMixedModeFor(
  store: ElectricalStoreLike,
  scheduler: SchedulerLike,
): () => void {
  publishOnce(store, scheduler);
  return store.subscribe((state, prev) => {
    if (state.nodeVoltages !== prev.nodeVoltages || state.pinNetMap !== prev.pinNetMap) {
      publishOnce(store, scheduler);
    }
  });
}
