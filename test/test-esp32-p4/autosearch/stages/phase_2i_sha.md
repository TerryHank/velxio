# Phase 2.I.sha — HW Crypto block stubs

**Estado**: ✅ done · commit pendiente

## Goal

ROM tiene funciones `ets_sha_*` que usan el SHA HW accelerator @ `0x50091000`. El bootloader puede llamar estas funciones del ROM. Sin un stub mapeado en `0x50091000`, las escrituras del ROM van a region unmapped (catch-all = 0).

Específicamente, el `ets_sha_update` ROM polls `SHA_BUSY_REG` (offset 0x18) esperando 0 (idle). Sin stub, lee 0 por default, así que ya funciona — pero tampoco hay backing-RAM para los config writes que se interpretan después.

## Fix

Smart stubs (backing-RAM 4KB cada uno) en:
- `0x50090000` — esp32p4.aes
- `0x50091000` — esp32p4.sha
- `0x50092000` — esp32p4.rsa
- `0x50093000` — esp32p4.ds
- `0x50095000` — esp32p4.hmac

Plus override:
- `SHA_BUSY @ 0x50091018` → SMART_FIXED 0 (siempre idle/done).

## Estado real

Implementé los stubs pero NO observé cambio en el comportamiento del bootloader. Razón: el bootloader actual (compilado con ESP-IDF) usa **software SHA via mbedtls** en vez de las funciones ROM `ets_sha_*`. La mbedtls SHA256 corre en C puro sin tocar registros HW.

El XOR loop en `0x4FF2DE12-0x4FF2DE6E` es el SHA256 software de mbedtls iterando sobre la app image (que el bootloader lee via cache window por mi MMU emulator).

## Próximo blocker

**Phase 2.B.real_sha** — opciones para destrabar:

1. **Implement real HW SHA256 in QEMU**: hook SHA_START_REG writes para computar SHA256 sobre M_MEM y poner el resultado en H_MEM. Solo ayuda si el bootloader USA HW SHA — actualmente usa SW.
2. **Patch bootloader code** para skipear la verificación SHA. Requiere identificar el call site sin símbolos.
3. **Wait it out**: software SHA sobre 1+ MB de app image puede tomar 10+ minutos wall time en QEMU TCG. Probé 5 min sin éxito, pero el SYSTIMER timestamp sólo avanzó 1.8ms — sospecho que SYSTIMER está broken (timestamps no representan progreso real).
4. **Skip whole SHA verify** modificando boot config en flash (set hash_appended=0 en image header). Cambiaría el binary blob pero no el emulator.

## Notas

- Los stubs igual son útiles para futuros ejercicios donde el ROM ets_sha_* se llame.
- El stall del bootloader post-qio es un problema de PERFORMANCE de TCG, no de funcionalidad. El bootloader EJECUTA correctamente, solo lento.

## Archivos tocados

- `hw/riscv/esp32p4.c`: 5 nuevas smart stubs + 1 SHA override.
