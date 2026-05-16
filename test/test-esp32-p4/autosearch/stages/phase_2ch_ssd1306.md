# Phase 2.CH — SSD1306 OLED I2C display (write-only device)

**Estado**: ✅ done — first write-only device in the I2C
inventory, extending the dispatcher's shape to handle devices
without a readback path. **30th JSON event type** (`ssd1306`).

Live verification (2026-05-16) — SSD1306 self-test boot trace:

```json
"event":"ssd1306","port":0,"kind":"cmd","byte":174  ← 0xAE DISP_OFF
"event":"ssd1306","port":0,"kind":"cmd","byte":213  ← 0xD5 CLK_DIV
"event":"ssd1306","port":0,"kind":"cmd","byte":128  ← 0x80  divider arg
"event":"ssd1306","port":0,"kind":"cmd","byte":168  ← 0xA8 MUX_RATIO
"event":"ssd1306","port":0,"kind":"cmd","byte":63   ← 0x3F  64-1 rows
"event":"ssd1306","port":0,"kind":"cmd","byte":175  ← 0xAF DISP_ON
"event":"ssd1306","port":0,"kind":"data","byte":255 ← 0xFF 8 pixels on
"event":"ssd1306","port":0,"kind":"data","byte":129 ← 0x81 top+bottom
"event":"ssd1306","port":0,"kind":"data","byte":66  ← 0x42 pattern
"event":"ssd1306","port":0,"kind":"data","byte":24  ← 0x18 middle
```

6 cmd bytes (canonical Adafruit init prelude) + 4 data bytes
(pixel patterns). The frontend can render the 128×64 framebuffer
by accumulating `kind:"data"` bytes; `kind:"cmd"` bytes drive
cursor position, display on/off, etc.

## Goal

Adafruit / Heltec / Wemos OLED breakouts ship with SSD1306
controllers driving 128×64 (or 128×32) monochrome displays.
The Adafruit_SSD1306 library is one of the most popular Arduino
libraries — adding it to the emulator unlocks display-content
sketches for the frontend.

SSD1306 differs from all prior I2C responders in one structural
way: it's **write-only**. The Arduino library does not read back
display state — there's no register space to query, no chip-id
to verify (the I2C ACK alone is detection). So the existing
`responder_read` dispatcher path never fires for SSD1306. The
write-only path needs its own hook.

## Lo que SE INVESTIGÓ

### 1. SSD1306 transaction shape

Per Solomon Systech SSD1306 datasheet § 10.1.1 (I2C interface)
+ Adafruit_SSD1306 driver:

```
slave+W byte (0x78 = 0x3C<<1, or 0x7A = 0x3D<<1)
  ↓
control byte
  - 0x00: stream of commands (DISP_OFF, MUX_RATIO, ...)
  - 0x40: stream of data (pixel bytes)
  - Co/D% bits 7:6:    0b00=0x00, 0b01=0x40 (also 0x80/0xC0 for
                       "next byte is last command" variants;
                       Adafruit always uses 0x00/0x40)
  ↓
1..N command or data bytes
  ↓
STOP
```

Each pixel data byte represents **8 vertical pixels** in the
current page (8 horizontal rows). Page cursor + column cursor
are advanced by the cmd stream (SET_COLUMN_ADDR=0x21,
SET_PAGE_ADDR=0x22).

### 2. Where to hook the dispatcher

Two natural hook points:

**Option A** — extend `responder_read` to return 0x00 for
write-only devices, and add a separate `responder_write` hook
called from FIFO_DATA write. Symmetric but adds a new function
signature.

**Option B** — hook directly into FIFO_DATA write (where
tx_history is already tracked) and detect SSD1306 transactions
by slave-byte pattern. Reuses existing infrastructure.

Chose Option B. The FIFO_DATA write handler already rolls
tx_history and emits a generic `i2c` event per byte. Adding
SSD1306 tracking is ~20 LOC of state machine: detect
slave-byte → latch control byte → emit `ssd1306` events for
subsequent bytes → reset on STOP.

### 3. State machine

Two new fields on `ESP32P4I2cState`:
- `ssd1306_in_tx` (bool) — true between slave+W and STOP.
- `ssd1306_control` (uint8_t) — 0xFF awaiting control byte,
  0x00 cmd mode, 0x40 data mode.

State transitions:
| Event | Action |
|-------|--------|
| FIFO_DATA write byte = 0x78 or 0x7A | `in_tx=true`, `control=0xFF` |
| FIFO_DATA write while `in_tx && control==0xFF` | latch control = (byte & 0x40) ? 0x40 : 0x00 |
| FIFO_DATA write while `in_tx && control set` | emit `ssd1306` JSON event with kind+byte |
| CMD STOP | `in_tx=false`, `control=0xFF` |

Co/D% bit collapse: real SSD1306 distinguishes 0x80 (next byte
is the *last* command) from 0x00 (stream of commands). Adafruit
never uses 0x80, and the difference is semantically irrelevant
to "is this a cmd or a data byte". We collapse on bit 6
(D% bit) which is the actual cmd/data discriminator.

### 4. JSON event shape

New event type:
```json
{"event":"ssd1306","port":N,"kind":"cmd"|"data","byte":B}
```

Frontend can:
1. Accumulate `data` bytes into a 1-byte-per-column array,
   placing them at the current cursor.
2. Interpret `cmd` bytes to update display_on / cursor / mux /
   etc. (Adafruit's 13-cmd init sequence + 4 runtime cmds
   covers ~95% of usage.)

### 5. STOP-triggered state reset

The existing CMD STOP handler resets `tx_history`. Extended it
to also reset `ssd1306_in_tx` and `ssd1306_control`. This is
critical: without the reset, a subsequent non-SSD1306
transaction (e.g., BMP280 chip-id read) could partially trigger
the SSD1306 state machine if a byte happens to be 0x78/0x7A.

### 6. Self-test pattern

Two back-to-back transactions:
1. Cmd stream: 0x78 → 0x00 → 0xAE 0xD5 0x80 0xA8 0x3F 0xAF →
   STOP (5 commands).
2. Data stream: 0x78 → 0x40 → 0xFF 0x81 0x42 0x18 → STOP
   (4 pixel bytes).

Result: 6 + 4 = 10 `ssd1306` events at boot. Cmd bytes match
the Adafruit init prelude; data bytes are illustrative
patterns (0xFF = full column on, 0x81 = top+bottom pixels,
0x42 = pattern, 0x18 = middle band).

## Lo que SÍ funcionó

1. ✅ Build clean.
2. ✅ 10 ssd1306 events at boot:
   - 6 cmd bytes (0xAE/0xD5/0x80/0xA8/0x3F/0xAF — Adafruit init)
   - 4 data bytes (0xFF/0x81/0x42/0x18 — pixel patterns)
3. ✅ Cmd vs data discrimination works (control byte 0x00 → cmd,
   0x40 → data).
4. ✅ STOP correctly resets state between the two test
   transactions.
5. ✅ Other sensors unaffected — 20 i2c_rx events still emitted
   from the 7 I2C responders.
6. ✅ New JSON event type `ssd1306` joins the stream — **30
   defined event types** total (29 from prior phases +
   ssd1306).

## Lo que NO funcionó / decisiones tomadas

### Decisiones tomadas

1. **Hook in FIFO_DATA write, not responder_read**: SSD1306 is
   write-only, so the existing read-dispatcher hook never
   fires. Adding the tracking in the write path (where
   tx_history already lives) was natural.

2. **Generic ssd1306 event, not per-command parsed events**:
   the frontend interprets cmd bytes itself (e.g., 0xAE =
   display off). Centralizing the parser in the emulator
   would freeze the cmd semantics; a frontend-side decoder
   stays flexible.

3. **No cursor tracking in the emulator**: column + page
   cursors are set by `SET_COLUMN_ADDR` (0x21) and
   `SET_PAGE_ADDR` (0x22) commands. The emulator doesn't track
   them — the frontend rebuilds cursor state from the cmd
   stream. Keeps the emulator simple and stateless wrt the
   pixel buffer.

4. **Co/D% bit collapse to 0x00/0x40**: real datasheet
   distinguishes 4 control byte variants; we collapse to 2.
   Adafruit and U8g2 libraries both use only 0x00/0x40.

5. **Slave-byte detection in FIFO_DATA, not in CMD WRITE**:
   the CMD register tells us "WRITE N bytes" but not which
   slave they're going to. The FIFO_DATA tx_history roll
   already captures the slave byte as the first write in a
   transaction, so we detect there.

## Lessons learned

1. **The dispatcher's bidirectional shape was easy to extend
   one-way** — adding write-only support didn't require any
   `responder_read` changes. The two paths (read = responder
   dispatch by slave addr; write = FIFO_DATA tracker) coexist
   cleanly.

2. **Frontend-friendly event design beats emulator-side
   parsing** — emitting raw bytes with a cmd/data tag is more
   flexible than parsing 0xAE → `"event":"display_off"`.
   Frontend rendering logic can evolve without emulator
   changes.

3. **State machine fits in 2 fields** — `in_tx` (bool) and
   `control` (uint8_t) cover the entire SSD1306 transaction
   tracking. Total state cost = 2 bytes per I2C controller.

4. **Multi-transaction self-test exercises STOP correctly**.
   The two-transaction structure (cmd stream + data stream
   separated by STOP) confirms the state reset on STOP works
   — without it, the second transaction would emit
   `kind:"cmd"` events instead of `kind:"data"`.

## Implementación final

### `include/hw/i2c/esp32p4_i2c.h`

- New `ssd1306_in_tx` (bool) + `ssd1306_control` (uint8_t)
  fields on `ESP32P4I2cState`.
- New forward-declaration `esp32p4_i2c_ssd1306_self_test()`.

### `hw/i2c/esp32p4_i2c.c`

- FIFO_DATA write handler extended: detect slave bytes
  0x78/0x7A → enter SSD1306 state; latch control byte
  on first post-slave write; emit `ssd1306` event for
  subsequent bytes.
- CMD STOP handler extended: reset `ssd1306_in_tx` +
  `ssd1306_control` alongside the existing `tx_history`
  reset.
- Device `reset()` initializes `ssd1306_in_tx=false` and
  `ssd1306_control=0xFF`.
- New `esp32p4_i2c_ssd1306_self_test()`: fires the
  Adafruit init prelude + 4-byte pixel data stream.

### `hw/riscv/esp32p4.c`

- New `esp32p4_i2c_ssd1306_self_test(&ms->i2c0)` call after
  the CCS811 self-test in the I2C0 init block.

## Estado consolidado (post-2.CH)

I2C device inventory — **8 devices, 10 strap-variant cases**:

| Address | Device | Direction | Phase | Notes |
|---------|--------|-----------|-------|-------|
| 0x76/77 | BMP280 (pressure/temp) | R | 2.AM | register space |
| 0x68/69 | MPU-6050 (IMU) | R | 2.BD | register space |
| 0x1E | HMC5883L (magnetometer) | R | 2.BE | register space |
| 0x29 | VL53L0X (ToF) | R | 2.BE | register space |
| 0x23/5C | BH1750 (light) | R | 2.CE | register-less, 2-byte |
| 0x44/45 | SHT31 (humidity+temp) | R | 2.CF | 6-byte with CRC-8 |
| 0x5A/5B | CCS811 (air quality) | R | 2.CG | 8-byte register read |
| **0x3C/3D** | **SSD1306 (OLED display)** | **W** | **2.CH** | **write-only, cmd+data** |

10 strap-variant cases in the dispatcher switch. Adding the 9th
device would push to 11-12 cases — refactor to address-keyed
table is warranted before the next addition.

JSON event types: **30** (chip_info from 2.CB + ssd1306 from 2.CH
on top of the 28 from prior phases).

## 70-Phase realism progression

| Phase | Capability                                                |
|-------|-----------------------------------------------------------|
| 2.CE  | BH1750 ambient light (first register-less sensor)         |
| 2.CF  | SHT31 humidity+temp (first with CRC-8)                    |
| 2.CG  | CCS811 air-quality (8-byte sequential read)               |
| **2.CH** | **SSD1306 OLED (first write-only device + 30th event type)** |

## Próximas direcciones

- **Refactor I2C dispatcher to address-keyed table** — 10+
  cases now warrants this. Reduces add-a-sensor cost to ~10
  LOC + 1 row.
- **BME680** environmental sensor (T+H+P+Gas with calibration).
- **MS5611** barometer (24-bit ADC + 8-reg PROM).
- **W5500 Ethernet** + **MFRC522 RFID** SPI responders.
- **Extend SD responder** for CMD17/24 block read/write.
- **KEY_PURPOSE** eFuse field.
- **UART IRQ** (QOM class-override) — needs extended CLIC
  since cause 31 is taken.
- **Real PWM** waveform via LEDC.
- **FreeRTOS** scheduler resurrection.
- **OLED text rendering** in frontend — Adafruit's `display()`
  flushes the framebuffer in 1024-byte chunks; tracking
  cursor + accumulating data bytes gives the frontend the
  full image.
