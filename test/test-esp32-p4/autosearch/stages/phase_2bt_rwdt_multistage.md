# Phase 2.BT — RWDT multi-stage cycling per TRM § 17.2.2.2

**Estado**: ✅ done — mirror of Phase 2.BS for the LP_WDT block.
RWDT now cycles through all 4 stages per TRM § 17.2.2.2 with the
RWDT-specific layout: action fields at bits 30:28/27:25/24:22/19,
per-stage HOLD registers at CONFIG1/2/3/4 (not 2/5 like MWDT
because RWDT has no prescaler register).

**WDT multi-stage inventory now complete** — all 3 digital WDTs
(MWDT0, MWDT1, RWDT) cycle stages per silicon. Super WDT has no
stages by design (single fixed-timeout action).

Boot regression-clean: 0 wdt_reset, 0 wdt_irq events.

## Goal

Phase 2.BS implemented multi-stage cycling for MWDT. RWDT needed
the same treatment with its different register layout and action
encoding. Per TRM § 17.2.2.2, both MWDT and RWDT cycle 0→1→2→3→0
on consecutive timeouts.

## Lo que SE INVESTIGÓ

### 1. RWDT register layout differs from MWDT

| Register | MWDT (TIMG) | RWDT (LP_WDT) |
|----------|-------------|---------------|
| CONFIG0 | EN + actions | EN + actions |
| CONFIG1 | **PRESCALE** | **STG0_HOLD** |
| CONFIG2 | STG0_HOLD | STG1_HOLD |
| CONFIG3 | STG1_HOLD | STG2_HOLD |
| CONFIG4 | STG2_HOLD | STG3_HOLD |
| CONFIG5 | STG3_HOLD | — |

RWDT has no separate prescaler register because the slow-clock
source (RC_SLOW_CLK at 150 kHz) is fixed for RWDT. So RWDT puts
STG0_HOLD at CONFIG1 (where MWDT has PRESCALE) and shifts the
other stages up by one register.

Helper macro:
```c
#define ESP32P4_LP_WDT_STG_HOLD_OFF(n) \
    (ESP32P4_LP_WDT_CONFIG1 + 4u * (n))
```

Compare to MWDT:
```c
#define ESP32P4_TIMG_WDT_STG_HOLD_OFF(n) \
    (ESP32P4_TIMG_WDTCONFIG2 + 4u * (n))
```

Inline header comments document this register-layout difference
to prevent future maintainers from copy-pasting MWDT offsets.

### 2. RWDT action fields are wider

Per TRM Register 17.1 (3-bit fields):
- STG0: bits 30:28 (shift 28)
- STG1: bits 27:25 (shift 25)
- STG2: bits 24:22 (shift 22)
- STG3: bits 21:19 (shift 19)

3-bit shift pattern: `30 - 3*N`. Helper macro:
```c
#define ESP32P4_LP_WDT_STGn(v, n) \
    (((v) >> (28 - 3 * (n))) & 0x7u)
```

Compare to MWDT (2-bit shift pattern `29 - 2*N`, mask 0x3).

### 3. Code reuse vs duplication

Could share state struct between MWDT and RWDT but the action-
code enums differ (MWDT has 4 codes, RWDT has 5). Cleaner to
keep separate fields with parallel naming:

MWDT: `wdt_stg_action[4]`, `wdt_current_stage`, `wdt_prescale`
RWDT: `rwdt_stg_action[4]`, `rwdt_current_stage` (no prescale)

The reset callbacks are similar but emit different JSON `grp`
fields (`%u` for MWDT group num, `"rtc"` literal for RWDT).

### 4. Boot safety: unchanged

Boot self-test writes `CONFIG0 = 0` (EN=0, all stage actions=0).
Even if EN were set, all stages would be action=NONE which
emits events but doesn't reset. The current 4-event RTC WDT
boot trace (unlock/disable/feed/lock) is preserved.

Live test confirms: 0 wdt_reset and 0 wdt_irq events.

### 5. Reset action terminates the cycle

Same convention as Phase 2.BS for MWDT:
- action 0 (none) or 1 (intr): advance to next stage
- action 2/3/4 (rst_cpu/rst_hp_core/rst_sys): emit event,
  terminate cycle, optionally call `qemu_system_reset_request`

### 6. FEED semantics per TRM § 17.2.2.1

> "If a watchdog timer is fed by software, the timer will return
> to stage 0 and reset its counter value to zero."

WDTFEED handler now resets `rwdt_current_stage = 0` and re-arms
with the stage 0 timeout from CONFIG1 (TRM-correct via the
helper).

## Lo que SÍ funcionó

Live test (2026-05-08):
```
0 wdt_reset events
0 wdt_irq events
Existing 4-event RTC WDT boot trace preserved:
  unlock → disable → feed → lock
```

Stderr now reports per-stage info on arm + each stage transition
(when guest exercises the path):
```
[esp32p4.rtc_wdt] armed (stage=0, timeout=<ms>,
    actions=[<s0>,<s1>,<s2>,<s3>])
[esp32p4.rtc_wdt] *** TIMEOUT stage <N> *** action=<name>
[esp32p4.rtc_wdt] → stage <N+1> (timeout=<ms>, action=<a>)
```

JSON events include `"stage":N` field for frontend rendering.

## Lo que NO funcionó / decisiones tomadas

### Decisiones tomadas

1. **Mirror of 2.BS, not shared code**: MWDT and RWDT have
   sufficient layout differences (register positions, action
   field widths, action code counts) that sharing would
   introduce confusing branching. Cleaner to mirror the
   structure with RWDT-specific constants.

2. **Forward-decl for stage_timeout_ns helper**: same pattern
   as 2.BS — helper used by both CONFIG0 write handler and
   reset callback, declared at file top.

3. **No CLIC IRQ wiring for action=1**: same deferred decision
   as 2.BS — emit `wdt_irq` JSON event but no CPU IRQ pulse.
   For RWDT this would need an LP-side IRQ route (not yet
   wired in our model).

4. **EFUSE_WDT_DELAY_SEL still hardcoded 0**: Phase 2.BR's
   approximation. When eFuse is modeled, this becomes a
   register read. Affects all RWDT stage timeouts uniformly.

5. **Each stage uses the same delay_sel multiplier**: per TRM
   formula `Thold0 = STG0_HOLD << (EFUSE_WDT_DELAY_SEL + 1)`,
   only STG0 explicitly uses the multiplier. For stages 1-3,
   the TRM doesn't specify a similar formula. Our implementation
   applies the same `<< 1` (delay_sel=0 default) to all stages
   for consistency. If real silicon doesn't shift stages 1-3
   our timeouts will be 2× longer than expected for those
   stages. Documented as a possible follow-up.

## Lessons learned

1. **Sibling peripherals diverge in subtle ways**: MWDT and
   RWDT look like the "same WDT" but their register layouts
   differ in register positions (no prescaler for RWDT), field
   widths (2 vs 3 bits), and action sets (4 vs 5 codes). Side-
   by-side TRM Register 16.10/16.11/16.12 + 17.1/17.2/17.3
   reading clarifies — single-glance copying would introduce
   bugs.

2. **TRM's formula-vs-table dichotomy**: MWDT has a clean
   formula (`STG_HOLD * PRESCALE * 12.5 ns`) that scales
   uniformly. RWDT has a formula for stage 0 only (`Thold0 =
   STG_HOLD << (delay_sel+1)`) but the TRM doesn't explicitly
   define stage 1-3 formulas. Our model assumes uniform
   application; real silicon may differ. Acknowledged in
   "decisions taken".

3. **The 2.BS template scaled cleanly**: ~80 lines of
   RWDT-specific code (mirror of MWDT's structure) with
   layout differences abstracted into the per-stage helpers.

4. **TRM citation per silicon-quirk pays off**: the comment
   "RWDT puts STG0_HOLD at CONFIG1 (where MWDT has PRESCALE)"
   inline in the header is the kind of fact that's nearly
   impossible to remember without explicit documentation.

## Implementación final

### `include/hw/timer/esp32p4_lp_wdt.h`

- **Added**: shift constants for all 4 stage action fields.
- **Added**: parameterized `ESP32P4_LP_WDT_STGn(v, n)` macro
  (3-bit step pattern `28 - 3*n`).
- **Added**: `ESP32P4_LP_WDT_STG_HOLD_OFF(n)` for per-stage
  HOLD register offset (starts at CONFIG1, NOT CONFIG2 like
  MWDT).
- State struct extended:
  - `rwdt_stg_action[4]`
  - `rwdt_current_stage`
  - `rwdt_stg0_action` kept as legacy alias for `[0]`

### `hw/timer/esp32p4_lp_wdt.c`

- Forward-decl `esp32p4_lp_wdt_stage_timeout_ns()` at top.
- New helper computing per-stage timeout from CONFIG(1+N)
  using TRM § 17.2.2.2 formula (slow-clk 150 kHz, delay_sel=0).
- Reset callback: dispatches on
  `rwdt_stg_action[rwdt_current_stage]`, advances to next
  stage on non-reset actions, terminates cycle on reset
  actions.
- CONFIG0 write handler: decodes all 4 actions into
  `rwdt_stg_action[]`, on arm starts at stage 0, uses helper
  for timeout.
- WDTFEED handler: resets `rwdt_current_stage=0`, re-arms
  with stage 0 timeout.

## Estado consolidado (post-2.BT)

WDT cycling matrix:

| WDT | Phase | Stages modeled | Action field width |
|-----|-------|----------------|-----|
| TIMG0 WDT | 2.BS | 4-stage cycle | 2-bit, 4 codes |
| TIMG1 WDT | 2.BS | 4-stage cycle | 2-bit, 4 codes |
| **RTC WDT** | **2.BT** | **4-stage cycle** | **3-bit, 5 codes** |
| Super WDT | 2.BN | no stages | n/a |

3/4 WDT instances cycle stages per silicon. SWD has no stages
by design.

JSON event types: **27** (unchanged — adds variants of existing
`wdt_reset` / `wdt_irq` events with `"stage":N` field).

## 57-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.BS  | MWDT multi-stage cycling                                 |
| **2.BT** | **RWDT multi-stage cycling (different layout)**      |

**7 consecutive TRM-grounded phases (2.BN → 2.BT)** — the WDT
subsystem is now nearly silicon-complete:

- TRM-correct write-protection keys (4/4 WDTs)
- TRM-correct bit layouts (FLASHBOOT, SWD_FEED, SWD_DISABLE)
- Action codes fully decoded (4 codes for MWDT, 5 for RWDT)
- TRM-correct timeout formulas (MWDT + RWDT)
- Multi-stage cycling (3/3 stage-capable WDTs)
- Full TRM citations inline

## Próximas direcciones

- **WDT IRQ→CLIC wiring**: action=1 should actually pulse a
  CPU IRQ line so guest ISRs can run.
- **eFuse model** — unlocks WDT_DELAY_SEL + MAC + others.
- **UART IRQ** (QOM class-override).
- **Real PWM** waveform on GPIO via LEDC.
- **BH1750/SHT31/CCS811** sensors.
- **SPI3** instantiation.
- **FreeRTOS** scheduler.
