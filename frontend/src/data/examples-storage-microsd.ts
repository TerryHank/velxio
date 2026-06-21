/**
 * microSD 卡存储示例。
 *
 * 两块开发板端到端验证 SPI SD 卡功能：
 *   - Arduino Uno  → 浏览器内 avr8js，由 `microsd-card` 组件驱动
 *     (`frontend/src/simulation/parts/ProtocolParts.ts`)。
 *   - ESP32        → QEMU，由 Python 从端
 *     (`backend/app/services/esp32_sd_slave.py`) 接入 worker 的
 *     同步 SPI 桥。
 *
 * 均使用 Wokwi 存储模型：
 *   - 免费：项目自身的工作区文件自动复制到卡上，
 *     因此 `SD.open("/")` 无需配置即可列出文件。
 *   - 付费 (Maker+)：打开 microSD 组件属性对话框，使用
 *     "SD Card" 面板上传自定义文件（含二进制）。文件将与
 *     自动复制的源文件一并出现在卡上。
 *
 * 每次运行时会从项目文件 + 上传文件重建卡镜像（固件写入
 * 仅限会话期间，重载后重置，与 Wokwi 一致）。
 */
import type { ExampleProject } from './examples';

// 共享的列出 + 写入/回读逻辑，按开发板参数化，使两个示例保持同步。
const UNO_CODE = `// microSD 卡 over SPI (Arduino Uno)
// 接线: CS->10  MOSI->11  MISO->12  SCK->13  VCC->5V  GND->GND
//
// 卡上已有本项目的文件（自动复制，免费）。付费用户可通过
// 组件的 "SD Card" 面板添加自定义文件。以 9600 波特打开串口
// 监视器，观察卡文件列表，随后写入并读取一个文件。
#include <SPI.h>
#include <SD.h>

const int CS_PIN = 10;

void listRoot() {
  File root = SD.open("/");
  Serial.println(F("卡上文件:"));
  while (true) {
    File entry = root.openNextFile();
    if (!entry) break;
    Serial.print(F("  "));
    Serial.print(entry.name());
    Serial.print(F("  "));
    Serial.print(entry.size());
    Serial.println(F(" 字节"));
    entry.close();
  }
  root.close();
}

void setup() {
  Serial.begin(9600);
  while (!Serial) {}
  Serial.println(F("microSD 演示 - Arduino Uno"));

  if (!SD.begin(CS_PIN)) {
    Serial.println(F("SD.begin() 失败 - 请检查接线"));
    return;
  }
  Serial.println(F("卡就绪。"));
  listRoot();

  // 写一个文件，然后立即读回。
  File w = SD.open("/log.txt", FILE_WRITE);
  if (w) {
    w.println("hello from velxio");
    w.close();
    Serial.println(F("已写入 /log.txt"));
  }
  File r = SD.open("/log.txt");
  if (r) {
    Serial.print(F("回读: "));
    while (r.available()) Serial.write(r.read());
    r.close();
  }
  Serial.println(F("完成。"));
}

void loop() {}
`;

const ESP32_CODE = `// microSD 卡 over SPI (ESP32, 默认 VSPI)
// 接线: CS->5  MOSI->23  MISO->19  SCK->18  VCC->3V3  GND->GND
//
// 卡上已有本项目的文件（自动复制，免费）。付费用户可通过
// 组件的 "SD Card" 面板添加自定义文件。以 115200 波特打开串口
// 监视器，观察卡文件列表，随后写入并读取一个文件。
#include <SPI.h>
#include <SD.h>

void listRoot() {
  File root = SD.open("/");
  Serial.println("卡上文件:");
  File entry = root.openNextFile();
  while (entry) {
    Serial.printf("  %s  %u 字节\\n", entry.name(), (unsigned) entry.size());
    entry.close();
    entry = root.openNextFile();
  }
  root.close();
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  Serial.println("microSD 演示 - ESP32");

  if (!SD.begin()) {  // 默认 VSPI, CS = GPIO5
    Serial.println("SD.begin() 失败 - 请检查接线");
    return;
  }
  Serial.println("卡就绪。");
  listRoot();

  File w = SD.open("/log.txt", FILE_WRITE);
  if (w) {
    w.println("hello from velxio");
    w.close();
    Serial.println("已写入 /log.txt");
  }
  File r = SD.open("/log.txt");
  if (r) {
    Serial.print("回读: ");
    while (r.available()) Serial.write(r.read());
    r.close();
  }
  Serial.println("完成。");
}

void loop() {}
`;

export const microsdExamples: ExampleProject[] = [
  {
    id: 'microsd-card-uno',
    title: 'microSD 卡 (Arduino Uno)',
    description:
      '通过 SPI 读写 microSD 卡文件。卡中预加载了本项目的文件' +
      '（免费自动复制）；付费用户可通过组件 "SD Card" 面板上传自定义' +
      '文件。列出根目录，然后写入 /log.txt 并回读。以 9600 波特打开' +
      '串口监视器。',
    category: 'communication',
    difficulty: 'beginner',
    boardType: 'arduino-uno',
    boardFilter: 'arduino-uno',
    tags: ['microsd', 'sd卡', 'spi', '存储', '文件', 'fat16'],
    code: UNO_CODE,
    components: [
      {
        type: 'microsd-card',
        id: 'sd1',
        x: 460,
        y: 120,
        properties: {},
      },
    ],
    wires: [
      { id: 'w-cs', start: { componentId: 'arduino-uno', pinName: '10' }, end: { componentId: 'sd1', pinName: 'CS' }, color: '#ffaa00' },
      { id: 'w-mosi', start: { componentId: 'arduino-uno', pinName: '11' }, end: { componentId: 'sd1', pinName: 'MOSI' }, color: '#22aaff' },
      { id: 'w-miso', start: { componentId: 'arduino-uno', pinName: '12' }, end: { componentId: 'sd1', pinName: 'MISO' }, color: '#22cc22' },
      { id: 'w-sck', start: { componentId: 'arduino-uno', pinName: '13' }, end: { componentId: 'sd1', pinName: 'SCK' }, color: '#ffdd33' },
      { id: 'w-vcc', start: { componentId: 'arduino-uno', pinName: '5V' }, end: { componentId: 'sd1', pinName: 'VCC' }, color: '#ff4444' },
      { id: 'w-gnd', start: { componentId: 'arduino-uno', pinName: 'GND.1' }, end: { componentId: 'sd1', pinName: 'GND' }, color: '#000000' },
    ],
  },
  {
    id: 'microsd-card-esp32',
    title: 'microSD 卡 (ESP32)',
    description:
      'ESP32 通过 SPI (VSPI) 读写 microSD 卡文件。卡中预加载了' +
      '本项目的文件（免费自动复制）；付费用户可通过组件 "SD Card" 面板' +
      '上传自定义文件。列出根目录，然后写入 /log.txt 并回读。以 115200' +
      '波特打开串口监视器。',
    category: 'communication',
    difficulty: 'intermediate',
    boardType: 'esp32',
    boardFilter: 'esp32',
    tags: ['microsd', 'sd卡', 'spi', '存储', '文件', 'fat16', 'esp32'],
    code: ESP32_CODE,
    components: [
      {
        type: 'microsd-card',
        id: 'sd1',
        x: 460,
        y: 120,
        properties: {},
      },
    ],
    wires: [
      { id: 'w-cs', start: { componentId: 'esp32', pinName: '5' }, end: { componentId: 'sd1', pinName: 'CS' }, color: '#ffaa00' },
      { id: 'w-mosi', start: { componentId: 'esp32', pinName: '23' }, end: { componentId: 'sd1', pinName: 'MOSI' }, color: '#22aaff' },
      { id: 'w-miso', start: { componentId: 'esp32', pinName: '19' }, end: { componentId: 'sd1', pinName: 'MISO' }, color: '#22cc22' },
      { id: 'w-sck', start: { componentId: 'esp32', pinName: '18' }, end: { componentId: 'sd1', pinName: 'SCK' }, color: '#ffdd33' },
      { id: 'w-vcc', start: { componentId: 'esp32', pinName: '3V3' }, end: { componentId: 'sd1', pinName: 'VCC' }, color: '#ff4444' },
      { id: 'w-gnd', start: { componentId: 'esp32', pinName: 'GND.1' }, end: { componentId: 'sd1', pinName: 'GND' }, color: '#000000' },
    ],
  },
];
