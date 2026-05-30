# Phase 2.DR — I2S0 RX (mic capture) via AHB-DMA + TX_CONF1 fix

**Estado:** ✅ DONE — I2S0 now does **full-duplex audio**: TX playback
(2.DQ) + RX mic capture, both over the AHB-DMA, both verified byte-exact.
Also fixes a latent register-offset bug introduced in 2.DQ.

Files:
- `third-party/qemu-lcgamboa/hw/misc/esp32p4_i2s.c` (RX capture + RX test)
- `third-party/qemu-lcgamboa/include/hw/misc/esp32p4_i2s.h` (RX regs +
  corrected TX_CONF1 offset + rx_phase)

---

## SE INVESTIGÓ (what was researched)

The symmetric completion of 2.DQ: I2S RX (mic capture). The guest sets up
an AHB-DMA **in-link** with empty buffers (in `PERI_SEL` = I2S0 = 3),
configures I2S RX, and writes `RX_CONF.RX_START`; the I2S block then writes
captured audio into those buffers via DMA. This exercises the AHB-DMA
**IN/in-link** path driven by a peripheral consumer — new (TX and the
crypto DMA only drove the out-link).

Register facts (IDF `i2s_reg.h` / `i2s_ll.h`):
- `RX_CONF` @ 0x20: `RX_RESET`[0], **`RX_START`[2]** (`i2s_ll_rx_start`
  sets `rx_conf.rx_start = 1`), `RX_SLAVE_MOD`[3].
- The full CONF order is **`RX_CONF@0x20`, `TX_CONF@0x24`,
  `RX_CONF1@0x28`, `TX_CONF1@0x2C`** — confirmed from the
  `i2s_dev_t` struct field order.

---

## SÍ funcionó (what worked)

- **AHB-DMA in-link scatter from a peripheral.** Mirror of the TX drain:
  read the bound channel's `IN_PERI_SEL` / `IN_LINK_ADDR` through the
  address space, walk the in-link descriptors, **write** generated samples
  into each descriptor's buffer (to its `size`), update length + clear
  owner + set suc_eof on the last. The reverse of the out-link gather.
- **Deterministic synthetic mic source.** A wrapping sawtooth
  `int16(phase·1031)`, with `rx_phase` advancing per sample so successive
  captures form a continuous waveform — predictable for the self-test and
  a placeholder for a future real frontend mic feed (the GPIO / USB-JTAG
  input-channel pattern: env-var or live data).
- **Full-duplex verified in running QEMU:**
  ```
  op#1 TX 64 samples (16-bit) first=[-8192,-7935]
  op#2 RX 64 samples (16-bit) first=[0,1031]
  self-test TX-via-AHB-DMA=OK RX-via-AHB-DMA=OK
  ```
  The RX self-test set up an empty in-link buffer, fired `RX_START`, then
  read the buffer back and matched the expected sawtooth (`phase 0..63`).
  Both `i2s` events (`dir":"tx"`/`"rx"`) emitted.

---

## NO funcionó / decisiones (what failed + decisions made)

- **Latent 2.DQ bug found + fixed: `TX_CONF1` offset.** 2.DQ used
  `TX_CONF1 = 0x28`, but 0x28 is actually **`RX_CONF1`**; `TX_CONF1` is
  **0x2C**. The TX path read `TX_BITS_MOD` from the wrong register — it
  *worked* only because both `RX_CONF1` and `TX_CONF1` default to
  `BITS_MOD = 15` (16-bit), so the decoded width happened to be right.
  Implementing RX forced reading the struct field order, which surfaced
  it. Fixed: `RX_CONF1@0x28`, `TX_CONF1@0x2C`. The TX self-test (which
  uses the `ESP32P4_I2S_TX_CONF1` macro for both write and read) stays
  green automatically. **Lesson: a peripheral's CONF/CONF1 registers can
  interleave RX/TX — verify the *struct field order*, not just the bit
  layout, before assigning offsets.**
- **Scope: synthetic source, one-shot, no pacing.** Same simplifications
  as TX — the captured samples are correct; sample-rate timing and a real
  audio source are follow-ups. The `rx_phase` continuity means repeated
  RX_START calls produce a coherent (if synthetic) stream.

---

## Lessons learned

1. **Implementing the reverse direction validates the forward one.**
   Modeling RX forced a careful read of the I2S register struct, which
   exposed the TX_CONF1 offset bug that TX alone had hidden (default
   values masked it). The symmetric pair is more robust than either half.
2. **IN-link scatter == OUT-link gather, mirrored.** The 5th use of the
   DMA descriptor-walk pattern; RX was "walk the in-link and write instead
   of read."

## Implementación final (key shape)

- `esp32p4_i2s_rx_capture(s)`: find AHB-DMA IN channel with
  `PERI_SEL == peri_sel_id`, read `IN_LINK_ADDR`, walk the in-link, fill
  each buffer with `esp32p4_i2s_rx_sample(rx_phase++)`, write back
  length/owner/suc_eof, emit `i2s`/`dir:"rx"` event. Hooked on
  `RX_CONF.RX_START`.

## Estado consolidado (I2S0 audio)

| Direction | Reg | DMA | Status |
|-----------|-----|-----|--------|
| TX (playback) | TX_CONF@0x24 | AHB out-link | ✅ (2.DQ) |
| **RX (mic)** | **RX_CONF@0x20** | **AHB in-link** | **✅ (2.DR)** |
| I2S1/2, PDM, real-time pacing | — | — | next |

## Próximas direcciones (next)

- I2S1/2 instances (peri_sel 4/5), PDM, real-time sample-rate pacing, a
  real frontend mic feed (env-var / live source).
- **INTMTX** (interrupt matrix) — top structural gap.
- TSENS, PCNT, MCPWM for more breadth.
