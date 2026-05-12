# Phase 2.BC — Synthetic TWAI (CAN) RX responder

**Estado**: ✅ done — closes the TWAI loop. Phase 2.BA added frame
TX; this phase adds frame RX via a synthetic responder following
the same pattern as the BMP280 I2C and ILI9341 SPI responders.

A canned CAN frame (ID=0x456, DLC=3, data=[0xCA, 0xFE, 0x42]) is
pre-loaded into the RX buffer at boot. When guest reads the buffer
and writes CMD.RELEASE_RX to acknowledge, a `twai_rx` JSON event
fires AND the next frame in a rotating pattern auto-loads so
subsequent Arduino reads see fresh data.

Log proof (2026-05-08):
```json
{"t_ns":3851565,"event":"twai","id":291,"ext":false,"rtr":false,
 "dlc":2,"data":[222,173],"count":1}                     ← Phase 2.BA TX
{"t_ns":3874337,"event":"twai_rx","id":1110,"ext":false,"rtr":false,
 "dlc":3,"data":[202,254,66],"count":1}                  ← Phase 2.BC RX
```

Decoded RX event:
- `id=1110` = `0x456` ✓
- `dlc=3` ✓
- `data=[202,254,66]` = `[0xCA, 0xFE, 0x42]` ✓
- `ext=false` (standard frame)
- `count=1` (first frame consumed)

JSON event types now: **19** (added `twai_rx`).

## Goal

Phase 2.BA established the TWAI peripheral with TX path: guest
writes a frame to the TX buffer, fires CMD.TX_REQ, JSON event
emits. But:

1. **Reading frames was a no-op**: STATUS register always returned
   "RX buffer empty"; reads of the RX buffer at offsets 0x40..0x4D
   returned scratch (zero). Any Arduino sketch calling
   `twai_receive()` would block forever waiting for a frame that
   never arrives.

2. **No way to validate a complete Arduino CAN sketch**: TX-only
   means demos like "echo received frame back" or "filter incoming
   sensor frames" can't run.

Phase 2.BC closes the loop by injecting synthetic frames. Now an
Arduino sketch doing:

```c
twai_message_t msg;
if (twai_receive(&msg, pdMS_TO_TICKS(100)) == ESP_OK) {
    Serial.printf("RX: id=0x%X len=%d\n", msg.identifier, msg.data_length_code);
}
```

— will receive frame after frame from the synthetic responder.

## Lo que SE INVESTIGÓ

### 1. Synthetic responder pattern reuse

Three prior phases established the synthetic responder pattern:

- **Phase 2.AM.slave** (BMP280): I2C register table, tx_history-
  driven address inference, returns time-varying sensor data.
- **Phase 2.AU** (ILI9341): SPI last_cmd tracking, returns the
  expected response based on the command byte.
- **Phase 2.BC** (CAN RX): canned frame pre-loaded into RX buffer,
  STATUS bit lit, CMD.RELEASE_RX advances to next canned frame.

Each responds to a different "trigger" but the architectural
shape is the same: synthetic state pre-populated, guest accesses
exercise the response logic, JSON event documents the interaction.

### 2. RX buffer / TX buffer alias

Real SJA1000-derived TWAI hardware uses the SAME register window
(0x40..0x4D, 14 bytes) for both TX and RX buffers, with the mode
distinguishing which. For our skeleton:

- Writing to the buffer (and firing CMD.TX_REQ) emits a `twai` TX
  event.
- Reading from the buffer returns whatever bytes the LOAD_RX
  helper wrote there (the canned frame).
- CMD.RELEASE_RX is the "I'm done with the RX frame" trigger.

This means after Phase 2.BC's `load_rx_frame()`, the storage[]
bytes are overwritten. Any TX frame the guest is mid-loading
would be clobbered — but in real silicon, TX and RX in the same
window is a known constraint that real drivers handle by
serializing operations. Acceptable.

### 3. CAN standard frame encoding round-trip

The header now has BOTH encode and decode paths for the standard
frame ID:

```c
/* Encode (in load_rx_frame): */
storage[0x44] = (id >> 3) & 0xFF;
storage[0x45] = ((id & 0x7) << 5) | rtr_bit;

/* Decode (in emit_tx_event): */
id = ((uint32_t)b0 << 3) | ((b1 >> 5) & 0x7);
```

Validated by the boot test: TX self-test encodes ID=0x123, sees
the JSON event with id=291 (=0x123) ✓; RX self-test encodes
ID=0x456 via `load_rx_frame`, sees JSON event with id=1110 (=0x456) ✓.

### 4. STATUS.RX_BUFFER bit semantics

Per TRM 30.4.4, STATUS bit 0 is "Receive Buffer Status":
- 1 = RX buffer contains a frame ready to be read
- 0 = RX buffer is empty

Polling drivers (Arduino's `twai_get_status_info()`) check this
bit before reading. Phase 2.BC sets the bit in `load_rx_frame()`
and clears it in `emit_rx_event()` (which fires on RELEASE_RX),
matching real silicon's "you have a frame → you consumed it →
wait for next" cycle.

### 5. Rotating canned frame pattern

After a frame is consumed, `generate_next_rx()` synthesizes a new
one with:
```c
.id    = 0x456 + (rx_count & 0x1F),     /* cycles 0x456..0x475 */
.data  = {
    0xCA + (rx_count & 0xF),
    0xFE - (rx_count & 0xF),
    rx_count & 0xFF,
},
```

So subsequent polls see different frames — first frame
ID=0x456 data=[0xCA,0xFE,0x00], second ID=0x457 data=[0xCB,0xFD,0x01],
etc. Useful for validating that a real Arduino sketch can process
a stream of distinct frames, not just one.

### 6. No actual timer-driven new-frame injection

We could add a QEMUTimer that injects a frame every N seconds
regardless of guest activity. Deferred — the current pattern
("inject one on demand at RELEASE_RX") means demos work at the
guest's pace without flooding the JSON stream. A real CAN demo
typically polls in a loop, so the responder fires as fast as the
guest can RELEASE → matches realistic bus latency.

## Lo que SÍ funcionó

Live test (2026-05-08):

```
{"t_ns":3851565,"event":"twai","id":291,"ext":false,"rtr":false,
 "dlc":2,"data":[222,173],"count":1}
{"t_ns":3874337,"event":"twai_rx","id":1110,"ext":false,"rtr":false,
 "dlc":3,"data":[202,254,66],"count":1}
```

Both events fire from the same self-test. TX emits 23 µs before
RX (matches the self-test code order — TX first, then load+
release). Round-trip ID encoding correct for BOTH directions:
TX takes ID=0x123 from the test → bytes in storage → decode →
JSON id=291 ✓. RX takes ID=0x456 from the test → bytes in storage
via load_rx_frame → CMD.RELEASE_RX → JSON id=1110 ✓.

Build clean, no regression — other peripheral event counts
identical to Phase 2.BB within timing variance.

## Lo que NO funcionó / decisiones tomadas

1. **No time-driven frame injection**: the responder only
   delivers when the guest acknowledges the previous frame. A
   real bus would deliver frames asynchronously. Current pattern
   is sufficient for demos but doesn't capture "guest hasn't
   polled in a while" → "buffer overrun" scenarios. Documented
   as `2.BC.async`.

2. **STATUS register update isn't 1:1 with real silicon**: real
   STATUS has 8+ bits that interact with MODE register. We only
   touch bit 0 (RX_BUFFER). Other bits stay scratch. Acceptable —
   Arduino drivers mostly care about bit 0 and the IRQ register.

3. **No CMD.SELF_RX_REQ (loopback) modeling**: real silicon
   supports self-reception where TX frame appears on RX. Not
   modeled here — the synthetic responder fires its own canned
   frames, not echoed TX. Could add: if SELF_RX_REQ bit set,
   capture the just-transmitted frame as the next RX frame.
   Deferred.

4. **Rotating ID space is shallow**: only 32 distinct IDs
   (0x456..0x475 cycle). Most demos won't notice — but a sketch
   that tracks "unique IDs seen" would only see 32 max. Could be
   extended to 256 or driven by RNG.

5. **No extended-frame RX self-test**: only standard frame is
   exercised by boot self-test. Extended (29-bit) encode path
   exists in `load_rx_frame()` but unvalidated end-to-end. Easy
   to add when needed.

6. **No "STOLEN buffer" handling**: if guest reads buffer bytes
   while STATUS bit is 0 (no frame loaded), reads return zero
   (scratch). Real silicon would return stale data from a
   previous frame. Acceptable for skeleton.

## Lessons learned

1. **Responder pattern is now a stable template**: three
   different bus types (I2C, SPI, CAN) all use the same shape.
   Future buses (e.g., USB, parallel I2S) can follow the same
   pattern.

2. **Pre-loading storage[] from helper functions is cleaner than
   piecemeal writes**: `load_rx_frame()` writes the whole encoded
   frame in one shot. The self-test calls it once instead of doing
   the per-byte poking pattern from Phase 2.BA. More maintainable.

3. **The TX/RX buffer alias is a SJA1000 quirk**: real silicon
   uses the same register window for both, distinguished by mode.
   The skeleton mirrors this — `load_rx_frame` writes to the
   same offsets that TX reads from. A future Arduino driver
   sketch that interleaves TX and RX will need to handle this
   carefully on real hardware, so our model matching is realistic.

4. **Two phases for a peripheral pays off**: phase 2.BA (TX) →
   phase 2.BC (RX) is the natural split. TX-only is useful for
   debugging "did the chip transmit?"; RX adds "did the chip
   receive?" without complicating the TX path. Same pattern as
   I2C (2.AM master skeleton → 2.AM.slave responder) and SPI
   (2.AO master → 2.AU responder).

## Implementación final

### `include/hw/misc/esp32p4_twai.h`

- Added STATUS register bit defines: `RX_BUFFER`, `TX_COMPLETE`,
  `RX_STATUS`.
- Added `ESP32P4TwaiRxFrame` typedef (valid/ext/rtr/dlc/id/data).
- Added `rx_frame` + `rx_count` fields to `ESP32P4TwaiState`.

### `hw/misc/esp32p4_twai.c`

- New `esp32p4_twai_load_rx_frame()`: encodes frame into storage[]
  + sets STATUS.RX_BUFFER bit.
- New `esp32p4_twai_emit_rx_event()`: emits `twai_rx` JSON event,
  marks frame consumed, clears STATUS bit.
- New `esp32p4_twai_generate_next_rx()`: rotating-ID/data pattern
  for fresh frames after each consume.
- `esp32p4_twai_write()`: added `CMD.RELEASE_RX` handler that
  calls `emit_rx_event` → `generate_next_rx`.
- `esp32p4_twai_reset()`: zero `rx_count`, invalidate `rx_frame`.
- `esp32p4_twai_self_test()`: extended to also load + consume
  the boot RX frame (ID=0x456, data=[0xCA, 0xFE, 0x42]).

### No machine init changes

The existing `esp32p4_twai_self_test()` call in machine init now
exercises both TX and RX paths — no machine-side changes needed.

## Estado consolidado (post-2.BC)

JSON event types: **19** (added `twai_rx`).

```
start | pin | ledc | adc | timg | timg_irq | i2c | i2c_rx |
spi | spi_rx | wdt | rng | rtc_wdt | super_wdt | uart_tx |
uart_rx | rmt | twai | twai_rx
```

TWAI coverage matrix:

| Path  | Phase | JSON event | Validates |
|-------|-------|------------|-----------|
| TX    | 2.BA  | `twai`     | guest sends a frame |
| RX    | 2.BC  | `twai_rx`  | guest receives a frame |
| IRQ   | TBD   | (none)     | bus events trigger CPU IRQ |
| ERR   | TBD   | (none)     | error counters / bus-off |

## 37-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.AY  | RMT (WS2812 NeoPixel) skeleton                           |
| 2.AZ  | Multi-UART (UART1..UART4)                                |
| 2.BA  | TWAI (CAN bus) skeleton — TX path                        |
| 2.BB  | I2C1 + LP_UART (inventory complete)                      |
| **2.BC** | **Synthetic TWAI RX responder — bidirectional CAN** |

## Próximas direcciones

- **2.BC.timer**: time-driven RX frame injection (every N seconds)
  for async demos.
- **2.BC.async**: separate RX queue for guest "missed a frame"
  scenarios.
- **TWAI1 + TWAI2** instantiation following Phase 2.BB pattern.
- **WDT actual reset action** — close out watchdog chain.
- **Real PWM waveform on GPIO** via LEDC.
- **TWAI IRQ wiring** — INT_RAW + CPU dispatch.
- **FreeRTOS real port** (Phase 2.V deferred).
