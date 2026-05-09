# Phase 2.AA — INT_TYPE filter + multi-pin IRQ wiring

**Estado**: ✅ done — RISING/FALLING/ANY-edge interrupt filtering
implemented; pins 0–7 wired to CPU IRQ lines 18–25. Demo configures
pin 0 as RISING-only — fake button only fires CPU IRQ on press, not
release.

## Goal

Bring the GPIO interrupt model up to real-silicon parity for the
trigger-type axis: real ESP32-P4 GPIO_PINx_REG has an INT_TYPE field
(NONE / RISING / FALLING / ANY-edge / LEVEL_HIGH / LEVEL_LOW). Our
Phase 2.Z model fired on any transition; Phase 2.AA adds RISING-only
and FALLING-only filters via two new register banks.

Also extends the IRQ wiring from a single pin to 8 pins, so a sketch
can use up to 8 different `attachInterrupt(pin, ISR, MODE)` lines.

## Lo que SE INVESTIGÓ

### 1. INT_TYPE register design

Real ESP32-P4 packs trigger type into 3-bit fields per pin
(GPIO_PINx_REG.INT_TYPE at bits[10:7]):

| Code | Trigger     |
|------|-------------|
| 0    | None        |
| 1    | RISING edge |
| 2    | FALLING edge|
| 3    | ANY edge    |
| 4    | LEVEL_LOW   |
| 5    | LEVEL_HIGH  |

For our Phase-1 model, instead of 32 × 3-bit fields, we use TWO
32-bit aggregate masks:

  - `int_rising_mask`  bit N = 1 → fire on 0→1 transitions of pin N
  - `int_falling_mask` bit N = 1 → fire on 1→0 transitions of pin N

Truth table per pin N (assuming `int_ena_mask & (1<<N) != 0`):

| rising | falling | Behaviour                                  |
|--------|---------|--------------------------------------------|
| 0      | 0       | ANY-edge (Phase 2.Z compat — level mirror) |
| 1      | 0       | RISING-only (pulse on 0→1)                 |
| 0      | 1       | FALLING-only (pulse on 1→0)                |
| 1      | 1       | ANY-edge (treated like 0,0; redundant)     |

LEVEL_HIGH/LOW are deferred — most Arduino sketches use edge
triggers.

### 2. Pulse vs level semantics

For ANY-edge (Phase 2.Z compat), we keep the level-mirror
behaviour: `qemu_set_irq(pin_irq[N], level)` passes the current pin
level through. The CPU sees level=1 → mip.MEIP set; level=0 →
ignored by `esp_cpu_irq_handler` (whose body only acts on level=1).

For RISING-only and FALLING-only, we **pulse** the IRQ:
`qemu_set_irq(pin_irq[N], 1); qemu_set_irq(pin_irq[N], 0)`. This
matches real silicon edge interrupts — the IRQ is asserted only
momentarily; if the CPU misses the edge (MIE was off), the next
edge fires a fresh pulse rather than relying on the level being
re-checked.

### 3. Multi-pin wiring

Phase 2.Z wired only `gpio.pin[0]` → `espressif-cpu-irq-lines[18]`.
Phase 2.AA extends to a loop wiring pins 0..7 → lines 18..25:

```c
for (int p = 0; p < 8; p++) {
    qdev_connect_gpio_out_named(
        DEVICE(&ms->gpio), "esp32p4.gpio.pin", p,
        qdev_get_gpio_in_named(DEVICE(&ms->soc),
                               "espressif-cpu-irq-lines", 18 + p));
}
```

Lines 16, 17 are skipped (16 = potentially IPC, 17 = SYSTIMER tick).
Free CPU causes 26..39 are still unused — extending to all 32 pins
just needs more lines plus skipping the system-reserved range.

### 4. Demo blob updates

Inserted a 3rd write at `0x4040011C` to enable RISING-only on pin 0:

```
0x40400114: addi t1, x0, 1            ; pin 0 mask
0x40400118: sw   t1, 0x74(t2)          ; INT_ENA_W1TS
0x4040011C: sw   t1, 0x84(t2)          ; INT_RISING_W1TS  ← NEW
```

This is the equivalent of Arduino's `attachInterrupt(0, isr, RISING)`
followed by enabling the interrupt source (minus the ISR
registration which would write the user handler into the IDF
interrupt allocator).

The 4-byte insertion shifted all blob addresses past `.loop_head`
by +4. JAL ra and final j offsets are unchanged (src and dst both
shifted by the same amount).

### 5. SW imm encoding for `0x84`

Computing `sw t1, 0x84(t2)`:
- imm = 0x84 = 132
- imm[11:5] = 132 >> 5 = 4
- imm[4:0] = 132 & 31 = 4
- = (4 << 25) | (6 << 20) | (7 << 15) | (2 << 12) | (4 << 7) | 0x23
- = `0x0863A223`

Verified by decoding back: works correctly. (No repeat of the
Phase 2.Z encoding bug — having computed the formula
deliberately this time.)

## Lo que SÍ funcionó

With `ESP_CPU_IRQ_DEBUG=1` build:

```
[esp_cpu.irq_handler] line=18 level=1 accept=0 ...   ← pulse high
[esp_cpu.irq_handler] line=18 level=0 accept=0 ...   ← pulse low
[esp32p4.gpio] pin 0 -> 1                            ← actual press
[esp32p4.gpio] pin 0 -> 0                            ← release: NO IRQ
[esp_cpu.irq_handler] line=18 level=1 accept=0 ...   ← next press
[esp_cpu.irq_handler] line=18 level=0 accept=0 ...
[esp32p4.gpio] pin 0 -> 1
```

Each fake-button press (rising edge) produces:
- Two `[esp_cpu.irq_handler]` lines (the pulse pair: level=1 then 0).
- One `[esp32p4.gpio] pin 0 -> 1` line.

Each release (falling edge) produces:
- One `[esp32p4.gpio] pin 0 -> 0` line.
- ZERO `[esp_cpu.irq_handler]` lines for line=18.

This proves the RISING-only filter is selecting only 0→1
transitions for the CPU IRQ, while the GPIO model still logs
every transition.

Default build (no DEBUG) is unchanged: same running-light + fake-
button output as Phase 2.Z. 103 runtime patches active (was 102).

## Lo que NO funcionó / decisiones tomadas

1. **Considered: per-pin INT_TYPE register matching real silicon**:
   real ESP32-P4 has 3-bit field per pin in GPIO_PINx_REG. For our
   Phase-1 model, two 32-bit aggregate masks are functionally
   equivalent (cover the rising/falling/any-edge subset of trigger
   types) and use 6 register decode entries instead of 32.

2. **LEVEL_HIGH / LEVEL_LOW triggers**: deferred. Edge triggers
   cover the typical Arduino `attachInterrupt(pin, ISR, MODE)`
   modes (RISING, FALLING, CHANGE). Level-triggered interrupts
   are mostly used by IDF's high-level interrupt allocator for
   shared peripheral lines — out of scope for the current
   GPIO-only model.

3. **Wiring all 32 pins**: only 0..7 wired. Lines 26..39 are
   still free CPU causes; extending requires only more
   `qdev_connect_gpio_out_named` lines. Picked 8 as a useful
   demonstration without overcommitting register names.

## Lessons learned

1. **Edge-trigger pulse vs ANY-edge level**: pulse semantics are
   needed for edge triggers because the CPU's IRQ handler only
   acts on level=1; without an explicit lower, mip.MEIP would
   stay asserted forever after a single rising edge. ANY-edge can
   keep level-mirror semantics (the next 0→1 re-asserts).

2. **Aggregate masks vs per-pin fields**: Phase-1 model collapses
   real silicon's 32 × 3-bit per-pin INT_TYPE into 2 × 32-bit
   aggregate masks. Captures rising/falling/any-edge
   functionality with way less register decode complexity.

3. **`for (int p = 0; p < 8; p++) qdev_connect_gpio_out_named()`**:
   one loop wires 8 IRQs. Cleanest pattern for multi-pin
   peripheral-to-CPU plumbing in QEMU.

4. **Address shift discipline**: every time we insert/remove
   instructions in the blob, all subsequent addresses shift. JAL
   offsets stay the same when both src and dst are inside the
   shifted range; only branches that cross the insertion boundary
   need offset adjustment. We've now done this 3 times across
   Phase 2.W.next, 2.Z, and 2.AA — feels routine.

## Implementación final

### `include/hw/gpio/esp32p4_gpio.h`

- Added `int_rising_mask` and `int_falling_mask` fields.
- Updated docstring with the 6 new register offsets and an
  edge-trigger truth table.

### `hw/gpio/esp32p4_gpio.c`

- 6 new register decode entries: INT_RISING + W1TS/W1TC at 0x80/
  0x84/0x88, INT_FALLING + W1TS/W1TC at 0x90/0x94/0x98.
- `esp32p4_gpio_update` now branches on the rising/falling masks
  to choose pulse-vs-level semantics.
- Reset clears both new masks.

### `hw/riscv/esp32p4.c`

- Single-pin `qdev_connect_gpio_out_named` replaced with a
  `for (p = 0; p < 8; p++)` loop wiring lines 18..25.
- Demo blob inserts 1 instruction (sw INT_RISING_W1TS) so pin 0
  is configured as RISING-only. All subsequent blob addresses
  shifted +4 bytes.

## Estado consolidado (post-2.AA)

| Hito                                                     | Estado |
|----------------------------------------------------------|--------|
| Hello-world UART                                         | ✅     |
| GPIO output (running light, deterministic timing)        | ✅ 2.Y |
| GPIO input + ENABLE multiplexer                          | ✅ 2.W |
| Bidirectional JSON channel for frontend                  | ✅ 2.X |
| GPIO transition → CPU IRQ on single pin (ANY-edge)       | ✅ 2.Z |
| **GPIO RISING/FALLING/ANY-edge filter, 8 pins wired**    | ✅ 2.AA|
| Pin LEVEL_HIGH/LEVEL_LOW triggers                        | ⏳ later |
| Real INT_TYPE register matching silicon (per-pin 3-bit)  | ⏳ later |

## Realism progression so far (8 phases since 2.U)

| Phase | Capability                                        |
|-------|---------------------------------------------------|
| 2.U   | Hand-rolled GPIO toggle (busy-wait)               |
| 2.V   | 3-pin running light cycling                       |
| 2.W   | GPIO input pads + ENABLE multiplexer              |
| 2.X   | JSON output stream → frontend                     |
| 2.X.input | JSON input fifo ← frontend                    |
| 2.Y   | SYSTIMER virtual-time deterministic timing        |
| 2.Z   | GPIO pin-transition IRQ to CPU (single pin)       |
| **2.AA** | **INT_TYPE filter (RISING/FALLING/ANY) + 8-pin wiring** |

The emulator now provides a fairly complete subset of the ESP32-P4
GPIO controller: 32-pin output/input with ENABLE multiplexer, real
silicon-shape transitions, virtual-time timing, JSON I/O channel
for frontend integration, and per-pin edge-filtered IRQ delivery
on 8 pins. Foundation for end-to-end `attachInterrupt()` Arduino
sketches pending only the `mstatus.MIE` setup that a real sketch
provides via IDF's interrupt setup.

## Próximas fases

Multiple paths forward, depending on user priorities:

1. **Phase 2.AB**: extend wiring to all 32 pins + LEVEL_HIGH/LOW
   triggers. Completes the GPIO interrupt model.

2. **Phase 2.LEDC**: add LEDC PWM controller. Visible "fade"
   demo with PWM duty-cycle stream into the JSON event log.

3. **Phase 2.I2C**: I2C master controller. Useful for sensor-
   reading demos.

4. **Phase 2.V**: long-deferred real FreeRTOS port. Multi-week.
   Unblocks setup()/loop() flow without bypass patches and lets
   the emulator run unmodified Arduino sketches end-to-end —
   including the GPIO IRQ infrastructure built in 2.W..2.AA.
