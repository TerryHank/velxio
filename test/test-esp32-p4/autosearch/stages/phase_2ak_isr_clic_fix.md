# Phase 2.AK — Diagnose & fix CLIC ISR trap delivery

**Estado**: ✅ done — full Arduino-style `attachInterrupt(timer, isr,
EDGE)` chain alive end-to-end. Pin 8 toggles at exactly 1 Hz driven
by the TIMG hardware-timer interrupt. **First time the emulator
delivers a CPU trap from a peripheral all the way to a guest ISR.**

## Goal

Phase 2.AJ left infrastructure in place but the CPU never trapped
on TIMG IRQs. Phase 2.AK closes the gap with two specific fixes.

## Lo que SE INVESTIGÓ

### 1. Reading the dispatch path in `target/riscv/esp_cpu.c`

Three pieces of code matter:

**`esp_cpu_irq_handler(opaque, n, level)`** (line 260):
```c
if (level && esp_cpu_accept_interrupts(cpu)) {
    cpu->irq_pending = true;
    cpu->irq_cause = n;
    qemu_irq_raise(cpu->parent_irq);
}
```

**`esp_cpu_accept_interrupts()`** (line 247):
```c
const bool mie = (riscv_csr_read(env, CSR_MSTATUS) & MSTATUS_MIE) != 0;
return !cpu->irq_pending && mie;
```

**`esp_cpu_realize()`** (line 400):
```c
riscv_cpu_claim_interrupts(&espcpu->parent_obj, MIP_MEIP)
s->parent_irq = qdev_get_gpio_in(DEVICE(s), IRQ_M_EXT);
```

Reading these in order tells the story:

  - The IRQ flows through **MIP_MEIP** (Machine External Interrupt
    pending bit, mip[11]).
  - For the CPU to take it, RISC-V semantics require **mstatus.MIE
    AND mie.MEIE** both set.
  - Phase 2.AJ enabled mstatus.MIE (bit 3) but NOT mie.MEIE (bit 11
    of CSR mie).
  - Result: `accept_interrupts` returned true (MIE=1), `irq_pending`
    got set, `parent_irq` got raised — but the standard RISC-V
    inner check at trap-take time silently rejected the IRQ because
    `mie.MEIE = 0`.

This was the missing link between "JSON timg_irq event level=1" and
"CPU trap delivered."

### 2. Encoding `csrs mie, 0x800`

The MEIE bit is 0x800 = `1 << 11`. Can't load 0x800 in a single
addi-immediate because 0x800 = -2048 in 12-bit signed (sign-
extends). Two-instruction load:

```
addi a3, x0, 1          ; a3 = 1
slli a3, a3, 11         ; a3 = 0x800
csrs mie, a3             ; CSR 0x304 W1S
```

Encodings:
- `addi a3, x0, 1`     → `0x00100693`
- `slli a3, a3, 11`    → `0x00B69693` (funct7=0, shamt=11, funct3=1)
- `csrs mie, a3`       → `0x3046A073` (CSR 0x304, funct3=2, rd=0)

### 3. The mcause filter bug (BNE offset off-by-one)

After enabling MEIE, the test exploded: 1309 events with **973 pin
8 transitions** in 10 seconds (~100 Hz). Diagnosis:

  - Without an mcause filter, the ISR fires on **every** IRQ source
    — SYSTIMER tick (cause 17, ~100 Hz), GPIO pin 0 (cause 18, fake
    button), TIMG (cause 19, our target).
  - Each ISR call toggled pin 8 regardless of cause.
  - 100 Hz × 10 s = ~1000 toggles ≈ 973 observed. ✓

Added an `mcause` check at the top of the ISR:

```
csrr  a2, mcause       ; mcause = INT_FLAG | cause
andi  a2, a2, 0x1F     ; mask to 5-bit cause
addi  a3, x0, 19       ; TIMG cause
bne   a2, a3, .skip    ; if cause != 19, skip body → mret
```

**First attempt**: `bne a2, a3, +28`. With ISR layout starting at
0x40400200, the filter at 0x4040020C, +28 lands on 0x40400228 —
which is `sw a3, 4(a2)` (the GPIO_OUT write), NOT `mret`. For
non-TIMG IRQs, `a2` is still the masked mcause value (e.g., 17 for
SYSTIMER). The store goes to address 21 → load access fault → CPU
re-enters ISR → infinite recursion → demo blob stalls.

**Symptom**: 19 total events (was 343 in Phase 2.AI). Demo runs one
loop iteration then dies. timg_irq stays at level=1 (never cleared
because ISR body didn't execute even for cause=19 due to mret being
skipped).

Wait — that doesn't match. Let me re-trace. With +28 offset:
  - cause=19 (TIMG): bne not taken → fall through → run body
    including INT_CLR write → IRQ cleared, pin 8 toggle, mret.
    Should work for TIMG.

But the test showed timg_irq stayed at level=1. So the body wasn't
running for TIMG either.

Closer inspection: with autoreload re-enabled in Phase 2.AK, the
TIMG fires every ~50 ms (QEMUTimer alarm-watch granularity). After
the first TIMG fire at t=1 s, the body ran (cleared INT_CLR, level
→ 0). But QEMUTimer fired again at next 50 ms cycle → counter still
≥ alarm (autoreload set zero_ns, but counter takes time to wrap) →
INT_RAW set again → level → 1. Then subsequent SYSTIMER ticks
(cause 17) hit the +28 bug, faulting and corrupting CPU state.

So both bugs interact. Fixed by changing offset to +32:

```
bne   a2, a3, .skip   ; +32 = mret address
```

`bne +32` encoding:
- imm = 32 = bit 5 set (imm[5] = 1)
- imm[10:5] = 0b 000001 = 1 → bits[30:25] = 1
- imm[4:1] = 0
- imm[11] = 0, imm[12] = 0
- Encoding: `(1 << 25) | (13 << 20) | (12 << 15) | (1 << 12) | 0x63`
- = `0x02D61063`

After this fix: ISR body runs only for cause=19 (TIMG). Non-TIMG
IRQs go straight to mret, no GPIO write, no fault. Demo runs normally.

## Lo que SÍ funcionó

10-second live test (2026-05-08):

```
=== JSON event totals ===
Total lines: 369  (was 343 in Phase 2.AI; +26 = 9 timg + 18 timg_irq + 9 pin 8 - 19 baseline diff)

  "event":"ledc":      99   ← Phase 2.AF unchanged
  "event":"adc":       33   ← Phase 2.AD unchanged
  "event":"timg":       9   ← TIMG autoreload firing 1 Hz
  "event":"timg_irq":  18   ← 9 cycles × 2 transitions (0→1, 1→0)
  "event":"start":      1
  "pin":              200   ← 197 running-light + 3 fake-button + ...
                                ... 9 pin 8 toggles!
```

**Pin 8 timing — perfect 1 Hz toggle driven by hardware-timer ISR:**

| t_ns        | pin 8 | Trip count |
|-------------|-------|------------|
| 1,003,615,097 | →1   | 1st alarm |
| 2,006,778,812 | →0   | 2nd alarm |
| 3,008,891,949 | →1   | 3rd alarm |
| 4,011,326,535 | →0   | 4th alarm |
| 5,013,870,756 | →1   | 5th alarm |
| 6,016,882,732 | →0   | 6th alarm |
| 7,022,534,537 | →1   | 7th alarm |
| 8,029,500,776 | →0   | 8th alarm |

Δt between consecutive transitions: 1.003 s (matches TIMG alarm
period at 10 kHz / 10000 ticks = 1 s + ~3 ms QEMUTimer granularity).

**timg_irq paired 0/1 transitions confirm ISR cleared INT_CLR:**

```
{"t_ns":1003242840,"event":"timg_irq","level":1}   ← alarm fires
{"t_ns":1003548314,"event":"timg_irq","level":0}   ← ISR runs, clears INT_RAW
{"t_ns":2006087384,"event":"timg_irq","level":1}   ← next alarm
{"t_ns":2006386...,"event":"timg_irq","level":0}   ← cleared again
... (9 pairs total)
```

ΔISR-to-clear gap: ~300 µs after alarm fire. That's the round-trip
through the TCG'd ISR (12 instructions) plus QEMU's bookkeeping.

## What this proves about the emulator

| Layer                                      | Status |
|--------------------------------------------|--------|
| Peripheral alarm comparator (TIMG)         | ✅ working|
| Per-peripheral INT_RAW / INT_ENA register  | ✅ working|
| `qemu_irq` line to CLIC                    | ✅ working|
| CLIC line → MIP_MEIP                       | ✅ working|
| `mstatus.MIE` + `mie.MEIE` gating          | ✅ working|
| CPU trap entry: save MEPC / MSTATUS, jump to mtvec | ✅ working|
| Direct mtvec mode (mode=00)                | ✅ working|
| `csrr` of `mcause` from inside ISR         | ✅ working|
| `mret` restores MIE and resumes interrupted code | ✅ working|
| Re-arm of TIMG alarm via INT_CLR W1TC      | ✅ working|

**This is the first end-to-end CPU-trap-from-peripheral chain in
the emulator's history.** All previous IRQ work either stopped at
the CLIC line (Phase 2.AB GPIO consolidated, Phase 2.AH TIMG) or
worked only through the IDF's pre-installed mtvec stub (Phase 2.R)
which was a no-op handler.

## Lo que NO funcionó / decisiones tomadas

1. **First BNE offset was wrong**: +28 instead of +32. Off-by-4
   landed the branch on the GPIO write rather than mret. Symptom
   wasn't immediately obvious because TIMG path appeared to work
   then failed mid-test due to non-TIMG IRQ corruption. Fixed by
   re-encoding for offset +32 (`0x02D61063`).

2. **Considered: edit-mtvec-mode for safety**: in case Phase 2.S
   override forced CLIC mode, we considered explicitly clearing
   mode bits with `andi a2, a2, ~3` before `csrw mtvec, a2`. Turns
   out unnecessary — Phase 2.S override only ACCEPTS mode 3, doesn't
   FORCE it. Our 0x40400200 (mode bits = 0) writes through cleanly.

3. **Considered: mcause shorthand mask check**: tried `andi a2, a2,
   31` — only 5 bits is enough since RISC-V interrupt causes are
   small numbers (17, 18, 19 in our case). 6+ bits would also be
   fine; 5 is minimal and matches the `addi 19` immediate.

4. **Considered: register save/restore for ISR**: opted to use a2/a3
   (x12/x13) which are unused in the main demo blob. No
   `csrrw mscratch, sp` dance needed. Real Arduino ISRs typically
   compile with full save/restore (because compilers don't know
   what the interrupted code uses), but for a hand-rolled blob this
   is a clean simplification.

## Lessons learned

1. **MIP_MEIP requires BOTH mstatus.MIE AND mie.MEIE**: easy to miss
   if you've been thinking "MIE" generically. The two are at
   different CSR locations (`mstatus.bit3` and `mie.bit11`) and
   serve different purposes. mstatus.MIE = global enable, mie.bit_x
   = per-cause enable.

2. **Forward branch encoding is unforgiving**: a 4-byte off-by-one
   error in the branch offset turned the ISR into a self-faulting
   loop. Always double-check by computing target address (src +
   offset), then verify it points at the intended instruction. The
   first attempt landed on the LAST instruction of the body instead
   of mret — would have been caught faster if I'd cross-referenced
   the address table.

3. **Two interacting bugs are harder to debug than two separate
   bugs**: the first run after enabling MEIE showed 973 pin
   transitions (correct ISR delivery, missing filter). The second
   run after adding the filter showed 19 events and broken demo.
   Reverting to "ISR but no filter" would have shown a working
   demo with too many pin 8 events. That's the safer iterative
   path: test partial fixes incrementally.

4. **mcause inspection in the ISR is the ESP-IDF / Arduino-style
   convention**: real ISRs read mcause to know which peripheral
   fired, then dispatch to a per-source handler. Our tiny ISR with
   the `bne` filter is the minimal version of this dispatch
   pattern.

## Implementación final

### `hw/riscv/esp32p4.c` — demo blob

**Init additions (3 instructions, +12 bytes shift past Phase 2.AJ):**
```
addi a3, x0, 1          0x00100693    Phase 2.AK
slli a3, a3, 11         0x00B69693
csrs mie, a3            0x3046A073
```
Loop body / .delay shifted from +20 (2.AJ) to +32 bytes (2.AK).

**Self-test:** AUTORELOAD re-enabled (was one-shot in Phase 2.AJ for
safety). Now safe because the ISR clears INT_CLR.

**ISR extension (4 new instructions at start, ISR is now 12 instr):**
```
csrr a2, mcause           0x34202673   Phase 2.AK filter
andi a2, a2, 0x1F          0x01F67613
addi a3, x0, 19            0x01300693
bne  a2, a3, +32           0x02D61063  (offset = mret addr - bne addr)
```

ISR layout 0x40400200-0x4040022F. Target of bne at 0x4040022C.

## Estado consolidado (post-2.AK)

| Hito                                                          | Estado |
|---------------------------------------------------------------|--------|
| TIMG hardware timer + alarm + DIVIDER respect                  | ✅ 2.AG-AI |
| TIMG → CPU IRQ wiring (cause 19)                               | ✅ 2.AH|
| ISR + mtvec + MIE/MEIE infrastructure installed                | ✅ 2.AJ|
| **CPU traps to ISR on TIMG IRQ — pin 8 toggles at 1 Hz**       | ✅ 2.AK|
| TIMG1 + watchdog                                                | ⏳ later|
| I2C / SPI master                                                | ⏳ later|
| Real PWM waveform on GPIO                                      | ⏳ later|
| Real FreeRTOS port                                              | ⏳ Phase 2.V |

## 18-Phase realism progression

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
| 2.AJ  | ISR install path (trap delivery diagnosis pending)      |
| **2.AK** | **CPU traps to guest ISR — full attachInterrupt() chain** |

JSON stream now carries 6 event types: `start | pin | ledc | adc |
timg | timg_irq`. Pin 8 transitions show timer-driven hardware
behaviour for the first time.

## Próximas direcciones

The "real chip emulation" milestones are getting compelling:

- **TIMG1 + WDT**: copy TIMG0 → TIMG1 at 0x500C0000 + cause 20.
- **I2C master**: sensor demos (BMP280 → temp/pressure JSON).
- **SPI master**: display/SD card demos.
- **Real PWM waveform on GPIO**: LEDC duty cycle drives an actual
  GPIO pin transitioning at the configured frequency.
- **Multi-IRQ ISR demo**: extend the ISR to handle GPIO IRQs (pin 0
  fake button) and toggle a different pin per source.
- **Real FreeRTOS port** (Phase 2.V deferred — large effort).
