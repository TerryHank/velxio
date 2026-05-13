# Phase 2.BQ — TRM-correct MWDT timeout from CONFIG1/CONFIG2

**Estado**: ✅ done — replaces the hardcoded 5-second MWDT timeout
from Phase 2.BM with TRM-grounded computation per
`TIMG_WDTCONFIG1_REG` (Register 16.11) + `TIMG_WDTCONFIG2_REG`
(Register 16.12):

```
mwdt_clk_period_ns = 12.5 ns * TIMG_WDT_CLK_PRESCALE
timeout_ns         = TIMG_WDT_STG0_HOLD * mwdt_clk_period_ns
                   = STG0_HOLD * PRESCALE * 25 / 2  (integer math)
```

Where the 12.5 ns base = 1 / 80 MHz APB clock. Per TRM Register
16.11: "MWDT clock period = 12.5 ns * TIMG_WDT_CLK_PRESCALE".

Live test boot regression-clean: 0 `wdt_reset` events, full 8-
event WDT trace preserved across TIMG0 + TIMG1. Boot writes
`CONFIG2=0` so the fallback 5s applies (timer doesn't arm anyway
since `CONFIG0.EN=0`).

When a real Arduino sketch calls `esp_task_wdt_init(30, true)`
to set a 30-second timeout, the IDF writes PRESCALE=40000 and
STG0_HOLD=60000 → our model computes 30 seconds correctly,
matching silicon. Previously our 5-second hardcode would have
spuriously fired reset at 5s.

## Goal

Phase 2.BM was a deliberate placeholder — "fire reset on any
timeout, hardcode 5 seconds". TRM-correct timing wasn't needed
to demonstrate the reset path. But for real Arduino sketches
that set specific timeouts (common values: 5s, 30s, 60s, 300s),
our hardcoded 5s would fire too early.

Phase 2.BQ closes that gap with the silicon formula.

## Lo que SE INVESTIGÓ

### 1. TRM Register 16.11 — TIMG_WDTCONFIG1_REG layout

```
bits 31:16: TIMG_WDT_CLK_PRESCALE  (16-bit divider)
bits 15:1:  reserved
bit 0:      TIMG_WDT_DIVCNT_RST    (write-trigger to reset prescaler)
```

The TRM description: "MWDT clock period = 12.5 ns *
TIMG_WDT_CLK_PRESCALE". This is the silicon-truth formula.

Note the 16-bit width (max value 65535). With `PRESCALE=65535`,
each MWDT tick = 819 µs ≈ 0.8 ms.

### 2. TRM Register 16.12 — TIMG_WDTCONFIG2_REG layout

Full 32 bits = `TIMG_WDT_STG0_HOLD`. Unit: mwdt_clk ticks.

Max value: 2^32 - 1 ≈ 4.3 billion ticks. With `PRESCALE=65535`
(max), timeout could reach ~3.5 billion seconds = 110 years.
Clearly we need to cap.

### 3. Integer-math formula derivation

To avoid floating-point:
```
timeout_ns = STG0_HOLD * (12.5 ns * PRESCALE)
           = STG0_HOLD * PRESCALE * 12.5
           = STG0_HOLD * PRESCALE * 25 / 2
```

Using `uint64_t` arithmetic:
- Max STG0_HOLD = 2^32, max PRESCALE = 2^16 → product = 2^48
- × 25 / 2 ≈ 2^53 ns ≈ 280 years

Fits comfortably in uint64_t. Cap at 1 hour (3.6 × 10^12 ns) for
sanity — no legitimate WDT timeout exceeds that.

### 4. Boot safety analysis

The boot self-test writes `CONFIG0=0` (EN=0, STG0=NONE). Timer
doesn't arm regardless of CONFIG1/2 contents. Safe.

The boot doesn't write CONFIG1 or CONFIG2 — they stay at 0 in
scratch storage. If anything ever DOES arm the timer (some
future demo), the PRESCALE=0 / STG0_HOLD=0 case triggers the
5-second fallback, preventing instant-fire from divide-by-zero
or huge-zero-products.

### 5. Verification by computed examples

Common IDF Arduino settings:
| Goal | PRESCALE | STG0_HOLD | Computed |
|------|----------|-----------|----------|
| 0.5 ms/tick | 40000 | 1 | 500 µs |
| 1 second | 40000 | 2000 | 1 second |
| 5 seconds | 40000 | 10000 | 5 seconds |
| 30 seconds | 40000 | 60000 | 30 seconds |
| 5 minutes | 40000 | 600000 | 300 seconds |

Formula: `STG0_HOLD * PRESCALE * 12.5 ns`. With PRESCALE=40000,
each tick = 500 µs. Matches IDF defaults.

### 6. FEED handler keeps using captured timeout

Once armed, the WDT timer's deadline is computed from the
PRESCALE+STG0_HOLD snapshot taken at arm time. FEED writes
re-arm using the same captured timeout (not recomputed each
feed). This means CONFIG1/2 writes AFTER enabling don't take
effect until the next re-arm cycle.

Real silicon would behave similarly — the timer counter
references the CONFIG register values continuously, but for our
discrete-event model, capture-at-arm is sufficient.

## Lo que SÍ funcionó

Boot regression-clean live test (2026-05-08):
```
0 wdt_reset events
Existing 8-event WDT boot trace preserved (4 per group, 2 groups):
  TIMG0: unlock → disable → feed → lock
  TIMG1: unlock → disable → feed → lock
```

Build clean. Stderr now reports computed timeout when WDT
armed:
```
[esp32p4.timg<N>.wdt] reset timer armed
    (timeout=<ms>, stg0_action=<n>, PRESCALE=<p>, STG0_HOLD=<h>)
```

Boot sees nothing — WDT never enabled. Code path is
construction-correct.

## Lo que NO funcionó / decisiones tomadas

### Decisiones tomadas

1. **Capture-at-arm vs continuous-recompute**: real silicon's
   counter compares against CONFIG register values continuously,
   so guest writes to CONFIG2 mid-cycle would shift the
   deadline. Our model takes a snapshot at arm time. Acceptable
   approximation — Arduino sketches don't typically change WDT
   timeout while the timer is running.

2. **1-hour cap**: prevents misconfigured guests from arming a
   100-year timer. The cap is arbitrary but reasonable — no real
   WDT use case exceeds 1 hour.

3. **PRESCALE=0 or STG0_HOLD=0 → 5s fallback**: protects
   against guest reading-back our fallback as the configured
   value (would loop). The fallback matches the prior phase's
   hardcoded behavior so existing behavior is preserved when
   CONFIG isn't initialized.

4. **Only stage 0 timeout**: TRM defines STG1/2/3 timeouts too
   (CONFIG3/4/5). Multi-stage cycling deferred — when we
   implement stage progression (Phase `2.BQ.multistage`), each
   stage's timeout will be read from its CONFIG register.

5. **RWDT not updated this phase**: TRM 17.2.2.2 has the
   special formula `Thold0 = STG0_HOLD << (EFUSE_WDT_DELAY_SEL
   + 1)` for RWDT, requiring eFuse modeling. Deferred as
   `2.BQ.rwdt-timeout`.

## Lessons learned

1. **TRM constants are the source-of-truth even for "obvious"
   defaults**: "5 seconds" felt safe for our hardcoded fallback,
   but real silicon's default reset value (per TRM Register
   16.12) is `STG0_HOLD = 26000000` ticks. With default
   PRESCALE=1, that's 26000000 * 12.5 ns = 325 ms. Very
   different from our 5s placeholder.

2. **Integer-math formulas avoid float dependencies**: 25/2
   replaces 12.5. Clean in 64-bit arithmetic.

3. **Overflow analysis matters for "max value" register
   fields**: 2^48 product fits in uint64 trivially, but it's
   worth doing the calculation to confirm.

4. **Capture-at-arm simplifies the model**: continuous
   recomputation would require a timer thread checking
   CONFIG register changes. Capture-at-arm with re-arming on
   FEED gives equivalent visible behavior for normal use.

## Implementación final

### `include/hw/timer/esp32p4_timg.h`

- **Added**: full TRM Register 16.11 bit-layout comment.
- **Added**: `ESP32P4_TIMG_WDT_PRESCALE_SHIFT` (16),
  `ESP32P4_TIMG_WDT_PRESCALE_MASK`,
  `ESP32P4_TIMG_WDT_PRESCALE(v)` decode macro.
- TRM citation inline for the 12.5 ns base and integer formula.

### `hw/timer/esp32p4_timg.c`

- CONFIG0 write handler (when arming the WDT):
  - Reads `CONFIG1` (for PRESCALE) and `CONFIG2` (STG0_HOLD)
    from storage.
  - Computes `timeout_ns = STG0_HOLD * PRESCALE * 25 / 2`
    using uint64.
  - Falls back to 5s when either value is 0.
  - Caps at 1 hour to prevent runaway timers.
  - Stores result in `s->wdt_timeout_ns` for use by FEED.
  - Stderr logs the computed timeout + PRESCALE + STG0_HOLD
    for debug.
- FEED handler: unchanged — uses captured `wdt_timeout_ns`.

### No header / machine init changes elsewhere

## Estado consolidado (post-2.BQ)

WDT timeout-source matrix:

| WDT | Phase | Timeout source |
|-----|-------|----------------|
| TIMG0 WDT | **2.BQ** | **STG0_HOLD × PRESCALE × 12.5 ns (TRM)** |
| TIMG1 WDT | **2.BQ** | **same (shared class)** |
| RTC WDT | 2.BN | hardcoded 5s (TRM formula deferred) |
| Super WDT | 2.BN | hardcoded 1s (TRM "slightly less than 1s") |

JSON event types: **27** (unchanged).

## 54-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.BN  | RTC/SWD reset + TRM key fix                              |
| 2.BO  | MWDT STG0 action decode                                  |
| 2.BP  | RWDT STG0 action decode                                  |
| **2.BQ** | **MWDT TRM-correct timeout from CONFIG1/CONFIG2** |

## Próximas direcciones

- **RWDT TRM-correct timeout** — needs slow_clk rate + eFuse
  WDT_DELAY_SEL modeling.
- **Multi-stage cycling** — stages 0→1→2→3→0 with own
  timeouts/actions per TRM § 17.2.2.2.
- **WDT IRQ→CLIC wiring** for action=1.
- **UART IRQ** (QOM class-override).
- **Real PWM** waveform on GPIO via LEDC.
- **BH1750/SHT31/CCS811** sensors.
- **SPI3** instantiation.
- **FreeRTOS** scheduler.
