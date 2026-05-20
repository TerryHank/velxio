# Phase 2.CQ — eFuse BLOCK4-9 key material + real HMAC key reading

**Estado**: ✅ done — closes the **Phase 2.CN documented
limitation** ("synthetic key per slot since real silicon eFuse
BLOCK4-9 key material not yet modeled"). HMAC now reads the
real 256-bit key from the eFuse model, byte-perfect against
Python `hmac.new()` reference.

Live verification (2026-05-20):

| Scenario | Expected HMAC prefix (Python) | Velxio emitted | Match |
|----------|-------------------------------|----------------|-------|
| Default boot, `KEY_PURPOSE_0=5`, zero key | `8b5eebe5a590dbb4` | `8b5eebe5a590dbb4` | ✓ |
| Key programmed: `010203…1f20` | `0904d7a7b4c55899` | `0904d7a7b4c55899` | ✓ |
| Invalid hex input (`ZZZ…`) | rejected | WARN + default | ✓ |

Python reference (cross-checks both vectors):
```python
import hmac, hashlib
key0 = b"\x00" * 32
msg  = b"Velxio HMAC test" + b"\x00" * 48
hmac.new(key0, msg, hashlib.sha256).digest().hex()[:16]
# → 8b5eebe5a590dbb4  ✓
key1 = bytes.fromhex("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20")
hmac.new(key1, msg, hashlib.sha256).digest().hex()[:16]
# → 0904d7a7b4c55899  ✓
```

The eFuse → HMAC peripheral loop is now **silicon-faithful end
to end**: programmed eFuse → routed via KEY_PURPOSE → consumed
by HMAC → cryptographically-correct digest.

## Goal

Phase 2.CN's HMAC peripheral used a **synthetic deterministic
key** (`key[i] = slot ^ i ^ {DE,AD,BE,EF}[i%4]`) because the
eFuse model from Phase 2.CC only covered BLOCK0 (system
configuration), not BLOCK4-9 (key material). That was a
documented placeholder.

This phase extends the eFuse model with BLOCK4-9 and rewires
HMAC to use the real key. Now:
- Guest software writing key bytes via the eFuse controller's
  burn flow would land in `s->key_block[slot][]`.
- Env-var `VELXIO_EFUSE_KEY_BLOCK_N=64hex` lets test harnesses
  pre-program keys without modeling the full burn flow.
- HMAC peripheral calls `esp32p4_efuse_get_key_block(efuse,
  slot, real_key)` instead of synthesizing.

Default behavior matches an un-programmed chip: all-zero key
material → HMAC produces `HMAC-SHA-256(zeros, msg)`.

## Lo que SE INVESTIGÓ

### 1. Authoritative offsets from IDF efuse_reg.h

```
EFUSE_RD_KEY0_DATA0_REG = DR_REG_EFUSE_BASE + 0x9C
EFUSE_RD_KEY1_DATA0_REG = DR_REG_EFUSE_BASE + 0xBC
EFUSE_RD_KEY5_DATA7_REG = DR_REG_EFUSE_BASE + 0x158
```

Decoding:
- KEY0 base = 0x9C
- Stride = 32 bytes (8 × 4-byte registers per block)
- Last KEY5_DATA7 ends at 0x158 + 3 = 0x15B

Verified arithmetic: KEY1 = 0x9C + 32 = 0xBC ✓.
KEY5 = 0x9C + 5×32 = 0x13C; DATA7 at 0x13C + 28 = 0x158 ✓.

Each block is 256 bits (8 × 32-bit words, 32 bytes), matching
the standard AES-256 key size. The KEY_PURPOSE_N field
(Phase 2.CL) routes BLOCK4+N to whichever crypto engine
(HMAC / XTS-AES / DS / Secure Boot digest verifier) needs it.

### 2. Storage layout choice

Two options:
- **Per-block struct field**: `uint8_t key_block_0[32]; ...`
  Cleaner naming, more boilerplate, fixed at 6.
- **2D array**: `uint8_t key_block[6][32]`. Indexed access,
  compact.

Chose the 2D array. Both the MMIO read handler and the new
accessor `esp32p4_efuse_get_key_block(slot, out)` index by
slot — the 2D form matches the access pattern naturally.

### 3. MMIO byte ordering

The IDF struct treats each KEY_N_DATA_M register as a 32-bit
word read via the `efuse_rd_keyN_dataM_reg_t` union. Our
model stores keys as **byte arrays**, so the MMIO read
handler assembles 4 consecutive bytes into a little-endian
32-bit value:

```c
r = (uint32_t)p[0]
  | ((uint32_t)p[1] << 8)
  | ((uint32_t)p[2] << 16)
  | ((uint32_t)p[3] << 24);
```

This matches IDF's natural `uint32_t` reads on little-endian
RISC-V. Byte 0 of the slot's key material lives at MMIO offset
0x9C, byte 31 at 0xBB (for KEY0).

### 4. HMAC integration: replace synth with real

Phase 2.CN's HMAC peripheral had:
```c
uint8_t synth_key[32];
esp32p4_hmac_synth_key(key_slot, synth_key);
esp32p4_hmac_sha256(synth_key, sizeof(synth_key), ...);
```

Phase 2.CQ replaces with:
```c
uint8_t real_key[32];
esp32p4_efuse_get_key_block(s->efuse, key_slot, real_key);
esp32p4_hmac_sha256(real_key, sizeof(real_key), ...);
```

The synth helper is removed (replaced with a comment pointer
to Phase 2.CN's autosearch doc for historical reference). Net
change to HMAC: ~10 lines.

### 5. Side effect: Phase 2.CN's `3c79055fa71a7528` vector is superseded

The Phase 2.CN documented vector was computed against the
synthetic key. After 2.CQ, with default eFuse (all zeros), the
same `KEY_PURPOSE_0=5` test now produces `8b5eebe5a590dbb4`.

To get the *old* synth-key digest, a user would need to
program the synth-derived bytes via env-var:
```
VELXIO_EFUSE_KEY_BLOCK_0=deacbcecdaa8b8e8d6a4b4e4d2a0b0e0\
ce bcacfccab8a8f8c6b4a4f4c2b0a0f0
```

Documented in Phase 2.CN's autosearch (the synth pattern
description) for completeness. The vector is preserved in
git history if anyone needs it.

### 6. Env-var format

Decided on a single env-var per block with 64 hex characters
(= 32 bytes). Alternatives considered:
- **Per-byte env-vars** (`VELXIO_EFUSE_KEY_BLOCK_0_BYTE_0=…`):
  too verbose for test harnesses.
- **File path** (`VELXIO_EFUSE_KEY_BLOCK_0_FILE=path/to/key`):
  adds file-handling complexity to the eFuse init path.

Hex string is the minimum viable interface. Strict 64-char
length check rejects truncated input. `sscanf("%1x%1x")`
validates each pair; any non-hex char rejects the whole input
with a WARN.

## Lo que SÍ funcionó

1. ✅ Build clean — 4 files compiled
   (`efuse.c`, `hmac.c`, `sha_common.c` + `sha.c` rebuilt
   from prior phase, `esp32p4.c` machine init).
2. ✅ Zero-key default test matches Python `hmac.new(zeros,
   msg, sha256)` bit-perfect: `8b5eebe5a590dbb4`.
3. ✅ Programmed-key test matches Python with the same
   32-byte key: `0904d7a7b4c55899`.
4. ✅ Determinism confirmed (same key + same msg → same
   digest across reruns).
5. ✅ Invalid input rejection works (`ZZZ...` → WARN +
   default).
6. ✅ HMAC validation gate (Phase 2.CM) still fires
   correctly — eFuse `KEY_PURPOSE_0=USER` with default zero
   key produces ERROR; `KEY_PURPOSE_0=5` unlocks both old
   (zero) and new (programmed) key paths.
7. ✅ No regression in AES / SHA peripherals.

## Lo que NO funcionó / decisiones tomadas

### Decisiones tomadas

1. **MMIO write path NOT modeled**: real silicon burns keys
   via the eFuse controller's program registers. Modeling
   that would require parsing PGM_DATA0..7 + PGM_CHECK_VALUE0..2
   + the BURN trigger sequence — significant work for low
   value. Env-var route lets tests program keys without it.

2. **synth_key helper removed**: kept only as a doc comment.
   Dead code now that real keys work; users wanting the old
   synth bytes can program them via env-var.

3. **Phase 2.CN's vector is superseded, not preserved**:
   the silicon-accurate behavior wins. Phase 2.CN's
   `3c79055fa71a7528` is now a historical curiosity — git
   history is the canonical reference.

4. **MMIO read returns zero on un-programmed eFuse**:
   silicon-correct (un-burned bits read as 0).

5. **No additional JSON event type**: BLOCK4-9 access is
   silent on its own. The downstream HMAC event already
   includes `digest_prefix` which encodes the key indirectly.

6. **slot 6/7 rejected by the accessor**: `KEY_SLOT` field
   in the HMAC peripheral is 3 bits (0..7) but only slots
   0..5 have backing blocks. The accessor returns false +
   zeros on slot 6/7 — silicon-correct.

## Lessons learned

1. **Closing documented placeholders is high-value**.
   Phase 2.CN explicitly noted "synthetic key per slot since
   real silicon eFuse BLOCK4-9 key material not yet modeled."
   Closing that gap was ~120 LOC and immediately makes the
   HMAC peripheral silicon-accurate end-to-end.

2. **Two-cycle pattern continues to pay off**:
   - Phase 2.CL: data (KEY_PURPOSE eFuse field).
   - Phase 2.CM: consumer skeleton (HMAC validation gate).
   - Phase 2.CN: real crypto compute.
   - Phase 2.CQ: real key material.
   Each phase landed independently testable. The chain
   builds up to "guest programs both KEY_PURPOSE + KEY_BLOCK
   → HMAC produces silicon-grade output."

3. **Test vector supersession is OK**. The Phase 2.CN
   digest was correct for its synthetic-key model. Replacing
   it with the silicon-correct vector is progress, not a
   regression. Git history preserves the lineage.

4. **2D array indexing scales** for fixed-count peripherals.
   `key_block[6][32]` is cleaner than 6 separate fields and
   matches the access pattern (HMAC asks for slot N → we
   index into row N).

## Implementación final

### `include/hw/nvram/esp32p4_efuse.h`

- New constants `ESP32P4_EFUSE_RD_KEY0_DATA0` (0x9C),
  `_KEY_BLOCK_SIZE` (32), `_NUM_KEY_BLOCKS` (6),
  `_RD_KEYS_END` (0x15B).
- New field on state struct: `uint8_t key_block[6][32]`.
- New accessor declaration:
  `bool esp32p4_efuse_get_key_block(s, slot, out[32])`.

### `hw/nvram/esp32p4_efuse.c`

- MMIO read handler: new branch for `addr ∈ [0x9C, 0x15B]`
  that maps `(addr - 0x9C)` to `(slot, byte_offset)` and
  returns a 4-byte little-endian word.
- New accessor `esp32p4_efuse_get_key_block()` — copies the
  32-byte block to caller's buffer, returns false on
  out-of-range slot.
- New env-var parser loop iterating `VELXIO_EFUSE_KEY_BLOCK_0..5`
  with strict 64-hex-char validation + per-pair sscanf.
- `realize()` zeros `key_block` before env-var apply.

### `hw/misc/esp32p4_hmac.c`

- Removed `esp32p4_hmac_synth_key()` (replaced with doc
  comment).
- `validate_and_emit()` now calls
  `esp32p4_efuse_get_key_block(s->efuse, key, real_key)`
  instead of synthesizing.

## Estado consolidado (post-2.CQ)

eFuse → HMAC consumption chain — **fully silicon-faithful**:

| eFuse component | Phase | HMAC use |
|-----------------|-------|----------|
| KEY_PURPOSE_N (4-bit role) | 2.CL | validation gate (Phase 2.CM) |
| KEY_BLOCK_N (256-bit key) | **2.CQ** | **input to HMAC-SHA-256 (this phase)** |

Combined: guest must program both `KEY_PURPOSE_N=5..8` AND
`KEY_BLOCK_N=<key bytes>` to compute a meaningful HMAC.
Without either, validation rejects or key is zeros.

JSON event types: **33** (unchanged from Phase 2.CP).

## 79-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.CO  | Standard AES — AES-128/256 NIST-correct                 |
| 2.CP  | Standalone SHA peripheral + shared SHA-256              |
| **2.CQ** | **eFuse BLOCK4-9 key material — HMAC uses real keys** |

Three crypto peripherals + four eFuse-fed silicon mechanisms
(WDT_DELAY_SEL, chip_info, DIS_TWAI, KEY_PURPOSE+KEY_BLOCK).

## Próximas direcciones

- **Multi-block HMAC** (SET_MESSAGE_ING / SET_MESSAGE_END):
  hash >64-byte inputs with incremental SHA-256 state.
- **Secure Boot digest verifier** — consumes KEY_PURPOSE_9/10/11
  + the corresponding eFuse blocks. Reuses shared SHA-256
  from Phase 2.CP.
- **AES-CBC / AES-GCM block modes**: extend AES peripheral
  with IV/H/J0/T0 register support.
- **XTS-AES** for flash encryption — consumes KEY_PURPOSE_2/3/4
  + the corresponding eFuse blocks.
- **Digital Signature peripheral** — consumes KEY_PURPOSE_7
  + DS peripheral key.
- **RSA peripheral** (TRM 25).
- **ECC peripheral** (TRM 26).
- **USB Serial/JTAG peripheral**.
- **MS5611 / W5500 / MFRC522** sensors/SPI responders.
- **UART IRQ** via interrupt matrix.
- **FreeRTOS** scheduler resurrection.
