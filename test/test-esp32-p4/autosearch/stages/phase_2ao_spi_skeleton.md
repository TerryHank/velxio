# Phase 2.AO — SPI master peripheral skeleton

**Estado**: ✅ done — SPI2 controller mounted at 0x500CC000 with USR-
trigger detection and JSON event emission. Self-test fires 3 events
at boot showing an ILI9341 init pattern. Foundation for SPI display
demos (ILI9341 + ST7789 + ...), SD card, and SPI ethernet (W5500).

## Goal

Add the second major peripheral category for sensor/display demos.
After Phase 2.AM (I2C) opened the door to BMP280/SHT3x/MPU6050, this
phase opens it for SPI displays — TFT (ILI9341/ST7789), e-paper, SD
cards, and SPI-attached ethernet/wifi modules. Velxio's component
library already includes ILI9341 visuals; SPI emulation makes those
demos viable.

## Lo que SE INVESTIGÓ

### 1. ESP32-P4 SPI controller addresses

Per IDF `soc/reg_base.h`:

```
DR_REG_SPI0_BASE = 0x500B8000   (flash MSPI — already used by ROM)
DR_REG_SPI1_BASE = 0x500B C000   (flash MSPI — typically not used)
DR_REG_SPI2_BASE = 0x500CC000   (general-purpose SPI ← Arduino default)
DR_REG_SPI3_BASE = 0x500D0000   (general-purpose SPI ← optional 2nd bus)
```

SPI2 is the controller `SPI.begin()` defaults to in Arduino-ESP32.
Phase 2.AO models SPI2 at 0x500CC000. SPI3 is a future copy.

### 2. SPI register layout (key offsets)

Per IDF `soc/spi_reg.h` for ESP32-P4:

| Off  | Register      | Purpose                                |
|------|---------------|----------------------------------------|
| 0x00 | CMD           | bit 24 = USR (start), 23:0 = command id |
| 0x04 | ADDR          | address phase data                     |
| 0x08 | CTRL          | bus mode (lsbfirst, dummy bits)        |
| 0x10 | USER          | phase enables (cmd, addr, mosi, miso, dummy) |
| 0x14 | USER1         | addr/dummy bit lengths                 |
| 0x18 | USER2         | command bits + 8-bit command opcode    |
| 0x1C | MS_DLEN       | master DMA total length (bits 17:0 = bits-1) |
| 0x20 | MISC          | misc CS / clock controls               |
| **0x40..0x84** | **W0..W17**   | **64-byte data buffer (read+write)** |
| 0xA0 | INT_RAW       | raw interrupt status                   |
| 0xA4 | INT_CLR       | W1TC clear                             |
| 0xA8 | INT_ENA       | interrupt enable                       |
| 0xAC | INT_ST        | latched status                         |
| 0xC0 | CLOCK         | SCK divider                            |

The "USR-mode" transaction model is core: guest writes data to
W0..W17 buffer, configures USER/USER1/USER2 + MS_DLEN, then writes
CMD with bit 24 set to fire the transaction.

### 3. The USR-trigger pattern

ESP32 SPI doesn't use a CMD-queue like I2C. Instead, the entire
transaction is described by:

1. Phase enables (USER register: `usr_command`, `usr_address`,
   `usr_mosi_data`, `usr_miso_data`, `usr_dummy`)
2. Phase widths (USER1: `addr_bitlen`, `dummy_cyclelen`)
3. Total bits (MS_DLEN: bits-1)
4. Buffer contents (W0..W17 — guest pre-fills MOSI bytes here)

When guest writes CMD with `USR=1`, the hardware kicks off the
transfer using the configured phases. We detect this exact write
pattern as "transaction start" and emit a JSON event.

### 4. Self-test sequence (ILI9341-style)

Picked a recognisable pattern from real Arduino TFT_eSPI code:

```c
SPI.transfer(0x01);    // SWRESET (8 bits)
SPI.transfer(0xCB);    // Power Control A (8 bits)
SPI.transfer16/32(...);// 5-byte payload (40 bits)
```

The 5-byte payload `0x39 0x00 0x2C 0x00 0xXX` is from the
canonical Power Control A command sequence in the ILI9341 datasheet.
We synthesize 3 events:

```json
{"event":"spi","port":2,"bits": 8,"bytes":1,"w0":         1}
{"event":"spi","port":2,"bits": 8,"bytes":1,"w0":       203}
{"event":"spi","port":2,"bits":40,"bytes":5,"w0":956312576}
```

w0 = 956312576 decimal = 0x39002C00 hex — the 4-byte view of the
5-byte payload (W1 holds the 5th byte separately on real silicon
but we don't track that in this minimal model).

### 5. Auto-clearing the USR bit

Real silicon: HW clears CMD.USR when the transfer completes.
Without this, every CMD register read would return USR=1 even if
the previous transaction ended. We emulate by clearing the bit
immediately after firing the event:

```c
v &= ~ESP32P4_SPI_CMD_USR_BIT;
memcpy(&s->storage[ESP32P4_SPI_CMD], &v, 4);
```

Guest code that polls CMD waiting for `USR=0` (typical "wait for
transfer done" loop) immediately sees done — no spurious hang.

## Lo que SÍ funcionó

10-second live test (2026-05-08):

```
=== JSON event totals ===
Total lines: 432  (was 429 in 2.AN.irq; +3 from SPI self-test)

  "event":"ledc":     99   ← unchanged
  "event":"adc":      33   ← unchanged
  "event":"timg":     28   ← unchanged
  "event":"timg_irq": 38   ← unchanged
  "event":"i2c":       8   ← unchanged
  "event":"i2c_rx":    1   ← unchanged
  "event":"spi":       3   ← NEW (self-test)
  "event":"start":     1
  "pin":              210  ← unchanged
```

Self-test events at t≈670 µs (machine init):

```json
{"t_ns":670880,"event":"spi","port":2,"bits": 8,"bytes":1,"w0":         1}
{"t_ns":672282,"event":"spi","port":2,"bits": 8,"bytes":1,"w0":       203}
{"t_ns":673033,"event":"spi","port":2,"bits":40,"bytes":5,"w0":956312576}
```

Decoded:
  - `bits=8, w0=1`   → 1-byte SWRESET command (0x01)
  - `bits=8, w0=203` → 1-byte Power Control A command (0xCB)
  - `bits=40, w0=956312576` → 5-byte payload `0x39002C00...`

Frontend can render this as a hex dump or "SPI bus tracer" view
showing the ILI9341 init handshake.

No regression: every other event count identical to Phase 2.AN.irq.

## Lo que NO funcionó / decisiones tomadas

1. **No actual SCK/MOSI/MISO bit-level simulation**: real SPI is
   bidirectional with explicit clock + data lines. We track only
   the high-level USR transactions. Frontend bus-tracer view is
   sufficient for "user can see SPI bytes flowing"; a real
   bit-level simulation would be Phase 2.AO.bitlevel.

2. **No slave responders**: scratch reads of W0..W17 return
   whatever was last written (master-loopback). For a real ILI9341
   demo we'd need synthetic responders for the few register reads
   ILI9341 supports (RDDID = chip ID register). Phase 2.AO.slave
   adds this when needed.

3. **Single SPI2 only, not SPI3**: real chip has both. Adding SPI3
   is a copy-paste like TIMG1 was. Deferred.

4. **No CPU IRQ wiring**: SPI fires INT on transaction-done. Real
   Arduino code typically polls CMD.USR; IRQ is for advanced DMA
   use. Phase 2.AO.irq adds it (likely cause 22, since 21 reserved
   for I2C IRQ).

5. **W0 only in JSON, not all 16 words**: the JSON includes only
   `w0` (first 4 bytes of the 64-byte buffer). Sufficient for the
   typical 1-4 byte SPI command + small data demos. For a full
   buffer view, frontend would need to read W0..W17 from a "buffer
   snapshot" event — not implemented this phase.

## Lessons learned

1. **USR-bit auto-clear is essential**: without it, guest polling
   loops (typical pattern for "wait for transfer done") would hang
   forever. Always emulate the HW-side completion semantics.

2. **The ILI9341 init pattern is recognisable**: anyone doing TFT
   work knows `0x01` (SWRESET) followed by `0xCB` (Power Control A)
   is "ILI9341 starting up". Choosing recognizable test patterns
   makes JSON streams self-documenting.

3. **Phase 2.AM's pattern transfers cleanly**: I2C had FIFO_DATA +
   CMD0..CMD7. SPI has W0..W17 + CMD with USR-bit. Both follow
   "buffer + trigger" architecture — same code shape works for
   both peripherals. Future SPI3, UART RX, RMT can follow.

## Implementación final

### `include/hw/ssi/esp32p4_spi.h` (new, ~75 LoC)

- Constants: base addr, IO size, register offsets, CMD.USR bit.
- `ESP32P4SpiState`: scratch storage + event log + port_num.
- `esp32p4_spi_self_test()` declaration.

### `hw/ssi/esp32p4_spi.c` (new, ~165 LoC)

- `esp32p4_spi_emit_event()`: throttled JSON emission (50 ms).
- `esp32p4_spi_fire_transaction()`: reads MS_DLEN + W0, emits event.
- `esp32p4_spi_read()`: scratch (loopback-style).
- `esp32p4_spi_write()`: scratch + USR-bit detection on CMD writes;
  auto-clears USR after firing.
- `esp32p4_spi_self_test()`: 3-transaction ILI9341 init synthesizer.
- Standard QOM realize/reset/class_init.

### `hw/ssi/meson.build`

Added `esp32p4_spi.c` under `CONFIG_RISCV_ESP32P4`.

### `hw/riscv/esp32p4.c`

- Header include.
- `ESP32P4SpiState spi2` field in machine state.
- Init block at 0x500CC000, port_num=2, calls self-test post-realize.
- Init log message updated to mention SPI2.

## Estado consolidado (post-2.AO)

| Hito                                                          | Estado |
|---------------------------------------------------------------|--------|
| Sensors via I2C (BMP280)                                       | ✅ 2.AM-slave |
| **Displays via SPI (ILI9341 init pattern visible)**           | ✅ 2.AO|
| SPI synthetic slave (ILI9341 RDDID etc.)                      | ⏳ 2.AO.slave |
| SPI CPU IRQ (cause 22)                                         | ⏳ 2.AO.irq |
| TIMG WDT                                                        | ⏳ later |
| Real PWM waveform on GPIO                                      | ⏳ later |
| UART RX path                                                    | ⏳ later |
| Real FreeRTOS port                                              | ⏳ Phase 2.V |

## 23-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.U-AB| GPIO + JSON event channel                               |
| 2.AC-AF| LEDC PWM + multi-channel rainbow                       |
| 2.AD  | ADC peripheral                                          |
| 2.AG-AI| TIMG hardware timer + DIVIDER                          |
| 2.AH  | TIMG0 → CPU IRQ                                         |
| 2.AJ-AK| Full attachInterrupt() chain                           |
| 2.AL  | Multi-source ISR (TIMG0 + GPIO)                         |
| 2.AM-slave | I2C master + BMP280 responder                      |
| 2.AN-AN.irq | TIMG1 + 3-way ISR (TIMG0+GPIO+TIMG1)              |
| **2.AO** | **SPI master skeleton (ILI9341 init events)**         |

JSON stream now carries 9 event types: `start | pin | ledc | adc |
timg | timg_irq | i2c | i2c_rx | spi`.

## Próximas direcciones

- **Phase 2.AO.slave**: synthetic ILI9341/ST7789 slave responder.
  Track W0..W17 buffer + USR transaction context to produce
  realistic MISO data on RDDID/RDDST register reads.
- **Phase 2.AO.irq**: SPI INT_RAW done-bit + CLIC cause 22 wiring.
- **Phase 2.AO.spi3**: copy SPI2 → SPI3 at 0x500D0000.
- **TIMG WDT** modelling.
- **Real PWM waveform on GPIO** via LEDC timer.
- **UART RX path** — bidirectional UART input.
- **FreeRTOS port** (Phase 2.V deferred).
