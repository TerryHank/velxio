# Phase 2.B.boot_comm — Bootloader chip ID verify

**Estado**: ✅ done · commit pendiente

## Goal

Bootloader Espressif corre 6.4 segundos de inicialización (regi2c writes) y luego falla:

```
E (6414) boot_comm: mismatch chip ID, expected 18, found 0
```

`expected 18` = `CONFIG_IDF_FIRMWARE_CHIP_ID` para ESP32-P4 (compile-time).
`found 0` = `image_header->chip_id` del image que estaba leyendo.

## Análisis

El flash blob TIENE chip_id correcto en sus headers:
- `flash[0x2000+12]` = `0x12 0x00` (= 18 LE) — bootloader image header
- `flash[0x10000+12]` = `0x12 0x00` (= 18 LE) — app image header
- `flash[0x8000]` = partition table (magic 0xAA50)

Pero el bootloader reporta `found 0`. Posibles causas:

### H1 — Bootloader lee desde un offset mal calculado

Si el bootloader busca un image header en flash[0] (que está erased = 0xFF), `chip_id` (16-bit) leería como 0xFFFF = 65535, no 0. No coincide con "found 0".

Si el bootloader busca en flash[X] donde X tiene un image-like sequence de 0xE9 0x?? 0x?? 0x?? entonces... pero el `0xE9 magic` solo está en 0x2000 y 0x10000.

Si lee de `0x40000000` (cache window virtual) sin que el MMU traduzca, podría leer cero (RAM uninitialized despues del flash blob copy).

### H2 — App image pre-OTA load fallback

ESP-IDF bootloader, después de cargar a sí mismo, busca la app image. Lee partition table → encuentra app partition → lee app image header. Si el bootloader interpreta mal la partition table o lee desde el offset incorrecto, puede leer chip_id=0.

### H3 — Cache MMU re-mapping after bootloader load

El bootloader puede haber re-programado el cache MMU para mapear flash de manera distinta a la lineal. Si re-mapeo el cache, la lectura desde virtual address X devuelve flash[Y] con Y != X. Podría caer en una región que tiene 0s.

## Plan

1. Trace el flujo del bootloader desde `entry 0x4ff29ed0` hasta el punto donde se imprime el error. Identificar la función `bootloader_common_check_chip_id_in_image_header` (per IDF source).
2. Ver de qué dirección está leyendo (qué virtual address arg pasa a memcpy).
3. Determinar si es un offset incorrecto (fix: arreglar partition lookup) o un cache MMU mal mapeado (fix: implementar MMU real).

## Acceptance criteria

- [ ] Bootloader ya no imprime `mismatch chip ID`.
- [ ] Bootloader continúa con load de app segments y eventualmente saltea al app entry.

## Resolución (resumen ejecutivo)

**Causa raíz** (H3 confirmada): el bootloader IDF lee flash via un **sliding-window MMU mapping** en virtual address `0x43FF0000` (block 63 del cache window). Para cada read, programa `MMU entry 1023 = (phys_page | VALID)` via los registros MSPI `0x5008C380` (índice) y `0x5008C37C` (valor), luego lee desde `0x43FF0000 + (flash_addr & 0xFFFF)`. Sin emulación del MMU, el read fall-throughed al RAM extflash beyond el blob → 0.

**Fix — minimal cache MMU emulator** (~150 LOC):

1. **Captura de MMU writes** en MSPI flash stub: hook custom `esp32p4_mspi_flash_write` que cuando se escribe a offset 0x380 guarda `pending_idx`, y cuando a 0x37C guarda `entries[pending_idx] = value`. Pasa luego al scratch RW normal.

2. **Custom MMIO overlay** en `0x43FF0000-0x43FFFFFF` (64 KB, prioridad 3 sobre extflash RAM): el read decodifica el entry actual de bit 12 (VALID) y bits [11:0] (phys page), traduce a flash blob offset, y devuelve los bytes correctos.

3. **Mirror del flash blob** en buffer separado (64 MB max). Inicializado durante `flash blob reloaded over cache window` para que el MMU translation pueda leer.

**Encontrado experimentalmente**: la VALID bit es bit 12 (0x1000), NO bit 14 (0x4000) como había asumido inicialmente. La phys page está en bits [11:0]. Confirmado al observar entries dinámicos: `entries[1023] = 0x00001001` significa "valid + phys page 1".

## Resultado

- ✅ `mismatch chip ID` ya no aparece. Bootloader pasa la verificación.
- ✅ Bootloader continúa cargando segments y avanza significativamente.
- ⚠️ Bootloader llega a `qio_mode: Failed to set QIE bit, not enabling QIO mode` (non-fatal — usa DIO).
- ⚠️ Después del qio_mode warning, bootloader corre 39+ segundos de fake time sin más output. Probablemente atascado en otro polling loop (post-flash-config).

## Próximo blocker

Bootloader stalls después del qio_mode warning. Phase 2.B.bootloader_post_qio investiga.

## Archivos tocados

- `hw/riscv/esp32p4.c` (~150 LOC nuevos):
  - `Esp32P4MspiMmu` struct (state global).
  - `esp32p4_mmu_block63_read/write` ops y region register.
  - `esp32p4_mspi_flash_read/write` (write hook que captura MMU updates).
  - `esp32p4_install_mmu_block63` y `esp32p4_install_mspi_flash`.
  - Mirror del flash blob al buffer del MMU.

## Notas

- Esta es una emulación MÍNIMA del cache MMU. Solo cubre block 63 (donde el bootloader lee). El app code que XIPea desde otros blocks aún necesitaría la implementación completa (Phase 2.A.6).
- La VALID bit 12 fue clave — easy mistake si uno asume bit 14 sin verificar.
