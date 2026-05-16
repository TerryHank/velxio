# Phase 2.BZ — SPI3 instantiation

**Estado**: ✅ done — completes the 2-instance GP-SPI inventory.
SPI3 at `0x500D1000` (DR_REG_GPSPI3_BASE per IDF), wired to CLIC
cause 31. Same QOM class as SPI2 — pure machine-init boilerplate,
no class changes.

Live test (2026-05-08), boot SPI events:
```
4 spi    port=2   (SPI2 self-test from Phase 2.AO + 2.AU)
4 spi    port=3   (SPI3 self-test — mirror, this phase)
2 spi_irq port=2  (SPI2 IRQ from Phase 2.BH)
2 spi_irq port=3  (SPI3 IRQ — wired to cause 31, this phase)
1 spi_rx  port=2  (SPI2 ILI9341 response from Phase 2.AU)
1 spi_rx  port=3  (SPI3 ILI9341 response — synthetic responder)
```

14 SPI events at boot with per-port disambiguation.

## Goal

ESP32-P4 has 2 GP-SPI controllers (SPI2 + SPI3) plus 2 flash-side
SPI controllers (SPI0 + SPI1). Phase 2.AO added SPI2; Phase 2.BZ
adds SPI3 following the multi-instance pattern from Phase 2.BL
(TWAI1/2) and Phase 2.AZ (UART1..4).

Arduino's `SPI.begin(SCK, MISO, MOSI, SS)` defaults to SPI2 but
can be redirected to SPI3 via `SPIClass spi3(HSPI_HOST)`. Many
sketches use both controllers for parallel display + SD card.

## Lo que SE INVESTIGÓ

### 1. SPI3 base address

Per IDF `components/soc/esp32p4/include/soc/reg_base.h`:
```c
#define DR_REG_GPSPI3_BASE  0x500D1000
```

Confirmed via the existing `create_unimplemented_device
"esp32p4.gpspi3"` stub at this address (line 928 of `esp32p4.c`).
Our overlay at priority 1 takes precedence.

### 2. Reusing TYPE_ESP32P4_SPI class

Same class as SPI2 covers all instances. Per-instance state:
- `event_log`, `boot_ns`, `port_num` (existing)
- `storage[]` for register backing
- `last_cmd` for ILI9341 responder
- `intr_out` + `irq_level` (existing Phase 2.BH)

`port_num=3` for SPI3 disambiguates from SPI2's `port_num=2` in
JSON events.

### 3. CLIC cause allocation

After this phase:
- 17-20 base (SYSTIMER/GPIO/TIMG0/TIMG1)
- 21 TWAI0, 22 I2C0, 23 I2C1
- 24 SPI2, 25 RMT, 26 ADC, 27 LEDC
- 28 TWAI1, 29 TWAI2, 30 RTC_WDT
- **31 SPI3** (new)

Cause 31 is the last in the standard 32-cause CLIC table (causes
0-16 are RISC-V architectural exceptions). Cause 32+ would need
extended CLIC.

### 4. ILI9341 responder

Both SPI2 and SPI3 share the synthetic ILI9341 responder from
Phase 2.AU. Self-test on each fires a 4-byte RDDID command and
gets back the canonical `0x009341` chip ID, generating 1 spi_rx
event per controller (2 total).

If a real Arduino sketch attached different SPI devices to SPI2
and SPI3 (e.g., ILI9341 display on SPI2 + SD card on SPI3), the
shared responder would respond to both as ILI9341 — sub-optimal.
Future phase could add per-instance responder dispatch (similar
to the I2C BMP280/MPU6050/HMC5883L/VL53L0X dispatcher).

### 5. Self-test ordering

In the boot trace, SPI3 events come after SPI2 events because
machine init runs SPI3's block after SPI2's. The order is
deterministic but not silicon-meaningful — real silicon has the
peripherals existing in parallel.

### 6. No regression to existing SPI2 flow

Phase 2.BH's SPI2 IRQ wiring + Phase 2.AU's ILI9341 responder
both continue to work for SPI2 — verified by the 7 SPI2 events
still firing as expected (4 spi + 2 spi_irq + 1 spi_rx).

## Lo que SÍ funcionó

Live test (2026-05-08):

**Per-port event distribution**:
```
4 spi    port=2     ← SPI2 (existing)
4 spi    port=3     ← SPI3 (new)
2 spi_irq port=2    ← SPI2 IRQ raise + clear
2 spi_irq port=3    ← SPI3 IRQ raise + clear
1 spi_rx  port=2    ← SPI2 ILI9341 RDDID → 0x9341
1 spi_rx  port=3    ← SPI3 ILI9341 RDDID → 0x9341
```

Total 14 SPI-related events at boot. Per-port disambiguation
clean.

Build clean, no regressions in other peripheral counts.

## Lo que NO funcionó / decisiones tomadas

### Decisiones tomadas

1. **Single ILI9341 responder for both controllers**: real
   sketches typically attach different devices to SPI2 vs SPI3
   (display vs SD card). Our shared responder always speaks
   ILI9341. Documented as a future refinement.

2. **No instantiate-flash-side SPI0/1**: those are modeled via
   the cache MMU + extflash work (Phase 2.A.1 / 2.B.boot_comm).
   They're not "user SPI" controllers from Arduino's
   perspective.

3. **port_num=3 (not 2)**: matches IDF's `SPI2_HOST` and
   `SPI3_HOST` enum values where the indices align with the
   silicon controller numbers. Frontend rendering can use the
   port number directly as a "SPI3" label.

4. **Cause 31 is the last available**: future per-peripheral
   IRQ wiring (UART, etc.) would need extended CLIC causes or
   shared lines via the interrupt matrix.

## Lessons learned

1. **Multi-instance pattern continues to scale**: 4th
   application of the pattern (UART in 2.AZ/2.BB, I2C in 2.BB,
   TWAI in 2.BL, now SPI). ~50 lines of mostly mechanical
   machine-init code.

2. **CLIC cause budget is finite**: 32 standard causes (0-31)
   with 0-16 reserved for RISC-V architectural exceptions
   leaves only 15 peripheral IRQ lines. We've now used 14
   (causes 17-31). Adding more peripherals will need shared
   IRQ lines via the interrupt matrix, or extended CLIC mode.

3. **Shared responder works for development-time demos**: real
   sketches usually pick one role per SPI controller. Sharing
   ILI9341 across both is "okay for now" with a documented
   path to per-instance responders.

## Implementación final

### `hw/riscv/esp32p4.c`

- Machine state: new `ESP32P4SpiState spi3` field.
- New init block after SPI2:
  - `object_initialize_child` / `sysbus_realize`
  - MMIO overlay at `0x500D1000` priority 1
  - event_log + boot_ns + port_num=3
  - `qdev_connect_gpio_out_named` to CLIC cause 31
  - `esp32p4_spi_self_test()` call

### No header / device-class changes

Same as 2.BL pattern: existing `TYPE_ESP32P4_SPI` class +
existing self-test helper. Multi-instance is pure machine-init
work.

## Estado consolidado (post-2.BZ)

GP-SPI inventory:

| Controller | Address | Phase | CLIC cause | port_num |
|------------|---------|-------|------------|----------|
| SPI2 | 0x500D0000 | 2.AO/2.AU/2.BH | 24 | 2 |
| **SPI3** | **0x500D1000** | **2.BZ** | **31** | **3** |
| SPI0/SPI1 | flash-side | n/a (Cache MMU) | n/a | n/a |

CLIC cause map:
```
17 SYSTIMER, 18 GPIO, 19 TIMG0, 20 TIMG1,
21 TWAI0, 22 I2C0, 23 I2C1, 24 SPI2,
25 RMT, 26 ADC, 27 LEDC, 28 TWAI1, 29 TWAI2,
30 RTC_WDT, 31 SPI3
```

All 15 peripheral IRQ slots (causes 17-31) wired.

JSON event types: **28** (unchanged — adds instances, not
event types).

## 63-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.BW  | eFuse BLOCK0 + WDT_DELAY_SEL                            |
| 2.BX  | eFuse env-var overrides                                  |
| 2.BY  | eFuse chip revision                                      |
| **2.BZ** | **SPI3 instantiation (GP-SPI inventory complete)**   |

## Próximas direcciones

- **Chip-info ROM stub** consuming the 2.BY eFuse accessors —
  makes `ESP.getChipRevision()` end-to-end functional.
- **Per-instance SPI responder dispatch**: SPI2 = display,
  SPI3 = SD card etc.
- **DIS_TWAI / DIS_USB_JTAG** eFuse fields with peripheral-
  disable behavior.
- **UART IRQ** (QOM class-override).
- **Real PWM** waveform on GPIO via LEDC.
- **BH1750/SHT31/CCS811** sensors.
- **FreeRTOS** scheduler.
- **CLIC cause budget exhausted at cause 31** — future
  peripherals need extended CLIC or shared lines.
