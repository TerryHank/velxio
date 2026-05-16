# Phase 2.CA — eFuse wafer + pkg layout silicon fix per IDF efuse_struct.h

**Estado**: ✅ done — 12th TRM/IDF-grounding silicon fix in the
12-phase quality streak (2.BN→2.BY) + corrects a latent bug
introduced in Phase 2.BY.

Phase 2.BY put wafer_version + pkg_version fields in `MAC_SYS_3`
(offset `0x50`) with a 3/2/3-bit contiguous layout derived from
mistaken bit-numbering math of IDF's `esp_efuse_table.csv` (the
high-level BLOCK1 bit indices 114-121). The **authoritative**
silicon layout in
`components/soc/esp32p4/include/soc/efuse_struct.h` § 565-624
(`efuse_rd_mac_sys_2_reg_t`) shows the fields actually live in
**`MAC_SYS_2`** (offset `0x4C`) with a **split-encoding for the
3-bit major** version field:

| Field | Phase 2.BY (wrong) | IDF efuse_struct.h (correct) |
|-------|--------------------|------------------------------|
| Register | `mac_sys_3` @ 0x50 | **`mac_sys_2` @ 0x4C** |
| wafer_minor | bits 18:20 (3-bit) | **bits 0:3 (4-bit)** |
| wafer_major | bits 21:22 (2-bit contig) | **bits 4:5 (lo) + 23 (hi)** — 3-bit split |
| pkg_version | bits 23:25 | **bits 20:22** |

The ROM-side accessor in `components/hal/esp32p4/include/hal/efuse_ll.h:58`
does this exact reconstruction:

```c
__attribute__((always_inline)) static inline uint32_t
efuse_ll_get_chip_wafer_version_major(void)
{
    return (EFUSE.rd_mac_sys_2.wafer_version_major_hi << 2)
         | EFUSE.rd_mac_sys_2.wafer_version_major_lo;
}
```

So our MMIO model must serve a register value with bits in
**those exact positions** for `ESP.getChipRevision()` to read
correctly. Phase 2.BY's encoding would have produced garbage from
the ROM side once Phase 2.CB wired the ROM stub up — fixing 2.CA
first is the prerequisite.

Live verification (2026-05-16):

```
VELXIO_EFUSE_REV_MAJOR=7 VELXIO_EFUSE_REV_MINOR=15 VELXIO_EFUSE_PKG=7
→ chip rev=v7.15 pkg=7 → MAC_SYS_2 (0x4C) = 0x00F0003F

VELXIO_EFUSE_REV_MAJOR=4 VELXIO_EFUSE_REV_MINOR=2 VELXIO_EFUSE_PKG=0
→ chip rev=v4.2 pkg=0 → MAC_SYS_2 (0x4C) = 0x00800002
```

Decoded for the max-values case `0x00F0003F`:
- bits 0:3   = 0xF  → minor = 15 ✓
- bits 4:5   = 0b11 → major_lo = 3
- bits 20:22 = 0b111 → pkg_version = 7 ✓
- bit 23     = 0b1  → major_hi = 1
- IDF reconstruction: `major = (1<<2) | 3 = 7` ✓

Decoded for the major=4 case `0x00800002` (tests the major_lo=0,
major_hi=1 edge):
- bits 0:3   = 0x2  → minor = 2 ✓
- bits 4:5   = 0b00 → major_lo = 0
- bits 20:22 = 0    → pkg = 0 ✓
- bit 23     = 0b1  → major_hi = 1
- IDF reconstruction: `major = (1<<2) | 0 = 4` ✓

Default boot remains silent (0 efuse stderr lines, 197 GPIO
events at 2-second timeout — proportional to prior baseline,
regression-clean).

## Goal

Discovered while planning the next phase (chip-info ROM stub
for `ESP.getChipRevision()`). To wire the ROM stub up correctly,
the eFuse model must serve a register value the IDF accessor can
decode. Reviewing the IDF accessor against Phase 2.BY's eFuse
read handler exposed three independent bugs in 2.BY: wrong
register offset, wrong bit positions for all three fields, and
wrong field widths.

This is exactly the failure mode the user has been calling out
in every prompt: *"la idea es q sea una emulación lo mas cercana
a la vida real de un chip físico"*. Phase 2.BY documented IDF's
high-level bit indices but didn't cross-check the silicon-level
register struct — and the high-level indices and the silicon
register encoding disagree.

## Lo que SE INVESTIGÓ

### 1. The two authoritative IDF sources

There are two sources of truth in IDF for eFuse field
locations:

1. **High-level table** (`components/efuse/esp32p4/esp_efuse_table.csv`):
   uses BLOCK-relative bit indices (e.g., bits 114-116 in
   BLOCK1). This is what Phase 2.BY consulted.
2. **Silicon register struct** (`components/soc/esp32p4/include/soc/efuse_struct.h`):
   the actual MMIO register layout with bit-field accessors.
   This is what the ROM-side `efuse_ll.h` actually reads from.

The two **should** be equivalent, but BLOCK1 spans 6 registers
(MAC_SYS_0..5) at 32 bits each, not perfectly aligned. The
high-level indices in the CSV use a virtual flattened bit space
that doesn't trivially divide by 32 to give the register +
in-register offset. Phase 2.BY's math (`bit 114 - 96 = 18 →
MAC_SYS_3 bits 18:20`) was an *incorrect interpretation* of the
flattened bit space.

**Lesson**: always cross-check the silicon struct, not the CSV,
when implementing register-level emulation.

### 2. The split-encoding for major version

The most surprising silicon detail: **the 3-bit major version is
encoded in two non-adjacent fields**:
- 2 low bits at `mac_sys_2 [4:5]` (`wafer_version_major_lo`)
- 1 high bit at `mac_sys_2 [23]` (`wafer_version_major_hi`)

The ROM accessor reconstructs: `major = (hi << 2) | lo`.

Phase 2.BY assumed major was a contiguous 2-bit field at 21:22.
Both the position AND the width are wrong.

Why does silicon use a split encoding? Probably because the eFuse
field allocation grew over chip generations and the engineers had
to fit `wafer_version_major_hi` into a free bit when major
exceeded 2 bits. We see the same pattern on ESP32-S3 (per the H2
hal commentary `"wafer_major and MSB of wafer_minor was
allocated to other purposes when block version is v1.1"`).

### 3. Width corrections

- `minor`: Phase 2.BY said 3 bits, IDF struct says **4 bits**
  (0..15)
- `major`: Phase 2.BY said 2 bits, IDF struct says **3 bits**
  (0..7) — and split across two fields
- `pkg`: width agrees (3 bits), but position is **20:22** (not 23:25)

### 4. Env-var range widening

Since the field widths grew, the env-var range checks also need
to widen:
- `VELXIO_EFUSE_REV_MAJOR`: 0..3 → **0..7**
- `VELXIO_EFUSE_REV_MINOR`: 0..7 → **0..15** (now needs strtol
  since the value can be 2-digit ASCII)
- `VELXIO_EFUSE_PKG`: 0..7 (unchanged)

### 5. No need to touch the other MAC_SYS_2 fields

The other fields in MAC_SYS_2 (`disable_wafer_version_major`,
`disable_blk_version_major`, `blk_version_minor/major`,
`psram_cap`, `temp`, `psram_vendor`, `ldo_vo1_dref`,
`ldo_vo2_dref`) are all left at 0 by default — un-programmed
eFuse appears as all-zeros to the guest, which matches launch
silicon. Future phases can wire individual fields if a guest
test fails.

## Lo que SÍ funcionó

1. ✅ Build clean — single file changed (`hw_nvram_esp32p4_efuse.c.o`).
2. ✅ Default boot regression-clean — no efuse stderr noise when
   env-vars unset (Phase 2.BX silent-default contract preserved).
3. ✅ Live encoding verification matches IDF reconstruction math
   for both the saturated case (major=7, minor=15, pkg=7 →
   0x00F0003F) and the major-split edge case (major=4, lo=0,
   hi=1 → 0x00800002).
4. ✅ Reverse reconstruction by hand for both cases confirms the
   ROM accessor will read back exactly the configured value.

## Lo que NO funcionó / decisiones tomadas

### Decisiones tomadas

1. **Fix vs document-as-known-issue**: chose to fix because
   Phase 2.CB (chip-info ROM stub, task #143) directly depends
   on the encoding being correct. Wiring up a ROM stub that
   reads from MAC_SYS_3 would compound the bug rather than
   isolate it.

2. **Symbolic constants for both halves of major**: kept
   `WAFER_MAJOR_LO_SHIFT` and `WAFER_MAJOR_HI_SHIFT` as separate
   constants rather than computing them inline. The 2-step
   encoding is non-obvious; named constants make the intent
   readable when this code is revisited.

3. **Print synthesized value only on env-override**: gates the
   `chip rev=vX.Y pkg=Z → MAC_SYS_2 = 0xNNNNNNNN` stderr line
   behind "any of major/minor/pkg is non-zero". Default boot
   stays silent. Same contract as Phase 2.BX.

4. **Defer fix for the encoded value when MAC_SYS_2 read covers
   *other* fields**: today the read returns ONLY the chip-rev +
   pkg bits, with the LDO + psram + blk_version fields all
   zeroed. That's silicon-correct for un-programmed eFuse and
   doesn't break anything. Adding accessors for those fields is
   independent work.

5. **Wider env-var range for MINOR** (1-2 digit ASCII): switched
   from single-char to `strtol` parsing only for MINOR, since
   MAJOR and PKG remain single-digit (0..7) and don't need
   2-digit support. Keeps the parser surface minimal.

## Lessons learned

1. **Two IDF sources of truth, not one**: high-level
   `esp_efuse_table.csv` describes WHAT each field means, but
   the silicon-level `efuse_struct.h` describes WHERE each
   field lives in MMIO. For MMIO emulation, the latter is
   authoritative. Phase 2.BY consulted only the former.

2. **Split fields are a real silicon pattern**: don't assume
   bit fields are contiguous. The major-version field on
   ESP32-P4 is split across bits 4:5 + 23 because of historical
   eFuse layout growth. Future fields (DIS_TWAI, KEY_PURPOSE,
   etc.) may have similar split-encodings — always cross-check
   against `efuse_struct.h`.

3. **Add an end-to-end verification on every encoding change**:
   the env-var-driven stderr trace lets us prove the encoded
   register value by hand. Without that visibility, this bug
   would have stayed latent until Phase 2.CB triggered a
   user-visible `ESP.getChipRevision()` failure.

4. **The "12-phase TRM-grounding streak" pattern continues to
   pay off**: 2.BN found two silicon bugs in 2.AT/2.AP, and
   now 2.CA finds three more in 2.BY. Each grounded phase
   surfaces latent bugs in earlier ones because it forces a
   careful re-read of the authoritative spec.

## Implementación final

### `include/hw/nvram/esp32p4_efuse.h`

- Replaced 3 constants (`WAFER_MINOR/MAJOR/PKG_VERSION_SHIFT`)
  with 4 (`WAFER_MINOR`, `WAFER_MAJOR_LO`, `WAFER_MAJOR_HI`,
  `PKG_VERSION`), all repositioned to the IDF
  `efuse_rd_mac_sys_2_reg_t` layout.
- Widened `chip_rev_major` comment from "0..3 (2 bits)" to
  "0..7 (3 bits)" and `chip_rev_minor` from "0..7 (3 bits)" to
  "0..15 (4 bits)".
- Replaced the multi-paragraph "TRM ch.8 omits these field
  definitions" comment block with a precise IDF citation +
  bit-position table.

### `hw/nvram/esp32p4_efuse.c`

- Switched the read handler `case` from `MAC_SYS_3` (offset
  0x50) to `MAC_SYS_2` (offset 0x4C).
- Rewrote the encoding to use the split-major pattern: 4-bit
  minor at 0:3, 2-bit major_lo at 4:5, 1-bit major_hi at 23,
  3-bit pkg at 20:22.
- Widened `esp32p4_efuse_get_chip_rev_major()` mask from 0x3
  to 0x7, and `_minor` mask from 0x7 to 0xF.
- Updated env-var parsers: REV_MAJOR now accepts 0..7,
  REV_MINOR now uses `strtol` for 0..15.
- Added a one-shot stderr trace at realize that prints the
  synthesized MAC_SYS_2 value when any chip-rev field has been
  overridden — proves the encoding end-to-end without needing
  a separate test harness.

## Estado consolidado (post-2.CA)

eFuse model now matches IDF silicon struct for the
chip-revision path. Boot regression-clean. The MAC_SYS_3 case
in the read handler is gone (returns 0 as un-programmed).

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.BW  | eFuse BLOCK0 + WDT_DELAY_SEL                            |
| 2.BX  | eFuse env-var overrides                                  |
| 2.BY  | eFuse chip revision fields (**wrong layout — fixed in 2.CA**) |
| 2.BZ  | SPI3 instantiation                                       |
| **2.CA** | **eFuse wafer + pkg layout silicon fix per IDF efuse_struct.h** |

## Próximas direcciones

- **2.CB: Chip-info ROM stub** (task #143) now unblocked. The
  IDF inline accessor `efuse_ll_get_chip_wafer_version_*` reads
  directly from MMIO via the `EFUSE.rd_mac_sys_2.*` struct
  fields, which our model now serves correctly. The next phase
  needs to (a) verify the bootloader/IDF actually reads MAC_SYS_2
  through cache window 0x42/0x4F (vs the raw 0x5012D000 base) and
  (b) wire `efuse_hal_chip_revision()` to return major*100+minor
  end-to-end.
- **DIS_TWAI / DIS_USB_JTAG / KEY_PURPOSE** in BLOCK0 (DATA0-4)
  — would let guest peripherals be disabled by eFuse.
- **UART IRQ** (QOM class-override).
- **Per-instance SPI responder dispatch** (Phase 2.BZ TODO).
- **Real PWM** waveform on GPIO via LEDC.
- **BH1750/SHT31/CCS811** I2C sensors.
- **FreeRTOS** scheduler.
- **CLIC cause budget exhausted** at cause 31 — future
  peripherals need extended CLIC or shared lines.
