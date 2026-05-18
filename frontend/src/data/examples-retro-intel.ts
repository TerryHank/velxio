/**
 * Retro Intel/Zilog CPU examples.
 *
 * These projects place Velxio's bundled "i8080 mini-computer" custom chips
 * on the canvas pre-wired to Arduino Uno boards. Because custom chips are
 * shipped as C source (the WASM is compiled on demand by the backend), each
 * example arrives with sourceC + chipJson populated and wasmBase64 empty —
 * the user clicks the chip and hits "Compile" once to materialize the WASM.
 *
 * After that the project runs end-to-end: the i8080-repl example streams a
 * banner + uptime counter via UART to the Serial Monitor, and the
 * i8080-counter example uses two pushbuttons to drive an 8-LED counter.
 *
 * Sources for the chip programs live alongside the chip in
 * `frontend/src/components/customChips/examples/intel/`, with the original
 * 8080 assembly under `scripts/repl-rom.s` and `scripts/counter-rom.s`.
 */
import type { ExampleProject } from './examples';

// We re-import the chip sources here so the example payload is fully
// self-describing — no runtime lookup into chipExamples.ts. This keeps
// project saves/loads independent from the chip gallery.
import i8080ReplC      from '../components/customChips/examples/intel/i8080-repl.c?raw';
import i8080ReplJ      from '../components/customChips/examples/intel/i8080-repl.chip.json?raw';
import i8080CounterC   from '../components/customChips/examples/intel/i8080-counter.c?raw';
import i8080CounterJ   from '../components/customChips/examples/intel/i8080-counter.chip.json?raw';

const replSketch = `// i8080 banner streamer
//
// The bundled i8080 chip on the canvas runs its own embedded ROM. All
// this Arduino sketch does is set up Serial and forward bytes back and
// forth: the chip's UART output arrives at the AVR's RX path, the sketch
// echoes each byte so the Serial Monitor displays it.
//
// Steps:
//   1. Double-click the chip, switch to the Editor tab, click Compile.
//      (The backend compiles the embedded 8080 emulator + ROM to WASM.)
//   2. Hit Save, then Run.
//   3. Open the Serial Monitor — you should see the banner followed by
//      "uptime ticks: 0xNN" lines incrementing every ~50 ms, all driven
//      by real Intel 8080 instructions running in WASM.

void setup() {
  Serial.begin(9600);
}

void loop() {
  while (Serial.available()) {
    int c = Serial.read();
    Serial.write(c);
  }
}
`;

const counterSketch = `// i8080 button counter
//
// The bundled i8080 chip on the canvas runs its own embedded ROM that
// increments a counter on every BTN_INC press and clears it on BTN_RST.
// The current value drives LED0..LED7 in binary.
//
// Steps:
//   1. Double-click the chip, switch to the Editor tab, click Compile.
//   2. Hit Save, then Run.
//   3. Click BTN_INC repeatedly to count up. Click BTN_RST to clear.
//      The 8 LEDs show the current count in binary.
//
// The Arduino sketch itself does nothing — the 8080 is the brain of
// this little board.

void setup() {
}

void loop() {
}
`;

export const retroIntelExamples: ExampleProject[] = [
  {
    id: 'i8080-banner-streamer',
    title: 'Intel 8080 Banner Streamer',
    description:
      'A clean-room Intel 8080 boots from a 328-byte embedded ROM, prints a banner, ' +
      'then prints "uptime ticks: 0xNN" every ~50 ms. Open the Serial Monitor to watch.',
    category: 'circuits',
    difficulty: 'advanced',
    boardType: 'arduino-uno',
    tags: ['retro', '8080', 'cpu', 'uart', 'wasm', 'custom-chip', 'serial'],
    code: replSketch,
    components: [
      {
        type: 'custom-chip',
        id: 'i8080',
        x: 480,
        y: 140,
        properties: {
          chipName: 'i8080 Mini-Computer (Banner)',
          sourceC: i8080ReplC,
          chipJson: i8080ReplJ,
          wasmBase64: '',
        },
      },
    ],
    wires: [
      // Chip TX → Arduino RX (D0) — visual only; the UART bridge routes
      // bytes through the simulator's USART regardless of wire topology.
      {
        id: 'i8080-tx',
        start: { componentId: 'i8080', pinName: 'TX' },
        end: { componentId: 'arduino-uno', pinName: '0' },
        color: '#7be38b',
      },
      {
        id: 'i8080-rx',
        start: { componentId: 'i8080', pinName: 'RX' },
        end: { componentId: 'arduino-uno', pinName: '1' },
        color: '#ffb648',
      },
      {
        id: 'i8080-vcc',
        start: { componentId: 'i8080', pinName: 'VCC' },
        end: { componentId: 'arduino-uno', pinName: '5V' },
        color: '#e74c3c',
      },
      {
        id: 'i8080-gnd',
        start: { componentId: 'i8080', pinName: 'GND' },
        end: { componentId: 'arduino-uno', pinName: 'GND' },
        color: '#000000',
      },
    ],
  },

  {
    id: 'i8080-button-counter',
    title: 'Intel 8080 Button Counter',
    description:
      'A self-contained Intel 8080 chip running a 34-byte ROM. Press the INC button to count up ' +
      'in binary on 8 LEDs, press the RST button to clear. The CPU, RAM, and program are all ' +
      'inside the single chip on the canvas.',
    category: 'circuits',
    difficulty: 'intermediate',
    boardType: 'arduino-uno',
    tags: ['retro', '8080', 'cpu', 'leds', 'buttons', 'wasm', 'custom-chip'],
    code: counterSketch,
    components: [
      {
        type: 'custom-chip',
        id: 'i8080c',
        x: 380,
        y: 120,
        properties: {
          chipName: 'i8080 Button Counter',
          sourceC: i8080CounterC,
          chipJson: i8080CounterJ,
          wasmBase64: '',
        },
      },
      // 8 LEDs for the binary readout
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
        type: 'wokwi-led',
        id: `led-${i}`,
        x: 700 + i * 50,
        y: 120,
        properties: { color: i < 4 ? 'red' : 'orange' },
      })),
      // 2 buttons
      {
        type: 'wokwi-pushbutton',
        id: 'btn-inc',
        x: 380,
        y: 420,
        properties: { color: 'green' },
      },
      {
        type: 'wokwi-pushbutton',
        id: 'btn-rst',
        x: 540,
        y: 420,
        properties: { color: 'red' },
      },
    ],
    wires: [
      // LED data wires
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
        id: `wire-led-${i}`,
        start: { componentId: 'i8080c', pinName: `LED${i}` },
        end: { componentId: `led-${i}`, pinName: 'A' },
        color: '#facc15',
      })),
      // LED GNDs
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
        id: `wire-led-${i}-gnd`,
        start: { componentId: `led-${i}`, pinName: 'C' },
        end: { componentId: 'arduino-uno', pinName: 'GND' },
        color: '#000000',
      })),
      // Buttons
      {
        id: 'wire-btn-inc',
        start: { componentId: 'btn-inc', pinName: '1.l' },
        end: { componentId: 'i8080c', pinName: 'BTN_INC' },
        color: '#22c55e',
      },
      {
        id: 'wire-btn-rst',
        start: { componentId: 'btn-rst', pinName: '1.l' },
        end: { componentId: 'i8080c', pinName: 'BTN_RST' },
        color: '#ef4444',
      },
      {
        id: 'wire-btn-inc-pwr',
        start: { componentId: 'btn-inc', pinName: '2.r' },
        end: { componentId: 'arduino-uno', pinName: '5V' },
        color: '#e74c3c',
      },
      {
        id: 'wire-btn-rst-pwr',
        start: { componentId: 'btn-rst', pinName: '2.r' },
        end: { componentId: 'arduino-uno', pinName: '5V' },
        color: '#e74c3c',
      },
      {
        id: 'wire-i8080c-vcc',
        start: { componentId: 'i8080c', pinName: 'VCC' },
        end: { componentId: 'arduino-uno', pinName: '5V' },
        color: '#e74c3c',
      },
      {
        id: 'wire-i8080c-gnd',
        start: { componentId: 'i8080c', pinName: 'GND' },
        end: { componentId: 'arduino-uno', pinName: 'GND' },
        color: '#000000',
      },
    ],
  },
];
