# Phase 2.CF — SHT31 humidity+temperature sensor (6th I2C responder)

**Estado**: ✅ done — 6th I2C synthetic responder, first one
with a **multi-byte response + CRC validation**. The
Adafruit_SHT31 library and the Sensirion ESP-IDF driver both
verify the per-pair CRC-8 and discard readings with mismatches,
so the emulator must compute real Sensirion CRC-8 (polynomial
0x31, init 0xFF) — placeholder bytes would silently break
the Arduino flow.

Live verification (2026-05-16) — I2C0 boot trace:

```json
"i2c_rx","port":0,"reg":208,"byte":88     ← BMP280 chip_id 0x58
"i2c_rx","port":0,"reg":117,"byte":104    ← MPU6050 WHO_AM_I 0x68
"i2c_rx","port":0,"reg":16, "byte":1      ← BH1750 lux MSB
"i2c_rx","port":0,"reg":17, "byte":107    ← BH1750 lux LSB
"i2c_rx","port":0,"reg":6,  "byte":102    ← SHT31 T_MSB  (0x66)
"i2c_rx","port":0,"reg":7,  "byte":102    ← SHT31 T_LSB  (0x66)
"i2c_rx","port":0,"reg":8,  "byte":147    ← SHT31 T_CRC  (0x93) ✓
"i2c_rx","port":0,"reg":9,  "byte":84     ← SHT31 RH_MSB (0x54)
"i2c_rx","port":0,"reg":10, "byte":122    ← SHT31 RH_LSB (0x7A)
"i2c_rx","port":0,"reg":11, "byte":198    ← SHT31 RH_CRC (0xC6) ✓
```

Decoded SHT31 values:
- T_raw = 0x6666 = 26214
  → T_C = -45 + 175 × 26214 / 65535 = **25.0 °C**
  (matches the 20..30 °C synthesized midpoint at t≈0).
- RH_raw = 0x547A = 21626
  → RH = 100 × 21626 / 65535 = **33.0%**
  (matches the 30..70% synthesized start at t≈0).

CRC manual verification for `crc8(0x66, 0x66)` with init=0xFF,
polynomial=0x31:
```
Round 1 (byte 0x66): crc = 0xFF ^ 0x66 = 0x99
  After 8 iters: 0xB1
Round 2 (byte 0x66): crc = 0xB1 ^ 0x66 = 0xD7
  After 8 iters: 0x93  ← matches observed byte 147 ✓
```

That's the **exact byte the Adafruit_SHT31 library expects**.

## Goal

Mirror the I2C 6-sensor dispatcher pattern. SHT31 is the most
widely-used humidity+temperature combo in maker boards (Adafruit
breakouts, Pimoroni HATs, Wokwi simulations). It's distinct from
the prior 5 sensors in three important ways:

1. **16-bit commands** sent as 2 separate FIFO_DATA writes (0x2C
   then 0x06, e.g.) — testing the dispatcher's handling of
   multi-byte command sequences.
2. **6-byte response** (vs BMP280's 1-byte, BH1750's 2-byte)
   — testing the dispatcher's offset-from-tx_history[1] math
   across an extended read sequence.
3. **CRC validation** — the canonical Arduino library checks
   CRC-8; the responder MUST produce real CRC bytes.

The CRC requirement makes this the first responder where a
"plausible-but-wrong" implementation would silently fail user
code — getting the CRC right is mandatory, not optional.

## Lo que SE INVESTIGÓ

### 1. SHT31 protocol

Per Sensirion datasheet (rev 5, 2019-11):

**16-bit commands**:
| Command | Hex | Meaning |
|---------|-----|---------|
| Single-shot, high-rep, stretch | `0x2C 0x06` | Standard "give me a measurement" |
| Single-shot, high-rep, no stretch | `0x24 0x00` | Same but uses ACK polling |
| Single-shot, med-rep, stretch | `0x2C 0x0D` | Faster, less accurate |
| Single-shot, low-rep, stretch | `0x2C 0x10` | Fastest |
| Periodic 0.5 mps high-rep | `0x20 0x32` | 2 readings/second |
| Fetch (after periodic start) | `0xE0 0x00` | Get latest reading |

**6-byte read response** (after ≥15 ms delay):
| Byte | Meaning |
|------|---------|
| 0 | T_MSB |
| 1 | T_LSB |
| 2 | CRC-8 of T_MSB+T_LSB |
| 3 | RH_MSB |
| 4 | RH_LSB |
| 5 | CRC-8 of RH_MSB+RH_LSB |

**Decoding**:
- `T_C = -45 + 175 × (T_raw / 65535)` (range -45..130 °C)
- `RH = 100 × (RH_raw / 65535)` (range 0..100 %)

### 2. CRC-8 parameters

Per datasheet § 4.12 "Checksum Calculation":
- Polynomial: `x^8 + x^5 + x^4 + 1` = `0x31`
- Init: `0xFF`
- Reflect input: no
- Reflect output: no
- Final XOR: `0x00`

Adafruit_SHT31 library applies CRC validation in `read()`:
```cpp
if (data[2] != crc8(data + 0, 2)) return -1;
if (data[5] != crc8(data + 3, 2)) return -1;
```

A wrong CRC silently drops the reading; user code sees NaN.
We MUST produce correct CRC bytes.

### 3. tx_history[1] tracking through 16-bit command

The dispatcher's `tx_history` rolls left-to-right (most-recent
first). For a SHT31 Arduino transaction:

```
Step                 tx_history[0]   tx_history[1]
1. write slave+W     slave_addr+W    (prior)
2. write 0x2C        0x2C            slave_addr+W
3. write 0x06        0x06            0x2C
4. STOP, delay
5. RSTART
6. write slave+R     slave_addr+R    0x06
7. read 6 bytes      …               …
```

At step 7, `tx_history[1] = 0x06` (the SECOND command byte,
since `slave_addr+R` displaced the first command byte). That's
what `read_reg` latches as the starting offset, and it
auto-increments through 0x07, 0x08, 0x09, 0x0A, 0x0B for the
6-byte response.

So `offset = reg - tx_history[1]` gives `0..5` for the response
bytes, regardless of which mode command was used (as long as
the master sends 2 command bytes — which all SHT31 commands
do).

### 4. Synthesis ranges

Triangular waveforms:
- Temperature: 20..30 °C over 10 seconds (10×10 °C tenths
  used for integer-rational math).
- Humidity: 30..70 % over 12 seconds.

Periods chosen distinct from BH1750 (8 s) / VL53L0X (6 s) /
HMC5883L (20 s) so a frontend rendering multiple sensors
simultaneously gets visually-distinct cadences.

### 5. Integer-rational math

`T_raw = (T_C + 45) / 175 × 65535` would lose precision in
integer division. The formula becomes:
```c
t_raw = ((temp_d + 450) * 65535) / 1750;
```
where `temp_d` is T_C × 10 (range 200..300). This is exact
to the LSB at int64_t intermediate width.

Same approach for humidity: `RH_raw = RH × 65535 / 100`.

### 6. The CRC table-vs-bit-by-bit choice

Two implementations possible:
- **Bit-by-bit**: ~16 LOC, 8 iterations × 2 bytes = 16 shifts +
  conditional XOR. ~1 µs per CRC at host CPU speed.
- **Table-lookup**: 256-byte ROM table, single byte-indexed
  lookup. Faster but adds boot-time table init.

Bit-by-bit is the right choice here. CRC is called twice per
SHT31 measurement; even at 1000 measurements/second the bit-
by-bit version costs <1 ms total. Table lookup is over-
engineering.

## Lo que SÍ funcionó

1. ✅ Build clean.
2. ✅ Boot trace shows all 6 SHT31 response bytes at port=0.
3. ✅ Manual CRC verification matches: `crc8(0x66, 0x66) =
   0x93` exactly (observed reg=8 byte=147 = 0x93).
4. ✅ Temperature decodes to **25.0 °C** at t≈0 (midpoint of
   20..30 envelope).
5. ✅ Humidity decodes to **33.0%** at t≈0 (start of 30..70
   envelope).
6. ✅ Other peripherals + sensors unchanged (BMP280 at port=1
   still 0x58; 4 prior sensors at port=0 unchanged).

## Lo que NO funcionó / decisiones tomadas

### Decisiones tomadas

1. **Bit-by-bit CRC, not table lookup**: ~16 LOC, fast enough,
   no table-init code path. Easier to audit.

2. **Self-test fires single-shot high-rep with stretching
   (0x2C06)**: the most common Arduino default. One-time mode
   patterns are similar enough that other commands would also
   work, but high-rep-stretch matches the Adafruit example.

3. **Different periods per sensor**: 10 s temp / 12 s RH for
   SHT31. The two channels deliberately use different periods
   (10 vs 12) so they're not phase-locked — gives a more
   realistic "independent sensors" signal.

4. **integer-rational math instead of float**: same as Phase
   2.BR/2.BQ — avoids float in hot path, no precision issue.

5. **Slave 0x44 in self-test (not 0x45)**: 0x44 is the
   Adafruit default. Both addresses dispatch to the same
   responder.

## Lessons learned

1. **CRC validation gates user code** — without real CRC,
   Adafruit's library silently fails. This is the first
   sensor in our inventory with a hard "must be byte-exact"
   requirement; future sensors with CRC (MS5611, BME680) will
   need the same treatment.

2. **The offset-from-tx_history[1] math scales to any response
   length** — works for BH1750 (2 bytes) and SHT31 (6 bytes)
   without modification. Future register-less sensors with
   long response patterns (multi-page reads) can use the same
   approach.

3. **16-bit commands "just work" with the existing tx_history
   ring** — the SECOND command byte ends up in tx_history[1]
   after the slave+R RSTART, which is exactly what the
   responder needs for offset math. The dispatcher didn't
   need any changes to handle multi-byte commands.

4. **Manual CRC verification at integration time pays off** —
   spending 30 seconds doing the CRC manually (vs trusting
   the implementation) caught zero bugs this time but would
   have caught a wrong polynomial / init constant
   immediately.

## Implementación final

### `hw/i2c/esp32p4_i2c.c`

- New `esp32p4_i2c_sht31_crc8(msb, lsb)` — Sensirion CRC-8
  with polynomial 0x31, init 0xFF.
- New `esp32p4_i2c_sht31_read(s, reg)` — triangular T+RH
  synthesis, 6-byte response keyed by
  `offset = reg - tx_history[1]`.
- Dispatcher switch extended with cases 0x44u + 0x45u.
- New `esp32p4_i2c_sht31_self_test(s)` — writes 0x2C 0x06,
  then 6 reads. 4 i2c events + 6 i2c_rx events emitted.

### `include/hw/i2c/esp32p4_i2c.h`

- New forward-declaration `esp32p4_i2c_sht31_self_test()`.

### `hw/riscv/esp32p4.c`

- New `esp32p4_i2c_sht31_self_test(&ms->i2c0)` call after the
  BH1750 self-test in the I2C0 init block.

## Estado consolidado (post-2.CF)

I2C synthetic-responder inventory — **6 sensors**:

| Address | Sensor | Phase | Response shape | CRC? |
|---------|--------|-------|----------------|------|
| 0x76/77 | BMP280 (pressure/temp) | 2.AM | 1-byte register | no |
| 0x68/69 | MPU-6050 (IMU) | 2.BD | 1-byte register | no |
| 0x1E | HMC5883L (magnetometer) | 2.BE | 1-byte register (6 regs of XYZ) | no |
| 0x29 | VL53L0X (ToF) | 2.BE | 1-byte register (status + range) | no |
| 0x23/5C | BH1750 (light) | 2.CE | 2-byte raw counts (no register) | no |
| **0x44/45** | **SHT31 (humidity+temp)** | **2.CF** | **6-byte T+RH with CRC-8** | **yes** |

The dispatcher switch is approaching the "refactor to address-
keyed table" threshold (6 sensors, 8 cases with strap variants).
Will refactor when adding the 7th or 8th.

JSON event types: **29** (no new type — same i2c/i2c_rx).

## 68-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.BE  | HMC5883L magnetometer + VL53L0X ToF                     |
| 2.CE  | BH1750 ambient light                                     |
| **2.CF** | **SHT31 humidity+temp with Sensirion CRC-8**         |

## Próximas direcciones

- **CCS811** air quality sensor (slave 0x5A/0x5B, eCO2 + TVOC,
  multi-byte read with status register).
- **SSD1306** OLED I2C controller (slave 0x3C/0x3D) — write-
  only commands, no read-back. Would extend the dispatcher
  to handle write-only devices.
- **BME680** environmental sensor (T+H+P+Gas, complex
  multi-register read).
- **Refactor I2C dispatcher to address-keyed table** at next
  sensor add.
- **MS5611** barometer with 24-bit ADC reads + PROM coefficients.
- **W5500 Ethernet** SPI responder.
- **MFRC522 RFID** SPI responder.
- **KEY_PURPOSE** eFuse field.
- **UART IRQ** (QOM class-override).
- **Real PWM** waveform via LEDC.
- **FreeRTOS** scheduler resurrection.
