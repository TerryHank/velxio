# Phase 2.Z — GPIO pin-transition interrupts wired to the CPU

**Estado**: ✅ done — fake-button transitions on GPIO pin 0 raise CPU
IRQ line 18, verified end-to-end via the `ESP_CPU_IRQ_DEBUG` build.
Foundation for `attachInterrupt(pin, ISR, RISING)` Arduino API.

## Goal

Complete the full GPIO-interrupt path:

```
fake button / frontend fifo → external_input bit 0
  → esp32p4_gpio_update detects transition
  → if int_ena_mask bit 0 is set: qemu_set_irq(pin_irq[0], level)
  → wired (qdev_connect_gpio_out_named) to espressif-cpu-irq-lines[18]
  → esp_cpu_irq_handler(n=18, level=...)
  → if accept_interrupts: irq_pending=true, raise IRQ_M_EXT
  → CPU traps to mtvec (CLIC dispatch via mtvt[18])
  → IDF `_interrupt_handler` (vectors_clic.S free range 16..39)
  → user-registered C handler (when present)
```

This phase completes the wiring up to "CPU sees the IRQ". The
final step (user handler) requires a real Arduino sketch with
`attachInterrupt()` to register an ISR — out of scope for the
hand-rolled blob demo, but the path is now plumbed.

## Lo que SE INVESTIGÓ

### 1. Per-pin interrupt-enable mask

Real ESP32-P4 silicon uses per-pin GPIO_PINx_REG fields
(GPIO_PIN0_INT_ENA, GPIO_PIN1_INT_ENA, ...) for fine-grained
interrupt control plus trigger type (RISING/FALLING/EDGE/LEVEL).
For our Phase-1 model we collapse these into a single
**32-bit aggregate mask** at offset 0x70 (made-up in our model;
real silicon has different per-pin layout):

| Offset | Register             | Notes                          |
|--------|----------------------|--------------------------------|
| 0x70   | GPIO_INT_ENA          | bit N enables IRQ for pin N    |
| 0x74   | GPIO_INT_ENA_W1TS     | atomic SET                     |
| 0x78   | GPIO_INT_ENA_W1TC     | atomic CLEAR                   |

Trigger type is hard-coded to "ANY edge" (model fires on every
transition) — RISING/FALLING/LEVEL would be Phase 2.Z.next.

### 2. Filtering pin_irq output by enable mask

The GPIO model already exposes 32 named output IRQ lines
(`esp32p4.gpio.pin[N]`) but until now they fired on every
transition — including guest output toggles on pins 5/6/7. With
the running-light blob writing W1TS/W1TC at ~3.5 Hz cycle, that
would flood the CPU with ~100 IRQs/s on lines 5/6/7 if those were
wired to the interrupt matrix.

Fix: in `esp32p4_gpio_update`, only fire pin_irq[N] when
`int_ena_mask & (1<<N)` is set:

```c
if (s->int_ena_mask & (1u << pin)) {
    qemu_set_irq(s->pin_irq[pin], level);
}
```

The `[esp32p4.gpio] pin N -> M` log line still fires for every
transition — only the IRQ side is gated. This way the JSON event
stream and stderr stay informative without spamming the CPU.

### 3. Wiring pin_irq[0] to the CPU IRQ line

In machine init (`esp32p4_machine_init`):

```c
qdev_connect_gpio_out_named(
    DEVICE(&ms->gpio), "esp32p4.gpio.pin", 0,
    qdev_get_gpio_in_named(DEVICE(&ms->soc),
                           "espressif-cpu-irq-lines", 18));
```

Picked cause **18** because:

- IDF's `vectors_clic.S` reserves causes 0..15 as "system
  interrupts" (all routed to `_panic_handler`). Causes 16..39 are
  the "free" range, dispatched to `_interrupt_handler`.
- 16 and 17 are sometimes used by IDF's IPC and SYSTIMER (we use
  17 for SYSTIMER tick already, set in Phase 2.O).
- 18 is the lowest free cause that doesn't collide with our
  existing wiring.

Only pin 0 wired this commit — extending to more pins is just
more `qdev_connect_gpio_out_named` lines.

### 4. Demo blob enables INT for pin 0

Added 2 instructions at the top of the running-light blob (before
`.loop_head`) to set the INT_ENA bit for pin 0:

```
0x40400114: addi t1, x0, 1            ; pin 0 mask
0x40400118: sw   t1, 0x74(t2)          ; → GPIO_INT_ENA_W1TS
```

This corresponds exactly to Arduino's `attachInterrupt(0, ...)`
followed by enabling the GPIO pin's interrupt source — minus the
ISR registration (which would write to the IDF interrupt
allocator).

The 8-byte insertion shifted all subsequent blob instructions
+8 bytes:
- `.loop_head` from 0x40400114 → 0x4040011C
- `.delay` subroutine from 0x40400148 → 0x40400150
- All JAL ra offsets unchanged (both src and dst shifted equally)
- `j .loop_head (-48)` offset unchanged

### 5. Bug caught: SW encoding of `sw t1, 0x74(t2)`

First version had `0x0263A3A3` which decodes to `sw t1, 0x47(t2)`
(offset 0x47 instead of 0x74). The 12-bit SW imm splits into
imm[11:5] at inst[31:25] and imm[4:0] at inst[11:7] — the bit
shift error landed in imm[11:5]:

| Encoding        | imm[11:5] | imm[4:0] | Total imm | Target reg     |
|-----------------|-----------|----------|-----------|----------------|
| 0x0263A3A3 (bad)| 0b0000001 | 0b00111  | 0x47      | (none we want) |
| 0x0663AA23 (✓)  | 0b0000011 | 0b10100  | 0x74      | INT_ENA_W1TS  ✓|

First test showed pin 0 transitions logged but no `line=18` IRQ
fires — the INT_ENA mask never got set, so pin_irq[0] was always
gated off. After the encoding fix, line=18 IRQ delivery confirmed.

## Lo que SÍ funcionó

With `ESP_CPU_IRQ_DEBUG=1` build (extended to log all non-tick
IRQs):

```
[esp_cpu.irq_handler] line=18 level=1 accept=0 mstatus=00000000 ...
[esp32p4.gpio] pin 0 -> 1
[esp_cpu.irq_handler] line=18 level=0 accept=0 mstatus=00000000 ...
[esp32p4.gpio] pin 0 -> 0
[esp_cpu.irq_handler] line=18 level=1 accept=0 mstatus=00000000 ...
[esp32p4.gpio] pin 0 -> 1
```

Each fake-button transition pair (raise + lower) produces:
- One `[esp32p4.gpio] pin 0 -> N` log line (transition logged).
- One `[esp_cpu.irq_handler] line=18 level=N` log line (IRQ
  asserted/deasserted on the CPU's named IRQ line).

`accept=0` because the demo blob doesn't set mstatus.MIE — the
CPU sees the IRQ but doesn't trap. That's expected: a real
Arduino sketch would call `interrupts()` (= csrsi mstatus, 8) or
the equivalent IDF setup before relying on attachInterrupt to
fire user code. Phase 2.Z plumbs the wire; the CSR setup is
sketch-specific.

In default build (no DEBUG), the running-light demo + fake-button
output is unchanged:

```
[esp32p4] runtime patches applied (102 entries)
[esp32p4.gpio] pin 5 -> 1 / pin 5 -> 0    (running light, ~3.5 Hz)
[esp32p4.gpio] pin 6 -> 1 / pin 6 -> 0
[esp32p4.gpio] pin 7 -> 1 / pin 7 -> 0
[esp32p4.gpio] pin 0 -> 1 / pin 0 -> 0    (fake button, every 3 s)
```

Pin 0 transitions silently route to CPU IRQ 18 in the background
— invisible without DEBUG, present and ready for real ISR code.

## Lo que NO funcionó (intentado)

1. **No `int_ena_mask` filter (fire pin_irq on every transition)**:
   would mean running-light pins 5/6/7 fire IRQs at ~10 Hz each
   on whatever lines they were wired to — flood the CPU. Rejected
   in favour of the per-pin enable mask.

2. **Original `0x0263A3A3` SW encoding**: bit error in imm[11:5]
   — encoded `sw t1, 0x47(t2)` not `sw t1, 0x74(t2)`. INT_ENA
   never got set; symptom was pin 0 transitions logging but no
   line=18 firing. Same family of "hand-rolled SW imm split"
   bugs as the JAL imm bugs in 2.M and 2.Y.

## Lessons learned

1. **Per-pin enable mask is essential**: without filtering, the
   model fires `pin_irq[N]` on every transition including
   high-frequency guest outputs. Real silicon has per-pin
   GPIO_PINx_INT_ENA + INT_TYPE — even our simplified aggregate
   mask captures the essential filter semantic.

2. **`qdev_connect_gpio_out_named` is the single line of glue**:
   wiring a device's named output IRQ to another device's named
   input is a one-liner. The verbosity is in the model code on
   either side.

3. **SW imm encoding is yet another hand-rolling landmine**:
   the 12-bit imm is split between inst[31:25] and inst[11:7].
   Phase 2.Z hit this; phases 2.M and 2.Y hit similar splits in
   JAL imm. **Strong recommendation**: write a Python encoder
   helper that takes mnemonic + operands and emits the correct
   word, instead of computing by hand.

4. **`accept=0` in the IRQ handler debug means the wire works**:
   the IRQ is delivered to the CPU model, but the CPU's
   accept-interrupts gate (mstatus.MIE check) is closed. End-to-
   end ISR firing requires guest code to enable interrupts — a
   sketch-level concern, not an emulator-wiring concern.

## Implementación final

### `include/hw/gpio/esp32p4_gpio.h`

- Added `int_ena_mask` field.
- Updated docstring with INT_ENA register table at offset 0x70+.

### `hw/gpio/esp32p4_gpio.c`

- Added register decode for INT_ENA / W1TS / W1TC at 0x70/0x74/0x78.
- `esp32p4_gpio_update` now gates `pin_irq[N]` by
  `int_ena_mask & (1<<N)`.
- Reset clears `int_ena_mask` (all IRQs disabled at boot, like
  real silicon).

### `hw/riscv/esp32p4.c`

- 1-line wire from `gpio.pin[0]` to
  `espressif-cpu-irq-lines[18]` in machine init.
- Demo blob shifted to insert 2 instructions enabling INT for
  pin 0 at blob entry. All trailing addresses +8 bytes.

### `target/riscv/esp_cpu.c`

- Extended `ESP_CPU_IRQ_DEBUG` log to fire on **every** non-tick
  IRQ (line != 17), so rare GPIO IRQs are visible. SYSTIMER tick
  on line 17 still rate-limited to every 128th to avoid flooding.

## Estado consolidado (post-2.Z)

| Hito                                                        | Estado |
|-------------------------------------------------------------|--------|
| Hello-world UART                                            | ✅     |
| 3-pin running light w/ deterministic SYSTIMER timing        | ✅ 2.Y |
| Bidirectional GPIO event channel (frontend ↔ emulator)      | ✅ 2.X |
| **GPIO pin-transition IRQ delivered to CPU**                | ✅ 2.Z |
| User ISR runs in response (requires guest sketch + MIE set) | ⏳ Phase 2.V (FreeRTOS port) |

## Total realism upgrades since Phase 2.U

| Phase | Capability                                        |
|-------|---------------------------------------------------|
| 2.U   | Hand-rolled GPIO toggle (busy-wait)               |
| 2.V   | 3-pin running light (busy-wait timing)            |
| 2.W   | GPIO input pads + ENABLE multiplexer              |
| 2.X   | JSON event stream output (frontend producer)      |
| 2.X.input | JSON input fifo (frontend consumer)            |
| 2.Y   | SYSTIMER virtual-time deterministic delays        |
| **2.Z** | **GPIO pin-transition interrupts to CPU**       |

102 runtime patches active. 7 incremental capability layers each
adding one realism aspect. The emulator now models a meaningful
subset of the ESP32-P4 GPIO + CLIC behaviour at the bit-accurate
level, with a frontend-friendly JSON I/O channel and host-CPU-
independent timing.

## Próximas fases

- **Phase 2.AA** (next direction TBD by user): full ENABLE
  feedback in the event log, multi-pin IRQ wiring, real INT_TYPE
  support (RISING/FALLING/EDGE/LEVEL), or moving on to other
  peripherals (LEDC PWM, I2C/SPI master, ADC).

- **Phase 2.V** (long-deferred): real FreeRTOS port emulation —
  multi-week effort. Unblocks `setup()/loop()` natural Arduino
  flow without bypass patches. Phase 2.Z's interrupt path becomes
  fully usable end-to-end once a real sketch can call
  `attachInterrupt`.
