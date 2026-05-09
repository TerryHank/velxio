# Phase 2.AL — Multi-source ISR (TIMG + GPIO)

**Estado**: ✅ done — single ISR now dispatches on mcause to handle
both TIMG hardware-timer alarms (cause 19, toggles pin 8) and GPIO
edge IRQs (cause 18, toggles pin 9). First multi-IRQ-source demo.
Demonstrates real-silicon "shared trap vector + per-cause dispatch"
pattern that Arduino/IDF interrupt handlers use.

## Goal

Phase 2.AK proved the trap chain works for one IRQ source. Real chips
have many simultaneous IRQ sources — TIMG, GPIO, UART, I2C, SPI, etc.
Each goes through the same trap vector but the ISR must dispatch to
the right per-source handler.

This phase extends the ISR with mcause-based dispatch:

  - cause 19 (TIMG): clear INT_CLR, toggle pin 8 (Phase 2.AK behaviour)
  - cause 18 (GPIO): clear INT_STATUS_W1TC bit 0, toggle pin 9
  - other:           mret (no-op)

## Lo que SE INVESTIGÓ

### 1. Cause-line allocation review

| Cause | Source             | Phase added |
|-------|--------------------|-------------|
| 17    | SYSTIMER tick      | 2.K         |
| 18    | GPIO consolidated  | 2.AB        |
| 19    | TIMG0              | 2.AH        |

GPIO consolidated IRQ at cause 18 was wired in Phase 2.AB but never
exercised by guest code — Phase 2.AB committed it as "ready for ISR
demos in future phases". This is that future phase.

### 2. ISR dispatch pattern

Two natural dispatch styles for RISC-V ISR:

  (a) **Branch chain**: `if cause==19 do_timg(); if cause==18 do_gpio(); …`
  (b) **Jump table**: `pc = vector_table[cause]`

(a) is simpler for 2-3 sources (we have 2). (b) scales better for
many sources but needs a separate vector table memory area. Picked
(a) for Phase 2.AL.

ISR pseudocode:
```
isr:
  csrr a2, mcause
  andi a2, a2, 0x1F        ; mask to 5-bit cause
  
  ; --- Check cause 19 (TIMG) ---
  addi a3, x0, 19
  bne  a2, a3, .check_gpio
  ; TIMG handler body (clobbers a2/a3)
  …clear INT_CLR, toggle pin 8…
  j    .end                  ; skip GPIO handler
  
.check_gpio:
  addi a3, x0, 18
  bne  a2, a3, .end
  ; GPIO handler body (clobbers a2/a3)
  …W1TC INT_STATUS, toggle pin 9…
  
.end:
  mret
```

Total: 21 instructions, 84 bytes. ISR address range 0x40400200..0x40400250.

### 3. Branch and jump offsets

ISR layout (verified before encoding):

| Addr        | Instruction               | Encoding   |
|-------------|---------------------------|------------|
| 0x40400200  | csrr a2, mcause           | 0x34202673 |
| 0x40400204  | andi a2, a2, 0x1F          | 0x01F67613 |
| 0x40400208  | addi a3, x0, 19            | 0x01300693 |
| 0x4040020C  | **bne a2,a3,+36 → 0x230**  | 0x02D61263 |
| 0x40400210  | lui  a2, 0x500BC          | 0x500BC637 |
| 0x40400214  | addi a3, x0, 1             | 0x00100693 |
| 0x40400218  | sw   a3, 0x7C(a2)          | 0x06D62E23 |
| 0x4040021C  | lui  a2, 0x500E0           | 0x500E0637 |
| 0x40400220  | lw   a3, 4(a2)             | 0x00462683 |
| 0x40400224  | xori a3, a3, 0x100         | 0x1006C693 |
| 0x40400228  | sw   a3, 4(a2)             | 0x00D62223 |
| 0x4040022C  | **j +36 → 0x250**          | 0x0240006F |
| 0x40400230  | addi a3, x0, 18            | 0x01200693 |
| 0x40400234  | **bne a2,a3,+28 → 0x250**  | 0x00D61E63 |
| 0x40400238  | lui  a2, 0x500E0           | 0x500E0637 |
| 0x4040023C  | addi a3, x0, 1             | 0x00100693 |
| 0x40400240  | sw   a3, 0xA4(a2)          | 0x0AD62223 |
| 0x40400244  | lw   a3, 4(a2)             | 0x00462683 |
| 0x40400248  | xori a3, a3, 0x200         | 0x2006C693 |
| 0x4040024C  | sw   a3, 4(a2)             | 0x00D62223 |
| 0x40400250  | mret                      | 0x30200073 |

Phase 2.AK's hard-won lesson (BNE +28 vs +32 — off by 4 byte = wrong
target = infinite recursion) made me triple-check every offset.

### 4. GPIO INT_STATUS_W1TC handling

Phase 2.AB introduced the latched INT_STATUS register at offset 0xA0
with W1TC clear at 0xA4. ISR pattern:

```c
sw a3, 0xA4(a2)   ; with a2 = GPIO base, a3 = pin mask
```

Looking at `esp32p4_gpio.c:336`:
```c
case ESP32P4_GPIO_INT_STATUS_W1TC:
    if (s->int_status & v) {
        s->int_status &= ~v;
        esp32p4_gpio_refresh_intr_out(s);  // recompute consolidated IRQ
    }
    break;
```

Writing `1` to bit 0 of 0xA4 clears INT_STATUS bit 0 (pin 0). The
refresh recomputes `intr_out = (int_status != 0)`. With only pin 0
pending, clearing bit 0 → int_status=0 → IRQ line goes low.

Pin 0 was Phase 2.AA's RISING_INT-only configuration: only rising
edges fire. Falling edges of the fake button are filtered out at
the GPIO model level.

### 5. ENABLE mask extension

Existing init at 0x40400110 wrote `addi t1, x0, 0x1E0` (pins 5+6+7+8).
Updated to `addi t1, x0, 0x3E0` (pins 5+6+7+8+9). Encoding:

```
0x1E000313  →  0x3E000313
```

Single bit difference (bit 28 of the instruction = imm[8]).

## Lo que SÍ funcionó

10-second live test (2026-05-08):

```
=== Pin distribution ===
     66 "pin":6           ← running light (loop body)
     66 "pin":5
     65 "pin":7
      8 "pin":8           ← TIMG ISR (1 Hz)
      3 "pin":0           ← fake button (host wall-clock 3 s period)
      2 "pin":9           ← GPIO ISR (2 rising edges in 10 s)

=== Sample timing ===
{"t_ns":1040747986,"pin":8,"level":1}    ← TIMG @ ~1 s
{"t_ns":2044163488,"pin":8,"level":0}    ← TIMG @ ~2 s
... 8 pin 8 toggles total at 1.003 s intervals

{"t_ns":3000xxxxxx,"pin":0,"level":1}    ← fake button RISE
{"t_ns":3000yyyyyy,"pin":9,"level":1}    ← ISR cause=18 → pin 9 toggle
{"t_ns":6000xxxxxx,"pin":0,"level":0}    ← fake button FALL (filtered, no IRQ)
{"t_ns":9000xxxxxx,"pin":0,"level":1}    ← fake button RISE
{"t_ns":9000yyyyyy,"pin":9,"level":0}    ← ISR cause=18 → pin 9 toggle
```

**Why 2 pin 9 events not 3**: fake button toggles every 3 s
(host wall-clock). Within 10 s test:

  - t=3 s: pin 0 → 1 (RISING-EDGE IRQ fires)
  - t=6 s: pin 0 → 0 (FALLING — filtered by Phase 2.AA INT_TYPE = RISING)
  - t=9 s: pin 0 → 1 (RISING-EDGE IRQ fires)

So 2 rising edges → 2 GPIO IRQs → 2 pin 9 toggles. Math correct.

**Total events**: 369 (was 369 in Phase 2.AK; pin 8 dropped 1, pin 9
gained 2, timg_irq dropped 1 = net 0 — different test-run variance).

## What this proves

The ISR dispatched two unrelated IRQ sources correctly:

  - **Determinism**: pin 8 transitions at 1 Hz (locked to TIMG)
  - **Independence**: pin 9 transitions only on RISING edges of pin 0
  - **No cross-talk**: TIMG firing doesn't toggle pin 9; GPIO firing
    doesn't toggle pin 8
  - **No regression**: 99 LEDC + 33 ADC + 197 GPIO running-light
    events identical to Phase 2.AK

This matches real-silicon ISR semantics: a single shared trap vector,
per-source dispatch via mcause, per-source acknowledge via the
peripheral's INT_CLR mechanism.

## Lo que NO funcionó / decisiones tomadas

1. **No save/restore needed**: a2/a3 (x12/x13) are unused in the
   main demo blob, so the ISR clobbers them freely. Real
   compiler-generated ISRs save/restore via mscratch + memory; ours
   gets away without because of the hand-rolled blob's known
   register usage.

2. **Branch chain over jump table**: 2 sources doesn't justify the
   complexity of a vector table. If we add I2C / SPI / UART IRQ
   handling later (5+ sources), reconsider. For now the chain is
   readable.

3. **GPIO ISR clears specific pin, not whole INT_STATUS**: writes
   `0x1` to 0xA4 (clears bit 0 only). If multiple pins were
   pending, this would lose the others' status. Phase 2.AL only
   wires pin 0 IRQ so this is safe; multi-pin extension would need
   to read INT_STATUS first, then W1TC the read value.

4. **Pin 9 was already in ENABLE mask change**: the same edit
   (0x1E0 → 0x3E0) happened in this phase. Could split into two
   commits but they're tightly coupled (ENABLE before ISR can
   drive the pin) so kept together.

## Lessons learned

1. **Mcause-based dispatch is mechanical**: read mcause, mask,
   compare, branch. The pattern repeats for any number of sources.
   Real Arduino ISRs follow the same shape but use `attachInterrupt`
   to register handler pointers — same underlying mechanism.

2. **RISING_INT filter pays off here**: without it, falling edges
   would also fire IRQ → ISR → pin 9 toggle. We'd see 3 pin 9
   events in 10 s. With the filter (Phase 2.AA), only rising edges
   fire — pin 9 transitions are predictably aligned to button
   presses, not releases.

3. **Phase 2.AK's offset bug taught the right verification habit**:
   triple-check branch offsets by computing target address. With
   21 instructions and 3 branches, an off-by-4 anywhere would
   silently corrupt one path. Annotating each branch with its
   target address in the encoding table caught issues at
   write-time.

## Implementación final

### `hw/riscv/esp32p4.c`

- Init at 0x40400110: pin mask `0x1E0` → `0x3E0` (adds pin 9).
- ISR at 0x40400200..0x40400250: 21 instructions (was 12 in 2.AK).
  Adds `bne` to .check_gpio, `j` to .end, GPIO handler body
  (W1TC pin 0 + toggle pin 9).

Total runtime patches: 141 (was 132 in Phase 2.AK; +9 ISR).

## Estado consolidado (post-2.AL)

| Hito                                                          | Estado |
|---------------------------------------------------------------|--------|
| TIMG hardware timer + alarm + DIVIDER + IRQ                    | ✅ 2.AG-AI |
| ISR install + CLIC dispatch fixed                              | ✅ 2.AJ-AK |
| **Multi-source ISR (TIMG cause 19 + GPIO cause 18)**           | ✅ 2.AL|
| TIMG1 + watchdog                                                | ⏳ later|
| I2C / SPI master                                                | ⏳ later|
| Real PWM waveform on GPIO                                      | ⏳ later|
| Real FreeRTOS port                                              | ⏳ Phase 2.V |

## 19-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.U   | Hand-rolled GPIO toggle (busy-wait)                     |
| 2.V   | 3-pin running light cycling                             |
| 2.W   | GPIO input + ENABLE multiplexer                         |
| 2.X   | JSON event stream → frontend                            |
| 2.X.in| JSON input fifo ← frontend                              |
| 2.Y   | SYSTIMER virtual-time deterministic timing              |
| 2.Z   | GPIO pin-transition IRQ to CPU                          |
| 2.AA  | INT_TYPE filter + 8-pin wiring                          |
| 2.AB  | Real-silicon shared IRQ + latched INT_STATUS            |
| 2.AC  | LEDC PWM duty-cycle events                              |
| 2.AD  | ADC peripheral + ADC→LEDC pipeline                      |
| 2.AE  | LEDC 2-channel crossfade                                |
| 2.AF  | LEDC 3-channel rainbow                                  |
| 2.AG  | TIMG hardware timer + alarm comparator                  |
| 2.AH  | TIMG → CPU IRQ wiring (cause 19)                        |
| 2.AI  | TIMG DIVIDER respect                                    |
| 2.AJ  | ISR install path                                        |
| 2.AK  | Full attachInterrupt() chain (TIMG only)                |
| **2.AL** | **Multi-source ISR (TIMG + GPIO)**                    |

JSON stream still carries 6 event types. Pin 9 added to the active
output set.

## Próximas direcciones

- **TIMG1 + WDT**: copy TIMG0 to TIMG1, give it cause 20 + a faster
  alarm, demonstrates 2 timers running independently.
- **I2C master**: open BMP280/SSD1306 demos. New JSON event type:
  `i2c`.
- **Real PWM waveform on GPIO**: LEDC duty drives an actual GPIO
  pin transitioning at the configured frequency.
- **UART RX path**: receive bytes from host, emit JSON event,
  optionally trigger ISR.
- **Real FreeRTOS port** (Phase 2.V deferred — large effort).
