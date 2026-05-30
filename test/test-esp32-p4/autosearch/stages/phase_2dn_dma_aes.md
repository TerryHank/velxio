# Phase 2.DN — DMA-mode AES (ECB + CBC) via AXI-DMA

**Estado:** ✅ DONE — the AES peripheral now encrypts/decrypts data streamed
through the AXI-DMA (the real ESP32-P4 bulk-AES path), **bidirectionally**:
plaintext pulled off the out-link, ciphertext scattered to the in-link.
Verified against NIST FIPS-197 (ECB) + SP800-38A (CBC, 2-block) vectors,
incl. a CBC decrypt round-trip.

Files:
- `third-party/qemu-lcgamboa/hw/misc/esp32p4_aes.c` (+DMA path + self-test;
  typical TEXT_IN/OUT mode untouched)
- `third-party/qemu-lcgamboa/include/hw/misc/esp32p4_aes.h` (+DMA regs +
  block-mode/state constants + self-test decl)
- `third-party/qemu-lcgamboa/hw/riscv/esp32p4.c` (call AES-DMA self-test
  after AES + AXI-DMA are both up)
- `test/test-esp32-p4/autosearch/scripts/run_aesdma_selftest.sh`

---

## SE INVESTIGÓ (what was researched)

The sibling of Phase 2.DM (DMA-SHA), and the *bidirectional* one: AES-DMA
uses **both** DMA directions — the TX (out) channel feeds plaintext, the
RX (in) channel receives ciphertext. The driver path is
`esp_aes_dma_start(in_desc, out_desc)`; `crypto_shared_gdma` connects both
the rx and tx channels of one pair to AES (`GDMA_TRIG_PERIPH_AES`,
peri_sel **4**, AXI bus per `gdma_channel.h`).

IDF facts (`aes_reg.h` / `aes_ll.h` / `aes_types.h`):
- `AES_MODE`@0x40 (enc/dec + key size: EN-128=0 / EN-256=2 / DE-128=4 /
  DE-256=6), `AES_TRIGGER`@0x48, `AES_STATE`@0x4C (IDLE/BUSY/**DONE**=2),
  `AES_IV_MEM`@0x50 (16-byte IV/counter), `AES_DMA_ENABLE`@0x90,
  `AES_BLOCK_MODE`@0x94 (ECB=0/CBC=1/OFB=2/CTR=3/CFB8=4/CFB128=5/GCM=6),
  `AES_BLOCK_NUM`@0x98 (16-byte block count), `AES_DMA_EXIT`@0xB8.
- The existing AES peripheral (2.CO) already has the verified per-block
  cores `aes_key_expand` / `aes_encrypt_block` / `aes_decrypt_block`.
- NIST vectors (Python `cryptography`-validated before coding):
  ECB-128 FIPS-197 `00112233…ff` → `69c4e0d8…c55a`; CBC-128 SP800-38A
  key `2b7e1516…`, IV `000102…0f`, 2-block pt → `7649abac…` ‖ `5086cb9b…`.

---

## SÍ funcionó (what worked)

- **Bidirectional descriptor walk, no struct coupling.** The AES reads the
  AES-bound channels' `OUT_PERI_SEL`/`OUT_LINK2` (plaintext source) and
  `IN_PERI_SEL`/`IN_LINK2` (ciphertext dest) **through the address space**
  (`address_space_read` of the AXI-DMA MMIO) — same decoupled pattern as
  DMA-SHA. It gathers off the TX chain, transforms, and scatters onto the
  RX chain (the run_m2m scatter logic), writing back ownership→CPU +
  length + suc_eof on both sides.
- **Cipher modes over the verified core.** ECB = straight block transform;
  CBC enc = `C_i = E(P_i ⊕ chain)`, chain ← `C_i`; CBC dec = `P_i =
  D(C_i) ⊕ chain`, chain ← `C_i` (saved pre-decrypt); CTR = `out = in ⊕
  E(counter)`, counter++ (BE). Chain starts at `AES_IV_MEM`, written back
  after the run. Zero new AES primitive code — just the mode glue.
- **First-try green against NIST vectors** in running QEMU:
  ```
  op#4 DMA mode=0 (EN-128) ECB 1 blk → out: 69c4e0d8...
  op#5 DMA mode=0 (EN-128) CBC 2 blk → out: 7649abac...
  op#6 DMA mode=4 (DE-128) CBC 2 blk → out: 6bc1bee2...
  self-test DMA: ECB128=OK CBC128=OK CBC128-dec=OK
  ```
  The **2-block CBC** is the key test: it proves the IV-chaining state
  threads correctly from block 0's ciphertext into block 1, end-to-end
  through the DMA gather→transform→scatter. SHA-DMA + AXI-DMA regressions
  stayed green.
- **STATE handling.** Changed `AES_STATE` reads to return the stored value
  (was hardcoded IDLE). Typical mode never sets it (stays IDLE=0, behaviour
  unchanged); DMA sets DONE=2 which the guest polls; `AES_DMA_EXIT`→IDLE.

---

## NO funcionó / decisiones (what failed + decisions made)

- **Init-order (anticipated from 2.DM).** The AES init block (line ~1959)
  runs *before* the AXI-DMA block (~2140), so the AES-DMA self-test —
  which reads the AXI-DMA off the bus — can't run in the AES block.
  Placed it next to the SHA-DMA self-test (after both AES and AXI-DMA are
  up). No silent no-op this time: applied the 2.DM lesson up front.
- **Scope: ECB/CBC/CTR; CFB/OFB/GCM deferred.** ECB + CBC are verified;
  CTR is implemented (counter-mode XOR) but **not yet covered by a
  self-test vector** — flagged. CFB/OFB are easy follow-ons; **GCM** needs
  the GHASH auth-tag path and the Hash-subkey/J0 setup — a separate phase.
- **Single channel pair assumption.** The self-test binds one channel pair
  (ch0 TX+RX) to AES; the run scans all 3 channels for `PERI_SEL==4` and
  uses the last match per direction. Real drivers use one pair at a time,
  so this is faithful; concurrent multi-pair AES isn't modeled.
- **Instantaneous + no DMA-side IRQ.** The transform completes inside the
  TRIGGER write; the AES sets its own STATE=DONE (guests poll STATE or the
  AES interrupt, not the DMA one). The RX in-link descriptors get the
  ownership/eof write-back but the AXI-DMA channel's IN_SUC_EOF isn't
  raised from here (documented; matches how AES drivers wait on AES).

---

## Lessons learned

1. **Bidirectional is just gather + scatter.** Having both the DMA-SHA TX
   gather and the AXI-DMA mem2mem scatter already proven, AES-DMA was
   "gather off TX, transform, scatter onto RX" — the two halves composed
   with no new descriptor machinery.
2. **Validate the cipher-mode vectors in Python first.** Pre-checking the
   exact ECB/CBC bytes with `cryptography` made the C self-test's
   byte-compare the whole verification — first build was green.
3. **Apply the prior phase's lesson proactively.** The 2.DM init-order
   trap (cross-peripheral self-test at the later device) was avoided here
   by placing the call correctly from the start.

## Implementación final (key shape)

- `esp32p4_aes_dma_run(s)`: decode MODE→key/rounds + BLOCK_MODE +
  BLOCK_NUM + IV; find AES-bound TX/RX links; gather plaintext; per-block
  ECB/CBC/CTR transform (chain ← IV); scatter ciphertext; write back IV +
  STATE=DONE. Gated on `AES_DMA_ENABLE` in the TRIGGER handler (typical
  path unchanged).

## Estado consolidado (crypto-DMA)

| Path | Direction | Status |
|------|-----------|--------|
| **DMA-SHA-256** (2.DM) | TX only | ✅ FIPS 180-2 |
| **DMA-AES ECB/CBC** (2.DN) | TX + RX | ✅ FIPS-197 / SP800-38A |
| DMA-AES CTR | TX + RX | impl, untested |
| DMA-AES GCM / SHA-512 | — | next |

## Próximas direcciones (next)

- AES-CTR self-test vector; CFB/OFB; **AES-GCM** (GHASH auth tag).
- DMA-SHA-512 multi-block (128-byte blocks).
- **INTMTX** (still the top structural interrupt gap).
