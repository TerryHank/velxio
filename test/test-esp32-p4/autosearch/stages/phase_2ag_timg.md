# Phase 2.AG — TIMG (Timer Group) hardware timer peripheral

**Estado**: ✅ done — TIMG0 instantiated at 0x500BC000 with a 54-bit
counter, alarm comparison, periodic alarm-watch via QEMUTimer, and JSON
event emission. Self-test pre-program at machine init produces ~10
alarm events per 10-second test run.

## Goal

Add the first **programmable hardware timer** to the emulator. TIMG is
the peripheral Arduino sketches use via `timerBegin()`/`timerAlarmWrite()`/
`attachInterrupt()`. Until now the emulator only had SYSTIMER (used by
FreeRTOS tick) — no user-programmable hardware timer existed. This
phase adds:

  1. The peripheral mounted at the real silicon address.
  2. A counter that visibly advances at 1 MHz.
  3. Alarm comparison logic that fires JSON events.
  4. Periodic check via QEMUTimer so alarms fire even without guest
     polling (real silicon has continuous comparator hardware).

CPU IRQ wiring is **deferred to Phase 2.AH** — the alarm raises an
internal `INT_RAW` bit but doesn't yet trap into guest code.

## Lo que SE INVESTIGÓ

### 1. ESP32-P4 TIMG register layout

Per IDF `soc/timer_group_reg.h`:

```
DR_REG_TIMERGROUP0_BASE = 0x500BC000
DR_REG_TIMERGROUP1_BASE = 0x500C0000   (NOT modelled this phase)
```

Per timer (T0 only on P4 — single GP timer per group + a watchdog):

| Offset | Register          | Notes                                         |
|--------|-------------------|-----------------------------------------------|
| 0x00   | T0_CONFIG         | EN(31), AUTORELOAD(29), DIVIDER(21:9), ALARM_EN(10), USE_XTAL(23) |
| 0x04   | T0_LO             | low 32 bits of counter snapshot (after UPDATE)|
| 0x08   | T0_HI             | high 22 bits                                  |
| 0x0C   | T0_UPDATE         | write any → trigger snapshot                  |
| 0x10   | T0_ALARMLO        | low 32 bits of alarm                          |
| 0x14   | T0_ALARMHI        | high 22 bits                                  |
| 0x18   | T0_LOADLO         | low 32 bits of preload                        |
| 0x1C   | T0_LOADHI         | high 22 bits                                  |
| 0x20   | T0_LOAD           | write any → apply preload                     |
| 0x70   | INT_ENA_TIMERS    | bit 0 = T0 IRQ enable                         |
| 0x74   | INT_RAW_TIMERS    | bit 0 = T0 raw alarm fired                    |
| 0x78   | INT_ST_TIMERS     | bit 0 = (raw & ena)                           |
| 0x7C   | INT_CLR_TIMERS    | W1TC for raw                                  |

### 2. Counter time base — 1 MHz vs 80 MHz

Real silicon: counter increments at `APB(80MHz) / DIVIDER`. DIVIDER is
13 bits (range 1..8191). Arduino-ESP32 default:

```c
hw_timer_t *timer = timerBegin(0, 80, true);  // div = 80
// → 80 MHz / 80 = 1 MHz tick → 1 µs per count
```

So the typical "Arduino timer" runs at 1 MHz. We model the counter at
this fixed rate by computing:

```c
counter_us = (qemu_clock_get_ns(QEMU_CLOCK_REALTIME) - zero_ns) / 1000
```

The DIVIDER field is stored but ignored. Guest code that programs a
non-default divider would observe wall-clock-driven 1 MHz ticks
regardless. Document this as a known-simplification.

### 3. Alarm-check strategy

Real silicon: a comparator continuously checks `counter == alarm` and
fires an interrupt the cycle they match. Closest emulation options:

  (a) Check on every register access. ✅ Cheap, but fires only when
      guest polls. Useless if guest sets alarm-driven IRQ and stops.
  (b) QEMUTimer firing periodically, calling check_alarm. ✅ Fires
      automatically. Latency = period (we picked 50 ms).
  (c) Programmed QEMUTimer at exactly the alarm time. Most accurate
      but requires reschedule on every alarm/load write — complex.

Picked **(a) + (b)** combined: register accesses trigger immediate
checks (real-silicon-like for poll-driven code) AND a 50 ms QEMUTimer
fires regardless (catches alarms from autonomous code). This means:

  - Worst-case alarm-fire latency: 50 ms
  - Best case (guest polling): immediate

For a 1-second autoreload alarm, 50 ms latency = 5% jitter — acceptable
for the "demonstrates timer behaviour" use case.

### 4. Self-test pre-program

Phase 2.AG configures the alarm at machine init time so the JSON
stream shows TIMG events out of the box (no demo blob change needed):

```c
ms->timg0.alarm = 1000000ULL;      // 1 second
ms->timg0.load  = 0ULL;            // reload counter to 0
cfg = T0_EN | AUTORELOAD | ALARM_EN;
memcpy(&storage[T0_CONFIG], &cfg, 4);
```

Phase 2.AH will replace this with proper guest-driven programming
(once IRQ wiring exists, real Arduino sketches using `timerBegin()`
will overwrite these values).

## Lo que SÍ funcionó

**10-second live test on 2026-05-08** (same `run_phase2af_test.sh`
harness, no script change):

```
=== JSON event totals ===
Total lines: 342  (was 333 in Phase 2.AF — +9 timg events)
  "event":"ledc": 99   (Phase 2.AF, unchanged)
  "event":"adc":  33   (Phase 2.AD, unchanged)
  "event":"timg":  9   ← NEW: 1-Hz alarm via 1-second autoreload
  "event":"start": 1
  "pin":         200   (running light unchanged)
```

**Periodicity verification** (first three timg events):

| t_ns          | counter (µs) | alarm | Δt vs prev    |
|---------------|--------------|-------|---------------|
| 1,003,091,750 | 1,003,091    | 1e6   | (initial fire)|
| 2,005,835,653 | 1,002,657    | 1e6   | 1.003 s       |
| 3,008,915,763 | 1,003,003    | 1e6   | 1.003 s       |

Δt = 1.003 s confirms autoreload is working: counter resets to ~0
after each fire, then counts up to 1,000,000 again. The ~3 ms over
1 s reflects the 50-ms QEMUTimer alarm-watch granularity (alarm
samples up to 50 ms after the actual counter==alarm crossing).

Stderr also shows the `[esp32p4.timg] T0 alarm fired @ counter=...`
human-readable line per fire.

## Lo que NO funcionó / decisiones tomadas

1. **DIVIDER field ignored**: real silicon respects 13-bit divider;
   we hardcode 1 MHz. Future phase (2.AG.div) could honor it.

2. **Both groups (TIMG0+TIMG1)**: real silicon has two independent
   groups. We model only TIMG0 — TIMG1 base 0x500C0000 is empty MMIO
   and accesses there fault. Adding TIMG1 is a 5-line copy-paste
   when needed.

3. **Watchdog timer (T_WDT) skipped**: real silicon has WDT in each
   group. We don't model WDT. IDF startup writes to WDT registers
   are silently absorbed by the scratch backing store with no
   side effects.

4. **Counter UPDATE write needed in real silicon**: real ESP32-P4
   requires a write to T0_UPDATE before reading T0_LO/HI. We latch
   on every read for simplicity. Guest code that writes UPDATE first
   still works (no regression); guest code that reads without UPDATE
   gets fresh data instead of stale (bug-free direction).

5. **Non-CPU IRQ raise**: alarm sets `INT_RAW` bit but doesn't trap
   into the CPU. Phase 2.AH wires `INT_RAW & INT_ENA` to the CLIC.

## Lessons learned

1. **QEMUTimer + register-side check is the right pattern** for
   alarm-driven peripherals: cheap, catches all firing conditions,
   matches real silicon behaviour better than either alone.

2. **Self-test pre-programming at machine init is acceptable for
   peripheral-introduction phases**, with a doc-comment marking the
   transition: "Phase 2.AH will replace this with guest-driven
   programming." Avoids needing a custom test sketch just to
   exercise the new device.

3. **Dependency between init order matters**: TIMG.boot_ns + zero_ns
   must be set AFTER device realize but using values from GPIO (which
   was realized first and stamped boot_ns). The pattern matches LEDC
   and ADC; consistency here keeps the JSON timestamps in a single
   monotonic frame.

## Implementación final

### `include/hw/timer/esp32p4_timg.h` (new, ~85 LoC)

- Constants: base, IO size, register offsets, config bits.
- `ESP32P4TimgState`: storage buffer, snapshot/alarm/load uint64,
  int_raw/int_ena, zero_ns + boot_ns, event_log + throttle, and
  `QEMUTimer *alarm_watch`.

### `hw/timer/esp32p4_timg.c` (new, ~180 LoC)

- `esp32p4_timg_counter()` — compute (now - zero_ns) / 1000, mask 54.
- `esp32p4_timg_check_alarm()` — comparator + INT_RAW set + JSON
  emit (throttled) + autoreload-or-disarm logic.
- `esp32p4_timg_read()` — switch on offset, refresh snapshot for
  LO/HI/UPDATE reads, return scratch otherwise.
- `esp32p4_timg_write()` — switch on offset; ALARMLO/HI/LOAD/CONFIG
  writes have side effects, others scratch-only.
- `esp32p4_timg_alarm_watch_cb()` — periodic 50 ms QEMUTimer:
  refresh + check + reschedule.
- Standard QOM realize/reset/class_init boilerplate.

### `hw/timer/meson.build`

Added `esp32p4_timg.c` to the `CONFIG_RISCV_ESP32P4` source list.

### `hw/riscv/esp32p4.c`

- `#include "hw/timer/esp32p4_timg.h"`.
- `ESP32P4TimgState timg0` field in machine state.
- Init block instantiating + mounting at 0x500BC000, sharing event_log
  + boot_ns + zero_ns with GPIO.
- Self-test pre-program: alarm=1e6, autoreload, T0_EN.
- Init log message updated to mention TIMG0.

## Estado consolidado (post-2.AG)

| Hito                                                          | Estado |
|---------------------------------------------------------------|--------|
| UART hello world                                              | ✅     |
| GPIO output + ENABLE multiplexer + JSON channel               | ✅ 2.W |
| GPIO IRQ (latched status, edge filter, shared CPU IRQ)        | ✅ 2.AB|
| LEDC PWM single-channel duty events                           | ✅ 2.AC|
| ADC analog samples → LEDC pipeline                            | ✅ 2.AD|
| LEDC 2-channel crossfade                                       | ✅ 2.AE|
| LEDC 3-channel rainbow                                         | ✅ 2.AF|
| **TIMG0 hardware timer + alarm + JSON event**                  | ✅ 2.AG|
| TIMG alarm → CPU IRQ                                           | ⏳ 2.AH|
| TIMG1 + watchdog                                               | ⏳ later |
| Real PWM waveform on GPIO                                     | ⏳ later |
| I2C master / SPI master                                        | ⏳ later |
| Real FreeRTOS port                                             | ⏳ Phase 2.V |

## 14-Phase realism progression

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
| **2.AG** | **TIMG hardware timer + alarm comparator**            |

JSON stream now carries 5 event types (start, pin, ledc, adc, **timg**).

## Próximas direcciones

- **Phase 2.AH** (highest priority): wire TIMG INT_RAW bit to CLIC
  CPU IRQ line. Then real Arduino `attachInterrupt(timer, isr, EDGE)`
  works end-to-end.
- **Phase 2.AG.div**: respect the DIVIDER field (currently hardcoded
  to 1 MHz).
- **Phase 2.AG.timg1**: copy TIMG0 to TIMG1 at 0x500C0000.
- I2C master, SPI master — sensor demos.
- Real FreeRTOS port (Phase 2.V deferred).
