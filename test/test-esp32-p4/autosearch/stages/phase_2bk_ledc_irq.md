# Phase 2.BK — LEDC IRQ wiring

**Estado**: ✅ done — sixth backport of the IRQ template. Duty
register write sets `INT_RAW.CH<N>_DUTY_END` (bit 8+N for channel
N). LEDC → CLIC cause 27. Arduino interrupt-driven fade-done
callbacks (`ledcWriteCallback()` style sketches) now work.

Live test (2026-05-08):
```json
{"t_ns":287327,"event":"ledc_irq","level":1}
{"t_ns":289279,"event":"ledc_irq","level":0}
```

`int_raw=0x100` = bit 8 = `CH0_DUTY_END`. JSON event types now **25**.

## Goal

Phase 2.AC established LEDC with duty-event emission for 8 PWM
channels. The remaining gap was CPU IRQ delivery — Arduino
sketches doing interrupt-driven fades (e.g.,
`ledcAttachInterrupt()` patterns) had no completion signal.

Phase 2.BK closes it with the standard template. Each duty write
now sets a per-channel `DUTY_END` bit in INT_RAW, edge-detected so
fade loops don't flood the IRQ.

## Lo que SE INVESTIGÓ

### 1. Per-channel bit placement

8 channels, with INT_RAW also wanting to model timer-overflow
bits (4 timers) in a future phase. Layout:
- Bits 0..3: reserved for TIMER_OVF (future)
- Bits 8..15: CH<N>_DUTY_END for channel N

Macro `ESP32P4_LEDC_INT_CH_DUTY_END(ch)` = `(1u << (8 + ch))`.

For self-test on channel 0, bit 8 = `0x100`. Stderr `int_raw=0x100`
confirms.

### 2. Duty-write completion as IRQ trigger

The existing write op already detects per-channel DUTY register
writes. Adding the IRQ raise is at the end of that branch — set
the per-channel bit, call `update_irq`. Edge detection prevents
flood on the demo blob's continuous fade loop (which writes duty
~20 times/sec).

In the demo blob, with INT_ENA = 0 (no guest enables IRQ), no
IRQ fires regardless of duty writes — INT_RAW accumulates but
INT_ST stays 0. Self-test enables INT_ENA on bit 8 and fires
one duty write to demonstrate.

### 3. CLIC cause 27

After this phase:
- 17-20 base
- 21 TWAI0
- 22 I2C0
- 23 I2C1
- 24 SPI2
- 25 RMT
- 26 ADC
- **27 LEDC** (new)
- Free: 28+

## Lo que SÍ funcionó

```
[esp32p4.ledc] CPU IRQ line -> 1 (int_raw=0x100 int_ena=0x100)
[esp32p4.ledc] CPU IRQ line -> 0 (int_raw=0x0 int_ena=0x100)
```

JSON: 2 events at boot. Build clean, regression-clean.

Template backport count: **6 peripherals** with the unified IRQ
pattern. Pattern remains stable + mechanical.

## Lo que NO funcionó / decisiones tomadas

1. **Only DUTY_END modeled**: TIMER_OVF interrupts (4 timers) and
   counter-LIM hit interrupts stay zero. Most Arduino LEDC usage
   doesn't need them. `2.BK.timer` could add them later.

2. **No per-channel IRQ disambiguation in JSON**: `ledc_irq`
   event doesn't include `ch` field. If multi-channel fade
   demos want to know which channel completed, they read
   INT_ST in their ISR. JSON could add a `ch` field but
   skipped to keep the event symmetric with other `*_irq` events.

3. **Bit layout 8..15 (not 0..7) for CH bits**: deliberately
   leaves bits 0..3 free for future TIMER_OVF modeling. Per-IDF
   ledc_reg.h conventions, real silicon uses similar grouping.

## Implementación final

### `include/hw/timer/esp32p4_ledc.h`

- INT_RAW/CLR/ENA/ST offsets (0xA0/A4/A8/AC).
- `ESP32P4_LEDC_INT_CH_DUTY_END(ch)` macro = `(1u << (8 + ch))`.
- `intr_out` + `irq_level` fields on state.

### `hw/timer/esp32p4_ledc.c`

- `esp32p4_ledc_update_irq()` helper.
- INT_CLR W1TC handler + INT_ENA recompute.
- Duty write branch additionally sets INT_RAW.CH<N>_DUTY_END.
- realize: gpio_out registration.
- reset: drop IRQ line.

### `hw/riscv/esp32p4.c`

- LEDC init block: connect intr_out to CLIC cause 27.
- Inline self-test (mirror of 2.BJ ADC pattern).

## Estado consolidado (post-2.BK)

CLIC cause map:

| Cause | Peripheral |
|-------|------------|
| 17 | SYSTIMER |
| 18 | GPIO |
| 19 | TIMG0 |
| 20 | TIMG1 |
| 21 | TWAI0 |
| 22 | I2C0 |
| 23 | I2C1 |
| 24 | SPI2 |
| 25 | RMT |
| 26 | ADC |
| **27** | **LEDC** |
| 28+ | unallocated (UART pending special handling) |

Peripherals with full data + IRQ paths:
- TIMG, GPIO, TWAI, I2C × 2, SPI, RMT, ADC, **LEDC** (new).
- UART remains TBD (QOM class-override variation needed).

JSON event types: **25** (added `ledc_irq`).

## 46-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.BF  | TWAI IRQ wiring (template established)                  |
| 2.BG  | I2C IRQ wiring (1st backport)                           |
| 2.BH  | SPI IRQ wiring (2nd)                                    |
| 2.BI  | RMT IRQ wiring (3rd)                                    |
| 2.BJ  | ADC IRQ wiring (4th)                                    |
| **2.BK** | **LEDC IRQ wiring (5th — core peripherals complete)** |

## Próximas direcciones

- UART IRQ wiring (cause 28, QOM class-override variation).
- WDT actual reset action.
- Real PWM waveform on GPIO via LEDC.
- BH1750/SHT31/CCS811 sensor adds.
- TWAI1 + TWAI2 instantiation.
- FreeRTOS scheduler resurrection.
