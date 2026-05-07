# Phase 1.E.bis — `-bios` ELF + ROM oficial Espressif

**Status:** ✅ done — commit `e05e2019a7`

## Goal

Cargar el ROM oficial de Espressif (`esp32p4_rev0_rom.elf` del release `esp-rom-elfs`) en lugar del ret-fill. El ROM tiene 113 KB de código real con todas las funciones `esp_rom_*`, `ets_*`, `uart_*` que el runtime IDF llama a addresses fijas.

## Acceptance criteria

```
$ qemu-system-riscv32 -M esp32p4 \
    -bios esp32p4_rev0_rom.elf \
    -kernel blink.ino.elf \
    -nographic
[esp32p4] loaded BIOS ELF '/root/p4rom.elf' (255844 bytes)
[esp32p4] loaded ELF '/root/blink.elf' (521210 bytes), entry 0x4ff00c40
[esp32p4] PF_X overlay pass: re-wrote 3 segments
[esp32p4] machine init complete (...)
```

Sin trap inmediato (el bloqueante es ahora bootloader_flash_execute_command_common, Phase 1.F).

## Lo que cambió

1. **`-bios` detecta ELF**: el handler antes era flat-binary-only (`load_image_targphys_as`). Ahora lee los primeros 4 bytes y si son `0x7F 'E' 'L' 'F'` carga via `load_elf_ram_sym`. ELF segments aterrizan en HP ROM + cache window según los PT_LOAD del ROM ELF.

2. **`-bios` acepta paths absolutos**: `qemu_find_file` solo busca en QEMU's data dirs. Agregamos fallback a `g_file_test()` para abrir el path tal cual.

3. **Trampolín movido a `0x4FC1FFE0`** (final del HP ROM, 32 bytes antes del fin): así no pisa el código del ROM cuando ambos están cargados.

4. **`resetvec` decidido al inicio del machine_init**:
   - con `-kernel`: `0x4FC1FFE0` (trampolín → app entry)
   - sin `-kernel`: `0x4FC00000` (ROM ejecuta normalmente)

## Cómo obtener el ROM blob

```bash
curl -sSL "https://github.com/espressif/esp-rom-elfs/releases/download/20241011/esp-rom-elfs-20241011.tar.gz" \
  | tar -xz esp32p4_rev0_rom.elf -O > esp32p4-rom.elf
```

Está en `C:/Desarrollo/velxio/third-party/esp-rom-elfs/esp32p4_rev0_rom.elf` (descargado en esta sesión).

## Notes

- ROM ELF size: 256 KB (incluye debug info). El runtime efectivo es ~150 KB (113 código + 35 datos + symbols).
- Entry del ROM: `0x4FC00000` (mismo que nuestro reset address, así que sin `-kernel` el ROM bootea solo).
- Sin `-kernel`, el ROM intentaría leer el bootloader stage 2 desde flash, lo cual falla porque no tenemos SPI flash controller (Phase 1.F).
- ROM blob NO se commitea al fork (~256 KB, licencia Espressif). Documentar en setup script.
