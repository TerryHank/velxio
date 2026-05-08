# Phase 2.Q — Instrumentación esp_cpu IRQ dispatch (diagnóstico)

**Estado**: ✅ done con hallazgo **definitivo** del root cause IRQ.

## Goal

Después de Phase 2.P (que dejó documentado que el trap a `mtvec` no fires
a pesar de que SYSTIMER tick + IRQ wiring están bien), instrumentar el
dispatcher custom `target/riscv/esp_cpu.c` con `fprintf(stderr, ...)` en
los dos puntos críticos:

1. `esp_cpu_irq_handler` — ¿llega el `qemu_set_irq` a la línea 1?
2. `esp_cpu_exec_interrupt` — cuando se acepta, ¿qué `mtvec` y qué
   `mcause` resultan?

Las hipótesis a validar (de Phase 2.P):
- **A**: mstatus.MIE no realmente seteado al chequear (a pesar de los
  patches `csrsi mstatus, 8`).
- **B**: timing de `qemu_set_irq` vs TCG TB execution.
- **C**: el IRQ_M_EXT pin no recibe el raise.

## Lo que SE INVESTIGÓ

1. Agregar dos bloques `fprintf(stderr, …)` a `target/riscv/esp_cpu.c`:
   - En `esp_cpu_irq_handler`: log cada 128° llamada con `n` (línea),
     `level`, `accept_interrupts()`, `mstatus`, `mie`, `irq_pending`.
   - En `esp_cpu_exec_interrupt`: log primeras 4 entradas con
     `interrupt_request`, `accepted`, `irq_cause`, `mtvec`.
2. Re-build QEMU completo (`-j 8` en `target/riscv` solo).
3. Run `run_kernel_drive.sh` (10s) y capturar stderr.

## Hallazgo (output observado)

```
[esp_cpu.irq_handler] #1 line=1 level=1 accept=0 mstatus=00000000 (MIE=0) mie=00000000 irq_pending=0
Hello from QEMU ESP32-P4!
[esp_cpu.exec_interrupt] #1 request=00000002 accepted=1 irq_cause=1 mtvec=00000000
[esp_cpu.irq_handler] #129 line=1 level=1 accept=0 mstatus=00001800 (MIE=0) mie=00000800 irq_pending=0
[esp_cpu.irq_handler] #257 line=1 level=1 accept=0 mstatus=00001800 (MIE=0) mie=00000800 irq_pending=0
[esp_cpu.irq_handler] #385 ...same pattern, mstatus stuck...
```

Lectura del log:

| # | accept | mstatus | MIE | mie    | Interpretación                                              |
|---|--------|---------|-----|--------|-------------------------------------------------------------|
| 1 | 0      | 0x00000000 | 0 | 0x00000000 | Boot — mstatus fresco, CSRs aún no enabled.            |
| (hello world prints — patches Phase 2.O ejecutan después)                                |
| (algún punto entre #1 y #129, IRQ accepted=1 con mtvec=0!)                               |
| 129 | 0    | 0x00001800 | 0 | 0x00000800 | Post-trap: MPP=11 (M-mode), MPIE=0, MIE=0. STUCK aquí. |

## Hipótesis confirmada/descartada

- ✅ **Hipótesis A descartada parcialmente**: los patches `csrsi mstatus, 8`
  + `csrs mie, t1` SÍ ejecutaron (vemos `mie=0x800` en los logs post-trap).
  El bit MIE se llegó a setear momentáneamente, pero el primer trap lo
  borra y nadie lo re-setea.
- ✅ **Hipótesis C descartada**: IRQ delivery wiring funciona perfecto.
  Los `qemu_set_irq` llegan a `espressif-cpu-irq-lines[1]` y disparan el
  handler. Los #1, #129, #257, … confirman que el level=1 es persistente.
- ❌ **Hipótesis nueva D — root cause**:
  **`mtvec=0x00000000` al momento del trap**. Cuando el primer IRQ se
  acepta (entre #1 y #129), el CPU hace trap → salta a PC=`mtvec`=0 →
  ejecuta basura → fault → semantic de trap-on-trap clears MIE de mstatus
  → todos los IRQs subsiguientes son rechazados (`accept=0`).

## Por qué `mtvec=0`

Nuestro flujo bypass (Phase 2.M-2.O) salta directo a `app_main` sin
correr la inicialización del IDF runtime que instala el trap vector
table en `mtvec`. Específicamente:

- IDF normal corre `_start` (ROM) → `call_start_cpu0` → `start_cpu0_default`
  → `esp_intr_alloc_intrstatus` → eventually `csrw mtvec, &_vector_table`.
- Nuestro flujo: trampolín en `0x4FC1FFE0` salta directo a `app_main`
  (skip de toda esa cadena para que UART output funcione antes de
  pegarse en el `esp_log_cache_get_level` lock loop).
- Resultado: `mtvec` retains su reset value = `0x00000000`.

## Lo que NO funcionó (intentado y descartado)

1. **`riscv_csr_read(env, CSR_MIE)` retorna 0** en algunos branches del
   handler aunque el `csrs` patch lo seteó. Esto fue un red herring —
   el handler chequea `MIE` (mstatus bit 3), no `MEIE` (mie bit 11).
   Después de cambiar el orden de logging vimos los valores correctos.
2. **Pulsar el IRQ (`set_irq(1)` + `set_irq(0)`)**: pensé que tal vez
   level-triggered estaba causando que TCG no detectara el edge.
   Descartado — el handler #1 demuestra que el level llega bien.
3. **Aumentar la frecuencia del SYSTIMER tick**: probé 1000 Hz vs 100 Hz.
   Mismo resultado — `mtvec=0` independiente del rate.

## Lo que SÍ funcionó

- ✅ Diagnóstico completo: ahora tenemos *visibilidad total* del path
  IRQ → handler → exec_interrupt → trap → mret.
- ✅ Confirmamos que el código de patches Phase 2.O (CSR enables) ejecuta
  correctamente: `mie=0x800` post-trap es prueba.
- ✅ El IRQ delivery wiring (Phase 2.O SYSTIMER → esp_cpu line 1) es
  100 % funcional.

## Próximos pasos (Phase 2.R)

Ahora que sabemos exactamente qué falla, el fix es trivial-ish:

1. **Patch `mtvec` con un stub válido** antes de que el primer IRQ
   pueda fires. Posibles lugares:
   - En el trampolín `0x4FC1FFE0`: agregar 2 instrucciones que setean
     `mtvec` a la dirección de un `mret` stub en IRAM.
   - O un patch directo a `mtvec` via `cpu_set_csr` desde
     `esp32p4_init` antes de iniciar el CPU.
2. **Stub mret en IRAM**: 1 instrucción `0x30200073` (`mret`) en una
   dirección conocida (e.g., `0x4FC10000`).
3. **Edge-trigger el SYSTIMER tick**: cambiar de level-high
   (`qemu_set_irq(irq, 1)` perpetuo) a pulse (`raise` + `lower` en el
   mismo callback) para que después del `mret` no re-trap inmediato.
4. **Re-correr Phase 2.Q diagnostic**: ahora con `ESP_CPU_IRQ_DEBUG`
   debiéramos ver `accepted=1` repetido cada 10 ms (100 Hz) sin
   `mstatus` stuck en `0x1800`.

Esto **valida end-to-end el path de interrupciones** sin necesidad de
implementar CLIC mode completo todavía. CLIC viene en Phase 2.R+ cuando
queramos que el IDF runtime real (no nuestro bypass) haga su propio
setup de mtvt + xnxti.

## Archivos tocados en Phase 2.Q

- `target/riscv/esp_cpu.c` — agregadas dos secciones `#ifdef
  ESP_CPU_IRQ_DEBUG` con `fprintf(stderr, …)` en `esp_cpu_irq_handler`
  y `esp_cpu_exec_interrupt`. Quedan como debug-gated permanentemente
  para usar en Phase 2.R+.

## Lessons learned

1. **Custom IRQ dispatch en RISC-V QEMU se beneficia mucho de
   `fprintf(stderr, ...)` directo**: `qemu_log` con
   `LOG_GUEST_ERROR`/`LOG_UNIMP` no aparece en `-D` cuando no se pasan
   los flags correctos, mientras que `fprintf(stderr)` siempre llega
   al stdout/stderr del proceso.
2. **mstatus value `0x1800` es la firma de "trap-just-happened":
   MPP=11 + MPIE=0 + MIE=0** — útil para reconocer en logs futuros.
3. **Reset value de `mtvec` es 0** (RISC-V Privileged spec, mtvec
   inicialmente undefined pero QEMU lo deja en 0). Cualquier emulador
   custom DEBE inicializar `mtvec` antes del primer IRQ posible.
4. **Bypass-style emulación tiene un costo silencioso**: saltarse parte
   del init runtime puede dejar CSRs sin setup. Hay que mantener un
   inventario de "qué CSRs/registros NO están seteados por nuestro
   bypass" y patchearlos uno a uno.

## Estado consolidado (post-2.Q)

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
| Trap to `mtvec` firing (sin crash)         | ❌ Phase 2.R |
| Real `setup()` runs                        | ❌ Phase 2.R+|
| `digitalWrite(LED)` blink visible          | ❌ Phase 2.R+|
