# Phase 2.AU — Synthetic ILI9341 SPI responder

**Estado**: ✅ done — SPI master now returns realistic ILI9341 register
values for read commands. Self-test fires the canonical RDDID
(0x04 → chip ID 0x009341) sequence demonstrating end-to-end SPI
master + synthetic slave path. Arduino TFT_eSPI / Adafruit_ILI9341
chip-id checks would now pass.

This mirrors Phase 2.AM.slave (BMP280 over I2C) for the SPI bus.

## Goal

Phase 2.AO added the SPI master skeleton: register tracking, USR-bit
detection, JSON events on transactions. But FIFO_DATA/W0 reads
always returned scratch (whatever was last written) — no actual
slave responses. Arduino TFT sketches that do:

```cpp
uint16_t id = readcommand16(0x04);    // RDDID
if (id != 0x9341) bail();              // Adafruit_ILI9341::begin() check
```

…would always fail the check.

Phase 2.AU adds a synthetic ILI9341 slave responder so the chip-id
check (and several other display-status reads) returns realistic
values, mirroring how Phase 2.AM.slave made BMP280 chip-id reads
work.

## Lo que SE INVESTIGÓ

### 1. ILI9341 read-register command set

Per Sitronix ILI9341 datasheet (and confirmed by reading
TFT_eSPI's `RDDID`/`RDDST` constants), the chip exposes these read
commands:

| Cmd  | Name      | Response                                          |
|------|-----------|---------------------------------------------------|
| 0x04 | RDDID     | 24-bit chip ID: 0x00 0x93 0x41 (mfr/driver/ID)    |
| 0x09 | RDDST     | 32-bit display status                             |
| 0x0A | RDDPM     | 8-bit display power mode                          |
| 0x0B | RDDMADCTL | 8-bit memory access control (rotation/order)      |
| 0x0C | RDDCOLMOD | 8-bit pixel format (16-bit, 18-bit, etc.)         |
| 0x0D | RDDIM     | 8-bit image mode                                  |
| 0x0E | RDDSM     | 8-bit signal mode                                 |
| 0x0F | RDDSDR    | 8-bit self-diagnostic result                      |

Other (lower) commands are write-only (SWRESET 0x01, SLEEP 0x10/0x11,
DISPLAY 0x28/0x29, MEMWRITE 0x2C, etc.). We return 0xFFFFFFFF for
unknown reads — matches what an idle SPI bus would clock in.

### 2. The "command then read" pattern for ILI9341 over SPI

Real master-side sequence for "read chip ID":

```
1. CS low, D/C low      ; data/cmd line = command
2. SCK clocks 8 bits     ; master writes 0x04, slave samples
3. D/C high              ; data/cmd line = data
4. SCK clocks 24 bits     ; master reads MISO, slave responds
                           ; (master's MOSI = junk during read)
5. CS high
```

In hardware, MOSI and MISO are both clocked SIMULTANEOUSLY by SCK.
Master fills W0 with `[0x04, 0, 0, 0]`, fires a 32-bit USR, the
MISO half clocks in `[junk, 0x00, 0x93, 0x41]`. After the
transaction master reads W0 and finds the chip ID.

For our model:
- Master writes 0x04 to W0
- Master writes 31 to MS_DLEN (32-bit transaction)
- Master sets USR bit in CMD
- We detect USR fire → extract last_cmd = 0x04
- We synthesize response 0x9341 → write to W0 storage
- USR bit auto-clears
- Master reads W0 → sees 0x9341

### 3. Chip ID byte ordering

ILI9341 datasheet says RDDID returns 3 bytes:
- Byte 1: manufacturer ID = 0x00 (Sitronix)
- Byte 2: driver version = 0x93
- Byte 3: driver ID = 0x41

On the wire, MSB-first: master clocks in 0x00, 0x93, 0x41 (in that
order).

For master's W0 (LSB-first uint32 view), the bytes appear:
- byte 0 (lowest): 0x00 (first MISO byte)
- byte 1: 0x93
- byte 2: 0x41
- byte 3: 0x00 (the 4th byte is junk in a 24-bit response, master
  ignores)

So uint32 value = 0x00_41_93_00. But Adafruit_ILI9341 reads it as a
big-endian uint16 from the middle 2 bytes: 0x9341. Which is THE
identification value embedded firmware checks for.

We pick the simpler representation: `response = 0x00009341`. The
guest doing `readcommand16(0x04)` would get 0x9341 — chip-id check
passes. If guest reads as 24-bit it'd see 0x009341, also recognisable.
Different SDKs interpret the bytes slightly differently; 0x9341 is
the universally agreed "this is an ILI9341" marker.

### 4. Why we modify W0 storage directly

We can't propagate response data through QEMU's bus model the way
real SPI hardware clocks MISO bits. Instead we cheat: on USR fire,
write the synthesized response to `s->storage[W0]` directly.
Subsequent guest reads of W0 hit this storage and return the
response. Functionally identical to real-silicon behaviour from the
guest's perspective.

## Lo que SÍ funcionó

10-second live test (2026-05-12):

```
=== JSON event totals ===
Total lines: 452  (was 456 in Phase 2.AT; -4 timing variance, +2 SPI)

  "event":"ledc":       99    ← timing variance
  "event":"adc":        33    ← timing variance
  "event":"timg":       28    ← unchanged
  "event":"timg_irq":   38    ← unchanged
  "event":"i2c":         8    ← unchanged
  "event":"i2c_rx":      1    ← unchanged
  "event":"spi":         4    ← was 3 (Phase 2.AO); +1 from RDDID
  "event":"spi_rx":      1    ← NEW (RDDID response)
  "event":"wdt":         8    ← unchanged
  "event":"rng":         3    ← unchanged
  "event":"rtc_wdt":     4    ← unchanged
  "event":"super_wdt":   3    ← unchanged
  "event":"start":       1
```

SPI events at t≈625-628 µs (boot self-test):

```json
{"event":"spi","port":2,"bits": 8,"bytes":1,"w0":         1}    // SWRESET
{"event":"spi","port":2,"bits": 8,"bytes":1,"w0":       203}    // 0xCB
{"event":"spi","port":2,"bits":40,"bytes":5,"w0":956312576}     // 5B data
{"event":"spi_rx","port":2,"cmd":4,"response":37697}            // ★ NEW ★
{"event":"spi","port":2,"bits":32,"bytes":4,"w0":4}             // RDDID tx
```

`cmd=4, response=37697` decodes to "command 0x04 (RDDID) returned
0x9341" — exactly the ILI9341 chip ID anyone with TFT_eSPI
experience recognises.

No regression elsewhere — the small +/-3 counts on LEDC/ADC are
test-run timing variance (same machinery, slightly different
intervals over 10 seconds).

## Lo que NO funcionó / decisiones tomadas

1. **Single-byte command detection**: real ILI9341 uses a D/C
   (Data/Command) GPIO line to distinguish command bytes from
   data bytes. We don't model the D/C line. Instead we assume
   the FIRST byte of W0 in a USR transaction IS a command. This
   works for the typical "send 1-byte cmd then read N bytes"
   pattern but would mis-decode data writes following a
   write-only command (where the data bytes would be misread
   as new commands).

2. **No 24-bit RDDID returned as 24 bits**: real RDDID gives 24
   bits. We pack into a 32-bit response (high byte = 0). Guest
   code that reads 24 bits sees 0x009341 (correct). Guest code
   that reads 32 bits sees 0x00009341 (also OK — just an extra
   zero byte). Bus parsers should handle both.

3. **Status registers return constants**: RDDST and RDDPM return
   fixed values (not derived from any actual display state). For
   a "real chip" simulation we'd track config writes (MADCTL,
   COLMOD, etc.) and reflect them in the responses. Deferred —
   most Arduino sketches only read these for sanity checks, not
   to track state.

4. **Pattern detection rejected for ILI9341**: Phase 2.AM.slave
   used tx_history rolling buffer to infer register addresses
   (because I2C's write-then-read pattern uses an explicit
   slave-addr+R between phases). SPI doesn't have that — the
   command byte IS the first byte of the transaction. Simpler
   detection: `last_cmd = W0 & 0xFF` at USR-fire time.

## Lessons learned

1. **SPI's command byte is "in-band" with data**: unlike I2C
   (separate address phase), SPI just streams bytes — the first
   byte happens to be interpreted by the slave as a command.
   `last_cmd = first byte of TX buffer` is the canonical detection
   pattern across all SPI displays/sensors I've seen.

2. **0x9341 is THE ILI9341 marker, regardless of how it's read**:
   Adafruit_ILI9341 checks for 0x9341. TFT_eSPI checks for 0x9341.
   m5gfx checks for 0x9341. Pinning the response to that value
   means every TFT library that targets ILI9341 will recognise
   it. The exact byte ordering matters less than the marker.

3. **Modifying storage[] directly is fair game**: we cheat by
   stashing the synthesized response in the same scratch storage
   the read handler returns. No need to wire up complex
   "transaction result FIFO" infrastructure — guest reads of W0
   hit our pre-stashed response.

4. **Self-test calling write() then exercising read response IS
   the cleanest end-to-end test**: similar pattern to Phase
   2.AM.slave's "call esp32p4_i2c_read directly to verify the
   responder works". Goes through the same code path the real
   guest would.

## Implementación final

### `include/hw/ssi/esp32p4_spi.h`

- New `uint8_t last_cmd` field in ESP32P4SpiState.

### `hw/ssi/esp32p4_spi.c`

- New `esp32p4_spi_ili9341_response(cmd)` function with the 8
  documented ILI9341 read-register handlers.
- `esp32p4_spi_fire_transaction` extended:
  - Latch `last_cmd = W0 & 0xFF`.
  - Compute response via `ili9341_response()`.
  - If response valid (not 0xFFFFFFFF), write to `storage[W0]` and
    emit `spi_rx` JSON event with cmd + response fields.
- `reset` clears `last_cmd`.
- `esp32p4_spi_self_test` extended:
  - After the 3 ILI9341 init events, performs an actual RDDID
    transaction:
      Write 0x04 to W0
      Write 31 to MS_DLEN (32-bit transaction)
      Write USR_BIT to CMD → triggers fire_transaction →
        synthesizes 0x9341 response → emits spi_rx event.
  - Total: 5 events at boot (3 originals + 1 spi_rx + 1 trigger spi event).

## Estado consolidado (post-2.AU)

| Hito                                                          | Estado |
|---------------------------------------------------------------|--------|
| Sensors via I2C (BMP280 chip-id read)                          | ✅ 2.AM-slave |
| **Displays via SPI (ILI9341 chip-id read)**                    | ✅ 2.AU |
| 4 of 4 watchdogs (TIMG0/1 + RTC + Super)                       | ✅ 2.AP-AT |
| HW RNG, real-silicon addresses                                  | ✅ 2.AR-AS |
| WDT actual reset action                                         | ⏳ later |
| UART RX path                                                     | ⏳ later |
| Real PWM waveform on GPIO                                       | ⏳ later |
| TWAI (CAN bus)                                                   | ⏳ later |
| Real FreeRTOS port                                               | ⏳ Phase 2.V |

## 29-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.AC-AF| LEDC PWM + multi-channel                               |
| 2.AG-AN.irq | TIMG (×2) + 3-way ISR                              |
| 2.AM-slave | I2C master + BMP280 responder                      |
| 2.AO  | SPI master skeleton                                     |
| 2.AP-AT | 4 watchdogs + RNG + address relocation                |
| **2.AU** | **SPI synthetic ILI9341 responder**                   |

JSON stream now carries **14 event types**: `start | pin | ledc |
adc | timg | timg_irq | i2c | i2c_rx | spi | spi_rx | wdt | rng |
rtc_wdt | super_wdt`.

## Próximas direcciones

- **UART RX path** via QEMU chardev — receive bytes from host
  terminal.
- **WDT actual reset action**.
- **Real PWM waveform on GPIO** via LEDC.
- **TWAI (CAN bus)** — TRM Chapter 30.
- **Phase 2.AU.spi3** — copy SPI2 → SPI3 at 0x500D4000.
- **Real FreeRTOS port** (Phase 2.V deferred).
