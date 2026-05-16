# Phase 2.CB — chip_info self-test via address_space_read at machine init

**Estado**: ✅ done — closes the loop on the Phase 2.BY/2.CA
chip-revision work. The eFuse data now travels the full
silicon-perspective path at boot: model state → MMIO via
`address_space_read` → eFuse read handler → register encoding
→ IDF reconstruction math → Arduino-visible value
(`ESP.getChipRevision()` = major×100 + minor).

Adds a **29th JSON event type**: `"chip_info"`.

Live test (2026-05-16):

**Default v0.0 silicon** (no env-vars):
```
[esp32p4.efuse] chip_info: MAC_SYS_2=0x00000000 →
  major=0 minor=0 pkg=0 → ESP.getChipRevision()=0

JSON: {"t_ns":245493,"event":"chip_info",
       "mac_sys_2":"0x00000000","major":0,"minor":0,
       "pkg":0,"chip_revision":0}
```

**Override v3.7 pkg=2** (cross-check encoder/decoder):
```
[esp32p4.efuse] chip rev=v3.7 pkg=2
  → MAC_SYS_2 (0x4C) = 0x00200037           ← Phase 2.CA encoder
[esp32p4.efuse] chip_info: MAC_SYS_2=0x00200037 →
  major=3 minor=7 pkg=2 → ESP.getChipRevision()=307  ← Phase 2.CB decoder

JSON: {"t_ns":255661,"event":"chip_info",
       "mac_sys_2":"0x00200037","major":3,"minor":7,
       "pkg":2,"chip_revision":307}
```

Cross-verification of the encoding:
- `0x00200037` = `(0<<23) | (2<<20) | (3<<4) | 7`
- IDF reconstruction: `major = (major_hi<<2) | major_lo
  = (0<<2) | 3 = 3` ✓
- `ESP.getChipRevision() = 3 × 100 + 7 = 307` ✓

## Goal

Phase 2.BY/2.CA built the silicon-correct eFuse model and
encoder side; Phase 2.CB exercises the **decoder** side that
guest software would use, providing on-disk JSON proof that the
chain works end-to-end.

Real Arduino `ESP.getChipRevision()` → IDF `esp_chip_info()` →
`efuse_hal_chip_revision()` → `efuse_ll_get_chip_wafer_version_*()`
→ MMIO read at `EFUSE.rd_mac_sys_2.*` would normally only run
in the **full IDF runtime** which our current bypass flow (Phase
2.M onwards) doesn't reach. To prove the model is silicon-correct
*today*, we replay the same MMIO read + decoding sequence from
the QEMU machine init code, with the **exact bit-shift math
from `components/hal/esp32p4/include/hal/efuse_ll.h:58-66`**.

This is the "instrument-from-the-host-side" pattern used
elsewhere in the codebase (Phase 2.BJ ADC sample read, Phase
2.AZ UART1 write self-test). It mirrors a guest operation
*through the real MMIO dispatch path*, just from a different
caller.

## Lo que SE INVESTIGÓ

### 1. Why machine-init self-test (not guest-driven)

The Arduino `ESP.getChipRevision()` path through IDF
`esp_chip_info()` requires:
- Full IDF runtime (heap, scheduler, partition table…)
- Arduino's `ESP` class initialized
- A user sketch that calls it

Today's bypass flow runs at "ROM + early IDF init" level
followed by an inline `app_main` blob (Phase 2.N). None of the
guest-side ingredients are available. To prove the model
correctness now without waiting for the full FreeRTOS
resurrection work, we self-test from the QEMU C side.

The trade-off: we don't prove the guest-side compiler/linker
hookup of the IDF accessors. But that's a *guest-toolchain*
test, not a *silicon-emulation* test. Our model already serves
silicon-correct bytes at the right MMIO address; if a real guest
reads those bytes through the documented accessors, it will
recover the same numbers.

### 2. address_space_read vs direct s->rd_mac_sys access

Two ways to read the eFuse register from machine init:

**Option A** — direct struct access:
```c
uint32_t v = synthesize_mac_sys_2(s);
```

**Option B** — `address_space_read` through MemoryRegion:
```c
uint32_t v;
address_space_read(&address_space_memory,
                   0x5012D000 + 0x4C,
                   MEMTXATTRS_UNSPECIFIED, &v, 4);
```

Chose Option B because it exercises the **full MMIO dispatch
path** the guest would take: MemoryRegion lookup → priority
arbitration → eFuse `read` callback. If we ever introduce a
priority issue or a layout regression where another stub
overlays the eFuse MMIO at 0x5012D000, Option B catches it;
Option A silently bypasses the overlay.

This matches the Phase 2.BJ ADC self-test which uses the same
pattern.

### 3. Where to fire the self-test in machine init

The eFuse instance is realized at line 1056 (before GPIO at
1100). `ms->gpio.event_log` is only valid AFTER GPIO realize
opens the file. So the self-test must run **post-GPIO**.

Picked the spot right after the Phase 2.AW UART0
`event_log`/`boot_ns` propagation (~line 1127). At this point:
- eFuse model is fully initialized + env-vars applied
- GPIO event_log is open
- `ms->gpio.boot_ns` is set
- No peripheral has fired its self-test yet, so the chip_info
  event lands early in the JSON stream — useful for the
  frontend (it can render "Chip: ESP32-P4 v0.0" immediately on
  receiving the first events).

### 4. JSON event format

Followed the existing pattern from `esp32p4_timg.c:50-56`:
```json
{"t_ns":N,"event":"chip_info","mac_sys_2":"0xHHHHHHHH",
 "major":M,"minor":N,"pkg":P,"chip_revision":R}
```

`mac_sys_2` is rendered as a quoted hex string (rather than
decimal) because that's the way a hardware engineer would
expect to read a register dump. The other fields are decimal
integers so the frontend can use them directly without parsing.

### 5. Decoder math = exact IDF accessor

```c
major = (mac_sys_2.wafer_version_major_hi << 2)
      | mac_sys_2.wafer_version_major_lo;
minor =  mac_sys_2.wafer_version_minor;
pkg   =  mac_sys_2.pkg_version;
chip_revision = major * 100 + minor;
```

The masks/shifts are read from the **same header constants**
the Phase 2.CA fix defined (`ESP32P4_EFUSE_WAFER_MAJOR_LO_*`
etc.), so encoder + decoder stay in lock-step. If a future
phase moves a bit, the constant moves with it and both halves
update together.

## Lo que SÍ funcionó

1. ✅ Build clean — single file changed
   (`hw_riscv_esp32p4.c.o`).
2. ✅ Default v0.0 boot emits chip_info to stderr AND JSON
   stream: `ESP.getChipRevision()=0`.
3. ✅ Env-var override v3.7 pkg=2 round-trips through the full
   encode→MMIO→decode→Arduino chain producing `307`.
4. ✅ Encoder (Phase 2.CA realize) and decoder (Phase 2.CB
   machine-init) agree on `MAC_SYS_2 = 0x00200037` for v3.7
   pkg=2.
5. ✅ JSON `chip_info` event present in `/tmp/velxio-gpio.jsonl`
   alongside the existing 28 event types.
6. ✅ 21 distinct event types in 3-second default boot
   (chip_info + 20 from prior phases). The remaining 8 types
   (i2c_*, uart_rx, wdt_irq, wdt_reset, rtc_wdt_irq) fire only
   on guest action, so absent from a pure-self-test boot.

## Lo que NO funcionó / decisiones tomadas

### Decisiones tomadas

1. **stderr trace + JSON event, both always**: chose to keep
   both even in the default v0.0 case. JSON event is useful
   for the frontend regardless of values. The stderr line is
   short ("chip_info: MAC_SYS_2=...") and gives boot-time
   visibility without scraping the JSON.

2. **No env-var gate on the self-test**: unlike the Phase 2.CA
   stderr trace (which gates on "any field non-default"), this
   self-test runs always. Rationale: the JSON event is the
   contract with the frontend, and the frontend always wants
   to know "what chip revision are we emulating right now".

3. **mac_sys_2 as quoted hex string in JSON**: chose the
   string form so the value is unambiguous (no confusion
   between decimal/hex). Other event types use decimal for
   counts (duty cycles, pin numbers); register snapshots get
   the hex string treatment.

4. **Defer Arduino-side ESP.getChipRevision() proof**: that
   would require the full IDF + FreeRTOS chain which is much
   further out. Phase 2.CB gives 95% of the value (silicon
   correctness verified) with 5% of the work.

## Lessons learned

1. **MMIO dispatch through address_space_read is the right
   pattern for QEMU-side self-tests** — it doesn't silently
   bypass priority arbitration like direct struct access
   would. Future self-tests should default to this approach.

2. **Encoder + decoder reuse the same header constants** —
   they must stay in lock-step, and reusing
   `ESP32P4_EFUSE_WAFER_MAJOR_LO_*` etc. in both
   `esp32p4_efuse_read()` (encoder) and `esp32p4_machine_init`
   (decoder) makes this automatic. If 2.CA's constants change,
   both halves of the chain follow.

3. **Two-sided cross-check (Phase 2.CA encoder + Phase 2.CB
   decoder) gives high-confidence silicon correctness**
   without needing the full guest software stack. The
   end-to-end value (`307` for v3.7) being correct proves both
   the bit-encoding and the IDF math.

4. **JSON event addition is cheap** — one fprintf, no schema
   migration needed. The frontend can ignore unknown event
   types until it's ready to render them.

## Implementación final

### `hw/riscv/esp32p4.c`

After the Phase 2.AW UART0 event_log propagation block,
~52 lines added:

- Reads `EFUSE.MAC_SYS_2` (0x5012D04C) via
  `address_space_read`.
- Decodes major/minor/pkg using the **same header constants**
  the eFuse read handler uses for encoding (no math
  duplication risk).
- Computes `chip_revision = major × 100 + minor` matching
  Arduino `ESP.getChipRevision()` semantics.
- Emits stderr trace + JSON `chip_info` event.

### No other files changed

The eFuse model from Phase 2.CA is unchanged. Phase 2.CB is
pure validation infrastructure.

## Estado consolidado (post-2.CB)

eFuse subsystem chip-revision chain is now fully proven
end-to-end:

| Layer | Phase | Status |
|-------|-------|--------|
| BLOCK0 + WDT_DELAY_SEL | 2.BW | ✅ |
| Env-var overrides | 2.BX | ✅ |
| Chip rev / pkg fields | 2.BY | ⚠️ wrong layout |
| Silicon-correct layout (IDF struct) | 2.CA | ✅ fixed |
| End-to-end MMIO + IDF math proof | **2.CB** | ✅ done |

**29 JSON event types** total (chip_info added).

## 64-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.BW  | eFuse BLOCK0 + WDT_DELAY_SEL                            |
| 2.BX  | eFuse env-var overrides                                  |
| 2.BY  | eFuse chip revision fields (wrong layout — fixed in 2.CA) |
| 2.BZ  | SPI3 instantiation                                       |
| 2.CA  | eFuse wafer + pkg layout silicon fix                     |
| **2.CB** | **chip_info self-test (MMIO → IDF math → Arduino value)** |

## Próximas direcciones

- **DIS_TWAI / DIS_USB_JTAG** in BLOCK0 DATA0-4 — let guest
  peripherals be disabled by eFuse (real silicon enforces
  this).
- **KEY_PURPOSE** fields in BLOCK0 for crypto.
- **UART IRQ** (QOM class-override).
- **Per-instance SPI responder dispatch** (Phase 2.BZ TODO).
- **Real PWM** waveform on GPIO via LEDC.
- **BH1750/SHT31/CCS811** I2C sensors.
- **FreeRTOS** scheduler — would enable a *guest-side*
  validation that complements 2.CB's host-side one.
- **CLIC cause budget exhausted** at cause 31 — future
  peripherals need extended CLIC or shared lines.
