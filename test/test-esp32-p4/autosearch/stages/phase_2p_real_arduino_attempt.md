# Phase 2.P — Drop bypass patches: real Arduino flow attempt

**Estado**: 🔬 investigated, blocker identified — committed back to hello-world demo. Real Arduino flow needs more work.

## Goal

Después de Phase 2.O (SYSTIMER tick wired), drop los Phase 2.N hello-world bypass patches y dejar el flow original Arduino correr:

```
start_cpu0_default → main_task → app_main → setCpuFrequencyMhz →
   loopTaskWDTEnabled=0 → initArduino → setup() → loop()
```

## Lo que SE INVESTIGÓ

1. **Comentar Phase 2.N hello-world patches** (15 patches en `0x4000303E-0x40003056`):
   - lui a0, lui t0, lbu, sw, addi, j (inline UART writer)
   - 7 string bytes en `0x4FFA0000-0x4FFA001B`
   - 6 CSR-enable patches (Phase 2.O additions)
2. **Re-build** sin esos patches → 40 patches activos (vs 59 con hello demo).
3. **Run con `-d in_asm`** para tracear flow real.

## Lo que SÍ funcionó

- ✅ Build clean — todos los comentados pasaron compile correctamente.
- ✅ App ELF runs: 174 unique IDF runtime functions ejecutaron (mismo numero que la última vez sin hello bypass).
- ✅ Llega a: `app_main`, `initArduino`, `__sinit`, `global_stdio_init`, `esp_task_wdt_init`, `spi_flash_mmap`, `vprintf`, `_vfprintf_r`.
- ✅ SYSTIMER tick fires en background a ~90 Hz (verified con `ESP32P4_TICK_LOG`).

## Lo que NO funcionó

### 1. Trap a mtvec NO observable

Con `-d int,exec` (que loga ALL TBs ejecutados + interrupt events):
- Log size: **4.9 millones de líneas** (~5 GB).
- `mcause`/`interrupt`/`trap`/`exc` matches: **0**.

Esto significa el trap a mtvec NUNCA fires desde el SYSTIMER tick, a pesar de que:
- IRQ wiring está correcto (probado con `qdev_get_gpio_in_named` a `espressif-cpu-irq-lines` line 1).
- Tick callback ejecuta a 90 Hz (logging via stderr fprintf confirmó).
- mstatus.MIE y mie.MEIE seteados (CSR enables verificados en disasm).

### 2. App stuck en `esp_log_cache_get_level` loop

Sin tick interrupting el flow, la app stuck en el mismo punto que Phase 2.N:
- `verifyRollbackLater` → `esp_partition_find` → `esp_log` → `esp_log_cache_get_level` (infinite loop).
- Last 15 PCs trace: cycle infinito en `0x40009c54-0x40009c70`.

### 3. Hello-world demo se restaura sin issues

Re-comentar los patches del flow real, descomentar Phase 2.N → `Hello from QEMU ESP32-P4!` reaparece. El estado es reversible.

## Hipótesis del blocker IRQ

¿Por qué el trap no fires aunque el IRQ esté raised?

**Hipótesis A — `esp_cpu_accept_interrupts()` returns false**:

```c
bool esp_cpu_accept_interrupts(EspRISCVCPU *cpu) {
    CPURISCVState *env = &cpu->parent_obj.env;
    const bool mie = (riscv_csr_read(env, CSR_MSTATUS) & MSTATUS_MIE) != 0;
    return !cpu->irq_pending && mie;
}
```

Si `mstatus.MIE` no está realmente seteado al chequear (a pesar del `csrsi mstatus, 8` en nuestro patch), la condición falla y el handler descarta el IRQ silently.

**Verificación pendiente**: agregar `fprintf(stderr, ...)` en `esp_cpu_irq_handler` para ver si `level=1` arriva y qué dice `accept_interrupts`.

**Hipótesis B — Timing de `qemu_set_irq` vs CPU TB execution**:

Aunque setteamos LEVEL high (no pulse), TCG puede que no chequee IRQs durante la ejecución de un TB enorme (e.g., el `j .` self-loop que es 1-instr TB). Pero el chequeo entre TBs debería notar el level high.

**Verificación pendiente**: modificar `esp_cpu_exec_interrupt` para log cuando se entra (debe llamarse en cada TB bound).

**Hipótesis C — IRQ_M_EXT pin no recibe el raise**:

El IRQ va a `espressif-cpu-irq-lines[1]` → handler should set `irq_pending` y `qemu_irq_raise(parent_irq)` donde `parent_irq = qdev_get_gpio_in(self, IRQ_M_EXT)`. Eso llama `riscv_cpu_set_irq` con irq=11 (M_EXT) que actualiza mip.

**Verificación pendiente**: en `riscv_cpu_update_mip`, log mip transitions.

## Decisión

Por ahora NO seguir con el flow real Arduino. Las 3 hipótesis necesitan instrumentación en `target/riscv/esp_cpu.c` y `target/riscv/cpu_helper.c` para diagnosticar. Es trabajo significativo que requiere:
1. Modificar QEMU's RISC-V CPU code (no solo nuestros nuevos devices).
2. Recompilar QEMU para cambios en target/riscv/.
3. Probable necesidad de implementar partes de CLIC (ESP32-P4 usa CLIC, no PLIC).

**El hello-world demo (Phase 2.N) sigue siendo el output user-visible del proyecto** y demuestra que la pila de emulación funciona end-to-end (CPU + memory + UART + ELF loader + 59 runtime patches).

## Próximas fases (priorizadas)

1. **Phase 2.Q (CLIC instrumentation)**: agregar logs en `esp_cpu_irq_handler`, `esp_cpu_exec_interrupt`, `riscv_cpu_update_mip` para diagnosticar por qué traps no fire.

2. **Phase 2.R (CLIC native support)**: extender `target/riscv/` con CLIC mode (mtvt vector table, xnxti CSR, hardware vectoring). ~500 LOC en target/. Esto destrabaría:
   - IDF runtime CLIC dispatch
   - FreeRTOS tick → preemption
   - app_main → setup() → loop() running naturally

3. **Phase 2.S (Cache MMU full)**: implementar el cache MMU real. spi_flash_mmap funcionaría, esp_log_cache_get_level loop wouldn't get stuck on partition reads.

## Archivos tocados en Phase 2.P

- `hw/riscv/esp32p4.c` — Phase 2.N hello-world patches comentados → re-enabled (pivote).
- `test/test-esp32-p4/autosearch/scripts/run_kernel_drive.sh` — trace mode toggled durante investigación, restaurado.

## Lessons learned

1. **`-d int` en QEMU es flaco para detectar IRQs custom**: solo loguea CPU exception entries del kernel/CSR mode estándar. Para esp_cpu custom dispatch, hay que instrumentar manualmente.

2. **`-d exec` produce trace gigante**: 5 segundos wall = 5 GB log con ~5M lines. Útil pero requiere disk space.

3. **Custom IRQ dispatch en RISC-V QEMU es complejo**: ESP-IDF asume CLIC mode pero QEMU's RISC-V CPU es CLINT por default. Espressif's `target/riscv/esp_cpu.c` provee un dispatcher intermedio que setea mcause manualmente, pero todavía depende del riscv_cpu_set_irq → mip path para realmente trap.

4. **Bypass patches funcionan pero crean ilusión**: el "Hello world" demuestra HW path. No demuestra runtime path. Para demo runtime real, falta proper CLIC.

## Estado consolidado

| Hito | Estado |
|---|---|
| ROM banner | ✅ |
| Bootloader runs 6.4s | ✅ |
| App ELF runs (174 fns) | ✅ |
| FreeRTOS scheduler entered | ✅ |
| `app_main` reached | ✅ |
| Primer UART output (hello world) | ✅ |
| SYSTIMER tick wired | ✅ |
| Trap to mtvec firing | ❌ pending Phase 2.Q |
| Real `setup()` runs | ❌ pending Phase 2.R |
| `digitalWrite(LED)` blink visible | ❌ pending Phase 2.R+ |
