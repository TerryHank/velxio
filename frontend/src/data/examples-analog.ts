/**
 * 模拟电路示例（不含 Arduino 开发板）。
 *
 * 这 30 个示例使用 ngspice-WASM SPICE 后端运行独立的模拟电路：
 * 无源分压器与滤波器、二极管整流/限幅器、BJT/MOSFET 放大级、运放拓扑。
 * 每个电路使用 `signal-generator` 作为信号源（同时也作为接地参考，因为
 * 只有它的 `GND` 引脚会被规范化为 SPICE 节点 0——`battery-9v −` 不是）。
 *
 * 所有电路均标记了 `boardFilter: 'analog'`，以便画廊将其分组显示，
 * 并且预览/加载器知道跳过隐式的 Arduino 开发板。
 *
 * 布局说明：每个电路大致适配 560 × 320 像素，以便
 * CircuitPreview 卡片清晰渲染。元件尺寸来自
 * InlineComponentSVGs.tsx / CircuitPreview.tsx 中的 COMP_DEFS。
 */
import type { ExampleProject } from './examples';

// ── Helpers ────────────────────────────────────────────────────────────────

function w(id: string, from: [string, string], to: [string, string], color = '#00aaff') {
  return {
    id,
    start: { componentId: from[0], pinName: from[1] },
    end: { componentId: to[0], pinName: to[1] },
    color,
  };
}

// Colors used throughout
const C_PWR = '#ff3b3b'; // power / V+
const C_GND = '#000000'; // ground
const C_SIG = '#ffaa00'; // signal
const C_OUT = '#22d3ee'; // output
const C_WIRE = '#00aaff'; // generic signal

// Standard placeholder sketch text so the editor has something non-empty
// when the user loads an analog example.
const ANALOG_SKETCH = `// 纯模拟电路——无需 Arduino 草图。
// 切换电气仿真（⚡）按钮以运行 SPICE 引擎。
void setup() {}
void loop() {}
`;

// Base example skeleton — cuts down per-circuit boilerplate.
function analog(
  id: string,
  title: string,
  description: string,
  difficulty: ExampleProject['difficulty'],
  components: ExampleProject['components'],
  wires: ExampleProject['wires'],
): ExampleProject {
  return {
    id,
    title,
    description,
    category: 'circuits',
    difficulty,
    boardFilter: 'analog',
    code: ANALOG_SKETCH,
    components,
    wires,
  };
}

// ── Component shortcuts ────────────────────────────────────────────────────

function sigGen(id: string, x: number, y: number, props: Record<string, any>) {
  return { type: 'wokwi-signal-generator', id, x, y, properties: props };
}
function res(id: string, x: number, y: number, value: string) {
  return { type: 'wokwi-resistor', id, x, y, properties: { value } };
}
function cap(id: string, x: number, y: number, value: string) {
  return { type: 'wokwi-capacitor', id, x, y, properties: { value } };
}
function ind(id: string, x: number, y: number, value: string) {
  return { type: 'wokwi-inductor', id, x, y, properties: { value } };
}
function diode(id: string, x: number, y: number, kind = 'wokwi-diode-1n4007') {
  return { type: kind, id, x, y, properties: {} };
}
function zener(id: string, x: number, y: number) {
  return { type: 'wokwi-zener-1n4733', id, x, y, properties: {} };
}
function bjtNpn(id: string, x: number, y: number) {
  return { type: 'wokwi-bjt-2n2222', id, x, y, properties: {} };
}
function bjtPnp(id: string, x: number, y: number) {
  return { type: 'wokwi-bjt-bc557', id, x, y, properties: {} };
}
function mosN(id: string, x: number, y: number) {
  return { type: 'wokwi-mosfet-2n7000', id, x, y, properties: {} };
}
function mosP(id: string, x: number, y: number) {
  return { type: 'wokwi-mosfet-irf9540', id, x, y, properties: {} };
}
function opamp(id: string, x: number, y: number) {
  return { type: 'wokwi-opamp-lm358', id, x, y, properties: {} };
}
function vmeter(id: string, x: number, y: number) {
  return { type: 'velxio-instr-voltmeter', id, x, y, properties: {} };
}
function ammeter(id: string, x: number, y: number) {
  return { type: 'velxio-instr-ammeter', id, x, y, properties: {} };
}

// ── Examples ───────────────────────────────────────────────────────────────

export const analogExamples: ExampleProject[] = [
  // ════════════════════════════════════════════════════════════════════════
  // 无源元件  (1–7)
  // ════════════════════════════════════════════════════════════════════════

  analog(
    'an-voltage-divider',
    '分压电路',
    '两个电阻将 5V 直流电源对半分压。经典 SPICE 入门示例——预期 R2 两端电压为 2.5V。',
    'beginner',
    [
      sigGen('src', 60, 160, { waveform: 'dc', offset: 5, amplitude: 0, frequency: 1 }),
      res('r1', 260, 120, '10000'),
      res('r2', 260, 220, '10000'),
      vmeter('vm', 420, 180),
    ],
    [
      w('w1', ['src', 'SIG'], ['r1', '1'], C_PWR),
      w('w2', ['r1', '2'], ['r2', '1'], C_SIG),
      w('w3', ['r2', '2'], ['src', 'GND'], C_GND),
      w('w4', ['r1', '2'], ['vm', 'V+'], C_OUT),
      w('w5', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-series-resistors',
    '串联电阻',
    '三个电阻串联，流过相同的电流——电流表读数为 V/(R1+R2+R3)。',
    'beginner',
    [
      sigGen('src', 60, 160, { waveform: 'dc', offset: 10, amplitude: 0, frequency: 1 }),
      res('r1', 220, 120, '1000'),
      res('r2', 360, 120, '2200'),
      res('r3', 500, 120, '4700'),
      ammeter('am', 300, 240),
    ],
    [
      w('w1', ['src', 'SIG'], ['r1', '1'], C_PWR),
      w('w2', ['r1', '2'], ['r2', '1'], C_WIRE),
      w('w3', ['r2', '2'], ['r3', '1'], C_WIRE),
      w('w4', ['r3', '2'], ['am', 'A+'], C_SIG),
      w('w5', ['am', 'A-'], ['src', 'GND'], C_GND),
    ],
  ),

  analog(
    'an-parallel-resistors',
    '并联电阻',
    '三个电阻并联——总电阻为各电阻倒数之和的倒数。电流表显示总电流。',
    'beginner',
    [
      sigGen('src', 60, 180, { waveform: 'dc', offset: 5, amplitude: 0, frequency: 1 }),
      res('r1', 320, 100, '1000'),
      res('r2', 320, 180, '1000'),
      res('r3', 320, 260, '1000'),
      ammeter('am', 180, 280),
    ],
    [
      w('w1', ['src', 'SIG'], ['r1', '1'], C_PWR),
      w('w2', ['src', 'SIG'], ['r2', '1'], C_PWR),
      w('w3', ['src', 'SIG'], ['r3', '1'], C_PWR),
      w('w4', ['r1', '2'], ['am', 'A+'], C_SIG),
      w('w5', ['r2', '2'], ['am', 'A+'], C_SIG),
      w('w6', ['r3', '2'], ['am', 'A+'], C_SIG),
      w('w7', ['am', 'A-'], ['src', 'GND'], C_GND),
    ],
  ),

  analog(
    'an-rc-low-pass',
    'RC 低通滤波器',
    '1 kHz 正弦波通过 R = 1.6 kΩ 和 C = 100 nF。截止频率 fc ≈ 1 kHz——输出衰减 −3 dB。',
    'beginner',
    [
      sigGen('src', 60, 180, { waveform: 'sine', frequency: 1000, amplitude: 1, offset: 0 }),
      res('r1', 260, 140, '1600'),
      cap('c1', 400, 240, '100n'),
      vmeter('vm', 520, 180),
    ],
    [
      w('w1', ['src', 'SIG'], ['r1', '1'], C_SIG),
      w('w2', ['r1', '2'], ['c1', '1'], C_OUT),
      w('w3', ['c1', '2'], ['src', 'GND'], C_GND),
      w('w4', ['r1', '2'], ['vm', 'V+'], C_OUT),
      w('w5', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-rc-high-pass',
    'RC 高通滤波器',
    '将低通滤波器的 R 和 C 互换即得高通滤波器。1 kHz 正弦波经 C — R — GND。',
    'beginner',
    [
      sigGen('src', 60, 180, { waveform: 'sine', frequency: 1000, amplitude: 1, offset: 0 }),
      cap('c1', 240, 140, '100n'),
      res('r1', 400, 240, '1600'),
      vmeter('vm', 520, 180),
    ],
    [
      w('w1', ['src', 'SIG'], ['c1', '1'], C_SIG),
      w('w2', ['c1', '2'], ['r1', '1'], C_OUT),
      w('w3', ['r1', '2'], ['src', 'GND'], C_GND),
      w('w4', ['c1', '2'], ['vm', 'V+'], C_OUT),
      w('w5', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-rl-low-pass',
    'RL 低通滤波器',
    '电感串联，电阻接地。高频分量降在 L 上；低频分量通过。',
    'intermediate',
    [
      sigGen('src', 60, 180, { waveform: 'sine', frequency: 5000, amplitude: 1, offset: 0 }),
      ind('l1', 240, 140, '10m'),
      res('r1', 400, 240, '1000'),
      vmeter('vm', 520, 180),
    ],
    [
      w('w1', ['src', 'SIG'], ['l1', '1'], C_SIG),
      w('w2', ['l1', '2'], ['r1', '1'], C_OUT),
      w('w3', ['r1', '2'], ['src', 'GND'], C_GND),
      w('w4', ['l1', '2'], ['vm', 'V+'], C_OUT),
      w('w5', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-rlc-series-resonance',
    '串联 RLC 谐振电路',
    'L = 1 mH，C = 1 µF，谐振频率 fr ≈ 5 kHz。扫描信号发生器——Vc 在谐振时达到峰值（与 Q 值相关）。',
    'intermediate',
    [
      sigGen('src', 60, 180, { waveform: 'sine', frequency: 5000, amplitude: 1, offset: 0 }),
      res('r1', 240, 140, '10'),
      ind('l1', 360, 140, '1m'),
      cap('c1', 500, 240, '1u'),
      vmeter('vm', 620, 180),
    ],
    [
      w('w1', ['src', 'SIG'], ['r1', '1'], C_SIG),
      w('w2', ['r1', '2'], ['l1', '1'], C_WIRE),
      w('w3', ['l1', '2'], ['c1', '1'], C_OUT),
      w('w4', ['c1', '2'], ['src', 'GND'], C_GND),
      w('w5', ['l1', '2'], ['vm', 'V+'], C_OUT),
      w('w6', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  // ════════════════════════════════════════════════════════════════════════
  // 二极管  (8–14)
  // ════════════════════════════════════════════════════════════════════════

  analog(
    'an-half-wave-rectifier',
    '半波整流电路',
    '单个二极管仅导通 50 Hz 正弦波的正半周。负载电阻上产生整流后的电压。',
    'beginner',
    [
      sigGen('src', 60, 180, { waveform: 'sine', frequency: 50, amplitude: 8, offset: 0 }),
      diode('d1', 240, 140),
      res('r1', 420, 240, '1000'),
      vmeter('vm', 560, 180),
    ],
    [
      w('w1', ['src', 'SIG'], ['d1', 'A'], C_SIG),
      w('w2', ['d1', 'C'], ['r1', '1'], C_OUT),
      w('w3', ['r1', '2'], ['src', 'GND'], C_GND),
      w('w4', ['d1', 'C'], ['vm', 'V+'], C_OUT),
      w('w5', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-bridge-rectifier',
    '全波桥式整流电路',
    '四只二极管构成桥式结构，对交流输入的两个半周均进行整流。负载 R1 上得到频率为输入 2 倍的全波脉冲。',
    'intermediate',
    [
      sigGen('src', 60, 200, { waveform: 'sine', frequency: 50, amplitude: 10, offset: 0 }),
      diode('d1', 260, 100),
      diode('d2', 380, 100),
      diode('d3', 260, 280),
      diode('d4', 380, 280),
      res('r1', 540, 200, '2200'),
      vmeter('vm', 680, 200),
    ],
    [
      // Bridge: SIG -> d1 anode, d3 cathode; GND -> d2 anode, d4 cathode
      // + rail (top): d1 cathode, d2 cathode
      // − rail (bottom): d3 anode, d4 anode
      w('w1', ['src', 'SIG'], ['d1', 'A'], C_SIG),
      w('w2', ['src', 'SIG'], ['d3', 'C'], C_SIG),
      w('w3', ['src', 'GND'], ['d2', 'A'], C_GND),
      w('w4', ['src', 'GND'], ['d4', 'C'], C_GND),
      w('w5', ['d1', 'C'], ['d2', 'C'], C_OUT),
      w('w6', ['d3', 'A'], ['d4', 'A'], '#666666'),
      w('w7', ['d1', 'C'], ['r1', '1'], C_OUT),
      w('w8', ['r1', '2'], ['d3', 'A'], '#666666'),
      w('w9', ['r1', '1'], ['vm', 'V+'], C_OUT),
      w('w10', ['r1', '2'], ['vm', 'V-'], '#666666'),
    ],
  ),

  analog(
    'an-smoothed-rectifier',
    '带滤波的半波整流电路',
    '半波整流后接 100 µF 滤波电容。输出接近直流，纹波幅度与 C 成反比。',
    'intermediate',
    [
      sigGen('src', 60, 180, { waveform: 'sine', frequency: 50, amplitude: 10, offset: 0 }),
      diode('d1', 240, 140),
      cap('c1', 400, 240, '100u'),
      res('r1', 540, 240, '1000'),
      vmeter('vm', 680, 180),
    ],
    [
      w('w1', ['src', 'SIG'], ['d1', 'A'], C_SIG),
      w('w2', ['d1', 'C'], ['c1', '1'], C_OUT),
      w('w3', ['c1', '1'], ['r1', '1'], C_OUT),
      w('w4', ['c1', '2'], ['src', 'GND'], C_GND),
      w('w5', ['r1', '2'], ['src', 'GND'], C_GND),
      w('w6', ['c1', '1'], ['vm', 'V+'], C_OUT),
      w('w7', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-zener-regulator',
    '齐纳并联稳压电路',
    '串联电阻 + 反向偏置的齐纳二极管将输出电压钳位在 Vz（1N4733 为 5.1V），不受输入变化影响。',
    'intermediate',
    [
      sigGen('src', 60, 180, { waveform: 'dc', offset: 12, amplitude: 0, frequency: 1 }),
      res('r1', 240, 140, '220'),
      zener('d1', 400, 240),
      res('rl', 540, 240, '2200'),
      vmeter('vm', 680, 180),
    ],
    [
      w('w1', ['src', 'SIG'], ['r1', '1'], C_PWR),
      w('w2', ['r1', '2'], ['d1', 'C'], C_OUT),
      w('w3', ['r1', '2'], ['rl', '1'], C_OUT),
      w('w4', ['d1', 'A'], ['src', 'GND'], C_GND),
      w('w5', ['rl', '2'], ['src', 'GND'], C_GND),
      w('w6', ['r1', '2'], ['vm', 'V+'], C_OUT),
      w('w7', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-diode-clipper',
    '二极管限幅电路',
    '两只二极管经串联电阻分别接至 VCC/GND，将输出摆幅限制在约 ±0.7V——实现对称限幅。',
    'intermediate',
    [
      sigGen('src', 60, 180, { waveform: 'sine', frequency: 1000, amplitude: 5, offset: 0 }),
      res('r1', 240, 180, '1000'),
      diode('d1', 400, 100),
      diode('d2', 400, 280),
      vmeter('vm', 560, 180),
    ],
    [
      w('w1', ['src', 'SIG'], ['r1', '1'], C_SIG),
      w('w2', ['r1', '2'], ['d1', 'A'], C_OUT),
      w('w3', ['r1', '2'], ['d2', 'C'], C_OUT),
      w('w4', ['d1', 'C'], ['src', 'GND'], C_GND), // upper clip to 0 (really D inside ±0.7 both sides)
      w('w5', ['d2', 'A'], ['src', 'GND'], C_GND),
      w('w6', ['r1', '2'], ['vm', 'V+'], C_OUT),
      w('w7', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-diode-clamper',
    '二极管钳位电路（直流恢复器）',
    '串联电容 + 并联二极管将信号平移，使其负峰值位于 0V。输出摆幅为 0 → 2·Vpeak。',
    'intermediate',
    [
      sigGen('src', 60, 180, { waveform: 'sine', frequency: 1000, amplitude: 5, offset: 0 }),
      cap('c1', 240, 180, '1u'),
      diode('d1', 400, 240),
      res('rl', 540, 240, '10000'),
      vmeter('vm', 680, 180),
    ],
    [
      w('w1', ['src', 'SIG'], ['c1', '1'], C_SIG),
      w('w2', ['c1', '2'], ['d1', 'C'], C_OUT),
      w('w3', ['c1', '2'], ['rl', '1'], C_OUT),
      w('w4', ['d1', 'A'], ['src', 'GND'], C_GND),
      w('w5', ['rl', '2'], ['src', 'GND'], C_GND),
      w('w6', ['c1', '2'], ['vm', 'V+'], C_OUT),
      w('w7', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-voltage-doubler',
    '倍压整流电路（Villard / Greinacher）',
    '两个电容 + 两个二极管从交流输入中提取约 2·Vpeak 的直流电压。第一级钳位，第二级峰值检测。',
    'advanced',
    [
      sigGen('src', 60, 200, { waveform: 'sine', frequency: 50, amplitude: 8, offset: 0 }),
      cap('c1', 220, 200, '10u'),
      diode('d1', 360, 120),
      diode('d2', 500, 200),
      cap('c2', 640, 280, '100u'),
      res('rl', 780, 280, '10000'),
      vmeter('vm', 860, 160),
    ],
    [
      w('w1', ['src', 'SIG'], ['c1', '1'], C_SIG),
      w('w2', ['c1', '2'], ['d1', 'C'], C_WIRE), // D1 cathode = n1 → clamps negative excursion to ~−0.7
      w('w3', ['d1', 'A'], ['src', 'GND'], C_GND), // D1 anode = GND
      w('w4', ['c1', '2'], ['d2', 'A'], C_WIRE), // D2 anode = n1 (now swings 0 → +2·Vpeak)
      w('w5', ['d2', 'C'], ['c2', '1'], C_OUT), // D2 cathode → vout
      w('w6', ['c2', '1'], ['rl', '1'], C_OUT),
      w('w7', ['c2', '2'], ['src', 'GND'], C_GND),
      w('w8', ['rl', '2'], ['src', 'GND'], C_GND),
      w('w9', ['c2', '1'], ['vm', 'V+'], C_OUT),
      w('w10', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  // ════════════════════════════════════════════════════════════════════════
  // BJT  (15–20)
  // ════════════════════════════════════════════════════════════════════════

  analog(
    'an-bjt-common-emitter',
    'BJT 共射极放大器',
    '经典电压放大器：基极由分压器偏置，发射极经 Re 负反馈，集电极电阻决定增益。',
    'advanced',
    [
      sigGen('vcc', 60, 40, { waveform: 'dc', offset: 12, amplitude: 0, frequency: 1 }),
      sigGen('src', 60, 240, { waveform: 'sine', frequency: 1000, amplitude: 0.05, offset: 0 }),
      res('rb1', 240, 60, '47000'),
      res('rb2', 240, 200, '10000'),
      res('rc', 440, 60, '4700'),
      res('re', 440, 300, '1000'),
      cap('cin', 220, 260, '10u'),
      bjtNpn('q1', 360, 160),
      vmeter('vm', 600, 120),
    ],
    [
      w('w1', ['vcc', 'SIG'], ['rb1', '1'], C_PWR),
      w('w2', ['rb1', '2'], ['rb2', '1'], C_WIRE),
      w('w3', ['rb2', '2'], ['vcc', 'GND'], C_GND),
      w('w4', ['rb1', '2'], ['q1', 'B'], C_SIG),
      w('w5', ['vcc', 'SIG'], ['rc', '1'], C_PWR),
      w('w6', ['rc', '2'], ['q1', 'C'], C_OUT),
      w('w7', ['q1', 'E'], ['re', '1'], C_WIRE),
      w('w8', ['re', '2'], ['vcc', 'GND'], C_GND),
      w('w9', ['src', 'SIG'], ['cin', '1'], C_SIG),
      w('w10', ['cin', '2'], ['q1', 'B'], C_SIG),
      w('w11', ['src', 'GND'], ['vcc', 'GND'], C_GND),
      w('w12', ['q1', 'C'], ['vm', 'V+'], C_OUT),
      w('w13', ['vcc', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-bjt-emitter-follower',
    'BJT 射极跟随器',
    '共集电极缓冲器：电压增益为 1，高输入阻抗，低输出阻抗。非常适合用作驱动级。',
    'intermediate',
    [
      sigGen('vcc', 60, 40, { waveform: 'dc', offset: 12, amplitude: 0, frequency: 1 }),
      sigGen('src', 60, 240, { waveform: 'sine', frequency: 1000, amplitude: 1, offset: 6 }),
      res('rb', 260, 80, '100000'),
      bjtNpn('q1', 420, 160),
      res('re', 500, 300, '1000'),
      vmeter('vm', 640, 220),
    ],
    [
      w('w1', ['vcc', 'SIG'], ['q1', 'C'], C_PWR),
      w('w2', ['src', 'SIG'], ['rb', '1'], C_SIG),
      w('w3', ['rb', '2'], ['q1', 'B'], C_SIG),
      w('w4', ['q1', 'E'], ['re', '1'], C_OUT),
      w('w5', ['re', '2'], ['vcc', 'GND'], C_GND),
      w('w6', ['src', 'GND'], ['vcc', 'GND'], C_GND),
      w('w7', ['q1', 'E'], ['vm', 'V+'], C_OUT),
      w('w8', ['vcc', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-bjt-switch',
    'BJT 开关电路',
    '基极通过 Rb 驱动至饱和区；集电极经负载电阻上拉。直流阶跃输入使 Vce 在 ~0.2V 与 Vcc 之间切换。',
    'beginner',
    [
      sigGen('vcc', 60, 40, { waveform: 'dc', offset: 9, amplitude: 0, frequency: 1 }),
      sigGen('src', 60, 240, { waveform: 'square', frequency: 100, amplitude: 2, offset: 2 }),
      res('rb', 260, 240, '4700'),
      res('rl', 440, 60, '1000'),
      bjtNpn('q1', 420, 160),
      vmeter('vm', 600, 160),
    ],
    [
      w('w1', ['vcc', 'SIG'], ['rl', '1'], C_PWR),
      w('w2', ['rl', '2'], ['q1', 'C'], C_OUT),
      w('w3', ['src', 'SIG'], ['rb', '1'], C_SIG),
      w('w4', ['rb', '2'], ['q1', 'B'], C_SIG),
      w('w5', ['q1', 'E'], ['vcc', 'GND'], C_GND),
      w('w6', ['src', 'GND'], ['vcc', 'GND'], C_GND),
      w('w7', ['q1', 'C'], ['vm', 'V+'], C_OUT),
      w('w8', ['vcc', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-darlington',
    '达林顿复合管',
    '两个级联 NPN 管使 β 相乘——β_total ≈ β1·β2。用于单个晶体管无法为重负载提供足够基极电流的场合。',
    'advanced',
    [
      sigGen('vcc', 60, 40, { waveform: 'dc', offset: 12, amplitude: 0, frequency: 1 }),
      sigGen('src', 60, 260, { waveform: 'dc', offset: 2, amplitude: 0, frequency: 1 }),
      res('rb', 260, 200, '10000'),
      bjtNpn('q1', 360, 140),
      bjtNpn('q2', 500, 200),
      res('rl', 620, 80, '220'),
      vmeter('vm', 720, 180),
    ],
    [
      w('w1', ['vcc', 'SIG'], ['rl', '1'], C_PWR),
      w('w2', ['rl', '2'], ['q1', 'C'], C_OUT),
      w('w3', ['q1', 'C'], ['q2', 'C'], C_PWR),
      w('w4', ['src', 'SIG'], ['rb', '1'], C_SIG),
      w('w5', ['rb', '2'], ['q1', 'B'], C_SIG),
      w('w6', ['q1', 'E'], ['q2', 'B'], C_WIRE),
      w('w7', ['q2', 'E'], ['vcc', 'GND'], C_GND),
      w('w8', ['src', 'GND'], ['vcc', 'GND'], C_GND),
      w('w9', ['q2', 'C'], ['vm', 'V+'], C_OUT),
      w('w10', ['vcc', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-current-mirror',
    'NPN 电流镜',
    'Q1 中的参考电流被镜像到 Q2 的集电极——匹配的晶体管 + 共享的 Vbe 使集电极电流相等。',
    'advanced',
    [
      sigGen('vcc', 60, 40, { waveform: 'dc', offset: 12, amplitude: 0, frequency: 1 }),
      res('rref', 240, 40, '10000'),
      bjtNpn('q1', 320, 160),
      bjtNpn('q2', 520, 160),
      res('rload', 620, 40, '4700'),
      ammeter('am', 720, 160),
    ],
    [
      w('w1', ['vcc', 'SIG'], ['rref', '1'], C_PWR),
      w('w2', ['rref', '2'], ['q1', 'C'], C_WIRE),
      w('w3', ['q1', 'C'], ['q1', 'B'], C_WIRE),
      w('w4', ['q1', 'B'], ['q2', 'B'], C_WIRE),
      w('w5', ['vcc', 'SIG'], ['rload', '1'], C_PWR),
      w('w6', ['rload', '2'], ['am', 'A+'], C_OUT),
      w('w7', ['am', 'A-'], ['q2', 'C'], C_OUT),
      w('w8', ['q1', 'E'], ['vcc', 'GND'], C_GND),
      w('w9', ['q2', 'E'], ['vcc', 'GND'], C_GND),
    ],
  ),

  analog(
    'an-bjt-diff-pair',
    'BJT 差分对',
    '长尾对结构：共享的发射极尾电阻根据差分输入在 Q1 和 Q2 之间分配电流。',
    'advanced',
    [
      sigGen('vcc', 60, 40, { waveform: 'dc', offset: 12, amplitude: 0, frequency: 1 }),
      sigGen('in1', 60, 220, { waveform: 'sine', frequency: 1000, amplitude: 0.02, offset: 2.5 }),
      sigGen('in2', 60, 360, { waveform: 'dc', offset: 2.5, amplitude: 0, frequency: 1 }),
      res('rc1', 300, 40, '4700'),
      res('rc2', 500, 40, '4700'),
      bjtNpn('q1', 280, 180),
      bjtNpn('q2', 500, 180),
      res('rtail', 400, 320, '4700'),
      vmeter('vm', 620, 120),
    ],
    [
      w('w1', ['vcc', 'SIG'], ['rc1', '1'], C_PWR),
      w('w2', ['vcc', 'SIG'], ['rc2', '1'], C_PWR),
      w('w3', ['rc1', '2'], ['q1', 'C'], C_WIRE),
      w('w4', ['rc2', '2'], ['q2', 'C'], C_OUT),
      w('w5', ['in1', 'SIG'], ['q1', 'B'], C_SIG),
      w('w6', ['in2', 'SIG'], ['q2', 'B'], C_SIG),
      w('w7', ['q1', 'E'], ['rtail', '1'], C_WIRE),
      w('w8', ['q2', 'E'], ['rtail', '1'], C_WIRE),
      w('w9', ['rtail', '2'], ['vcc', 'GND'], C_GND),
      w('w10', ['in1', 'GND'], ['vcc', 'GND'], C_GND),
      w('w11', ['in2', 'GND'], ['vcc', 'GND'], C_GND),
      w('w12', ['q2', 'C'], ['vm', 'V+'], C_OUT),
      w('w13', ['vcc', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  // ════════════════════════════════════════════════════════════════════════
  // MOSFET  (21–23)
  // ════════════════════════════════════════════════════════════════════════

  analog(
    'an-mosfet-switch',
    'MOSFET 低边开关',
    '2N7000 NMOS 管，带下拉栅极电阻。栅极驱动电压超过 Vth 时器件导通，将电流从负载灌入 GND。',
    'beginner',
    [
      sigGen('vcc', 60, 40, { waveform: 'dc', offset: 12, amplitude: 0, frequency: 1 }),
      sigGen('src', 60, 260, { waveform: 'square', frequency: 100, amplitude: 2, offset: 2 }),
      res('rg', 240, 240, '100'),
      res('rl', 420, 60, '470'),
      mosN('m1', 420, 160),
      res('rgp', 240, 340, '100000'),
      vmeter('vm', 600, 160),
    ],
    [
      w('w1', ['vcc', 'SIG'], ['rl', '1'], C_PWR),
      w('w2', ['rl', '2'], ['m1', 'D'], C_OUT),
      w('w3', ['src', 'SIG'], ['rg', '1'], C_SIG),
      w('w4', ['rg', '2'], ['m1', 'G'], C_SIG),
      w('w5', ['m1', 'G'], ['rgp', '1'], C_SIG),
      w('w6', ['rgp', '2'], ['vcc', 'GND'], C_GND),
      w('w7', ['m1', 'S'], ['vcc', 'GND'], C_GND),
      w('w8', ['src', 'GND'], ['vcc', 'GND'], C_GND),
      w('w9', ['m1', 'D'], ['vm', 'V+'], C_OUT),
      w('w10', ['vcc', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-mosfet-common-source',
    'MOSFET 共源极放大器',
    '2N7000 用作小信号放大器：漏极电阻决定增益，源极电阻稳定偏置。交流耦合信号输入。',
    'advanced',
    [
      sigGen('vcc', 60, 40, { waveform: 'dc', offset: 12, amplitude: 0, frequency: 1 }),
      sigGen('src', 60, 260, { waveform: 'sine', frequency: 1000, amplitude: 0.1, offset: 0 }),
      res('rg1', 240, 40, '1000000'),
      res('rg2', 240, 200, '470000'),
      res('rd', 420, 40, '4700'),
      res('rs', 420, 300, '1000'),
      cap('cin', 220, 260, '10u'),
      mosN('m1', 380, 160),
      vmeter('vm', 560, 120),
    ],
    [
      w('w1', ['vcc', 'SIG'], ['rg1', '1'], C_PWR),
      w('w2', ['rg1', '2'], ['rg2', '1'], C_WIRE),
      w('w3', ['rg2', '2'], ['vcc', 'GND'], C_GND),
      w('w4', ['rg1', '2'], ['m1', 'G'], C_SIG),
      w('w5', ['vcc', 'SIG'], ['rd', '1'], C_PWR),
      w('w6', ['rd', '2'], ['m1', 'D'], C_OUT),
      w('w7', ['m1', 'S'], ['rs', '1'], C_WIRE),
      w('w8', ['rs', '2'], ['vcc', 'GND'], C_GND),
      w('w9', ['src', 'SIG'], ['cin', '1'], C_SIG),
      w('w10', ['cin', '2'], ['m1', 'G'], C_SIG),
      w('w11', ['src', 'GND'], ['vcc', 'GND'], C_GND),
      w('w12', ['m1', 'D'], ['vm', 'V+'], C_OUT),
      w('w13', ['vcc', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-mosfet-pmos-highside',
    'PMOS 高边开关',
    'P 沟道 MOSFET（IRF9540）在栅极被拉低至 VCC−|Vth| 以下时从 VCC 输出电流。非常适合负载开关应用。',
    'intermediate',
    [
      sigGen('vcc', 60, 40, { waveform: 'dc', offset: 12, amplitude: 0, frequency: 1 }),
      sigGen('ctrl', 60, 260, { waveform: 'square', frequency: 5, amplitude: 6, offset: 6 }),
      res('rg', 240, 220, '1000'),
      mosP('m1', 420, 140),
      res('rl', 540, 260, '220'),
      vmeter('vm', 680, 260),
    ],
    [
      w('w1', ['vcc', 'SIG'], ['m1', 'S'], C_PWR),
      w('w2', ['ctrl', 'SIG'], ['rg', '1'], C_SIG),
      w('w3', ['rg', '2'], ['m1', 'G'], C_SIG),
      w('w4', ['m1', 'D'], ['rl', '1'], C_OUT),
      w('w5', ['rl', '2'], ['vcc', 'GND'], C_GND),
      w('w6', ['ctrl', 'GND'], ['vcc', 'GND'], C_GND),
      w('w7', ['m1', 'D'], ['vm', 'V+'], C_OUT),
      w('w8', ['vcc', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  // ════════════════════════════════════════════════════════════════════════
  // 运算放大器  (24–30)
  // ════════════════════════════════════════════════════════════════════════

  analog(
    'an-opamp-inverting',
    '运放反相放大器',
    '增益 = −Rf/Rin。Rf = 10k，Rin = 1k → 增益 = −10。LM358 单电源模型将输出钳位在 [0, VCC−1.5] 范围内。',
    'intermediate',
    [
      sigGen('src', 60, 200, { waveform: 'sine', frequency: 500, amplitude: 0.2, offset: 2.5 }),
      res('rin', 240, 160, '1000'),
      res('rf', 420, 60, '10000'),
      opamp('u1', 400, 180),
      sigGen('vref', 60, 360, { waveform: 'dc', offset: 2.5, amplitude: 0, frequency: 1 }),
      vmeter('vm', 580, 180),
    ],
    [
      w('w1', ['src', 'SIG'], ['rin', '1'], C_SIG),
      w('w2', ['rin', '2'], ['u1', 'IN-'], C_SIG),
      w('w3', ['u1', 'IN-'], ['rf', '1'], C_SIG),
      w('w4', ['rf', '2'], ['u1', 'OUT'], C_OUT),
      w('w5', ['vref', 'SIG'], ['u1', 'IN+'], C_WIRE),
      w('w6', ['vref', 'GND'], ['src', 'GND'], C_GND),
      w('w7', ['u1', 'OUT'], ['vm', 'V+'], C_OUT),
      w('w8', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-opamp-non-inverting',
    '运放同相放大器',
    '增益 = 1 + Rf/Rg。Rf = 10k，Rg = 1k → 增益 = +11。输出与输入同相。',
    'intermediate',
    [
      sigGen('src', 60, 180, { waveform: 'sine', frequency: 500, amplitude: 0.1, offset: 2.5 }),
      opamp('u1', 280, 180),
      res('rf', 460, 80, '10000'),
      res('rg', 460, 280, '1000'),
      vmeter('vm', 600, 180),
    ],
    [
      w('w1', ['src', 'SIG'], ['u1', 'IN+'], C_SIG),
      w('w2', ['u1', 'OUT'], ['rf', '1'], C_OUT),
      w('w3', ['rf', '2'], ['u1', 'IN-'], C_WIRE),
      w('w4', ['u1', 'IN-'], ['rg', '1'], C_WIRE),
      w('w5', ['rg', '2'], ['src', 'GND'], C_GND),
      w('w6', ['u1', 'OUT'], ['vm', 'V+'], C_OUT),
      w('w7', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-opamp-follower',
    '运放电压跟随器',
    '单位增益缓冲器：输出精确跟随同相输入端。输入阻抗无穷大，输出阻抗接近零。',
    'beginner',
    [
      sigGen('src', 60, 180, { waveform: 'sine', frequency: 200, amplitude: 1, offset: 2.5 }),
      opamp('u1', 280, 180),
      res('rl', 460, 260, '1000'),
      vmeter('vm', 600, 180),
    ],
    [
      w('w1', ['src', 'SIG'], ['u1', 'IN+'], C_SIG),
      w('w2', ['u1', 'OUT'], ['u1', 'IN-'], C_WIRE),
      w('w3', ['u1', 'OUT'], ['rl', '1'], C_OUT),
      w('w4', ['rl', '2'], ['src', 'GND'], C_GND),
      w('w5', ['u1', 'OUT'], ['vm', 'V+'], C_OUT),
      w('w6', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-opamp-summing',
    '运放求和放大器',
    '虚地求和节点：V_out = −Rf · (V1/R1 + V2/R2)。双输入混音器，每通道单位增益。',
    'advanced',
    [
      sigGen('v1', 60, 100, { waveform: 'dc', offset: 1, amplitude: 0, frequency: 1 }),
      sigGen('v2', 60, 260, { waveform: 'dc', offset: 2, amplitude: 0, frequency: 1 }),
      res('r1', 240, 100, '10000'),
      res('r2', 240, 260, '10000'),
      res('rf', 420, 40, '10000'),
      opamp('u1', 420, 160),
      sigGen('vref', 60, 400, { waveform: 'dc', offset: 2.5, amplitude: 0, frequency: 1 }),
      vmeter('vm', 600, 180),
    ],
    [
      w('w1', ['v1', 'SIG'], ['r1', '1'], C_SIG),
      w('w2', ['v2', 'SIG'], ['r2', '1'], C_SIG),
      w('w3', ['r1', '2'], ['u1', 'IN-'], C_WIRE),
      w('w4', ['r2', '2'], ['u1', 'IN-'], C_WIRE),
      w('w5', ['u1', 'IN-'], ['rf', '1'], C_WIRE),
      w('w6', ['rf', '2'], ['u1', 'OUT'], C_OUT),
      w('w7', ['vref', 'SIG'], ['u1', 'IN+'], C_WIRE),
      w('w8', ['v1', 'GND'], ['v2', 'GND'], C_GND),
      w('w9', ['v2', 'GND'], ['vref', 'GND'], C_GND),
      w('w10', ['u1', 'OUT'], ['vm', 'V+'], C_OUT),
      w('w11', ['v1', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-opamp-integrator',
    '运放积分器',
    'Rf 替换为电容：V_out = −(1/RC) ∫V_in dt。方波输入 → 三角波输出。经典的模拟计算机基本模块。',
    'advanced',
    [
      sigGen('src', 60, 200, { waveform: 'square', frequency: 200, amplitude: 1, offset: 2.5 }),
      res('rin', 240, 160, '10000'),
      cap('cf', 420, 60, '100n'),
      opamp('u1', 400, 180),
      sigGen('vref', 60, 360, { waveform: 'dc', offset: 2.5, amplitude: 0, frequency: 1 }),
      vmeter('vm', 580, 180),
    ],
    [
      w('w1', ['src', 'SIG'], ['rin', '1'], C_SIG),
      w('w2', ['rin', '2'], ['u1', 'IN-'], C_SIG),
      w('w3', ['u1', 'IN-'], ['cf', '1'], C_SIG),
      w('w4', ['cf', '2'], ['u1', 'OUT'], C_OUT),
      w('w5', ['vref', 'SIG'], ['u1', 'IN+'], C_WIRE),
      w('w6', ['vref', 'GND'], ['src', 'GND'], C_GND),
      w('w7', ['u1', 'OUT'], ['vm', 'V+'], C_OUT),
      w('w8', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-opamp-comparator',
    '运放比较器',
    '开环运放将 V_in 与参考电压进行比较。IN+ > IN- 时输出饱和至高电平，反之饱和至低电平。',
    'intermediate',
    [
      sigGen('src', 60, 140, { waveform: 'sine', frequency: 100, amplitude: 2.5, offset: 2.5 }),
      sigGen('vref', 60, 300, { waveform: 'dc', offset: 2.5, amplitude: 0, frequency: 1 }),
      opamp('u1', 280, 200),
      res('rl', 460, 260, '10000'),
      vmeter('vm', 600, 200),
    ],
    [
      w('w1', ['src', 'SIG'], ['u1', 'IN+'], C_SIG),
      w('w2', ['vref', 'SIG'], ['u1', 'IN-'], C_WIRE),
      w('w3', ['u1', 'OUT'], ['rl', '1'], C_OUT),
      w('w4', ['rl', '2'], ['src', 'GND'], C_GND),
      w('w5', ['vref', 'GND'], ['src', 'GND'], C_GND),
      w('w6', ['u1', 'OUT'], ['vm', 'V+'], C_OUT),
      w('w7', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),

  analog(
    'an-schmitt-trigger',
    '运放施密特触发器',
    '正反馈（R2 从 OUT 到 IN+）引入迟滞：两个切换阈值而非一个。可消除含噪声信号的抖动。',
    'advanced',
    [
      sigGen('src', 60, 180, { waveform: 'sine', frequency: 100, amplitude: 2.5, offset: 2.5 }),
      sigGen('vref', 60, 360, { waveform: 'dc', offset: 2.5, amplitude: 0, frequency: 1 }),
      res('r1', 240, 220, '10000'),
      opamp('u1', 360, 180),
      res('r2', 520, 100, '10000'),
      vmeter('vm', 620, 220),
    ],
    [
      w('w1', ['src', 'SIG'], ['r1', '1'], C_SIG),
      w('w2', ['r1', '2'], ['u1', 'IN+'], C_SIG),
      w('w3', ['vref', 'SIG'], ['u1', 'IN-'], C_WIRE),
      w('w4', ['u1', 'OUT'], ['r2', '1'], C_OUT),
      w('w5', ['r2', '2'], ['u1', 'IN+'], C_SIG),
      w('w6', ['vref', 'GND'], ['src', 'GND'], C_GND),
      w('w7', ['u1', 'OUT'], ['vm', 'V+'], C_OUT),
      w('w8', ['src', 'GND'], ['vm', 'V-'], C_GND),
    ],
  ),
];
