# Phase 1.F.bis — más smart-stub overrides + runtime patches

**Status:** ✅ done — commit `d4505f8689`

## Goal

Después de Phase 1.F-lite el runtime se trababa en `system_early_init` esperando core 1. Iterar agregando overrides + patches hasta avanzar lo más posible. Resultado: trace de 9602 → 12920 líneas, atravesando ~30 funciones más del IDF.

## Acceptance criteria

CPU ejecuta past `system_early_init`, `esp_clk_init`, `rtc_clk_init`, varias funciones de clock setup, regi2c control bus, y llega a `spi_flash_cache_enabled` → `cache_hal_is_cache_enabled` que ahora devuelve 1.

## Lo que se agregó

### Smart-stub overrides (override table)

| Base + Offset | Valor | Por qué |
|---|---|---|
| `0x500E6000 + 0x004` | `0` | rtc_clk_cpu_freq_to_xtal: clock-switch op done bit auto-clears |
| `0x500C2000 + 0x080` | `0x1` | rtc_clk_cal_internal: TIMG0 cal done bit set |

`timg0` y `timg1` convertidos de `create_unimplemented_device` a `esp32p4_install_smart_stub` para soportar overrides.

### Runtime patches (function patches)

| Address | Patch | Por qué |
|---|---|---|
| `0x40007F64` | `c.beqz` → `c.nop` | system_early_init: skip core-1 ready wait (machine es single-core, no podemos fakear `s_cpu_up[1]` porque BSS init lo limpia) |
| `0x4FF09984` | `c.li a0,1; c.jr ra` | cache_hal_is_cache_enabled: return 1 (sin modelar cache controller, valida cualquier `cache_id`) |

## Funciones que ahora ejecutan

```
call_start_cpu0
  → bootloader_init_mem
  → system_early_init (skip core-1 wait)
    → esp_cpu_unstall
    → esp_clk_init
      → rtc_clk_init
      → rtc_clk_cal_internal
      → rtc_clk_cpu_freq_set_config
      → rtc_clk_cpu_freq_to_xtal
      → periph_rcc_acquire/exit
      → regi2c_enter_critical
      → esp_rom_regi2c_write (real ROM impl)
      → regi2c_enable_block.isra.0
    → esp_perip_clk_init
    → esp_rtc_get_time_us
  → ...
  → spi_flash_cache_enabled
  → cache_hal_is_cache_enabled (returns 1) ✓
  → __assert_func ← still aborting somewhere downstream
```

## Patrón observado

Cada iteración:
1. Trace con `-d in_asm,nochain -D /root/qasm.txt`.
2. Tail del trace muestra dónde se traba.
3. `riscv64-unknown-elf-objdump --disassemble=<func>` para ver la lógica.
4. Identificar register-stub-needed o function-patch-needed.
5. Agregar entry al override array O al patch array.
6. Rebuild + retrace.

Cada patch desbloquea ~500-1000 líneas más de ejecución. Llegar a `app_main` probablemente necesita 50-100 patches más.

## Notes

- Los patches al `.iram0.text` (L2MEM) DEBEN aplicarse después del PF_X overlay pass.
- Los patches al `.flash.text` (cache window) también después del PF_X overlay.
- Confirmado que TBs no se cachean before machine_init runs — los patches se reflejan al primer execution.
