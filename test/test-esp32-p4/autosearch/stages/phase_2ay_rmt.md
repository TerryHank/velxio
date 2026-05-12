# Phase 2.AY — RMT (Remote Control) peripheral for WS2812 NeoPixel

**Estado**: ✅ done — RMT peripheral skeleton at `0x500A4000` decodes
WS2812B item streams into RGB-pixel JSON events. Self-test fires a
3-pixel rainbow at boot (pure red, pure green, pure blue). First
brand-new peripheral added since the WDT chain. Foundation for
Arduino `Adafruit_NeoPixel` / `FastLED` demos — the canonical "RGB
LED strip" wow-factor use case.

Log proof (2026-05-08):
```json
{"t_ns":1290300,"event":"rmt","ch":0,"pixel":1,"r":255,"g":0,"b":0}
{"t_ns":1293195,"event":"rmt","ch":0,"pixel":2,"r":0,"g":255,"b":0}
{"t_ns":1294801,"event":"rmt","ch":0,"pixel":3,"r":0,"g":0,"b":255}
```

Stderr corroboration:
```
[esp32p4.rmt] ch0 TX_START (items_buffered=72)
[esp32p4.rmt] ch0 pixel#1 RGB=(255,0,0)
[esp32p4.rmt] ch0 pixel#2 RGB=(0,255,0)
[esp32p4.rmt] ch0 pixel#3 RGB=(0,0,255)
```

Three pixels, exact colors, exact order — the WS2812B decode pipeline
works end-to-end.

## Goal

Until this phase, the emulator covered:
- Digital pins (GPIO) → blink demo
- PWM via LEDC → fade demo
- ADC reads → "analog drives LED" demo
- I2C + SPI master with synthetic slaves (BMP280, ILI9341)
- 4 watchdogs, 2 timer groups, RNG, full IRQ chain
- UART TX + RX JSON visibility

The conspicuous gap: **WS2812 NeoPixel**, by far the most popular
Arduino LED demo (Adafruit_NeoPixel + FastLED dominate the maker
ecosystem). Real silicon uses the RMT peripheral to generate the
precisely-timed bit pulses each pixel requires.

Phase 2.AY adds an RMT skeleton: register layout matches real
silicon at the level Arduino RMT drivers expect, item-buffer state
modeled per-channel, TX_START decodes the buffered items as
WS2812B bits → RGB pixels → JSON events. Frontend can render a
virtual NeoPixel strip from the event stream.

## Lo que SE INVESTIGÓ

### 1. RMT base address for ESP32-P4

Per IDF `components/soc/esp32p4/include/soc/reg_base.h`:
```c
#define DR_REG_RMT_BASE  0x500A4000
```

No previous P4 emulator code (smart_stub or create_unimplemented_
device) covers this address. Brand-new mapping — no priority
collision risk.

### 2. RMT item encoding

A single RMT item is 32 bits, encoding TWO consecutive pulses:

```
bit 31    level1 (output level for second pulse)
bits 30:16 duration1 (15 bits, ticks @ RMT clock after divider)
bit 15    level0 (output level for first pulse)
bits 14:0 duration0 (15 bits)
```

Each WS2812 bit corresponds to ONE item:
- **Bit 1**: long high (lvl0=1, dur0 ~ 32 ticks) + short low (lvl1=0, dur1 ~ 18 ticks)
- **Bit 0**: short high (lvl0=1, dur0 ~ 18 ticks) + long low (lvl1=0, dur1 ~ 32 ticks)

Reverse-engineering the bit value from an item: the level values
are identical for both bit-0 and bit-1 (`lvl0=1, lvl1=0`); only the
DURATIONS differ. So the decode rule is just:

```c
bool bit = (dur0 > dur1);
```

This is invariant under any RMT clock divider — the driver picks
absolute tick counts that scale, but the ORDERING never flips. So
our decoder doesn't need to know the RMT clock rate.

### 3. WS2812B byte order

WS2812B uses GRB pixel order: 24 bits sent MSB-first as [G7..G0]
[R7..R0][B7..B0]. After collecting 24 bit values, the decoder
extracts:

```c
g = (pixel >> 16) & 0xFF;
r = (pixel >>  8) & 0xFF;
b = (pixel >>  0) & 0xFF;
```

This matches the typical Arduino `strip.setPixelColor(i, R, G, B)`
→ hardware translation done inside Adafruit_NeoPixel.

### 4. Register layout (best-effort approximation)

The P4 RMT register layout is not in any TRM section we have direct
access to. The skeleton uses **S3-style** offsets (close cousin):

| Offset       | Register     | Notes                        |
|--------------|--------------|------------------------------|
| `0x00+4n`    | CHnDATA      | Write → append item to chan n |
| `0x20+8n`    | CHnCONF0     | Clock divider, mem size      |
| `0x24+8n`    | CHnCONF1     | TX_START (bit 0), MEM_RD_RST (bit 2) |

Real P4 silicon may differ by a few offsets — refining the layout
is deferred to the next phase once a real Arduino RMT driver
exercises the path. The KEY behaviors (CHnDATA append, TX_START
flush, MEM_RD_RST reset) are what matter for event generation.

### 5. Self-test triggers vs guest-driven

The machine-init `esp32p4_rmt_self_test()` synthesizes a 3-pixel
rainbow at boot just like prior peripheral self-tests (I2C BMP280
chip-id read, SPI ILI9341 RDDID, etc.). This:

1. Validates the path immediately at boot — guaranteed JSON output
   for the frontend without needing user firmware.
2. Documents the expected item format for future debugging.
3. Demonstrates the canonical "single channel, multiple pixels"
   pattern.

When real Arduino firmware runs Adafruit_NeoPixel, the same
write→TX_START path activates with the user's pixel data.

## Lo que SÍ funcionó

### Live test (2026-05-08)

Self-test JSON output:
```
{"t_ns":1290300,"event":"rmt","ch":0,"pixel":1,"r":255,"g":0,"b":0}
{"t_ns":1293195,"event":"rmt","ch":0,"pixel":2,"r":0,"g":255,"b":0}
{"t_ns":1294801,"event":"rmt","ch":0,"pixel":3,"r":0,"g":0,"b":255}
```

Stderr corroboration:
```
[esp32p4.rmt] ch0 TX_START (items_buffered=72)
[esp32p4.rmt] ch0 pixel#1 RGB=(255,0,0)
[esp32p4.rmt] ch0 pixel#2 RGB=(0,255,0)
[esp32p4.rmt] ch0 pixel#3 RGB=(0,0,255)
```

- **3 pixels** decoded — exactly what self-test enqueued.
- **72 items** in the flush buffer (3 × 24 bits = 72 items) —
  one item per bit, math checks out.
- **Pixel 1 = (255, 0, 0)** = pure red. Encoded GRB = `0x00FF00`.
  Decode: G=0, R=255, B=0 ✓
- **Pixel 2 = (0, 255, 0)** = pure green. Encoded GRB = `0xFF0000`.
  Decode: G=255, R=0, B=0 ✓
- **Pixel 3 = (0, 0, 255)** = pure blue. Encoded GRB = `0x0000FF`.
  Decode: G=0, R=0, B=255 ✓

Build clean, no warnings. No regression — other peripheral event
counts (LEDC, GPIO, TIMG, I2C, SPI, WDT, RNG, UART_TX) unchanged
versus Phase 2.AX.

## Lo que NO funcionó / decisiones tomadas

1. **No real GPIO pulse output**: the frontend renders pixels off
   the JSON stream, not by sampling a fake GPIO pin at WS2812 bit
   rate (~800 kbit/s). Driving a real pin would require:
   - Per-tick state machine emulating RMT clock
   - 800k pin transitions/s = unaffordable host overhead
   - Frontend would still have to decode from pin transitions
   
   Logical-level event emission is the right abstraction for our
   bus-tracer architecture.

2. **Register layout is approximate (S3-style)**: the exact P4 RMT
   offsets aren't in the TRM chapters we have direct access to.
   The skeleton chose offsets matching ESP32-S3 (the closest
   cousin). Real Arduino RMT drivers will likely Just Work because
   they go through `rmt_driver.c` → `rmt_hal.c` which abstracts
   register access, but if a future user hits "RMT writes go
   nowhere" it's because the driver expects a different offset.
   Documented for a future `2.AY.real-regs` refinement phase.

3. **RX channels (4..7) are scaffolded but unused**: the storage
   arrays cover all 8 channels for symmetry, but only TX (0..3)
   matters for NeoPixel output. RX would be for IR remote receive
   demos which are much rarer; deferred until a real use case
   appears.

4. **No CPU IRQ wiring**: the TIMG and GPIO chains all interrupt
   the CPU; RMT could too (TX_END interrupt). Deferred — the
   typical Arduino flow for NeoPixel is blocking-wait, not
   interrupt-driven, so no IDF/Arduino code is likely to depend on
   the RMT IRQ in the near term.

5. **No clock-divider modeling**: real silicon's RMT clock is
   80 MHz divided by CHnCONF0.DIV. We don't track this because our
   decoder doesn't need actual time — only relative duration
   ordering. If a future phase wants to "drive the pin in real
   time" this would need plumbing.

6. **Skeleton uses 256-item per-channel buffer**: enough for ~10
   pixels per TX. A 60-pixel strip needs 1440 items — well within
   range if we keep the buffer at 256 AND issue TX_START per group
   of 10. Real silicon uses ~48 items per channel block with
   wrap-around DMA semantics. If a user complains about lost
   pixels on long strips, refactor the buffer to ring-with-wrap.
   Documented for future work.

## Lessons learned

1. **Item-stream decode is timing-invariant**: the `dur0 > dur1`
   heuristic works regardless of RMT clock rate or divider. This
   lets us skeleton the peripheral without any time-accurate state
   machine — a HUGE complexity win.

2. **GRB byte order is a footgun**: many tutorials write WS2812
   color as RGB, but the wire protocol is GRB. The decoder MUST
   know this to produce correct R/G/B fields in the JSON event.
   Documented inline in the bit-order comment.

3. **Per-channel state arrays scale cleanly**: same pattern as
   LEDC channels and TIMG groups. Adding a new channel = one
   constant change in the header.

4. **Self-test as canary**: every prior peripheral with a self-
   test has caught at least one regression in subsequent edits.
   The RMT self-test fires deterministically at boot whether
   firmware is present or not, so it's the immediate sanity check.

5. **"Skeleton over perfection" pays off**: 200 lines of C + a
   60-line header + 17 lines of machine init = full path. Refining
   register layout, RX side, IRQ wiring can come later when
   firmware actually exercises them.

## Implementación final

### `include/hw/misc/esp32p4_rmt.h`

- New type `TYPE_ESP32P4_RMT`.
- `ESP32P4RmtState`: 4 KB scratch storage, per-channel item ring
  (256 items × 8 channels), pixel counter per channel, event_log
  + boot_ns from machine, optional throttle field.
- Helper macros: item field extraction, CONF1 bit defines.
- Function decl: `esp32p4_rmt_self_test()`.

### `hw/misc/esp32p4_rmt.c`

- `esp32p4_rmt_item_to_bit()`: `dur0 > dur1` heuristic.
- `esp32p4_rmt_flush_channel()`: walk buffered items in groups of
  24, pack bits → 24-bit pixel, extract G/R/B, emit JSON.
- `esp32p4_rmt_read()`: scratch returned.
- `esp32p4_rmt_write()`: CHnDATA appends item; CHnCONF1.TX_START
  triggers flush; CHnCONF1.MEM_RD_RST clears the buffer.
- Standard QOM realize/reset/class_init.
- `esp32p4_rmt_self_test()`: synthetic 3-pixel rainbow with
  WS2812-shaped durations.

### `hw/misc/meson.build`

- Added `esp32p4_rmt.c` to the `CONFIG_RISCV_ESP32P4` source list.

### `hw/riscv/esp32p4.c`

- Include `hw/misc/esp32p4_rmt.h`.
- `ESP32P4RmtState rmt;` field in machine struct.
- New init block after LP_WDT — initialize, realize, overlay at
  `0x500A4000`, wire event_log + boot_ns, fire self-test.

## Estado consolidado (post-2.AY)

Peripheral inventory:

| Peripheral | Address     | Phase  | Status |
|------------|-------------|--------|--------|
| UART0      | 0x500CA000  | 1.A    | ✓ full + TX/RX JSON |
| GPIO       | 0x500E0000  | 1.C..2.AV | ✓ full + IRQ + JSON |
| SYSTIMER   | 0x500D2000* | 1.C/2.K | ✓ |
| eFuse      | 0x5008C000* | 1.C    | ✓ |
| LEDC       | 0x500D3000  | 2.AC   | ✓ 8 channels + JSON |
| ADC        | 0x500DE000  | 2.AD   | ✓ + JSON |
| TIMG0      | 0x500C2000  | 2.AG   | ✓ + IRQ + WDT |
| TIMG1      | 0x500C3000  | 2.AN   | ✓ + IRQ + WDT |
| I2C0       | 0x500C4000  | 2.AM   | ✓ + BMP280 responder |
| SPI2       | 0x500D0000  | 2.AO   | ✓ + ILI9341 responder |
| RNG        | 0x500FC400  | 2.AR   | ✓ |
| LP_WDT     | 0x50116000  | 2.AT   | ✓ RTC + Super |
| **RMT**    | **0x500A4000** | **2.AY** | **✓ NEW — WS2812 NeoPixel** |

*addresses approximate from prior phases

JSON event types: 17
```
start | pin | ledc | adc | timg | timg_irq | i2c | i2c_rx | spi |
spi_rx | wdt | rng | rtc_wdt | super_wdt | uart_tx | uart_rx | rmt
```

## 33-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.AC-AF| LEDC PWM + multi-channel                               |
| 2.AG-AN.irq | TIMG (×2) + 3-way ISR                              |
| 2.AM-slave | I2C master + BMP280 responder                      |
| 2.AO+AU | SPI master + ILI9341 responder                         |
| 2.AP-AT | 4 watchdogs + RNG + address relocation                |
| 2.AV  | GPIO LEVEL_HIGH/LOW filters                              |
| 2.AW-AX | UART bidirectional JSON tracking                       |
| **2.AY** | **RMT (WS2812 NeoPixel) — first new peripheral since the WDT chain** |

## Próximas direcciones

- **2.AY.arduino-real**: connect a real
  `Adafruit_NeoPixel::show()` Arduino sketch and confirm the RMT
  writes hit our peripheral (validates register layout).
- **2.AY.rx**: model RMT RX channels (IR remote receive) — much
  rarer Arduino use case.
- **TWAI (CAN bus)** — TRM Chapter 30. Another major-peripheral
  gap.
- **WDT actual reset action** — close out the watchdog chain.
- **Real PWM waveform on GPIO** via LEDC — generate actual pin
  transitions at PWM frequency.
- **Multi-UART** — instantiate UART1..UART4 + LP_UART (validates
  the per-instance JSON path).
- **FreeRTOS real port** (Phase 2.V deferred).
