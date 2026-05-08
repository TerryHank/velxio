# Phase 2.T-fix.next — Phase 2.M typo fix (1-bit JAL encoding error)

**Estado**: ✅ done — found+fixed a 1-bit encoding bug in Phase 2.M
that caused the bypass-dropped flow to jump to `0x3FFFF820`. The flow
now reaches setup() (or near it) before hitting a different fault.

## Lo que SE INVESTIGÓ

### 1. Trace search for the source of `MEPC = 0x3FFFF820`

Ran `run_kernel_tail.sh` with bypass dropped + `-d in_asm`. Searched
the log for:

```bash
grep '3FFFF820\|3ffff820' /root/qkrn_in_asm.log
```

Found exactly one hit:

```
0x40003076: fe450513   addi a0, a0, -28
0x4000307a: 0141       addi sp, sp, 16
0x4000307c: fa4fc06f   j -14428 → 0x3ffff820
```

The instruction `0xFA4FC06F` at `0x4000307C` IS the one jumping to the
bad address. And that PC matches an **existing Phase 2.M runtime
patch**:

```c
/* Phase 2.M — patch app_main to call setup() directly.
 * ...
 * Patch the final j at 0x4000307C from xTaskCreateUniversal
 * (`0xCE1FD06F`) to setup (`0xFA4FC06F` = j -12380, which
 * lands at setup() @ 0x40000020). */
{ "app_main: j setup() instead of xTaskCreateUniversal",
  0x4000307C, 0xFA4FC06Fu, 4 },
```

### 2. Encoding verification

Manually decoded `0xFA4FC06F`:

| Bit field   | Value        | Meaning           |
|-------------|--------------|-------------------|
| imm[20]     | bit 31 = 1   | sign bit          |
| imm[10:1]   | bits 30:21 = 0x3D2 | low offset bits |
| imm[11]     | bit 20 = **0** | mid offset bit  |
| imm[19:12]  | bits 19:12 = 0xFC | high offset bits |
| rd          | bits 11:7 = 0   | jal x0 (= j)    |
| opcode      | bits 6:0 = 0x6F | JAL             |

Reconstructed offset:
```
imm = (1<<20) | (0xFC<<12) | (0<<11) | (0x3D2<<1)
    = 0x100000 | 0xFC000 | 0 | 0x7A4
    = 0x1FC7A4
```

As 21-bit signed: `0x1FC7A4 - 0x200000 = -0x385C = -14428`

Target from PC `0x4000307C`: `0x4000307C - 0x385C = 0x3FFFF820` ❌

### 3. Computing the correct encoding

The Phase 2.M comment says the intent was to land at
`setup() @ 0x40000020`. Required offset:
```
0x40000020 - 0x4000307C = -0x305C = -12380
```

In 21-bit signed: `0x200000 - 0x305C = 0x1FCFA4`

Decompose for JAL:
- `imm[20] = 1`
- `imm[19:12] = 0xFC`
- `imm[11] = 1`         ← was **0** in the buggy encoding
- `imm[10:1] = 0x3D2`

Encoded:
- bit 31 = 1
- bits 30..21 = 0x3D2 = `1111010010`
- bit 20 = 1
- bits 19..12 = 0xFC = `11111100`
- bits 11..7 = 0
- bits 6..0 = 0x6F = `1101111`

Concatenated as nibbles:
- bits 31..28: `1111` = 0xF
- bits 27..24: `1010` = 0xA
- bits 23..20: `010 1` = 0x5  ← was 0x4 in buggy encoding
- bits 19..16: `1111` = 0xF
- bits 15..12: `1100` = 0xC
- bits 11..8: `0000` = 0x0
- bits 7..4: `0110` = 0x6
- bits 3..0: `1111` = 0xF

= **`0xFA5FC06F`** (correct) vs **`0xFA4FC06F`** (buggy).

The single bit difference is `imm[11]` (instruction bit 20). The
encoding lost a `0x100000` worth of offset (== 2048 bytes), placing
the jump 2048 bytes earlier than intended:
- Intended: `0x40000020`
- Actual:   `0x3FFFF820` (= `0x40000020 - 0x800`)

## Lo que SÍ funcionó

After applying the typo fix and re-running with bypass dropped:

**Before fix** (Phase 2.T-fix output):
```
Guru Meditation Error: ... (Instruction access fault)
MEPC: 0x3ffff820   MTVAL: 0x3ffff820   MCAUSE: 0x00000001
```

**After fix** (Phase 2.T-fix.next output):
```
Guru Meditation Error: ... (Load access fault)
MEPC: 0x4000079a   MTVAL: 0x0000000c   MCAUSE: 0x00000005
...
ELF file SHA256:
Rebooting...
```

**Differences**:
- MCAUSE went from `0x01` (instruction fetch fault) → `0x05` (load
  access fault). Different category of bug.
- MEPC went from `0x3FFFF820` (unmapped DRAM mirror) →
  `0x4000079A` (valid IRAM, inside setup() or its callees).
- MTVAL went from `0x3FFFF820` (the bad fetch target) → `0x0000000C`
  (NULL+12, a NULL-pointer dereference reading offset 12 of a
  NULL pointer).
- The IDF panic handler completed its full sequence including
  `ELF file SHA256:` and `Rebooting...` — meaning the entire panic
  reporting chain works end-to-end (much further than before).

The new fault (NULL+12 deref) is plausibly the fake `esp_partition_t`'s
`flash_chip` field (set to NULL in Phase 2.T-fix). Some downstream
code reads `partition->flash_chip->chip_drv` (offset 12 in
`esp_flash_t`), faulting on the NULL flash_chip.

## Lo que NO funcionó (descartado durante investigación)

1. **Pensé que el `0x3FFFF820` era function-pointer deref del fake
   esp_partition_t**: TOTALMENTE EQUIVOCADO. El fake struct estaba
   bien; el bug era un typo en una patch que existía DESDE Phase 2.M.
   La hipótesis original era razonable porque la patch comentaba
   correctamente "j -12380 → setup()" pero el encoding entregaba
   "j -14428 → 0x3FFFF820".

2. **Asumí que el typo solo afectaba 1 bit**: tras decoder a mano, el
   bit que cambia es `imm[11]` (bit 20 del instruction). 1-bit XOR
   entre `0xFA4FC06F` y `0xFA5FC06F` = `0x00100000` = bit 20. ✓

## Lessons learned

1. **JAL/JALR offsets son 21-bit signed two's complement, encoded
   non-contiguously**: `imm[20] | imm[10:1] | imm[11] | imm[19:12]`.
   El no-contiguo (separación de imm[11] vs imm[19:12] vs imm[10:1])
   hace fácil errores de 1 bit cuando se encode a mano. **Always
   verify with disasm**, not by trusting the comment.

2. **Latent bugs hide behind active bypasses**: Phase 2.M's broken
   `j` was harmless under Phase 2.N's hello-world bypass because
   Phase 2.N replaced app_main entry, never reaching `0x4000307C`.
   Dropping Phase 2.N exposed the latent bug. Always re-test with
   bypass dropped during major changes.

3. **`fe450513 0141 fa4fc06f`** signature is a useful reverse-search
   pattern. The disassembled comment from QEMU `-d in_asm` (the
   `# 0x3ffff820` annotation after the j instruction) was THE single
   piece of info that pinpointed the bug.

4. **MCAUSE evolution shows progress depth**: from no-output
   (silent loop) → instruction fetch fault → load access fault →
   eventually we hope to see actual setup() output. Each new fault
   means we passed the previous blocker.

## Fix aplicado

Single change in `hw/riscv/esp32p4.c`:

```diff
- *   (`0xCE1FD06F`) to setup (`0xFA4FC06F` = j -12380, which
+ *   (`0xCE1FD06F`) to setup (`0xFA5FC06F` = j -12380, which

  { "app_main: j setup() instead of xTaskCreateUniversal",
-   0x4000307C, 0xFA4FC06Fu, 4 },
+   0x4000307C, 0xFA5FC06Fu, 4 },
```

Plus comment additions explaining the typo correction.

## Default build verification

73 patches active. Hello-world demo unchanged:
```
[esp32p4] runtime patches applied (73 entries)
Hello from QEMU ESP32-P4!
```

The Phase 2.M `j setup()` patch is dormant under hello-world bypass
(Phase 2.N overrides app_main body before 0x4000307C is reached).
The typo fix only matters when Phase 2.N is dropped.

## Next investigation (Phase 2.T-fix.next.next)

Identify what reads NULL+12 at PC=0x4000079A. Likely candidates:
- `esp_flash_read` / `esp_flash_write` reading `chip->chip_drv->func`.
- `esp_partition_read_raw` similar pattern.

Mitigation: provide a fake `esp_flash_t` struct (with valid
`chip_drv` pointer) and reference it from the fake `esp_partition_t`'s
`flash_chip` field instead of NULL.

## Estado consolidado (post-2.T-fix.next)

| Hito                                                    | Estado       |
|---------------------------------------------------------|--------------|
| Hello-world demo (default build)                        | ✅           |
| Bypass-dropped: reach IDF panic handler                 | ✅ Phase 2.T-fix |
| Bypass-dropped: avoid 0x3FFFF820 fault (typo fix)       | ✅ Phase 2.T-fix.next |
| Bypass-dropped: panic handler full output (Reboot...)   | ✅ Phase 2.T-fix.next |
| Bypass-dropped: setup() runs cleanly (no NULL deref)    | ❌ Phase 2.T-fix.next.next |
| `digitalWrite(LED)` blink visible                       | ❌ Phase 2.U |
