# Phase 2.CG — CCS811 air-quality sensor (7th I2C responder)

**Estado**: ✅ done — 7 sensors live on the I2C dispatcher.
CCS811 brings eCO2 + TVOC air-quality readings to the simulated
chip, completing a 3-sensor environmental stack
(SHT31 humidity+temp + BH1750 light + CCS811 air quality)
covering the typical Arduino home-air-quality monitor kit.

Live verification (2026-05-16) — I2C0 boot trace shows **20
total i2c_rx events** (vs 5 in Phase 2.BE, 7 in 2.CE, 11 in
2.CF), composed as:

```
sensor    addr   events  detail
BMP280    0x76   1        chip_id=0x58
MPU6050   0x68   1        WHO_AM_I=0x68
BH1750    0x23   2        lux MSB+LSB
SHT31     0x44   6        T_MSB/T_LSB/T_CRC + RH_MSB/LSB/CRC
CCS811    0x5A   9        HW_ID=0x81 + 8-byte ALG_RESULT_DATA
                          ────────
                          19 on I2C0
I2C1 BMP280 0x76 1        port=1 chip_id=0x58
                          ────────
total: 20 i2c_rx events at boot
```

CCS811 ALG_RESULT_DATA decoded (8 sequential bytes from
register 0x02):

| Offset | Byte (hex) | Meaning |
|--------|------------|---------|
| 0 | 0x02 | eCO2_MSB |
| 1 | 0xFA | eCO2_LSB → eCO2 = **762 ppm** (in 400..1500 envelope) |
| 2 | 0x01 | TVOC_MSB |
| 3 | 0xC8 | TVOC_LSB → TVOC = **456 ppb** (in 0..500 envelope) |
| 4 | 0x98 | STATUS — FW_MODE ✓ APP_VALID ✓ DATA_READY ✓ |
| 5 | 0x00 | ERROR_ID = 0 |
| 6 | 0x41 | RAW_DATA_MSB |
| 7 | 0x23 | RAW_DATA_LSB → 0x4123 (synthetic current/voltage) |

STATUS byte 0x98 decoded = 0b10011000:
- bit 7 = FW_MODE = 1  (firmware loaded)
- bit 4 = APP_VALID = 1 (application valid)
- bit 3 = DATA_READY = 1 (measurement available)
- bit 0 = ERROR = 0

That's exactly the byte the Adafruit_CCS811 library checks for
in `available()` — it will see DATA_READY=1 and proceed to read
the measurement.

## Goal

Complete the environmental sensor trio (SHT31 + BH1750 + CCS811)
covering the typical "Arduino home air-quality station" sensor
set. CCS811 measures eCO2 (equivalent CO2, 400-29200 ppm range)
and TVOC (total volatile organic compounds, 0-32768 ppb range).

The CCS811 protocol differs from SHT31 in two interesting ways:

1. **Register-addressed** like BMP280 (not register-less like
   BH1750 or 16-bit-command like SHT31). The master writes the
   register pointer (0x20 for HW_ID, 0x02 for measurement) then
   does a separate read transaction.
2. **8-byte composite measurement** at register 0x02. This is
   the longest sequential read in the inventory (SHT31 had 6
   bytes including CRCs; CCS811 has 8 bytes without CRCs).

CCS811 has **no CRC** unlike SHT31 — the data integrity is
checked via the embedded STATUS byte (offset 4 in
ALG_RESULT_DATA) which the responder synthesizes alongside
the eCO2 + TVOC values.

## Lo que SE INVESTIGÓ

### 1. CCS811 register map

Per ams CCS811 datasheet (rev 1.20):

| Reg | R/W | Length | Field |
|-----|-----|--------|-------|
| 0x00 | R | 1 | STATUS |
| 0x01 | R/W | 1 | MEAS_MODE (DRIVE_MODE) |
| 0x02 | R | 8 | ALG_RESULT_DATA (eCO2+TVOC+STATUS+ERROR+RAW) |
| 0x03 | R | 4 | RAW_DATA only |
| 0x05 | R/W | 5 | ENV_DATA (humidity+temp compensation) |
| 0x18 | R | 8 | NTC (temp ref) |
| 0x1F | R | 8 | THRESHOLDS |
| 0x20 | R | 1 | HW_ID = 0x81 (fixed) |
| 0x21 | R | 1 | HW_VERSION = 0x1X (silicon revision) |
| 0xF4 | W | 0 | APP_START (transition from boot to app mode) |

Phase 2.CG models the read path for STATUS, ALG_RESULT_DATA,
HW_ID, HW_VERSION. Writes are absorbed by the dispatcher (no
side effects modeled — the synthesized data ignores MEAS_MODE
and ENV_DATA configuration).

### 2. STATUS byte synthesis

Always returns **0x98** (FW_MODE | APP_VALID | DATA_READY) so
the Arduino library's `available()` polling returns immediately.
On real silicon, DATA_READY becomes set ~1 s after `APP_START`
in 1-second drive mode, ~10 s in slow drive mode. Our model
shortcuts the wait — measurements are always "ready" instantly.

### 3. eCO2 + TVOC synthesis

| Field | Range | Period | Why |
|-------|-------|--------|-----|
| eCO2  | 400..1500 ppm | 15 s | 400 ppm = outdoor baseline; 1500 ppm = "stuffy room" |
| TVOC  | 0..500 ppb | 12 s | 0 ppb = clean air; 500 ppb = noticeable VOC |

15 s and 12 s are deliberately co-prime-ish with the other
sensors:

| Sensor | Periods |
|--------|---------|
| VL53L0X | 6 s |
| BH1750 | 8 s |
| SHT31 | 10 s (T), 12 s (RH) |
| **CCS811** | **12 s (TVOC), 15 s (eCO2)** |
| HMC5883L | 20 s |

CCS811 shares the 12 s period with SHT31 RH which creates a
visible phase lock between TVOC and humidity in the frontend
(realistic since real VOC sources include humans whose
respiration also affects humidity). Could change to 13 s if
phase-lock is undesirable.

### 4. Offset-from-tx_history[1] pattern continues to scale

Same dispatch math as BH1750 (2-byte response) and SHT31
(6-byte response) — works unchanged for CCS811's 8-byte
ALG_RESULT_DATA. The `offset = reg - tx_history[1]` formula
gives 0..7 for the 8 sequential reads regardless of starting
register.

### 5. RAW_DATA encoding

RAW_DATA at offsets 6-7 of ALG_RESULT_DATA is normally the
ADC's current + voltage measurements (lower 10 bits voltage,
upper 6 bits current code). Guests rarely use this. Encoded
as constant 0x4123 (current_code=16, voltage=0x123).

### 6. Self-test pattern

The Adafruit_CCS811 init sequence does:
1. Read HW_ID at register 0x20 → expect 0x81 (chip detect).
2. Write APP_START at register 0xF4 (boot → app mode).
3. Loop reading ALG_RESULT_DATA at register 0x02 with
   1-second cadence.

The self-test exercises (1) and (3). It skips (2) because the
write side-effect is not modeled (our STATUS reports app mode
unconditionally).

## Lo que SÍ funcionó

1. ✅ Build clean — two files compiled.
2. ✅ HW_ID read returns 0x81 ✓ — chip detected, Adafruit
   library proceeds.
3. ✅ STATUS = 0x98 — FW_MODE + APP_VALID + DATA_READY all
   set, library does NOT block.
4. ✅ eCO2 = 762 ppm at t≈0 — inside 400..1500 envelope.
5. ✅ TVOC = 456 ppb at t≈0 — inside 0..500 envelope.
6. ✅ Boot trace shows the full 9-event sequence (HW_ID + 8
   ALG bytes).
7. ✅ All other peripherals + sensors unchanged.

## Lo que NO funcionó / decisiones tomadas

### Decisiones tomadas

1. **No write-side effects modeled**: APP_START, MEAS_MODE,
   ENV_DATA writes are silently absorbed by the dispatcher's
   scratch storage. Synthesis ignores them — measurement
   simulation runs continuously regardless of guest config.

2. **Always-ready STATUS**: Real CCS811 needs ~20 min warmup
   for stable readings. Setting DATA_READY=1 immediately
   skips the warmup poll loop. Realistic-startup mode would
   need a per-state "boot_time + warmup_delay" check.

3. **No CRC validation needed**: CCS811 (unlike SHT31) has no
   per-pair CRC. Data integrity is signaled via the STATUS
   byte's ERROR bit + ERROR_ID register. Our synthesis always
   reports ERROR=0 / ERROR_ID=0.

4. **eCO2 + TVOC phase-locked at 12 s**: this is intentional
   — real silicon would correlate them (both rise as VOCs
   accumulate). Frontend rendering shows both peaking around
   the same time.

5. **HW_VERSION = 0x12**: matches the most common silicon
   revision (ams CCS811-LG_DK_ST_5 black-marked parts). The
   Adafruit library doesn't strictly check it.

## Lessons learned

1. **Register-addressed sensors with multi-byte sequential
   reads are mechanically similar to register-less ones** —
   the `offset = reg - tx_history[1]` pattern works for both.
   The only difference is whether `tx_history[1]` is a
   register address (CCS811) or a mode command (BH1750).

2. **Boot-time DATA_READY is the difference between
   "sensor works" and "sensor blocks Arduino library forever"**.
   Many sensors gate measurements behind a busy bit; respecting
   that bit in the model is essential.

3. **At 7 sensors with strap variants, the dispatcher switch
   has 9 cases**. The "table refactor at 6+" threshold from
   Phase 2.CE was conservative; 9 cases are still readable
   but the next sensor (8th) should probably trigger the
   refactor.

4. **Environmental sensor trio enables home-monitor demos**
   — Adafruit and Sparkfun both sell pre-built kits combining
   SHT31+BH1750+CCS811. Velxio can now run those sketches
   end-to-end (modulo FreeRTOS).

## Implementación final

### `hw/i2c/esp32p4_i2c.c`

- New `esp32p4_i2c_ccs811_read(s, reg)` — handles HW_ID,
  HW_VERSION, STATUS, and the 8-byte ALG_RESULT_DATA at 0x02.
- Dispatcher switch extended with cases 0x5Au + 0x5Bu.
- New `esp32p4_i2c_ccs811_self_test(s)` — fires HW_ID read
  (1 byte) + ALG_RESULT_DATA read (8 bytes).

### `include/hw/i2c/esp32p4_i2c.h`

- New forward-declaration `esp32p4_i2c_ccs811_self_test()`.

### `hw/riscv/esp32p4.c`

- New `esp32p4_i2c_ccs811_self_test(&ms->i2c0)` call after the
  SHT31 self-test in the I2C0 init block.

## Estado consolidado (post-2.CG)

I2C synthetic-responder inventory — **7 sensors / 9 cases**:

| Address | Sensor | Phase | Response shape | CRC |
|---------|--------|-------|----------------|-----|
| 0x76/77 | BMP280 (pressure/temp) | 2.AM | 1-byte register | no |
| 0x68/69 | MPU-6050 (IMU) | 2.BD | 1-byte register | no |
| 0x1E | HMC5883L (magnetometer) | 2.BE | 1-byte register | no |
| 0x29 | VL53L0X (ToF) | 2.BE | 1-byte register | no |
| 0x23/5C | BH1750 (light) | 2.CE | 2-byte raw counts | no |
| 0x44/45 | SHT31 (humidity+temp) | 2.CF | 6-byte T+RH | yes (CRC-8) |
| **0x5A/5B** | **CCS811 (air quality)** | **2.CG** | **8-byte eCO2+TVOC+STATUS** | **no** |

JSON event types: **29** (no new type — same i2c/i2c_rx).

I2C0 self-test now produces **18 i2c_rx events at boot** (1+1+2+6+9 across the 6 sensors wired on port 0). I2C1 contributes 1 (BMP280 chip_id). Total **20**.

## 69-Phase realism progression

| Phase | Capability                                                |
|-------|-----------------------------------------------------------|
| 2.BE  | HMC5883L magnetometer + VL53L0X ToF                       |
| 2.CE  | BH1750 ambient light                                       |
| 2.CF  | SHT31 humidity+temp with Sensirion CRC-8                   |
| **2.CG** | **CCS811 air-quality (eCO2 + TVOC)**                   |

Environmental sensor trio now complete: humidity+temperature
(SHT31) + light (BH1750) + air quality (CCS811).

## Próximas direcciones

- **SSD1306 OLED I2C display** (slave 0x3C / 0x3D) — write-
  only commands, no read-back. Would extend the dispatcher to
  handle write-only devices.
- **Refactor I2C dispatcher to address-keyed table** at the
  next sensor add (8th sensor would push the switch to 11
  cases).
- **BME680** environmental sensor (T+H+P+Gas, complex
  multi-register read with calibration coefficients).
- **MS5611** barometer (24-bit ADC + 8 PROM calibration regs).
- **W5500 Ethernet** + **MFRC522 RFID** SPI responders.
- **KEY_PURPOSE** eFuse for crypto routing.
- **UART IRQ** (QOM class-override) — needs extended CLIC
  since cause 31 is taken.
- **Real PWM** waveform on GPIO via LEDC.
- **FreeRTOS** scheduler resurrection.
