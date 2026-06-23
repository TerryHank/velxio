import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Stm32Bridge, stm32PinNameToLinear } from '../simulation/Stm32Bridge';

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  static instances: MockWebSocket[] = [];
}

describe('Stm32Bridge ADC protocol', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('window', {
      __VELXIO_API_BASE__: 'http://localhost:8002/api',
      location: { href: 'http://localhost:5173/' },
      sessionStorage: {
        getItem: vi.fn().mockReturnValue('test-session'),
        setItem: vi.fn(),
      },
      localStorage: {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
      },
    });
  });

  it('includes pending ADC values in start_stm32 and sends live updates', () => {
    const bridge = new Stm32Bridge('stm32-1', 'stm32-bluepill');
    const pa0 = stm32PinNameToLinear('PA0');

    expect(bridge.setAdcVoltage(pa0, 1.65)).toBe(true);

    bridge.connect();
    const ws = MockWebSocket.instances[0];
    ws.open();

    const startMsg = ws.sent.map((m) => JSON.parse(m)).find((m) => m.type === 'start_stm32');
    expect(startMsg.data.initial_adc).toContainEqual({
      pin: pa0,
      millivolts: 1650,
      raw: 2048,
    });

    bridge.setAdcVoltage(pa0, 3.3);
    const last = JSON.parse(ws.sent[ws.sent.length - 1]);
    expect(last).toEqual({
      type: 'stm32_adc_set',
      data: { pin: pa0, millivolts: 3300, raw: 4095 },
    });
  });
});
