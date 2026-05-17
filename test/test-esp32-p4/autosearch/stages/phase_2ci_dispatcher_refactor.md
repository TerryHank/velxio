# Phase 2.CI — I2C dispatcher refactor to address-keyed table

**Estado**: ✅ done — pure debt-reduction phase. Zero behavior
change. Replaces the 10-case switch chain in
`esp32p4_i2c_responder_read` with a static const table of
`{addr, read_fn, name}` rows. Adding a new I2C sensor now costs
**1 table row + 1 responder function** (vs the previous
"add 2-3 switch cases with strap-variant care").

Live regression (2026-05-16):
```
i2c_rx events at boot:  20  ✓ (identical to 2.CH)
ssd1306 events at boot: 10  ✓ (identical to 2.CH)
```

All 7 readable sensors (BMP280/MPU6050/HMC5883L/VL53L0X/BH1750/
SHT31/CCS811) plus the write-only SSD1306 keep producing
identical byte streams. CRC-8 values on SHT31 still compute
correctly. CCS811 STATUS still reports 0x98.

## Goal

The Phase 2.CH README marked the dispatcher as
"refactor warranted before next add" (10 cases — 7 sensors ×
~1.4 strap variants average). This phase pays the debt before
the next sensor (BME680, MS5611, W5500 etc.) pushes the switch
past readability.

The refactor needed to handle two responder-function shapes:
- **Stateless** `(reg)` — BMP280, MPU6050, HMC5883L, VL53L0X
  (fixed register spaces).
- **State-aware** `(s, reg)` — BH1750, SHT31, CCS811
  (need `tx_history[1]` for offset math).

A unified function-pointer table requires one signature. Chose
to wrap the stateless ones with thin adapter functions instead
of changing their signatures across the board. Adapter cost is
trivial (3-line function each, compiler inlines them) and keeps
the per-sensor source as compact as possible.

## Lo que SE INVESTIGÓ

### 1. Why refactor now

The switch shape:
```c
switch (slave_addr) {
case 0x76u:
case 0x77u: return esp32p4_i2c_bmp280_read(reg);  /* 2 cases for 1 sensor */
case 0x68u:
case 0x69u: return esp32p4_i2c_mpu6050_read(reg);
case 0x1Eu: return esp32p4_i2c_hmc5883l_read(reg);
case 0x29u: return esp32p4_i2c_vl53l0x_read(reg);
case 0x23u:
case 0x5Cu: return esp32p4_i2c_bh1750_read(s, reg);
case 0x44u:
case 0x45u: return esp32p4_i2c_sht31_read(s, reg);
case 0x5Au:
case 0x5Bu: return esp32p4_i2c_ccs811_read(s, reg);
default: return 0xFFu;
}
```

Each new sensor required:
1. Add 2-3 case labels (one per strap variant).
2. Decide between `read(reg)` or `read(s, reg)` based on the
   responder type.
3. Risk of typo in `case` labels (e.g., wrong strap address)
   silently going to default.

The table form:
```c
static const ESP32P4I2cResponder responders[] = {
    { 0x76u, bmp280_dispatch,  "BMP280" },
    { 0x77u, bmp280_dispatch,  "BMP280" },
    ...
};

for (i = 0; i < ARRAY_SIZE(responders); i++) {
    if (responders[i].addr == slave_addr) {
        return responders[i].read(s, reg);
    }
}
```

Each new sensor adds **1 row per strap variant**, all type-
checked at compile time, with the human-readable name in the
same row.

### 2. Two function-signature options considered

**Option A: change all responders to `(s, reg)`** — touch every
existing responder function (BMP280, MPU6050, HMC5883L,
VL53L0X) to add the `s` param (and let them ignore it).

**Option B: write thin adapters** — wrap the stateless ones
with 3-line `(s, reg) → reg` adapters.

Chose Option B because:
- Doesn't churn the existing responder functions.
- Adapter functions are obviously trivial (single forward call).
- Compiler inlines them — no runtime cost.
- Keeps responder-function source minimal (the stateless ones
  stay as one-arg functions).

### 3. Dispatch performance

Linear scan over a 12-entry table = up to 12 comparisons +
branches per I2C read. Cache-resident, ~12 cycles worst-case
on a modern x86. With the existing 50 ms event throttle, this
is dwarfed by everything else.

For a future 30+ sensor count, switch to:
- **Sorted table + binary search** (O(log n), ~5 comparisons)
- **128-entry direct lookup** (1 indirect load) — costs 128 ×
  pointer-size bytes (~1 KB). Probably the right call past 30
  sensors.

Neither is justified yet.

### 4. Table-row debug name

Added a `const char *name` field to each row. Purpose:
- Self-documenting (the address-only switch lost the "this is
  BMP280" context once the case-fall-through inlined the read).
- Future diagnostic stderr trace can identify which responder
  handled an unknown register access.

Costs sizeof(char*) per row = 12 × 8 bytes = 96 bytes total.
Negligible.

### 5. Ordering preserved

Kept the table ordered by phase introduction (BMP280 → CCS811)
so a reader can follow the history. Strap variants stay
grouped: 0x76 / 0x77 for BMP280 are adjacent rows.

### 6. Default case still 0xFF

Same as the switch's `default: return 0xFFu;` — unknown slave
returns the I2C pull-up default. Real silicon shows the same
behavior (no device ACKs, then no slave drives MISO, pull-up
wins).

## Lo que SÍ funcionó

1. ✅ Build clean — single file changed (esp32p4_i2c.c).
2. ✅ Regression-clean: 20 i2c_rx events at boot — identical to
   Phase 2.CH baseline.
3. ✅ SSD1306 path unaffected: 10 ssd1306 events still fire.
4. ✅ All 7 readable sensors produce correct values:
   - BMP280: reg=0xD0 byte=0x58 ✓
   - MPU6050: reg=0x75 byte=0x68 ✓
   - BH1750: 2-byte lux MSB+LSB ✓
   - SHT31: 6-byte T+CRC+RH+CRC with correct Sensirion CRC ✓
   - CCS811: HW_ID=0x81 + 8-byte ALG with STATUS=0x98 ✓
5. ✅ I2C1 path unaffected: BMP280 chip_id=0x58 at port=1 ✓.

## Lo que NO funcionó / decisiones tomadas

### Decisiones tomadas

1. **Adapter functions, not signature changes**: keeps the
   responder source files minimal. The adapters are 3 lines
   each and the compiler inlines them.

2. **Table row order = phase order**: preserves history
   visibility. Future sorted-bisearch could re-order if
   performance demands it.

3. **Linear scan, not bisearch / direct lookup**: 12 entries
   is too small for either alternative to win. Both add
   complexity without measurable benefit until we're past
   ~30 sensors.

4. **Debug name in each row, not external lookup**: keeps row
   self-contained. The struct is tiny anyway (3 fields × ~8
   bytes = 24 bytes per row).

5. **No table-init code path**: `static const` is link-time;
   no runtime initialization. Survives reset() without
   touching it.

## Lessons learned

1. **Refactor before the threshold makes the next add cheap**.
   Adding BME680 now costs ~25 LOC (responder fn + 1-2 table
   rows). Without the refactor it would have been ~40 LOC
   (responder fn + 2-3 case labels + careful switch
   bookkeeping).

2. **Adapter functions are essentially free** — compiler
   inlines, source stays compact, type system enforces
   correctness.

3. **Debug names in dispatch tables pay back across years of
   maintenance** — the cost is 8 bytes per row, the benefit
   is "what does address 0x44 mean again?" answered without
   scrolling.

4. **Regression-clean refactors need ONE good test signal**.
   For this phase: "exactly 20 i2c_rx events with identical
   byte values" — a single grep verifies the entire 7-sensor
   surface in one shot.

## Implementación final

### `hw/i2c/esp32p4_i2c.c`

- New 4 adapter functions (`bmp280_dispatch`, `mpu6050_dispatch`,
  `hmc5883l_dispatch`, `vl53l0x_dispatch`) — each 3 lines:
  `(void)s; return wrapped_fn(reg);`.
- New `ESP32P4I2cResponder` struct + `esp32p4_i2c_responders[]`
  table — 12 rows for the current 7 sensors + their strap
  variants.
- `esp32p4_i2c_responder_read()` body: 4-line table walk
  (replaces the prior 25-line switch chain).

### No header changes

The dispatcher is internal — the public `esp32p4_i2c_responder_read()`
signature stays `(s, reg) → uint8_t`.

### No machine-init / test changes

Phase 2.CI is pure refactor; no machine init wiring or
self-test changes needed.

## Estado consolidado (post-2.CI)

I2C dispatcher now has:

```c
static const ESP32P4I2cResponder esp32p4_i2c_responders[12] = { … };
```

Add-a-sensor cost:
| Phase | Step | Where | LOC |
|-------|------|-------|-----|
| Responder | Write `xxx_read(s, reg)` | `hw/i2c/esp32p4_i2c.c` | ~15-30 |
| Strap rows | Add 1-2 table entries | same file, table block | ~2 |
| Self-test | Optional `xxx_self_test(s)` | same file + header decl | ~25 |
| Machine wire | One self-test call | `hw/riscv/esp32p4.c` | ~5 |
| **Total per sensor** | | | **~50 LOC** |

JSON event types: **30** (unchanged from 2.CH).

## 71-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.CG  | CCS811 air-quality (7th I2C responder)                  |
| 2.CH  | SSD1306 OLED (write-only) + 30th event type             |
| **2.CI** | **I2C dispatcher refactor — pure debt reduction**    |

## Próximas direcciones

- **BME680** environmental sensor (T+H+P+Gas with calibration
  coefficients) — now cheap to add post-refactor.
- **MS5611** barometer (24-bit ADC + 8 PROM regs).
- **W5500 Ethernet SPI responder** (mirrors Phase 2.CD pattern).
- **MFRC522 RFID SPI responder**.
- **Extend SD responder** for CMD17 (READ_BLOCK) — completes
  basic SD I/O.
- **KEY_PURPOSE** eFuse field for crypto routing.
- **UART IRQ** (QOM class-override) — needs extended CLIC.
- **Real PWM** waveform via LEDC.
- **FreeRTOS** scheduler resurrection (deferred — biggest
  unblocker).
