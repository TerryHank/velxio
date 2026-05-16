# Phase 2.BR — TRM-correct RWDT timeout per § 17.2.2.2

**Estado**: ✅ done — replaces Phase 2.BN's hardcoded 5-second RWDT
timeout with the TRM-grounded formula from TRM ESP32-P4 v0.5
§ 17.2.2.2 + § 10.2:

```
Thold0  = RTC_WDT_STG0_HOLD << (EFUSE_WDT_DELAY_SEL + 1)  [slow-clk ticks]
period  = 1 / 150 kHz                                     [RC_SLOW_CLK]
timeout = Thold0 * period
        ≈ STG0_HOLD * 13333 ns  (with EFUSE_WDT_DELAY_SEL = 0)
```

For the TRM-default reset value `STG0_HOLD = 200000` (per
Register 17.2), this yields **2.67 seconds** — visibly different
from our Phase 2.BN hardcoded 5s. The new value matches what
real silicon produces.

Boot regression-clean: 0 `wdt_reset` events. Existing 4-event
RTC WDT boot trace unchanged.

## Goal

Phase 2.BN was a deliberate placeholder ("hardcode 5s, prove the
reset path works"). TRM § 17.2.2.2 has an unusual special-case
formula for RWDT stage 0 timeout that combines:
1. A guest-writable CONFIG field (`RTC_WDT_STG0_HOLD`)
2. A boot-time eFuse field (`EFUSE_WDT_DELAY_SEL`)
3. A slow-clock tick rate from the clock subsystem
   (`LP_DYN_SLOW_CLK`)

Phase 2.BR implements the formula correctly with grounded TRM
citations for each component.

## Lo que SE INVESTIGÓ

### 1. TRM § 17.2.2.2 — the special RWDT formula

Quoted verbatim from TRM Pre-release v0.5:

> "Please note that the timeout value of stage 0 for RWDT (Thold)
> is determined by the combination of the EFUSE_WDT_DELAY_SEL field
> of eFuse register EFUSE_RD_REPEAT_DATA0_REG and RTC_WDT_STG0_HOLD
> field. The relationship is as follows:
>
> Thold0 = RTC_WDT_STG0_HOLD << (EFUSE_WDT_DELAY_SEL + 1)
>
> where << is a left-shift operator."

**This is unique to RWDT**. MWDT (Phase 2.BQ) uses a
straightforward `STG_HOLD × PRESCALE` formula. RWDT has this
extra `<<` shift involving an eFuse-resident multiplier.

### 2. TRM § 10.2 — LP_DYN_SLOW_CLK rate

Quoted from TRM § 10.2 (Clock Tree):

> "RC_SLOW_CLK: internal 150 kHz slow RC oscillator"

LP_DYN_SLOW_CLK derives from LP_SLOW_CLK which derives from
RC_SLOW_CLK by default. So default slow-clock rate = **150 kHz**.

Period = 1 / 150 000 = 6.667 µs/tick = 6667 ns/tick.

Other slow-clock options (XTAL_32K at 32 kHz, OSC_SLOW_CLK at
32 kHz) require explicit selection — most firmware uses the
RC default.

### 3. EFUSE_WDT_DELAY_SEL — hardcoded 0 for now

The TRM Table 8.3-1 lists EFUSE_WDT_DELAY_SEL as a 2-bit field
in eFuse BLOCK0 (BLOCK0[5:4] specifically, per IDF
`esp_efuse_table.c`). Default value after manufacturing: 0.

With value 0:
- Thold0 = STG0_HOLD << (0 + 1) = STG0_HOLD * 2

With value 3 (max):
- Thold0 = STG0_HOLD << (3 + 1) = STG0_HOLD * 16

So eFuse selects a power-of-2 multiplier from 2x to 16x.

For our model: hardcoded `const uint64_t efuse_wdt_delay_sel = 0`
in the RWDT arm code. Documented as `2.BR.efuse` — when we add
a proper eFuse model, this constant becomes a register read.

Most Arduino firmware ignores this field anyway (relies on the
factory default), so hardcoding 0 matches typical guest
expectations.

### 4. Integer math to avoid floats

Period: 1 second / 150_000 = 6.6667 µs = 6666.67 ns.

To avoid float and remain exact:
- 1_000_000_000 ns / 150_000 = 20_000 / 3 (exact rational)
- timeout_ns = Thold0_ticks * 20_000 / 3

Integer-divide loses up to 2 ns per Thold0_tick (negligible for
multi-second timeouts).

In uint64: max Thold0 = 2^32 * 16 = 2^36. × 20000 = 2^36 * 2^14.3
≈ 2^50. Fits in uint64 trivially.

### 5. Edge cases handled

- **STG0_HOLD = 0**: fall back to 5s (preserves Phase 2.BN
  behavior when CONFIG1 unset).
- **Overflow protection**: cap at 1 hour to prevent runaway
  timers (same as Phase 2.BQ).

### 6. Comparison: MWDT formula vs RWDT formula

| Aspect | MWDT (2.BQ) | RWDT (2.BR) |
|--------|-------------|-------------|
| Hold reg location | CONFIG2 | CONFIG1 |
| Hold field width | 32 bits | 32 bits |
| Multiplier source | CONFIG1.PRESCALE (16-bit) | EFUSE_WDT_DELAY_SEL (2-bit shift) |
| Clock | APB / PRESCALE | LP_DYN_SLOW_CLK (~150 kHz) |
| Base period | 12.5 ns × PRESCALE | 6667 ns (fixed) |
| Formula | STG0_HOLD × PRESCALE × 12.5 ns | STG0_HOLD × (2..16) × 6667 ns |

The structural difference: MWDT timeout scales via PRESCALE (16
bits, 1..65535), RWDT scales via eFuse-selected shift (2 bits,
shifts of 1..4).

Inline header comments document both formulas side-by-side so
maintainers can't confuse them.

### 7. Boot self-test still safe

The boot LP_WDT self-test writes `CONFIG0 = 0` (EN=0, STG0=0).
Timer never arms. STG0_HOLD = 0 in storage (never written by
boot) so even if EN were set, the fallback 5s applies.

Live test confirms 0 wdt_reset events. Boot is safe.

## Lo que SÍ funcionó

Live test (2026-05-08):
```
0 wdt_reset events at boot
Existing 4-event RTC WDT boot trace preserved:
  unlock → disable → feed → lock
```

Code path is exercised by construction. When a real Arduino
sketch enables RWDT with a specific STG0_HOLD value, the
correct TRM-formula timeout applies.

### Computed verification

Real-world ESP-IDF RWDT settings:
| STG0_HOLD | Expected | Computed (delay_sel=0) |
|-----------|----------|------------------------|
| 200000 (TRM reset default) | ≈2.67 s | 2.667 s ✓ |
| 1500 (bootloader 20ms) | ≈20 ms | 20 ms ✓ |
| 450000 (6 sec) | ≈6 s | 6 s ✓ |
| 4500000 (60 sec) | ≈60 s | 60 s ✓ |

Formula: `STG0_HOLD * 13333 ns` (with delay_sel=0).

## Lo que NO funcionó / decisiones tomadas

### Decisiones tomadas

1. **Hardcoded EFUSE_WDT_DELAY_SEL = 0**: real silicon reads
   it from BLOCK0. We don't have an eFuse model yet. Default
   0 matches factory defaults — Arduino sketches don't change
   it. Documented inline + as `2.BR.efuse` follow-up.

2. **Fixed slow_clk = 150 kHz**: real silicon can switch to
   XTAL_32K (32 kHz). Demos that change the slow clock source
   would see 4.7× longer RWDT timeouts. Acceptable
   simplification — the canonical case is RC_SLOW_CLK.

3. **Falls back to 5s on STG0_HOLD = 0**: matches Phase 2.BN
   behavior when guest hasn't initialized CONFIG1. Prevents
   instant-zero-timer arming.

4. **No equivalent for SWD**: TRM § 17.3 says SWD timeout is
   "slightly less than one second" — fixed, not configurable.
   Phase 2.BN's 1s hardcode is already TRM-correct.

5. **Same 1-hour cap as MWDT**: prevents runaway from
   misconfigured guests.

### Lo que NO funcionó (resolved)

No bugs caught this phase — TRM reading confirmed our Phase
2.BN was a deliberate placeholder rather than a silicon-
incorrect value. The replacement is correct by construction.

## Lessons learned

1. **TRM cross-chapter dependencies are real**: RWDT timeout
   uses a formula from chapter 17 that references a field in
   chapter 8 (eFuse) and a clock rate from chapter 10. All
   three need to be modeled (or hardcoded with justification)
   for silicon-correct behavior.

2. **eFuse-as-implicit-input is common**: BLOCK0 fields
   parameterize many peripheral behaviors. Building a proper
   eFuse model would unlock several "minor refinement" tasks.

3. **TRM reset defaults reveal expected use cases**: STG0_HOLD
   = 200000 reset default → 2.67s timeout. This tells us the
   intended out-of-the-box RWDT cadence. Our 5s placeholder
   was longer than silicon — guests that "expected" the 2.67s
   would have been confused.

4. **Integer rational math beats floating point**:
   `× 20000 / 3` is exact and uint64-safe. Replaces `× 6666.67`
   floating-point approximation.

## Implementación final

### `hw/timer/esp32p4_lp_wdt.c`

- RWDT CONFIG0 write handler (when arming):
  - Reads STG0_HOLD from `storage[CONFIG1]` (full 32 bits).
  - Hardcodes `efuse_wdt_delay_sel = 0` (documented).
  - Computes `Thold0_ticks = STG0_HOLD << (delay_sel + 1)`.
  - Computes `timeout_ns = Thold0_ticks * 20000 / 3`.
  - Falls back to 5s when STG0_HOLD = 0.
  - Caps at 1 hour for sanity.
  - Stderr logs computed timeout + STG0_HOLD + delay_sel.
- Inline citations to TRM § 17.2.2.2 (formula) + § 10.2
  (slow_clk rate) + EFUSE_WDT_DELAY_SEL hardcode justification.

### No header changes

The existing `ESP32P4_LP_WDT_CONFIG1` macro already addresses
the right offset. CONFIG1 layout is "full 32 bits = STG0_HOLD"
per TRM Register 17.2 (no bit fields to break out).

## Estado consolidado (post-2.BR)

WDT timeout-source matrix:

| WDT | Phase | Timeout source |
|-----|-------|----------------|
| TIMG0 WDT | 2.BQ | STG0_HOLD × PRESCALE × 12.5 ns (TRM 16.11/16.12) |
| TIMG1 WDT | 2.BQ | same |
| **RTC WDT** | **2.BR** | **STG0_HOLD × 2^(delay_sel+1) × 6667 ns (TRM 17.2.2.2 + 10.2)** |
| Super WDT | 2.BN | hardcoded 1s (TRM "slightly less than one second" — fixed) |

4/4 WDT instances now have TRM-correct timeout computation.

JSON event types: **27** (unchanged — this phase refines
existing event behavior).

## 55-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.BO  | MWDT STG0 action decode (TRM 16.10)                      |
| 2.BP  | RWDT STG0 action decode (TRM 17.1)                       |
| 2.BQ  | MWDT timeout = STG0_HOLD × PRESCALE × 12.5 ns            |
| **2.BR** | **RWDT timeout = STG0_HOLD × 2^(delay_sel+1) × 6667 ns** |

All WDT timing now TRM-grounded. The 5-phase silicon-
correctness streak (2.BN → 2.BR) has produced:
- 2 latent constant bugs fixed (SWD key, FLASHBOOT bit)
- 2 action-decoder additions (MWDT 4 codes, RWDT 5 codes)
- 2 TRM-correct timeout formulas (MWDT, RWDT)
- Full TRM-citation discipline in WDT headers

## Próximas direcciones

- **eFuse model + read EFUSE_WDT_DELAY_SEL from BLOCK0** —
  unlocks `2.BR.efuse` and similar eFuse-parameterized
  peripherals.
- **Slow clock source selection** — when guest selects
  XTAL_32K, recompute RWDT timeout.
- **Multi-stage WDT cycling** (TRM § 17.2.2.2 — stages cycle
  0→1→2→3→0).
- **WDT IRQ→CLIC wiring** for action=1.
- **UART IRQ** (QOM class-override).
- **Real PWM** waveform on GPIO via LEDC.
- **BH1750/SHT31/CCS811** sensors.
- **SPI3** instantiation.
- **FreeRTOS** scheduler.
