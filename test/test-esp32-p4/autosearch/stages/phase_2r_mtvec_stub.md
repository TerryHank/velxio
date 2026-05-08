# Phase 2.R — mtvec stub + end-to-end IRQ validation

**Estado**: ✅ done — IRQ delivery completo validado end-to-end SIN CLIC mode.

## Goal

Cerrar el blocker de Phase 2.Q (`mtvec=0` cuando el primer SYSTIMER tick
fires) instalando un stub `mret` minimal en HP ROM y haciendo que el
trampolín de boot escriba su dirección en `mtvec` antes de saltar al
ELF entry. Esto valida el path completo:

```
SYSTIMER timer → qemu_set_irq → esp_cpu_irq_handler →
  mip.MEIP=1 → CPU trap to mtvec → mret stub → mret →
  return to busy loop with MIE re-enabled
```

…sin necesidad de implementar CLIC mode native todavía.

## Lo que SE INVESTIGÓ

1. **¿Qué dirección en HP ROM es segura para el stub?**
   - HP ROM es `0x4FC00000-0x4FC60000` (384 KB).
   - Trampolín de boot ya ocupa `0x4FC1FFE0-0x4FC20000` (32 bytes).
   - Decisión: ubicar stub 80 bytes ANTES, en `0x4FC1FFB0` (4 bytes).
   - Ambos en HP ROM → cargados via `rom_add_blob_fixed_as` durante
     machine init, antes de CPU start.

2. **Encoding del stub `mret`**:
   - RISC-V Privileged spec: `mret = 0x30200073`
     (priv=0011000, rs2=00010, rs1=0, funct3=0, rd=0, opcode=0x73)

3. **Encoding de las nuevas instrucciones del trampolín**:
   - `LUI t1, hi20`: `(hi20 << 12) | (6 << 7) | 0x37`
   - `ADDI t1, t1, lo12`: `(lo12 << 20) | (6 << 15) | (6 << 7) | 0x13`
   - `CSRW mtvec, t1` = `csrrw x0, mtvec=0x305, t1=6`:
     `(0x305 << 20) | (6 << 15) | (1 << 12) | 0x73 = 0x30531073`
   - Sign-bit-of-low-12 compensation: si `mt_lo12 & 0x800`, incrementar
     `mt_hi20` en 1 (mismo idiom que el sp+entry de Phase 1.D).

4. **Trampolín extendido de 6 → 8 instrucciones** (32 bytes — fit
   exacto en `0x4FC1FFE0-0x4FC20000`).

## Lo que SÍ funcionó (output observado)

Con `ESP_CPU_IRQ_DEBUG=1`:

```
[esp32p4] runtime patches applied (59 entries)
[esp_cpu.irq_handler] #1   accept=0 mstatus=0x00000000 (MIE=0) mie=00000000
Hello from QEMU ESP32-P4!
[esp_cpu.exec_interrupt] #1 accepted=1 irq_cause=1 mtvec=4fc1ffb0  ← FIXED!
[esp_cpu.exec_interrupt] #2 accepted=1 irq_cause=1 mtvec=4fc1ffb0
[esp_cpu.exec_interrupt] #3 accepted=1 irq_cause=1 mtvec=4fc1ffb0
[esp_cpu.exec_interrupt] #4 accepted=1 irq_cause=1 mtvec=4fc1ffb0
[esp_cpu.irq_handler] #129  accept=1 mstatus=0x00001888 (MIE=1) mie=00000800
[esp_cpu.irq_handler] #257  accept=1 mstatus=0x00001888 (MIE=1) mie=00000800
[esp_cpu.irq_handler] #385+ accept=1 mstatus=0x00001888 (MIE=1) mie=00000800
```

**Comparación con Phase 2.Q (antes del fix):**

| Métrica                          | Phase 2.Q (broken)            | Phase 2.R (fixed)              |
|----------------------------------|-------------------------------|--------------------------------|
| `mtvec` en primer trap           | `0x00000000`                  | `0x4fc1ffb0` ✅                |
| `mstatus` post-trap (long-term)  | `0x1800` (MIE=0, **stuck**)   | `0x1888` (MIE=1) ✅            |
| IRQs aceptados                   | 1 (luego rechazos infinitos)  | continuos (#129, #257, …) ✅   |
| Hello world output               | ✅                            | ✅ (sin regresión)             |
| Infinite trap loop               | N/A (CPU stuck)               | ❌ no — funciona limpio        |

## Lo que NO se necesitó

1. **Pulse semantics en SYSTIMER tick** (raise + lower con delay):
   anticipé que el level-high causaría re-trap infinito post-mret. NO
   pasó. Hipótesis: el `mret` restaura `mstatus.MIE=1` y `mip.MEIP`
   sigue alto, pero `irq_pending=0` después del exec_interrupt
   permitiendo otro raise. Cada tick de 10 ms es un trap único, no
   re-trap.

2. **CLIC mode completo** (mtvt + xnxti + hardware vectoring): no
   requerido para validar IRQ delivery. CLIC se mantiene como
   Phase 2.S para cuando IDF runtime maneje las interrupts naturalmente.

3. **Modificar `esp_cpu.c`**: el dispatcher actual ya maneja todo
   correctamente. El bug era de `mtvec` no inicializado, NO de la
   pipeline IRQ.

## Fix aplicado

### `hw/riscv/esp32p4.c`

1. Nueva constante:
   ```c
   #define ESP32P4_MTVEC_STUB_ADDR     0x4FC1FFB0
   ```

2. `rom_add_blob_fixed_as("esp32p4.mret", ...)` con un `0x30200073`
   (single `mret` instruction).

3. Trampolín extendido de 6 a 8 instrucciones:
   ```
   trampoline[0] = LUI sp, sp_hi20
   trampoline[1] = ADDI sp, sp, sp_lo12
   trampoline[2] = LUI t1, mt_hi20      ← NEW
   trampoline[3] = ADDI t1, t1, mt_lo12 ← NEW
   trampoline[4] = CSRW mtvec, t1       ← NEW
   trampoline[5] = LUI t0, hi20         (entry)
   trampoline[6] = ADDI t0, t0, lo12    (entry)
   trampoline[7] = JALR x0, 0(t0)
   ```

## Lessons learned

1. **Reset value de mtvec en QEMU's RISC-V CPU es `0x00000000`**.
   Cualquier `-kernel` flow que skip el ROM init DEBE establecer
   mtvec antes de habilitar interrupts.

2. **El esp_cpu dispatcher en `target/riscv/esp_cpu.c` no necesita
   cambios** para casos básicos — solo requiere CSRs bien seteados
   (`mstatus.MIE`, `mie.MEIE`, `mtvec`).

3. **HP ROM es perfecto para stubs minimal**: `rom_add_blob_fixed_as`
   funciona durante machine init, hace que el contenido sobreviva al
   reset, y la región es ejecutable por defecto.

4. **`mstatus = 0x1888` es el valor estable durante operación
   IRQ-driven**: bit 3 (MIE) + bit 7 (MPIE) + bits[12:11] (MPP=M).
   Si vemos esto en logs, el sistema IRQ está sano.

## Próximas fases

- **Phase 2.S**: implementar CLIC mode en `target/riscv/` (mtvt +
  xnxti CSRs + hardware vectoring). ~500 LOC. Permite que IDF runtime
  reemplace nuestro mret stub con su propio vector table.
- **Phase 2.T**: full cache MMU emulation. Desbloquea
  `spi_flash_mmap` y los `esp_log_cache_get_level` lock loops.
- **Phase 2.U**: dropear los Phase 2.M-2.O bypass patches y dejar el
  flow natural Arduino correr (depende de 2.S + 2.T).

## Estado consolidado (post-2.R)

| Hito                                       | Estado       |
|--------------------------------------------|--------------|
| ROM banner                                 | ✅           |
| Bootloader runs 6.4s                       | ✅           |
| App ELF runs (174 fns)                     | ✅           |
| FreeRTOS scheduler entered                 | ✅           |
| `app_main` reached                         | ✅           |
| Primer UART output (hello world)           | ✅           |
| SYSTIMER tick wired                        | ✅           |
| IRQ delivery a esp_cpu dispatcher          | ✅ Phase 2.Q |
| Trap to `mtvec` firing (sin crash)         | ✅ Phase 2.R |
| End-to-end IRQ con MIE persistente         | ✅ Phase 2.R |
| Real CLIC mode (mtvt+xnxti)                | ❌ Phase 2.S |
| Real `setup()` runs                        | ❌ Phase 2.U |
| `digitalWrite(LED)` blink visible          | ❌ Phase 2.U |
