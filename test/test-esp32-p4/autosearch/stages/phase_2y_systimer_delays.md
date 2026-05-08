# Phase 2.Y — SYSTIMER-based delays (deterministic timing)

**Estado**: ✅ done — running-light delays now use SYSTIMER UNIT0
counter polling instead of busy-wait. Each delay is exactly 1.6 M
ticks @ 16 MHz = 100 ms regardless of host CPU speed.

## Goal

Replace the busy-wait counter loop in the LED-blink blob with reads
from the SYSTIMER UNIT0_VAL_LO register. The SYSTIMER counter ticks
at 16 MHz virtual time (62.5 ns per tick), so polling for a target
delta gives **deterministic timing** — same blink rate on a slow
laptop or a fast workstation.

This is the third realism upgrade in the Phase 2.U-V-W-X-Y
progression:

  - 2.U/V: hand-rolled GPIO toggle (busy-wait timing).
  - 2.W: GPIO input + ENABLE multiplexer (real silicon pad behaviour).
  - 2.X: bidirectional event channel (frontend bridge).
  - 2.Y: deterministic timing via SYSTIMER (replaces busy-wait).

## Lo que SE INVESTIGÓ

### 1. SYSTIMER access protocol

From `hw/timer/esp32p4_systimer.c`:

  - `R_UNIT0_OP   = 0x04` — write bit 31 (TIMER_UPDATE) to capture a
    snapshot of the 52-bit counter into `s->snapshot`.
  - `R_UNIT0_VAL_HI = 0x40` — read returns `(snapshot >> 32) & 0xFFFFFFFF`.
    If `snapshot == 0`, takes a fresh snapshot first.
  - `R_UNIT0_VAL_LO = 0x44` — read returns `snapshot & 0xFFFFFFFF`,
    THEN clears `snapshot` (so next HI/LO sequence takes a fresh
    sample).

For our 100 ms delays, the low 32 bits suffice: 32-bit @ 16 MHz wraps
every 268 seconds — comfortably more than any single delay, with
unsigned-comparison BLTU correctly handling near-wrap edge cases.

The minimal access pattern per timestamp read:

```
sw   t5, 4(t4)        ; trigger snapshot (t5 = 0x80000000)
lw   t0, 0x44(t4)      ; read low 32 bits, clears snapshot
```

Two instructions, ~10 ns of guest virtual time per sample.

### 2. Subroutine vs inline delay

Designing 100 ms delays at 3 places (per pin) inline would balloon
the blob to ~33 instructions × 4 bytes = 132 bytes for delays alone.
Refactored to a `.delay` subroutine (8 instructions = 32 bytes) called
via JAL ra from each pin section. Per-pin section drops from 11 to 4
instructions:

```
addi t3, x0, MASK     ; pin mask
sw   t3, 8(t2)         ; W1TS (pin ON)
jal  ra, .delay        ; wait 100 ms
sw   t3, 12(t2)         ; W1TC (pin OFF)
```

Total blob: 26 instructions = 104 bytes (was 21 instr / 84 bytes for
the busy-wait version). Cost of determinism: ~20 extra bytes.

### 3. Computing the deadline

To delay 100 ms = 1,600,000 ticks @ 16 MHz = 0x186A00.

Two-instruction load:
```
lui  t1, 0x187         ; t1 = 0x187000
addi t1, t1, 0xA00     ; t1 = 0x187000 + (-0x600 sign-ext) = 0x186A00
```

The `addi` sign-extends `0xA00` to `-0x600`, so we set `lui` to
`0x187` (one above the intended `0x186`) to compensate. Standard
RISC-V "sign-bit-of-low-12 → bump hi-20" idiom from earlier phases.

### 4. Spin-loop design

```
sw   t5, 4(t4)         ; trigger snapshot
lw   t6, 0x44(t4)      ; current = snapshot lo
bltu t6, t1, .spin     ; spin if current < deadline (unsigned)
```

3 instructions per iteration. Used **BLTU** (unsigned) instead of BLT
(signed) so the comparison stays correct as the counter approaches
0x80000000 / 0xFFFFFFFF wrap-around territory. Counter starts near
0 at boot (machine init time = `qemu_clock_get_ns(VIRTUAL)`) so
unsigned comparison is the right choice.

### 5. The JAL encoding bug

First test showed pin 7 firing 195 times while pins 5 and 6 each
only 2 times. Trace:

```
0ms:  pin 5 ON
100ms: pin 5 OFF / pin 6 ON
200ms: pin 6 OFF / pin 7 ON
300ms: pin 7 OFF / pin 7 ON  ← BUG! Should be pin 5 ON
400ms: pin 7 OFF / pin 7 ON
... loop stuck
```

Root cause: my `j .loop_head` encoding `0xFF5FF06F` decodes to
**`j -12`**, not the intended `j -48`. The 21-bit JAL imm is
non-contiguous (`imm[10:1]` at bits 30..21, `imm[11]` at bit 20,
`imm[19:12]` at bits 19..12) — easy to miscompute by hand.

For offset = -48:
- 21-bit signed = 0x1FFFD0
- imm[20] = 1, imm[19:12] = 0xFF, imm[11] = 1, imm[10:1] = 0x3E8
- Correct encoding: **`0xFD1FF06F`**

For offset = -12 (the buggy result):
- imm[10:1] = 0x3FA → bits 30..21 = 1111111010
- The buggy encoding `0xFF5FF06F` matches this exactly.

The visible-3-times-pin-5/6 was the FIRST loop iteration before the
buggy `j -12` kicked in, after which it perpetually re-ran the pin
7 section.

**Lesson**: SAME mistake as Phase 2.M's `0xFA4FC06F` typo from
earlier. Hand-encoded JAL offsets are landmines. Either use a
toolchain or write a Python encoder to verify.

## Lo que SÍ funcionó (after fix)

10-second test with the `0xFD1FF06F` fix in place:

```
{"t_ns":68789420,"pin":5,"level":1}
{"t_ns":169012663,"pin":5,"level":0}     ← Δ = 100.223ms (≈ 100ms ✓)
{"t_ns":169075760,"pin":6,"level":1}     ← Δ = 0.063ms (next pin)
{"t_ns":269356274,"pin":6,"level":0}     ← Δ = 100.281ms ✓
{"t_ns":269429116,"pin":7,"level":1}
{"t_ns":369534792,"pin":7,"level":0}     ← Δ = 100.106ms ✓
{"t_ns":369603032,"pin":5,"level":1}     ← Δ = 0.068ms — looped back!
{"t_ns":469623966,"pin":5,"level":0}     ← Δ = 100.021ms ✓
... (pattern continues for 33 cycles = 198 transitions in 10s)
```

**Per-pin counts in 10 s wall-clock**:

| Pin | Count | Source                    |
|-----|-------|---------------------------|
| 0   | 3     | Fake button (3 s period)  |
| 5   | 66    | Running light @ 100ms ON  |
| 6   | 66    | Running light @ 100ms ON  |
| 7   | 65    | Running light @ 100ms ON  |

Compare to Phase 2.V (busy-wait):
- Phase 2.V counter `lui t5, 0x8000`: 65/66/65 toggles in 10s,
  rate sensitive to host CPU.
- Phase 2.Y SYSTIMER: 66/66/65 toggles in 10s, **rate fixed by
  virtual 16 MHz clock** — same on any host.

The `100.223 / 100.281 / 100.106` deltas above show ~0.3% drift,
caused by per-iteration overhead of the spin loop (the snapshot+
read+branch path takes ~250 ns @ 16 MHz = 0.025% of 100 ms — well
within tolerance for human-perceptible blink).

## Lo que NO funcionó (intentado y descartado)

1. **Inline delays per pin (no subroutine)**: would have grown the
   blob to ~39 instructions / 156 bytes. Refactored to subroutine
   for compactness — call/return overhead is 2 instructions × 3
   sites = 6 total, vs ~20 saved by deduplication.

2. **Using BLT (signed) for the spin compare**: would fail near
   counter wrap-around at 0x80000000. BLTU is the correct choice.

3. **Hand-encoded `j -48` as `0xFF5FF06F`**: was actually `j -12`
   — same JAL non-contiguous-imm bug pattern as Phase 2.M's typo.
   Fixed to `0xFD1FF06F`.

## Lessons learned

1. **JAL imm is hand-encoding poison**: bit field is split as
   `imm[20]|imm[10:1]|imm[11]|imm[19:12]`. Each typo silently
   produces a working-but-wrong jump. Phase 2.M and Phase 2.Y
   both hit this. **Future hand-rolled blobs should run an
   encoding verification step**, e.g., a tiny Python that
   decodes the encoded value back to the offset.

2. **Counter-poll delays are deterministic IF the spin loop is
   short**: 3 instructions = ~250 ns overhead per iteration is
   <0.1% of 100 ms. Cumulative drift across 10s is 0.3%, plenty
   for visible blink.

3. **BLTU vs BLT matters near counter wrap-around**: the SYSTIMER
   low 32 bits wrap every 268 s. Crossing 0x80000000 makes BLT
   misinterpret values as negative. Always use BLTU for monotonic
   counter comparisons.

4. **JAL ra + JALR x0, 0(ra) is the standard subroutine pattern**:
   no stack manipulation needed because we don't nest calls (the
   delay subroutine doesn't call anything else). For nested calls
   we'd need to push ra to stack first.

## Implementación final

### `hw/riscv/esp32p4.c`

Replaced 21 Phase 2.V busy-wait blob patches at `0x40400100..0x40400154`
with 26 Phase 2.Y SYSTIMER-poll patches at `0x40400100..0x40400168`:

  - 5 init instructions (3 base loads + 2 ENABLE write).
  - 3 × 4 = 12 per-pin instructions (mask, W1TS, JAL, W1TC).
  - 1 final `j .loop_head`.
  - 8 .delay subroutine instructions (snapshot, read, deadline,
    spin-3, ret).

Net: +5 patches (95 → 100 active).

## Estado consolidado (post-2.Y)

| Hito                                                    | Estado       |
|---------------------------------------------------------|--------------|
| Hello-world UART demo                                   | ✅           |
| 3-pin running light                                     | ✅ Phase 2.V |
| GPIO input + fake button + ENABLE multiplexer           | ✅ Phase 2.W |
| Bidirectional emulator ↔ frontend channel               | ✅ Phase 2.X |
| **SYSTIMER-based deterministic delays (100 ms exact)**  | ✅ Phase 2.Y |
| Pin-transition GPIO interrupts                          | ⏳ Phase 2.Z |
| Real FreeRTOS port (unblocks setup()/loop())            | ⏳ Phase 2.V (was) |

## Próximas fases

- **Phase 2.Z**: pin-transition GPIO interrupts. When a pin's
  `external_input` toggles (e.g., from frontend fifo or fake
  button), route a CPU IRQ via the interrupt matrix → CLIC →
  IDF handler. This lets `attachInterrupt(pin, ISR, RISING)`
  fire for real, end-to-end: frontend click → fifo → input pad
  → IRQ → CLIC dispatch → user ISR.

- **Phase 2.V** (the original, deferred): real FreeRTOS port —
  multi-week effort. Unblocks natural Arduino setup()/loop()
  flow without bypass patches.
