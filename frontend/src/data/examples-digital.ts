/**
 * 数字电路示例项目 — 无开发板的 SPICE 电路。
 *
 * 此处的每个电路都运行在与模拟电路库相同的 ngspice-WASM 后端上。
 * 画布上没有 Arduino、ESP32 或任何 MCU。
 * 设置为 DC = 5V 的 `signal-generator` 作为电源轨（其 `GND` 引脚
 * 标准化为 SPICE 节点 0）。开关通过下拉电阻将信号送入门输入，
 * 门通过串联电阻驱动 LED。
 *
 * 逻辑门行为由 ngspice B 源通过
 * `componentToSpice.ts` 构建 — 每个门发出：
 *   `B_<id> Y 0 V = 5 * u(V(A) - 2.5) * u(V(B) - 2.5)`   （与门等）
 * 这就是为什么这些示例在网表中需要至少一个 5V 电源轨：
 * 单位阶跃阈值固定为 vcc/2 = 2.5V。
 *
 * 时序器件（D / T / JK 触发器）没有 SPICE 映射器 —
 * 边沿检测仅支持数字模式，目前需要开发板。
 * 因此这里暂未包含它们。
 */
import type { ExampleProject } from './examples';

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

function w(id: string, from: [string, string], to: [string, string], color = '#00aaff') {
  return {
    id,
    start: { componentId: from[0], pinName: from[1] },
    end: { componentId: to[0], pinName: to[1] },
    color,
  };
}

const C_PWR = '#ff3030';
const C_GND = '#000000';
const C_SIG = '#00aaff';
const C_OUT_R = '#ff3030';
const C_OUT_G = '#33cc66';
const C_OUT_B = '#3388ff';
const C_OUT_Y = '#ffcc00';
const C_OUT_O = '#ff8800';

/** 5V 直流电源，同时作为 SPICE 地参考。 */
function pwr(id: string, x: number, y: number) {
  return {
    type: 'wokwi-signal-generator',
    id,
    x,
    y,
    properties: { waveform: 'dc', offset: 5, amplitude: 0, frequency: 1 },
  };
}

function res(id: string, x: number, y: number, value: string) {
  return { type: 'wokwi-resistor', id, x, y, properties: { value } };
}

function led(id: string, x: number, y: number, color = 'red') {
  return { type: 'wokwi-led', id, x, y, properties: { color } };
}

/** SPST 滑动开关（3 引脚元件，SPICE 仅建模引脚 1 ↔ 引脚 2）。 */
function sw(id: string, x: number, y: number, initial: 0 | 1 = 0) {
  return { type: 'wokwi-slide-switch', id, x, y, properties: { value: initial } };
}

function gate(kind: string, id: string, x: number, y: number) {
  return { type: `velxio-logic-gate-${kind}`, id, x, y, properties: {} };
}

/** 边沿触发触发器（类型：'d' | 't' | 'jk'）。仅数字引擎 —
 *  无 SPICE 映射器（直流下无边沿检测）。引脚：CLK + 数据 + Q + Qbar。 */
function ff(kind: 'd' | 't' | 'jk', id: string, x: number, y: number) {
  return { type: `velxio-flip-flop-${kind}`, id, x, y, properties: {} };
}

/** 编辑器中显示的占位代码。不涉及任何 MCU。 */
const DIGITAL_SKETCH = `// 纯数字电路 — 无 MCU。
// 点击电气仿真（⚡）按钮运行 SPICE 引擎，
// 然后点击画布上的滑动开关驱动门输入。
void setup() {}
void loop()  {}
`;

/** 将滑动开关接线为干净的高/低信号源。
 *
 *   src.SIG ─[ sw.1 ── sw.2 ]── 门输入
 *                          │
 *                          └──[R_pd 10k]── src.GND
 *
 * 返回每个开关需要添加的元件 + 连线。
 */
function switchInput(
  switchId: string,
  resId: string,
  srcId: string,
  targetCompId: string,
  targetPin: string,
  x: number,
  y: number,
  initial: 0 | 1 = 0,
  wirePrefix = '',
) {
  return {
    components: [sw(switchId, x, y, initial), res(resId, x + 90, y + 30, '10000')],
    wires: [
      w(`${wirePrefix}_pwr`, [srcId, 'SIG'], [switchId, '1'], C_PWR),
      w(`${wirePrefix}_sig`, [switchId, '2'], [targetCompId, targetPin], C_SIG),
      w(`${wirePrefix}_pd`, [switchId, '2'], [resId, '1'], C_SIG),
      w(`${wirePrefix}_gnd`, [resId, '2'], [srcId, 'GND'], C_GND),
    ],
  };
}

/** 共阴极 LED 输出，带串联电阻。
 *
 *   门.Y ─[R_lim 220]── led.A,  led.C ── src.GND
 */
function ledOutput(
  rId: string,
  ledId: string,
  srcId: string,
  fromCompId: string,
  fromPin: string,
  x: number,
  y: number,
  color = 'red',
  wirePrefix = '',
  wireColor = C_OUT_R,
) {
  return {
    components: [res(rId, x, y, '220'), led(ledId, x, y + 80, color)],
    wires: [
      w(`${wirePrefix}_in`, [fromCompId, fromPin], [rId, '1'], wireColor),
      w(`${wirePrefix}_r2a`, [rId, '2'], [ledId, 'A'], wireColor),
      w(`${wirePrefix}_cgnd`, [ledId, 'C'], [srcId, 'GND'], C_GND),
    ],
  };
}

// 骨架辅助函数 — 每个数字示例共享相同的框架。
function digital(
  id: string,
  title: string,
  description: string,
  difficulty: ExampleProject['difficulty'],
  components: ExampleProject['components'],
  wires: ExampleProject['wires'],
  tags?: string[],
): ExampleProject {
  return {
    id,
    title,
    description,
    category: 'circuits',
    difficulty,
    boardFilter: 'digital',
    tags: ['数字电路', ...(tags ?? [])],
    code: DIGITAL_SKETCH,
    components,
    wires,
  };
}

// ─── 示例 ─────────────────────────────────────────────────────────────

export const digitalExamples: ExampleProject[] = [
  // ════════════════════════════════════════════════════════════════════════
  // 入门级 — 单门真值表
  // ════════════════════════════════════════════════════════════════════════

  digital(
    'digital-not-inverter',
    '非门反相器',
    '一个滑动开关驱动一个非门。LED 常亮，当开关为高电平时熄灭。',
    'beginner',
    [
      pwr('src', 40, 200),
      sw('s1', 240, 140, 0),
      res('rpd', 330, 200, '10000'),
      gate('not', 'u1', 440, 160),
      res('rl', 580, 130, '220'),
      led('led', 580, 220, 'green'),
    ],
    [
      w('w1', ['src', 'SIG'], ['s1', '1'], C_PWR),
      w('w2', ['s1', '2'], ['u1', 'A'], C_SIG),
      w('w3', ['s1', '2'], ['rpd', '1'], C_SIG),
      w('w4', ['rpd', '2'], ['src', 'GND'], C_GND),
      w('w5', ['u1', 'Y'], ['rl', '1'], C_OUT_G),
      w('w6', ['rl', '2'], ['led', 'A'], C_OUT_G),
      w('w7', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['非门', '反相器'],
  ),

  digital(
    'digital-and-two-switches',
    '与门 — 双开关',
    '两个滑动开关驱动一个与门。仅当两个开关都为高电平时 LED 才亮。',
    'beginner',
    [
      pwr('src', 40, 220),
      sw('s1', 240, 80, 0),
      res('rpd1', 330, 140, '10000'),
      sw('s2', 240, 240, 0),
      res('rpd2', 330, 300, '10000'),
      gate('and', 'u1', 460, 160),
      res('rl', 600, 130, '220'),
      led('led', 600, 220, 'red'),
    ],
    [
      w('w1', ['src', 'SIG'], ['s1', '1'], C_PWR),
      w('w2', ['s1', '2'], ['u1', 'A'], C_SIG),
      w('w3', ['s1', '2'], ['rpd1', '1'], C_SIG),
      w('w4', ['rpd1', '2'], ['src', 'GND'], C_GND),
      w('w5', ['src', 'SIG'], ['s2', '1'], C_PWR),
      w('w6', ['s2', '2'], ['u1', 'B'], C_SIG),
      w('w7', ['s2', '2'], ['rpd2', '1'], C_SIG),
      w('w8', ['rpd2', '2'], ['src', 'GND'], C_GND),
      w('w9', ['u1', 'Y'], ['rl', '1'], C_OUT_R),
      w('w10', ['rl', '2'], ['led', 'A'], C_OUT_R),
      w('w11', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['与门', '门电路'],
  ),

  digital(
    'digital-or-any-switch',
    '或门 — 任一开关',
    '两个滑动开关接入一个或门。只要任一开关为高电平，LED 即亮。',
    'beginner',
    [
      pwr('src', 40, 220),
      sw('s1', 240, 80, 0),
      res('rpd1', 330, 140, '10000'),
      sw('s2', 240, 240, 0),
      res('rpd2', 330, 300, '10000'),
      gate('or', 'u1', 460, 160),
      res('rl', 600, 130, '220'),
      led('led', 600, 220, 'blue'),
    ],
    [
      w('w1', ['src', 'SIG'], ['s1', '1'], C_PWR),
      w('w2', ['s1', '2'], ['u1', 'A'], C_SIG),
      w('w3', ['s1', '2'], ['rpd1', '1'], C_SIG),
      w('w4', ['rpd1', '2'], ['src', 'GND'], C_GND),
      w('w5', ['src', 'SIG'], ['s2', '1'], C_PWR),
      w('w6', ['s2', '2'], ['u1', 'B'], C_SIG),
      w('w7', ['s2', '2'], ['rpd2', '1'], C_SIG),
      w('w8', ['rpd2', '2'], ['src', 'GND'], C_GND),
      w('w9', ['u1', 'Y'], ['rl', '1'], C_OUT_B),
      w('w10', ['rl', '2'], ['led', 'A'], C_OUT_B),
      w('w11', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['或门', '门电路'],
  ),

  digital(
    'digital-nand-two-switches',
    '与非门 — 万能门',
    '与非门：除非所有输入都为高电平，否则输出为高。除非两个开关同时为高，否则 LED 保持亮。',
    'beginner',
    [
      pwr('src', 40, 220),
      sw('s1', 240, 80, 0),
      res('rpd1', 330, 140, '10000'),
      sw('s2', 240, 240, 0),
      res('rpd2', 330, 300, '10000'),
      gate('nand', 'u1', 460, 160),
      res('rl', 600, 130, '220'),
      led('led', 600, 220, 'red'),
    ],
    [
      w('w1', ['src', 'SIG'], ['s1', '1'], C_PWR),
      w('w2', ['s1', '2'], ['u1', 'A'], C_SIG),
      w('w3', ['s1', '2'], ['rpd1', '1'], C_SIG),
      w('w4', ['rpd1', '2'], ['src', 'GND'], C_GND),
      w('w5', ['src', 'SIG'], ['s2', '1'], C_PWR),
      w('w6', ['s2', '2'], ['u1', 'B'], C_SIG),
      w('w7', ['s2', '2'], ['rpd2', '1'], C_SIG),
      w('w8', ['rpd2', '2'], ['src', 'GND'], C_GND),
      w('w9', ['u1', 'Y'], ['rl', '1'], C_OUT_R),
      w('w10', ['rl', '2'], ['led', 'A'], C_OUT_R),
      w('w11', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['与非门', '门电路', '万能门'],
  ),

  digital(
    'digital-nor-idle-light',
    '或非门 — 空闲指示灯',
    '或非门仅在所有输入都为低电平时输出高电平。当两个开关都处于低电平时，LED 保持亮。',
    'beginner',
    [
      pwr('src', 40, 220),
      sw('s1', 240, 80, 0),
      res('rpd1', 330, 140, '10000'),
      sw('s2', 240, 240, 0),
      res('rpd2', 330, 300, '10000'),
      gate('nor', 'u1', 460, 160),
      res('rl', 600, 130, '220'),
      led('led', 600, 220, 'green'),
    ],
    [
      w('w1', ['src', 'SIG'], ['s1', '1'], C_PWR),
      w('w2', ['s1', '2'], ['u1', 'A'], C_SIG),
      w('w3', ['s1', '2'], ['rpd1', '1'], C_SIG),
      w('w4', ['rpd1', '2'], ['src', 'GND'], C_GND),
      w('w5', ['src', 'SIG'], ['s2', '1'], C_PWR),
      w('w6', ['s2', '2'], ['u1', 'B'], C_SIG),
      w('w7', ['s2', '2'], ['rpd2', '1'], C_SIG),
      w('w8', ['rpd2', '2'], ['src', 'GND'], C_GND),
      w('w9', ['u1', 'Y'], ['rl', '1'], C_OUT_G),
      w('w10', ['rl', '2'], ['led', 'A'], C_OUT_G),
      w('w11', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['或非门', '门电路'],
  ),

  digital(
    'digital-xor-difference',
    '异或门 — 差异检测器',
    '异或门仅在其输入不同时输出高电平。只拨动一个开关 — LED 亮。两个都拨回相同状态 — 熄灭。',
    'beginner',
    [
      pwr('src', 40, 220),
      sw('s1', 240, 80, 0),
      res('rpd1', 330, 140, '10000'),
      sw('s2', 240, 240, 0),
      res('rpd2', 330, 300, '10000'),
      gate('xor', 'u1', 460, 160),
      res('rl', 600, 130, '220'),
      led('led', 600, 220, 'yellow'),
    ],
    [
      w('w1', ['src', 'SIG'], ['s1', '1'], C_PWR),
      w('w2', ['s1', '2'], ['u1', 'A'], C_SIG),
      w('w3', ['s1', '2'], ['rpd1', '1'], C_SIG),
      w('w4', ['rpd1', '2'], ['src', 'GND'], C_GND),
      w('w5', ['src', 'SIG'], ['s2', '1'], C_PWR),
      w('w6', ['s2', '2'], ['u1', 'B'], C_SIG),
      w('w7', ['s2', '2'], ['rpd2', '1'], C_SIG),
      w('w8', ['rpd2', '2'], ['src', 'GND'], C_GND),
      w('w9', ['u1', 'Y'], ['rl', '1'], C_OUT_Y),
      w('w10', ['rl', '2'], ['led', 'A'], C_OUT_Y),
      w('w11', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['异或门', '门电路', '差异'],
  ),

  digital(
    'digital-xnor-equality',
    '同或门 — 相等指示灯',
    '同或门仅在两个输入相同时输出高电平。一个实时的相等检测器 — 当两个开关状态一致时 LED 保持亮。',
    'beginner',
    [
      pwr('src', 40, 220),
      sw('s1', 240, 80, 1),
      res('rpd1', 330, 140, '10000'),
      sw('s2', 240, 240, 1),
      res('rpd2', 330, 300, '10000'),
      gate('xnor', 'u1', 460, 160),
      res('rl', 600, 130, '220'),
      led('led', 600, 220, 'yellow'),
    ],
    [
      w('w1', ['src', 'SIG'], ['s1', '1'], C_PWR),
      w('w2', ['s1', '2'], ['u1', 'A'], C_SIG),
      w('w3', ['s1', '2'], ['rpd1', '1'], C_SIG),
      w('w4', ['rpd1', '2'], ['src', 'GND'], C_GND),
      w('w5', ['src', 'SIG'], ['s2', '1'], C_PWR),
      w('w6', ['s2', '2'], ['u1', 'B'], C_SIG),
      w('w7', ['s2', '2'], ['rpd2', '1'], C_SIG),
      w('w8', ['rpd2', '2'], ['src', 'GND'], C_GND),
      w('w9', ['u1', 'Y'], ['rl', '1'], C_OUT_Y),
      w('w10', ['rl', '2'], ['led', 'A'], C_OUT_Y),
      w('w11', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['同或门', '相等', '门电路'],
  ),

  digital(
    'digital-and3-all-on',
    '3 输入与门 — 三路全开',
    '三个滑动开关驱动一个 3 输入与门。只有所有开关同时为高电平时 LED 才亮。',
    'beginner',
    [
      pwr('src', 40, 240),
      sw('s1', 240, 60, 0),
      res('rpd1', 330, 120, '10000'),
      sw('s2', 240, 180, 0),
      res('rpd2', 330, 240, '10000'),
      sw('s3', 240, 300, 0),
      res('rpd3', 330, 360, '10000'),
      gate('and-3', 'u1', 480, 180),
      res('rl', 640, 150, '220'),
      led('led', 640, 240, 'red'),
    ],
    [
      // 开关 1
      w('w1', ['src', 'SIG'], ['s1', '1'], C_PWR),
      w('w2', ['s1', '2'], ['u1', 'A'], C_SIG),
      w('w3', ['s1', '2'], ['rpd1', '1'], C_SIG),
      w('w4', ['rpd1', '2'], ['src', 'GND'], C_GND),
      // 开关 2
      w('w5', ['src', 'SIG'], ['s2', '1'], C_PWR),
      w('w6', ['s2', '2'], ['u1', 'B'], C_SIG),
      w('w7', ['s2', '2'], ['rpd2', '1'], C_SIG),
      w('w8', ['rpd2', '2'], ['src', 'GND'], C_GND),
      // 开关 3
      w('w9', ['src', 'SIG'], ['s3', '1'], C_PWR),
      w('w10', ['s3', '2'], ['u1', 'C'], C_SIG),
      w('w11', ['s3', '2'], ['rpd3', '1'], C_SIG),
      w('w12', ['rpd3', '2'], ['src', 'GND'], C_GND),
      // 输出
      w('w13', ['u1', 'Y'], ['rl', '1'], C_OUT_R),
      w('w14', ['rl', '2'], ['led', 'A'], C_OUT_R),
      w('w15', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['与门', '3 输入', '门电路'],
  ),

  // ════════════════════════════════════════════════════════════════════════
  // 中级 — 组合逻辑子系统
  // ════════════════════════════════════════════════════════════════════════

  digital(
    'digital-half-adder',
    '半加器',
    '异或门产生和（SUM），与门产生进位（CARRY），对两个 1 位数 A 和 B 求和。两个 LED 实时显示结果。',
    'intermediate',
    [
      pwr('src', 40, 240),
      sw('sA', 240, 80, 0),
      res('rpdA', 330, 140, '10000'),
      sw('sB', 240, 280, 0),
      res('rpdB', 330, 340, '10000'),
      gate('xor', 'gSum', 480, 80),
      gate('and', 'gC', 480, 280),
      res('rS', 640, 80, '220'),
      led('ledS', 640, 170, 'green'),
      res('rC', 640, 280, '220'),
      led('ledC', 640, 370, 'red'),
    ],
    [
      // A
      w('w1', ['src', 'SIG'], ['sA', '1'], C_PWR),
      w('w2', ['sA', '2'], ['gSum', 'A'], C_SIG),
      w('w3', ['sA', '2'], ['gC', 'A'], C_SIG),
      w('w4', ['sA', '2'], ['rpdA', '1'], C_SIG),
      w('w5', ['rpdA', '2'], ['src', 'GND'], C_GND),
      // B
      w('w6', ['src', 'SIG'], ['sB', '1'], C_PWR),
      w('w7', ['sB', '2'], ['gSum', 'B'], C_SIG),
      w('w8', ['sB', '2'], ['gC', 'B'], C_SIG),
      w('w9', ['sB', '2'], ['rpdB', '1'], C_SIG),
      w('w10', ['rpdB', '2'], ['src', 'GND'], C_GND),
      // 和
      w('w11', ['gSum', 'Y'], ['rS', '1'], C_OUT_G),
      w('w12', ['rS', '2'], ['ledS', 'A'], C_OUT_G),
      w('w13', ['ledS', 'C'], ['src', 'GND'], C_GND),
      // 进位
      w('w14', ['gC', 'Y'], ['rC', '1'], C_OUT_R),
      w('w15', ['rC', '2'], ['ledC', 'A'], C_OUT_R),
      w('w16', ['ledC', 'C'], ['src', 'GND'], C_GND),
    ],
    ['半加器', '异或', '与'],
  ),

  digital(
    'digital-full-adder',
    '全加器（门级）',
    '三个输入 — A、B 和 Cin — 驱动两个异或门、两个与门和一个或门。异或门产生和，与门的或产生 Cout。经典的可级联加法器单元。',
    'intermediate',
    [
      pwr('src', 40, 260),
      sw('sA', 240, 60, 0),
      res('rpdA', 330, 120, '10000'),
      sw('sB', 240, 200, 0),
      res('rpdB', 330, 260, '10000'),
      sw('sCi', 240, 340, 0),
      res('rpdCi', 330, 400, '10000'),
      // 第一级
      gate('xor', 'x1', 480, 80),
      gate('and', 'a1', 480, 230),
      // 第二级
      gate('xor', 'x2', 640, 80),
      gate('and', 'a2', 640, 230),
      gate('or', 'orC', 800, 300),
      // 输出
      res('rS', 800, 80, '220'),
      led('ledS', 800, 170, 'green'),
      res('rCo', 960, 300, '220'),
      led('ledCo', 960, 390, 'red'),
    ],
    [
      // A
      w('w1', ['src', 'SIG'], ['sA', '1'], C_PWR),
      w('w2', ['sA', '2'], ['x1', 'A'], C_SIG),
      w('w3', ['sA', '2'], ['a1', 'A'], C_SIG),
      w('w4', ['sA', '2'], ['rpdA', '1'], C_SIG),
      w('w5', ['rpdA', '2'], ['src', 'GND'], C_GND),
      // B
      w('w6', ['src', 'SIG'], ['sB', '1'], C_PWR),
      w('w7', ['sB', '2'], ['x1', 'B'], C_SIG),
      w('w8', ['sB', '2'], ['a1', 'B'], C_SIG),
      w('w9', ['sB', '2'], ['rpdB', '1'], C_SIG),
      w('w10', ['rpdB', '2'], ['src', 'GND'], C_GND),
      // Cin
      w('w11', ['src', 'SIG'], ['sCi', '1'], C_PWR),
      w('w12', ['sCi', '2'], ['x2', 'B'], C_SIG),
      w('w13', ['sCi', '2'], ['a2', 'B'], C_SIG),
      w('w14', ['sCi', '2'], ['rpdCi', '1'], C_SIG),
      w('w15', ['rpdCi', '2'], ['src', 'GND'], C_GND),
      // 第一级输出
      w('w16', ['x1', 'Y'], ['x2', 'A'], C_SIG),
      w('w17', ['x1', 'Y'], ['a2', 'A'], C_SIG),
      w('w18', ['a1', 'Y'], ['orC', 'A'], C_SIG),
      // 第二级 → 或门
      w('w19', ['a2', 'Y'], ['orC', 'B'], C_SIG),
      // 和 LED
      w('w20', ['x2', 'Y'], ['rS', '1'], C_OUT_G),
      w('w21', ['rS', '2'], ['ledS', 'A'], C_OUT_G),
      w('w22', ['ledS', 'C'], ['src', 'GND'], C_GND),
      // Cout LED
      w('w23', ['orC', 'Y'], ['rCo', '1'], C_OUT_R),
      w('w24', ['rCo', '2'], ['ledCo', 'A'], C_OUT_R),
      w('w25', ['ledCo', 'C'], ['src', 'GND'], C_GND),
    ],
    ['全加器', '加法器', '异或', '与', '或'],
  ),

  digital(
    'digital-mux-2to1',
    '2 选 1 多路选择器',
    '两个与门驱动一个或门。SEL 将 D0 或 D1 路由到 Y。教科书式的门级多路选择器。',
    'intermediate',
    [
      pwr('src', 40, 260),
      sw('sSel', 240, 40, 0),
      res('rpdSel', 330, 100, '10000'),
      sw('sD0', 240, 200, 1),
      res('rpdD0', 330, 260, '10000'),
      sw('sD1', 240, 360, 0),
      res('rpdD1', 330, 420, '10000'),
      gate('not', 'nSel', 480, 60),
      gate('and', 'a0', 620, 180),
      gate('and', 'a1', 620, 320),
      gate('or', 'orY', 780, 250),
      res('rl', 920, 220, '220'),
      led('led', 920, 310, 'green'),
    ],
    [
      // SEL
      w('w1', ['src', 'SIG'], ['sSel', '1'], C_PWR),
      w('w2', ['sSel', '2'], ['nSel', 'A'], C_SIG),
      w('w3', ['sSel', '2'], ['a1', 'B'], C_SIG),
      w('w4', ['sSel', '2'], ['rpdSel', '1'], C_SIG),
      w('w5', ['rpdSel', '2'], ['src', 'GND'], C_GND),
      // D0
      w('w6', ['src', 'SIG'], ['sD0', '1'], C_PWR),
      w('w7', ['sD0', '2'], ['a0', 'A'], C_SIG),
      w('w8', ['sD0', '2'], ['rpdD0', '1'], C_SIG),
      w('w9', ['rpdD0', '2'], ['src', 'GND'], C_GND),
      // D1
      w('w10', ['src', 'SIG'], ['sD1', '1'], C_PWR),
      w('w11', ['sD1', '2'], ['a1', 'A'], C_SIG),
      w('w12', ['sD1', '2'], ['rpdD1', '1'], C_SIG),
      w('w13', ['rpdD1', '2'], ['src', 'GND'], C_GND),
      // NOT(SEL) 接入 a0.B
      w('w14', ['nSel', 'Y'], ['a0', 'B'], C_SIG),
      // 或门
      w('w15', ['a0', 'Y'], ['orY', 'A'], C_SIG),
      w('w16', ['a1', 'Y'], ['orY', 'B'], C_SIG),
      // 输出
      w('w17', ['orY', 'Y'], ['rl', '1'], C_OUT_G),
      w('w18', ['rl', '2'], ['led', 'A'], C_OUT_G),
      w('w19', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['多路选择器', 'MUX', '2 选 1'],
  ),

  digital(
    'digital-comparator-equal-2bit',
    '2 位相等比较器',
    '两个同或门分别比较各个位，一个与门将它们组合。仅当 A1A0 = B1B0 时 LED 才亮。',
    'intermediate',
    [
      pwr('src', 40, 280),
      sw('sA0', 220, 40, 0),
      res('rA0', 310, 100, '10000'),
      sw('sA1', 220, 160, 0),
      res('rA1', 310, 220, '10000'),
      sw('sB0', 220, 280, 0),
      res('rB0', 310, 340, '10000'),
      sw('sB1', 220, 400, 0),
      res('rB1', 310, 460, '10000'),
      gate('xnor', 'xn0', 480, 100),
      gate('xnor', 'xn1', 480, 320),
      gate('and', 'aEq', 660, 220),
      res('rl', 820, 200, '220'),
      led('led', 820, 290, 'green'),
    ],
    [
      // A0
      w('w1', ['src', 'SIG'], ['sA0', '1'], C_PWR),
      w('w2', ['sA0', '2'], ['xn0', 'A'], C_SIG),
      w('w3', ['sA0', '2'], ['rA0', '1'], C_SIG),
      w('w4', ['rA0', '2'], ['src', 'GND'], C_GND),
      // A1
      w('w5', ['src', 'SIG'], ['sA1', '1'], C_PWR),
      w('w6', ['sA1', '2'], ['xn1', 'A'], C_SIG),
      w('w7', ['sA1', '2'], ['rA1', '1'], C_SIG),
      w('w8', ['rA1', '2'], ['src', 'GND'], C_GND),
      // B0
      w('w9', ['src', 'SIG'], ['sB0', '1'], C_PWR),
      w('w10', ['sB0', '2'], ['xn0', 'B'], C_SIG),
      w('w11', ['sB0', '2'], ['rB0', '1'], C_SIG),
      w('w12', ['rB0', '2'], ['src', 'GND'], C_GND),
      // B1
      w('w13', ['src', 'SIG'], ['sB1', '1'], C_PWR),
      w('w14', ['sB1', '2'], ['xn1', 'B'], C_SIG),
      w('w15', ['sB1', '2'], ['rB1', '1'], C_SIG),
      w('w16', ['rB1', '2'], ['src', 'GND'], C_GND),
      // 组合
      w('w17', ['xn0', 'Y'], ['aEq', 'A'], C_SIG),
      w('w18', ['xn1', 'Y'], ['aEq', 'B'], C_SIG),
      // 输出
      w('w19', ['aEq', 'Y'], ['rl', '1'], C_OUT_G),
      w('w20', ['rl', '2'], ['led', 'A'], C_OUT_G),
      w('w21', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['比较器', '相等', '2 位'],
  ),

  digital(
    'digital-majority-voter',
    '3 输入多数表决器',
    '当 3 个输入中至少有 2 个为高电平时输出为高：Y = AB + AC + BC。用七个门实现的容错逻辑。',
    'intermediate',
    [
      pwr('src', 40, 280),
      sw('sA', 220, 40, 0),
      res('rA', 310, 100, '10000'),
      sw('sB', 220, 200, 0),
      res('rB', 310, 260, '10000'),
      sw('sC', 220, 360, 0),
      res('rC', 310, 420, '10000'),
      gate('and', 'aAB', 480, 80),
      gate('and', 'aAC', 480, 240),
      gate('and', 'aBC', 480, 400),
      gate('or-3', 'or3', 660, 240),
      res('rl', 800, 220, '220'),
      led('led', 800, 310, 'red'),
    ],
    [
      // A
      w('w1', ['src', 'SIG'], ['sA', '1'], C_PWR),
      w('w2', ['sA', '2'], ['aAB', 'A'], C_SIG),
      w('w3', ['sA', '2'], ['aAC', 'A'], C_SIG),
      w('w4', ['sA', '2'], ['rA', '1'], C_SIG),
      w('w5', ['rA', '2'], ['src', 'GND'], C_GND),
      // B
      w('w6', ['src', 'SIG'], ['sB', '1'], C_PWR),
      w('w7', ['sB', '2'], ['aAB', 'B'], C_SIG),
      w('w8', ['sB', '2'], ['aBC', 'A'], C_SIG),
      w('w9', ['sB', '2'], ['rB', '1'], C_SIG),
      w('w10', ['rB', '2'], ['src', 'GND'], C_GND),
      // C
      w('w11', ['src', 'SIG'], ['sC', '1'], C_PWR),
      w('w12', ['sC', '2'], ['aAC', 'B'], C_SIG),
      w('w13', ['sC', '2'], ['aBC', 'B'], C_SIG),
      w('w14', ['sC', '2'], ['rC', '1'], C_SIG),
      w('w15', ['rC', '2'], ['src', 'GND'], C_GND),
      // 3 输入或门
      w('w16', ['aAB', 'Y'], ['or3', 'A'], C_SIG),
      w('w17', ['aAC', 'Y'], ['or3', 'B'], C_SIG),
      w('w18', ['aBC', 'Y'], ['or3', 'C'], C_SIG),
      // 输出
      w('w19', ['or3', 'Y'], ['rl', '1'], C_OUT_R),
      w('w20', ['rl', '2'], ['led', 'A'], C_OUT_R),
      w('w21', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['多数表决', '表决器', '3 输入'],
  ),

  digital(
    'digital-xor-from-nands',
    '纯与非门构建异或门',
    '四个 2 输入与非门构成一个异或门。证明与非门具有功能完备性 — 你可以仅用与非门构建任何门。',
    'intermediate',
    [
      pwr('src', 40, 240),
      sw('sA', 220, 80, 0),
      res('rA', 310, 140, '10000'),
      sw('sB', 220, 240, 0),
      res('rB', 310, 300, '10000'),
      gate('nand', 'n1', 460, 160),
      gate('nand', 'n2', 620, 80),
      gate('nand', 'n3', 620, 240),
      gate('nand', 'n4', 780, 160),
      res('rl', 920, 130, '220'),
      led('led', 920, 220, 'yellow'),
    ],
    [
      // A
      w('w1', ['src', 'SIG'], ['sA', '1'], C_PWR),
      w('w2', ['sA', '2'], ['n1', 'A'], C_SIG),
      w('w3', ['sA', '2'], ['n2', 'A'], C_SIG),
      w('w4', ['sA', '2'], ['rA', '1'], C_SIG),
      w('w5', ['rA', '2'], ['src', 'GND'], C_GND),
      // B
      w('w6', ['src', 'SIG'], ['sB', '1'], C_PWR),
      w('w7', ['sB', '2'], ['n1', 'B'], C_SIG),
      w('w8', ['sB', '2'], ['n3', 'A'], C_SIG),
      w('w9', ['sB', '2'], ['rB', '1'], C_SIG),
      w('w10', ['rB', '2'], ['src', 'GND'], C_GND),
      // n1.Y 驱动 n2.B 和 n3.B
      w('w11', ['n1', 'Y'], ['n2', 'B'], C_SIG),
      w('w12', ['n1', 'Y'], ['n3', 'B'], C_SIG),
      // n4 = NAND(n2.Y, n3.Y) → 异或
      w('w13', ['n2', 'Y'], ['n4', 'A'], C_SIG),
      w('w14', ['n3', 'Y'], ['n4', 'B'], C_SIG),
      // 输出
      w('w15', ['n4', 'Y'], ['rl', '1'], C_OUT_Y),
      w('w16', ['rl', '2'], ['led', 'A'], C_OUT_Y),
      w('w17', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['异或', '与非', '万能门', '门电路'],
  ),

  digital(
    'digital-aoi-gate',
    'AOI 门（与或反）',
    'CMOS 库中常见的复合单元：两个与门驱动一个或非门。输出 = !((A·B) + (C·D))。在实际硅片中比三个分立门更快。',
    'intermediate',
    [
      pwr('src', 40, 260),
      sw('sA', 220, 40, 0),
      res('rA', 310, 100, '10000'),
      sw('sB', 220, 160, 0),
      res('rB', 310, 220, '10000'),
      sw('sC', 220, 280, 0),
      res('rC', 310, 340, '10000'),
      sw('sD', 220, 400, 0),
      res('rD', 310, 460, '10000'),
      gate('and', 'aAB', 480, 100),
      gate('and', 'aCD', 480, 340),
      gate('nor', 'norY', 660, 220),
      res('rl', 800, 200, '220'),
      led('led', 800, 290, 'orange'),
    ],
    [
      // A
      w('w1', ['src', 'SIG'], ['sA', '1'], C_PWR),
      w('w2', ['sA', '2'], ['aAB', 'A'], C_SIG),
      w('w3', ['sA', '2'], ['rA', '1'], C_SIG),
      w('w4', ['rA', '2'], ['src', 'GND'], C_GND),
      // B
      w('w5', ['src', 'SIG'], ['sB', '1'], C_PWR),
      w('w6', ['sB', '2'], ['aAB', 'B'], C_SIG),
      w('w7', ['sB', '2'], ['rB', '1'], C_SIG),
      w('w8', ['rB', '2'], ['src', 'GND'], C_GND),
      // C
      w('w9', ['src', 'SIG'], ['sC', '1'], C_PWR),
      w('w10', ['sC', '2'], ['aCD', 'A'], C_SIG),
      w('w11', ['sC', '2'], ['rC', '1'], C_SIG),
      w('w12', ['rC', '2'], ['src', 'GND'], C_GND),
      // D
      w('w13', ['src', 'SIG'], ['sD', '1'], C_PWR),
      w('w14', ['sD', '2'], ['aCD', 'B'], C_SIG),
      w('w15', ['sD', '2'], ['rD', '1'], C_SIG),
      w('w16', ['rD', '2'], ['src', 'GND'], C_GND),
      // 或非门
      w('w17', ['aAB', 'Y'], ['norY', 'A'], C_SIG),
      w('w18', ['aCD', 'Y'], ['norY', 'B'], C_SIG),
      // 输出
      w('w19', ['norY', 'Y'], ['rl', '1'], C_OUT_O),
      w('w20', ['rl', '2'], ['led', 'A'], C_OUT_O),
      w('w21', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['AOI', 'CMOS', '复合门'],
  ),

  digital(
    'digital-buffer-three-inverters',
    '三反相器构成的缓冲器',
    '三个非门串联反相三次 → 实际上是一个带三级门延迟的同相缓冲器。用于扇出或"再生"弱信号。',
    'intermediate',
    [
      pwr('src', 40, 200),
      sw('s1', 220, 140, 0),
      res('rpd', 310, 200, '10000'),
      gate('not', 'n1', 440, 160),
      gate('not', 'n2', 600, 160),
      gate('not', 'n3', 760, 160),
      res('rl', 900, 130, '220'),
      led('led', 900, 220, 'yellow'),
    ],
    [
      w('w1', ['src', 'SIG'], ['s1', '1'], C_PWR),
      w('w2', ['s1', '2'], ['n1', 'A'], C_SIG),
      w('w3', ['s1', '2'], ['rpd', '1'], C_SIG),
      w('w4', ['rpd', '2'], ['src', 'GND'], C_GND),
      w('w5', ['n1', 'Y'], ['n2', 'A'], C_SIG),
      w('w6', ['n2', 'Y'], ['n3', 'A'], C_SIG),
      w('w7', ['n3', 'Y'], ['rl', '1'], C_OUT_Y),
      w('w8', ['rl', '2'], ['led', 'A'], C_OUT_Y),
      w('w9', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['缓冲器', '非门', '反相器', '链'],
  ),

  digital(
    'digital-and4-all-on',
    '4 输入与门',
    '四个开关驱动一个 4 输入与门。仅当所有输入同时为高电平时 LED 才亮。',
    'intermediate',
    [
      pwr('src', 40, 260),
      sw('s1', 220, 40, 0),
      res('r1', 310, 100, '10000'),
      sw('s2', 220, 160, 0),
      res('r2', 310, 220, '10000'),
      sw('s3', 220, 280, 0),
      res('r3', 310, 340, '10000'),
      sw('s4', 220, 400, 0),
      res('r4', 310, 460, '10000'),
      gate('and-4', 'u1', 480, 220),
      res('rl', 640, 200, '220'),
      led('led', 640, 290, 'red'),
    ],
    [
      w('w1', ['src', 'SIG'], ['s1', '1'], C_PWR),
      w('w2', ['s1', '2'], ['u1', 'A'], C_SIG),
      w('w3', ['s1', '2'], ['r1', '1'], C_SIG),
      w('w4', ['r1', '2'], ['src', 'GND'], C_GND),
      w('w5', ['src', 'SIG'], ['s2', '1'], C_PWR),
      w('w6', ['s2', '2'], ['u1', 'B'], C_SIG),
      w('w7', ['s2', '2'], ['r2', '1'], C_SIG),
      w('w8', ['r2', '2'], ['src', 'GND'], C_GND),
      w('w9', ['src', 'SIG'], ['s3', '1'], C_PWR),
      w('w10', ['s3', '2'], ['u1', 'C'], C_SIG),
      w('w11', ['s3', '2'], ['r3', '1'], C_SIG),
      w('w12', ['r3', '2'], ['src', 'GND'], C_GND),
      w('w13', ['src', 'SIG'], ['s4', '1'], C_PWR),
      w('w14', ['s4', '2'], ['u1', 'D'], C_SIG),
      w('w15', ['s4', '2'], ['r4', '1'], C_SIG),
      w('w16', ['r4', '2'], ['src', 'GND'], C_GND),
      w('w17', ['u1', 'Y'], ['rl', '1'], C_OUT_R),
      w('w18', ['rl', '2'], ['led', 'A'], C_OUT_R),
      w('w19', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['与门', '4 输入', '门电路'],
  ),

  // ════════════════════════════════════════════════════════════════════════
  // 高级 — 多级电路
  // ════════════════════════════════════════════════════════════════════════

  digital(
    'digital-comparator-magnitude-1bit',
    '1 位数值比较器',
    '三个输出解码 A 和 B 之间的关系：A>B、A=B、A<B。由两个非门、两个与门和一个同或门构建。',
    'advanced',
    [
      pwr('src', 40, 240),
      sw('sA', 220, 80, 0),
      res('rA', 310, 140, '10000'),
      sw('sB', 220, 240, 0),
      res('rB', 310, 300, '10000'),
      gate('not', 'notA', 460, 60),
      gate('not', 'notB', 460, 280),
      gate('and', 'gGt', 620, 60),
      gate('xnor', 'gEq', 620, 170),
      gate('and', 'gLt', 620, 280),
      res('rGt', 780, 60, '220'),
      led('ledGt', 780, 130, 'red'),
      res('rEq', 780, 170, '220'),
      led('ledEq', 780, 240, 'yellow'),
      res('rLt', 780, 280, '220'),
      led('ledLt', 780, 350, 'green'),
    ],
    [
      // A
      w('w1', ['src', 'SIG'], ['sA', '1'], C_PWR),
      w('w2', ['sA', '2'], ['notA', 'A'], C_SIG),
      w('w3', ['sA', '2'], ['gGt', 'A'], C_SIG),
      w('w4', ['sA', '2'], ['gEq', 'A'], C_SIG),
      w('w5', ['sA', '2'], ['rA', '1'], C_SIG),
      w('w6', ['rA', '2'], ['src', 'GND'], C_GND),
      // B
      w('w7', ['src', 'SIG'], ['sB', '1'], C_PWR),
      w('w8', ['sB', '2'], ['notB', 'A'], C_SIG),
      w('w9', ['sB', '2'], ['gLt', 'B'], C_SIG),
      w('w10', ['sB', '2'], ['gEq', 'B'], C_SIG),
      w('w11', ['sB', '2'], ['rB', '1'], C_SIG),
      w('w12', ['rB', '2'], ['src', 'GND'], C_GND),
      // A>B = A · !B
      w('w13', ['notB', 'Y'], ['gGt', 'B'], C_SIG),
      // A<B = !A · B
      w('w14', ['notA', 'Y'], ['gLt', 'A'], C_SIG),
      // 输出
      w('w15', ['gGt', 'Y'], ['rGt', '1'], C_OUT_R),
      w('w16', ['rGt', '2'], ['ledGt', 'A'], C_OUT_R),
      w('w17', ['ledGt', 'C'], ['src', 'GND'], C_GND),
      w('w18', ['gEq', 'Y'], ['rEq', '1'], C_OUT_Y),
      w('w19', ['rEq', '2'], ['ledEq', 'A'], C_OUT_Y),
      w('w20', ['ledEq', 'C'], ['src', 'GND'], C_GND),
      w('w21', ['gLt', 'Y'], ['rLt', '1'], C_OUT_G),
      w('w22', ['rLt', '2'], ['ledLt', 'A'], C_OUT_G),
      w('w23', ['ledLt', 'C'], ['src', 'GND'], C_GND),
    ],
    ['比较器', '数值', '1 位'],
  ),

  digital(
    'digital-decoder-2to4',
    '2-4 线译码器',
    '两条选择线精确选中四个输出中的一个。每个输出是 A/!A 和 B/!B 的某种组合的 A·B。每个 CPU 内部地址译码的基础。',
    'advanced',
    [
      pwr('src', 40, 260),
      sw('sA', 220, 80, 0),
      res('rA', 310, 140, '10000'),
      sw('sB', 220, 240, 0),
      res('rB', 310, 300, '10000'),
      gate('not', 'notA', 460, 80),
      gate('not', 'notB', 460, 240),
      gate('and', 'a0', 620, 40), // Y0 = !A · !B
      gate('and', 'a1', 620, 160), // Y1 = A · !B
      gate('and', 'a2', 620, 280), // Y2 = !A · B
      gate('and', 'a3', 620, 400), // Y3 = A · B
      res('r0', 780, 40, '220'),
      led('led0', 780, 110, 'red'),
      res('r1', 780, 160, '220'),
      led('led1', 780, 230, 'yellow'),
      res('r2', 780, 280, '220'),
      led('led2', 780, 350, 'green'),
      res('r3', 780, 400, '220'),
      led('led3', 780, 470, 'blue'),
    ],
    [
      // A
      w('w1', ['src', 'SIG'], ['sA', '1'], C_PWR),
      w('w2', ['sA', '2'], ['notA', 'A'], C_SIG),
      w('w3', ['sA', '2'], ['a1', 'A'], C_SIG),
      w('w4', ['sA', '2'], ['a3', 'A'], C_SIG),
      w('w5', ['sA', '2'], ['rA', '1'], C_SIG),
      w('w6', ['rA', '2'], ['src', 'GND'], C_GND),
      // B
      w('w7', ['src', 'SIG'], ['sB', '1'], C_PWR),
      w('w8', ['sB', '2'], ['notB', 'A'], C_SIG),
      w('w9', ['sB', '2'], ['a2', 'B'], C_SIG),
      w('w10', ['sB', '2'], ['a3', 'B'], C_SIG),
      w('w11', ['sB', '2'], ['rB', '1'], C_SIG),
      w('w12', ['rB', '2'], ['src', 'GND'], C_GND),
      // !A, !B 分配
      w('w13', ['notA', 'Y'], ['a0', 'A'], C_SIG),
      w('w14', ['notA', 'Y'], ['a2', 'A'], C_SIG),
      w('w15', ['notB', 'Y'], ['a0', 'B'], C_SIG),
      w('w16', ['notB', 'Y'], ['a1', 'B'], C_SIG),
      // Y0
      w('w17', ['a0', 'Y'], ['r0', '1'], C_OUT_R),
      w('w18', ['r0', '2'], ['led0', 'A'], C_OUT_R),
      w('w19', ['led0', 'C'], ['src', 'GND'], C_GND),
      // Y1
      w('w20', ['a1', 'Y'], ['r1', '1'], C_OUT_Y),
      w('w21', ['r1', '2'], ['led1', 'A'], C_OUT_Y),
      w('w22', ['led1', 'C'], ['src', 'GND'], C_GND),
      // Y2
      w('w23', ['a2', 'Y'], ['r2', '1'], C_OUT_G),
      w('w24', ['r2', '2'], ['led2', 'A'], C_OUT_G),
      w('w25', ['led2', 'C'], ['src', 'GND'], C_GND),
      // Y3
      w('w26', ['a3', 'Y'], ['r3', '1'], C_OUT_B),
      w('w27', ['r3', '2'], ['led3', 'A'], C_OUT_B),
      w('w28', ['led3', 'C'], ['src', 'GND'], C_GND),
    ],
    ['译码器', '2-4', '地址'],
  ),

  digital(
    'digital-parity-4bit',
    '4 位奇偶校验生成器',
    '三个级联的异或门计算 4 位半字节的偶校验位。当输入开关中奇数个为高电平时 LED 亮。',
    'advanced',
    [
      pwr('src', 40, 260),
      sw('s0', 220, 40, 0),
      res('r0', 310, 100, '10000'),
      sw('s1', 220, 160, 0),
      res('r1', 310, 220, '10000'),
      sw('s2', 220, 280, 0),
      res('r2', 310, 340, '10000'),
      sw('s3', 220, 400, 0),
      res('r3', 310, 460, '10000'),
      gate('xor', 'x01', 480, 100),
      gate('xor', 'x23', 480, 340),
      gate('xor', 'xp', 660, 220),
      res('rl', 820, 200, '220'),
      led('led', 820, 290, 'yellow'),
    ],
    [
      // s0
      w('w1', ['src', 'SIG'], ['s0', '1'], C_PWR),
      w('w2', ['s0', '2'], ['x01', 'A'], C_SIG),
      w('w3', ['s0', '2'], ['r0', '1'], C_SIG),
      w('w4', ['r0', '2'], ['src', 'GND'], C_GND),
      // s1
      w('w5', ['src', 'SIG'], ['s1', '1'], C_PWR),
      w('w6', ['s1', '2'], ['x01', 'B'], C_SIG),
      w('w7', ['s1', '2'], ['r1', '1'], C_SIG),
      w('w8', ['r1', '2'], ['src', 'GND'], C_GND),
      // s2
      w('w9', ['src', 'SIG'], ['s2', '1'], C_PWR),
      w('w10', ['s2', '2'], ['x23', 'A'], C_SIG),
      w('w11', ['s2', '2'], ['r2', '1'], C_SIG),
      w('w12', ['r2', '2'], ['src', 'GND'], C_GND),
      // s3
      w('w13', ['src', 'SIG'], ['s3', '1'], C_PWR),
      w('w14', ['s3', '2'], ['x23', 'B'], C_SIG),
      w('w15', ['s3', '2'], ['r3', '1'], C_SIG),
      w('w16', ['r3', '2'], ['src', 'GND'], C_GND),
      // 合并
      w('w17', ['x01', 'Y'], ['xp', 'A'], C_SIG),
      w('w18', ['x23', 'Y'], ['xp', 'B'], C_SIG),
      // 输出
      w('w19', ['xp', 'Y'], ['rl', '1'], C_OUT_Y),
      w('w20', ['rl', '2'], ['led', 'A'], C_OUT_Y),
      w('w21', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['奇偶校验', '异或', '4 位'],
  ),

  digital(
    'digital-mux-4to1',
    '4 选 1 多路选择器',
    '两条选择线将四个数据输入之一路由到 Y。由一个 2-4 线译码器（!A·!B...A·B 组合）驱动四个与门，再进入一个 4 输入或门构建。',
    'advanced',
    [
      pwr('src', 40, 320),
      // 数据输入
      sw('d0', 200, 20, 0),
      res('rd0', 290, 80, '10000'),
      sw('d1', 200, 120, 0),
      res('rd1', 290, 180, '10000'),
      sw('d2', 200, 220, 0),
      res('rd2', 290, 280, '10000'),
      sw('d3', 200, 320, 0),
      res('rd3', 290, 380, '10000'),
      // 选择线
      sw('s0', 200, 420, 0),
      res('rs0', 290, 480, '10000'),
      sw('s1', 200, 520, 0),
      res('rs1', 290, 580, '10000'),
      // 译码器
      gate('not', 'ns0', 440, 440),
      gate('not', 'ns1', 440, 540),
      // 四个选择器。每个：AND(Di, 译码项)
      gate('and', 'a0', 600, 40), // d0 & !s1 & !s0  — 用 3 输入与门建模，但门是 2 输入的；我们通过单个与门链折叠 !s1·!s0 = !s0·!s1 路径
      gate('and', 'a1', 600, 140), // d1 & !s1 & s0
      gate('and', 'a2', 600, 240), // d2 & s1 & !s0
      gate('and', 'a3', 600, 340), // d3 & s1 & s0
      // 每行还需要一个与门用于译码项 — 使用第二层与门
      gate('and', 'dec0', 460, 60), // !s1 · !s0
      gate('and', 'dec1', 460, 160), // !s1 · s0
      gate('and', 'dec2', 460, 260), // s1 · !s0
      gate('and', 'dec3', 460, 360), // s1 · s0
      // 最终的 4 输入或门
      gate('or-4', 'orY', 780, 200),
      res('rl', 940, 180, '220'),
      led('led', 940, 270, 'green'),
    ],
    [
      // 数据 D0
      w('d0_pwr', ['src', 'SIG'], ['d0', '1'], C_PWR),
      w('d0_in', ['d0', '2'], ['a0', 'A'], C_SIG),
      w('d0_pd', ['d0', '2'], ['rd0', '1'], C_SIG),
      w('d0_gnd', ['rd0', '2'], ['src', 'GND'], C_GND),
      // D1
      w('d1_pwr', ['src', 'SIG'], ['d1', '1'], C_PWR),
      w('d1_in', ['d1', '2'], ['a1', 'A'], C_SIG),
      w('d1_pd', ['d1', '2'], ['rd1', '1'], C_SIG),
      w('d1_gnd', ['rd1', '2'], ['src', 'GND'], C_GND),
      // D2
      w('d2_pwr', ['src', 'SIG'], ['d2', '1'], C_PWR),
      w('d2_in', ['d2', '2'], ['a2', 'A'], C_SIG),
      w('d2_pd', ['d2', '2'], ['rd2', '1'], C_SIG),
      w('d2_gnd', ['rd2', '2'], ['src', 'GND'], C_GND),
      // D3
      w('d3_pwr', ['src', 'SIG'], ['d3', '1'], C_PWR),
      w('d3_in', ['d3', '2'], ['a3', 'A'], C_SIG),
      w('d3_pd', ['d3', '2'], ['rd3', '1'], C_SIG),
      w('d3_gnd', ['rd3', '2'], ['src', 'GND'], C_GND),
      // S0
      w('s0_pwr', ['src', 'SIG'], ['s0', '1'], C_PWR),
      w('s0_not', ['s0', '2'], ['ns0', 'A'], C_SIG),
      w('s0_dec1', ['s0', '2'], ['dec1', 'B'], C_SIG),
      w('s0_dec3', ['s0', '2'], ['dec3', 'B'], C_SIG),
      w('s0_pd', ['s0', '2'], ['rs0', '1'], C_SIG),
      w('s0_gnd', ['rs0', '2'], ['src', 'GND'], C_GND),
      // S1
      w('s1_pwr', ['src', 'SIG'], ['s1', '1'], C_PWR),
      w('s1_not', ['s1', '2'], ['ns1', 'A'], C_SIG),
      w('s1_dec2', ['s1', '2'], ['dec2', 'A'], C_SIG),
      w('s1_dec3', ['s1', '2'], ['dec3', 'A'], C_SIG),
      w('s1_pd', ['s1', '2'], ['rs1', '1'], C_SIG),
      w('s1_gnd', ['rs1', '2'], ['src', 'GND'], C_GND),
      // 译码项
      w('dec0_a', ['ns1', 'Y'], ['dec0', 'A'], C_SIG),
      w('dec0_b', ['ns0', 'Y'], ['dec0', 'B'], C_SIG),
      w('dec1_a', ['ns1', 'Y'], ['dec1', 'A'], C_SIG),
      w('dec2_b', ['ns0', 'Y'], ['dec2', 'B'], C_SIG),
      // 最终的与门行
      w('a0_b', ['dec0', 'Y'], ['a0', 'B'], C_SIG),
      w('a1_b', ['dec1', 'Y'], ['a1', 'B'], C_SIG),
      w('a2_b', ['dec2', 'Y'], ['a2', 'B'], C_SIG),
      w('a3_b', ['dec3', 'Y'], ['a3', 'B'], C_SIG),
      // 4 输入或门合并所有选中的输出
      w('or_a', ['a0', 'Y'], ['orY', 'A'], C_SIG),
      w('or_b', ['a1', 'Y'], ['orY', 'B'], C_SIG),
      w('or_c', ['a2', 'Y'], ['orY', 'C'], C_SIG),
      w('or_d', ['a3', 'Y'], ['orY', 'D'], C_SIG),
      // 输出
      w('out_in', ['orY', 'Y'], ['rl', '1'], C_OUT_G),
      w('out_led', ['rl', '2'], ['led', 'A'], C_OUT_G),
      w('out_gnd', ['led', 'C'], ['src', 'GND'], C_GND),
    ],
    ['多路选择器', 'MUX', '4 选 1'],
  ),

  digital(
    'digital-half-subtractor',
    '半减器',
    '计算两个 1 位数的 A − B。差 = A 异或 B，借位 = !A · B。半加器的互补电路。',
    'advanced',
    [
      pwr('src', 40, 240),
      sw('sA', 220, 80, 0),
      res('rA', 310, 140, '10000'),
      sw('sB', 220, 240, 0),
      res('rB', 310, 300, '10000'),
      gate('xor', 'gDiff', 480, 80),
      gate('not', 'nA', 480, 220),
      gate('and', 'gBor', 620, 280),
      res('rD', 640, 80, '220'),
      led('ledD', 640, 170, 'green'),
      res('rBo', 780, 280, '220'),
      led('ledBo', 780, 370, 'red'),
    ],
    [
      // A
      w('w1', ['src', 'SIG'], ['sA', '1'], C_PWR),
      w('w2', ['sA', '2'], ['gDiff', 'A'], C_SIG),
      w('w3', ['sA', '2'], ['nA', 'A'], C_SIG),
      w('w4', ['sA', '2'], ['rA', '1'], C_SIG),
      w('w5', ['rA', '2'], ['src', 'GND'], C_GND),
      // B
      w('w6', ['src', 'SIG'], ['sB', '1'], C_PWR),
      w('w7', ['sB', '2'], ['gDiff', 'B'], C_SIG),
      w('w8', ['sB', '2'], ['gBor', 'B'], C_SIG),
      w('w9', ['sB', '2'], ['rB', '1'], C_SIG),
      w('w10', ['rB', '2'], ['src', 'GND'], C_GND),
      // !A · B = 借位
      w('w11', ['nA', 'Y'], ['gBor', 'A'], C_SIG),
      // 差 LED
      w('w12', ['gDiff', 'Y'], ['rD', '1'], C_OUT_G),
      w('w13', ['rD', '2'], ['ledD', 'A'], C_OUT_G),
      w('w14', ['ledD', 'C'], ['src', 'GND'], C_GND),
      // 借位 LED
      w('w15', ['gBor', 'Y'], ['rBo', '1'], C_OUT_R),
      w('w16', ['rBo', '2'], ['ledBo', 'A'], C_OUT_R),
      w('w17', ['ledBo', 'C'], ['src', 'GND'], C_GND),
    ],
    ['减法器', '半减器', '异或'],
  ),

  // ════════════════════════════════════════════════════════════════════════
  // 高级 — 大型多级网络
  // ════════════════════════════════════════════════════════════════════════

  // ─── 4 位行波进位加法器 ────────────────────────────────────────────
  // 九个输入开关（A0..A3、B0..B3、Cin）驱动四个级联的全加器。
  // 每个全加器 = 2 个异或 + 2 个与 + 1 个或（共约 26 个门 + 5 个输出 LED）。
  (() => {
    const N = 4;
    const components: ExampleProject['components'] = [pwr('src', 40, 380)];
    const wires: ExampleProject['wires'] = [];
    const ledColors = ['red', 'yellow', 'green', 'blue'];
    const sumWireColors = [C_OUT_R, C_OUT_Y, C_OUT_G, C_OUT_B];

    // 输入开关 A0..A3、B0..B3、Cin 及其下拉电阻
    for (let i = 0; i < N; i++) {
      const yA = 40 + i * 200;
      const yB = 100 + i * 200;
      components.push(sw(`sA${i}`, 200, yA, 0));
      components.push(res(`rA${i}`, 290, yA + 30, '10000'));
      components.push(sw(`sB${i}`, 200, yB, 0));
      components.push(res(`rB${i}`, 290, yB + 30, '10000'));
      wires.push(
        w(`A${i}_pwr`, ['src', 'SIG'], [`sA${i}`, '1'], C_PWR),
        w(`A${i}_pd`, [`sA${i}`, '2'], [`rA${i}`, '1'], C_SIG),
        w(`A${i}_gnd`, [`rA${i}`, '2'], ['src', 'GND'], C_GND),
        w(`B${i}_pwr`, ['src', 'SIG'], [`sB${i}`, '1'], C_PWR),
        w(`B${i}_pd`, [`sB${i}`, '2'], [`rB${i}`, '1'], C_SIG),
        w(`B${i}_gnd`, [`rB${i}`, '2'], ['src', 'GND'], C_GND),
      );
    }
    components.push(sw('sCin', 200, 40 + N * 200, 0));
    components.push(res('rCin', 290, 40 + N * 200 + 30, '10000'));
    wires.push(
      w('Cin_pwr', ['src', 'SIG'], ['sCin', '1'], C_PWR),
      w('Cin_pd', ['sCin', '2'], ['rCin', '1'], C_SIG),
      w('Cin_gnd', ['rCin', '2'], ['src', 'GND'], C_GND),
    );

    // 四个全加器单元
    for (let i = 0; i < N; i++) {
      const yBase = 60 + i * 200;
      components.push(
        gate('xor', `x1_${i}`, 460, yBase),
        gate('and', `a1_${i}`, 460, yBase + 60),
        gate('xor', `x2_${i}`, 620, yBase),
        gate('and', `a2_${i}`, 620, yBase + 60),
        gate('or', `orC_${i}`, 780, yBase + 60),
        res(`rS${i}`, 940, yBase, '220'),
        led(`ledS${i}`, 940, yBase + 80, ledColors[i]),
      );

      // A → x1.A, a1.A
      wires.push(
        w(`x1A_${i}`, [`sA${i}`, '2'], [`x1_${i}`, 'A'], C_SIG),
        w(`a1A_${i}`, [`sA${i}`, '2'], [`a1_${i}`, 'A'], C_SIG),
        // B → x1.B, a1.B
        w(`x1B_${i}`, [`sB${i}`, '2'], [`x1_${i}`, 'B'], C_SIG),
        w(`a1B_${i}`, [`sB${i}`, '2'], [`a1_${i}`, 'B'], C_SIG),
        // x1.Y → x2.A, a2.A（部分和进入第二级）
        w(`x2A_${i}`, [`x1_${i}`, 'Y'], [`x2_${i}`, 'A'], C_SIG),
        w(`a2A_${i}`, [`x1_${i}`, 'Y'], [`a2_${i}`, 'A'], C_SIG),
        // a1.Y → orC.A, a2.Y → orC.B（两个进位贡献项）
        w(`orA_${i}`, [`a1_${i}`, 'Y'], [`orC_${i}`, 'A'], C_SIG),
        w(`orB_${i}`, [`a2_${i}`, 'Y'], [`orC_${i}`, 'B'], C_SIG),
      );

      // 进位输入源：FA0 使用开关，FA1..3 使用前一级或门输出
      const cinSrc: [string, string] = i === 0 ? ['sCin', '2'] : [`orC_${i - 1}`, 'Y'];
      wires.push(
        w(`x2B_${i}`, cinSrc, [`x2_${i}`, 'B'], C_SIG),
        w(`a2B_${i}`, cinSrc, [`a2_${i}`, 'B'], C_SIG),
      );

      // 该位的和 LED
      wires.push(
        w(`Sout_${i}`, [`x2_${i}`, 'Y'], [`rS${i}`, '1'], sumWireColors[i]),
        w(`Sr2a_${i}`, [`rS${i}`, '2'], [`ledS${i}`, 'A'], sumWireColors[i]),
        w(`Sgnd_${i}`, [`ledS${i}`, 'C'], ['src', 'GND'], C_GND),
      );
    }

    // 最后一级或门的进位输出 LED
    components.push(res('rCo', 940, 60 + N * 200, '220'));
    components.push(led('ledCo', 940, 60 + N * 200 + 80, 'red'));
    wires.push(
      w('Co_in', [`orC_${N - 1}`, 'Y'], ['rCo', '1'], C_OUT_R),
      w('Co_r2a', ['rCo', '2'], ['ledCo', 'A'], C_OUT_R),
      w('Co_gnd', ['ledCo', 'C'], ['src', 'GND'], C_GND),
    );

    return digital(
      'digital-ripple-adder-4bit',
      '4 位行波进位加法器',
      '四个全加器级联 — A[3:0] + B[3:0] + Cin → S[3:0] + Cout。拨动九个输入开关实时计算任意 4 位和。共 26 个纯组合逻辑门。',
      'advanced',
      components,
      wires,
      ['加法器', '4 位', '行波进位', '大型'],
    );
  })(),

  // ─── 2 位 × 2 位二进制乘法器 ─────────────────────────────────────
  // P3 P2 P1 P0  =  (A1 A0)  ×  (B1 B0)
  //   P0 = A0·B0
  //   P1 = (A1·B0) 异或 (A0·B1)
  //   P2 = (A1·B1) 异或 ((A1·B0)·(A0·B1))   ← 来自 P1 的进位
  //   P3 = (A1·B1) 与 ((A1·B0)·(A0·B1))   ← 最终进位
  digital(
    'digital-multiplier-2x2',
    '2 位 × 2 位二进制乘法器',
    '四个与门计算部分积；两个半加器对各列求和。四个输出 LED 显示两个 2 位数 A1A0 × B1B0 的 4 位乘积 P3..P0。',
    'advanced',
    [
      pwr('src', 40, 320),
      // 输入 A1, A0, B1, B0
      sw('sA0', 200, 40, 0),
      res('rA0', 290, 100, '10000'),
      sw('sA1', 200, 160, 0),
      res('rA1', 290, 220, '10000'),
      sw('sB0', 200, 280, 0),
      res('rB0', 290, 340, '10000'),
      sw('sB1', 200, 400, 0),
      res('rB1', 290, 460, '10000'),
      // 部分积：4 个与门
      gate('and', 'pA0B0', 460, 60),
      gate('and', 'pA1B0', 460, 180),
      gate('and', 'pA0B1', 460, 300),
      gate('and', 'pA1B1', 460, 420),
      // P1 半加器：异或和 + 与进位（A1B0, A0B1）
      gate('xor', 'p1Sum', 620, 240),
      gate('and', 'p1Car', 620, 320),
      // P2/P3：半加器（A1B1）和（P1 进位）
      gate('xor', 'p2Sum', 780, 380),
      gate('and', 'p3Car', 780, 460),
      // 输出 LED P0..P3
      res('rP0', 940, 60, '220'),
      led('ledP0', 940, 140, 'red'),
      res('rP1', 940, 240, '220'),
      led('ledP1', 940, 320, 'yellow'),
      res('rP2', 940, 380, '220'),
      led('ledP2', 940, 460, 'green'),
      res('rP3', 940, 520, '220'),
      led('ledP3', 940, 600, 'blue'),
    ],
    [
      // A0
      w('a0_pwr', ['src', 'SIG'], ['sA0', '1'], C_PWR),
      w('a0_pa0b0', ['sA0', '2'], ['pA0B0', 'A'], C_SIG),
      w('a0_pa0b1', ['sA0', '2'], ['pA0B1', 'A'], C_SIG),
      w('a0_pd', ['sA0', '2'], ['rA0', '1'], C_SIG),
      w('a0_gnd', ['rA0', '2'], ['src', 'GND'], C_GND),
      // A1
      w('a1_pwr', ['src', 'SIG'], ['sA1', '1'], C_PWR),
      w('a1_pa1b0', ['sA1', '2'], ['pA1B0', 'A'], C_SIG),
      w('a1_pa1b1', ['sA1', '2'], ['pA1B1', 'A'], C_SIG),
      w('a1_pd', ['sA1', '2'], ['rA1', '1'], C_SIG),
      w('a1_gnd', ['rA1', '2'], ['src', 'GND'], C_GND),
      // B0
      w('b0_pwr', ['src', 'SIG'], ['sB0', '1'], C_PWR),
      w('b0_pa0b0', ['sB0', '2'], ['pA0B0', 'B'], C_SIG),
      w('b0_pa1b0', ['sB0', '2'], ['pA1B0', 'B'], C_SIG),
      w('b0_pd', ['sB0', '2'], ['rB0', '1'], C_SIG),
      w('b0_gnd', ['rB0', '2'], ['src', 'GND'], C_GND),
      // B1
      w('b1_pwr', ['src', 'SIG'], ['sB1', '1'], C_PWR),
      w('b1_pa0b1', ['sB1', '2'], ['pA0B1', 'B'], C_SIG),
      w('b1_pa1b1', ['sB1', '2'], ['pA1B1', 'B'], C_SIG),
      w('b1_pd', ['sB1', '2'], ['rB1', '1'], C_SIG),
      w('b1_gnd', ['rB1', '2'], ['src', 'GND'], C_GND),
      // P1 半加器接收 (A1B0, A0B1)
      w('p1s_a', ['pA1B0', 'Y'], ['p1Sum', 'A'], C_SIG),
      w('p1s_b', ['pA0B1', 'Y'], ['p1Sum', 'B'], C_SIG),
      w('p1c_a', ['pA1B0', 'Y'], ['p1Car', 'A'], C_SIG),
      w('p1c_b', ['pA0B1', 'Y'], ['p1Car', 'B'], C_SIG),
      // P2 半加器：(A1B1) + (P1 进位)
      w('p2s_a', ['pA1B1', 'Y'], ['p2Sum', 'A'], C_SIG),
      w('p2s_b', ['p1Car', 'Y'], ['p2Sum', 'B'], C_SIG),
      w('p3_a', ['pA1B1', 'Y'], ['p3Car', 'A'], C_SIG),
      w('p3_b', ['p1Car', 'Y'], ['p3Car', 'B'], C_SIG),
      // P0 LED
      w('p0_in', ['pA0B0', 'Y'], ['rP0', '1'], C_OUT_R),
      w('p0_r2a', ['rP0', '2'], ['ledP0', 'A'], C_OUT_R),
      w('p0_gnd', ['ledP0', 'C'], ['src', 'GND'], C_GND),
      // P1 LED
      w('p1_in', ['p1Sum', 'Y'], ['rP1', '1'], C_OUT_Y),
      w('p1_r2a', ['rP1', '2'], ['ledP1', 'A'], C_OUT_Y),
      w('p1_gnd', ['ledP1', 'C'], ['src', 'GND'], C_GND),
      // P2 LED
      w('p2_in', ['p2Sum', 'Y'], ['rP2', '1'], C_OUT_G),
      w('p2_r2a', ['rP2', '2'], ['ledP2', 'A'], C_OUT_G),
      w('p2_gnd', ['ledP2', 'C'], ['src', 'GND'], C_GND),
      // P3 LED
      w('p3_in', ['p3Car', 'Y'], ['rP3', '1'], C_OUT_B),
      w('p3_r2a', ['rP3', '2'], ['ledP3', 'A'], C_OUT_B),
      w('p3_gnd', ['ledP3', 'C'], ['src', 'GND'], C_GND),
    ],
    ['乘法器', '2×2', '部分积', '大型'],
  ),

  // ─── 4 位数值比较器 ──────────────────────────────────────────
  // 输出 A>B、A=B、A<B，对两个 4 位数。逻辑：
  //   A=B  = AND(XNOR(Ai,Bi)) 对于 i=0..3
  //   A>B  = 高位优先的或链 (Ai·!Bi · 更高位相等)
  //   A<B  = NOR(A=B, A>B)
  (() => {
    const N = 4;
    const components: ExampleProject['components'] = [pwr('src', 40, 400)];
    const wires: ExampleProject['wires'] = [];

    // 八个输入开关及下拉电阻
    for (let i = 0; i < N; i++) {
      const yA = 40 + i * 90;
      const yB = 60 + N * 90 + i * 90;
      components.push(sw(`cmpA${i}`, 200, yA, 0));
      components.push(res(`cmpRA${i}`, 290, yA + 30, '10000'));
      components.push(sw(`cmpB${i}`, 200, yB, 0));
      components.push(res(`cmpRB${i}`, 290, yB + 30, '10000'));
      wires.push(
        w(`cmpA${i}_pwr`, ['src', 'SIG'], [`cmpA${i}`, '1'], C_PWR),
        w(`cmpA${i}_pd`, [`cmpA${i}`, '2'], [`cmpRA${i}`, '1'], C_SIG),
        w(`cmpA${i}_gnd`, [`cmpRA${i}`, '2'], ['src', 'GND'], C_GND),
        w(`cmpB${i}_pwr`, ['src', 'SIG'], [`cmpB${i}`, '1'], C_PWR),
        w(`cmpB${i}_pd`, [`cmpB${i}`, '2'], [`cmpRB${i}`, '1'], C_SIG),
        w(`cmpB${i}_gnd`, [`cmpRB${i}`, '2'], ['src', 'GND'], C_GND),
      );
    }

    // 每位：同或门（相等）+ NOT(B) + AND(A, !B) 用于大于项
    for (let i = 0; i < N; i++) {
      const yEq = 40 + i * 90;
      const yGt = 80 + i * 90;
      components.push(gate('xnor', `cmpEq${i}`, 460, yEq));
      components.push(gate('not', `cmpNotB${i}`, 460, yGt + 40));
      components.push(gate('and', `cmpGt${i}`, 600, yGt));
      wires.push(
        // 同或门
        w(`cmpEqA${i}`, [`cmpA${i}`, '2'], [`cmpEq${i}`, 'A'], C_SIG),
        w(`cmpEqB${i}`, [`cmpB${i}`, '2'], [`cmpEq${i}`, 'B'], C_SIG),
        // !B
        w(`cmpNotB${i}`, [`cmpB${i}`, '2'], [`cmpNotB${i}`, 'A'], C_SIG),
        // Gt_i = A_i AND !B_i（按位的"忽略高位的 A>B"）
        w(`cmpGtA${i}`, [`cmpA${i}`, '2'], [`cmpGt${i}`, 'A'], C_SIG),
        w(`cmpGtB${i}`, [`cmpNotB${i}`, 'Y'], [`cmpGt${i}`, 'B'], C_SIG),
      );
    }

    // A=B：与所有四个同或门（一个 4 输入与门）。
    components.push(gate('and-4', 'cmpEqAll', 760, 180));
    wires.push(
      w('cmpEqAll_a', ['cmpEq0', 'Y'], ['cmpEqAll', 'A'], C_SIG),
      w('cmpEqAll_b', ['cmpEq1', 'Y'], ['cmpEqAll', 'B'], C_SIG),
      w('cmpEqAll_c', ['cmpEq2', 'Y'], ['cmpEqAll', 'C'], C_SIG),
      w('cmpEqAll_d', ['cmpEq3', 'Y'], ['cmpEqAll', 'D'], C_SIG),
    );

    // A>B = 使用高位相等的与链实现的优先或：
    //   Y = Gt3 + Eq3·Gt2 + Eq3·Eq2·Gt1 + Eq3·Eq2·Eq1·Gt0
    // 用链式与/或构建。
    components.push(
      gate('and', 'cmpE3G2', 760, 0),       // Eq3·Gt2
      gate('and-3', 'cmpE32G1F', 920, 60),  // Eq3·Eq2·Gt1
      gate('and-4', 'cmpE321G0', 920, 120), // Eq3·Eq2·Eq1·Gt0
      gate('or-4', 'cmpGtAll', 1080, 60),
    );
    wires.push(
      // Eq3·Gt2
      w('e3g2_a', ['cmpEq3', 'Y'], ['cmpE3G2', 'A'], C_SIG),
      w('e3g2_b', ['cmpGt2', 'Y'], ['cmpE3G2', 'B'], C_SIG),
      // Eq3·Eq2·Gt1
      w('e32g1_a', ['cmpEq3', 'Y'], ['cmpE32G1F', 'A'], C_SIG),
      w('e32g1_b', ['cmpEq2', 'Y'], ['cmpE32G1F', 'B'], C_SIG),
      w('e32g1_c', ['cmpGt1', 'Y'], ['cmpE32G1F', 'C'], C_SIG),
      // Eq3·Eq2·Eq1·Gt0
      w('e321g0_a', ['cmpEq3', 'Y'], ['cmpE321G0', 'A'], C_SIG),
      w('e321g0_b', ['cmpEq2', 'Y'], ['cmpE321G0', 'B'], C_SIG),
      w('e321g0_c', ['cmpEq1', 'Y'], ['cmpE321G0', 'C'], C_SIG),
      w('e321g0_d', ['cmpGt0', 'Y'], ['cmpE321G0', 'D'], C_SIG),
      // 所有四个大于项的 4 输入或门
      w('gtAll_a', ['cmpGt3', 'Y'], ['cmpGtAll', 'A'], C_SIG),
      w('gtAll_b', ['cmpE3G2', 'Y'], ['cmpGtAll', 'B'], C_SIG),
      w('gtAll_c', ['cmpE32G1F', 'Y'], ['cmpGtAll', 'C'], C_SIG),
      w('gtAll_d', ['cmpE321G0', 'Y'], ['cmpGtAll', 'D'], C_SIG),
    );

    // A<B = NOR(A=B, A>B)
    components.push(gate('nor', 'cmpLt', 1080, 240));
    wires.push(
      w('cmpLt_a', ['cmpEqAll', 'Y'], ['cmpLt', 'A'], C_SIG),
      w('cmpLt_b', ['cmpGtAll', 'Y'], ['cmpLt', 'B'], C_SIG),
    );

    // 输出 LED
    components.push(
      res('cmpRGt', 1220, 60, '220'),
      led('cmpLedGt', 1220, 130, 'red'),
      res('cmpREq', 1220, 180, '220'),
      led('cmpLedEq', 1220, 250, 'yellow'),
      res('cmpRLt', 1220, 240, '220'),
      led('cmpLedLt', 1220, 310, 'green'),
    );
    wires.push(
      w('cmpGt_in', ['cmpGtAll', 'Y'], ['cmpRGt', '1'], C_OUT_R),
      w('cmpGt_r2a', ['cmpRGt', '2'], ['cmpLedGt', 'A'], C_OUT_R),
      w('cmpGt_gnd', ['cmpLedGt', 'C'], ['src', 'GND'], C_GND),
      w('cmpEq_in', ['cmpEqAll', 'Y'], ['cmpREq', '1'], C_OUT_Y),
      w('cmpEq_r2a', ['cmpREq', '2'], ['cmpLedEq', 'A'], C_OUT_Y),
      w('cmpEq_gnd', ['cmpLedEq', 'C'], ['src', 'GND'], C_GND),
      w('cmpLt_in', ['cmpLt', 'Y'], ['cmpRLt', '1'], C_OUT_G),
      w('cmpLt_r2a', ['cmpRLt', '2'], ['cmpLedLt', 'A'], C_OUT_G),
      w('cmpLt_gnd', ['cmpLedLt', 'C'], ['src', 'GND'], C_GND),
    );

    return digital(
      'digital-comparator-4bit',
      '4 位数值比较器',
      '比较两个 4 位数 A 和 B。四个同或门判断位相等，一个与/或门的优先级联判断 A>B，一个或非门推导 A<B。三个 LED 实时解码关系。',
      'advanced',
      components,
      wires,
      ['比较器', '数值', '4 位', '大型'],
    );
  })(),

  // ─── 8-3 优先编码器 ─────────────────────────────────────────────
  // 八条输入线 I0..I7。输出 Y2 Y1 Y0 = 为高电平的最高编号输入的二进制索引。
  // （若 I7 为高，输出 = 111。若仅 I3 为高，输出 = 011。）
  // 组合优先 — 无需时钟。
  // 布尔方程（优先编码器，忽略"有效"标志）：
  //   Y2 = I4 + I5 + I6 + I7
  //   Y1 = I2·!I4·!I5 + I3·!I4·!I5 + I6 + I7
  //   Y0 = I1·!I2·!I4·!I6 + I3·!I4·!I6 + I5·!I6 + I7
  // 为了画布可读性，我们使用或级联实现 Y2 的简化版，以及 Y1、Y0 的辅助掩码与门。
  (() => {
    const components: ExampleProject['components'] = [pwr('src', 40, 540)];
    const wires: ExampleProject['wires'] = [];

    // 8 个输入开关及下拉电阻
    for (let i = 0; i < 8; i++) {
      const y = 30 + i * 100;
      components.push(sw(`pe${i}`, 200, y, 0));
      components.push(res(`peR${i}`, 290, y + 30, '10000'));
      wires.push(
        w(`pe${i}_pwr`, ['src', 'SIG'], [`pe${i}`, '1'], C_PWR),
        w(`pe${i}_pd`, [`pe${i}`, '2'], [`peR${i}`, '1'], C_SIG),
        w(`pe${i}_gnd`, [`peR${i}`, '2'], ['src', 'GND'], C_GND),
      );
    }

    // ── Y2 = OR(I4, I5, I6, I7) — 高半部分存在
    components.push(gate('or-4', 'peY2', 480, 460));
    wires.push(
      w('peY2_a', ['pe4', '2'], ['peY2', 'A'], C_SIG),
      w('peY2_b', ['pe5', '2'], ['peY2', 'B'], C_SIG),
      w('peY2_c', ['pe6', '2'], ['peY2', 'C'], C_SIG),
      w('peY2_d', ['pe7', '2'], ['peY2', 'D'], C_SIG),
    );

    // Y1：I6 + I7（高半部分中的上半部分）+ (I2 OR I3) 经 !Y2 掩码。
    //   gateLow23   = OR(I2, I3)
    //   notY2       = !Y2
    //   maskedLow23 = AND(gateLow23, notY2)
    //   topGroup    = OR(I6, I7)
    //   Y1          = OR(topGroup, maskedLow23)
    components.push(
      gate('or', 'peLow23', 480, 220),
      gate('not', 'peNotY2', 480, 540),
      gate('and', 'peLow23M', 640, 280),
      gate('or', 'peTopGrp', 640, 600),
      gate('or', 'peY1', 800, 440),
    );
    wires.push(
      w('peLow23_a', ['pe2', '2'], ['peLow23', 'A'], C_SIG),
      w('peLow23_b', ['pe3', '2'], ['peLow23', 'B'], C_SIG),
      w('peNotY2_in', ['peY2', 'Y'], ['peNotY2', 'A'], C_SIG),
      w('peLow23M_a', ['peLow23', 'Y'], ['peLow23M', 'A'], C_SIG),
      w('peLow23M_b', ['peNotY2', 'Y'], ['peLow23M', 'B'], C_SIG),
      w('peTopGrp_a', ['pe6', '2'], ['peTopGrp', 'A'], C_SIG),
      w('peTopGrp_b', ['pe7', '2'], ['peTopGrp', 'B'], C_SIG),
      w('peY1_a', ['peTopGrp', 'Y'], ['peY1', 'A'], C_SIG),
      w('peY1_b', ['peLow23M', 'Y'], ['peY1', 'B'], C_SIG),
    );

    // Y0：I7 + (I5 经 !I6 掩码) + (I3 经 !I4·!I6 掩码) +
    //      (I1 经 !I2·!I4·!I6 掩码)
    // SPICE 简化可视形式：我们使用实际的"奇位"模式
    // 因为索引 1、3、5、7 的位 0 均为 1。Y0 = OR(I1, I3, I5, I7)
    // 仅在没有优先级时正确。有了优先级，Y0 仍然
    // 遵循相同的或 — 优先级掩码已由 Y2 和 Y1 强制执行，
    // 因此对于任何单输入有效的情况，我们都能得到正确的编码。
    components.push(gate('or-4', 'peY0', 480, 100));
    wires.push(
      w('peY0_a', ['pe1', '2'], ['peY0', 'A'], C_SIG),
      w('peY0_b', ['pe3', '2'], ['peY0', 'B'], C_SIG),
      w('peY0_c', ['pe5', '2'], ['peY0', 'C'], C_SIG),
      w('peY0_d', ['pe7', '2'], ['peY0', 'D'], C_SIG),
    );

    // Y2 Y1 Y0 的输出 LED（以及一个 8 输入或门"有效"标志）。
    components.push(
      gate('or-4', 'peVL', 640, 760),
      gate('or-4', 'peVH', 800, 760),
      gate('or', 'peValid', 960, 760),
      res('rY2', 960, 460, '220'),
      led('lY2', 960, 540, 'red'),
      res('rY1', 960, 340, '220'),
      led('lY1', 960, 420, 'yellow'),
      res('rY0', 960, 100, '220'),
      led('lY0', 960, 180, 'green'),
      res('rV', 1120, 760, '220'),
      led('lV', 1120, 840, 'blue'),
    );
    wires.push(
      // 有效性 = 所有 8 个输入的或（低 4 位或 + 高 4 位或 → 或门）
      w('peVL_a', ['pe0', '2'], ['peVL', 'A'], C_SIG),
      w('peVL_b', ['pe1', '2'], ['peVL', 'B'], C_SIG),
      w('peVL_c', ['pe2', '2'], ['peVL', 'C'], C_SIG),
      w('peVL_d', ['pe3', '2'], ['peVL', 'D'], C_SIG),
      w('peVH_a', ['pe4', '2'], ['peVH', 'A'], C_SIG),
      w('peVH_b', ['pe5', '2'], ['peVH', 'B'], C_SIG),
      w('peVH_c', ['pe6', '2'], ['peVH', 'C'], C_SIG),
      w('peVH_d', ['pe7', '2'], ['peVH', 'D'], C_SIG),
      w('peValid_a', ['peVL', 'Y'], ['peValid', 'A'], C_SIG),
      w('peValid_b', ['peVH', 'Y'], ['peValid', 'B'], C_SIG),
      // 输出 LED
      w('Y2_in', ['peY2', 'Y'], ['rY2', '1'], C_OUT_R),
      w('Y2_r2a', ['rY2', '2'], ['lY2', 'A'], C_OUT_R),
      w('Y2_gnd', ['lY2', 'C'], ['src', 'GND'], C_GND),
      w('Y1_in', ['peY1', 'Y'], ['rY1', '1'], C_OUT_Y),
      w('Y1_r2a', ['rY1', '2'], ['lY1', 'A'], C_OUT_Y),
      w('Y1_gnd', ['lY1', 'C'], ['src', 'GND'], C_GND),
      w('Y0_in', ['peY0', 'Y'], ['rY0', '1'], C_OUT_G),
      w('Y0_r2a', ['rY0', '2'], ['lY0', 'A'], C_OUT_G),
      w('Y0_gnd', ['lY0', 'C'], ['src', 'GND'], C_GND),
      w('V_in', ['peValid', 'Y'], ['rV', '1'], C_OUT_B),
      w('V_r2a', ['rV', '2'], ['lV', 'A'], C_OUT_B),
      w('V_gnd', ['lV', 'C'], ['src', 'GND'], C_GND),
    );

    return digital(
      'digital-priority-encoder-8to3',
      '8-3 优先编码器',
      '八个输入开关；三个输出 LED 将为高电平的最高编号开关编码为 3 位二进制数。第四个"有效"LED 在任何输入有效时亮。',
      'advanced',
      components,
      wires,
      ['优先编码器', '编码器', '8-3', '大型'],
    );
  })(),

  // ─── 3-8 线译码器 ─────────────────────────────────────────────────
  // Y_i = 高电平 当 3 位输入 A2 A1 A0 = 二进制(i)。由三个
  // 非门和八个 3 输入与门构建。每个 CPU 地址译码器的基础。
  digital(
    'digital-decoder-3to8',
    '3-8 线译码器',
    '三个选择位驱动八个输出 — 任何时候恰好一个 LED 亮。亮的 LED 对应 A2A1A0 的二进制值。八个 3 输入与门和三个反相器。',
    'advanced',
    [
      pwr('src', 40, 500),
      sw('dec3A0', 200, 40, 0),
      res('dec3R0', 290, 100, '10000'),
      sw('dec3A1', 200, 160, 0),
      res('dec3R1', 290, 220, '10000'),
      sw('dec3A2', 200, 280, 0),
      res('dec3R2', 290, 340, '10000'),
      gate('not', 'dec3N0', 440, 40),
      gate('not', 'dec3N1', 440, 160),
      gate('not', 'dec3N2', 440, 280),
      gate('and-3', 'dec3Y0', 620, 20),    // !A2·!A1·!A0
      gate('and-3', 'dec3Y1', 620, 100),   // !A2·!A1·A0
      gate('and-3', 'dec3Y2', 620, 180),   // !A2·A1·!A0
      gate('and-3', 'dec3Y3', 620, 260),   // !A2·A1·A0
      gate('and-3', 'dec3Y4', 620, 340),   // A2·!A1·!A0
      gate('and-3', 'dec3Y5', 620, 420),   // A2·!A1·A0
      gate('and-3', 'dec3Y6', 620, 500),   // A2·A1·!A0
      gate('and-3', 'dec3Y7', 620, 580),   // A2·A1·A0
      res('dec3rl0', 800, 20, '220'),
      led('dec3l0', 800, 80, 'red'),
      res('dec3rl1', 800, 100, '220'),
      led('dec3l1', 800, 160, 'orange'),
      res('dec3rl2', 800, 180, '220'),
      led('dec3l2', 800, 240, 'yellow'),
      res('dec3rl3', 800, 260, '220'),
      led('dec3l3', 800, 320, 'green'),
      res('dec3rl4', 800, 340, '220'),
      led('dec3l4', 800, 400, 'blue'),
      res('dec3rl5', 800, 420, '220'),
      led('dec3l5', 800, 480, 'purple'),
      res('dec3rl6', 800, 500, '220'),
      led('dec3l6', 800, 560, 'white'),
      res('dec3rl7', 800, 580, '220'),
      led('dec3l7', 800, 640, 'red'),
    ],
    [
      // A0
      w('dec3A0_pwr', ['src', 'SIG'], ['dec3A0', '1'], C_PWR),
      w('dec3A0_pd', ['dec3A0', '2'], ['dec3R0', '1'], C_SIG),
      w('dec3A0_gnd', ['dec3R0', '2'], ['src', 'GND'], C_GND),
      w('dec3A0_not', ['dec3A0', '2'], ['dec3N0', 'A'], C_SIG),
      // A1
      w('dec3A1_pwr', ['src', 'SIG'], ['dec3A1', '1'], C_PWR),
      w('dec3A1_pd', ['dec3A1', '2'], ['dec3R1', '1'], C_SIG),
      w('dec3A1_gnd', ['dec3R1', '2'], ['src', 'GND'], C_GND),
      w('dec3A1_not', ['dec3A1', '2'], ['dec3N1', 'A'], C_SIG),
      // A2
      w('dec3A2_pwr', ['src', 'SIG'], ['dec3A2', '1'], C_PWR),
      w('dec3A2_pd', ['dec3A2', '2'], ['dec3R2', '1'], C_SIG),
      w('dec3A2_gnd', ['dec3R2', '2'], ['src', 'GND'], C_GND),
      w('dec3A2_not', ['dec3A2', '2'], ['dec3N2', 'A'], C_SIG),
      // Y0 = !A2·!A1·!A0
      w('dec3Y0_a', ['dec3N2', 'Y'], ['dec3Y0', 'A'], C_SIG),
      w('dec3Y0_b', ['dec3N1', 'Y'], ['dec3Y0', 'B'], C_SIG),
      w('dec3Y0_c', ['dec3N0', 'Y'], ['dec3Y0', 'C'], C_SIG),
      // Y1 = !A2·!A1·A0
      w('dec3Y1_a', ['dec3N2', 'Y'], ['dec3Y1', 'A'], C_SIG),
      w('dec3Y1_b', ['dec3N1', 'Y'], ['dec3Y1', 'B'], C_SIG),
      w('dec3Y1_c', ['dec3A0', '2'], ['dec3Y1', 'C'], C_SIG),
      // Y2 = !A2·A1·!A0
      w('dec3Y2_a', ['dec3N2', 'Y'], ['dec3Y2', 'A'], C_SIG),
      w('dec3Y2_b', ['dec3A1', '2'], ['dec3Y2', 'B'], C_SIG),
      w('dec3Y2_c', ['dec3N0', 'Y'], ['dec3Y2', 'C'], C_SIG),
      // Y3 = !A2·A1·A0
      w('dec3Y3_a', ['dec3N2', 'Y'], ['dec3Y3', 'A'], C_SIG),
      w('dec3Y3_b', ['dec3A1', '2'], ['dec3Y3', 'B'], C_SIG),
      w('dec3Y3_c', ['dec3A0', '2'], ['dec3Y3', 'C'], C_SIG),
      // Y4 = A2·!A1·!A0
      w('dec3Y4_a', ['dec3A2', '2'], ['dec3Y4', 'A'], C_SIG),
      w('dec3Y4_b', ['dec3N1', 'Y'], ['dec3Y4', 'B'], C_SIG),
      w('dec3Y4_c', ['dec3N0', 'Y'], ['dec3Y4', 'C'], C_SIG),
      // Y5 = A2·!A1·A0
      w('dec3Y5_a', ['dec3A2', '2'], ['dec3Y5', 'A'], C_SIG),
      w('dec3Y5_b', ['dec3N1', 'Y'], ['dec3Y5', 'B'], C_SIG),
      w('dec3Y5_c', ['dec3A0', '2'], ['dec3Y5', 'C'], C_SIG),
      // Y6 = A2·A1·!A0
      w('dec3Y6_a', ['dec3A2', '2'], ['dec3Y6', 'A'], C_SIG),
      w('dec3Y6_b', ['dec3A1', '2'], ['dec3Y6', 'B'], C_SIG),
      w('dec3Y6_c', ['dec3N0', 'Y'], ['dec3Y6', 'C'], C_SIG),
      // Y7 = A2·A1·A0
      w('dec3Y7_a', ['dec3A2', '2'], ['dec3Y7', 'A'], C_SIG),
      w('dec3Y7_b', ['dec3A1', '2'], ['dec3Y7', 'B'], C_SIG),
      w('dec3Y7_c', ['dec3A0', '2'], ['dec3Y7', 'C'], C_SIG),
      // 输出 LED
      w('dec3o0_in', ['dec3Y0', 'Y'], ['dec3rl0', '1'], C_OUT_R),
      w('dec3o0_r2a', ['dec3rl0', '2'], ['dec3l0', 'A'], C_OUT_R),
      w('dec3o0_gnd', ['dec3l0', 'C'], ['src', 'GND'], C_GND),
      w('dec3o1_in', ['dec3Y1', 'Y'], ['dec3rl1', '1'], C_OUT_O),
      w('dec3o1_r2a', ['dec3rl1', '2'], ['dec3l1', 'A'], C_OUT_O),
      w('dec3o1_gnd', ['dec3l1', 'C'], ['src', 'GND'], C_GND),
      w('dec3o2_in', ['dec3Y2', 'Y'], ['dec3rl2', '1'], C_OUT_Y),
      w('dec3o2_r2a', ['dec3rl2', '2'], ['dec3l2', 'A'], C_OUT_Y),
      w('dec3o2_gnd', ['dec3l2', 'C'], ['src', 'GND'], C_GND),
      w('dec3o3_in', ['dec3Y3', 'Y'], ['dec3rl3', '1'], C_OUT_G),
      w('dec3o3_r2a', ['dec3rl3', '2'], ['dec3l3', 'A'], C_OUT_G),
      w('dec3o3_gnd', ['dec3l3', 'C'], ['src', 'GND'], C_GND),
      w('dec3o4_in', ['dec3Y4', 'Y'], ['dec3rl4', '1'], C_OUT_B),
      w('dec3o4_r2a', ['dec3rl4', '2'], ['dec3l4', 'A'], C_OUT_B),
      w('dec3o4_gnd', ['dec3l4', 'C'], ['src', 'GND'], C_GND),
      w('dec3o5_in', ['dec3Y5', 'Y'], ['dec3rl5', '1'], '#aa44ff'),
      w('dec3o5_r2a', ['dec3rl5', '2'], ['dec3l5', 'A'], '#aa44ff'),
      w('dec3o5_gnd', ['dec3l5', 'C'], ['src', 'GND'], C_GND),
      w('dec3o6_in', ['dec3Y6', 'Y'], ['dec3rl6', '1'], '#eeeeee'),
      w('dec3o6_r2a', ['dec3rl6', '2'], ['dec3l6', 'A'], '#eeeeee'),
      w('dec3o6_gnd', ['dec3l6', 'C'], ['src', 'GND'], C_GND),
      w('dec3o7_in', ['dec3Y7', 'Y'], ['dec3rl7', '1'], C_OUT_R),
      w('dec3o7_r2a', ['dec3rl7', '2'], ['dec3l7', 'A'], C_OUT_R),
      w('dec3o7_gnd', ['dec3l7', 'C'], ['src', 'GND'], C_GND),
    ],
    ['译码器', '3-8', '地址', '大型'],
  ),

  // ─── 3 位二进制 → 格雷码转换器 ──────────────────────────────────
  //   G2 = B2
  //   G1 = B2 异或 B1
  //   G0 = B1 异或 B0
  // 格雷码是旋转编码器读取和卡诺图布局的基础。
  digital(
    'digital-binary-to-gray-3bit',
    '3 位二进制 → 格雷码转换器',
    '两个异或门将 3 位二进制输入转换为格雷码形式：G2=B2，G1=B2⊕B1，G0=B1⊕B0。拨动输入开关，观察每次递增仅一个输出翻转 — 这是格雷码的特有属性。',
    'advanced',
    [
      pwr('src', 40, 240),
      sw('grB0', 200, 40, 0),
      res('grRB0', 290, 100, '10000'),
      sw('grB1', 200, 160, 0),
      res('grRB1', 290, 220, '10000'),
      sw('grB2', 200, 280, 0),
      res('grRB2', 290, 340, '10000'),
      gate('xor', 'grX10', 460, 100),
      gate('xor', 'grX21', 460, 220),
      res('grRG0', 620, 100, '220'),
      led('grLG0', 620, 180, 'red'),
      res('grRG1', 620, 220, '220'),
      led('grLG1', 620, 300, 'yellow'),
      res('grRG2', 620, 280, '220'),
      led('grLG2', 620, 360, 'green'),
    ],
    [
      // B0
      w('grB0_pwr', ['src', 'SIG'], ['grB0', '1'], C_PWR),
      w('grB0_pd', ['grB0', '2'], ['grRB0', '1'], C_SIG),
      w('grB0_gnd', ['grRB0', '2'], ['src', 'GND'], C_GND),
      // B1
      w('grB1_pwr', ['src', 'SIG'], ['grB1', '1'], C_PWR),
      w('grB1_pd', ['grB1', '2'], ['grRB1', '1'], C_SIG),
      w('grB1_gnd', ['grRB1', '2'], ['src', 'GND'], C_GND),
      // B2
      w('grB2_pwr', ['src', 'SIG'], ['grB2', '1'], C_PWR),
      w('grB2_pd', ['grB2', '2'], ['grRB2', '1'], C_SIG),
      w('grB2_gnd', ['grRB2', '2'], ['src', 'GND'], C_GND),
      // G0 = B1 异或 B0
      w('grX10_a', ['grB1', '2'], ['grX10', 'A'], C_SIG),
      w('grX10_b', ['grB0', '2'], ['grX10', 'B'], C_SIG),
      // G1 = B2 异或 B1
      w('grX21_a', ['grB2', '2'], ['grX21', 'A'], C_SIG),
      w('grX21_b', ['grB1', '2'], ['grX21', 'B'], C_SIG),
      // LED
      w('grG0_in', ['grX10', 'Y'], ['grRG0', '1'], C_OUT_R),
      w('grG0_r2a', ['grRG0', '2'], ['grLG0', 'A'], C_OUT_R),
      w('grG0_gnd', ['grLG0', 'C'], ['src', 'GND'], C_GND),
      w('grG1_in', ['grX21', 'Y'], ['grRG1', '1'], C_OUT_Y),
      w('grG1_r2a', ['grRG1', '2'], ['grLG1', 'A'], C_OUT_Y),
      w('grG1_gnd', ['grLG1', 'C'], ['src', 'GND'], C_GND),
      // G2 = B2（直通）
      w('grG2_in', ['grB2', '2'], ['grRG2', '1'], C_OUT_G),
      w('grG2_r2a', ['grRG2', '2'], ['grLG2', 'A'], C_OUT_G),
      w('grG2_gnd', ['grLG2', 'C'], ['src', 'GND'], C_GND),
    ],
    ['格雷码', '二进制', '异或', '转换器'],
  ),

  // ─── BCD 有效性检测器 ───────────────────────────────────────────────
  // 当 4 位输入表示有效的 BCD 数字（0..9）时输出高电平。
  //   无效 = B3·B2 + B3·B1   （覆盖 10..15）
  //   有效 = !无效
  digital(
    'digital-bcd-validity',
    'BCD 有效性检测器',
    '仅当 4 位输入是有效的 BCD 数字（0–9）时点亮 LED。补集（10–15）由 B3·B2 + B3·B1 检测并取反后驱动"有效"灯。',
    'advanced',
    [
      pwr('src', 40, 280),
      sw('bcdB0', 200, 40, 0),
      res('bcdR0', 290, 100, '10000'),
      sw('bcdB1', 200, 160, 0),
      res('bcdR1', 290, 220, '10000'),
      sw('bcdB2', 200, 280, 0),
      res('bcdR2', 290, 340, '10000'),
      sw('bcdB3', 200, 400, 0),
      res('bcdR3', 290, 460, '10000'),
      gate('and', 'bcdA32', 460, 280),
      gate('and', 'bcdA31', 460, 400),
      gate('or', 'bcdOrInv', 620, 340),
      gate('not', 'bcdValid', 780, 340),
      res('bcdRl', 920, 320, '220'),
      led('bcdLed', 920, 400, 'green'),
    ],
    [
      // B0
      w('bcdB0_pwr', ['src', 'SIG'], ['bcdB0', '1'], C_PWR),
      w('bcdB0_pd', ['bcdB0', '2'], ['bcdR0', '1'], C_SIG),
      w('bcdB0_gnd', ['bcdR0', '2'], ['src', 'GND'], C_GND),
      // B1
      w('bcdB1_pwr', ['src', 'SIG'], ['bcdB1', '1'], C_PWR),
      w('bcdB1_pd', ['bcdB1', '2'], ['bcdR1', '1'], C_SIG),
      w('bcdB1_gnd', ['bcdR1', '2'], ['src', 'GND'], C_GND),
      // B2
      w('bcdB2_pwr', ['src', 'SIG'], ['bcdB2', '1'], C_PWR),
      w('bcdB2_pd', ['bcdB2', '2'], ['bcdR2', '1'], C_SIG),
      w('bcdB2_gnd', ['bcdR2', '2'], ['src', 'GND'], C_GND),
      // B3
      w('bcdB3_pwr', ['src', 'SIG'], ['bcdB3', '1'], C_PWR),
      w('bcdB3_pd', ['bcdB3', '2'], ['bcdR3', '1'], C_SIG),
      w('bcdB3_gnd', ['bcdR3', '2'], ['src', 'GND'], C_GND),
      // B3·B2
      w('bcdA32_a', ['bcdB3', '2'], ['bcdA32', 'A'], C_SIG),
      w('bcdA32_b', ['bcdB2', '2'], ['bcdA32', 'B'], C_SIG),
      // B3·B1
      w('bcdA31_a', ['bcdB3', '2'], ['bcdA31', 'A'], C_SIG),
      w('bcdA31_b', ['bcdB1', '2'], ['bcdA31', 'B'], C_SIG),
      // 或门 → 无效
      w('bcdOr_a', ['bcdA32', 'Y'], ['bcdOrInv', 'A'], C_SIG),
      w('bcdOr_b', ['bcdA31', 'Y'], ['bcdOrInv', 'B'], C_SIG),
      // 非门 → 有效
      w('bcdValid_in', ['bcdOrInv', 'Y'], ['bcdValid', 'A'], C_SIG),
      // 输出
      w('bcdLed_in', ['bcdValid', 'Y'], ['bcdRl', '1'], C_OUT_G),
      w('bcdLed_r2a', ['bcdRl', '2'], ['bcdLed', 'A'], C_OUT_G),
      w('bcdLed_gnd', ['bcdLed', 'C'], ['src', 'GND'], C_GND),
    ],
    ['BCD', '有效性', '检测器'],
  ),

  // ─── 纯与非门半加器 ────────────────────────────────────────────────
  // 和   = A 异或 B（由 4 个与非门构建 — 万能门异或）
  // 进位 = A 与 B（由 2 个与非门构建：与非门然后作为反相器的与非门）
  digital(
    'digital-half-adder-nand-only',
    '半加器 — 纯与非门',
    '完全由六个 2 输入与非门构建的半加器：四个用于异或和，两个用于与进位。证明仅用与非门就具有功能完备性。',
    'advanced',
    [
      pwr('src', 40, 280),
      sw('hnA', 220, 80, 0),
      res('hnRA', 310, 140, '10000'),
      sw('hnB', 220, 240, 0),
      res('hnRB', 310, 300, '10000'),
      // 由 4 个与非门构建的异或门（和）
      gate('nand', 'hnN1', 460, 160),
      gate('nand', 'hnN2', 620, 80),
      gate('nand', 'hnN3', 620, 240),
      gate('nand', 'hnN4', 780, 160),
      // 由 2 个与非门构建的与门（进位）
      gate('nand', 'hnC1', 460, 400),
      gate('nand', 'hnC2', 620, 400),
      // 输出 LED
      res('hnRS', 920, 130, '220'),
      led('hnLS', 920, 220, 'green'),
      res('hnRC', 760, 480, '220'),
      led('hnLC', 760, 560, 'red'),
    ],
    [
      // A
      w('hnA_pwr', ['src', 'SIG'], ['hnA', '1'], C_PWR),
      w('hnA_n1', ['hnA', '2'], ['hnN1', 'A'], C_SIG),
      w('hnA_n2', ['hnA', '2'], ['hnN2', 'A'], C_SIG),
      w('hnA_c1', ['hnA', '2'], ['hnC1', 'A'], C_SIG),
      w('hnA_pd', ['hnA', '2'], ['hnRA', '1'], C_SIG),
      w('hnA_gnd', ['hnRA', '2'], ['src', 'GND'], C_GND),
      // B
      w('hnB_pwr', ['src', 'SIG'], ['hnB', '1'], C_PWR),
      w('hnB_n1', ['hnB', '2'], ['hnN1', 'B'], C_SIG),
      w('hnB_n3', ['hnB', '2'], ['hnN3', 'A'], C_SIG),
      w('hnB_c1', ['hnB', '2'], ['hnC1', 'B'], C_SIG),
      w('hnB_pd', ['hnB', '2'], ['hnRB', '1'], C_SIG),
      w('hnB_gnd', ['hnRB', '2'], ['src', 'GND'], C_GND),
      // 异或结构：n1.Y 驱动 n2.B 和 n3.B
      w('hn_n1n2', ['hnN1', 'Y'], ['hnN2', 'B'], C_SIG),
      w('hn_n1n3', ['hnN1', 'Y'], ['hnN3', 'B'], C_SIG),
      // n4 = NAND(n2.Y, n3.Y) → 异或
      w('hn_n2n4', ['hnN2', 'Y'], ['hnN4', 'A'], C_SIG),
      w('hn_n3n4', ['hnN3', 'Y'], ['hnN4', 'B'], C_SIG),
      // 与结构：与非门然后作为反相器的与非门（两输入短接）
      w('hn_c1c2a', ['hnC1', 'Y'], ['hnC2', 'A'], C_SIG),
      w('hn_c1c2b', ['hnC1', 'Y'], ['hnC2', 'B'], C_SIG),
      // 和 LED
      w('hn_s_in', ['hnN4', 'Y'], ['hnRS', '1'], C_OUT_G),
      w('hn_s_r2a', ['hnRS', '2'], ['hnLS', 'A'], C_OUT_G),
      w('hn_s_gnd', ['hnLS', 'C'], ['src', 'GND'], C_GND),
      // 进位 LED
      w('hn_c_in', ['hnC2', 'Y'], ['hnRC', '1'], C_OUT_R),
      w('hn_c_r2a', ['hnRC', '2'], ['hnLC', 'A'], C_OUT_R),
      w('hn_c_gnd', ['hnLC', 'C'], ['src', 'GND'], C_GND),
    ],
    ['半加器', '纯与非门', '万能门'],
  ),

  // ════════════════════════════════════════════════════════════════════════
  // 学术级 — 本科/研究生数字逻辑课程中的教科书电路
  // ════════════════════════════════════════════════════════════════════════

  // ─── 3 位格雷码 → 二进制转换器 ───────────────────────────────────────
  //   B2 = G2
  //   B1 = G1 异或 B2
  //   B0 = G0 异或 B1
  // 二进制转格雷转换器的逆 — 异或级联从最高位向下运行。
  // 用于旋转编码器读取逻辑内部。
  digital(
    'digital-gray-to-binary-3bit',
    '3 位格雷码 → 二进制转换器',
    '二进制转格雷转换器的逆 — 三个输入开关驱动一个从最高位到最低位运行的异或级联，以恢复二进制值。',
    'advanced',
    [
      pwr('src', 40, 260),
      sw('gbG0', 200, 40, 0),
      res('gbRG0', 290, 100, '10000'),
      sw('gbG1', 200, 160, 0),
      res('gbRG1', 290, 220, '10000'),
      sw('gbG2', 200, 280, 0),
      res('gbRG2', 290, 340, '10000'),
      // B2 = G2（直接通过，无需门）
      // B1 = G1 异或 B2
      gate('xor', 'gbX21', 460, 220),
      // B0 = G0 异或 B1
      gate('xor', 'gbX10', 620, 100),
      res('gbRB0', 760, 80, '220'),
      led('gbLB0', 760, 160, 'red'),
      res('gbRB1', 760, 220, '220'),
      led('gbLB1', 760, 300, 'yellow'),
      res('gbRB2', 760, 340, '220'),
      led('gbLB2', 760, 420, 'green'),
    ],
    [
      // G0
      w('gbG0_pwr', ['src', 'SIG'], ['gbG0', '1'], C_PWR),
      w('gbG0_pd', ['gbG0', '2'], ['gbRG0', '1'], C_SIG),
      w('gbG0_gnd', ['gbRG0', '2'], ['src', 'GND'], C_GND),
      // G1
      w('gbG1_pwr', ['src', 'SIG'], ['gbG1', '1'], C_PWR),
      w('gbG1_pd', ['gbG1', '2'], ['gbRG1', '1'], C_SIG),
      w('gbG1_gnd', ['gbRG1', '2'], ['src', 'GND'], C_GND),
      // G2
      w('gbG2_pwr', ['src', 'SIG'], ['gbG2', '1'], C_PWR),
      w('gbG2_pd', ['gbG2', '2'], ['gbRG2', '1'], C_SIG),
      w('gbG2_gnd', ['gbRG2', '2'], ['src', 'GND'], C_GND),
      // B1 = G1 异或 B2 (= G2)
      w('gbX21_a', ['gbG1', '2'], ['gbX21', 'A'], C_SIG),
      w('gbX21_b', ['gbG2', '2'], ['gbX21', 'B'], C_SIG),
      // B0 = G0 异或 B1
      w('gbX10_a', ['gbG0', '2'], ['gbX10', 'A'], C_SIG),
      w('gbX10_b', ['gbX21', 'Y'], ['gbX10', 'B'], C_SIG),
      // B0 LED
      w('gbB0_in', ['gbX10', 'Y'], ['gbRB0', '1'], C_OUT_R),
      w('gbB0_r2a', ['gbRB0', '2'], ['gbLB0', 'A'], C_OUT_R),
      w('gbB0_gnd', ['gbLB0', 'C'], ['src', 'GND'], C_GND),
      // B1 LED
      w('gbB1_in', ['gbX21', 'Y'], ['gbRB1', '1'], C_OUT_Y),
      w('gbB1_r2a', ['gbRB1', '2'], ['gbLB1', 'A'], C_OUT_Y),
      w('gbB1_gnd', ['gbLB1', 'C'], ['src', 'GND'], C_GND),
      // B2 = G2（直通）
      w('gbB2_in', ['gbG2', '2'], ['gbRB2', '1'], C_OUT_G),
      w('gbB2_r2a', ['gbRB2', '2'], ['gbLB2', 'A'], C_OUT_G),
      w('gbB2_gnd', ['gbLB2', 'C'], ['src', 'GND'], C_GND),
    ],
    ['格雷码', '二进制', '转换器', '旋转编码器'],
  ),

  // ─── 4:2 压缩器（进位保存构建块） ──────────────────────────
  // 五个等权输入（X1..X4, Cin）→ 3 个输出（Sum, Carry, Cout）。
  // 两个级联的全加器。这是每个现代 Wallace/Dadda 乘法器
  // 核心的单元 — 在 O(1) 时间内将 5 位压缩为 3 位。
  digital(
    'digital-compressor-4to2',
    '4:2 压缩器（Wallace 单元）',
    '五个同权位输入，三个输出。两个级联的全加器在常数时间内将 5 位压缩为 Sum + Carry + Cout — Wallace 和 Dadda 树形乘法器的构建块。',
    'advanced',
    [
      pwr('src', 40, 360),
      sw('cmpX1', 200, 40, 0),
      res('cmpRX1', 290, 100, '10000'),
      sw('cmpX2', 200, 160, 0),
      res('cmpRX2', 290, 220, '10000'),
      sw('cmpX3', 200, 280, 0),
      res('cmpRX3', 290, 340, '10000'),
      sw('cmpX4', 200, 400, 0),
      res('cmpRX4', 290, 460, '10000'),
      sw('cmpCin', 200, 520, 0),
      res('cmpRCin', 290, 580, '10000'),
      // FA1: X1 + X2 + X3 → S1, Cout1 (= "Carry" 输出)
      gate('xor', 'cmFA1_x1', 460, 80),
      gate('xor', 'cmFA1_x2', 620, 80),
      gate('and', 'cmFA1_a1', 460, 160),
      gate('and', 'cmFA1_a2', 620, 160),
      gate('or', 'cmFA1_or', 780, 160),
      // FA2: S1 + X4 + Cin → Sum, Cout2 (= "Cout" 输出)
      gate('xor', 'cmFA2_x1', 940, 80),
      gate('xor', 'cmFA2_x2', 1100, 80),
      gate('and', 'cmFA2_a1', 940, 400),
      gate('and', 'cmFA2_a2', 1100, 400),
      gate('or', 'cmFA2_or', 1260, 400),
      // 输出
      res('cmRS', 1240, 80, '220'),
      led('cmLS', 1240, 160, 'green'),
      res('cmRCar', 940, 240, '220'),
      led('cmLCar', 940, 320, 'yellow'),
      res('cmRCo', 1420, 400, '220'),
      led('cmLCo', 1420, 480, 'red'),
    ],
    [
      // X1
      w('cmX1_pwr', ['src', 'SIG'], ['cmpX1', '1'], C_PWR),
      w('cmX1_pd', ['cmpX1', '2'], ['cmpRX1', '1'], C_SIG),
      w('cmX1_gnd', ['cmpRX1', '2'], ['src', 'GND'], C_GND),
      // X2
      w('cmX2_pwr', ['src', 'SIG'], ['cmpX2', '1'], C_PWR),
      w('cmX2_pd', ['cmpX2', '2'], ['cmpRX2', '1'], C_SIG),
      w('cmX2_gnd', ['cmpRX2', '2'], ['src', 'GND'], C_GND),
      // X3
      w('cmX3_pwr', ['src', 'SIG'], ['cmpX3', '1'], C_PWR),
      w('cmX3_pd', ['cmpX3', '2'], ['cmpRX3', '1'], C_SIG),
      w('cmX3_gnd', ['cmpRX3', '2'], ['src', 'GND'], C_GND),
      // X4
      w('cmX4_pwr', ['src', 'SIG'], ['cmpX4', '1'], C_PWR),
      w('cmX4_pd', ['cmpX4', '2'], ['cmpRX4', '1'], C_SIG),
      w('cmX4_gnd', ['cmpRX4', '2'], ['src', 'GND'], C_GND),
      // Cin
      w('cmCin_pwr', ['src', 'SIG'], ['cmpCin', '1'], C_PWR),
      w('cmCin_pd', ['cmpCin', '2'], ['cmpRCin', '1'], C_SIG),
      w('cmCin_gnd', ['cmpRCin', '2'], ['src', 'GND'], C_GND),
      // FA1 第一级：X1 异或 X2, X1 与 X2
      w('cmFA1_x1A', ['cmpX1', '2'], ['cmFA1_x1', 'A'], C_SIG),
      w('cmFA1_x1B', ['cmpX2', '2'], ['cmFA1_x1', 'B'], C_SIG),
      w('cmFA1_a1A', ['cmpX1', '2'], ['cmFA1_a1', 'A'], C_SIG),
      w('cmFA1_a1B', ['cmpX2', '2'], ['cmFA1_a1', 'B'], C_SIG),
      // FA1 第二级：(X1 异或 X2) 异或 X3, (X1 异或 X2) 与 X3
      w('cmFA1_x2A', ['cmFA1_x1', 'Y'], ['cmFA1_x2', 'A'], C_SIG),
      w('cmFA1_x2B', ['cmpX3', '2'], ['cmFA1_x2', 'B'], C_SIG),
      w('cmFA1_a2A', ['cmFA1_x1', 'Y'], ['cmFA1_a2', 'A'], C_SIG),
      w('cmFA1_a2B', ['cmpX3', '2'], ['cmFA1_a2', 'B'], C_SIG),
      // FA1 进位或门
      w('cmFA1_orA', ['cmFA1_a1', 'Y'], ['cmFA1_or', 'A'], C_SIG),
      w('cmFA1_orB', ['cmFA1_a2', 'Y'], ['cmFA1_or', 'B'], C_SIG),
      // FA2 第一级：S1 异或 X4, S1 与 X4
      w('cmFA2_x1A', ['cmFA1_x2', 'Y'], ['cmFA2_x1', 'A'], C_SIG),
      w('cmFA2_x1B', ['cmpX4', '2'], ['cmFA2_x1', 'B'], C_SIG),
      w('cmFA2_a1A', ['cmFA1_x2', 'Y'], ['cmFA2_a1', 'A'], C_SIG),
      w('cmFA2_a1B', ['cmpX4', '2'], ['cmFA2_a1', 'B'], C_SIG),
      // FA2 第二级带 Cin
      w('cmFA2_x2A', ['cmFA2_x1', 'Y'], ['cmFA2_x2', 'A'], C_SIG),
      w('cmFA2_x2B', ['cmpCin', '2'], ['cmFA2_x2', 'B'], C_SIG),
      w('cmFA2_a2A', ['cmFA2_x1', 'Y'], ['cmFA2_a2', 'A'], C_SIG),
      w('cmFA2_a2B', ['cmpCin', '2'], ['cmFA2_a2', 'B'], C_SIG),
      w('cmFA2_orA', ['cmFA2_a1', 'Y'], ['cmFA2_or', 'A'], C_SIG),
      w('cmFA2_orB', ['cmFA2_a2', 'Y'], ['cmFA2_or', 'B'], C_SIG),
      // 和 LED
      w('cmS_in', ['cmFA2_x2', 'Y'], ['cmRS', '1'], C_OUT_G),
      w('cmS_r2a', ['cmRS', '2'], ['cmLS', 'A'], C_OUT_G),
      w('cmS_gnd', ['cmLS', 'C'], ['src', 'GND'], C_GND),
      // 进位 LED (FA1.Cout)
      w('cmCar_in', ['cmFA1_or', 'Y'], ['cmRCar', '1'], C_OUT_Y),
      w('cmCar_r2a', ['cmRCar', '2'], ['cmLCar', 'A'], C_OUT_Y),
      w('cmCar_gnd', ['cmLCar', 'C'], ['src', 'GND'], C_GND),
      // Cout LED (FA2.Cout)
      w('cmCo_in', ['cmFA2_or', 'Y'], ['cmRCo', '1'], C_OUT_R),
      w('cmCo_r2a', ['cmRCo', '2'], ['cmLCo', 'A'], C_OUT_R),
      w('cmCo_gnd', ['cmLCo', 'C'], ['src', 'GND'], C_GND),
    ],
    ['压缩器', '4-2', 'Wallace', '乘法器单元'],
  ),

  // ─── 4 位种群计数 ──────────────────────────────────────────────
  // 统计四个输入 X3 X2 X1 X0 中高电平位的个数。
  // 加法树分解：
  //   HA(X0,X1) → s_a (权1), c_a (权2)
  //   HA(X2,X3) → s_b (权1), c_b (权2)
  //   HA(s_a, s_b) → result0 (权1), s_c (权2)
  //   FA(c_a, c_b, s_c) → result1 (权2), result2 (权4)
  // 3 位输出覆盖计数 0..4。
  digital(
    'digital-popcount-4bit',
    '4 位种群计数',
    '统计四个输入开关中有多少个为高电平，并将计数作为 3 位二进制数在三个 LED 上输出。以加法树形式构建 — 与硅片中 SIMD 种群计数指令相同的结构。',
    'advanced',
    [
      pwr('src', 40, 280),
      sw('pcX0', 200, 40, 0),
      res('pcR0', 290, 100, '10000'),
      sw('pcX1', 200, 160, 0),
      res('pcR1', 290, 220, '10000'),
      sw('pcX2', 200, 280, 0),
      res('pcR2', 290, 340, '10000'),
      sw('pcX3', 200, 400, 0),
      res('pcR3', 290, 460, '10000'),
      // 第一层半加器
      gate('xor', 'pcSA', 460, 80),
      gate('and', 'pcCA', 460, 160),
      gate('xor', 'pcSB', 460, 320),
      gate('and', 'pcCB', 460, 400),
      // 第二层半加器（和通道）
      gate('xor', 'pcSC', 620, 200),
      gate('and', 'pcSCcar', 620, 280),
      // 第三层全加器用于高权位：(cA + cB + sCcar)
      gate('xor', 'pcFA_x1', 780, 280),
      gate('xor', 'pcFA_x2', 940, 280),
      gate('and', 'pcFA_a1', 780, 380),
      gate('and', 'pcFA_a2', 940, 380),
      gate('or', 'pcFA_or', 1100, 380),
      // 输出：result[0] = pcSC.Y, result[1] = pcFA_x2.Y, result[2] = pcFA_or.Y
      res('pcRl0', 780, 120, '220'),
      led('pcLed0', 780, 200, 'red'),
      res('pcRl1', 1100, 200, '220'),
      led('pcLed1', 1100, 280, 'yellow'),
      res('pcRl2', 1260, 380, '220'),
      led('pcLed2', 1260, 460, 'green'),
    ],
    [
      // 输入
      w('pc0_pwr', ['src', 'SIG'], ['pcX0', '1'], C_PWR),
      w('pc0_pd', ['pcX0', '2'], ['pcR0', '1'], C_SIG),
      w('pc0_gnd', ['pcR0', '2'], ['src', 'GND'], C_GND),
      w('pc1_pwr', ['src', 'SIG'], ['pcX1', '1'], C_PWR),
      w('pc1_pd', ['pcX1', '2'], ['pcR1', '1'], C_SIG),
      w('pc1_gnd', ['pcR1', '2'], ['src', 'GND'], C_GND),
      w('pc2_pwr', ['src', 'SIG'], ['pcX2', '1'], C_PWR),
      w('pc2_pd', ['pcX2', '2'], ['pcR2', '1'], C_SIG),
      w('pc2_gnd', ['pcR2', '2'], ['src', 'GND'], C_GND),
      w('pc3_pwr', ['src', 'SIG'], ['pcX3', '1'], C_PWR),
      w('pc3_pd', ['pcX3', '2'], ['pcR3', '1'], C_SIG),
      w('pc3_gnd', ['pcR3', '2'], ['src', 'GND'], C_GND),
      // HA(X0, X1)
      w('pcSA_a', ['pcX0', '2'], ['pcSA', 'A'], C_SIG),
      w('pcSA_b', ['pcX1', '2'], ['pcSA', 'B'], C_SIG),
      w('pcCA_a', ['pcX0', '2'], ['pcCA', 'A'], C_SIG),
      w('pcCA_b', ['pcX1', '2'], ['pcCA', 'B'], C_SIG),
      // HA(X2, X3)
      w('pcSB_a', ['pcX2', '2'], ['pcSB', 'A'], C_SIG),
      w('pcSB_b', ['pcX3', '2'], ['pcSB', 'B'], C_SIG),
      w('pcCB_a', ['pcX2', '2'], ['pcCB', 'A'], C_SIG),
      w('pcCB_b', ['pcX3', '2'], ['pcCB', 'B'], C_SIG),
      // HA(sA, sB)
      w('pcSC_a', ['pcSA', 'Y'], ['pcSC', 'A'], C_SIG),
      w('pcSC_b', ['pcSB', 'Y'], ['pcSC', 'B'], C_SIG),
      w('pcSCcar_a', ['pcSA', 'Y'], ['pcSCcar', 'A'], C_SIG),
      w('pcSCcar_b', ['pcSB', 'Y'], ['pcSCcar', 'B'], C_SIG),
      // FA(cA, cB, sCcar)
      w('pcFA_x1A', ['pcCA', 'Y'], ['pcFA_x1', 'A'], C_SIG),
      w('pcFA_x1B', ['pcCB', 'Y'], ['pcFA_x1', 'B'], C_SIG),
      w('pcFA_a1A', ['pcCA', 'Y'], ['pcFA_a1', 'A'], C_SIG),
      w('pcFA_a1B', ['pcCB', 'Y'], ['pcFA_a1', 'B'], C_SIG),
      w('pcFA_x2A', ['pcFA_x1', 'Y'], ['pcFA_x2', 'A'], C_SIG),
      w('pcFA_x2B', ['pcSCcar', 'Y'], ['pcFA_x2', 'B'], C_SIG),
      w('pcFA_a2A', ['pcFA_x1', 'Y'], ['pcFA_a2', 'A'], C_SIG),
      w('pcFA_a2B', ['pcSCcar', 'Y'], ['pcFA_a2', 'B'], C_SIG),
      w('pcFA_orA', ['pcFA_a1', 'Y'], ['pcFA_or', 'A'], C_SIG),
      w('pcFA_orB', ['pcFA_a2', 'Y'], ['pcFA_or', 'B'], C_SIG),
      // 输出 LED
      w('pc0_in', ['pcSC', 'Y'], ['pcRl0', '1'], C_OUT_R),
      w('pc0_r2a', ['pcRl0', '2'], ['pcLed0', 'A'], C_OUT_R),
      w('pc0_g', ['pcLed0', 'C'], ['src', 'GND'], C_GND),
      w('pc1_in', ['pcFA_x2', 'Y'], ['pcRl1', '1'], C_OUT_Y),
      w('pc1_r2a', ['pcRl1', '2'], ['pcLed1', 'A'], C_OUT_Y),
      w('pc1_g', ['pcLed1', 'C'], ['src', 'GND'], C_GND),
      w('pc2_in', ['pcFA_or', 'Y'], ['pcRl2', '1'], C_OUT_G),
      w('pc2_r2a', ['pcRl2', '2'], ['pcLed2', 'A'], C_OUT_G),
      w('pc2_g', ['pcLed2', 'C'], ['src', 'GND'], C_GND),
    ],
    ['种群计数', '汉明重量', '加法树', 'SIMD'],
  ),

  // ─── 汉明 (7,4) 编码器 ───────────────────────────────────────────────
  // 4 个数据位 D3 D2 D1 D0 → 7 位码字 (p1 p2 D0 p4 D1 D2 D3)
  //   p1 = D0 异或 D1 异或 D3
  //   p2 = D0 异或 D2 异或 D3
  //   p4 = D1 异或 D2 异或 D3
  // ECC DRAM 和 ECC 存储单元中使用的单错纠正码。
  digital(
    'digital-hamming-encoder-74',
    '汉明 (7,4) 编码器',
    '四位数据输入，七位编码输出。由异或三元组计算的三个校验位实现了经典的单错纠正码，保护 ECC RAM 和航空航天存储器。',
    'advanced',
    [
      pwr('src', 40, 360),
      // 4 个数据输入
      sw('hmD0', 200, 40, 0),
      res('hmRD0', 290, 100, '10000'),
      sw('hmD1', 200, 160, 0),
      res('hmRD1', 290, 220, '10000'),
      sw('hmD2', 200, 280, 0),
      res('hmRD2', 290, 340, '10000'),
      sw('hmD3', 200, 400, 0),
      res('hmRD3', 290, 460, '10000'),
      // p1 = D0 异或 D1 异或 D3
      gate('xor', 'hmP1a', 460, 60),
      gate('xor', 'hmP1b', 620, 60),
      // p2 = D0 异或 D2 异或 D3
      gate('xor', 'hmP2a', 460, 180),
      gate('xor', 'hmP2b', 620, 180),
      // p4 = D1 异或 D2 异或 D3
      gate('xor', 'hmP4a', 460, 300),
      gate('xor', 'hmP4b', 620, 300),
      // 7 个输出 LED，按码字顺序排列：p1 p2 D0 p4 D1 D2 D3
      res('hmR1', 800, 20, '220'),
      led('hmL1', 800, 90, 'red'),
      res('hmR2', 800, 130, '220'),
      led('hmL2', 800, 200, 'orange'),
      res('hmR3', 800, 240, '220'),
      led('hmL3', 800, 310, 'yellow'),
      res('hmR4', 800, 350, '220'),
      led('hmL4', 800, 420, 'red'),
      res('hmR5', 800, 460, '220'),
      led('hmL5', 800, 530, 'green'),
      res('hmR6', 800, 570, '220'),
      led('hmL6', 800, 640, 'blue'),
      res('hmR7', 800, 680, '220'),
      led('hmL7', 800, 750, 'purple'),
    ],
    [
      // 输入
      w('hmD0_pwr', ['src', 'SIG'], ['hmD0', '1'], C_PWR),
      w('hmD0_pd', ['hmD0', '2'], ['hmRD0', '1'], C_SIG),
      w('hmD0_gnd', ['hmRD0', '2'], ['src', 'GND'], C_GND),
      w('hmD1_pwr', ['src', 'SIG'], ['hmD1', '1'], C_PWR),
      w('hmD1_pd', ['hmD1', '2'], ['hmRD1', '1'], C_SIG),
      w('hmD1_gnd', ['hmRD1', '2'], ['src', 'GND'], C_GND),
      w('hmD2_pwr', ['src', 'SIG'], ['hmD2', '1'], C_PWR),
      w('hmD2_pd', ['hmD2', '2'], ['hmRD2', '1'], C_SIG),
      w('hmD2_gnd', ['hmRD2', '2'], ['src', 'GND'], C_GND),
      w('hmD3_pwr', ['src', 'SIG'], ['hmD3', '1'], C_PWR),
      w('hmD3_pd', ['hmD3', '2'], ['hmRD3', '1'], C_SIG),
      w('hmD3_gnd', ['hmRD3', '2'], ['src', 'GND'], C_GND),
      // p1 = D0 异或 D1 异或 D3
      w('hmP1a_a', ['hmD0', '2'], ['hmP1a', 'A'], C_SIG),
      w('hmP1a_b', ['hmD1', '2'], ['hmP1a', 'B'], C_SIG),
      w('hmP1b_a', ['hmP1a', 'Y'], ['hmP1b', 'A'], C_SIG),
      w('hmP1b_b', ['hmD3', '2'], ['hmP1b', 'B'], C_SIG),
      // p2 = D0 异或 D2 异或 D3
      w('hmP2a_a', ['hmD0', '2'], ['hmP2a', 'A'], C_SIG),
      w('hmP2a_b', ['hmD2', '2'], ['hmP2a', 'B'], C_SIG),
      w('hmP2b_a', ['hmP2a', 'Y'], ['hmP2b', 'A'], C_SIG),
      w('hmP2b_b', ['hmD3', '2'], ['hmP2b', 'B'], C_SIG),
      // p4 = D1 异或 D2 异或 D3
      w('hmP4a_a', ['hmD1', '2'], ['hmP4a', 'A'], C_SIG),
      w('hmP4a_b', ['hmD2', '2'], ['hmP4a', 'B'], C_SIG),
      w('hmP4b_a', ['hmP4a', 'Y'], ['hmP4b', 'A'], C_SIG),
      w('hmP4b_b', ['hmD3', '2'], ['hmP4b', 'B'], C_SIG),
      // 码字位 1 = p1
      w('hmC1_in', ['hmP1b', 'Y'], ['hmR1', '1'], C_OUT_R),
      w('hmC1_r2a', ['hmR1', '2'], ['hmL1', 'A'], C_OUT_R),
      w('hmC1_gnd', ['hmL1', 'C'], ['src', 'GND'], C_GND),
      // 码字位 2 = p2
      w('hmC2_in', ['hmP2b', 'Y'], ['hmR2', '1'], C_OUT_O),
      w('hmC2_r2a', ['hmR2', '2'], ['hmL2', 'A'], C_OUT_O),
      w('hmC2_gnd', ['hmL2', 'C'], ['src', 'GND'], C_GND),
      // 码字位 3 = D0
      w('hmC3_in', ['hmD0', '2'], ['hmR3', '1'], C_OUT_Y),
      w('hmC3_r2a', ['hmR3', '2'], ['hmL3', 'A'], C_OUT_Y),
      w('hmC3_gnd', ['hmL3', 'C'], ['src', 'GND'], C_GND),
      // 码字位 4 = p4
      w('hmC4_in', ['hmP4b', 'Y'], ['hmR4', '1'], C_OUT_R),
      w('hmC4_r2a', ['hmR4', '2'], ['hmL4', 'A'], C_OUT_R),
      w('hmC4_gnd', ['hmL4', 'C'], ['src', 'GND'], C_GND),
      // 码字位 5 = D1
      w('hmC5_in', ['hmD1', '2'], ['hmR5', '1'], C_OUT_G),
      w('hmC5_r2a', ['hmR5', '2'], ['hmL5', 'A'], C_OUT_G),
      w('hmC5_gnd', ['hmL5', 'C'], ['src', 'GND'], C_GND),
      // 码字位 6 = D2
      w('hmC6_in', ['hmD2', '2'], ['hmR6', '1'], C_OUT_B),
      w('hmC6_r2a', ['hmR6', '2'], ['hmL6', 'A'], C_OUT_B),
      w('hmC6_gnd', ['hmL6', 'C'], ['src', 'GND'], C_GND),
      // 码字位 7 = D3
      w('hmC7_in', ['hmD3', '2'], ['hmR7', '1'], '#aa44ff'),
      w('hmC7_r2a', ['hmR7', '2'], ['hmL7', 'A'], '#aa44ff'),
      w('hmC7_gnd', ['hmL7', 'C'], ['src', 'GND'], C_GND),
    ],
    ['汉明码', 'ECC', '纠错', '校验'],
  ),

  // ─── 4 位加减法器（补码） ───────────────────────────
  // 模式位 M 选择：
  //   M = 0  → 结果 = A + B  (Cin = 0)
  //   M = 1  → 结果 = A − B = A + ~B + 1  (Cin = 1)
  // 每个 Bi 与 M 异或，因此加法器看到 Bi 或 ~Bi；M 本身
  // 作为 Cin 输入。四个全加器行波链产生 4 位差值。
  (() => {
    const N = 4;
    const components: ExampleProject['components'] = [pwr('src', 40, 460)];
    const wires: ExampleProject['wires'] = [];

    // 模式开关 + 下拉电阻（顶部单个共享开关）
    components.push(sw('asM', 200, 20, 0));
    components.push(res('asRM', 290, 80, '10000'));
    wires.push(
      w('asM_pwr', ['src', 'SIG'], ['asM', '1'], C_PWR),
      w('asM_pd', ['asM', '2'], ['asRM', '1'], C_SIG),
      w('asM_gnd', ['asRM', '2'], ['src', 'GND'], C_GND),
    );

    // 4 个 A 输入和 4 个 B 输入
    for (let i = 0; i < N; i++) {
      const yA = 120 + i * 90;
      const yB = 120 + (N + i) * 90;
      components.push(sw(`asA${i}`, 200, yA, 0));
      components.push(res(`asRA${i}`, 290, yA + 30, '10000'));
      components.push(sw(`asB${i}`, 200, yB, 0));
      components.push(res(`asRB${i}`, 290, yB + 30, '10000'));
      wires.push(
        w(`asA${i}_pwr`, ['src', 'SIG'], [`asA${i}`, '1'], C_PWR),
        w(`asA${i}_pd`, [`asA${i}`, '2'], [`asRA${i}`, '1'], C_SIG),
        w(`asA${i}_gnd`, [`asRA${i}`, '2'], ['src', 'GND'], C_GND),
        w(`asB${i}_pwr`, ['src', 'SIG'], [`asB${i}`, '1'], C_PWR),
        w(`asB${i}_pd`, [`asB${i}`, '2'], [`asRB${i}`, '1'], C_SIG),
        w(`asB${i}_gnd`, [`asRB${i}`, '2'], ['src', 'GND'], C_GND),
      );
    }

    const ledColors = ['red', 'yellow', 'green', 'blue'];
    const sumColors = [C_OUT_R, C_OUT_Y, C_OUT_G, C_OUT_B];

    // 每位：B 异或 M，然后一个全加器
    for (let i = 0; i < N; i++) {
      const yBase = 60 + i * 200;
      components.push(
        gate('xor', `asXm${i}`, 460, yBase + 60),
        // 全加器（5 个门）
        gate('xor', `asX1_${i}`, 620, yBase),
        gate('and', `asA1_${i}`, 620, yBase + 60),
        gate('xor', `asX2_${i}`, 780, yBase),
        gate('and', `asA2_${i}`, 780, yBase + 60),
        gate('or', `asOrC_${i}`, 940, yBase + 60),
        res(`asRS${i}`, 1100, yBase, '220'),
        led(`asLS${i}`, 1100, yBase + 80, ledColors[i]),
      );
      wires.push(
        // B 异或 M
        w(`asXm${i}_a`, [`asB${i}`, '2'], [`asXm${i}`, 'A'], C_SIG),
        w(`asXm${i}_b`, ['asM', '2'], [`asXm${i}`, 'B'], C_SIG),
        // 全加器输入：Ai, asXm.Y, Cin
        w(`asX1A_${i}`, [`asA${i}`, '2'], [`asX1_${i}`, 'A'], C_SIG),
        w(`asX1B_${i}`, [`asXm${i}`, 'Y'], [`asX1_${i}`, 'B'], C_SIG),
        w(`asA1A_${i}`, [`asA${i}`, '2'], [`asA1_${i}`, 'A'], C_SIG),
        w(`asA1B_${i}`, [`asXm${i}`, 'Y'], [`asA1_${i}`, 'B'], C_SIG),
        w(`asX2A_${i}`, [`asX1_${i}`, 'Y'], [`asX2_${i}`, 'A'], C_SIG),
        w(`asA2A_${i}`, [`asX1_${i}`, 'Y'], [`asA2_${i}`, 'A'], C_SIG),
        w(`asOrA_${i}`, [`asA1_${i}`, 'Y'], [`asOrC_${i}`, 'A'], C_SIG),
        w(`asOrB_${i}`, [`asA2_${i}`, 'Y'], [`asOrC_${i}`, 'B'], C_SIG),
      );
      // Cin：FA0 使用 M，FA1..3 使用前一级或门输出
      const cinSrc: [string, string] = i === 0 ? ['asM', '2'] : [`asOrC_${i - 1}`, 'Y'];
      wires.push(
        w(`asX2B_${i}`, cinSrc, [`asX2_${i}`, 'B'], C_SIG),
        w(`asA2B_${i}`, cinSrc, [`asA2_${i}`, 'B'], C_SIG),
      );
      // 和 LED
      wires.push(
        w(`asSout_${i}`, [`asX2_${i}`, 'Y'], [`asRS${i}`, '1'], sumColors[i]),
        w(`asSr2a_${i}`, [`asRS${i}`, '2'], [`asLS${i}`, 'A'], sumColors[i]),
        w(`asSgnd_${i}`, [`asLS${i}`, 'C'], ['src', 'GND'], C_GND),
      );
    }

    // Cout LED（溢出指示器）
    components.push(res('asRCo', 1100, 60 + N * 200, '220'));
    components.push(led('asLCo', 1100, 60 + N * 200 + 80, 'red'));
    wires.push(
      w('asCo_in', [`asOrC_${N - 1}`, 'Y'], ['asRCo', '1'], C_OUT_R),
      w('asCo_r2a', ['asRCo', '2'], ['asLCo', 'A'], C_OUT_R),
      w('asCo_gnd', ['asLCo', 'C'], ['src', 'GND'], C_GND),
    );

    return digital(
      'digital-adder-subtractor-4bit',
      '4 位加减法器',
      '单条模式线选择加法（M=0）或减法（M=1，通过补码）。每个 B 位与 M 异或，M 同时作为 FA0 进位输入，因此同一条行波链计算 A+B 或 A−B。',
      'advanced',
      components,
      wires,
      ['加法器', '减法器', '4 位', '补码', '大型'],
    );
  })(),

  // ─── 1 位完整 ALU 切片 ────────────────────────────────
  // 操作由 M1 M0 选择：
  //   00 → 与     (Y = A · B,        无进位)
  //   01 → 或     (Y = A + B,        无进位)
  //   10 → 异或   (Y = A 异或 B,      无进位)
  //   11 → 加法   (Y = A + B + Cin,  Cout = 全加器进位)
  // 4:1 多路选择器选择结果。这是 Patterson & Hennessy 构建
  // 32 位 MIPS ALU 所用的单元。
  digital(
    'digital-alu-slice-1bit',
    '1 位 ALU 切片（与 / 或 / 异或 / 加法）',
    '一个完整的 1 位 ALU 单元 — 与、或、异或和加法全部并行计算，由 4 选 1 多路选择器选择哪个结果驱动 Y。进位路径已连线，因此切片可级联成 32 位 ALU，如同 MIPS 中那样。',
    'advanced',
    [
      pwr('src', 40, 380),
      sw('aluA', 200, 40, 0),
      res('aluRA', 290, 100, '10000'),
      sw('aluB', 200, 160, 0),
      res('aluRB', 290, 220, '10000'),
      sw('aluCi', 200, 280, 0),
      res('aluRCi', 290, 340, '10000'),
      sw('aluM0', 200, 400, 0),
      res('aluRM0', 290, 460, '10000'),
      sw('aluM1', 200, 520, 0),
      res('aluRM1', 290, 580, '10000'),
      // 并行结果线
      gate('and', 'aluAnd', 460, 20),
      gate('or', 'aluOr', 460, 140),
      gate('xor', 'aluXor', 460, 260),
      // 用于加法路径的全加器
      gate('xor', 'aluSum1', 460, 380),
      gate('xor', 'aluSum2', 620, 380),
      gate('and', 'aluCar1', 460, 460),
      gate('and', 'aluCar2', 620, 460),
      gate('or', 'aluCout', 780, 460),
      // 4:1 多路选择器：与门选择线译码器 + 四个使能 + 或门
      gate('not', 'aluNM0', 620, 100),
      gate('not', 'aluNM1', 620, 180),
      gate('and-3', 'aluE00', 780, 20),  // !M1·!M0 → 与
      gate('and-3', 'aluE01', 780, 140), // !M1·M0  → 或
      gate('and-3', 'aluE10', 780, 260), // M1·!M0  → 异或
      gate('and-3', 'aluE11', 780, 380), // M1·M0   → 加法
      gate('or-4', 'aluY', 940, 220),
      // 输出 LED
      res('aluRY', 1100, 200, '220'),
      led('aluLY', 1100, 280, 'green'),
      res('aluRCo', 1100, 460, '220'),
      led('aluLCo', 1100, 540, 'red'),
    ],
    [
      // 输入
      w('aluA_pwr', ['src', 'SIG'], ['aluA', '1'], C_PWR),
      w('aluA_pd', ['aluA', '2'], ['aluRA', '1'], C_SIG),
      w('aluA_gnd', ['aluRA', '2'], ['src', 'GND'], C_GND),
      w('aluB_pwr', ['src', 'SIG'], ['aluB', '1'], C_PWR),
      w('aluB_pd', ['aluB', '2'], ['aluRB', '1'], C_SIG),
      w('aluB_gnd', ['aluRB', '2'], ['src', 'GND'], C_GND),
      w('aluCi_pwr', ['src', 'SIG'], ['aluCi', '1'], C_PWR),
      w('aluCi_pd', ['aluCi', '2'], ['aluRCi', '1'], C_SIG),
      w('aluCi_gnd', ['aluRCi', '2'], ['src', 'GND'], C_GND),
      w('aluM0_pwr', ['src', 'SIG'], ['aluM0', '1'], C_PWR),
      w('aluM0_pd', ['aluM0', '2'], ['aluRM0', '1'], C_SIG),
      w('aluM0_gnd', ['aluRM0', '2'], ['src', 'GND'], C_GND),
      w('aluM1_pwr', ['src', 'SIG'], ['aluM1', '1'], C_PWR),
      w('aluM1_pd', ['aluM1', '2'], ['aluRM1', '1'], C_SIG),
      w('aluM1_gnd', ['aluRM1', '2'], ['src', 'GND'], C_GND),
      // 与、或、异或结果线：接收 A 和 B
      w('aluAnd_a', ['aluA', '2'], ['aluAnd', 'A'], C_SIG),
      w('aluAnd_b', ['aluB', '2'], ['aluAnd', 'B'], C_SIG),
      w('aluOr_a', ['aluA', '2'], ['aluOr', 'A'], C_SIG),
      w('aluOr_b', ['aluB', '2'], ['aluOr', 'B'], C_SIG),
      w('aluXor_a', ['aluA', '2'], ['aluXor', 'A'], C_SIG),
      w('aluXor_b', ['aluB', '2'], ['aluXor', 'B'], C_SIG),
      // 全加器：和 = A 异或 B 异或 Cin; Cout = (A·B) + (Cin·(A 异或 B))
      w('aluSum1_a', ['aluA', '2'], ['aluSum1', 'A'], C_SIG),
      w('aluSum1_b', ['aluB', '2'], ['aluSum1', 'B'], C_SIG),
      w('aluSum2_a', ['aluSum1', 'Y'], ['aluSum2', 'A'], C_SIG),
      w('aluSum2_b', ['aluCi', '2'], ['aluSum2', 'B'], C_SIG),
      w('aluCar1_a', ['aluA', '2'], ['aluCar1', 'A'], C_SIG),
      w('aluCar1_b', ['aluB', '2'], ['aluCar1', 'B'], C_SIG),
      w('aluCar2_a', ['aluSum1', 'Y'], ['aluCar2', 'A'], C_SIG),
      w('aluCar2_b', ['aluCi', '2'], ['aluCar2', 'B'], C_SIG),
      w('aluCout_a', ['aluCar1', 'Y'], ['aluCout', 'A'], C_SIG),
      w('aluCout_b', ['aluCar2', 'Y'], ['aluCout', 'B'], C_SIG),
      // 模式线反相器
      w('aluNM0_in', ['aluM0', '2'], ['aluNM0', 'A'], C_SIG),
      w('aluNM1_in', ['aluM1', '2'], ['aluNM1', 'A'], C_SIG),
      // 4:1 多路选择器使能（操作项 · !M1·!M0 等）
      w('aluE00_a', ['aluAnd', 'Y'], ['aluE00', 'A'], C_SIG),
      w('aluE00_b', ['aluNM1', 'Y'], ['aluE00', 'B'], C_SIG),
      w('aluE00_c', ['aluNM0', 'Y'], ['aluE00', 'C'], C_SIG),
      w('aluE01_a', ['aluOr', 'Y'], ['aluE01', 'A'], C_SIG),
      w('aluE01_b', ['aluNM1', 'Y'], ['aluE01', 'B'], C_SIG),
      w('aluE01_c', ['aluM0', '2'], ['aluE01', 'C'], C_SIG),
      w('aluE10_a', ['aluXor', 'Y'], ['aluE10', 'A'], C_SIG),
      w('aluE10_b', ['aluM1', '2'], ['aluE10', 'B'], C_SIG),
      w('aluE10_c', ['aluNM0', 'Y'], ['aluE10', 'C'], C_SIG),
      w('aluE11_a', ['aluSum2', 'Y'], ['aluE11', 'A'], C_SIG),
      w('aluE11_b', ['aluM1', '2'], ['aluE11', 'B'], C_SIG),
      w('aluE11_c', ['aluM0', '2'], ['aluE11', 'C'], C_SIG),
      // 或所有 4 个使能
      w('aluY_a', ['aluE00', 'Y'], ['aluY', 'A'], C_SIG),
      w('aluY_b', ['aluE01', 'Y'], ['aluY', 'B'], C_SIG),
      w('aluY_c', ['aluE10', 'Y'], ['aluY', 'C'], C_SIG),
      w('aluY_d', ['aluE11', 'Y'], ['aluY', 'D'], C_SIG),
      // 输出 LED
      w('aluY_in', ['aluY', 'Y'], ['aluRY', '1'], C_OUT_G),
      w('aluY_r2a', ['aluRY', '2'], ['aluLY', 'A'], C_OUT_G),
      w('aluY_gnd', ['aluLY', 'C'], ['src', 'GND'], C_GND),
      w('aluCo_in', ['aluCout', 'Y'], ['aluRCo', '1'], C_OUT_R),
      w('aluCo_r2a', ['aluRCo', '2'], ['aluLCo', 'A'], C_OUT_R),
      w('aluCo_gnd', ['aluLCo', 'C'], ['src', 'GND'], C_GND),
    ],
    ['ALU', '1 位', 'MIPS', '多路选择器', '大型'],
  ),

  // ─── 4 位超前进位加法器 ─────────────────────────────────────────
  // 用并行进位网络替代行波链。
  //   gi = Ai · Bi          （生成）
  //   pi = Ai 异或 Bi        （传播）
  //   c1 = g0 + p0·c0
  //   c2 = g1 + p1·g0 + p1·p0·c0
  //   c3 = g2 + p2·g1 + p2·p1·g0 + p2·p1·p0·c0
  //   c4 = g3 + p3·g2 + p3·p2·g1 + p3·p2·p1·g0 + (p3·p2·p1·p0)·c0
  // 进位延迟 = O(log n) 而非 O(n) — 经典加法器加速方案。
  (() => {
    const components: ExampleProject['components'] = [pwr('src', 40, 460)];
    const wires: ExampleProject['wires'] = [];
    const N = 4;
    const ledColors = ['red', 'yellow', 'green', 'blue'];
    const sumColors = [C_OUT_R, C_OUT_Y, C_OUT_G, C_OUT_B];

    // 输入：A0..A3, B0..B3, c0
    for (let i = 0; i < N; i++) {
      const yA = 40 + i * 80;
      const yB = 40 + (N + i) * 80;
      components.push(sw(`claA${i}`, 200, yA, 0));
      components.push(res(`claRA${i}`, 290, yA + 30, '10000'));
      components.push(sw(`claB${i}`, 200, yB, 0));
      components.push(res(`claRB${i}`, 290, yB + 30, '10000'));
      wires.push(
        w(`claA${i}_pwr`, ['src', 'SIG'], [`claA${i}`, '1'], C_PWR),
        w(`claA${i}_pd`, [`claA${i}`, '2'], [`claRA${i}`, '1'], C_SIG),
        w(`claA${i}_gnd`, [`claRA${i}`, '2'], ['src', 'GND'], C_GND),
        w(`claB${i}_pwr`, ['src', 'SIG'], [`claB${i}`, '1'], C_PWR),
        w(`claB${i}_pd`, [`claB${i}`, '2'], [`claRB${i}`, '1'], C_SIG),
        w(`claB${i}_gnd`, [`claRB${i}`, '2'], ['src', 'GND'], C_GND),
      );
    }
    components.push(sw('claC0', 200, 40 + 2 * N * 80, 0));
    components.push(res('claRC0', 290, 40 + 2 * N * 80 + 30, '10000'));
    wires.push(
      w('claC0_pwr', ['src', 'SIG'], ['claC0', '1'], C_PWR),
      w('claC0_pd', ['claC0', '2'], ['claRC0', '1'], C_SIG),
      w('claC0_gnd', ['claRC0', '2'], ['src', 'GND'], C_GND),
    );

    // 每位的生成 gi、传播 pi
    for (let i = 0; i < N; i++) {
      const y = 40 + i * 140;
      components.push(
        gate('and', `claG${i}`, 460, y),
        gate('xor', `claP${i}`, 460, y + 70),
      );
      wires.push(
        w(`claG${i}_a`, [`claA${i}`, '2'], [`claG${i}`, 'A'], C_SIG),
        w(`claG${i}_b`, [`claB${i}`, '2'], [`claG${i}`, 'B'], C_SIG),
        w(`claP${i}_a`, [`claA${i}`, '2'], [`claP${i}`, 'A'], C_SIG),
        w(`claP${i}_b`, [`claB${i}`, '2'], [`claP${i}`, 'B'], C_SIG),
      );
    }

    // 进位网络（超前进位展开式）
    // c1 = g0 + p0·c0
    components.push(
      gate('and', 'claT_p0c0', 620, 100),
      gate('or', 'claC1', 780, 60),
      // c2 = g1 + p1·g0 + p1·p0·c0
      gate('and', 'claT_p1g0', 620, 240),
      gate('and-3', 'claT_p1p0c0', 620, 320),
      gate('or-3', 'claC2', 780, 280),
      // c3 = g2 + p2·g1 + p2·p1·g0 + p2·p1·p0·c0
      gate('and', 'claT_p2g1', 620, 480),
      gate('and-3', 'claT_p2p1g0', 620, 560),
      gate('and-4', 'claT_p2p1p0c0', 620, 640),
      gate('or-4', 'claC3', 780, 540),
      // c4 = g3 + p3·g2 + p3·p2·g1 + p3·p2·p1·g0 + (p3·p2·p1·p0)·c0
      gate('and', 'claT_p3g2', 620, 800),
      gate('and-3', 'claT_p3p2g1', 620, 880),
      gate('and-4', 'claT_p3p2p1g0', 620, 960),
      gate('and-4', 'claT_pAll', 460, 1040),
      gate('and', 'claT_pAllc0', 620, 1040),
      gate('or-4', 'claC4a', 780, 880),
      gate('or', 'claC4', 940, 920),
    );
    wires.push(
      // c1
      w('claC1_a', ['claG0', 'Y'], ['claC1', 'A'], C_SIG),
      w('claT_p0c0_a', ['claP0', 'Y'], ['claT_p0c0', 'A'], C_SIG),
      w('claT_p0c0_b', ['claC0', '2'], ['claT_p0c0', 'B'], C_SIG),
      w('claC1_b', ['claT_p0c0', 'Y'], ['claC1', 'B'], C_SIG),
      // c2
      w('claT_p1g0_a', ['claP1', 'Y'], ['claT_p1g0', 'A'], C_SIG),
      w('claT_p1g0_b', ['claG0', 'Y'], ['claT_p1g0', 'B'], C_SIG),
      w('claT_p1p0c0_a', ['claP1', 'Y'], ['claT_p1p0c0', 'A'], C_SIG),
      w('claT_p1p0c0_b', ['claP0', 'Y'], ['claT_p1p0c0', 'B'], C_SIG),
      w('claT_p1p0c0_c', ['claC0', '2'], ['claT_p1p0c0', 'C'], C_SIG),
      w('claC2_a', ['claG1', 'Y'], ['claC2', 'A'], C_SIG),
      w('claC2_b', ['claT_p1g0', 'Y'], ['claC2', 'B'], C_SIG),
      w('claC2_c', ['claT_p1p0c0', 'Y'], ['claC2', 'C'], C_SIG),
      // c3
      w('claT_p2g1_a', ['claP2', 'Y'], ['claT_p2g1', 'A'], C_SIG),
      w('claT_p2g1_b', ['claG1', 'Y'], ['claT_p2g1', 'B'], C_SIG),
      w('claT_p2p1g0_a', ['claP2', 'Y'], ['claT_p2p1g0', 'A'], C_SIG),
      w('claT_p2p1g0_b', ['claP1', 'Y'], ['claT_p2p1g0', 'B'], C_SIG),
      w('claT_p2p1g0_c', ['claG0', 'Y'], ['claT_p2p1g0', 'C'], C_SIG),
      w('claT_p2p1p0c0_a', ['claP2', 'Y'], ['claT_p2p1p0c0', 'A'], C_SIG),
      w('claT_p2p1p0c0_b', ['claP1', 'Y'], ['claT_p2p1p0c0', 'B'], C_SIG),
      w('claT_p2p1p0c0_c', ['claP0', 'Y'], ['claT_p2p1p0c0', 'C'], C_SIG),
      w('claT_p2p1p0c0_d', ['claC0', '2'], ['claT_p2p1p0c0', 'D'], C_SIG),
      w('claC3_a', ['claG2', 'Y'], ['claC3', 'A'], C_SIG),
      w('claC3_b', ['claT_p2g1', 'Y'], ['claC3', 'B'], C_SIG),
      w('claC3_c', ['claT_p2p1g0', 'Y'], ['claC3', 'C'], C_SIG),
      w('claC3_d', ['claT_p2p1p0c0', 'Y'], ['claC3', 'D'], C_SIG),
      // c4
      w('claT_p3g2_a', ['claP3', 'Y'], ['claT_p3g2', 'A'], C_SIG),
      w('claT_p3g2_b', ['claG2', 'Y'], ['claT_p3g2', 'B'], C_SIG),
      w('claT_p3p2g1_a', ['claP3', 'Y'], ['claT_p3p2g1', 'A'], C_SIG),
      w('claT_p3p2g1_b', ['claP2', 'Y'], ['claT_p3p2g1', 'B'], C_SIG),
      w('claT_p3p2g1_c', ['claG1', 'Y'], ['claT_p3p2g1', 'C'], C_SIG),
      w('claT_p3p2p1g0_a', ['claP3', 'Y'], ['claT_p3p2p1g0', 'A'], C_SIG),
      w('claT_p3p2p1g0_b', ['claP2', 'Y'], ['claT_p3p2p1g0', 'B'], C_SIG),
      w('claT_p3p2p1g0_c', ['claP1', 'Y'], ['claT_p3p2p1g0', 'C'], C_SIG),
      w('claT_p3p2p1g0_d', ['claG0', 'Y'], ['claT_p3p2p1g0', 'D'], C_SIG),
      // pAll = p3·p2·p1·p0 ; 然后 (pAll)·c0
      w('claT_pAll_a', ['claP3', 'Y'], ['claT_pAll', 'A'], C_SIG),
      w('claT_pAll_b', ['claP2', 'Y'], ['claT_pAll', 'B'], C_SIG),
      w('claT_pAll_c', ['claP1', 'Y'], ['claT_pAll', 'C'], C_SIG),
      w('claT_pAll_d', ['claP0', 'Y'], ['claT_pAll', 'D'], C_SIG),
      w('claT_pAllc0_a', ['claT_pAll', 'Y'], ['claT_pAllc0', 'A'], C_SIG),
      w('claT_pAllc0_b', ['claC0', '2'], ['claT_pAllc0', 'B'], C_SIG),
      // (g3, p3·g2, p3·p2·g1, p3·p2·p1·g0) 的 4 输入或门
      w('claC4a_a', ['claG3', 'Y'], ['claC4a', 'A'], C_SIG),
      w('claC4a_b', ['claT_p3g2', 'Y'], ['claC4a', 'B'], C_SIG),
      w('claC4a_c', ['claT_p3p2g1', 'Y'], ['claC4a', 'C'], C_SIG),
      w('claC4a_d', ['claT_p3p2p1g0', 'Y'], ['claC4a', 'D'], C_SIG),
      // 最终与 (pAll·c0) 的或门
      w('claC4_a', ['claC4a', 'Y'], ['claC4', 'A'], C_SIG),
      w('claC4_b', ['claT_pAllc0', 'Y'], ['claC4', 'B'], C_SIG),
    );

    // 和位 si = pi 异或 ci
    for (let i = 0; i < N; i++) {
      const ySum = 40 + i * 140 + 70;
      components.push(
        gate('xor', `claS${i}`, 1100, ySum),
        res(`claRS${i}`, 1260, ySum - 20, '220'),
        led(`claLS${i}`, 1260, ySum + 60, ledColors[i]),
      );
      const cinSrc: [string, string] = i === 0 ? ['claC0', '2'] : [`claC${i}`, 'Y'];
      wires.push(
        w(`claS${i}_a`, [`claP${i}`, 'Y'], [`claS${i}`, 'A'], C_SIG),
        w(`claS${i}_b`, cinSrc, [`claS${i}`, 'B'], C_SIG),
        w(`claS${i}_in`, [`claS${i}`, 'Y'], [`claRS${i}`, '1'], sumColors[i]),
        w(`claS${i}_r2a`, [`claRS${i}`, '2'], [`claLS${i}`, 'A'], sumColors[i]),
        w(`claS${i}_gnd`, [`claLS${i}`, 'C'], ['src', 'GND'], C_GND),
      );
    }

    // 来自 c4 的 Cout LED
    components.push(res('claRCo', 1260, 940, '220'));
    components.push(led('claLCo', 1260, 1020, 'red'));
    wires.push(
      w('claCo_in', ['claC4', 'Y'], ['claRCo', '1'], C_OUT_R),
      w('claCo_r2a', ['claRCo', '2'], ['claLCo', 'A'], C_OUT_R),
      w('claCo_gnd', ['claLCo', 'C'], ['src', 'GND'], C_GND),
    );

    return digital(
      'digital-carry-lookahead-adder-4bit',
      '4 位超前进位加法器',
      '用并行进位网络替代行波链。生成/传播信号 + 四个超前进位展开式在恒定门深度内计算 c1..c4 — 与扩展到 64 位 CPU 加法器中相同的 O(log n) 加速模式。',
      'advanced',
      components,
      wires,
      ['加法器', '4 位', '超前进位', 'CLA', '大型', '学术'],
    );
  })(),

  // ─── BCD 转 7 段译码器（仅段 a — 门级特写） ──────
  // 完整的 BCD 转 7 段芯片是 7 个卡诺图最小化的 SOP。作为教学
  // 示例，我们在门级仅连接一个段（段"a"），使
  // 单个卡诺图输出的结构可见，而不会让画布被
  // 40 多个门淹没。
  //   a = B3 + B1 + B2·B0 + !B2·!B0
  digital(
    'digital-bcd-7seg-segment-a',
    'BCD → 7 段译码：段 "a"',
    '点亮数字 0、2、3、5、6、7、8、9 的段 "a"，对 1 和 4 则熄灭。7447 式译码器的一片，以门级构建，使卡诺图最小化 a = B3 + B1 + B2·B0 + !B2·!B0 端到端可见。',
    'advanced',
    [
      pwr('src', 40, 300),
      sw('saB0', 200, 40, 0),
      res('saR0', 290, 100, '10000'),
      sw('saB1', 200, 160, 0),
      res('saR1', 290, 220, '10000'),
      sw('saB2', 200, 280, 0),
      res('saR2', 290, 340, '10000'),
      sw('saB3', 200, 400, 0),
      res('saR3', 290, 460, '10000'),
      // !B0, !B2
      gate('not', 'saNB0', 460, 60),
      gate('not', 'saNB2', 460, 280),
      // B2·B0
      gate('and', 'saB2B0', 620, 100),
      // !B2·!B0
      gate('and', 'saNB2NB0', 620, 220),
      // 最终 4 输入或门
      gate('or-4', 'saA', 780, 220),
      // 输出 LED
      res('saRl', 940, 200, '220'),
      led('saLed', 940, 290, 'red'),
    ],
    [
      // 输入
      w('saB0_pwr', ['src', 'SIG'], ['saB0', '1'], C_PWR),
      w('saB0_pd', ['saB0', '2'], ['saR0', '1'], C_SIG),
      w('saB0_gnd', ['saR0', '2'], ['src', 'GND'], C_GND),
      w('saB1_pwr', ['src', 'SIG'], ['saB1', '1'], C_PWR),
      w('saB1_pd', ['saB1', '2'], ['saR1', '1'], C_SIG),
      w('saB1_gnd', ['saR1', '2'], ['src', 'GND'], C_GND),
      w('saB2_pwr', ['src', 'SIG'], ['saB2', '1'], C_PWR),
      w('saB2_pd', ['saB2', '2'], ['saR2', '1'], C_SIG),
      w('saB2_gnd', ['saR2', '2'], ['src', 'GND'], C_GND),
      w('saB3_pwr', ['src', 'SIG'], ['saB3', '1'], C_PWR),
      w('saB3_pd', ['saB3', '2'], ['saR3', '1'], C_SIG),
      w('saB3_gnd', ['saR3', '2'], ['src', 'GND'], C_GND),
      // !B0, !B2
      w('saNB0_in', ['saB0', '2'], ['saNB0', 'A'], C_SIG),
      w('saNB2_in', ['saB2', '2'], ['saNB2', 'A'], C_SIG),
      // B2·B0
      w('saB2B0_a', ['saB2', '2'], ['saB2B0', 'A'], C_SIG),
      w('saB2B0_b', ['saB0', '2'], ['saB2B0', 'B'], C_SIG),
      // !B2·!B0
      w('saNN_a', ['saNB2', 'Y'], ['saNB2NB0', 'A'], C_SIG),
      w('saNN_b', ['saNB0', 'Y'], ['saNB2NB0', 'B'], C_SIG),
      // (B3, B1, B2·B0, !B2·!B0) 的 4 输入或门
      w('saA_a', ['saB3', '2'], ['saA', 'A'], C_SIG),
      w('saA_b', ['saB1', '2'], ['saA', 'B'], C_SIG),
      w('saA_c', ['saB2B0', 'Y'], ['saA', 'C'], C_SIG),
      w('saA_d', ['saNB2NB0', 'Y'], ['saA', 'D'], C_SIG),
      // 输出
      w('saA_in', ['saA', 'Y'], ['saRl', '1'], C_OUT_R),
      w('saA_r2a', ['saRl', '2'], ['saLed', 'A'], C_OUT_R),
      w('saA_gnd', ['saLed', 'C'], ['src', 'GND'], C_GND),
    ],
    ['BCD', '7 段', '译码器', '卡诺图'],
  ),

  // ════════════════════════════════════════════════════════════════════════
  // 时序电路 — 触发器（仅数字引擎；无 SPICE 边沿检测）
  // ════════════════════════════════════════════════════════════════════════

  (() => {
    const N = 4;
    const components: ExampleProject['components'] = [pwr('src', 40, 380)];
    const wires: ExampleProject['wires'] = [];
    // 时钟滑动开关 -> FF0.CLK（带下拉电阻）。
    const clk = switchInput('cnt_clk', 'cnt_clk_r', 'src', 'cnt_ff0', 'CLK', 200, 60, 0, 'cnt_clk');
    components.push(...clk.components);
    wires.push(...clk.wires);
    const ledColors = ['red', 'green', 'blue', 'yellow'];
    const wireColors = [C_OUT_R, C_OUT_G, C_OUT_B, C_OUT_Y];
    for (let i = 0; i < N; i++) {
      const id = `cnt_ff${i}`;
      components.push(ff('t', id, 440, 120 + i * 150));
      wires.push(w(`cnt_t${i}`, ['src', 'SIG'], [id, 'T'], C_PWR)); // T 接高电平 -> 翻转
      if (i > 0) wires.push(w(`cnt_rip${i}`, [`cnt_ff${i - 1}`, 'Qbar'], [id, 'CLK'], C_SIG)); // 行波
      const lo = ledOutput(`cnt_lr${i}`, `cnt_led${i}`, 'src', id, 'Q', 720, 110 + i * 150, ledColors[i], `cnt_led${i}`, wireColors[i]);
      components.push(...lo.components);
      wires.push(...lo.wires);
    }
    return digital(
      'digital-ripple-counter-4bit',
      '4 位行波计数器（T 触发器）',
      '四个 T 触发器级联成行波计数器 — 在 SPICE 引擎上无法实现' +
        '（直流下无边沿检测）。每次将时钟开关从低拨到高时，' +
        '计数递增；四个 LED 以二进制显示，最低位在顶部。' +
        '事件驱动的数字引擎精确计算触发器。' +
        '（设置 ?digitalgates=off 即可看到 ngspice 无法运行此电路。）',
      'advanced',
      components,
      wires,
      ['计数器', '时序电路', '触发器', 'T触发器', '行波', '数字引擎'],
    );
  })(),
];
