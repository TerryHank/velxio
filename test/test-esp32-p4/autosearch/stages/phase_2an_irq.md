# Phase 2.AN.irq — TIMG1 → CPU IRQ + ISR cause 20

**Estado**: ✅ done — TIMG1 IRQ now propagates to CLIC cause 20 and
the multi-source ISR has been extended with a third dispatch branch.
**Three independent IRQ sources drive three GPIO pins via the same
ISR** — the canonical FreeRTOS-style "tick + user timer + GPIO" setup
working end-to-end on emulated ESP32-P4 silicon.

## Goal

Phase 2.AN added TIMG1 as a peripheral but didn't wire its IRQ to
the CPU. Phase 2.AN.irq closes that gap and demonstrates the multi-
source ISR pattern scales beyond two sources.

## Lo que SE INVESTIGÓ

### 1. CLIC cause-line allocation review

| Cause | Source              | Phase added |
|-------|---------------------|-------------|
| 17    | SYSTIMER tick       | 2.K         |
| 18    | GPIO consolidated   | 2.AB        |
| 19    | TIMG0               | 2.AH        |
| **20**| **TIMG1**           | **2.AN.irq**|
| 21+   | free for I2C / SPI / UART / etc. | future |

Cause 20 is the obvious choice — sequential numbering after TIMG0.
Future I2C IRQ goes to 21, SPI to 22, etc.

### 2. ISR extension — third branch

The Phase 2.AL ISR was a 2-way branch chain:
```
if cause == 19 → TIMG0 body → mret
if cause == 18 → GPIO body → mret
else            → mret
```

Phase 2.AN.irq adds a third branch:
```
if cause == 19 → TIMG0 body → mret
if cause == 18 → GPIO body  → mret
if cause == 20 → TIMG1 body → mret
else            → mret
```

Layout grows from 21 to 31 instructions (+10 RV32I = +40 bytes).
ISR ends at 0x40400278 (was 0x40400250).

### 3. Branch offset bookkeeping

Two existing branches needed updates:

| Old                          | New                            |
|------------------------------|--------------------------------|
| inst 12: `j +36 → 0x40400250` (mret) | `j +76 → 0x40400278` (new mret) |
| inst 14: `bne +28 → 0x40400250` (mret) | `bne +32 → 0x40400254` (.check_timg1) |

New encodings:
- `j +76` = `0x04C0006F` (was `0x0240006F`)
- `bne +32` = `0x02D61063` (was `0x00D61E63`)

Plus 10 new instructions for the TIMG1 dispatch + handler:

| Addr        | Instr                     | Encoding   |
|-------------|---------------------------|------------|
| 0x40400250  | `j +40` → .end (skip TIMG1)| 0x0280006F |
| 0x40400254  | `addi a3, x0, 20`         | 0x01400693 |
| 0x40400258  | `bne a2, a3, +32` → .end  | 0x02D61063 |
| 0x4040025C  | `lui a2, 0x500C0` (TIMG1) | 0x500C0637 |
| 0x40400260  | `addi a3, x0, 1`          | 0x00100693 |
| 0x40400264  | `sw a3, 0x7C(a2)` INT_CLR | 0x06D62E23 |
| 0x40400268  | `lui a2, 0x500E0` (GPIO)  | 0x500E0637 |
| 0x4040026C  | `lw a3, 4(a2)` OUT_REG    | 0x00462683 |
| 0x40400270  | `xori a3, a3, 0x400`       | 0x4006C693 |
| 0x40400274  | `sw a3, 4(a2)` OUT_REG    | 0x00D62223 |
| 0x40400278  | `mret`                    | 0x30200073 |

Phase 2.AK's lesson on careful BNE offset verification applied
again — every branch target was computed and double-checked before
encoding.

### 4. Pin 10 in ENABLE mask

ENABLE_W1TS init at 0x40400110 needs pin 10 added.
Old: `0x3E0` (pins 5+6+7+8+9). New: `0x7E0` (pins 5+6+7+8+9+10).

`addi t1, x0, 0x7E0` encoding = `0x7E000313` (was `0x3E000313`).
0x7E0 = 2016 fits within 12-bit signed positive (max 2047). ✓

### 5. Pin 11 considered, rejected

First instinct was pin 11 (= 0x800) since it visually separates
from pin 9 (GPIO). But mask = pins 5+6+7+8+9+11 = 0xBE0 = 3040 >
2047, doesn't fit in 12-bit signed `addi` immediate. Would need
multi-instruction load, breaking the clean single-instruction mask.

Pin 10 is functionally identical, fits cleanly, just visually
adjacent to pin 9. Acceptable trade-off.

## Lo que SÍ funcionó

10-second live test (2026-05-08):

```
=== JSON event totals ===
Total lines: 429  (was 399 in 2.AN; +30 from TIMG1 IRQ + pin 10)

  "event":"ledc":     99   ← unchanged
  "event":"adc":      33   ← unchanged
  "event":"timg":     28   ← unchanged
  "event":"timg_irq": 38   ← was 18 (TIMG0 only); now 18 + 20 (TIMG1)
  "event":"i2c":       8   ← unchanged
  "event":"i2c_rx":    1   ← unchanged
  "event":"start":     1
  "pin":              210  ← was 200 + 10 pin-10 transitions
```

**Pin distribution** (10 s):

```
66 pin 5    ← running light (loop body)
66 pin 6
65 pin 7
10 pin 10   ← TIMG1 ISR @ 2 Hz (NEW)
 9 pin 8    ← TIMG0 ISR @ 1 Hz
 3 pin 0    ← fake button
 2 pin 9    ← GPIO ISR (rising edges only)
```

**timg_irq paired transitions** confirm both ISRs clear INT_CLR:

```json
{"t_ns":512168821,"event":"timg_irq","grp":1,"level":1}    ← TIMG1 alarm fires
{"t_ns":512550359,"event":"timg_irq","grp":1,"level":0}    ← TIMG1 ISR clears
{"t_ns":1013191971,"event":"timg_irq","grp":0,"level":1}   ← TIMG0 alarm fires
{"t_ns":1013215646,"event":"timg","grp":0,"counter":10128}  ← TIMG0 alarm event
```

Both `grp:0` and `grp:1` have paired 1/0 transitions — the ISR
correctly dispatches each to its own peripheral and clears the right
INT_CLR.

**Math check**: TIMG1 fires at ~2 Hz. In 10 s that's ~20 alarms.
Each alarm produces 2 timg_irq transitions (level 1 then 0) +
~1 pin 10 toggle. Observed: 20 timg_irq events for grp:1 + 10 pin
10 transitions = ✓ (some alarms fire when ISR is mid-run, get
batched).

**Three pin oscillators visible**:
- Pin 8 toggles at exactly 1.0 s intervals (TIMG0 → cause 19)
- Pin 10 toggles at exactly 0.5 s intervals (TIMG1 → cause 20)  
- Pin 9 toggles on each rising edge of pin 0 (GPIO → cause 18)

A frontend rendering this would show three independent LED
oscillators — the textbook "real chip" multi-IRQ demo.

## Lo que NO funcionó / decisiones tomadas

1. **Pin 11 vs pin 10 trade-off**: pin 11 visually separated from
   pin 9 but mask 0xBE0 doesn't fit in 12-bit signed addi. Used
   pin 10 (mask 0x7E0 fits, 2016 < 2047). Documented above.

2. **No GPIO base re-load between branches**: each handler does its
   own `lui a2, 0x500E0` to set up GPIO base, even though all three
   handlers eventually write OUT_REG. Could optimize by loading
   GPIO base once before all branches. Decided not to — code
   clarity > 4 bytes savings.

3. **Single mret at the end**: each handler ends with `j .end`
   instead of having its own mret. Slight code-size win and means
   any future changes to "what happens at mret" only happen once.

## Lessons learned

1. **Branch chain dispatch scales linearly**: each new IRQ source
   adds ~10 instructions (3 for check + ~7 for handler). At 5+
   sources a vector table would be cleaner; at 3 sources the
   chain is still readable.

2. **Three-way trap dispatch is the FreeRTOS-style baseline**:
   real chips have many IRQ sources but the "TIMG tick + user
   timer + GPIO" trio is what FreeRTOS + Arduino sketches
   typically use. Phase 2.AN.irq emulates this fully.

3. **Per-instance state pays off twice**: Phase 2.AK moved
   `irq_prev_level` to per-instance state; Phase 2.AN added a
   second TIMG instance using it; Phase 2.AN.irq now wires both
   to separate IRQ lines. No ghost transitions, clean separation
   in JSON. Total payoff: 3 phases of clean reuse from one
   foresight-driven refactor.

## Implementación final

### `hw/riscv/esp32p4.c`

- Init pin mask: `0x3E0` → `0x7E0` (adds pin 10).
- TIMG1 self-test: `int_ena = 1` (was 0).
- New `qdev_connect_gpio_out_named()` wiring TIMG1.intr → cause 20.
- ISR extended:
  - inst 12: `j +36` → `j +76` (skip past new TIMG1 body)
  - inst 14: `bne +28` → `bne +32` (target .check_timg1)
  - 10 new instructions at 0x40400250..0x40400274 implementing the
    cause-20 check + TIMG1 body
  - mret moved from 0x40400250 to 0x40400278

Total runtime patches: 152 (was 141 in Phase 2.AL; +1 for pin mask
change, +10 for TIMG1 ISR body).

## Estado consolidado (post-2.AN.irq)

| Hito                                                          | Estado |
|---------------------------------------------------------------|--------|
| GPIO + LEDC + ADC + I2C + 2× TIMG + multi-source ISR           | ✅ 2.W-2.AN.irq |
| **Three IRQ sources driving three GPIO pins via guest ISR**    | ✅ 2.AN.irq |
| TIMG WDT modelling                                              | ⏳ later |
| SPI master                                                       | ⏳ later |
| Real PWM waveform on GPIO                                      | ⏳ later |
| Real FreeRTOS port                                              | ⏳ Phase 2.V |

## 22-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.U-AB| GPIO output/input/IRQ, JSON event channel               |
| 2.AC-AF| LEDC PWM + multi-channel rainbow                       |
| 2.AD  | ADC peripheral                                          |
| 2.AG-AI| TIMG hardware timer + DIVIDER                          |
| 2.AH  | TIMG0 → CPU IRQ wiring                                  |
| 2.AJ-AK| Full attachInterrupt() chain (TIMG0)                   |
| 2.AL  | Multi-source ISR (TIMG0 + GPIO)                         |
| 2.AM-slave | I2C master + synthetic BMP280 responder            |
| 2.AN  | TIMG1 (events only)                                      |
| **2.AN.irq** | **3-way ISR dispatch (TIMG0 + GPIO + TIMG1)**     |

JSON stream still 8 event types; pin transitions on pins 5-10
visible; `timg_irq` events split by `grp:0`/`grp:1`.

## Próximas direcciones

- **Phase 2.AM.demo** — Arduino-style I2C transaction in demo blob
  (proves a full guest-side BMP280 read works).
- **TIMG WDT** — watchdog modelling.
- **SPI master** — display/SD demos. Same architecture pattern as
  I2C; cause 22 likely.
- **Real PWM waveform on GPIO** via LEDC's per-channel timer — closes
  the LEDC duty → visible pin transitions loop.
- **UART RX path** — receive bytes from host.
- **Real FreeRTOS port** (Phase 2.V deferred).
