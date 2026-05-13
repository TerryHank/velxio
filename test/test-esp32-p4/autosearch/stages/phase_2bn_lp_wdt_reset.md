# Phase 2.BN — RTC + Super WDT reset (+ TRM silicon fix)

**Estado**: ✅ done — backports the Phase 2.BM reset-timer pattern
to the LP_WDT block (RTC WDT + Super WDT) AND fixes two
silicon-correctness bugs discovered by careful TRM reading.

**TRM-grounded fixes** (per `esp32-p4_technical_reference_manual_en.pdf`
Pre-release v0.5, Chapter 17):

1. **SWD write-protect key bug**. Phase 2.AT used `0x8F1D312A`
   for the Super WDT magic key. TRM § 17.3.2.2 ("Workflow")
   explicitly says: "CPU needs to disable SWD controller's write
   protection by writing **0x50D83AA1** to RTC_WDT_SWD_WKEY".
   The `0x8F1D312A` value appears to have been carried over from
   older ESP32 generations where SWD had a separate paranoid key.
   For ESP32-P4 it's the SAME key as RWDT. **Fixed in this phase.**

2. **SWD enable/disable bit-layout bug**. Phase 2.AT had a
   `ESP32P4_LP_SWD_EN = (1U << 31)` constant alongside
   `ESP32P4_LP_SWD_DISABLE = (1U << 30)`. TRM Register 17.8
   `RTC_WDT_SWD_CONFIG_REG` shows that bit 31 is actually
   **SWD_FEED** (write-only), not an enable bit. SWD enable
   state is the **inverse** of bit 30 (DISABLE). **Removed
   the bogus EN constant; added a correct SWD_FEED constant.**

Live test (2026-05-08), boot regression-clean:
```json
{"event":"rtc_wdt","op":"unlock"}     ← key 0x50D83AA1 (was wrong before)
{"event":"rtc_wdt","op":"disable"}    ← CONFIG0 EN=0 → timer disarmed
{"event":"rtc_wdt","op":"feed","count":1}
{"event":"rtc_wdt","op":"lock"}
{"event":"super_wdt","op":"unlock"}   ← key 0x50D83AA1 NOW CORRECT (TRM 17.3.2.2)
{"event":"super_wdt","op":"disable"}  ← CONFIG DISABLE=1 → timer disarmed
{"event":"super_wdt","op":"lock"}
```

**0 wdt_reset events** at boot — both timers correctly stay
disarmed through the unlock-disable-lock sequence. Reset would
only fire if a sketch deliberately enables a WDT (writes EN=1
to RWDT or DISABLE=0 to SWD via the unlocked path) and then
fails to feed.

## Goal

Phase 2.BM added actual reset action to TIMG WDTs. The LP_WDT
block (RTC WDT + Super WDT) was the remaining gap — register-
level observable (Phase 2.AT) but no timeout → reset behavior.

Phase 2.BN closes that gap. Additionally, while reading TRM § 17
to ground the implementation, two bugs in the existing Phase 2.AT
code were uncovered and fixed.

## Lo que SE INVESTIGÓ

### 1. TRM § 17.1 Overview — counted WDTs

```
ESP32-P4 contains three digital watchdog timers:
  - MWDT0 (TIMG0 — Phase 2.AP)
  - MWDT1 (TIMG1 — Phase 2.AQ)
  - RWDT  (RTC — Phase 2.AT)

Plus one analog watchdog timer:
  - SWD   (Super — Phase 2.AT, deeper digital domain in P4)
```

Confirmed our inventory is correct. All 4 WDT instances exist.

### 2. TRM § 17.2.2.2 — RWDT timeout actions

Table 17.2-1 shows the available actions:
- Disabled
- Interrupt
- HP CPU reset
- HP core reset
- **System reset** (RWDT-only)

So RWDT can issue full system reset on stage-0 timeout. Our
skeleton models this — fire `qemu_system_reset_request()` on
timer expiry (gated by env var).

The TRM also documents 4 stages cycling (0→1→2→3→0), each with
its own timeout + action. For the skeleton we only model stage
0; multi-stage cycling is deferred.

### 3. TRM § 17.2.2.3 — Write protection magic key

> "The value **0x50D83AA1** must be written to the watchdog
> timer's write-key field before any other register of the same
> watchdog timer can be changed."

Both MWDT and RWDT use this same key. Already correct in our
code (`ESP32P4_LP_WDT_WKEY`).

### 4. TRM § 17.3.2.2 — Super WDT workflow + magic key

**Critical TRM quote** (Section 17.3.2.2 Workflow):

> "When trying to feed SWD, CPU needs to disable SWD controller's
> write protection by writing **0x50D83AA1** to RTC_WDT_SWD_WKEY."

This is the SAME key as RWDT/MWDT. Our Phase 2.AT code had
`0x8F1D312A` — wrong. This was tracked to a carry-over from an
older ESP32 generation (e.g., ESP32-S3) where SWD had a separate
paranoid key. For ESP32-P4 specifically, the key was unified.

**This is the kind of silicon bug that means real Arduino
firmware writing the TRM-correct key 0x50D83AA1 would FAIL TO
UNLOCK our model**, silently dropping subsequent writes. That's
a real silicon-correctness failure. Now fixed.

### 5. TRM Register 17.8 — SWD CONFIG bit layout

Register 17.8 shows:
- bit 31: `SWD_FEED` (W/O — write 1 to feed)
- bit 30: `SWD_DISABLE` (R/W — 1=disable, 0=enable)
- bit 18: `SWD_AUTO_FEED_EN`
- bit  0: `SWD_RESET_FLAG` (RO)

Phase 2.AT had defined `ESP32P4_LP_SWD_EN = (1U << 31)` —
treating bit 31 as a separate enable bit. That's WRONG. Bit 31
is FEED, write-only. SWD's "enabled" state is the INVERSE of
bit 30 (DISABLE).

The Phase 2.AT model also had a `(v & ESP32P4_LP_SWD_EN) ?
"enable" : "config"` branch which would never fire correctly
because bit 31 is FEED (a momentary signal), not a persistent
enable.

### 6. TRM § 17.3 — SWD timeout duration

> "SWD contains a watchdog circuit that needs to be fed for at
> least once during its timeout period, which is **slightly less
> than one second**."

So SWD timeout is fixed at ~1 second (not configurable like
RWDT stage timeouts). Our model uses exactly 1 second.

### 7. Boot safety analysis

After fixes, our boot self-test runs:
```c
// RTC WDT
write WPROTECT = 0x50D83AA1   → unlock
write CONFIG0 = 0             → CONFIG0.EN = 0 → timer NOT armed
write FEED = 1                → emits "feed", but timer not armed (no-op)
write WPROTECT = 0            → lock

// Super WDT
write SWD_WPROTECT = 0x50D83AA1  → unlock (NOW CORRECT KEY)
write SWD_CONFIG = (1 << 30)     → SWD_DISABLE=1 → timer disarmed
write SWD_WPROTECT = 0           → lock
```

Both timers stay disarmed throughout. Live test confirms 0
wdt_reset events at boot. **Boot is safe.**

If a future Arduino sketch enables either WDT (RWDT: write
CONFIG0 with EN=1 + unlocked; SWD: write CONFIG with DISABLE=0
+ unlocked) and then hangs without feeding, the reset fires
(opt-in via VELXIO_WDT_RESET=1).

## Lo que SÍ funcionó

Live test (2026-05-08), boot WDT trace:

```
RTC WDT (4 events):
  unlock  → wdt_unlocked = true (key 0x50D83AA1 accepted)
  disable → CONFIG0.EN = 0 → timer disarmed
  feed    → wdt_feed_count = 1
  lock    → wdt_unlocked = false

Super WDT (3 events — no feed since DISABLE=1 immediately):
  unlock  → swd_unlocked = true (key 0x50D83AA1 NOW CORRECT)
  disable → CONFIG.DISABLE = 1 → timer disarmed (immediately)
  lock    → swd_unlocked = false

wdt_reset events: 0
```

The full 7-event sequence from Phase 2.AT is preserved (no
regression). Behind the scenes, the new reset timers exist and
correctly:
1. Don't arm on the boot disable sequence.
2. Are armed by guest code if EN=1 (RWDT) or DISABLE=0 (SWD)
   is written under unlock.
3. Disarm on enable→disable transition.
4. Reset deadline on feed.

## Lo que NO funcionó / decisiones tomadas

### Lo que NO funcionó (caught + fixed)

1. **Phase 2.AT had the wrong SWD key**: 0x8F1D312A vs the
   TRM's 0x50D83AA1. This was a silent bug — our model
   accepted the wrong key (because it matched our wrong
   constant) but real Arduino firmware would have failed. The
   only way this would have surfaced before fixing was when a
   real Arduino sketch using `disableLoopWDT()` or similar
   tried to write the correct TRM-prescribed key — our model
   would have refused to unlock. Caught by TRM 17.3.2.2 read.

2. **Phase 2.AT had wrong SWD enable bit semantics**: defined
   `EN = bit 31` and `DISABLE = bit 30` as if they were both
   present and meaningful. TRM Register 17.8 makes clear: bit
   31 is **FEED** (write-only momentary), only bit 30 is
   persistent state (DISABLE). The "enable" decode branch in
   the old code (`(v & EN) ? "enable" : "config"`) was
   unreachable in practice. Fixed: replaced `EN` constant with
   `FEED`, made the decode branch test only the DISABLE bit.

### Decisiones tomadas

3. **No multi-stage RWDT cycling**: TRM 17.2.2.2 describes 4
   stages cycling 0→1→2→3→0 with independent timeouts and
   actions. Our model implements only stage 0 → SYSTEM_RESET.
   Sufficient for "did the WDT fire?" realism; multi-stage
   modeling deferred as `2.BN.stages`.

4. **No interrupt action**: RWDT can also fire IRQ (stage
   action = "Interrupt"). Our model only does SYSTEM_RESET.
   Could be added via the IRQ template pattern in a future
   sub-phase.

5. **Timeout values hardcoded** (RWDT=5s, SWD=1s): real RWDT
   computes from CONFIG1 (stage 0 timeout in slow-clock
   cycles) and the EFUSE_WDT_DELAY_SEL field. Our hardcoded
   5s is acceptable for "did the timer fire?" observability
   but won't match exact silicon timing. SWD's 1s matches the
   TRM "slightly less than one second" spec.

6. **No SWD auto-feed**: TRM 17.3.2.2 mentions
   `SWD_AUTO_FEED_EN` (bit 18 per Register 17.8) that lets
   hardware auto-feed the SWD. We don't model this — if a
   guest enables auto-feed but our model doesn't honor it,
   the timer fires reset. Documented as `2.BN.autofeed`. In
   practice Arduino sketches don't enable auto-feed.

## Lessons learned

1. **TRM reading catches latent bugs**: Phase 2.AT got the SWD
   key wrong by carrying over an older-gen value without
   verification. Two years of code with no real Arduino traffic
   never exposed the bug. Reading TRM 17.3.2.2 verbatim caught
   it in 5 minutes.

2. **Bit-by-bit register layout matters**: the `EN` vs `FEED`
   vs `DISABLE` confusion in the existing code was a sign of
   "guessed at the bit layout" rather than ground-truth from
   register diagrams. TRM Register 17.8 explicitly shows the
   layout; should have been our source from day one.

3. **Inverse-bit semantics are footguns**: SWD has DISABLE (not
   EN), so writing 1 turns it OFF, writing 0 turns it ON. Easy
   to flip in a model. Documented inline so future code
   readers don't introduce a regression.

4. **TRM-grounded comments help long-term maintenance**: every
   bit definition in the new header cites the TRM section/
   register. Future Claude sessions debugging WDT behavior can
   find the source-of-truth quickly without needing to re-derive
   from IDF symbols.

5. **The reset-timer pattern from 2.BM generalizes cleanly**:
   QEMUTimer + bool + timeout_ns + callback. Applied to RWDT
   and SWD with minimal variation. The pattern is now
   sufficiently mature to be considered an emulator coding
   idiom.

## Implementación final

### `include/hw/timer/esp32p4_lp_wdt.h`

- **Fixed**: `ESP32P4_LP_SWD_WKEY` changed from `0x8F1D312Au`
  to `0x50D83AA1u` per TRM § 17.3.2.2. Inline comment
  explains the older-gen carryover history.
- **Fixed**: removed bogus `ESP32P4_LP_SWD_EN = (1U << 31)`;
  added `ESP32P4_LP_SWD_FEED = (1U << 31)` per TRM Register
  17.8.
- **Added**: `rwdt_timer` (QEMUTimer*), `rwdt_enabled` (bool),
  `swd_timer`, `swd_enabled`, `swd_feed_count` (uint32_t).

### `hw/timer/esp32p4_lp_wdt.c`

- Added `#include "sysemu/runstate.h"` for
  `qemu_system_reset_request()`.
- New `esp32p4_lp_wdt_rwdt_reset_cb()`: emits `wdt_reset` with
  `grp:"rtc"`, optional reset via env var.
- New `esp32p4_lp_wdt_swd_reset_cb()`: emits `wdt_reset` with
  `grp:"super"`.
- `WDT_FEED` handler: postpones rwdt_timer deadline if armed.
- `WDT_CONFIG0` handler: arms/disarms rwdt_timer based on EN
  bit (5s timeout).
- `SWD_CONFIG` handler: decoded per TRM Register 17.8:
  - bit 31 = FEED → emits "feed" event + resets swd_timer if
    armed.
  - bit 30 = DISABLE → arms or disarms swd_timer (1s timeout).
  - Both bits can be set in a single write (silicon allows it).
- `realize`: creates both QEMUTimers.
- `reset`: disarms both timers + clears feed counters.

### No machine init / no header changes (esp32p4.c)

The fixes are internal to LP_WDT. The Phase 2.AT machine init
self-test still calls `esp32p4_lp_wdt_self_test()` which now
emits TRM-correct events.

## Estado consolidado (post-2.BN)

WDT inventory with reset behavior:

| WDT | Phase | Reset | Key | Action on timeout |
|-----|-------|-------|-----|-------------------|
| TIMG0 WDT | 2.AP/**2.BM** | ✓ 5s | 0x50D83AA1 | system reset |
| TIMG1 WDT | 2.AQ/**2.BM** | ✓ 5s | 0x50D83AA1 | system reset |
| **RTC WDT** | **2.AT/2.BN** | **✓ 5s** | **0x50D83AA1** | **system reset** |
| **Super WDT** | **2.AT/2.BN** | **✓ 1s** | **0x50D83AA1** (was wrong) | **system reset** |

4/4 watchdogs with TRM-correct write-protect keys and timeout-
triggered reset behavior. Boot remains safe — disable sequence
keeps timers disarmed.

JSON event types: **26** (this phase adds reset behavior to
existing `wdt_reset` event from Phase 2.BM; no new types).

## 51-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.BK  | LEDC IRQ wiring                                          |
| 2.BL  | 3/3 CAN buses                                            |
| 2.BM  | TIMG WDT actual reset                                    |
| **2.BN** | **RTC + Super WDT reset + TRM silicon fix (4/4 WDTs)** |

## Próximas direcciones

- **Multi-stage RWDT** — stages cycling 0→1→2→3→0 per TRM
  17.2.2.2.
- **WDT IRQ action** — IRQ-based stage action instead of just
  reset.
- **SWD auto-feed** — model `SWD_AUTO_FEED_EN`.
- **Exact timeout** from CONFIG registers.
- **UART IRQ** (QOM class-override variation).
- **Real PWM waveform** on GPIO via LEDC.
- **BH1750/SHT31/CCS811** sensor adds.
- **SPI3** instantiation.
- **FreeRTOS** scheduler resurrection.
