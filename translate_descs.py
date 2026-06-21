import sys

with open('D:/Workspace/velxio/frontend/src/data/examples.ts', 'r', encoding='utf-8') as f:
    content = f.read()

reps = {
    'Cross-board demo: the STM32 Blue Pill toggles PA1 every 500 ms (wired to Arduino Uno pin 2). The Uno reads pin 2 and mirrors it to its built-in LED (pin 13). Shows heterogeneous multi-board simulation \u2014 QEMU STM32 driving an avr8js Arduino.':
        '跨板演示：STM32 Blue Pill 每 500 ms 翻转 PA1（连接 Arduino Uno 引脚 2）。Uno 读取引脚 2 并镜像到内置 LED（引脚 13）。展示异构多板仿真——QEMU STM32 驱动 avr8js Arduino。',
    
    'Cross-board UART: the STM32 Blue Pill sends a \"PING n\" message over USART1 (PA9 TX) into the Arduino Uno RX (pin 0). The Uno reads each line and blinks the built-in LED (pin 13). Two different MCUs talking over a single wire.':
        '跨板 UART：STM32 Blue Pill 通过 USART1（PA9 TX）向 Arduino Uno RX（引脚 0）发送 \"PING n\" 消息。Uno 读取每行并闪烁内置 LED（引脚 13）。两个不同 MCU 通过单线通信。',
    
    'Cross-board demo: the STM32 Blue Pill toggles PA1 (wired to ESP32 GPIO4). The ESP32 reads GPIO4 and prints its state + mirrors it onto GPIO2. Two QEMU instances (STM32 + ESP32) running simultaneously.':
        '跨板演示：STM32 Blue Pill 翻转 PA1（连接 ESP32 GPIO4）。ESP32 读取 GPIO4 并打印状态 + 镜像到 GPIO2。两个 QEMU 实例（STM32 + ESP32）同时运行。',
    
    'Two different STM32 boards talking: the Blue Pill (F103) toggles PA1, wired to the Black Pill (F411) PA0. The Black Pill reads PA0 and mirrors it to its onboard PC13 LED. Both boards are compiled and emulated independently, proving the QEMU multi-instance path for STM32.':
        '两块不同 STM32 板通信：Blue Pill (F103) 翻转 PA1，连接 Black Pill (F411) PA0。Black Pill 读取 PA0 并镜像到板载 PC13 LED。两块板独立编译仿真，验证 STM32 QEMU 多实例路径。',
    
    'Read temperature and pressure from a BMP280 over I2C1 on an STM32 Blue Pill (SCL=PB6, SDA=PB7). The sensor runs as a QEMU I2C slave; values stream to the Serial Monitor at 115200 baud.':
        'STM32 Blue Pill 通过 I2C1（SCL=PB6, SDA=PB7）读取 BMP280 温度气压。传感器作为 QEMU I2C 从设备；数值以 115200 波特输出到串口监视器。',
    
    'Drive a 128x64 SSD1306 OLED over I2C1 from an STM32 Blue Pill (SCL=PB6, SDA=PB7). The framebuffer writes are captured by the QEMU I2C slave and rendered as a virtual display. Shows text and basic graphics.':
        'STM32 Blue Pill 通过 I2C1（SCL=PB6, SDA=PB7）驱动 128x64 SSD1306 OLED。帧缓冲写入被 QEMU I2C 从设备捕获并渲染为虚拟显示器，展示文本和基本图形。',
    
    'Read the WHO_AM_I id and accelerometer axes from an MPU6050 6-axis IMU over I2C1 on the STM32 Blue Pill (SCL=PB6, SDA=PB7). The sensor runs as a QEMU I2C slave, returning clean identity and motion data at 115200 baud.':
        'STM32 Blue Pill 通过 I2C1（SCL=PB6, SDA=PB7）读取 MPU6050 六轴 IMU 的 WHO_AM_I ID 和加速度计。传感器作为 QEMU I2C 从设备，以 115200 波特返回身份和运动数据。',
    
    'Read the current time and date from a DS1307 real-time clock over I2C1 on the STM32 Blue Pill (SCL=PB6, SDA=PB7). The QEMU DS1307 slave returns the live system time, printed to Serial at 115200 baud.':
        'STM32 Blue Pill 通过 I2C1（SCL=PB6, SDA=PB7）从 DS1307 RTC 读取当前时间日期。QEMU DS1307 从设备返回实时系统时间，以 115200 波特输出到串口。',
    
    'Drive a 128x64 SSD1306 OLED over I2C1 from an STM32 Black Pill (F411, Cortex-M4; SCL=PB6, SDA=PB7). Proves the I2C display path works on the F4 board family too.':
        'STM32 Black Pill (F411, Cortex-M4) 通过 I2C1（SCL=PB6, SDA=PB7）驱动 128x64 SSD1306 OLED。验证 I2C 显示路径在 F4 板系列上也可用。',
    
    'A complete I2C dashboard on the STM32 Blue Pill: read temperature and pressure from a BMP280 and render them live on an SSD1306 OLED, both sharing the same I2C1 bus (SCL=PB6, SDA=PB7). Two devices on one bus \u2014 real embedded engineering.':
        'STM32 Blue Pill 完整 I2C 仪表盘：从 BMP280 读取温度气压并实时渲染到 SSD1306 OLED，两者共享 I2C1 总线（SCL=PB6, SDA=PB7）。一总线双设备——真实嵌入式工程。',
    
    'Count 0-9 on a common-cathode 7-segment display using the STM32 Blue Pill. Simple BCD-to-pin mapping (PA0..PA6 for segments a..g). Demonstrates GPIO output on STM32 without any libraries.':
        'STM32 Blue Pill 驱动共阴极数码管显示 0-9 计数。简单 BCD 到引脚映射（PA0..PA6 对应段 a..g）。演示 STM32 无库 GPIO 输出。',
    
    'Cycle an RGB LED through red, green and blue using three GPIO pins (PA0=R, PA1=G, PA2=B) on the STM32 Blue Pill. Pure digital output \u2014 no PWM needed.':
        'STM32 Blue Pill 使用三个 GPIO 引脚（PA0=红, PA1=绿, PA2=蓝）循环 RGB LED 颜色。纯数字输出——无需 PWM。',
    
    'Press an external pushbutton (wired to PA0 with pull-down) to toggle the STM32 Blue Pill onboard PC13 LED. First digital-input + output example on STM32.':
        '按下外部按钮（连接 PA0 带下拉电阻）切换 STM32 Blue Pill 板载 PC13 LED。STM32 首个数字输入+输出示例。',
    
    'Flip a slide switch (wired to PA0) to control the onboard PC13 LED. Read: switch ON \u2192 LED ON. Simple but proves GPIO input on STM32.':
        '拨动滑动开关（连接 PA0）控制板载 PC13 LED。开关 ON \u2192 LED ON。简单但验证 STM32 GPIO 输入。',
    
    'Spin a bipolar stepper motor from an Arduino Uno through an A4988 driver. The MCU only pulses STEP and sets DIR; the A4988 handles current chopping and microstepping.':
        'Arduino Uno 通过 A4988 驱动器驱动双极步进电机。MCU 仅脉冲 STEP 和设置 DIR；A4988 处理电流斩波和微步进。',
    
    'Spin a bipolar stepper motor from an ESP32 through an A4988 driver (STEP = GPIO26, DIR = GPIO27).':
        'ESP32 通过 A4988 驱动器驱动双极步进电机（STEP = GPIO26, DIR = GPIO27）。',
    
    'Spin a bipolar stepper motor from a Raspberry Pi Pico through an A4988 driver (STEP = GP3, DIR = GP4).':
        'Raspberry Pi Pico 通过 A4988 驱动器驱动双极步进电机（STEP = GP3, DIR = GP4）。',
    
    'Classic Arduino blink example - toggle an LED on and off':
        '经典 Arduino 闪烁示例——切换 LED 开关',
    
    'Simulate a traffic light with red, yellow, and green LEDs':
        '红、黄、绿 LED 模拟交通灯',
    
    'Control an LED with a pushbutton':
        '用按钮控制 LED',
    
    'Smoothly fade an LED using PWM':
        '使用 PWM 平滑渐变 LED',
    
    'Send messages through serial communication':
        '通过串口通信发送消息',
    
    'Cycle through colors with an RGB LED':
        'RGB LED 颜色循环',
    
    'Memory game with LEDs and buttons':
        'LED 和按钮记忆游戏',
    
    'Color TFT display demo: fills, text, and a bouncing ball animation using the Adafruit ILI9341 library (240x320)':
        '彩色 TFT 显示屏演示：填充、文字和弹球动画，使用 Adafruit ILI9341 库 (240x320)',
    
    'Display text on a 20x4 LCD using the LiquidCrystal library':
        '使用 LiquidCrystal 库在 20x4 LCD 上显示文字',
    
    'Tests Serial communication: echoes typed characters back and prints status. Open the Serial Monitor to interact.':
        '测试串口通信：回显键入字符并打印状态。打开串口监视器交互。',
    
    'Control an LED via Serial commands: send \"1\" or \"0\". Tests USART RX + GPIO output together.':
        '通过串口命令控制 LED：发送 \"1\" 或 \"0\"。同时测试 USART RX + GPIO 输出。',
    
    'Scans the I2C bus and reports all devices found. SSD1306 OLED (0x3C) is wired on canvas; virtual devices at 0x48, 0x50, and 0x68 respond.':
        '扫描 I2C 总线并报告所有发现的设备。画布上连接 SSD1306 OLED (0x3C)；虚拟设备在 0x48、0x50 和 0x68 响应。',
    
    'Reads time from a virtual DS1307 RTC via I2C and prints it to Serial. Tests TWI read transactions.':
        '通过 I2C 从虚拟 DS1307 RTC 读取时间并输出到串口。测试 TWI 读事务。',
    
    'Writes data to a virtual I2C EEPROM (0x50) and reads it back. Tests TWI write+read transactions.':
        '向虚拟 I2C EEPROM (0x50) 写入数据并回读。测试 TWI 写+读事务。',
    
    'Tests SPI by sending bytes and reading responses. Demonstrates MOSI/MISO/SCK/SS protocol.':
        '通过发送字节和读取响应测试 SPI。演示 MOSI/MISO/SCK/SS 协议。',
    
    'Uses Serial + I2C + SPI together. Reads RTC via I2C, sends SPI data, and logs everything to Serial.':
        '同时使用串口 + I2C + SPI。通过 I2C 读取 RTC，发送 SPI 数据，全部记录到串口。',
    
    'Classic blink example on Raspberry Pi Pico \u2014 GPIO25 built-in LED':
        'Raspberry Pi Pico 经典闪烁示例——GPIO25 内置 LED',
    
    'Echo serial input back with a timestamp \u2014 tests UART on RP2040':
        '带时间戳回显串口输入——测试 RP2040 UART',
    
    'Control the Pico LED via serial commands (1=ON, 0=OFF, ?=status)':
        '通过串口命令控制 Pico LED（1=开, 0=关, ?=状态）',
    
    'Scan the I2C bus on the Pico for connected devices':
        '扫描 Pico I2C 总线上的连接设备',
    
    'Read time from a virtual DS1307 RTC over I2C on Raspberry Pi Pico':
        'Raspberry Pi Pico 通过 I2C 从虚拟 DS1307 RTC 读取时间',
    
    'Read/Write virtual I2C EEPROM on Raspberry Pi Pico':
        'Raspberry Pi Pico 读写虚拟 I2C EEPROM',
    
    'Send and receive bytes over SPI on Raspberry Pi Pico':
        'Raspberry Pi Pico SPI 收发字节',
    
    'Read analog values from ADC pins on Raspberry Pi Pico':
        'Raspberry Pi Pico ADC 引脚读取模拟值',
    
    'Uses Serial + I2C + SPI together on the Raspberry Pi Pico':
        'Raspberry Pi Pico 同时使用串口 + I2C + SPI',
    
    'Blink ESP32 built-in LED (GPIO2)':
        '闪烁 ESP32 内置 LED（GPIO2）',
    
    'Echo serial on ESP32':
        'ESP32 串口回显',
    
    'ESP32 built-in LED controlled by Serial commands':
        '串口命令控制 ESP32 内置 LED',
    
    'ESP32 scans I2C bus and lists devices':
        'ESP32 I2C 总线扫描并列出设备',
    
    'ESP32 reads virtual DS1307 RTC via I2C':
        'ESP32 通过 I2C 读取虚拟 DS1307 RTC',
    
    'ESP32 reads/writes virtual I2C EEPROM':
        'ESP32 读写虚拟 I2C EEPROM',
    
    'ESP32 SPI loopback test':
        'ESP32 SPI 环回测试',
    
    'ESP32 reads analog values from ADC1 pins':
        'ESP32 ADC1 引脚读取模拟值',
    
    'ESP32 serial + I2C + SPI all together':
        'ESP32 串口 + I2C + SPI 综合演示',
    
    'Pi 3 + Arduino Uno cross-board serial \u2014 the Pi sends commands, the Uno controls an LED':
        'Pi 3 + Arduino Uno 跨板串口——Pi 发送命令，Uno 控制 LED',
    
    'Two Pico W boards talking over Serial1 (UART0) at 9600 baud. Board A sends a message every second; Board B echoes it to Serial Monitor. Cross-board UART between two RP2040 MCUs.':
        '两块 Pico W 通过 Serial1 (UART0) 以 9600 波特通信。板 A 每秒发送消息；板 B 回显到串口监视器。两个 RP2040 MCU 跨板 UART。',
    
    'Two Pico W boards perform a bidirectional digital handshake. Board A toggles GP0; Board B reads GP0 and responds on GP2, which Board A reads. Proves cross-board GPIO between two RP2040 MCUs.':
        '两块 Pico W 执行双向数字握手。板 A 翻转 GP0；板 B 读取 GP0 并在 GP2 上响应，板 A 读取。验证两个 RP2040 MCU 跨板 GPIO。',
    
    'Two Pico W boards mirror each other: Board A reads GP0 (from Board B GP0), Board B reads GP0 (from Board A GP0). Both print on Serial Monitor. Pure digital cross-board talk.':
        '两块 Pico W 互相镜像：板 A 读取 GP0（来自板 B GP0），板 B 读取 GP0（来自板 A GP0）。两者均在串口监视器打印。纯数字跨板通信。',
}

count = 0
for en, cn in reps.items():
    if en in content:
        content = content.replace(en, cn)
        count += 1

print(f'Applied {count}/{len(reps)}')
with open('D:/Workspace/velxio/frontend/src/data/examples.ts', 'w', encoding='utf-8') as f:
    f.write(content)
print('Saved.')
