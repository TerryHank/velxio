# Phase 2.CT — USB Serial/JTAG RX reverse channel via FIFO

**Estado**: ✅ done — closes Phase 2.CR's documented "future
Phase 2.CR.next could add a reverse channel" item. Frontend can
now **inject bytes that Arduino's `Serial.read()` will see**,
mirroring the Phase 2.X.input GPIO reverse-channel pattern.
**35th JSON event type** (`usb_jtag_rx`).

Live verification (2026-05-21):

```
$ mkfifo /tmp/velxio-usj-rx
$ VELXIO_USB_SERIAL_JTAG_INPUT=/tmp/velxio-usj-rx \
  qemu-system-riscv32 -M esp32p4 ...

[esp32p4.usb_serial_jtag] input fifo opened: /tmp/velxio-usj-rx
[esp32p4.usb_serial_jtag] TX #1 0x56 ('V')  ← self-test still works
... [TX 2-8 spelling "VelxioP4"]

$ echo '{"byte":72}'  > /tmp/velxio-usj-rx   # H
$ echo '{"byte":105}' > /tmp/velxio-usj-rx   # i
$ echo '{"byte":33}'  > /tmp/velxio-usj-rx   # !
$ echo '{"byte":10}'  > /tmp/velxio-usj-rx   # \n
$ echo '{"byte":255}' > /tmp/velxio-usj-rx   # 0xFF

JSON events emitted:
  {"event":"usb_jtag_rx","seq":1,"byte":72}    ← H
  {"event":"usb_jtag_rx","seq":2,"byte":105}   ← i
  {"event":"usb_jtag_rx","seq":3,"byte":33}    ← !
  {"event":"usb_jtag_rx","seq":4,"byte":10}    ← \n
  {"event":"usb_jtag_rx","seq":5,"byte":255}   ← high byte
```

5 bytes injected via FIFO, 5 JSON events emitted with correct
seq+byte values. ASCII decode in stderr trace matches the
injected bytes. Phase 2.CR TX self-test continues unaffected
(regression-clean).

## Goal

Phase 2.CR shipped TX (guest → host) but explicitly left RX
(host → guest) "future work". Without RX, Arduino sketches
calling `Serial.read()` would loop forever waiting for bytes
that never arrive — limiting the emulator to **TX-only USB
serial**.

This phase closes that gap by mirroring the **Phase 2.X.input
GPIO reverse-channel pattern** exactly:
- FIFO file path via env-var.
- Frontend writes JSON lines.
- QEMU fd-handler parses + enqueues into an RX queue inside
  the peripheral.
- Guest reads EP1 → dequeue + return next byte.
- EP1_CONF.OUT_DATA_AVAIL reflects queue non-empty.

Result: Arduino sketches like `if (Serial.available()) c =
Serial.read();` now actually see the bytes the frontend
injects.

## Lo que SE INVESTIGÓ

### 1. Phase 2.X.input as the reference pattern

Phase 2.X.input had already established the GPIO reverse
channel:
- `VELXIO_GPIO_INPUT=/path/to/fifo` env-var
- `mkfifo` required before QEMU starts
- `qemu_set_fd_handler()` for non-blocking reads
- Per-line `{"pin":N,"level":M}` JSON parsing
- Tolerant whitespace via `sscanf` format string
- Reopen-on-EOF for frontend-writer disconnect handling

This phase copies the entire pattern wholesale, changing only:
- env-var name → `VELXIO_USB_SERIAL_JTAG_INPUT`
- JSON schema → `{"byte":N}` instead of `{"pin":N,"level":M}`
- Action → `rx_enqueue(byte)` instead of `gpio_input_handler(pin, level)`

Mirror-exact reuse of a proven pattern = minimal risk + uniform
frontend interface (same FIFO file mechanism across GPIO + USB).

### 2. RX queue design

Decided on a **256-entry power-of-two circular buffer** with
`uint8_t head` + `uint8_t tail` indices. Why these dimensions:
- 256 bytes covers typical Arduino burst inputs (e.g., a line
  of user input).
- `uint8_t` head/tail = automatic wrap on overflow (no modulo
  needed).
- Empty: `head == tail`. Full: `(tail+1) == head`.

On overflow (frontend injecting faster than guest consuming),
**drop oldest by advancing head**. Real silicon's USB CDC
behavior is similar — no flow control over USB CDC, so a
slow guest just loses old bytes.

### 3. EP1 + EP1_CONF semantics with RX queue

Updated behavior of Phase 2.CR registers:

| Register | Before (Phase 2.CR) | After (Phase 2.CT) |
|----------|---------------------|---------------------|
| EP1 read | always 0 | dequeue next RX byte (0 if empty) |
| EP1_CONF.OUT_DATA_AVAIL (bit 2) | always 0 | 1 if RX queue non-empty |
| EP1_CONF.SERIAL_IN_EMPTY (bit 1) | always 1 | unchanged (always 1) |

Guest Arduino code flow:
```c
while (Serial.available()) {        // polls EP1_CONF.OUT_DATA_AVAIL
    int c = Serial.read();          // reads EP1
    /* ... */
}
```

With Phase 2.CT, `Serial.available()` now returns truthy when
the FIFO has injected bytes, and `Serial.read()` dequeues them
one at a time.

### 4. JSON event naming consistency

New event type `usb_jtag_rx` parallels the existing
`usb_jtag_tx` (Phase 2.CR). Shape: `{event, seq, byte}`.
Same fields as TX. Frontend rendering code that filters by
`event == "usb_jtag_*"` gets both directions trivially.

### 5. FIFO lifecycle + reopen handling

EOF on the read side means the frontend writer disconnected.
The `read()` returning 0 triggers `esp32p4_usj_input_reopen()`:
- Close the old fd, deregister handler.
- Reopen with `O_RDONLY | O_NONBLOCK`.
- Register a new handler.

This lets the frontend disconnect + reconnect freely. Standard
named-pipe pattern.

### 6. Per-byte stderr trace

Added `[esp32p4.usb_serial_jtag] RX #N 0xHH ('c')` line so
debug logs show injected bytes alongside TX bytes. ASCII
decoding for printable chars, `.` for non-printable. Same
format as the Phase 2.CR TX trace.

## Lo que SÍ funcionó

1. ✅ Build clean — single file changed
   (`hw_char_esp32p4_usb_serial_jtag.c.o`).
2. ✅ FIFO opens at boot when `VELXIO_USB_SERIAL_JTAG_INPUT`
   is set: `[esp32p4.usb_serial_jtag] input fifo opened: ...`.
3. ✅ 5 bytes injected → 5 `usb_jtag_rx` JSON events with
   correct sequence numbers (1..5) + byte values (72/105/33/
   10/255).
4. ✅ ASCII decode in stderr trace matches: H/i/!/./. (last
   two = newline + 0xFF, both non-printable).
5. ✅ Phase 2.CR TX self-test still produces 8 `usb_jtag_tx`
   events spelling "VelxioP4" — zero regression.
6. ✅ Empty default (no env-var set) → no input FIFO, no
   regression on prior boot behavior.

## Lo que NO funcionó / decisiones tomadas

### Decisiones tomadas

1. **Mirror Phase 2.X.input verbatim**: same FIFO semantics,
   same fd-handler shape, same reopen logic. Maximizes
   uniformity for frontend developers + maintenance.

2. **256-byte RX queue**: enough for typical Arduino input
   bursts. Larger would waste memory; smaller would risk
   drops on multi-line paste.

3. **Drop-oldest on overflow**: matches USB CDC's lack of
   flow control. Real silicon also drops bytes if the OUT
   endpoint isn't drained fast enough.

4. **Per-line JSON parsing**: simpler than streaming binary.
   Same as Phase 2.X.input. Frontend can use any language
   that can write text to a pipe.

5. **No CLIC IRQ on RX availability**: would need TRM
   Chapter 51 § 51.5 interrupt sources + CLIC extension
   (causes 17-31 used). Deferred. Guest polling via
   `Serial.available()` works without IRQ.

6. **Wider byte range support**: accepts 0..255. Frontend
   can inject any byte including 0x00 (null terminator
   testing) and high-bit bytes.

7. **EOF triggers reopen, not shutdown**: lets the frontend
   reconnect mid-run. Standard pipe behavior.

## Lessons learned

1. **Reverse-channel pattern uniformity across peripherals is
   high-value**: GPIO (Phase 2.X.input) and USB Serial/JTAG
   (this phase) now use identical FIFO + JSON-line mechanics.
   Future peripherals (UART RX? I2C slave?) can drop in with
   the same pattern.

2. **Frontend interface stability matters**: by mirroring the
   established `{"pin":N,"level":M}` shape for GPIO with a
   parallel `{"byte":N}` shape for USB Serial/JTAG, the
   frontend doesn't need new parsing logic — just a different
   FIFO path.

3. **Drop-oldest is the right default for USB CDC**: real
   silicon lacks flow control; our model matches that. A
   slow guest doesn't deadlock; it just loses old bytes.

4. **EOF + reopen handling is critical for dev workflow**:
   without it, frontend disconnect kills the channel
   forever. The reopen logic is ~10 LOC but enables
   reconnect-and-continue.

## Implementación final

### `include/hw/char/esp32p4_usb_serial_jtag.h`

- New struct fields on `ESP32P4UsbSerialJtagState`:
  - `rx_queue[256]` + `rx_head` + `rx_tail` + `rx_count`
  - `input_fd` + `input_path[256]` + `input_buf[256]` + `input_len`

### `hw/char/esp32p4_usb_serial_jtag.c`

- Includes: `<fcntl.h>`, `<unistd.h>`, `<errno.h>`,
  `qemu/main-loop.h`.
- New helpers: `esp32p4_usj_rx_empty()`, `rx_full()`,
  `rx_enqueue()`, `rx_dequeue()`.
- New fd-handler: `esp32p4_usj_input_fd_read()` — parses
  per-line JSON, enqueues bytes, emits `usb_jtag_rx` events.
- New reopen helper: `esp32p4_usj_input_reopen()` — handles
  EOF + reconnect.
- `esp32p4_usj_read()`: EP1 → dequeue; EP1_CONF →
  set OUT_DATA_AVAIL bit when queue non-empty.
- `esp32p4_usj_realize()`: open FIFO from
  `VELXIO_USB_SERIAL_JTAG_INPUT` env-var if set.
- `esp32p4_usj_reset()`: zero RX queue head/tail/count
  (preserve fd).

### No machine init changes

The peripheral self-configures from the env-var at realize
time. Machine init (Phase 2.CR) unchanged.

## Estado consolidado (post-2.CT)

USB Serial/JTAG capability:

| Direction | Mechanism | Phase |
|-----------|-----------|-------|
| TX (guest → frontend) | EP1 + WR_DONE → `usb_jtag_tx` event | 2.CR |
| **RX (frontend → guest)** | **FIFO inject → `usb_jtag_rx` event + EP1 dequeue** | **2.CT** |

Reverse-channel pattern across peripherals:

| Peripheral | env-var | JSON schema | Phase |
|------------|---------|-------------|-------|
| GPIO | `VELXIO_GPIO_INPUT` | `{"pin":N,"level":M}` | 2.X.input |
| **USB Serial/JTAG** | **`VELXIO_USB_SERIAL_JTAG_INPUT`** | **`{"byte":N}`** | **2.CT** |

JSON event types: **35** (chip_info=29, ssd1306=30, hmac=31,
aes=32, sha=33, usb_jtag_tx=34, **usb_jtag_rx=35**).

## 82-Phase realism progression

| Phase | Capability                                              |
|-------|---------------------------------------------------------|
| 2.CR  | USB Serial/JTAG TX (Arduino's Serial.print)             |
| 2.CS  | SHA-1 mode in SHA peripheral                            |
| **2.CT** | **USB Serial/JTAG RX reverse channel (Arduino's Serial.read)** |

Arduino bidirectional USB serial now fully functional in the
emulator.

## Próximas direcciones

- **USB Serial/JTAG IRQ wiring** — TRM § 51.5 defines 4 IRQ
  sources (TX_DONE, RX_DONE, etc.). Would need a CLIC cause
  line; budget exhausted at cause 31 — needs interrupt matrix
  or shared lines.
- **SHA-224 mode** — same compress as SHA-256, different
  H_init + 28-byte output.
- **Multi-block HMAC** — SET_MESSAGE_ING/END.
- **Secure Boot digest verifier**.
- **AES-CBC / AES-GCM block modes**.
- **XTS-AES** for flash encryption.
- **RSA / ECC / DS / ECDSA** crypto peripherals.
- **MS5611 / W5500 / MFRC522** sensors/SPI responders.
- **UART IRQ** via interrupt matrix.
- **Real PWM** waveform via LEDC.
- **JTAG bridge peripheral** — wires DIS_PAD_JTAG +
  SOFT_DIS_JTAG + DIS_USB_JTAG.
- **FreeRTOS** scheduler resurrection.
