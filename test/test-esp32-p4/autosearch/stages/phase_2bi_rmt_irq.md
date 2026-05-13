# Phase 2.BI — RMT IRQ wiring

**Estado**: ✅ done — fourth backport of the IRQ template (after
TWAI 2.BF, I2C 2.BG, SPI 2.BH). RMT channel TX_END (flush
completion) sets `INT_RAW.CH<N>_TX_END` (bit N) and fires CLIC
cause 25. Arduino `Adafruit_NeoPixel::show()` interrupt-driven
completion callbacks now work.

Live test (2026-05-08), 2 `rmt_irq` events at boot:
```json
{"t_ns":3622236,"event":"rmt_irq","level":1}
{"t_ns":3623441,"event":"rmt_irq","level":0}
```

`int_raw=0x1` = `CH0_TX_END` bit 0. JSON event types now **23**.

## Goal

Phase 2.AY established RMT with WS2812 NeoPixel decoding. The
remaining gap was CPU IRQ delivery — sketches doing
`strip.show(); waitForCompletion();` via interrupt hung.

Phase 2.BI closes it with the same recipe as 2.BG/2.BH (W1TC
INT_CLR, recompute on INT_ENA write). RMT differs only in:
- Different INT register offsets (0x80/0x84/0x88/0x8C)
- Per-channel TX_END bits (bit 0..3 for the 4 TX channels) — set
  by `flush_channel()` at the end of pixel decode
- CLIC cause line 25

## Lo que SE INVESTIGÓ

### 1. Per-channel TX_END bits

Real RMT INT_RAW has independent TX_END bits for each of 4 TX
channels (bits 0..3) plus 4 RX channels (bits 4..7). Our flush
sets the bit for the channel that just completed:

```c
int_raw |= ESP32P4_RMT_INT_CH_TX_END(ch);  // (1u << ch)
```

For our self-test which uses channel 0, this sets bit 0
(`0x01`). A multi-channel demo would set different bits as each
channel completes.

### 2. INT register placement

RMT INT registers live at 0x80 in the device space — after the
4 channel-DATA regs (0x00..0x1F) and 8 CONF0/CONF1 reg pairs
(0x20..0x5F). Using 0x80/0x84/0x88/0x8C is close to silicon
layout per TRM 28.5; exact offsets confirmed empirically by
checking they don't collide with the CHnDATA/CHnCONF regions.

### 3. Flush-completion as IRQ trigger

The skeleton's `flush_channel()` already runs at end-of-TX
(triggered by `CONF1.TX_START`). Adding the IRQ raise is two
lines at the end of that function — analogous to where TWAI's
`load_rx_frame()` set INT_RAW.RX.

### 4. Self-test ack pattern

Same as 2.BG/2.BH: write INT_ENA at start (enable CH0_TX_END),
trigger flush via the existing TX_START write, then write
INT_CLR to ack. Produces the canonical 2-event raise/clear
sequence at boot.

## Lo que SÍ funcionó

Live test (2026-05-08):
```
[esp32p4.rmt] CPU IRQ line -> 1 (int_raw=0x1 int_ena=0x1)
[esp32p4.rmt] CPU IRQ line -> 0 (int_raw=0x0 int_ena=0x1)
```

JSON: 2 `rmt_irq` events. Build clean, regression-clean.

Template-backport productivity continues to hold: ~50 lines + ~20
minutes. Five peripherals now share the unified IRQ pattern
(TIMG, TWAI, I2C, SPI, RMT).

## Lo que NO funcionó / decisiones tomadas

1. **No RX channels' IRQ bits**: bits 4..7 stay zero. RX channels
   aren't modeled at the data level either; deferred together as
   `2.BI.rx`.

2. **Single shared CLIC cause for all 4 TX channels**: real
   silicon also uses one shared IRQ line for the whole RMT
   block; per-channel discrimination happens inside the ISR by
   reading INT_ST. This is the correct silicon behavior.

3. **No JSON event per-channel disambiguation**: `rmt_irq`
   doesn't include a `port` or `ch` field — different from
   `i2c_irq` which has `port`. Could add `ch` if a multi-channel
   demo wanted it, but right now only channel 0 is exercised.

## Implementación final

### `include/hw/misc/esp32p4_rmt.h`

- INT_RAW/CLR/ENA/ST register offsets (0x80/84/88/8C).
- `ESP32P4_RMT_INT_CH_TX_END(ch)` = `(1u << ch)` macro.
- `intr_out` + `irq_level` fields on state.

### `hw/misc/esp32p4_rmt.c`

- `esp32p4_rmt_update_irq()` helper (mirror of I2C/SPI).
- `flush_channel()` sets INT_RAW.CH<N>_TX_END + update_irq.
- INT_CLR W1TC handler in write op.
- INT_ENA write triggers update_irq.
- `realize`: gpio_out registration.
- `reset`: drop IRQ line.
- `self_test`: enable INT_ENA at start, ack via INT_CLR at end.

### `hw/riscv/esp32p4.c`

- RMT init block: connect intr_out to CLIC cause 25.

## Estado consolidado (post-2.BI)

CLIC cause map:

| Cause | Peripheral | Phase |
|-------|------------|-------|
| 17-20 | SYSTIMER/GPIO/TIMG0/TIMG1 | various |
| 21 | TWAI0 | 2.BF |
| 22 | I2C0 | 2.BG |
| 23 | I2C1 | 2.BG |
| 24 | SPI2 | 2.BH |
| **25** | **RMT** | **2.BI** |
| 26+ | unallocated (ADC, LEDC, UART) | — |

JSON event types: **23** (added `rmt_irq`).

## Próximas direcciones

- ADC IRQ wiring (cause 26, sample done).
- LEDC IRQ wiring (cause 27, duty change done / counter overflow).
- UART IRQ wiring (cause 28+, RX/TX/break).
- WDT actual reset action.
- Real PWM waveform on GPIO via LEDC.
- BH1750/SHT31/CCS811 sensors.
- FreeRTOS scheduler resurrection.
