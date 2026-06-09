/**
 * Buzzer — metronome quality
 *
 * A real use case for the buzzer: an Arduino sketch driving it as a metronome
 * (analogWrite/Timer PWM, an accent on the down-beat). This exercises the audio
 * SCHEDULING that makes a metronome usable — and guards it against regressions.
 *
 * It drives the buzzer's PWM handler with a metronome sequence (onset → note-off
 * pairs carrying their simulated timestamps) against a CONTROLLABLE audio clock,
 * and records the resulting Web-Audio schedule (one oscillator per click). Then
 * it asserts the qualities a metronome needs:
 *   - even onset spacing (steady tempo)
 *   - one oscillator per click, no overlap, strictly monotonic
 *   - correct pitch per metric level (accent vs beat)
 *   - bursty per-frame delivery is absorbed (still even)
 *   - a tempo change re-locks immediately and cleanly
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PartSimulationRegistry } from '../simulation/parts/PartSimulationRegistry';
import '../simulation/parts/ComplexParts';

// ── Controllable audio clock + schedule recorder ─────────────────────────────
let clock = 0; // seconds; we advance it to emulate real time passing
type Ev = { kind: 'start' | 'stop'; when: number; freq?: number };
let sched: Ev[] = [];

function mockOscillator() {
  const o: any = {
    type: '',
    frequency: { value: 440, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
    onended: null,
    start: (w: number) => sched.push({ kind: 'start', when: w, freq: Math.round(o.frequency.value) }),
    stop: (w: number) => sched.push({ kind: 'stop', when: w }),
  };
  return o;
}
function mockGain() {
  return {
    gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}
class MockAudioContext {
  state = 'running';
  destination = {};
  resume = vi.fn();
  close = vi.fn();
  get currentTime() {
    return clock;
  }
  createOscillator() {
    return mockOscillator();
  }
  createGain() {
    return mockGain();
  }
}

beforeEach(() => {
  clock = 0;
  sched = [];
  vi.stubGlobal('AudioContext', MockAudioContext as unknown as typeof AudioContext);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Metronome driver ─────────────────────────────────────────────────────────
const OCR2A = 0xb3;
const TCCR2B = 0xb1;
// OCR2A value for a target frequency (CTC, prescaler 64): f = 16e6/(2*64*(OCR+1)).
// Integer division, matching the firmware's `F_CPU/(2*64*freq) - 1`.
const ocrFor = (freq: number) => Math.floor(125000 / freq) - 1;
const ACCENT = ocrFor(1500); // 82 -> 1506 Hz
const BEAT = ocrFor(1100); //   112 -> 1106 Hz

function setupBuzzer() {
  const sim: any = {
    cpu: { data: new Uint8Array(512).fill(0), cycles: 0 },
    pinManager: {
      onPinChange: vi.fn().mockReturnValue(() => {}),
    },
  };
  let pwm: ((pin: number, dc: number, timeMs?: number) => void) | null = null;
  sim.pinManager.onPwmChange = vi.fn().mockImplementation((_pin: number, cb: any) => {
    pwm = cb;
    return () => {};
  });
  const cleanup = PartSimulationRegistry.get('buzzer')!.attachEvents!(
    { addEventListener: vi.fn(), removeEventListener: vi.fn(), playing: false } as any,
    sim,
    (name: string) => (name === '1' ? 11 : null),
  );
  return { sim, cleanup, hit: (ocr: number, simMs: number, clickMs = 25) => {
    // onset: OCR set, PWM duty > 0 at simMs
    sim.cpu.data[OCR2A] = ocr;
    sim.cpu.data[TCCR2B] = 0x04; // CS22 -> prescaler 64
    clock = simMs / 1000;
    pwm!(11, ocr / 255, simMs);
    // note-off one click later
    clock = (simMs + clickMs) / 1000;
    pwm!(11, 0, simMs + clickMs);
  } };
}

// Pull the recorded notes (a start paired with its following stop).
function notes() {
  const out: { on: number; off: number; freq: number }[] = [];
  for (let i = 0; i + 1 < sched.length; i++) {
    if (sched[i].kind === 'start' && sched[i + 1].kind === 'stop') {
      out.push({ on: sched[i].when, off: sched[i + 1].when, freq: sched[i].freq! });
    }
  }
  return out;
}

describe('Buzzer — metronome quality', () => {
  it('plays an even metronome with an accent on the down-beat', () => {
    const { hit } = setupBuzzer();
    const beat = 500; // ms — quarter notes @ 120 BPM
    for (let i = 0; i < 8; i++) hit(i % 4 === 0 ? ACCENT : BEAT, i * beat);

    const ns = notes();
    expect(ns.length).toBe(8);
    // even spacing (steady tempo)
    for (let i = 1; i < ns.length; i++) {
      const gap = (ns[i].on - ns[i - 1].on) * 1000;
      expect(Math.abs(gap - beat)).toBeLessThan(5);
    }
    // one oscillator per click, no overlap, monotonic
    for (let i = 0; i < ns.length; i++) {
      expect(ns[i].off).toBeGreaterThan(ns[i].on);
      if (i > 0) {
        expect(ns[i].on).toBeGreaterThan(ns[i - 1].on);
        expect(ns[i - 1].off).toBeLessThanOrEqual(ns[i].on + 1e-6);
      }
    }
    // correct pitch per metric level
    expect(Math.abs(ns[0].freq - 1506)).toBeLessThanOrEqual(2); // accent
    expect(Math.abs(ns[1].freq - 1106)).toBeLessThanOrEqual(2); // beat
  });

  it('absorbs bursty per-frame delivery (onsets even in sim time, jittery in wall time)', () => {
    const { sim, cleanup } = setupBuzzer();
    void cleanup;
    let pwm!: (p: number, dc: number, t?: number) => void;
    sim.pinManager.onPwmChange.mock.calls; // noop ref
    // re-grab the callback captured during setup
    pwm = sim.pinManager.onPwmChange.mock.calls[0][1];

    const beat = 250; // even sim spacing
    // wall-clock delivery jitters by ~one 60fps frame each onset (a real burst)
    const wobble = [0, -15, 12, -10, 14, -13, 10, -8, 0, 11];
    for (let i = 0; i < 10; i++) {
      const simMs = i * beat;
      sim.cpu.data[OCR2A] = i % 4 === 0 ? ACCENT : BEAT;
      sim.cpu.data[TCCR2B] = 0x04;
      clock = (simMs + wobble[i]) / 1000; // jittery wall time
      pwm(11, 0.3, simMs);
      clock = (simMs + 25 + wobble[i]) / 1000;
      pwm(11, 0, simMs + 25);
    }
    const ns = notes();
    expect(ns.length).toBeGreaterThanOrEqual(8);
    // despite the wall-clock jitter, scheduled onsets stay even (de-jittered)
    for (let i = 2; i < ns.length; i++) {
      const gap = (ns[i].on - ns[i - 1].on) * 1000;
      expect(Math.abs(gap - beat)).toBeLessThan(20);
      expect(ns[i - 1].off).toBeLessThanOrEqual(ns[i].on + 1e-6); // no overlap
    }
  });

  it('re-locks immediately and cleanly when the tempo changes', () => {
    const { hit } = setupBuzzer();
    let t = 0;
    for (let i = 0; i < 5; i++) {
      hit(BEAT, t);
      t += 500;
    } // 120 BPM
    for (let i = 0; i < 6; i++) {
      hit(BEAT, t);
      t += 250;
    } // jump to 240 BPM

    const ns = notes();
    expect(ns.length).toBe(11);
    // no overlap / no backward note across the change
    for (let i = 1; i < ns.length; i++) {
      expect(ns[i].on).toBeGreaterThan(ns[i - 1].on);
      expect(ns[i - 1].off).toBeLessThanOrEqual(ns[i].on + 1e-6);
    }
    // settled to the new rate within a beat of the change (no drift/creep)
    const lastGap = (ns[ns.length - 1].on - ns[ns.length - 2].on) * 1000;
    expect(Math.abs(lastGap - 250)).toBeLessThan(10);
  });
});
