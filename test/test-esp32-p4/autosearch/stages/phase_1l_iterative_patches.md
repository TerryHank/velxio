# Phase 1.L — iterative-patch loop hasta app_main

**Status:** ⏳ pending

## Goal

Continuar iterando con el patrón de Phase 1.F.bis hasta que la CPU llegue a `app_main` (entry point del sketch Arduino) y eventualmente ejecute `Serial.println("ESP32-P4 blink starting")`.

## Estimación

Cada iteración descubre 1-2 blockers nuevos (assert, register poll, illegal instruction). Cada uno se resuelve agregando una entrada a:
- `esp32p4_smart_overrides[]` — para registers que el runtime poll-ea con valores específicos.
- `esp32p4_runtime_patches[]` — para funciones IDF que asertan o esperan estado que no modelamos.

Estimando 50-100 entradas más para llegar a `app_main` (a razón de ~10-20 minutos por iteración manual).

## Workflow

```bash
# 1. Trace
wsl -d Ubuntu-24.04 -u root -- \
    bash -c "timeout 8 /root/qemu-p4-build/qemu-system-riscv32 \
      -M esp32p4 -bios /root/p4rom.elf -kernel /root/blink.elf \
      -nographic -monitor none -d in_asm,nochain -D /root/qasm.txt 2>&1; \
      grep '^IN: ' /root/qasm.txt | uniq -c | tail -10; \
      tail -30 /root/qasm.txt"

# 2. Identificar la última función ejecutada o el address del fault.
# 3. Disassemble:
wsl -d Ubuntu-24.04 -u root -- \
    bash -c "riscv64-unknown-elf-objdump --disassemble=<func_name> /root/blink.elf"

# 4. Agregar override o patch en hw/riscv/esp32p4.c.
# 5. Rebuild:
wsl -d Ubuntu-24.04 -u root -- bash /mnt/c/Users/.../sync_and_build_v3.sh
# 6. Re-trace.
```

## Atajos posibles

Para acelerar:
- **Patch ID3 funciones de assert masivamente**: cualquier función que llame a `__assert_func` se patchea con `c.li a0,0; c.jr ra` (return 0) si su return value es lo único que importa.
- **Smart stub returns -1 by default**: cambia muchos polls al revés. Trade-off — algunos polls esperan 0, otros 1.
- **Auto-detect "spin loops"**: detectar TBs que ejecutan más de N veces sin progreso, identificar register polleado, agregar override.

## Bloqueante actual (al cierre de Phase 1.F.bis)

Después de `cache_hal_is_cache_enabled` (que ahora devuelve 1), el runtime asserta en algún check downstream. Próxima sesión: identificar exactamente qué.

## Notes

- Esta fase es *grindy*. Cada iteración es directa pero suma.
- Una alternativa "menos hacks" es implementar peripherals reales (cache MMU, MSPI, TIMG con IRQs reales) — es más trabajo upfront pero menos patches al final.
- Phase 1.K (Interrupt Matrix) eventualmente desbloquea polls que esperan IRQs en lugar de status bits.
