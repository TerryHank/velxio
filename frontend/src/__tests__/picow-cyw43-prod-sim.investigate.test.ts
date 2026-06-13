/**
 * picow-cyw43-prod-sim.investigate.test.ts
 *
 * PRODUCTION-PATH validation (not CI — run explicitly).
 *
 * Unlike picow-cyw43-boot-harness.investigate.test.ts (which wires the cyw43
 * emulator to a raw rp2040js Simulator with its own FIFO/PIO plumbing), this
 * drives the REAL `RP2040Simulator` — the exact code that runs in the browser:
 * attachCyw43() + installCyw43PioHooks() (non-dropping FIFO, firmware fast-path,
 * host-wake GPIO24) + the lockstep PIO stepping in runFrameForTime(). It boots
 * the real Pico W firmware, injects a WiFi-connect snippet via the raw REPL, and
 * asserts the link reaches isconnected()==True.
 *
 * Run:
 *   CYW43_PROD_HARNESS=1 npx vitest run \
 *     src/__tests__/picow-cyw43-prod-sim.investigate.test.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const FW_PATH =
  '/home/dave/velxio-prod/velxio/frontend/public/firmware/micropython-rp2040w.uf2';

// getFirmware = IndexedDB/fetch (browser only) -> serve from disk.
// loadUserFiles = LittleFS WASM fetch (browser only) -> no-op; we inject the
// WiFi snippet over the raw REPL instead of writing main.py to the filesystem.
vi.mock('../simulation/MicroPythonLoader', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getFirmware: async () => new Uint8Array(readFileSync(FW_PATH)),
    loadUserFiles: async () => { /* skip LittleFS */ },
  };
});

const INJECT_CODE = [
  'import network, time',
  'print("PYBOOT")',
  'w = network.WLAN(network.STA_IF)',
  'w.active(True)',
  'print("ACTIVE", w.active())',
  'w.connect("Velxio-GUEST", "")',
  'ok = False',
  'for i in range(100):',
  '    if w.isconnected():',
  '        ok = True',
  '        print("CONN_OK", w.ifconfig()[0])',
  '        break',
  '    time.sleep_ms(150)',
  'if not ok:',
  '    print("CONN_TIMEOUT status", w.status())',
  'print("MAINPY_DONE")',
].join('\n');

describe.skipIf(!process.env.CYW43_PROD_HARNESS)('Pico W cyw43 — production RP2040Simulator path', () => {
  it('boots, connects WiFi, and reaches isconnected()', async () => {
    const { RP2040Simulator } = await import('../simulation/RP2040Simulator');
    const { PinManager } = await import('../simulation/PinManager');

    const sim = new RP2040Simulator(new PinManager());
    let serial = '';
    let buf = '';
    sim.attachCyw43(); // selects Pico W firmware + registers host-wake listener
    await sim.loadMicroPython([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cdc = (sim as any).usbCDC as { sendSerialByte: (b: number) => void } | null;
    expect(cdc).toBeTruthy();
    const send = (s: string) => { for (const c of s) cdc!.sendSerialByte(c.charCodeAt(0)); };

    // Raw-REPL injection state machine, fed by the serial stream.
    let state: 'idle' | 'prompt' | 'raw' | 'sent' = 'idle';
    sim.onSerialData = (ch: string) => {
      serial += ch; buf += ch;
      if (serial.length > 60000) serial = serial.slice(-20000);
      if (state === 'idle' && buf.includes('>>>')) {
        state = 'prompt'; buf = '';
        cdc!.sendSerialByte(0x01); // Ctrl-A -> raw REPL
      } else if (state === 'prompt' && buf.includes('raw REPL')) {
        state = 'raw'; buf = '';
        send(INJECT_CODE);
        cdc!.sendSerialByte(0x04); // Ctrl-D -> execute
        state = 'sent';
      }
    };

    const deadline = Date.now() + 175_000;
    let frames = 0;
    while (Date.now() < deadline) {
      for (let i = 0; i < 16; i++) { sim.runFrameForTime(50); frames++; }
      if (serial.includes('MAINPY_DONE') || serial.includes('CONN_OK')) break;
      await new Promise((r) => setTimeout(r, 0));
    }
    try { sim.stop(); } catch { /* noop */ }

    // eslint-disable-next-line no-console
    console.log(`\n===== PROD-SIM SERIAL (frames=${frames}, state=${state}) =====\n` + serial.slice(-1500));

    expect(serial).toContain('PYBOOT');
    expect(serial).toContain('CONN_OK');
  }, 200_000);
});
