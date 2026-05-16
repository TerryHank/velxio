# Phase 2.CC — DIS_TWAI eFuse field + TWAI peripheral disable

**Estado**: ✅ done — first peripheral disable wired to an eFuse
field, demonstrating silicon-faithful clock-gate enforcement.

When eFuse `DIS_TWAI` is set, real silicon clock-gates the
entire TWAI block: MMIO reads return 0 (no clock = no register
access), writes are silently absorbed, no IRQs are asserted.
The Velxio emulator now mirrors this exactly across all 3 TWAI
controller instances (TWAI0/1/2 from phases 2.BA + 2.BL).

Live verification (2026-05-16):

**Default boot** (DIS_TWAI=0, factory default):
```
"event":"twai"       3   (1 TX per port × 3 ports)
"event":"twai_irq"   9   (3 IRQ transitions per port × 3 ports)
"event":"twai_rx"    3   (1 RX consumed per port × 3 ports)
                    --
                    15 TWAI events (5 per port × 3 ports)
```

**With `VELXIO_EFUSE_DIS_TWAI=1`**:
```
"event":"twai"       0
"event":"twai_irq"   0
"event":"twai_rx"    0
                    --
[esp32p4.efuse] VELXIO_EFUSE_DIS_TWAI=1 (peripheral disabled)
[esp32p4.twai0] self-test skipped — eFuse DIS_TWAI=1
[esp32p4.twai1] self-test skipped — eFuse DIS_TWAI=1
[esp32p4.twai2] self-test skipped — eFuse DIS_TWAI=1
```

All other peripherals (adc, ledc, spi, rmt, rng, timg, wdt,
uart_tx, chip_info, …) continue to emit their normal events
when DIS_TWAI=1 — surgical peripheral disable, zero regression
on the rest of the chip.

## Goal

Extend the eFuse-as-source-of-truth pattern (established in
Phase 2.BW for WDT_DELAY_SEL) to peripheral availability.
Real silicon honors `DIS_TWAI` by physically disconnecting
the TWAI block from the clock tree at the system clock
controller — software cannot override it. IDF's TWAI driver
reads the eFuse bit first and refuses to initialize when set;
even bypassing IDF would leave the MMIO returning 0.

The emulator now does the same: snapshot the eFuse bit at
machine init, propagate to each TWAI instance's `disabled`
flag, suppress reads/writes/self-tests when disabled. Single
eFuse bit governs ALL 3 ports — real silicon clock-gates the
whole TWAI block, not individual ports.

## Lo que SE INVESTIGÓ

### 1. IDF source of truth for the bit positions

`components/soc/esp32p4/include/soc/efuse_struct.h` §
`efuse_rd_repeat_data0_reg_t` defines three peripheral-disable
fields all packed into `EFUSE_RD_REPEAT_DATA0_REG` (offset
0x30):

| Field | Bit | Semantics |
|-------|-----|-----------|
| `dis_usb_jtag` | 9 | USB-to-JTAG bridge disable |
| `dis_usb_serial_jtag` | 11 | USB serial + JTAG path disable |
| `dis_twai` | 14 | TWAI/CAN peripheral disable |

All have RO semantics (`1 = disabled, 0 = enabled`) and
default to 0 (un-programmed eFuse → all peripherals enabled).

The Phase 2.CC implementation adds all three accessors + env-
vars to the eFuse model. Only `DIS_TWAI` is wired to peripheral
behavior because:
- USB peripherals (USB-Serial/JTAG bridge) are not yet modeled.
- TWAI has a full peripheral model from phases 2.BA/2.BC/2.BF/
  2.BL that we can actually disable.

Documenting USB_JTAG / USB_SERIAL_JTAG now (as accessors + env-
vars + stderr trace) costs ~30 LOC and means future USB phases
can wire to them without revisiting the eFuse model.

### 2. Silicon-faithful disable semantics

When the TWAI block has no clock applied on real silicon:
- MMIO bus accesses to the peripheral's region return 0
  (no register fabric responding).
- Writes are absorbed by the bus interconnect but never reach
  the peripheral's internal storage.
- The peripheral cannot assert IRQs (no clock = no edge
  detection logic running).

The emulator mirrors this exactly:
- `esp32p4_twai_read()` checks `s->disabled` FIRST, before any
  storage access or INTR clear-on-read side effect. Returns 0.
- `esp32p4_twai_write()` checks `s->disabled` FIRST, before
  any storage update or CMD-decode dispatch. Drops silently.
- `esp32p4_twai_self_test()` checks `s->disabled` and emits a
  stderr "skipped" message instead of running the 5-event
  test sequence.

### 3. Snapshot semantics

The eFuse bit is **read once at machine init** and copied into
the TWAI state. This matches silicon: eFuse bits are RO after
programming, and the clock-gate signal is wired at boot — it
doesn't change during runtime.

Snapshot timing: AFTER `esp32p4_efuse_apply_env_overrides()`
runs (so env-var settings are respected), BEFORE the TWAI self-
test fires (so a disabled TWAI emits no events).

### 4. JSON event suppression vs absence

The Velxio frontend infers "TWAI port N disabled" from the
**absence** of port-tagged JSON events. If a port emits no
events at all, the UI renders it as grayed-out. This is the
simplest contract: no new "disabled" event type needed.

The stderr `self-test skipped` line gives boot-time visibility
for debugging. JSON stream stays clean.

### 5. Per-port flag vs global flag

Considered two designs:
- **Per-port**: each `ESP32P4TwaiState.disabled` field set
  independently.
- **Global**: single bit governs all instances.

Per-port matches silicon (one bit per peripheral block, not
per port — and TWAI is one block). The implementation in
machine init naturally does both: it sets each port's
`disabled` flag from the same eFuse accessor call, so all 3
ports flip together. Future eFuse fields that disable
individual ports would set them differently.

## Lo que SÍ funcionó

1. ✅ Build clean — 3 files compiled
   (`hw_misc_esp32p4_twai.c.o`, `hw_nvram_esp32p4_efuse.c.o`,
   `hw_riscv_esp32p4.c.o`).
2. ✅ Default boot still produces 15 TWAI events (5 × 3
   ports) — Phase 2.BL behavior preserved.
3. ✅ `VELXIO_EFUSE_DIS_TWAI=1` produces 0 TWAI events of any
   type (twai, twai_irq, twai_rx) — surgical disable.
4. ✅ Stderr shows the eFuse override message + 3 "self-test
   skipped" lines (one per port) — debuggable.
5. ✅ All other peripherals continue normally (adc 8, ledc 22,
   spi 8, rmt 3, rng 3, timg 4, wdt 8, uart_tx 30, chip_info
   1, start 1, …) — zero regression beyond TWAI.

## Lo que NO funcionó / decisiones tomadas

### Decisiones tomadas

1. **Wire only DIS_TWAI to peripheral behavior**: USB_JTAG +
   USB_SERIAL_JTAG fields are exposed as accessors + env-vars
   but don't yet affect any peripheral, because USB peripherals
   aren't modeled. Saves ~3 hours of "model the USB peripheral
   first" yak-shaving. Wiring them is trivial once a USB model
   exists.

2. **Suppress on read instead of return-error**: silicon does
   silent suppression (no fault, no error), and the IDF driver
   handles "all-zero registers" gracefully. Returning a bus
   error would be more "obviously wrong" but doesn't match
   silicon.

3. **Stderr message format**: `[esp32p4.twai0] self-test
   skipped — eFuse DIS_TWAI=1` mirrors the existing
   `[esp32p4.X] message` format used elsewhere. Punctuation
   uses an em-dash for visual distinction from the typical
   key=value log lines.

4. **Snapshot at machine init (not on every read)**: gives
   silicon-faithful semantics + better performance + simpler
   code. Costs nothing in flexibility since eFuse is RO post-
   programming.

5. **One env-var per DIS_* bit** (not a single bitmask): users
   set `VELXIO_EFUSE_DIS_TWAI=1` not `VELXIO_EFUSE_DIS_FIELDS=0x4000`.
   More discoverable, easier to document, harder to typo.

## Lessons learned

1. **eFuse-as-source-of-truth scales beyond timing parameters**
   — the same pattern (snapshot at init + propagate to
   peripheral state) works for behavioral switches like
   peripheral availability. Future eFuse fields will follow
   the same template.

2. **Surgical disable beats global rebuild** — wiring 3
   read/write/self-test gates on the existing TWAI model is
   far cheaper than building a separate "disabled TWAI" class.
   The `disabled` flag is one extra word in the struct.

3. **Bundling related-but-not-wired fields documents future
   work** — adding USB_JTAG/USB_SERIAL_JTAG accessors now
   (without wiring) means future USB peripheral phases just
   call the accessor; no eFuse model refactor needed.

4. **Static const table for parsing** — the env-var loop in
   `esp32p4_efuse_apply_env_overrides()` uses a small static
   const table mapping name → mask. Adding a 4th DIS_* field
   in the future means appending one row, not duplicating ~15
   lines of parsing logic.

## Implementación final

### `include/hw/nvram/esp32p4_efuse.h`

- Added 3 constant pairs (`DIS_TWAI_SHIFT/MASK`,
  `DIS_USB_JTAG_SHIFT/MASK`, `DIS_USB_SERIAL_JTAG_SHIFT/MASK`)
  at the IDF-documented bit positions.
- Added 3 accessor forward-declarations:
  - `esp32p4_efuse_get_dis_twai()`
  - `esp32p4_efuse_get_dis_usb_jtag()`
  - `esp32p4_efuse_get_dis_usb_serial_jtag()`

### `hw/nvram/esp32p4_efuse.c`

- Added 3 accessor implementations reading from
  `s->rd_repeat_data[0]`.
- Added env-var parsing via a static const table loop in
  `esp32p4_efuse_apply_env_overrides()`. Each entry is `{env
  name, bit mask, label}`. Accepts "0" or "1".

### `include/hw/misc/esp32p4_twai.h`

- Added `bool disabled` field to `ESP32P4TwaiState` with a
  silicon-faithful semantics comment.

### `hw/misc/esp32p4_twai.c`

- `esp32p4_twai_read()` gates on `s->disabled` first, returns
  0 without storage access or INTR side effect.
- `esp32p4_twai_write()` gates on `s->disabled` first, silently
  drops the write.
- `esp32p4_twai_self_test()` checks `s->disabled` after the
  event_log NULL check and emits a stderr "skipped" message
  instead of running the test sequence.

### `hw/riscv/esp32p4.c`

- Added `ms->twai0.disabled = esp32p4_efuse_get_dis_twai(...)`
  in the TWAI0 init block before self-test.
- Added the same call in the TWAI1/2 instantiation loop. All
  3 ports flip together — silicon clock-gates the whole TWAI
  block, not individual ports.

## Estado consolidado (post-2.CC)

eFuse model now covers 2 distinct silicon-state categories:

| Category | Fields | Wired to behavior |
|----------|--------|-------------------|
| Timing config | WDT_DELAY_SEL | Phase 2.BW → RWDT timeout |
| Chip identity | WAFER_MINOR/MAJOR, PKG_VERSION | Phase 2.BY/CA/CB → chip_info |
| **Peripheral availability** | **DIS_TWAI** | **Phase 2.CC → TWAI ports** |
| MAC | MAC_SYS_0/1 | Phase 2.BW (read-only stub) |
| Unwired (placeholders) | DIS_USB_JTAG, DIS_USB_SERIAL_JTAG | accessors exist, await USB model |

JSON event types: **29** (chip_info from 2.CB; no new event
type in 2.CC — TWAI events simply absent when disabled).

## 65-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.CA  | eFuse wafer + pkg layout silicon fix                    |
| 2.CB  | chip_info self-test (MMIO → IDF math → Arduino value)   |
| **2.CC** | **DIS_TWAI eFuse field + 3-port TWAI peripheral disable** |

## Próximas direcciones

- **Wire DIS_USB_JTAG / DIS_USB_SERIAL_JTAG** to USB
  peripheral models when those exist.
- **KEY_PURPOSE** fields in BLOCK0 for crypto routing.
- **UART IRQ** (QOM class-override).
- **Per-instance SPI responder dispatch** (Phase 2.BZ TODO).
- **Real PWM** waveform on GPIO via LEDC.
- **BH1750/SHT31/CCS811** I2C sensors.
- **FreeRTOS** scheduler resurrection.
- **DIS_PAD_JTAG + SOFT_DIS_JTAG** — additional JTAG-related
  eFuse fields per IDF struct (lines 218-227); could be wired
  once a JTAG bridge model exists.
- **CLIC cause budget exhausted** at cause 31 — future
  peripherals need extended CLIC or shared lines.
