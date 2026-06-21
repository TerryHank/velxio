/**
 * ePaper / 电子墨水屏示例合集。
 *
 * 五款 Phase-1 面板（1.54"、2.13"、2.9"、4.2"、7.5"），均为 SSD168x 系列，
 * 均通过 GxEPD2 驱动。每个示例对接不同开发板，用户可观察电子纸在
 * AVR / RP2040 / ESP32 上的运行效果。
 *
 * 后端 ESP32 路径使用 `backend/app/services/esp32_spi_slaves.py` 中的
 * `Ssd168xEpaperSlave`。浏览器端路径（AVR / RP2040）使用
 * `frontend/src/simulation/displays/SSD168xDecoder.ts`。
 * 两者均渲染到同一个 `<velxio-epaper>` Web Component。
 */

import type { ExampleProject } from './examples';

const EPAPER_LIBS = ['GxEPD2', 'Adafruit GFX Library'];

// ── 1. Arduino Uno + 1.54" "Hello World" —— AVR 代表作品 ─────────────
const helloUno154: ExampleProject = {
  id: 'epaper-1in54-uno-hello',
  title: '电子纸 1.54" Hello — Arduino Uno',
  description:
    'GxEPD2 分页模式在 200×200 SSD1681 电子墨水屏上显示 "Hello, Velxio"，由 Arduino Uno 驱动。' +
    '32 KB flash + 2 KB SRAM 下以 16 行页高驱动的最小面板。',
  category: 'displays',
  difficulty: 'intermediate',
  boardType: 'arduino-uno',
  boardFilter: 'arduino-uno',
  libraries: EPAPER_LIBS,
  tags: ['电子纸', '电子墨水', 'gxepd2', 'ssd1681', 'avr', 'spi'],
  code: `// 1.54" SSD1681 电子纸 Hello World，Arduino Uno
// 接线: CS=D10, DC=D9, RST=D8, BUSY=D7 + 硬件 SPI (D11=MOSI, D13=SCK)

#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold9pt7b.h>

GxEPD2_BW<GxEPD2_154_D67, 16> display(GxEPD2_154_D67(/*CS=*/10, /*DC=*/9, /*RST=*/8, /*BUSY=*/7));

void setup() {
  Serial.begin(9600);
  display.init(9600, true, 50, false);
  display.setRotation(0);
  display.setTextColor(GxEPD_BLACK);
  display.setFont(&FreeMonoBold9pt7b);
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setCursor(20, 60);  display.print(F("Velxio"));
    display.setCursor(20, 100); display.print(F("ePaper"));
    display.setCursor(20, 140); display.print(F("OK!"));
  } while (display.nextPage());
  display.hibernate();
  Serial.println(F("完成"));
}

void loop() {}
`,
  components: [
    {
      type: 'epaper-1in54-bw',
      id: 'epd-154',
      x: 480,
      y: 80,
      properties: { panelKind: 'epaper-1in54-bw', refreshMs: 50 },
    },
  ],
  wires: [
    { id: 'w-cs', start: { componentId: 'arduino-uno', pinName: '10' }, end: { componentId: 'epd-154', pinName: 'CS' }, color: '#ffaa00' },
    { id: 'w-dc', start: { componentId: 'arduino-uno', pinName: '9' },  end: { componentId: 'epd-154', pinName: 'DC' }, color: '#aa66ff' },
    { id: 'w-rst', start: { componentId: 'arduino-uno', pinName: '8' }, end: { componentId: 'epd-154', pinName: 'RST' }, color: '#ff4444' },
    { id: 'w-busy', start: { componentId: 'arduino-uno', pinName: '7' }, end: { componentId: 'epd-154', pinName: 'BUSY' }, color: '#22cc22' },
    { id: 'w-mosi', start: { componentId: 'arduino-uno', pinName: '11' }, end: { componentId: 'epd-154', pinName: 'SDI' }, color: '#22aaff' },
    { id: 'w-sck', start: { componentId: 'arduino-uno', pinName: '13' }, end: { componentId: 'epd-154', pinName: 'SCK' }, color: '#ffdd33' },
    { id: 'w-vcc', start: { componentId: 'arduino-uno', pinName: '3.3V' }, end: { componentId: 'epd-154', pinName: 'VCC' }, color: '#ff4444' },
    { id: 'w-gnd', start: { componentId: 'arduino-uno', pinName: 'GND.1' }, end: { componentId: 'epd-154', pinName: 'GND' }, color: '#000000' },
  ],
};

// ── 2. Pi Pico + 2.13" 挂钟 ────────────────────────────────────────────
const clockPico213: ExampleProject = {
  id: 'epaper-2in13-pico-clock',
  title: '电子纸 2.13" 挂钟 — Raspberry Pi Pico',
  description:
    '在 2.13" 250×122 SSD1675A 面板上每秒计数，每分钟刷新一次帧缓冲。' +
    '通过 Earle Philhower 核心在 Pico 上运行；使用 SPI0 默认引脚。',
  category: 'displays',
  difficulty: 'intermediate',
  boardType: 'raspberry-pi-pico',
  boardFilter: 'raspberry-pi-pico',
  libraries: EPAPER_LIBS,
  tags: ['电子纸', '电子墨水', 'gxepd2', 'ssd1675', 'rp2040', 'pico', '时钟'],
  code: `// 2.13" SSD1675A 面板，Pi Pico SPI0 (GP18=SCK, GP19=MOSI, GP9=CS, GP8=DC, GP12=RST, GP13=BUSY)

#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold12pt7b.h>

GxEPD2_BW<GxEPD2_213_B72, GxEPD2_213_B72::HEIGHT> display(
  GxEPD2_213_B72(/*CS=*/9, /*DC=*/8, /*RST=*/12, /*BUSY=*/13));

uint32_t minutes = 0;

void drawClock() {
  display.fillScreen(GxEPD_WHITE);
  display.setTextColor(GxEPD_BLACK);
  display.setFont(&FreeMonoBold12pt7b);
  display.setCursor(8, 28);  display.print("Velxio Clock");
  display.setCursor(8, 64);
  display.print("运行时间: "); display.print(minutes); display.print("m");
}

void setup() {
  Serial.begin(115200);
  display.init(115200, true, 50, false);
  display.setRotation(1);  // 横屏 250×122
  display.setFullWindow();
  display.firstPage();
  do { drawClock(); } while (display.nextPage());
  display.hibernate();
}

void loop() {
  delay(60000UL);
  minutes++;
  display.firstPage();
  do { drawClock(); } while (display.nextPage());
  display.hibernate();
}
`,
  components: [
    {
      type: 'epaper-2in13-bw',
      id: 'epd-213',
      x: 480,
      y: 60,
      properties: { panelKind: 'epaper-2in13-bw', refreshMs: 50 },
    },
  ],
  wires: [
    { id: 'w-cs', start: { componentId: 'raspberry-pi-pico', pinName: 'GP9' }, end: { componentId: 'epd-213', pinName: 'CS' }, color: '#ffaa00' },
    { id: 'w-dc', start: { componentId: 'raspberry-pi-pico', pinName: 'GP8' }, end: { componentId: 'epd-213', pinName: 'DC' }, color: '#aa66ff' },
    { id: 'w-rst', start: { componentId: 'raspberry-pi-pico', pinName: 'GP12' }, end: { componentId: 'epd-213', pinName: 'RST' }, color: '#ff4444' },
    { id: 'w-busy', start: { componentId: 'raspberry-pi-pico', pinName: 'GP13' }, end: { componentId: 'epd-213', pinName: 'BUSY' }, color: '#22cc22' },
    { id: 'w-mosi', start: { componentId: 'raspberry-pi-pico', pinName: 'GP19' }, end: { componentId: 'epd-213', pinName: 'SDI' }, color: '#22aaff' },
    { id: 'w-sck', start: { componentId: 'raspberry-pi-pico', pinName: 'GP18' }, end: { componentId: 'epd-213', pinName: 'SCK' }, color: '#ffdd33' },
    { id: 'w-vcc', start: { componentId: 'raspberry-pi-pico', pinName: '3V3' }, end: { componentId: 'epd-213', pinName: 'VCC' }, color: '#ff4444' },
    { id: 'w-gnd', start: { componentId: 'raspberry-pi-pico', pinName: 'GND.1' }, end: { componentId: 'epd-213', pinName: 'GND' }, color: '#000000' },
  ],
};

// ── 3. ESP32 + 2.9" 天气组件 ──────────────────────────────────────────
const weatherEsp29: ExampleProject = {
  id: 'epaper-2in9-esp32-weather',
  title: '电子纸 2.9" 天气 — ESP32',
  description:
    '2.9" 296×128 SSD1680 面板上的模拟天气组件。通过后端 Ssd168xEpaperSlave ' +
    '演示电子纸渲染——QEMU worker 解码 SPI 流量并将锁存的帧通过 `epaper_update` ' +
    'WebSocket 事件传回浏览器。',
  category: 'displays',
  difficulty: 'intermediate',
  boardType: 'esp32-devkit-c-v4',
  boardFilter: 'esp32',
  libraries: EPAPER_LIBS,
  tags: ['电子纸', '电子墨水', 'gxepd2', 'ssd1680', 'esp32', '天气'],
  code: `// 2.9" 296x128 SSD1680 面板，ESP32 (默认 VSPI — SCK=18, MOSI=23)

#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold12pt7b.h>

GxEPD2_BW<GxEPD2_290_T94, GxEPD2_290_T94::HEIGHT> display(
  GxEPD2_290_T94(/*CS=*/5, /*DC=*/17, /*RST=*/16, /*BUSY=*/4));

void setup() {
  Serial.begin(115200);
  display.init(115200, true, 50, false);
  display.setRotation(1);
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setTextColor(GxEPD_BLACK);
    display.setFont(&FreeMonoBold12pt7b);
    display.setCursor(8, 28);  display.print("Velxio 天气");
    display.setCursor(8, 64);  display.print("温度:  22.5 C");
    display.setCursor(8, 96);  display.print("湿度:    48 %");
  } while (display.nextPage());
  display.hibernate();
  Serial.println("帧完成");
}

void loop() { delay(1000); }
`,
  components: [
    {
      type: 'epaper-2in9-bw',
      id: 'epd-290',
      x: 460,
      y: 80,
      properties: { panelKind: 'epaper-2in9-bw', refreshMs: 50 },
    },
  ],
  wires: [
    { id: 'w-cs', start: { componentId: 'esp32', pinName: '5' }, end: { componentId: 'epd-290', pinName: 'CS' }, color: '#ffaa00' },
    { id: 'w-dc', start: { componentId: 'esp32', pinName: '17' }, end: { componentId: 'epd-290', pinName: 'DC' }, color: '#aa66ff' },
    { id: 'w-rst', start: { componentId: 'esp32', pinName: '16' }, end: { componentId: 'epd-290', pinName: 'RST' }, color: '#ff4444' },
    { id: 'w-busy', start: { componentId: 'esp32', pinName: '4' }, end: { componentId: 'epd-290', pinName: 'BUSY' }, color: '#22cc22' },
    { id: 'w-mosi', start: { componentId: 'esp32', pinName: '23' }, end: { componentId: 'epd-290', pinName: 'SDI' }, color: '#22aaff' },
    { id: 'w-sck', start: { componentId: 'esp32', pinName: '18' }, end: { componentId: 'epd-290', pinName: 'SCK' }, color: '#ffdd33' },
    { id: 'w-vcc', start: { componentId: 'esp32', pinName: '3V3' }, end: { componentId: 'epd-290', pinName: 'VCC' }, color: '#ff4444' },
    { id: 'w-gnd', start: { componentId: 'esp32', pinName: 'GND.1' }, end: { componentId: 'epd-290', pinName: 'GND' }, color: '#000000' },
  ],
};

// ── 4. Pi Pico + 4.2" 静态图像 ────────────────────────────────────────
const imagePico420: ExampleProject = {
  id: 'epaper-4in2-pico-image',
  title: '电子纸 4.2" 静态图像 — Raspberry Pi Pico',
  description:
    '嵌入固定 400×300 黑白图案（同心方块）并一次推屏。' +
    '尺寸足够展示真实布局——标题栏、分割线、数据表格。',
  category: 'displays',
  difficulty: 'advanced',
  boardType: 'raspberry-pi-pico',
  boardFilter: 'raspberry-pi-pico',
  libraries: EPAPER_LIBS,
  tags: ['电子纸', '电子墨水', 'gxepd2', 'ssd1683', 'rp2040', '图像'],
  code: `// 4.2" 400x300 SSD1683 面板，Pi Pico SPI0 — GP18 SCK, GP19 MOSI

#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold18pt7b.h>
#include <Fonts/FreeMonoBold9pt7b.h>

GxEPD2_BW<GxEPD2_420_GDEY042T81, 32> display(
  GxEPD2_420_GDEY042T81(/*CS=*/9, /*DC=*/8, /*RST=*/12, /*BUSY=*/13));

void drawLayout() {
  display.fillScreen(GxEPD_WHITE);
  display.setTextColor(GxEPD_BLACK);
  display.setFont(&FreeMonoBold18pt7b);
  display.setCursor(20, 60);  display.print("Velxio 日志");
  display.drawLine(20, 80, 380, 80, GxEPD_BLACK);

  display.setFont(&FreeMonoBold9pt7b);
  const char* rows[][2] = {
    {"日期",        "2026-04-29"},
    {"电池",        " 3.91 V"},
    {"循环次数",    "  1024"},
    {"上次刷新",    "  62 ms"},
  };
  for (uint8_t i = 0; i < 4; i++) {
    display.setCursor(40, 120 + i * 28);  display.print(rows[i][0]);
    display.setCursor(220, 120 + i * 28); display.print(rows[i][1]);
  }
}

void setup() {
  Serial.begin(115200);
  display.init(115200, true, 50, false);
  display.setRotation(0);
  display.setFullWindow();
  display.firstPage();
  do { drawLayout(); } while (display.nextPage());
  display.hibernate();
}

void loop() {}
`,
  components: [
    {
      type: 'epaper-4in2-bw',
      id: 'epd-420',
      x: 480,
      y: 60,
      properties: { panelKind: 'epaper-4in2-bw', refreshMs: 80 },
    },
  ],
  wires: [
    { id: 'w-cs', start: { componentId: 'raspberry-pi-pico', pinName: 'GP9' }, end: { componentId: 'epd-420', pinName: 'CS' }, color: '#ffaa00' },
    { id: 'w-dc', start: { componentId: 'raspberry-pi-pico', pinName: 'GP8' }, end: { componentId: 'epd-420', pinName: 'DC' }, color: '#aa66ff' },
    { id: 'w-rst', start: { componentId: 'raspberry-pi-pico', pinName: 'GP12' }, end: { componentId: 'epd-420', pinName: 'RST' }, color: '#ff4444' },
    { id: 'w-busy', start: { componentId: 'raspberry-pi-pico', pinName: 'GP13' }, end: { componentId: 'epd-420', pinName: 'BUSY' }, color: '#22cc22' },
    { id: 'w-mosi', start: { componentId: 'raspberry-pi-pico', pinName: 'GP19' }, end: { componentId: 'epd-420', pinName: 'SDI' }, color: '#22aaff' },
    { id: 'w-sck', start: { componentId: 'raspberry-pi-pico', pinName: 'GP18' }, end: { componentId: 'epd-420', pinName: 'SCK' }, color: '#ffdd33' },
    { id: 'w-vcc', start: { componentId: 'raspberry-pi-pico', pinName: '3V3' }, end: { componentId: 'epd-420', pinName: 'VCC' }, color: '#ff4444' },
    { id: 'w-gnd', start: { componentId: 'raspberry-pi-pico', pinName: 'GND.1' }, end: { componentId: 'epd-420', pinName: 'GND' }, color: '#000000' },
  ],
};

// ── 5. ESP32 + 7.5" 多面板仪表盘 ────────────────────────────────────
const dashboardEsp750: ExampleProject = {
  id: 'epaper-7in5-esp32-dashboard',
  title: '电子纸 7.5" 仪表盘 — ESP32',
  description:
    '在最大单色面板上展示 800×480 多格仪表盘。仅 ESP32 支持——帧缓冲对' +
    'AVR/Pico flash 配合分页 GxEPD2 而言过大。',
  category: 'displays',
  difficulty: 'advanced',
  boardType: 'esp32-devkit-c-v4',
  boardFilter: 'esp32',
  libraries: EPAPER_LIBS,
  tags: ['电子纸', '电子墨水', 'gxepd2', 'uc8179', 'gd7965', 'esp32', '仪表盘', '7.5'],
  code: `// 7.5" 800x480 UC8179 面板，ESP32 — VSPI

#include <GxEPD2_BW.h>
#include <Fonts/FreeMonoBold24pt7b.h>
#include <Fonts/FreeMonoBold12pt7b.h>

GxEPD2_BW<GxEPD2_750_T7, 16> display(
  GxEPD2_750_T7(/*CS=*/5, /*DC=*/17, /*RST=*/16, /*BUSY=*/4));

void drawDashboard() {
  display.fillScreen(GxEPD_WHITE);
  display.setTextColor(GxEPD_BLACK);

  // 标题
  display.setFont(&FreeMonoBold24pt7b);
  display.setCursor(40, 60);  display.print("Velxio 仪表盘");
  display.drawLine(40, 80, 760, 80, GxEPD_BLACK);

  // 面板格子
  display.setFont(&FreeMonoBold12pt7b);
  const char* labels[] = { "传感器", "网络", "存储", "健康" };
  const char* values[] = { "12 / 12", "WiFi OK", "640 MB", "100 %" };
  for (uint8_t i = 0; i < 4; i++) {
    int x = 50 + (i % 2) * 360;
    int y = 130 + (i / 2) * 140;
    display.drawRect(x, y, 320, 100, GxEPD_BLACK);
    display.setCursor(x + 20, y + 38);  display.print(labels[i]);
    display.setCursor(x + 20, y + 78);  display.print(values[i]);
  }
}

void setup() {
  Serial.begin(115200);
  display.init(115200, true, 50, false);
  display.setRotation(0);
  display.setFullWindow();
  display.firstPage();
  do { drawDashboard(); } while (display.nextPage());
  display.hibernate();
}

void loop() {}
`,
  components: [
    {
      type: 'epaper-7in5-bw',
      id: 'epd-750',
      x: 480,
      y: 40,
      properties: { panelKind: 'epaper-7in5-bw', refreshMs: 100 },
    },
  ],
  wires: [
    { id: 'w-cs', start: { componentId: 'esp32', pinName: '5' }, end: { componentId: 'epd-750', pinName: 'CS' }, color: '#ffaa00' },
    { id: 'w-dc', start: { componentId: 'esp32', pinName: '17' }, end: { componentId: 'epd-750', pinName: 'DC' }, color: '#aa66ff' },
    { id: 'w-rst', start: { componentId: 'esp32', pinName: '16' }, end: { componentId: 'epd-750', pinName: 'RST' }, color: '#ff4444' },
    { id: 'w-busy', start: { componentId: 'esp32', pinName: '4' }, end: { componentId: 'epd-750', pinName: 'BUSY' }, color: '#22cc22' },
    { id: 'w-mosi', start: { componentId: 'esp32', pinName: '23' }, end: { componentId: 'epd-750', pinName: 'SDI' }, color: '#22aaff' },
    { id: 'w-sck', start: { componentId: 'esp32', pinName: '18' }, end: { componentId: 'epd-750', pinName: 'SCK' }, color: '#ffdd33' },
    { id: 'w-vcc', start: { componentId: 'esp32', pinName: '3V3' }, end: { componentId: 'epd-750', pinName: 'VCC' }, color: '#ff4444' },
    { id: 'w-gnd', start: { componentId: 'esp32', pinName: 'GND.1' }, end: { componentId: 'epd-750', pinName: 'GND' }, color: '#000000' },
  ],
};

// ── 6. ESP32 + 2.9" 三色 B/W/R 告警徽章 ────────────────────────────
const tricolorEsp29: ExampleProject = {
  id: 'epaper-2in9-bwr-esp32-alert',
  title: '电子纸 2.9" 三色告警 — ESP32',
  description:
    '三色 296×128 黑白红面板展示状态徽章。演示 SSD1680 红色平面：标题黑色，' +
    '"ALERT" 药丸红色白底。同时练习 0x24 (BW) 和 0x26 (Red) RAM 命令。',
  category: 'displays',
  difficulty: 'intermediate',
  boardType: 'esp32-devkit-c-v4',
  boardFilter: 'esp32',
  libraries: EPAPER_LIBS,
  tags: ['电子纸', '电子墨水', 'gxepd2', 'ssd1680', '三色', '红色', 'esp32'],
  code: `// 2.9" 296x128 SSD1680 黑白红面板，ESP32 — VSPI
//
// GxEPD2 通过 GxEPD2_3C<...> 而非 GxEPD2_BW<...> 选择三色驱动。
// 物理接线相同；库对每个红色像素写入红色 RAM 平面（命令 0x26）。

#include <GxEPD2_3C.h>
#include <Fonts/FreeMonoBold12pt7b.h>
#include <Fonts/FreeMonoBold18pt7b.h>

GxEPD2_3C<GxEPD2_290_C90c, GxEPD2_290_C90c::HEIGHT> display(
  GxEPD2_290_C90c(/*CS=*/5, /*DC=*/17, /*RST=*/16, /*BUSY=*/4));

void drawAlert() {
  display.fillScreen(GxEPD_WHITE);

  // 黑色标题
  display.setTextColor(GxEPD_BLACK);
  display.setFont(&FreeMonoBold12pt7b);
  display.setCursor(8, 28);
  display.print("系统状态");

  // 红色 "ALERT" 徽章
  display.fillRect(8, 60, 130, 38, GxEPD_RED);
  display.setTextColor(GxEPD_WHITE);
  display.setFont(&FreeMonoBold18pt7b);
  display.setCursor(20, 90);
  display.print("告警");

  // 黑色详情行
  display.setTextColor(GxEPD_BLACK);
  display.setFont(&FreeMonoBold12pt7b);
  display.setCursor(150, 84);
  display.print("温度 89C");
}

void setup() {
  Serial.begin(115200);
  display.init(115200, true, 50, false);
  display.setRotation(1);
  display.setFullWindow();
  display.firstPage();
  do { drawAlert(); } while (display.nextPage());
  display.hibernate();
  Serial.println("帧完成");
}

void loop() { delay(1000); }
`,
  components: [
    {
      type: 'epaper-2in9-bwr',
      id: 'epd-290-bwr',
      x: 460,
      y: 80,
      properties: { panelKind: 'epaper-2in9-bwr', refreshMs: 80 },
    },
  ],
  wires: [
    { id: 'w-cs', start: { componentId: 'esp32', pinName: '5' }, end: { componentId: 'epd-290-bwr', pinName: 'CS' }, color: '#ffaa00' },
    { id: 'w-dc', start: { componentId: 'esp32', pinName: '17' }, end: { componentId: 'epd-290-bwr', pinName: 'DC' }, color: '#aa66ff' },
    { id: 'w-rst', start: { componentId: 'esp32', pinName: '16' }, end: { componentId: 'epd-290-bwr', pinName: 'RST' }, color: '#ff4444' },
    { id: 'w-busy', start: { componentId: 'esp32', pinName: '4' }, end: { componentId: 'epd-290-bwr', pinName: 'BUSY' }, color: '#22cc22' },
    { id: 'w-mosi', start: { componentId: 'esp32', pinName: '23' }, end: { componentId: 'epd-290-bwr', pinName: 'SDI' }, color: '#22aaff' },
    { id: 'w-sck', start: { componentId: 'esp32', pinName: '18' }, end: { componentId: 'epd-290-bwr', pinName: 'SCK' }, color: '#ffdd33' },
    { id: 'w-vcc', start: { componentId: 'esp32', pinName: '3V3' }, end: { componentId: 'epd-290-bwr', pinName: 'VCC' }, color: '#ff4444' },
    { id: 'w-gnd', start: { componentId: 'esp32', pinName: 'GND.1' }, end: { componentId: 'epd-290-bwr', pinName: 'GND' }, color: '#000000' },
  ],
};

// ── 7. ESP32 + 5.65" 七色 ACeP 彩虹 ──────────────────────────────────
const acepEsp565: ExampleProject = {
  id: 'epaper-5in65-7c-esp32-rainbow',
  title: '电子纸 5.65" 七色彩虹 — ESP32',
  description:
    '驱动 GoodDisplay GDEP0565D90 / Waveshare 5.65" ACeP 七色面板 ' +
    '(UC8159c 控制器)。渲染水平色条 + 居中标题以展示全部调色板。' +
    '真实硬件刷新约 12 秒；仿真器中 BUSY 脉冲 150 毫秒。',
  category: 'displays',
  difficulty: 'advanced',
  boardType: 'esp32-devkit-c-v4',
  boardFilter: 'esp32',
  libraries: EPAPER_LIBS,
  tags: ['电子纸', '电子墨水', 'gxepd2', 'uc8159c', 'acep', '七色', 'esp32', '5.65'],
  code: `// 5.65" 600x448 UC8159c ACeP 七色面板，ESP32 — VSPI
// CS=GPIO5  DC=GPIO17  RST=GPIO16  BUSY=GPIO4  SCK=GPIO18  MOSI=GPIO23

#include <GxEPD2_7C.h>
#include <Fonts/FreeMonoBold18pt7b.h>

GxEPD2_7C<GxEPD2_565c_GDEP0565D90, 8> display(
  GxEPD2_565c_GDEP0565D90(/*CS=*/5, /*DC=*/17, /*RST=*/16, /*BUSY=*/4));

// ACeP 七色调色板索引:
//   0=黑 1=白 2=绿 3=蓝 4=红 5=黄 6=橙
const uint16_t COLOURS[] = {
  GxEPD_BLACK, GxEPD_WHITE, GxEPD_GREEN,
  GxEPD_BLUE,  GxEPD_RED,   GxEPD_YELLOW, GxEPD_ORANGE,
};

void drawRainbow() {
  display.fillScreen(GxEPD_WHITE);
  const int barH = 448 / 7;
  for (uint8_t i = 0; i < 7; i++) {
    display.fillRect(0, i * barH, 600, barH, COLOURS[i]);
  }
  display.setTextColor(GxEPD_BLACK);
  display.setFont(&FreeMonoBold18pt7b);
  display.setCursor(120, 240);
  display.print("Velxio ACeP 7c");
}

void setup() {
  Serial.begin(115200);
  display.init(115200, true, 50, false);
  display.setRotation(0);
  display.setFullWindow();
  display.firstPage();
  do { drawRainbow(); } while (display.nextPage());
  display.hibernate();
  Serial.println("帧完成");
}

void loop() { delay(1000); }
`,
  components: [
    {
      type: 'epaper-5in65-7c',
      id: 'epd-565',
      x: 480,
      y: 40,
      properties: { panelKind: 'epaper-5in65-7c', refreshMs: 150 },
    },
  ],
  wires: [
    { id: 'w-cs', start: { componentId: 'esp32', pinName: '5' }, end: { componentId: 'epd-565', pinName: 'CS' }, color: '#ffaa00' },
    { id: 'w-dc', start: { componentId: 'esp32', pinName: '17' }, end: { componentId: 'epd-565', pinName: 'DC' }, color: '#aa66ff' },
    { id: 'w-rst', start: { componentId: 'esp32', pinName: '16' }, end: { componentId: 'epd-565', pinName: 'RST' }, color: '#ff4444' },
    { id: 'w-busy', start: { componentId: 'esp32', pinName: '4' }, end: { componentId: 'epd-565', pinName: 'BUSY' }, color: '#22cc22' },
    { id: 'w-mosi', start: { componentId: 'esp32', pinName: '23' }, end: { componentId: 'epd-565', pinName: 'SDI' }, color: '#22aaff' },
    { id: 'w-sck', start: { componentId: 'esp32', pinName: '18' }, end: { componentId: 'epd-565', pinName: 'SCK' }, color: '#ffdd33' },
    { id: 'w-vcc', start: { componentId: 'esp32', pinName: '3V3' }, end: { componentId: 'epd-565', pinName: 'VCC' }, color: '#ff4444' },
    { id: 'w-gnd', start: { componentId: 'esp32', pinName: 'GND.1' }, end: { componentId: 'epd-565', pinName: 'GND' }, color: '#000000' },
  ],
};

export const epaperExamples: ExampleProject[] = [
  helloUno154,
  clockPico213,
  weatherEsp29,
  imagePico420,
  dashboardEsp750,
  tricolorEsp29,
  acepEsp565,
];
