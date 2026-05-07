# Phase 2.J — Direct ELF kernel boot path

**Estado**: 🚧 in-progress

## Discovery

Pivot estratégico: en vez de pelear con el bootloader Espressif (post_qio stuck en SW SHA), uso el path `-kernel ELF` para cargar `blink.elf` directamente.

```bash
qemu-system-riscv32 -M esp32p4 \
  -kernel /root/blink.elf \
  -drive file=/root/blink.merged.bin,if=mtd,format=raw \
  -nographic
```

`blink.elf` tiene:
- `setup()` @ 0x40000020
- `loop()` @ 0x4000006a
- `app_main()` @ 0x4000303e
- ESP-IDF + Arduino linked statically (~7.3 MB ELF, ~520 KB cargados)

## Resultado

- ✅ ELF loads (521210 bytes)
- ✅ PF_X overlay pass re-writes 3 executable segments
- ✅ Trampoline en reset vector salta al entry (0x4FF00C40)
- ✅ CPU ejecuta IDF runtime startup
- ⚠️ Llega a `system_early_init` y llama `abort()` por un check fallido

## Análisis del abort

```
0x40008060: addi a5, zero, 233       ; a5 = 0xE9 (ESP image magic)
0x40008064: beq a4, a5, +40          ; if a4 == 0xE9, ok
0x40008068: lw a5, -1972(gp)          ; otherwise check global var
0x4000806c: beqz a5, abort path      ; if zero → abort
...
0x40007ef4: jalr ets_printf            ; print error
0x40007efc: jalr abort                 ; → terminate
```

El check espera leer `0xE9` (magic byte de un ESP image) en algún registro/memory. Probablemente está leyendo el primer byte del bootloader image o app image desde flash via cache window. Con nuestro flash blob lineal en RAM, virtual `0x40002000` (donde está el bootloader) tiene `0xE9`, pero virtual `0x40000000` tiene `0xFF` (erased).

Si el check lee desde `0x40000000`, falla. Si lee desde `0x40002000`, pasa. La diferencia depende de si ROM o IDF runtime configura el cache MMU para mapear correctly.

## Próximo paso

1. Identificar de qué dirección el check lee el byte.
2. O bien:
   a. Asegurar que esa dirección tiene `0xE9` (modificar flash blob layout o cache window setup).
   b. Patchear el call para skipear el check.
3. Continuar el flujo: app debe llegar a `setup()` → `loop()` → ver "Blink" en UART.

## Notas

- Esta vía bypassea TOTALMENTE el bootloader Espressif (que estaba stuck en SW SHA).
- Si funciona, `setup() + loop()` → LED blink → milestone Phase 2 complete.
- El path es complementario al bootloader path; ambos tienen mérito (ROM testing vs app testing).
