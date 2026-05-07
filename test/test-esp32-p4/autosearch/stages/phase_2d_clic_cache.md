# Phase 2.D — CLIC backing-RAM + Cache freeze mirrors

**Estado**: ✅ done · commit pendiente

## Goal

El ROM al completar el banner Espressif inmediatamente toca:
1. CLIC interrupt controller (write CLICCFG, configure individual IRQs).
2. SPI_init (polls FSM idle bit en MSPI flash).
3. Cache_Suspend_*, Cache_Resume_*, Cache_Freeze_* — request/ack patterns en el cache controller.

Sin estos, el ROM se atasca en polling loops infinitos. Esta fase los implementa para que el ROM **avance hasta `ets_run_flash_bootloader`** (intentar cargar el bootloader desde flash).

## Discoveries

### Discovery 1 — CLIC: backing-RAM con byte access

CLIC (RISC-V Core-Local Interrupt Controller) en ESP32-P4 está en `0x20800000`, 64 KB. Map:
- `0x0000` CLICCFG (1 byte) — config nlbits/nmbits.
- `0x0004` CLICINFO (4 bytes RO) — `(CLICINTCTLBITS << 25) | num_int`.
- `0x0008` CLICMTH (1 byte) — machine threshold.
- `0x1000+` per-interrupt config (4 bytes × 1024 IRQs).

El ROM hace **byte access** a per-IRQ config (e.g., write 0x00 a `0x1055` = clicintie de IRQ 21). El smart stub anterior tenía `min_access_size=4`, no servía. Hice un device dedicado (`esp32p4_install_clic`) con backing-RAM de 64 KB y byte+word access.

### Discovery 2 — SPI_init at 0x4FC0EE9C

Routine que setea bit 31 en MSPI flash offset `0x3C` y polls offset `0x178` con `bgez ... retry`. Bit 31 set en `0x178` significa "FSM idle / op done". Override fixed: `0x178 → 0x80000000`.

### Discovery 3 — Cache freeze: request → ack mirror pattern

ROM tiene routines `Cache_Freeze_L1_DCache_Enable`, `Cache_Freeze_L2_Cache_Enable`, y sus pares Disable. Pattern:
```c
// Enable
*reg |= (1 << 20);    // set request
while (!(*reg & (1 << 22)))  ;  // wait for ack to be set

// Disable
*reg &= ~(1 << 20);   // clear request
while (*reg & (1 << 22))  ;    // wait for ack to clear
```

Un OR_MASK fixo no sirve porque Enable quiere bit 22=1 y Disable quiere bit 22=0. Implementé un **mirror system**: en read, el smart stub copia un bit de origen a un bit de destino del scratch storage. Así:
- Cuando ROM escribe bit 20 (request), bit 22 (ack) automaticamente se lee como 1.
- Cuando ROM clearea bit 20, bit 22 se lee como 0.

Funciona para enable AND disable.

### Discovery 4 — Cache_Suspend_* / Cache_Resume_* tienen acks dedicados

`Cache_Suspend_L2_Cache` polls offset `0x2A8` bit 1; `Cache_Suspend_L2_Cache_Autoload` polls `0x2B4` bit 1, etc. Estos son **registers de ACK dedicados** (separados del request register). FIXED `0x2` (bit 1 set) los satisface inmediatamente.

## Implementación

### Archivo: `hw/riscv/esp32p4.c`

1. **CLIC dedicado** (~80 LOC):
   - Struct `Esp32P4Clic` con storage 64 KB.
   - `esp32p4_clic_read/write`: byte/word access.
   - CLICINFO read decodifica `(4 << 25) | 256` (4 priority bits, 256 IRQs).
   - `esp32p4_install_clic()` reemplaza `create_unimplemented_device`.

2. **Smart override extendido**:
   - `Esp32P4SmartOverrideKind`: `SMART_FIXED` o `SMART_OR_MASK`.
   - `Esp32P4SmartMirror`: `{base, offset, src_bit, dst_bit}`.
   - Read flow: scratch → mirrors → fixed-or-or-mask override.

3. **Override table** (~10 entries):
   - MSPI flash FSM idle.
   - Cache 0x098 (idle), 0x2A8/2AC/2B0/2B4/2B8/2BC (suspend/resume/freeze acks).
   - Cache 0x088/0x08C op-done (OR_MASK).

4. **Mirror table** (4 entries):
   - L1 freeze: bit 20→22, bit 21→23.
   - L2 freeze: bit 20→22, bit 21→23.

## Acceptance criteria — pasaron

- [x] `esp32p4.hp_clic_mmio` reads/writes no más unimpl warnings.
- [x] `SPI_init` exits.
- [x] `Cache_Suspend_L2_Cache` exits.
- [x] `Cache_Suspend_L2_Cache_Autoload` exits.
- [x] `Cache_Freeze_L2_Cache_Enable` AND `Disable` exit (mirror works for both polarities).
- [x] ROM ejecuta `ets_run_flash_bootloader` → trata de leer header del bootloader.

## Próximo blocker — Phase 2.A.5

ROM imprime `invalid header: 0x0b000ec1` repetidamente. El bootloader de Arduino blink está en flash offset `0x2000`, pero el ROM lee desde offset `0x0` (que está erased = `0xFF`). Es un issue de flash layout.

Fix posible: shift flash blob para que el bootloader esté en offset 0, O cambiar el tipo de cache window mapping.

## Archivos tocados

- `hw/riscv/esp32p4.c` (~150 LOC)
