# Phase 2.A.5 — Flash bootloader load (invalid header)

**Estado**: ⏭️ next

## Goal

ROM ahora ejecuta `ets_run_flash_bootloader` y trata de leer el header del bootloader desde el cache window. Imprime `invalid header: 0x0b000ec1` repetidamente.

## Análisis

- Flash blob `blink.merged.bin` tiene `0xFF` en offset 0..0x1FFF (erased) y bootloader magic `0xE9` en offset `0x2000`.
- ROM lee primer header desde `cache_window @ 0x40000000` que mapea a flash offset 0.
- `0x0b000ec1` es lo que la cache devuelve al leer flash en offset 0 (probablemente algún garbage uninitialized o un read across boundary).

## Hipótesis

### H1 — Flash layout incorrecto

Real ESP32-P4 con `idf.py merge-bin` produce un blob con bootloader en offset 0x0 o 0x2000 dependiendo del SDK. Lo más probable: el blob `blink.merged.bin` fue generado con bootloader en offset 0x2000.

**Fix**: regenerar blob con bootloader en offset 0, O configurar el cache window para mapear flash[0x2000+] al cache window 0x40000000.

### H2 — Cache window mapping incorrecto

El cache window podría no estar configurando correctamente la translación virtual→físical. ROM espera leer desde virtual `0x40000000` y obtener el contenido de flash desde el offset que el cache MMU dice.

Investigar: TRM Cap 7.3.3 — Cache MMU configuration.

### H3 — ROM lee bootloader desde una offset distinta

Posible que el ROM lea desde una offset compute por el partition table (0x10000?). Buscar en ROM disasm cuál offset usa.

## Acceptance criteria

- [ ] ROM imprime `bootloader header valid` o equivalent → continúa booteando.
- [ ] No más `invalid header` repeated.

## Pasos

1. Disassembly de `ets_run_flash_bootloader` y `0x4fc0e716` (la función que lee el header).
2. Determinar offset que ROM espera.
3. Si el blob está mal: regenerar O patchear cache window para mapear correctly.
4. Validar fix con run.

## Archivos a tocar

- `hw/riscv/esp32p4.c` — posible cache window mapping fix.
- O regenerar `blink.merged.bin` con offset correcto.

## Notas

- Esto es **flash content / cache MMU** territory, no más CPU/peripheral emulation.
- Cuando esto se desbloquee el bootloader Arduino correrá → app code → `setup()` y `loop()` Arduino → LED blink. Eso es Phase 2 (blink end-to-end).
