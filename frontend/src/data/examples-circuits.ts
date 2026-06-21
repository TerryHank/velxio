/**
 * 电路相关示例项目 — 模拟、数字、机电一体化。
 *
 * 这些示例展示了 SPICE 电气仿真模式，使用真实的
 * 元器件模型（晶体管、运算放大器、稳压器、逻辑门、继电器）。
 * 每个示例在 test/test_circuit/test/spice_examples.test.js 中都有相应的 ngspice 测试。
 */
import type { ExampleProject } from './examples';

// ─── 辅助：标准 Arduino Uno 位于 (100,100) ─────────────────────────────
const UNO = { type: 'wokwi-arduino-uno', id: 'arduino-uno', x: 100, y: 100, properties: {} };
const MEGA = { type: 'wokwi-arduino-mega', id: 'arduino-mega', x: 80, y: 80, properties: {} };
const ESP32 = { type: 'wokwi-esp32-devkit-v1', id: 'esp32', x: 80, y: 80, properties: {} };

function w(id: string, from: [string, string], to: [string, string], color = '#00aaff') {
  return {
    id,
    start: { componentId: from[0], pinName: from[1] },
    end: { componentId: to[0], pinName: to[1] },
    color,
  };
}

export const circuitExamples: ExampleProject[] = [
  // ════════════════════════════════════════════════════════════════════════════
  // 无源 / 模拟（10 个示例）
  // ════════════════════════════════════════════════════════════════════════════

  {
    id: 'voltage-divider',
    title: '分压器',
    description: 'R1 + R2 将 5V 分压为较低电压，由 ADC 读取。基础模拟电路。',
    category: 'circuits',
    difficulty: 'beginner',
    code: `// Voltage Divider — reads V_out = 5 * R2/(R1+R2)
void setup() { Serial.begin(9600); }
void loop() {
  int raw = analogRead(A0);
  float v = raw * 5.0 / 1023.0;
  Serial.print("V_out = "); Serial.print(v, 3); Serial.println(" V");
  delay(500);
}`,
    components: [
      UNO,
      { type: 'wokwi-resistor', id: 'r1', x: 350, y: 80, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'r2', x: 350, y: 200, properties: { value: '10000' } },
    ],
    wires: [
      w('w1', ['arduino-uno', '5V'], ['r1', '1'], '#ff0000'),
      w('w2', ['r1', '2'], ['r2', '1'], '#00aaff'),
      w('w3', ['r2', '2'], ['arduino-uno', 'GND'], '#000000'),
      w('w4', ['r1', '2'], ['arduino-uno', 'A0'], '#ffaa00'),
    ],
  },

  {
    id: 'rc-low-pass-filter',
    title: 'RC 低通滤波器',
    description: 'PWM 输出经 RC 滤波后得到平滑模拟电压。经典的 DAC 技巧。',
    category: 'circuits',
    difficulty: 'beginner',
    code: `// RC Low-Pass Filter
// PWM on pin 9 → R=10k → C=10uF → smooth DC on A0
// DC steady-state: V_out ≈ duty × Vcc = 0.5 × 5 = 2.5 V
void setup() { Serial.begin(9600); analogWrite(9, 128); } // 50% duty
void loop() {
  float v = analogRead(A0) * 5.0 / 1023.0;
  Serial.print("Filtered V = "); Serial.println(v, 2);
  delay(200);
}`,
    components: [
      UNO,
      { type: 'wokwi-resistor', id: 'r1', x: 350, y: 100, properties: { value: '10000' } },
      { type: 'wokwi-capacitor', id: 'c1', x: 420, y: 200, properties: { value: '10u' } },
    ],
    wires: [
      w('w1', ['arduino-uno', '9'], ['r1', '1'], '#00aaff'),
      w('w2', ['r1', '2'], ['arduino-uno', 'A0'], '#ffaa00'),
      w('w3', ['r1', '2'], ['c1', '1'], '#ffaa00'),
      w('w4', ['c1', '2'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  {
    id: 'wheatstone-bridge',
    title: '惠斯通电桥',
    description:
      '四电阻电桥检测微小的电阻变化。用于应变片和称重传感器。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// Wheatstone Bridge — detects R imbalance
void setup() { Serial.begin(9600); }
void loop() {
  float vA = analogRead(A0) * 5.0 / 1023.0;
  float vB = analogRead(A1) * 5.0 / 1023.0;
  float diff = vA - vB;
  Serial.print("V_diff = "); Serial.print(diff * 1000, 1); Serial.println(" mV");
  delay(500);
}`,
    components: [
      UNO,
      { type: 'wokwi-resistor', id: 'r1', x: 350, y: 60, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'r2', x: 500, y: 60, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'r3', x: 350, y: 200, properties: { value: '11000' } },
      { type: 'wokwi-resistor', id: 'r4', x: 500, y: 200, properties: { value: '10000' } },
    ],
    wires: [
      w('w1', ['arduino-uno', '5V'], ['r1', '1'], '#ff0000'),
      w('w2', ['arduino-uno', '5V'], ['r2', '1'], '#ff0000'),
      w('w3', ['r1', '2'], ['r3', '1'], '#00aaff'),
      w('w4', ['r2', '2'], ['r4', '1'], '#00aaff'),
      w('w5', ['r3', '2'], ['arduino-uno', 'GND'], '#000000'),
      w('w6', ['r4', '2'], ['arduino-uno', 'GND'], '#000000'),
      w('w7', ['r1', '2'], ['arduino-uno', 'A0'], '#ffaa00'),
      w('w8', ['r2', '2'], ['arduino-uno', 'A1'], '#ffaa00'),
    ],
  },

  {
    id: 'ntc-temperature',
    title: 'NTC 温度传感器',
    description:
      'NTC 模块（内置 10k 上拉电阻）。通过 Beta 模型计算温度。',
    category: 'circuits',
    difficulty: 'beginner',
    code: `// NTC Temperature Sensor (beta model)
#define NTC_PIN A0
#define R_PULL 10000.0
#define NTC_R0 10000.0
#define NTC_T0 298.15
#define NTC_BETA 3950.0

void setup() { Serial.begin(9600); }
void loop() {
  int raw = analogRead(NTC_PIN);
  float v = raw * 5.0 / 1023.0;
  float rNtc = R_PULL * v / (5.0 - v);
  float tK = 1.0 / (1.0/NTC_T0 + log(rNtc/NTC_R0)/NTC_BETA);
  float tC = tK - 273.15;
  Serial.print("Temp = "); Serial.print(tC, 1); Serial.println(" C");
  delay(1000);
}`,
    components: [
      UNO,
      {
        type: 'wokwi-ntc-temperature-sensor',
        id: 'ntc',
        x: 350,
        y: 150,
        properties: { temperature: '25' },
      },
    ],
    wires: [
      w('w1', ['arduino-uno', '5V'], ['ntc', 'VCC'], '#ff0000'),
      w('w2', ['ntc', 'GND'], ['arduino-uno', 'GND'], '#000000'),
      w('w3', ['ntc', 'OUT'], ['arduino-uno', 'A0'], '#ffaa00'),
    ],
  },

  {
    id: 'led-current-limiting',
    title: 'LED 限流电路',
    description: '计算电阻使 LED 电流为 10mA。I = (Vcc-Vf)/R。',
    category: 'circuits',
    difficulty: 'beginner',
    code: `// LED with current-limiting resistor
// R = (5V - 2V) / 10mA = 300 ohm
void setup() { pinMode(13, OUTPUT); }
void loop() {
  digitalWrite(13, HIGH); delay(1000);
  digitalWrite(13, LOW);  delay(1000);
}`,
    components: [
      UNO,
      { type: 'wokwi-resistor', id: 'r1', x: 380, y: 120, properties: { value: '330' } },
      { type: 'wokwi-led', id: 'led1', x: 380, y: 220, properties: { color: 'red' } },
    ],
    wires: [
      w('w1', ['arduino-uno', '13'], ['r1', '1'], '#00aaff'),
      w('w2', ['r1', '2'], ['led1', 'A'], '#00aaff'),
      w('w3', ['led1', 'C'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  {
    id: 'parallel-resistors',
    title: '并联电阻',
    description: '三个电阻并联：R_total = 1/(1/R1+1/R2+1/R3)。用 ADC 测量。',
    category: 'circuits',
    difficulty: 'beginner',
    code: `// Parallel Resistors — measure equivalent R via voltage divider
// R_series = 10k, R_parallel = 1/(1/10k + 1/10k + 1/10k) = 3.33k
// V_out = 5 * R_par / (R_ser + R_par) = 5 * 3.33 / 13.33 = 1.25V
void setup() { Serial.begin(9600); }
void loop() {
  float v = analogRead(A0) * 5.0 / 1023.0;
  Serial.print("V = "); Serial.println(v, 3);
  delay(500);
}`,
    components: [
      UNO,
      { type: 'wokwi-resistor', id: 'rs', x: 350, y: 80, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'r1', x: 350, y: 200, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'r2', x: 420, y: 200, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'r3', x: 490, y: 200, properties: { value: '10000' } },
    ],
    wires: [
      w('w1', ['arduino-uno', '5V'], ['rs', '1'], '#ff0000'),
      w('w2', ['rs', '2'], ['r1', '1'], '#ffaa00'),
      w('w3', ['rs', '2'], ['r2', '1'], '#ffaa00'),
      w('w4', ['rs', '2'], ['r3', '1'], '#ffaa00'),
      w('w5', ['r1', '2'], ['arduino-uno', 'GND'], '#000000'),
      w('w6', ['r2', '2'], ['arduino-uno', 'GND'], '#000000'),
      w('w7', ['r3', '2'], ['arduino-uno', 'GND'], '#000000'),
      w('w8', ['rs', '2'], ['arduino-uno', 'A0'], '#ffaa00'),
    ],
  },

  {
    id: 'pot-adc-reader',
    title: '电位器 ADC 读取器',
    description: '旋转电位器旋钮，使 A0 上的电压在 0 到 5V 之间变化。',
    category: 'circuits',
    difficulty: 'beginner',
    code: `// Potentiometer reader
void setup() { Serial.begin(9600); }
void loop() {
  int raw = analogRead(A0);
  float pct = raw * 100.0 / 1023.0;
  Serial.print("Position: "); Serial.print(pct, 1); Serial.println("%");
  delay(200);
}`,
    components: [UNO, { type: 'wokwi-potentiometer', id: 'pot', x: 380, y: 160, properties: {} }],
    wires: [
      w('w1', ['arduino-uno', '5V'], ['pot', 'VCC'], '#ff0000'),
      w('w2', ['pot', 'GND'], ['arduino-uno', 'GND'], '#000000'),
      w('w3', ['pot', 'SIG'], ['arduino-uno', 'A0'], '#ffaa00'),
    ],
  },

  {
    id: 'photoresistor-light',
    title: '光敏电阻光线传感器',
    description:
      'LDR + 下拉电阻。光线越亮 = LDR 电阻越低 = 电压越高。',
    category: 'circuits',
    difficulty: 'beginner',
    code: `// Photoresistor light sensor
void setup() { Serial.begin(9600); }
void loop() {
  int raw = analogRead(A0);
  float lux = map(raw, 0, 1023, 0, 100);
  Serial.print("Light: "); Serial.print(lux, 0); Serial.println("%");
  delay(300);
}`,
    components: [
      UNO,
      { type: 'wokwi-photoresistor-sensor', id: 'ldr', x: 380, y: 150, properties: { lux: '500' } },
    ],
    wires: [
      w('w1', ['arduino-uno', '5V'], ['ldr', 'VCC'], '#ff0000'),
      w('w2', ['ldr', 'GND'], ['arduino-uno', 'GND'], '#000000'),
      w('w3', ['ldr', 'AO'], ['arduino-uno', 'A0'], '#ffaa00'),
    ],
  },

  {
    id: 'multi-led-bar',
    title: 'LED 条形图',
    description: '5 个 LED 由数字引脚驱动，各自配有电阻。条形图显示。',
    category: 'circuits',
    difficulty: 'beginner',
    code: `// LED Bar Graph — 5 LEDs on pins 2-6
void setup() { for(int i=2;i<=6;i++) pinMode(i,OUTPUT); }
void loop() {
  for(int i=2;i<=6;i++) { digitalWrite(i,HIGH); delay(200); }
  for(int i=6;i>=2;i--) { digitalWrite(i,LOW);  delay(200); }
}`,
    components: [
      UNO,
      ...Array.from({ length: 5 }, (_, i) => ({
        type: 'wokwi-resistor',
        id: `r${i}`,
        x: 350,
        y: 60 + i * 50,
        properties: { value: '220' },
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        type: 'wokwi-led',
        id: `led${i}`,
        x: 450,
        y: 60 + i * 50,
        properties: { color: ['red', 'yellow', 'green', 'blue', 'white'][i] },
      })),
    ],
    wires: [
      ...Array.from({ length: 5 }, (_, i) =>
        w(`wa${i}`, ['arduino-uno', `${i + 2}`], [`r${i}`, '1']),
      ),
      ...Array.from({ length: 5 }, (_, i) => w(`wb${i}`, [`r${i}`, '2'], [`led${i}`, 'A'])),
      ...Array.from({ length: 5 }, (_, i) =>
        w(`wc${i}`, [`led${i}`, 'C'], ['arduino-uno', 'GND'], '#000000'),
      ),
    ],
  },

  {
    id: 'capacitor-charge-curve',
    title: '电容充电曲线',
    description: '通过电阻给电容充电，用 ADC 读取指数 V(t) 曲线。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// RC Charging — observe exponential curve
// tau = R*C = 10k * 100uF = 1 second
void setup() {
  Serial.begin(9600);
  pinMode(8, OUTPUT);
  digitalWrite(8, HIGH); // start charging
}
void loop() {
  float v = analogRead(A0) * 5.0 / 1023.0;
  Serial.print("V_cap = "); Serial.println(v, 3);
  delay(100);
}`,
    components: [
      UNO,
      { type: 'wokwi-resistor', id: 'r1', x: 380, y: 100, properties: { value: '10000' } },
      { type: 'wokwi-capacitor', id: 'c1', x: 450, y: 200, properties: { value: '100u' } },
    ],
    wires: [
      w('w1', ['arduino-uno', '8'], ['r1', '1'], '#00aaff'),
      w('w2', ['r1', '2'], ['c1', '1'], '#ffaa00'),
      w('w3', ['r1', '2'], ['arduino-uno', 'A0'], '#ffaa00'),
      w('w4', ['c1', '2'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 晶体管 / 半导体（8 个示例）
  // ════════════════════════════════════════════════════════════════════════════

  {
    id: 'npn-led-switch',
    title: 'NPN 晶体管 LED 开关',
    description: '2N2222 NPN 管用小电流 MCU 引脚驱动大电流 LED。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// NPN switch — pin 9 drives base through 1k, collector drives LED
void setup() { pinMode(9, OUTPUT); }
void loop() {
  digitalWrite(9, HIGH); delay(1000);
  digitalWrite(9, LOW);  delay(1000);
}`,
    components: [
      UNO,
      { type: 'wokwi-resistor', id: 'rb', x: 380, y: 100, properties: { value: '1000' } },
      { type: 'wokwi-resistor', id: 'rc', x: 480, y: 60, properties: { value: '220' } },
      { type: 'wokwi-led', id: 'led1', x: 480, y: 160, properties: { color: 'green' } },
      { type: 'wokwi-bjt-2n2222', id: 'q1', x: 480, y: 260, properties: {} },
    ],
    wires: [
      // Base drive: pin 9 → 1k → base
      w('w1', ['arduino-uno', '9'], ['rb', '1']),
      w('w2', ['rb', '2'], ['q1', 'B']),
      // Load path: 5V → Rc → LED → collector
      w('w3', ['arduino-uno', '5V'], ['rc', '1'], '#ff0000'),
      w('w4', ['rc', '2'], ['led1', 'A']),
      w('w5', ['led1', 'C'], ['q1', 'C']),
      // Emitter to ground
      w('w6', ['q1', 'E'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  {
    id: 'pnp-high-side-switch',
    title: 'PNP 高侧开关',
    description: '2N3906 PNP 管在基极拉低时将负载切换到 Vcc。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// PNP high-side switch
// Pin 9 LOW = load ON, Pin 9 HIGH = load OFF
void setup() { pinMode(9, OUTPUT); }
void loop() {
  digitalWrite(9, LOW);  delay(2000); // ON
  digitalWrite(9, HIGH); delay(2000); // OFF
}`,
    components: [
      UNO,
      { type: 'wokwi-resistor', id: 'rb', x: 380, y: 100, properties: { value: '1000' } },
      { type: 'wokwi-resistor', id: 'rl', x: 520, y: 200, properties: { value: '220' } },
      { type: 'wokwi-led', id: 'led1', x: 520, y: 280, properties: { color: 'red' } },
      { type: 'wokwi-bjt-2n3906', id: 'q1', x: 420, y: 160, properties: {} },
    ],
    wires: [
      // Pin 9 → Rb → Base (LOW = ON for PNP)
      w('w1', ['arduino-uno', '9'], ['rb', '1']),
      w('w2', ['rb', '2'], ['q1', 'B']),
      // Emitter to 5V (high-side)
      w('w3', ['q1', 'E'], ['arduino-uno', '5V'], '#ff0000'),
      // Collector → Rl → LED → GND
      w('w4', ['q1', 'C'], ['rl', '1']),
      w('w5', ['rl', '2'], ['led1', 'A']),
      w('w6', ['led1', 'C'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  {
    id: 'mosfet-pwm-led',
    title: 'MOSFET PWM LED 调光器',
    description: '2N7000 N-MOSFET 作为低侧开关。栅极由引脚 9 的 PWM 驱动来调光 LED。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// MOSFET PWM LED dimmer
void setup() { pinMode(9, OUTPUT); }
void loop() {
  for(int b=0; b<=255; b+=5) { analogWrite(9, b); delay(30); }
  for(int b=255; b>=0; b-=5) { analogWrite(9, b); delay(30); }
}`,
    components: [
      UNO,
      { type: 'wokwi-resistor', id: 'rl', x: 420, y: 60, properties: { value: '220' } },
      { type: 'wokwi-led', id: 'led1', x: 420, y: 160, properties: { color: 'white' } },
      { type: 'wokwi-mosfet-2n7000', id: 'q1', x: 420, y: 260, properties: {} },
      // Gate pull-down keeps the MOSFET off when the GPIO is high-impedance
      // (e.g. before setup() runs) — avoids ghost glow during boot.
      { type: 'wokwi-resistor', id: 'rg', x: 320, y: 290, properties: { value: '100000' } },
    ],
    wires: [
      // LED: 5V → R → LED anode → cathode → MOSFET drain
      w('w1', ['arduino-uno', '5V'], ['rl', '1'], '#ff0000'),
      w('w2', ['rl', '2'], ['led1', 'A']),
      w('w3', ['led1', 'C'], ['q1', 'D']),
      // Source to GND (low-side switch)
      w('w4', ['q1', 'S'], ['arduino-uno', 'GND'], '#000000'),
      // PWM gate drive from pin 9, plus pull-down to GND
      w('w5', ['arduino-uno', '9'], ['q1', 'G'], '#ffaa00'),
      w('w6', ['q1', 'G'], ['rg', '1']),
      w('w7', ['rg', '2'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  {
    id: 'diode-rectifier',
    title: '半波整流器',
    description: '二极管只通过正半周。在 ADC 上读取整流后的输出。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// Half-wave rectifier — observe on Serial plotter
void setup() { Serial.begin(115200); }
void loop() {
  int raw = analogRead(A0);
  Serial.println(raw);
  delay(5);
}`,
    components: [
      UNO,
      {
        type: 'wokwi-signal-generator',
        id: 'sg1',
        x: 300,
        y: 200,
        properties: { waveform: 'sine', frequency: 50, amplitude: 5, offset: 0 },
      },
      { type: 'wokwi-diode-1n4007', id: 'd1', x: 400, y: 200, properties: {} },
      { type: 'wokwi-resistor', id: 'rl', x: 500, y: 200, properties: { value: '1000' } },
    ],
    wires: [
      // SG out → diode anode → cathode → Rl → GND
      w('w1', ['sg1', 'SIG'], ['d1', 'A']),
      w('w2', ['d1', 'C'], ['rl', '1']),
      w('w3', ['rl', '2'], ['arduino-uno', 'GND'], '#000000'),
      w('w4', ['sg1', 'GND'], ['arduino-uno', 'GND'], '#000000'),
      // A0 probes the rectified output
      w('w5', ['d1', 'C'], ['arduino-uno', 'A0'], '#ffaa00'),
    ],
  },

  {
    id: 'zener-regulator',
    title: '齐纳稳压器',
    description: '5.1V 齐纳管钳位输出。即使输入变化，输出也保持在 5.1V。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// Zener 5.1V regulator
// Input = 9V battery, Rs = 220 ohm, Zener clamps to 5.1V
void setup() { Serial.begin(9600); }
void loop() {
  float v = analogRead(A0) * 5.0 / 1023.0;
  Serial.print("V_regulated = "); Serial.println(v, 2);
  delay(500);
}`,
    components: [
      UNO,
      { type: 'wokwi-battery-9v', id: 'bat', x: 260, y: 160, properties: {} },
      { type: 'wokwi-resistor', id: 'rs', x: 380, y: 100, properties: { value: '220' } },
      { type: 'wokwi-zener-1n4733', id: 'z1', x: 480, y: 180, properties: {} },
    ],
    wires: [
      // 9V battery → Rs → Zener cathode (regulated node → A0)
      w('w1', ['bat', '+'], ['rs', '1'], '#ff0000'),
      w('w2', ['rs', '2'], ['z1', 'C']),
      w('w3', ['z1', 'C'], ['arduino-uno', 'A0'], '#ffaa00'),
      // Zener anode and battery minus → GND
      w('w4', ['z1', 'A'], ['arduino-uno', 'GND'], '#000000'),
      w('w5', ['bat', '−'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  {
    id: 'schottky-reverse-protection',
    title: '反极性保护',
    description: '肖特基二极管保护电路免受意外反接电池的损害。',
    category: 'circuits',
    difficulty: 'beginner',
    code: `// Schottky reverse-polarity protection
// 1N5817: low Vf = 0.3V, minimal power loss
void setup() { Serial.begin(9600); }
void loop() {
  Serial.println("Protected circuit running...");
  delay(1000);
}`,
    components: [
      UNO,
      { type: 'wokwi-battery-9v', id: 'bat', x: 260, y: 180, properties: {} },
      { type: 'wokwi-diode-1n5817', id: 'd1', x: 380, y: 140, properties: {} },
      { type: 'wokwi-resistor', id: 'rl', x: 500, y: 140, properties: { value: '1000' } },
    ],
    wires: [
      // Battery + → Schottky anode → cathode → load R → GND (battery −)
      w('w1', ['bat', '+'], ['d1', 'A'], '#ff0000'),
      w('w2', ['d1', 'C'], ['rl', '1']),
      w('w3', ['rl', '2'], ['arduino-uno', 'GND'], '#000000'),
      w('w4', ['bat', '−'], ['arduino-uno', 'GND'], '#000000'),
      // Probe the protected rail
      w('w5', ['d1', 'C'], ['arduino-uno', 'A0'], '#ffaa00'),
    ],
  },

  {
    id: 'bjt-common-emitter',
    title: '共射极放大器',
    description: 'NPN BJT 放大微小交流信号。增益 = -Rc/Re。',
    category: 'circuits',
    difficulty: 'advanced',
    code: `// Common-emitter amplifier
// Biased at Vcc/2, gain ~ -Rc/Re = -4.7
void setup() { Serial.begin(115200); }
void loop() {
  int raw = analogRead(A0);
  Serial.println(raw);
  delay(1);
}`,
    components: [
      UNO,
      { type: 'wokwi-resistor', id: 'rb1', x: 350, y: 60, properties: { value: '47000' } },
      { type: 'wokwi-resistor', id: 'rb2', x: 350, y: 180, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'rc', x: 450, y: 60, properties: { value: '4700' } },
      { type: 'wokwi-resistor', id: 're', x: 450, y: 280, properties: { value: '1000' } },
      { type: 'wokwi-bjt-2n2222', id: 'q1', x: 450, y: 170, properties: {} },
      {
        type: 'wokwi-signal-generator',
        id: 'sg1',
        x: 240,
        y: 140,
        properties: { waveform: 'sine', frequency: 1000, amplitude: 0.05, offset: 0 },
      },
      // Small "coupling" resistor from SG to the base node so SG can wiggle
      // the biased base without DC-shifting it.
      { type: 'wokwi-resistor', id: 'rin', x: 300, y: 140, properties: { value: '10000' } },
    ],
    wires: [
      // Bias divider: 5V → Rb1 → (base) → Rb2 → GND
      w('w1', ['arduino-uno', '5V'], ['rb1', '1'], '#ff0000'),
      w('w2', ['rb1', '2'], ['q1', 'B']),
      w('w3', ['q1', 'B'], ['rb2', '1']),
      w('w4', ['rb2', '2'], ['arduino-uno', 'GND'], '#000000'),
      // Collector: 5V → Rc → collector
      w('w5', ['arduino-uno', '5V'], ['rc', '1'], '#ff0000'),
      w('w6', ['rc', '2'], ['q1', 'C']),
      // Emitter → Re → GND
      w('w7', ['q1', 'E'], ['re', '1']),
      w('w8', ['re', '2'], ['arduino-uno', 'GND'], '#000000'),
      // AC input into base through coupling R
      w('w9', ['sg1', 'SIG'], ['rin', '1']),
      w('w10', ['rin', '2'], ['q1', 'B']),
      w('w11', ['sg1', 'GND'], ['arduino-uno', 'GND'], '#000000'),
      // A0 probes the collector
      w('w12', ['q1', 'C'], ['arduino-uno', 'A0'], '#ffaa00'),
    ],
  },

  {
    id: 'darlington-high-current',
    title: '达林顿对（高电流）',
    description:
      '两个 NPN BJT 级联获得 beta 平方电流增益。从 MCU 驱动重负载。',
    category: 'circuits',
    difficulty: 'advanced',
    code: `// Darlington pair — beta-squared gain drives LED from tiny base current.
// Fade in/out so you can SEE the Darlington proportionally amplifying.
void setup() { pinMode(9, OUTPUT); }
void loop() {
  for (int d = 0; d <= 255; d += 5) { analogWrite(9, d); delay(15); }
  for (int d = 255; d >= 0; d -= 5) { analogWrite(9, d); delay(15); }
}`,
    components: [
      UNO,
      { type: 'wokwi-resistor', id: 'rb', x: 340, y: 140, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'rl', x: 520, y: 40, properties: { value: '220' } },
      { type: 'wokwi-led', id: 'led1', x: 520, y: 120, properties: { color: 'red' } },
      { type: 'wokwi-bjt-2n2222', id: 'q1', x: 440, y: 200, properties: {} },
      { type: 'wokwi-bjt-2n2222', id: 'q2', x: 520, y: 280, properties: {} },
    ],
    wires: [
      // Pin 9 → Rb → Q1 base
      w('w1', ['arduino-uno', '9'], ['rb', '1']),
      w('w2', ['rb', '2'], ['q1', 'B']),
      // Q1 emitter drives Q2 base (darlington pair)
      w('w3', ['q1', 'E'], ['q2', 'B']),
      // Collectors tied together — common collector node
      w('w4', ['q1', 'C'], ['q2', 'C']),
      // High-side load: 5V → Rl → LED anode, LED cathode → common collector
      w('w5', ['arduino-uno', '5V'], ['rl', '1'], '#ff0000'),
      w('w6', ['rl', '2'], ['led1', 'A']),
      w('w7', ['led1', 'C'], ['q1', 'C']),
      // Q2 emitter → GND
      w('w8', ['q2', 'E'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 运算放大器（5 个示例）
  // ════════════════════════════════════════════════════════════════════════════

  {
    id: 'opamp-inverting',
    title: '反相放大器（LM358）',
    description: 'Vout = -(Rf/Rin) * Vin。Rin=1k, Rf=10k 时增益=-10。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// Inverting amplifier — gain = -Rf/Rin = -10
void setup() { Serial.begin(9600); }
void loop() {
  float vin = analogRead(A0) * 5.0 / 1023.0;
  float vout = analogRead(A1) * 5.0 / 1023.0;
  Serial.print("Vin="); Serial.print(vin,2);
  Serial.print(" Vout="); Serial.println(vout,2);
  delay(500);
}`,
    components: [
      UNO,
      { type: 'wokwi-potentiometer', id: 'pot', x: 260, y: 160, properties: {} },
      { type: 'wokwi-resistor', id: 'rin', x: 350, y: 100, properties: { value: '1000' } },
      { type: 'wokwi-resistor', id: 'rf', x: 450, y: 100, properties: { value: '10000' } },
      // IN+ bias divider — two 10k from 5V / GND keep IN+ at 2.5V
      { type: 'wokwi-resistor', id: 'rbp1', x: 350, y: 240, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'rbp2', x: 350, y: 320, properties: { value: '10000' } },
      { type: 'wokwi-opamp-lm358', id: 'u1', x: 460, y: 200, properties: {} },
    ],
    wires: [
      // Pot → Vin (A0 probes the input)
      w('w1', ['arduino-uno', '5V'], ['pot', 'VCC'], '#ff0000'),
      w('w2', ['pot', 'GND'], ['arduino-uno', 'GND'], '#000000'),
      w('w3', ['pot', 'SIG'], ['arduino-uno', 'A0'], '#ffaa00'),
      // Vin → Rin → IN-
      w('w4', ['pot', 'SIG'], ['rin', '1']),
      w('w5', ['rin', '2'], ['u1', 'IN-']),
      // Feedback Rf from OUT → IN-
      w('w6', ['u1', 'OUT'], ['rf', '1']),
      w('w7', ['rf', '2'], ['u1', 'IN-']),
      // IN+ biased at Vcc/2
      w('w8', ['arduino-uno', '5V'], ['rbp1', '1'], '#ff0000'),
      w('w9', ['rbp1', '2'], ['u1', 'IN+']),
      w('w10', ['u1', 'IN+'], ['rbp2', '1']),
      w('w11', ['rbp2', '2'], ['arduino-uno', 'GND'], '#000000'),
      // A1 probes the output
      w('w12', ['u1', 'OUT'], ['arduino-uno', 'A1'], '#ffaa00'),
    ],
  },

  {
    id: 'opamp-voltage-follower',
    title: '电压跟随器（缓冲器）',
    description: '运放 100% 负反馈。Vout = Vin。高输入阻抗，低输出阻抗。',
    category: 'circuits',
    difficulty: 'beginner',
    code: `// Voltage follower — Vout tracks Vin exactly
void setup() { Serial.begin(9600); }
void loop() {
  float vin = analogRead(A0) * 5.0 / 1023.0;
  float vout = analogRead(A1) * 5.0 / 1023.0;
  Serial.print("Vin="); Serial.print(vin,3);
  Serial.print(" Vout="); Serial.println(vout,3);
  delay(500);
}`,
    components: [
      UNO,
      { type: 'wokwi-potentiometer', id: 'pot', x: 350, y: 160, properties: {} },
      { type: 'wokwi-opamp-lm358', id: 'u1', x: 470, y: 160, properties: {} },
    ],
    wires: [
      w('w1', ['arduino-uno', '5V'], ['pot', 'VCC'], '#ff0000'),
      w('w2', ['pot', 'GND'], ['arduino-uno', 'GND'], '#000000'),
      w('w3', ['pot', 'SIG'], ['arduino-uno', 'A0'], '#ffaa00'),
      // Pot → IN+, OUT tied directly to IN- (100% negative feedback → buffer)
      w('w4', ['pot', 'SIG'], ['u1', 'IN+']),
      w('w5', ['u1', 'OUT'], ['u1', 'IN-']),
      w('w6', ['u1', 'OUT'], ['arduino-uno', 'A1'], '#ffaa00'),
    ],
  },

  {
    id: 'opamp-comparator',
    title: '比较器（带 LED）',
    description: '运放比较电位器电压与 2.5V 基准。LED 指示哪个更高。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// Comparator — LED lights when pot > 2.5V
void setup() { Serial.begin(9600); }
void loop() {
  float vpot = analogRead(A0) * 5.0 / 1023.0;
  Serial.print("Pot = "); Serial.print(vpot,2);
  Serial.println(vpot > 2.5 ? " > ref -> LED ON" : " < ref -> LED OFF");
  delay(300);
}`,
    components: [
      UNO,
      { type: 'wokwi-potentiometer', id: 'pot', x: 280, y: 120, properties: {} },
      // Vref = 2.5V from two 10k from 5V/GND
      { type: 'wokwi-resistor', id: 'rref1', x: 280, y: 240, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'rref2', x: 280, y: 320, properties: { value: '10000' } },
      { type: 'wokwi-opamp-lm358', id: 'u1', x: 400, y: 160, properties: {} },
      { type: 'wokwi-resistor', id: 'rl', x: 520, y: 80, properties: { value: '220' } },
      { type: 'wokwi-led', id: 'led1', x: 520, y: 200, properties: { color: 'green' } },
    ],
    wires: [
      // Pot on IN+
      w('w1', ['arduino-uno', '5V'], ['pot', 'VCC'], '#ff0000'),
      w('w2', ['pot', 'GND'], ['arduino-uno', 'GND'], '#000000'),
      w('w3', ['pot', 'SIG'], ['u1', 'IN+']),
      w('w4', ['pot', 'SIG'], ['arduino-uno', 'A0'], '#ffaa00'),
      // 2.5V reference on IN-
      w('w5', ['arduino-uno', '5V'], ['rref1', '1'], '#ff0000'),
      w('w6', ['rref1', '2'], ['u1', 'IN-']),
      w('w7', ['u1', 'IN-'], ['rref2', '1']),
      w('w8', ['rref2', '2'], ['arduino-uno', 'GND'], '#000000'),
      // OUT → Rl → LED → GND
      w('w9', ['u1', 'OUT'], ['rl', '1']),
      w('w10', ['rl', '2'], ['led1', 'A']),
      w('w11', ['led1', 'C'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  {
    id: 'opamp-difference',
    title: '差分放大器',
    description: 'Vout = 增益 * (V2 - V1)。适用于桥式传感器和差分信号。',
    category: 'circuits',
    difficulty: 'advanced',
    code: `// Difference amplifier — Gain=10, Vout = 10*(V2-V1)
void setup() { Serial.begin(9600); }
void loop() {
  float v1 = analogRead(A0) * 5.0 / 1023.0;
  float v2 = analogRead(A1) * 5.0 / 1023.0;
  float vout = analogRead(A2) * 5.0 / 1023.0;
  Serial.print("V1="); Serial.print(v1,2);
  Serial.print(" V2="); Serial.print(v2,2);
  Serial.print(" Vout="); Serial.println(vout,2);
  delay(500);
}`,
    components: [
      UNO,
      // V1 → R1 → IN-, feedback Rf from OUT
      { type: 'wokwi-resistor', id: 'r1', x: 350, y: 80, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'rf', x: 350, y: 160, properties: { value: '100000' } },
      // V2 → R2 → IN+, Rg from IN+ to GND
      { type: 'wokwi-resistor', id: 'r2', x: 350, y: 240, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'rg', x: 350, y: 320, properties: { value: '100000' } },
      { type: 'wokwi-opamp-lm358', id: 'u1', x: 460, y: 160, properties: {} },
      // Two bias pots to generate V1 and V2 (so the example has real inputs)
      { type: 'wokwi-potentiometer', id: 'pot1', x: 240, y: 80, properties: {} },
      { type: 'wokwi-potentiometer', id: 'pot2', x: 240, y: 240, properties: {} },
    ],
    wires: [
      // Pot1 provides V1
      w('w1', ['arduino-uno', '5V'], ['pot1', 'VCC'], '#ff0000'),
      w('w2', ['pot1', 'GND'], ['arduino-uno', 'GND'], '#000000'),
      w('w3', ['pot1', 'SIG'], ['arduino-uno', 'A0'], '#ffaa00'),
      // Pot2 provides V2
      w('w4', ['arduino-uno', '5V'], ['pot2', 'VCC'], '#ff0000'),
      w('w5', ['pot2', 'GND'], ['arduino-uno', 'GND'], '#000000'),
      w('w6', ['pot2', 'SIG'], ['arduino-uno', 'A1'], '#ffaa00'),
      // V1 → R1 → IN-
      w('w7', ['pot1', 'SIG'], ['r1', '1']),
      w('w8', ['r1', '2'], ['u1', 'IN-']),
      // Rf from OUT to IN-
      w('w9', ['u1', 'OUT'], ['rf', '1']),
      w('w10', ['rf', '2'], ['u1', 'IN-']),
      // V2 → R2 → IN+
      w('w11', ['pot2', 'SIG'], ['r2', '1']),
      w('w12', ['r2', '2'], ['u1', 'IN+']),
      // Rg from IN+ to GND
      w('w13', ['u1', 'IN+'], ['rg', '1']),
      w('w14', ['rg', '2'], ['arduino-uno', 'GND'], '#000000'),
      // A2 probes OUT
      w('w15', ['u1', 'OUT'], ['arduino-uno', 'A2'], '#ffaa00'),
    ],
  },

  {
    id: 'opamp-schmitt-trigger',
    title: '施密特触发器',
    description: '运放正反馈产生迟滞。清理噪声信号。',
    category: 'circuits',
    difficulty: 'advanced',
    code: `// Schmitt trigger — cleans noisy input
void setup() { Serial.begin(9600); }
void loop() {
  int raw = analogRead(A0);
  int out = analogRead(A1);
  Serial.print(raw); Serial.print(","); Serial.println(out);
  delay(10);
}`,
    components: [
      UNO,
      { type: 'wokwi-potentiometer', id: 'pot', x: 260, y: 160, properties: {} },
      // Vref = 2.5V divider on IN+
      { type: 'wokwi-resistor', id: 'rref1', x: 370, y: 240, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'rref2', x: 370, y: 320, properties: { value: '10000' } },
      // Positive feedback network: Rin from Vref to IN+, Rfb from OUT to IN+
      { type: 'wokwi-resistor', id: 'rin', x: 420, y: 100, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'rfb', x: 520, y: 100, properties: { value: '100000' } },
      { type: 'wokwi-opamp-lm358', id: 'u1', x: 460, y: 200, properties: {} },
    ],
    wires: [
      // Pot → IN- (inverting input, signal to compare)
      w('w1', ['arduino-uno', '5V'], ['pot', 'VCC'], '#ff0000'),
      w('w2', ['pot', 'GND'], ['arduino-uno', 'GND'], '#000000'),
      w('w3', ['pot', 'SIG'], ['u1', 'IN-']),
      w('w4', ['pot', 'SIG'], ['arduino-uno', 'A0'], '#ffaa00'),
      // Vref divider to Rin node (2.5V reference)
      w('w5', ['arduino-uno', '5V'], ['rref1', '1'], '#ff0000'),
      w('w6', ['rref1', '2'], ['rin', '1']),
      w('w7', ['rin', '1'], ['rref2', '1']),
      w('w8', ['rref2', '2'], ['arduino-uno', 'GND'], '#000000'),
      // Rin → IN+, and Rfb from OUT → IN+ (positive feedback → hysteresis)
      w('w9', ['rin', '2'], ['u1', 'IN+']),
      w('w10', ['u1', 'OUT'], ['rfb', '1']),
      w('w11', ['rfb', '2'], ['u1', 'IN+']),
      // A1 probes OUT
      w('w12', ['u1', 'OUT'], ['arduino-uno', 'A1'], '#ffaa00'),
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 逻辑门（6 个示例）
  // ════════════════════════════════════════════════════════════════════════════

  {
    id: 'mixed-and-transistor-driver',
    title: '混合：MCU + 与门 + 晶体管（共存测试）',
    description:
      '数字与模拟共存于同一电路中：Arduino 输出两个逻辑电平（一个稳定高电平"使能"，一个闪烁），' +
      '物理与门将它们组合，与门输出驱动 NPN 晶体管来控制"电机"LED。' +
      'LED 应闪烁——证明 MCU → 逻辑门 → 晶体管 → 负载整个链路在数字与模拟（ngspice）引擎协同下工作正常。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// MCU + AND gate + transistor coexistence.
// pin 5 = steady enable, pin 6 = blink. AND(5,6) -> transistor -> motor LED.
void setup() { pinMode(5, OUTPUT); pinMode(6, OUTPUT); }
void loop() {
  digitalWrite(5, HIGH);                 // enable
  digitalWrite(6, (millis() / 500) & 1); // ~1 Hz blink
}`,
    components: [
      UNO,
      { type: 'velxio-logic-gate-and', id: 'u1', x: 360, y: 120, properties: {} },
      { type: 'wokwi-resistor', id: 'rb', x: 480, y: 130, properties: { value: '1000' } },
      { type: 'wokwi-bjt-2n2222', id: 'q1', x: 580, y: 160, properties: {} },
      { type: 'wokwi-resistor', id: 'rl', x: 560, y: 40, properties: { value: '220' } },
      { type: 'wokwi-led', id: 'motor', x: 560, y: 100, properties: { color: 'green' } },
    ],
    wires: [
      // MCU drives the two AND inputs
      w('w1', ['arduino-uno', '5'], ['u1', 'A']),
      w('w2', ['arduino-uno', '6'], ['u1', 'B']),
      // AND output -> base resistor -> transistor base
      w('w3', ['u1', 'Y'], ['rb', '1']),
      w('w4', ['rb', '2'], ['q1', 'B']),
      // Load: 5V -> Rl -> LED -> collector ; emitter -> GND
      w('w5', ['arduino-uno', '5V'], ['rl', '1'], '#ff3030'),
      w('w6', ['rl', '2'], ['motor', 'A']),
      w('w7', ['motor', 'C'], ['q1', 'C']),
      w('w8', ['q1', 'E'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  {
    id: 'and-gate-alarm',
    title: '与门报警器',
    description:
      '两个布防开关接入与门——只有当两个都打开时报警 LED 才亮（例如两扇门都关好）。' +
      '使用滑动开关，因此可以锁定：每个滑动到 ON 后保持状态，可以同时保持两个。' +
      '纯逻辑，无 MCU——运行在数字门引擎上。',
    category: 'circuits',
    difficulty: 'beginner',
    boardFilter: 'digital',
    code: `// Pure digital circuit — no MCU. Slide BOTH switches ON to arm the alarm.
void setup() {}
void loop()  {}`,
    components: [
      { type: 'wokwi-signal-generator', id: 'src', x: 40, y: 200, properties: { waveform: 'dc', offset: 5, amplitude: 0, frequency: 1 } },
      { type: 'wokwi-slide-switch', id: 'sw1', x: 220, y: 90, properties: { value: 0 } },
      { type: 'wokwi-slide-switch', id: 'sw2', x: 220, y: 250, properties: { value: 0 } },
      { type: 'wokwi-resistor', id: 'rpd1', x: 340, y: 140, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'rpd2', x: 340, y: 300, properties: { value: '10000' } },
      { type: 'velxio-logic-gate-and', id: 'u1', x: 470, y: 170, properties: {} },
      { type: 'wokwi-resistor', id: 'rl', x: 620, y: 130, properties: { value: '220' } },
      { type: 'wokwi-led', id: 'led1', x: 620, y: 220, properties: { color: 'red' } },
    ],
    wires: [
      // Switch 1 → AND input A (slide ON = rail HIGH; pull-down holds it LOW when OFF)
      w('w1', ['src', 'SIG'], ['sw1', '1'], '#ff3030'),
      w('w2', ['sw1', '2'], ['u1', 'A']),
      w('w3', ['sw1', '2'], ['rpd1', '1']),
      w('w4', ['rpd1', '2'], ['src', 'GND'], '#000000'),
      // Switch 2 → AND input B
      w('w5', ['src', 'SIG'], ['sw2', '1'], '#ff3030'),
      w('w6', ['sw2', '2'], ['u1', 'B']),
      w('w7', ['sw2', '2'], ['rpd2', '1']),
      w('w8', ['rpd2', '2'], ['src', 'GND'], '#000000'),
      // AND output → series resistor → alarm LED → GND
      w('w9', ['u1', 'Y'], ['rl', '1']),
      w('w10', ['rl', '2'], ['led1', 'A']),
      w('w11', ['led1', 'C'], ['src', 'GND'], '#000000'),
    ],
  },

  {
    id: 'xor-toggle-detector',
    title: '异或门状态检测器',
    description: '异或门检测两个开关是否处于不同位置。',
    category: 'circuits',
    difficulty: 'beginner',
    code: `// XOR — LED on when switches differ (physical XOR gate drives LED)
void setup() {
  pinMode(2, INPUT_PULLUP); pinMode(3, INPUT_PULLUP);
  pinMode(5, OUTPUT);       pinMode(6, OUTPUT);
}
void loop() {
  digitalWrite(5, !digitalRead(2));
  digitalWrite(6, !digitalRead(3));
}`,
    components: [
      UNO,
      { type: 'wokwi-pushbutton', id: 'sw1', x: 260, y: 80, properties: {} },
      { type: 'wokwi-pushbutton', id: 'sw2', x: 260, y: 180, properties: {} },
      { type: 'velxio-logic-gate-xor', id: 'u1', x: 400, y: 130, properties: {} },
      { type: 'wokwi-resistor', id: 'rl', x: 520, y: 60, properties: { value: '220' } },
      { type: 'wokwi-led', id: 'led1', x: 520, y: 160, properties: { color: 'yellow' } },
    ],
    wires: [
      w('w1', ['arduino-uno', '2'], ['sw1', '1.l']),
      w('w2', ['sw1', '2.l'], ['arduino-uno', 'GND'], '#000000'),
      w('w3', ['arduino-uno', '3'], ['sw2', '1.l']),
      w('w4', ['sw2', '2.l'], ['arduino-uno', 'GND'], '#000000'),
      // MCU → XOR inputs
      w('w5', ['arduino-uno', '5'], ['u1', 'A']),
      w('w6', ['arduino-uno', '6'], ['u1', 'B']),
      // XOR Y → LED
      w('w7', ['u1', 'Y'], ['rl', '1']),
      w('w8', ['rl', '2'], ['led1', 'A']),
      w('w9', ['led1', 'C'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  {
    id: 'nand-sr-latch',
    title: '与非门 SR 锁存器',
    description: '两个交叉耦合的与非门构成置位-复位锁存器。无需时钟的记忆！',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// Software NAND SR latch simulation
bool q = false;
void setup() { Serial.begin(9600); pinMode(2,INPUT_PULLUP); pinMode(3,INPUT_PULLUP); pinMode(13,OUTPUT); }
void loop() {
  bool s = !digitalRead(2), r = !digitalRead(3);
  if(s && !r) q = true;
  if(r && !s) q = false;
  digitalWrite(13, q);
  Serial.print("S="); Serial.print(s); Serial.print(" R="); Serial.print(r);
  Serial.print(" Q="); Serial.println(q);
  delay(200);
}`,
    components: [
      UNO,
      { type: 'wokwi-pushbutton', id: 'setBtn', x: 260, y: 80, properties: {} },
      { type: 'wokwi-pushbutton', id: 'rstBtn', x: 260, y: 240, properties: {} },
      // Pull-ups so S' and R' rest HIGH; pressing a button pulls LOW
      { type: 'wokwi-resistor', id: 'rpuS', x: 320, y: 40, properties: { value: '10000' } },
      { type: 'wokwi-resistor', id: 'rpuR', x: 320, y: 280, properties: { value: '10000' } },
      // Cross-coupled NANDs
      { type: 'velxio-logic-gate-nand', id: 'g1', x: 420, y: 100, properties: {} },
      { type: 'velxio-logic-gate-nand', id: 'g2', x: 420, y: 220, properties: {} },
      { type: 'wokwi-resistor', id: 'rl', x: 540, y: 60, properties: { value: '220' } },
      { type: 'wokwi-led', id: 'qled', x: 540, y: 160, properties: { color: 'green' } },
    ],
    wires: [
      // S' / R' pull-ups to 5V
      w('w1', ['arduino-uno', '5V'], ['rpuS', '1'], '#ff0000'),
      w('w2', ['rpuS', '2'], ['setBtn', '1.l']),
      w('w3', ['setBtn', '2.l'], ['arduino-uno', 'GND'], '#000000'),
      w('w4', ['arduino-uno', '5V'], ['rpuR', '1'], '#ff0000'),
      w('w5', ['rpuR', '2'], ['rstBtn', '1.l']),
      w('w6', ['rstBtn', '2.l'], ['arduino-uno', 'GND'], '#000000'),
      // MCU can also read S' and R' (pin 2 / 3)
      w('w7', ['rpuS', '2'], ['arduino-uno', '2'], '#ffaa00'),
      w('w8', ['rpuR', '2'], ['arduino-uno', '3'], '#ffaa00'),
      // NAND1: inputs S' + Q', output Q
      w('w9', ['rpuS', '2'], ['g1', 'A']),
      // NAND2: inputs R' + Q, output Q'
      w('w10', ['rpuR', '2'], ['g2', 'A']),
      // Cross-couple
      w('w11', ['g1', 'Y'], ['g2', 'B']),
      w('w12', ['g2', 'Y'], ['g1', 'B']),
      // Q → LED
      w('w13', ['g1', 'Y'], ['rl', '1']),
      w('w14', ['rl', '2'], ['qled', 'A']),
      w('w15', ['qled', 'C'], ['arduino-uno', 'GND'], '#000000'),
      // Also route Q to Arduino pin 13 (software mirror)
      w('w16', ['g1', 'Y'], ['arduino-uno', '13'], '#ffaa00'),
    ],
  },

  {
    id: 'full-adder',
    title: '全加器（1 位）',
    description: 'Sum = A XOR B XOR Cin, Cout = (A AND B) OR (Cin AND (A XOR B))。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// 1-bit full adder in software
void setup() {
  Serial.begin(9600);
  pinMode(2,INPUT_PULLUP); pinMode(3,INPUT_PULLUP); pinMode(4,INPUT_PULLUP);
  pinMode(5,OUTPUT); pinMode(6,OUTPUT);
}
void loop() {
  bool a=!digitalRead(2), b=!digitalRead(3), cin=!digitalRead(4);
  bool sum = a ^ b ^ cin;
  bool cout = (a&b) | (cin&(a^b));
  digitalWrite(5, sum);
  digitalWrite(6, cout);
  Serial.print("A="); Serial.print(a); Serial.print(" B="); Serial.print(b);
  Serial.print(" Cin="); Serial.print(cin); Serial.print(" Sum="); Serial.print(sum);
  Serial.print(" Cout="); Serial.println(cout);
  delay(300);
}`,
    components: [
      UNO,
      { type: 'wokwi-pushbutton', id: 'bA', x: 350, y: 60, properties: {} },
      { type: 'wokwi-pushbutton', id: 'bB', x: 350, y: 140, properties: {} },
      { type: 'wokwi-pushbutton', id: 'bCin', x: 350, y: 220, properties: {} },
      { type: 'wokwi-resistor', id: 'rSum', x: 440, y: 100, properties: { value: '220' } },
      { type: 'wokwi-resistor', id: 'rCout', x: 440, y: 200, properties: { value: '220' } },
      { type: 'wokwi-led', id: 'sumLed', x: 540, y: 100, properties: { color: 'green' } },
      { type: 'wokwi-led', id: 'coutLed', x: 540, y: 200, properties: { color: 'red' } },
    ],
    wires: [
      w('w1', ['arduino-uno', '2'], ['bA', '1.l']),
      w('w2', ['bA', '2.l'], ['arduino-uno', 'GND'], '#000000'),
      w('w3', ['arduino-uno', '3'], ['bB', '1.l']),
      w('w4', ['bB', '2.l'], ['arduino-uno', 'GND'], '#000000'),
      w('w5', ['arduino-uno', '4'], ['bCin', '1.l']),
      w('w6', ['bCin', '2.l'], ['arduino-uno', 'GND'], '#000000'),
      // Sum LED: pin 5 → 220Ω → LED → GND
      w('w7', ['arduino-uno', '5'], ['rSum', '1']),
      w('w8', ['rSum', '2'], ['sumLed', 'A']),
      w('w9', ['sumLed', 'C'], ['arduino-uno', 'GND'], '#000000'),
      // Cout LED: pin 6 → 220Ω → LED → GND
      w('w10', ['arduino-uno', '6'], ['rCout', '1']),
      w('w11', ['rCout', '2'], ['coutLed', 'A']),
      w('w12', ['coutLed', 'C'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  {
    id: 'binary-counter-leds',
    title: '4 位二进制计数器',
    description: '从 0 计数到 15，显示在 4 个 LED 上。每个 LED 代表一位。',
    category: 'circuits',
    difficulty: 'beginner',
    code: `// 4-bit binary counter on LEDs
int count = 0;
void setup() { for(int i=2;i<=5;i++) pinMode(i,OUTPUT); }
void loop() {
  for(int i=0;i<4;i++) digitalWrite(i+2, (count>>i)&1);
  count = (count+1) % 16;
  delay(500);
}`,
    components: [
      UNO,
      ...Array.from({ length: 4 }, (_, i) => ({
        type: 'wokwi-resistor',
        id: `r${i}`,
        x: 380,
        y: 60 + i * 60,
        properties: { value: '220' },
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        type: 'wokwi-led',
        id: `led${i}`,
        x: 460,
        y: 60 + i * 60,
        properties: { color: ['red', 'yellow', 'green', 'blue'][i] },
      })),
    ],
    wires: [
      ...Array.from({ length: 4 }, (_, i) =>
        w(`wa${i}`, ['arduino-uno', `${i + 2}`], [`r${i}`, '1']),
      ),
      ...Array.from({ length: 4 }, (_, i) => w(`wb${i}`, [`r${i}`, '2'], [`led${i}`, 'A'])),
      ...Array.from({ length: 4 }, (_, i) =>
        w(`wc${i}`, [`led${i}`, 'C'], ['arduino-uno', 'GND'], '#000000'),
      ),
    ],
  },

  {
    id: 'logic-probe',
    title: '逻辑探头（高电平/低电平/浮空）',
    description:
      '读取任意数字引脚状态，用 3 个 LED 显示：绿色=高电平，红色=低电平，黄色=浮空。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// Logic probe — tests pin 7
void setup() {
  pinMode(10,OUTPUT); pinMode(11,OUTPUT); pinMode(12,OUTPUT); // R,Y,G
  pinMode(7,INPUT);
  Serial.begin(9600);
}
void loop() {
  int val = digitalRead(7);
  digitalWrite(12, val == HIGH);  // Green = HIGH
  digitalWrite(10, val == LOW);   // Red = LOW
  Serial.println(val ? "HIGH" : "LOW");
  delay(200);
}`,
    components: [
      UNO,
      { type: 'wokwi-led', id: 'gLed', x: 400, y: 60, properties: { color: 'green' } },
      { type: 'wokwi-led', id: 'rLed', x: 400, y: 140, properties: { color: 'red' } },
      { type: 'wokwi-resistor', id: 'rg', x: 400, y: 10, properties: { value: '220' } },
      { type: 'wokwi-resistor', id: 'rr', x: 400, y: 90, properties: { value: '220' } },
    ],
    wires: [
      w('w1', ['arduino-uno', '12'], ['rg', '1']),
      w('w2', ['rg', '2'], ['gLed', 'A']),
      w('w3', ['gLed', 'C'], ['arduino-uno', 'GND'], '#000000'),
      w('w4', ['arduino-uno', '10'], ['rr', '1']),
      w('w5', ['rr', '2'], ['rLed', 'A']),
      w('w6', ['rLed', 'C'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 机电（4 个示例）
  // ════════════════════════════════════════════════════════════════════════════

  {
    id: 'relay-led-switch',
    title: '继电器控制 LED',
    description:
      'NPN 晶体管驱动继电器。继电器切换连接独立电源的 LED。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// Relay control via NPN transistor
void setup() { pinMode(9, OUTPUT); }
void loop() {
  digitalWrite(9, HIGH); delay(2000); // relay ON
  digitalWrite(9, LOW);  delay(2000); // relay OFF
}`,
    components: [
      UNO,
      { type: 'wokwi-resistor', id: 'rb', x: 340, y: 140, properties: { value: '1000' } },
      { type: 'wokwi-bjt-2n2222', id: 'q1', x: 420, y: 200, properties: {} },
      { type: 'velxio-relay', id: 'rly', x: 520, y: 140, properties: { coil_voltage: 5 } },
      { type: 'wokwi-resistor', id: 'rl', x: 640, y: 60, properties: { value: '220' } },
      { type: 'wokwi-led', id: 'led1', x: 640, y: 160, properties: { color: 'red' } },
    ],
    wires: [
      // Pin 9 → Rb → Q1 base (NPN low-side driver for the relay coil)
      w('w1', ['arduino-uno', '9'], ['rb', '1']),
      w('w2', ['rb', '2'], ['q1', 'B']),
      // 5V → relay COIL+ ; COIL- → collector ; emitter → GND
      w('w3', ['arduino-uno', '5V'], ['rly', 'COIL+'], '#ff0000'),
      w('w4', ['rly', 'COIL-'], ['q1', 'C']),
      w('w5', ['q1', 'E'], ['arduino-uno', 'GND'], '#000000'),
      // Switched load: COM → Rl → LED → GND, NO → 5V (so pressed NO closes 5V to LED)
      w('w6', ['arduino-uno', '5V'], ['rly', 'NO'], '#ff0000'),
      w('w7', ['rly', 'COM'], ['rl', '1']),
      w('w8', ['rl', '2'], ['led1', 'A']),
      w('w9', ['led1', 'C'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  {
    id: 'optocoupler-signal',
    title: '光耦信号隔离',
    description: '4N25 光耦将 MCU 与高压电路隔离。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// Optocoupler 4N25 — MCU drives LED side, reads phototransistor side
void setup() { pinMode(9,OUTPUT); Serial.begin(9600); }
void loop() {
  digitalWrite(9,HIGH); delay(500);
  int val = analogRead(A0);
  Serial.print("Isolated signal: "); Serial.println(val);
  digitalWrite(9,LOW); delay(500);
  val = analogRead(A0);
  Serial.print("Isolated signal: "); Serial.println(val);
}`,
    components: [
      UNO,
      { type: 'wokwi-resistor', id: 'rled', x: 340, y: 80, properties: { value: '270' } },
      { type: 'velxio-opto-4n25', id: 'u1', x: 450, y: 120, properties: {} },
      { type: 'wokwi-resistor', id: 'rpull', x: 560, y: 80, properties: { value: '10000' } },
    ],
    wires: [
      // Drive side: pin 9 → Rled → LED anode (AN), cathode → GND
      w('w1', ['arduino-uno', '9'], ['rled', '1']),
      w('w2', ['rled', '2'], ['u1', 'AN']),
      w('w3', ['u1', 'CAT'], ['arduino-uno', 'GND'], '#000000'),
      // Receive side: 5V → Rpull → collector, emitter → GND; A0 probes collector
      w('w4', ['arduino-uno', '5V'], ['rpull', '1'], '#ff0000'),
      w('w5', ['rpull', '2'], ['u1', 'COL']),
      w('w6', ['u1', 'COL'], ['arduino-uno', 'A0'], '#ffaa00'),
      w('w7', ['u1', 'EMIT'], ['arduino-uno', 'GND'], '#000000'),
    ],
  },

  {
    id: 'l293d-motor-control',
    title: '直流电机控制（L293D）',
    description: 'L293D H 桥驱动直流电机正转、反转和制动。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// L293D motor control — forward, reverse, brake
#define EN 9
#define IN1 7
#define IN2 8
void setup() { pinMode(EN,OUTPUT); pinMode(IN1,OUTPUT); pinMode(IN2,OUTPUT); }
void forward()  { digitalWrite(IN1,HIGH); digitalWrite(IN2,LOW);  analogWrite(EN,200); }
void reverse()  { digitalWrite(IN1,LOW);  digitalWrite(IN2,HIGH); analogWrite(EN,200); }
void brake()    { digitalWrite(IN1,LOW);  digitalWrite(IN2,LOW);  analogWrite(EN,0);   }
void loop() {
  forward(); delay(2000);
  brake();   delay(500);
  reverse(); delay(2000);
  brake();   delay(500);
}`,
    components: [
      UNO,
      { type: 'velxio-motor-driver-l293d', id: 'u1', x: 420, y: 140, properties: {} },
      // Simple resistive motor model (5Ω winding)
      { type: 'wokwi-resistor', id: 'rm', x: 560, y: 200, properties: { value: '5' } },
    ],
    wires: [
      // Control signals from Arduino
      w('w1', ['arduino-uno', '9'], ['u1', 'EN1']),
      w('w2', ['arduino-uno', '7'], ['u1', 'IN1']),
      w('w3', ['arduino-uno', '8'], ['u1', 'IN2']),
      // Logic supply VCC1 = 5V, motor supply VCC2 = 5V (toy example)
      w('w4', ['arduino-uno', '5V'], ['u1', 'VCC1'], '#ff0000'),
      w('w5', ['arduino-uno', '5V'], ['u1', 'VCC2'], '#ff0000'),
      // Shared GND pins
      w('w6', ['u1', 'GND.1'], ['arduino-uno', 'GND'], '#000000'),
      w('w7', ['u1', 'GND.2'], ['arduino-uno', 'GND'], '#000000'),
      // Motor between OUT1 and OUT2
      w('w8', ['u1', 'OUT1'], ['rm', '1']),
      w('w9', ['u1', 'OUT2'], ['rm', '2']),
    ],
  },

  {
    id: 'l293d-speed-pwm',
    title: '电机速度控制（PWM）',
    description: '电位器通过 L293D 使能引脚的 PWM 控制电机速度。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// Motor speed via potentiometer + L293D
#define EN 9
#define IN1 7
#define IN2 8
void setup() { pinMode(EN,OUTPUT); pinMode(IN1,OUTPUT); pinMode(IN2,OUTPUT);
  digitalWrite(IN1,HIGH); digitalWrite(IN2,LOW); }
void loop() {
  int pot = analogRead(A0);
  int speed = map(pot, 0, 1023, 0, 255);
  analogWrite(EN, speed);
  Serial.print("Speed: "); Serial.println(speed);
  delay(100);
}`,
    components: [
      UNO,
      { type: 'wokwi-potentiometer', id: 'pot', x: 260, y: 200, properties: {} },
      { type: 'velxio-motor-driver-l293d', id: 'u1', x: 420, y: 140, properties: {} },
      { type: 'wokwi-resistor', id: 'rm', x: 560, y: 200, properties: { value: '5' } },
    ],
    wires: [
      // Pot → A0
      w('w1', ['arduino-uno', '5V'], ['pot', 'VCC'], '#ff0000'),
      w('w2', ['pot', 'GND'], ['arduino-uno', 'GND'], '#000000'),
      w('w3', ['pot', 'SIG'], ['arduino-uno', 'A0'], '#ffaa00'),
      // L293D control
      w('w4', ['arduino-uno', '9'], ['u1', 'EN1']),
      w('w5', ['arduino-uno', '7'], ['u1', 'IN1']),
      w('w6', ['arduino-uno', '8'], ['u1', 'IN2']),
      // Power rails + GND
      w('w7', ['arduino-uno', '5V'], ['u1', 'VCC1'], '#ff0000'),
      w('w8', ['arduino-uno', '5V'], ['u1', 'VCC2'], '#ff0000'),
      w('w9', ['u1', 'GND.1'], ['arduino-uno', 'GND'], '#000000'),
      w('w10', ['u1', 'GND.2'], ['arduino-uno', 'GND'], '#000000'),
      // Motor between OUT1 / OUT2
      w('w11', ['u1', 'OUT1'], ['rm', '1']),
      w('w12', ['u1', 'OUT2'], ['rm', '2']),
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 电源 / 稳压器（3 个示例）
  // ════════════════════════════════════════════════════════════════════════════

  {
    id: 'power-supply-7805',
    title: '7805 稳压电源',
    description: '9V 电池 → 7805 → 稳定的 5V 供给 Arduino。经典的线性稳压器。',
    category: 'circuits',
    difficulty: 'beginner',
    code: `// 7805 power supply — regulated 5V from 9V battery
// The 7805 provides stable 5V regardless of battery voltage (7-12V range)
void setup() { Serial.begin(9600); }
void loop() {
  float v = analogRead(A0) * 5.0 / 1023.0;
  Serial.print("Regulated voltage: "); Serial.print(v,2); Serial.println(" V");
  delay(1000);
}`,
    components: [
      UNO,
      { type: 'wokwi-battery-9v', id: 'bat', x: 260, y: 200, properties: {} },
      { type: 'wokwi-reg-7805', id: 'u1', x: 380, y: 160, properties: {} },
      { type: 'wokwi-resistor', id: 'rload', x: 500, y: 160, properties: { value: '1000' } },
    ],
    wires: [
      // Battery + → VIN ; battery − / GND pin → GND
      w('w1', ['bat', '+'], ['u1', 'VIN'], '#ff0000'),
      w('w2', ['bat', '−'], ['u1', 'GND'], '#000000'),
      w('w3', ['u1', 'GND'], ['arduino-uno', 'GND'], '#000000'),
      // Regulated output → load → GND, A0 probes
      w('w4', ['u1', 'VOUT'], ['rload', '1'], '#ff0000'),
      w('w5', ['rload', '2'], ['arduino-uno', 'GND'], '#000000'),
      w('w6', ['u1', 'VOUT'], ['arduino-uno', 'A0'], '#ffaa00'),
    ],
  },

  {
    id: 'lm317-adjustable-psu',
    title: 'LM317 可调电源',
    description: 'LM317 配合 R1/R2 分压。Vout = 1.25 * (1 + R2/R1)。可设置 1.25-37V 任意电压。',
    category: 'circuits',
    difficulty: 'intermediate',
    code: `// LM317 adjustable regulator
// R1 = 240, R2 = 720 -> Vout = 1.25 * (1 + 720/240) = 5.0V
void setup() { Serial.begin(9600); }
void loop() {
  float v = analogRead(A0) * 5.0 / 1023.0;
  Serial.print("LM317 Vout = "); Serial.print(v,2); Serial.println(" V");
  delay(500);
}`,
    components: [
      UNO,
      { type: 'wokwi-battery-9v', id: 'bat', x: 240, y: 220, properties: {} },
      { type: 'wokwi-reg-lm317', id: 'u1', x: 360, y: 140, properties: {} },
      // R1 = 240Ω between VOUT and ADJ, R2 = 720Ω between ADJ and GND
      // Vout = 1.25 * (1 + R2/R1) = 5.0V
      { type: 'wokwi-resistor', id: 'r1', x: 480, y: 100, properties: { value: '240' } },
      { type: 'wokwi-resistor', id: 'r2', x: 480, y: 200, properties: { value: '720' } },
      { type: 'wokwi-resistor', id: 'rload', x: 600, y: 100, properties: { value: '1000' } },
    ],
    wires: [
      // Battery into LM317 VIN
      w('w1', ['bat', '+'], ['u1', 'VIN'], '#ff0000'),
      w('w2', ['bat', '−'], ['arduino-uno', 'GND'], '#000000'),
      // VOUT → R1 → ADJ → R2 → GND
      w('w3', ['u1', 'VOUT'], ['r1', '1'], '#ff0000'),
      w('w4', ['r1', '2'], ['u1', 'ADJ']),
      w('w5', ['u1', 'ADJ'], ['r2', '1']),
      w('w6', ['r2', '2'], ['arduino-uno', 'GND'], '#000000'),
      // Load + ADC probe
      w('w7', ['u1', 'VOUT'], ['rload', '1'], '#ff0000'),
      w('w8', ['rload', '2'], ['arduino-uno', 'GND'], '#000000'),
      w('w9', ['u1', 'VOUT'], ['arduino-uno', 'A0'], '#ffaa00'),
    ],
  },

  {
    id: 'battery-voltage-monitor',
    title: '电池电压监测器',
    description: '分压器将 9V 电池降压到 0-5V 范围，用于 ADC 测量。',
    category: 'circuits',
    difficulty: 'beginner',
    code: `// Battery voltage monitor
// R1=20k + R2=10k divider: V_adc = V_bat * 10k / 30k
// V_bat = V_adc * 3
void setup() { Serial.begin(9600); }
void loop() {
  float vAdc = analogRead(A0) * 5.0 / 1023.0;
  float vBat = vAdc * 3.0;
  Serial.print("Battery: "); Serial.print(vBat,1); Serial.println(" V");
  if(vBat < 7.0) Serial.println("WARNING: Battery low!");
  delay(1000);
}`,
    components: [
      UNO,
      { type: 'wokwi-resistor', id: 'r1', x: 350, y: 80, properties: { value: '20000' } },
      { type: 'wokwi-resistor', id: 'r2', x: 350, y: 200, properties: { value: '10000' } },
    ],
    wires: [
      w('w1', ['r1', '2'], ['r2', '1']),
      w('w2', ['r2', '2'], ['arduino-uno', 'GND'], '#000000'),
      w('w3', ['r1', '2'], ['arduino-uno', 'A0'], '#ffaa00'),
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // ESP32 / MEGA / NANO（4 个板级示例）
  // ════════════════════════════════════════════════════════════════════════════

  {
    id: 'esp32-dual-adc',
    title: 'ESP32 双通道 ADC 读取器',
    description:
      'ESP32 以 12 位分辨率同时读取两个模拟通道（GPIO34、GPIO35）。',
    category: 'circuits',
    difficulty: 'beginner',
    boardType: 'esp32',
    code: `// ESP32 dual ADC — 12-bit, 3.3V reference
void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
}
void loop() {
  int ch1 = analogRead(34);
  int ch2 = analogRead(35);
  float v1 = ch1 * 3.3 / 4095.0;
  float v2 = ch2 * 3.3 / 4095.0;
  Serial.printf("CH1=%.3fV  CH2=%.3fV\\n", v1, v2);
  delay(500);
}`,
    components: [
      ESP32,
      { type: 'wokwi-potentiometer', id: 'pot1', x: 400, y: 80, properties: {} },
      { type: 'wokwi-potentiometer', id: 'pot2', x: 400, y: 220, properties: {} },
    ],
    wires: [
      w('w1', ['esp32', '3V3'], ['pot1', 'VCC'], '#ff0000'),
      w('w2', ['pot1', 'GND'], ['esp32', 'GND'], '#000000'),
      w('w3', ['pot1', 'SIG'], ['esp32', '34'], '#ffaa00'),
      w('w4', ['esp32', '3V3'], ['pot2', 'VCC'], '#ff0000'),
      w('w5', ['pot2', 'GND'], ['esp32', 'GND'], '#000000'),
      w('w6', ['pot2', 'SIG'], ['esp32', '35'], '#ffaa00'),
    ],
  },

  {
    id: 'mega-multi-led',
    title: 'Arduino Mega 16 LED 灯条',
    description: 'Arduino Mega 用引脚 22-37 驱动 16 个 LED。霹雳游侠扫描效果。',
    category: 'circuits',
    difficulty: 'beginner',
    boardType: 'arduino-mega',
    code: `// Arduino Mega — 16-LED Knight Rider
void setup() { for(int i=22;i<=37;i++) pinMode(i,OUTPUT); }
void loop() {
  for(int i=22;i<=37;i++) { digitalWrite(i,HIGH); delay(50); digitalWrite(i,LOW); }
  for(int i=37;i>=22;i--) { digitalWrite(i,HIGH); delay(50); digitalWrite(i,LOW); }
}`,
    components: [
      MEGA,
      ...Array.from({ length: 8 }, (_, i) => ({
        type: 'wokwi-led',
        id: `led${i}`,
        x: 460 + i * 30,
        y: 300,
        properties: { color: 'red' },
      })),
      // Series 220Ω resistors — one per LED. Without them ngspice
      // can't solve a forward-biased short and the LEDs stay dark.
      ...Array.from({ length: 8 }, (_, i) => ({
        type: 'wokwi-resistor',
        id: `r${i}`,
        x: 340,
        y: 280 + i * 10,
        properties: { value: '220' },
      })),
    ],
    wires: [
      ...Array.from({ length: 8 }, (_, i) =>
        w(`wp${i}`, ['arduino-mega', `${22 + i}`], [`r${i}`, '1']),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        w(`wl${i}`, [`r${i}`, '2'], [`led${i}`, 'A']),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        w(`wg${i}`, [`led${i}`, 'C'], ['arduino-mega', 'GND'], '#000000'),
      ),
    ],
  },

  {
    id: 'nano-sensor-station',
    title: 'Arduino Nano 传感器站',
    description: '紧凑型气象站：NTC + 光敏电阻接入 Nano。读取温度和光线。',
    category: 'circuits',
    difficulty: 'beginner',
    boardType: 'arduino-nano',
    code: `// Nano sensor station — NTC + LDR
#define NTC_PIN A0
#define LDR_PIN A1
void setup() { Serial.begin(9600); }
void loop() {
  int tempRaw = analogRead(NTC_PIN);
  int lightRaw = analogRead(LDR_PIN);
  float tempV = tempRaw * 5.0 / 1023.0;
  float lightPct = lightRaw * 100.0 / 1023.0;
  Serial.print("Temp_V="); Serial.print(tempV,2);
  Serial.print("  Light="); Serial.print(lightPct,0); Serial.println("%");
  delay(1000);
}`,
    components: [
      { type: 'wokwi-arduino-nano', id: 'arduino-nano', x: 100, y: 100, properties: {} },
      {
        type: 'wokwi-ntc-temperature-sensor',
        id: 'ntc',
        x: 350,
        y: 100,
        properties: { temperature: '22' },
      },
      { type: 'wokwi-photoresistor-sensor', id: 'ldr', x: 350, y: 260, properties: { lux: '300' } },
    ],
    wires: [
      w('w1', ['arduino-nano', '5V'], ['ntc', 'VCC'], '#ff0000'),
      w('w2', ['ntc', 'GND'], ['arduino-nano', 'GND'], '#000000'),
      w('w3', ['ntc', 'OUT'], ['arduino-nano', 'A0'], '#ffaa00'),
      w('w4', ['arduino-nano', '5V'], ['ldr', 'VCC'], '#ff0000'),
      w('w5', ['ldr', 'GND'], ['arduino-nano', 'GND'], '#000000'),
      w('w6', ['ldr', 'AO'], ['arduino-nano', 'A1'], '#ffaa00'),
    ],
  },

  {
    id: 'esp32-pwm-led-rgb',
    title: 'ESP32 LEDC PWM RGB',
    description: 'ESP32 LEDC 外设通过独立 PWM 通道驱动 RGB LED。',
    category: 'circuits',
    difficulty: 'intermediate',
    boardType: 'esp32',
    code: `// ESP32 LEDC PWM — RGB LED color cycling
#define R_PIN 16
#define G_PIN 17
#define B_PIN 18
void setup() {
  ledcAttach(R_PIN, 5000, 8);
  ledcAttach(G_PIN, 5000, 8);
  ledcAttach(B_PIN, 5000, 8);
}
void loop() {
  for(int h=0; h<360; h+=5) {
    float r,g,b;
    // HSV to RGB (S=1, V=1)
    int i = h/60; float f = h/60.0-i;
    switch(i%6) {
      case 0: r=1; g=f;   b=0;   break;
      case 1: r=1-f; g=1; b=0;   break;
      case 2: r=0; g=1;   b=f;   break;
      case 3: r=0; g=1-f; b=1;   break;
      case 4: r=f; g=0;   b=1;   break;
      case 5: r=1; g=0;   b=1-f; break;
    }
    ledcWrite(R_PIN, (int)(r*255));
    ledcWrite(G_PIN, (int)(g*255));
    ledcWrite(B_PIN, (int)(b*255));
    delay(30);
  }
}`,
    components: [
      ESP32,
      { type: 'wokwi-rgb-led', id: 'rgb', x: 400, y: 150, properties: {} },
      { type: 'wokwi-resistor', id: 'rr', x: 380, y: 80, properties: { value: '220' } },
      { type: 'wokwi-resistor', id: 'rg', x: 420, y: 80, properties: { value: '220' } },
      { type: 'wokwi-resistor', id: 'rb', x: 460, y: 80, properties: { value: '220' } },
    ],
    wires: [
      w('w1', ['esp32', '16'], ['rr', '1']),
      w('w2', ['rr', '2'], ['rgb', 'R'], '#ff0000'),
      w('w3', ['esp32', '17'], ['rg', '1']),
      w('w4', ['rg', '2'], ['rgb', 'G'], '#00ff00'),
      w('w5', ['esp32', '18'], ['rb', '1']),
      w('w6', ['rb', '2'], ['rgb', 'B'], '#0000ff'),
      w('w7', ['rgb', 'COM'], ['esp32', 'GND'], '#000000'),
    ],
  },
];
