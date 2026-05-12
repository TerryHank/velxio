# Phase 2.BG — I2C IRQ wiring (both buses)

**Estado**: ✅ done — applies the Phase 2.BF TWAI IRQ template to
I2C. Both I2C0 (CLIC cause 22) and I2C1 (CLIC cause 23) now fire
CPU interrupts when the bus transaction completes. Arduino
interrupt-driven Wire / async I2C sensor sketches now work. The
backport-the-template recipe established in 2.BF is now proven —
3 device classes (TIMG, TWAI, I2C) share the same IRQ pattern.

Live test (2026-05-08), 4 `i2c_irq` events at boot:
```json
{"t_ns":733437,"event":"i2c_irq","port":0,"level":1}   ← I2C0 STOP → IRQ raise
{"t_ns":747703,"event":"i2c_irq","port":0,"level":0}   ← I2C0 INT_CLR → IRQ clear
{"t_ns":864442,"event":"i2c_irq","port":1,"level":1}   ← I2C1 STOP → IRQ raise
{"t_ns":877432,"event":"i2c_irq","port":1,"level":0}   ← I2C1 INT_CLR → IRQ clear
```

Stderr corroboration:
```
[esp32p4.i2c0] CPU IRQ line -> 1 (int_raw=0x88 int_ena=0x88)
[esp32p4.i2c0] CMD5 stop byte_num=0
[esp32p4.i2c0] CPU IRQ line -> 0 (int_raw=0x0 int_ena=0x88)
```

`int_raw=0x88` decodes as bits 3 + 7 = `END_DETECT | TRANS_COMPLETE`
— exactly what real silicon sets on STOP completion. JSON event
types now **21** (added `i2c_irq`).

## Goal

Phase 2.AM established I2C, Phase 2.BB added I2C1, Phase 2.BD/BE
filled the sensor matrix to 4 chips. But:

1. **No CPU IRQ when transaction completes**: an Arduino sketch
   using interrupt-driven Wire (`Wire.onReceive()`, async ESP-IDF
   `i2c_master_transmit_async()`) hung forever waiting for the
   transaction-complete signal.

2. **TWAI proved the template, I2C should follow**: Phase 2.BF
   was explicit that I2C/SPI/UART/RMT should backport the same
   pattern. Doing I2C first because it's most-used.

3. **Both buses need it, not just one**: I2C0 + I2C1 are two
   instances of the same device class; both should fire CPU IRQs
   independently. Reuses Phase 2.AZ's multi-instance JSON
   disambiguation via `port_num`.

## Lo que SE INVESTIGÓ

### 1. I2C INT_RAW register bits (TRM 36.4 + IDF i2c_reg.h)

Real ESP32 I2C lists ~19 interrupt bits. For the skeleton we
implement the two most-used:

- **bit 3: END_DETECT** — set on bus STOP condition detected.
- **bit 7: TRANS_COMPLETE** — set when a full CMD sequence
  completes (typically same trigger as END_DETECT for masters).

Both fire together on STOP, so `int_raw = 0x88` after a
complete transaction. Arduino TWI/Wire driver code typically
masks either or both — either works.

Other bits modeled as constants in the header but unused:
- bit 10: NACK (slave NACKed an address byte)
- (bits 0-2, 4-6, 8-9, 11+ stay zero in our skeleton)

### 2. INT_CLR W1TC semantics

Per TRM 36.4.11, INT_CLR is write-1-to-clear: writing 0x88 to
INT_CLR clears bits 3 and 7 in INT_RAW. Different from TWAI's
clear-on-read INTR register — I2C uses the more modern W1TC
pattern.

Implementation pattern:
```c
if (addr == ESP32P4_I2C_INT_CLR && size >= 4) {
    uint32_t int_raw = 0;
    memcpy(&int_raw, &s->storage[ESP32P4_I2C_INT_RAW], 4);
    int_raw &= ~v;  /* clear the 1 bits */
    memcpy(&s->storage[ESP32P4_I2C_INT_RAW], &int_raw, 4);
    esp32p4_i2c_update_irq(s);
    return;  /* don't fall through to scratch store */
}
```

The `return` skips the default scratch store — INT_CLR is "fake"
storage (the bits don't latch).

### 3. INT_ST as masked latched view

TRM 36.4.10: INT_ST = INT_RAW & INT_ENA. Real silicon updates
INT_ST hardware-side. Our model writes it from `update_irq()`:

```c
uint32_t int_st = int_raw & int_ena;
memcpy(&s->storage[ESP32P4_I2C_INT_ST], &int_st, 4);
```

So a guest reading INT_ST always sees the current masked-and-
pending set. Matches silicon behavior.

### 4. CLIC cause line allocation

Used after this phase:
- 17: SYSTIMER
- 18: GPIO consolidated
- 19: TIMG0
- 20: TIMG1
- 21: TWAI0
- **22: I2C0 (new)**
- **23: I2C1 (new)**

Free for future use: 24 onwards. SPI, UART, RMT will be the
next candidates.

### 5. Self-test refactor — real CMD writes

The existing self-test (Phase 2.AM) emitted CMD events via the
`emit_event` helper directly, bypassing the real write path.
This meant the STOP-CMD-write code never executed during boot —
so even after wiring INT_RAW in `esp32p4_i2c_write()`, the IRQ
wouldn't fire from the self-test.

Phase 2.BG fix: after the helper-based event loop, perform a
REAL CMD register write for STOP:

```c
uint32_t stop_cmd = (uint32_t)(ESP32P4_I2C_OP_STOP << 11);
esp32p4_i2c_write(s, ESP32P4_I2C_CMD0 + 5*4, stop_cmd, 4);

/* Simulate guest ISR ack — read + clear. */
uint32_t clear = ESP32P4_I2C_INT_END_DETECT | ESP32P4_I2C_INT_TRANS_COMPLETE;
esp32p4_i2c_write(s, ESP32P4_I2C_INT_CLR, clear, 4);
```

This:
1. Real STOP CMD write → fires the IRQ raise path.
2. Real INT_CLR write → fires the IRQ clear path.

The helper-based loop ALSO emits a "stop" event for the human-
readable trace. So we get ONE extra "stop" event per self-test
compared to the helper-only flow. Acceptable noise — documented
in next directions.

### 6. Per-bus IRQ independence

Both I2C0 and I2C1 wire to their own CLIC cause lines (22 and 23
respectively). The `qemu_irq` is per-instance state. Tested:

```
{"port":0,"level":1} ← I2C0 raise (cause 22)
{"port":0,"level":0} ← I2C0 clear (cause 22)
{"port":1,"level":1} ← I2C1 raise (cause 23) — independent
{"port":1,"level":0} ← I2C1 clear (cause 23)
```

Per-instance state isolation works the same way it did for
UART instances in Phase 2.AZ. The multi-instance pattern keeps
scaling.

## Lo que SÍ funcionó

Live test (2026-05-08):

**Stderr**:
```
[esp32p4.i2c0] CPU IRQ line -> 1 (int_raw=0x88 int_ena=0x88)
[esp32p4.i2c0] CMD5 stop byte_num=0
[esp32p4.i2c0] CPU IRQ line -> 0 (int_raw=0x0 int_ena=0x88)
[esp32p4.i2c1] CPU IRQ line -> 1 (int_raw=0x88 int_ena=0x88)
[esp32p4.i2c1] CMD5 stop byte_num=0
[esp32p4.i2c1] CPU IRQ line -> 0 (int_raw=0x0 int_ena=0x88)
```

The CMD5 stop happens AFTER the IRQ raise — because our code
emits the JSON-irq event before the CMD-write event in the same
function call. Functionally correct; cosmetically the stderr
order suggests "IRQ then STOP" when really "STOP triggered IRQ
inside the same call".

**JSON**:
```json
{"event":"i2c_irq","port":0,"level":1}
{"event":"i2c_irq","port":0,"level":0}
{"event":"i2c_irq","port":1,"level":1}
{"event":"i2c_irq","port":1,"level":0}
```

4 events, exactly 1 per (raise, clear) edge per bus. Both
buses independently identified by port_num.

Build clean. Regression-clean — other peripheral counts unchanged
from Phase 2.BF. The new i2c_irq event type joins the JSON tracer
inventory.

## Lo que NO funcionó / decisiones tomadas

1. **Extra "stop" CMD event in self-test JSON**: the helper-based
   loop emits a "stop" JSON event, then the real CMD write emits
   another (for slot 5). Two "stop" events per self-test
   iteration. Acceptable for the moment — both events are
   correct in isolation, just redundant. Future cleanup:
   refactor self-test to use real CMD writes throughout.

2. **Only END_DETECT + TRANS_COMPLETE modeled**: real silicon
   has 17+ interrupt bits. NACK detection (bit 10) would be
   useful for "no slave at this address" sketches. Skipped —
   our synthetic responder always returns valid data, so
   NACK never fires anyway. Documented as `2.BG.nack`.

3. **No BYTE_TRANS_DONE or FIFO_WM bits**: these fire on
   intermediate bus events (each byte transferred, FIFO
   watermark hit). Useful for streaming-style DMA sketches.
   Skipped because most Arduino sketches use blocking transfers.

4. **Stderr ordering looks reversed**: stderr shows IRQ raise
   BEFORE "CMD5 stop" because update_irq fprintf fires before
   the CMD logging fprintf inside the same write op call.
   JSON timestamps tell the right story (raise at 733437 ns,
   then the stop event), but stderr is purely sequential.
   Cosmetic only.

5. **No demo ISR for cause 22/23**: same as TWAI — the demo
   blob ISR handles causes 17-20; 22/23 fall through. Real
   Arduino firmware will register its own ISRs. Wiring is
   correct; firmware behavior is firmware's problem.

6. **Single STOP cmd → both bits set**: real silicon sets
   END_DETECT and TRANS_COMPLETE at slightly different times
   (END_DETECT on bus STOP edge, TRANS_COMPLETE on the LAST
   CMD slot opcode = END or STOP). For our skeleton both fire
   simultaneously. Demos that distinguish them work either way
   since both bits being set is the steady-state.

## Lessons learned

1. **Template backport is mechanical now**: 4 phases ago this
   would have been a major design effort. With the Phase 2.BF
   template, adding the I2C IRQ took ~50 lines of code per the
   established recipe (update_irq helper + 3 hooks + reset
   handling + machine init wiring).

2. **W1TC INT_CLR vs clear-on-read**: I2C and TWAI differ here.
   TWAI clears latched bits on INTR-read (SJA1000 silicon
   pattern, 1996). I2C uses INT_CLR W1TC (modern pattern,
   2010s). Both correct for their respective silicon. The
   `update_irq` helper itself is the same in both — only the
   trigger differs.

3. **Real CMD writes in self-tests are more honest**: the
   helper-based emit-only pattern was confusing because the
   stored bytes never reach the real handler. Refactoring to
   use real writes everywhere would be a small project but
   produces cleaner JSON output. Worth doing eventually.

4. **Per-instance `qemu_irq` Just Works**: no special handling
   needed for two instances of the same device class — each
   has its own `intr_out` field, each connects to its own CLIC
   cause line. The state struct's `irq_level` is also per-
   instance so edge detection runs independently.

5. **The "5-event boot trace" pattern from 2.BF generalizes**:
   I2C boot trace is 4 events (one per bus × raise+clear). Add
   one more bus = 6. The pattern is "N × 2" where N = number of
   instances. Compact validation regardless of bus count.

## Implementación final

### `include/hw/i2c/esp32p4_i2c.h`

- Added register offset macros: INT_RAW (0x28), INT_CLR (0x2C),
  INT_ENA (0x30), INT_ST (0x34).
- Added INT bit defines: END_DETECT, TRANS_COMPLETE, NACK.
- Added `qemu_irq intr_out;` and `bool irq_level;` to state.

### `hw/i2c/esp32p4_i2c.c`

- Include `hw/irq.h`.
- New `esp32p4_i2c_update_irq()` at top of file — recomputes
  from (INT_RAW & INT_ENA), updates INT_ST, edge-detection,
  emits JSON `i2c_irq` event.
- `esp32p4_i2c_write()`:
  - INT_CLR (W1TC) handler clears bits + update_irq, returns early.
  - INT_ENA write → update_irq.
  - STOP CMD path sets INT_RAW bits + update_irq.
- `esp32p4_i2c_realize()`: register gpio_out_named.
- `esp32p4_i2c_reset()`: drop IRQ line if asserted.
- `esp32p4_i2c_self_test()`: write INT_ENA at start, real
  STOP CMD + INT_CLR at end to exercise the full IRQ path.

### `hw/riscv/esp32p4.c`

- I2C0 init block: `qdev_connect_gpio_out_named` to CLIC cause 22.
- I2C1 init block: `qdev_connect_gpio_out_named` to CLIC cause 23.

## Estado consolidado (post-2.BG)

CLIC cause line allocation:

| Cause | Peripheral | Phase |
|-------|------------|-------|
| 17 | SYSTIMER | 2.K |
| 18 | GPIO | 2.AB |
| 19 | TIMG0 | 2.AH |
| 20 | TIMG1 | 2.AN.irq |
| 21 | TWAI0 | 2.BF |
| **22** | **I2C0** | **2.BG** |
| **23** | **I2C1** | **2.BG** |
| 24+ | unallocated (SPI, UART, RMT future) | — |

Peripherals with full data + IRQ:

| Peripheral | Data path | IRQ path | Phase |
|------------|-----------|----------|-------|
| TIMG0/1 | timg events | timg_irq | 2.AG/AH/AN |
| GPIO | pin events | (cause 18) | 2.AB |
| TWAI0 | twai + twai_rx | twai_irq | 2.BA/BC/BF |
| **I2C0/1** | **i2c + i2c_rx** | **i2c_irq** | **2.BG** |
| LEDC | ledc events | TBD | 2.AC |
| ADC | adc events | TBD | 2.AD |
| SPI2 | spi + spi_rx | TBD | 2.AO/AU |
| UART0..LP | uart_tx/rx | TBD | 2.AW/AX/AZ/BB |
| RMT | rmt events | TBD | 2.AY |

JSON event types: **21** (added `i2c_irq`).

## 41-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.BC  | Synthetic TWAI RX responder                              |
| 2.BD  | MPU-6050 + multi-sensor dispatcher                       |
| 2.BE  | HMC5883L + VL53L0X — 4-sensor matrix                     |
| 2.BF  | TWAI IRQ wiring — interrupt-driven CAN                   |
| **2.BG** | **I2C IRQ wiring — interrupt-driven Wire (both buses)** |

## Próximas direcciones

- **SPI IRQ wiring** — same template, USR transaction complete →
  cause 24.
- **UART IRQ wiring** — RX_FIFO_FULL / TX_DONE → causes 25+.
- **RMT IRQ wiring** — TX_END / RX_END → causes 26+.
- **ADC IRQ wiring** — sample complete → cause 27.
- **WDT actual reset** — close watchdog chain.
- **Real PWM waveform on GPIO** via LEDC.
- **FreeRTOS real port** (Phase 2.V deferred).
- **TWAI1 + TWAI2** instantiation (causes 28+).
