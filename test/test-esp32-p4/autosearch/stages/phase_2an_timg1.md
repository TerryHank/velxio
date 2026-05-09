# Phase 2.AN — TIMG1 (second timer group) at 0x500C0000

**Estado**: ✅ done — second timer group instantiated symmetric to
TIMG0. Different alarm period (500 ms vs 1 s) so JSON streams from
the two groups are distinguishable both by `grp` field and firing
rate. CPU IRQ NOT wired (cause 20 has no ISR handler yet — Phase
2.AN.irq later).

## Goal

Real ESP32-P4 has two identical timer groups (TIMG0 + TIMG1). FreeRTOS
tick uses TIMG1 by convention; user-space `timerBegin()` typically
uses TIMG0. Phase 2.AG/AH built TIMG0 — this phase adds the symmetric
TIMG1.

Beyond completeness, this phase also serves as a "device class
reusability" test: instantiating ESP32P4TimgState twice should work
without static-variable bugs or per-instance state mishaps.

## Lo que SE INVESTIGÓ

### 1. ESP32-P4 second timer group address

Per IDF `soc/reg_base.h`:

```
DR_REG_TIMERGROUP1_BASE = HPPERIPH1 + 0x10000 = 0x500C0000
```

Same register layout as TIMG0 (Phase 2.AG). Single GP timer T0 +
watchdog (we don't model the WDT side).

### 2. Group-number distinguishing in JSON

Phase 2.AG hardcoded `"grp":0` in two places:

```c
fprintf(s->event_log, "{\"t_ns\":%lld,\"event\":\"timg\","
        "\"grp\":0,...");
fprintf(s->event_log, "{\"t_ns\":%lld,\"event\":\"timg_irq\","
        "\"grp\":0,...");
```

For TIMG1 we need `"grp":1`. Solution mirrors I2C's `port_num`:
add `uint8_t group_num` to ESP32P4TimgState. Each instance gets its
own group_num set by machine init. Format strings use `s->group_num`
instead of literal 0.

Stderr human-readable lines also updated: `[esp32p4.timg0]` and
`[esp32p4.timg1]` instead of just `[esp32p4.timg]`.

### 3. Choosing TIMG1's self-test parameters

Goal: events from the two groups should be visually distinguishable
in the JSON stream. Two options:

  (a) Same period as TIMG0 (1 s), distinguished only by `grp` field.
  (b) Different period (500 ms) so events from TIMG1 fire at 2 Hz
      while TIMG0 fires at 1 Hz.

Picked **(b)** — the JSON stream now shows interleaved events at
different rates, giving the frontend a more interesting demo and
also catching any "shared static state" bugs (events from one
instance bleeding into the other).

Self-test config:
```
DIVIDER = 8000  → 10 kHz tick     (same as TIMG0 for consistency)
ALARM   = 5000  → 500 ms             (vs TIMG0's 10000 = 1 s)
T0_EN | AUTORELOAD | ALARM_EN
```

### 4. Why no CPU IRQ wiring this phase

The natural CLIC cause for TIMG1 would be 20 (cause 17 = SYSTIMER,
18 = GPIO, 19 = TIMG0). But the multi-source ISR (Phase 2.AL) only
handles causes 18 and 19 — cause 20 would fall through to mret
without clearing TIMG1's INT_RAW. The IRQ would stay asserted and
re-fire continuously, drowning out everything.

Two options:
  (a) Wire IRQ + extend ISR to handle cause 20 (toggle pin 11?)
  (b) Skip IRQ wiring; let TIMG1 fire alarms but stay invisible to
      CPU

Picked **(b)** — Phase 2.AN is just the TIMG1 device addition, not
a full ISR refactor. Phase 2.AN.irq will:
  1. Connect TIMG1.intr → cause 20
  2. Extend ISR with a third branch for cause 20
  3. Toggle pin 11 (or similar)

Setting `int_ena = 0` in TIMG1's self-test ensures the IRQ never
propagates to the CLIC, even though the alarm fires and emits
JSON events.

## Lo que SÍ funcionó

10-second live test (2026-05-08):

```
=== JSON event totals ===
Total lines: 399  (was 380 in 2.AM.slave; +19 from TIMG1)

  "event":"ledc":     99   ← unchanged
  "event":"adc":      33   ← unchanged
  "event":"timg":     28   ← was 9, now 9 (TIMG0) + 19 (TIMG1)
  "event":"timg_irq": 18   ← unchanged (only TIMG0 propagates)
  "event":"i2c":       8   ← unchanged
  "event":"i2c_rx":    1   ← unchanged
  "event":"start":     1
  "pin":              200
```

Sample showing both groups firing:

```json
{"t_ns":541367516, "event":"timg","grp":1,"counter":5412,"alarm":5000}  ← TIMG1 @ ~0.5s
{"t_ns":1042967210,"event":"timg_irq","grp":0,"level":1}                 ← TIMG0 IRQ
{"t_ns":1043010843,"event":"timg","grp":0,"counter":10426,"alarm":10000} ← TIMG0 @ ~1s
{"t_ns":1043040873,"event":"timg","grp":1,"counter":5014,"alarm":5000}  ← TIMG1 @ ~1s
```

The interleaving is exactly what we want: TIMG1 fires at 0.5/1.0/1.5/...
seconds; TIMG0 fires at 1.0/2.0/3.0/... seconds. They momentarily
align at integer seconds (when both have their alarms expire).

Stderr distinguishes:

```
[esp32p4.timg0] T0 alarm fired @ counter=10016
[esp32p4.timg1] T0 alarm fired @ counter=5009
[esp32p4.timg1] T0 alarm fired @ counter=5005
```

### Math check

TIMG1: 19 events in 10 s = ~1.9 Hz ≈ 2 Hz expected. ✓
TIMG0: 9 events in 10 s = ~0.9 Hz ≈ 1 Hz expected. ✓

Slight under-rate on both: alarm-watch QEMUTimer runs every 50 ms,
so events lag by up to 50 ms. Over 10 s = ~5% loss = fits.

Phase 2.AH's `irq_prev_level` is per-instance (Phase 2.AK lesson
applied), so TIMG1 has its own — confirms via clean operation
without IRQ ghost-bleeding from TIMG0.

## Lo que NO funcionó / decisiones tomadas

1. **No CPU IRQ wiring**: explained above. Phase 2.AN.irq adds it.

2. **No watchdog (WDT) modelling**: real silicon has WDT in each
   group at offsets ~0xA8+ (per IDF). We don't model them.
   IDF startup writes to WDT registers are silently absorbed by
   the scratch backing store — same behaviour as Phase 2.AG.
   Adding WDT would require modelling the count-down + reset
   action. Deferred.

3. **TIMG1 instance reuses TYPE_ESP32P4_TIMG**: same QEMU
   device class, two instances. This is the right pattern.
   Caught one issue early — Phase 2.AH's `irq_prev_level` was
   already moved out of `static` into the device state precisely
   for this scenario, so adding TIMG1 was clean.

4. **Different periods over identical**: see "what was investigated"
   #3. Stress-tests visual distinguishability + state isolation.

## Lessons learned

1. **Adding a second instance validates the device class**: bugs
   like "shared static prev_level" would show up immediately as
   ghost transitions. Phase 2.AK proactively fixed this; Phase
   2.AN is the proof of value.

2. **Group/port number in JSON is a 1-line change after refactor**:
   replacing `"grp":0` with `"grp":%u, ..., s->group_num` is
   trivial. The pattern recurs (I2C had port_num, now TIMG has
   group_num) — future peripherals should add the field at design
   time rather than retrofit.

3. **Alarm-watch QEMUTimer 50 ms granularity matters at 2 Hz**:
   at 1 Hz, the 50 ms slack is 5% of the period — fine. At 2 Hz
   it's 10% — visible drift. Phase 2.AN uses 500 ms still gives
   acceptable accuracy. If we ever want 100 ms or shorter alarms
   we'd need a finer-grained QEMUTimer.

## Implementación final

### `include/hw/timer/esp32p4_timg.h`

- Added `uint8_t group_num` field to ESP32P4TimgState.

### `hw/timer/esp32p4_timg.c`

- Replaced hardcoded `"grp":0` (2 occurrences) with `s->group_num`.
- Stderr lines now use `[esp32p4.timg%u]` with the group number.

### `hw/riscv/esp32p4.c`

- Added `ESP32P4TimgState timg1` to machine state.
- Set `timg0.group_num = 0` in existing init block.
- New init block for TIMG1 at 0x500C0000 with `group_num = 1`,
  alarm 500 ms, `int_ena = 0` (no IRQ wiring).
- Init log message updated to mention TIMG1.

## Estado consolidado (post-2.AN)

| Hito                                                          | Estado |
|---------------------------------------------------------------|--------|
| GPIO + LEDC + ADC + I2C + ISR chain                            | ✅ 2.W-AM.slave |
| TIMG0 + alarm + IRQ + ISR                                      | ✅ 2.AG-AL |
| **TIMG1 (events only — no CPU IRQ)**                           | ✅ 2.AN |
| TIMG1 → CPU IRQ (cause 20)                                     | ⏳ 2.AN.irq |
| Watchdog (WDT) in either group                                 | ⏳ later |
| SPI master                                                       | ⏳ later |
| Real PWM waveform on GPIO                                      | ⏳ later |
| Real FreeRTOS port                                              | ⏳ Phase 2.V |

## 21-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.U-AB| GPIO output/input/IRQ, JSON event channel               |
| 2.AC-AF| LEDC PWM + multi-channel rainbow                       |
| 2.AD  | ADC peripheral                                          |
| 2.AG-AI| TIMG hardware timer + DIVIDER                          |
| 2.AH  | TIMG → CPU IRQ wiring                                   |
| 2.AJ-AK| Full attachInterrupt() chain (TIMG only)               |
| 2.AL  | Multi-source ISR (TIMG + GPIO)                          |
| 2.AM-slave | I2C master + synthetic BMP280 responder            |
| **2.AN** | **TIMG1 — second timer group (events only)**          |

JSON stream still carries 8 event types; `grp:0` and `grp:1`
distinguish the two timer groups within the `timg` and `timg_irq`
events.

## Próximas direcciones

- **Phase 2.AN.irq**: wire TIMG1.intr → cause 20, extend ISR with
  a third branch (cause 18 → pin 9, cause 19 → pin 8, cause 20 →
  pin 11). Demonstrates "two independent hardware timers driving
  two GPIO pins via ISRs" — the canonical FreeRTOS-style multi-
  timer setup.
- **TIMG WDT** (watchdog) modelling.
- **SPI master** — sensor-stream/display demos.
- **Real PWM waveform on GPIO** via LEDC timer.
- **FreeRTOS port** (Phase 2.V deferred).
