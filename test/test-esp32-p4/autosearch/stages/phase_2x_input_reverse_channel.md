# Phase 2.X.input — Reverse channel: frontend → emulator GPIO input

**Estado**: ✅ done — `VELXIO_GPIO_INPUT=/path/to/fifo` env var opens
a fifo for reading. The frontend writes JSON-Lines with the same
schema as the output stream; the emulator parses each line and
forwards to `esp32p4_gpio_input_handler`. Verified end-to-end with
a script that injects 4 events and observes them in the output log.

## Goal

Close the loop **frontend → emulator**: complement Phase 2.X's
output stream with an input channel. When the user clicks a virtual
button on the velxio web UI, the click becomes a real pin-level
change inside the emulated chip (same path as the built-in fake
button or any external GPIO source).

This is the last piece for full bidirectional emulator ↔ web UI
communication around GPIO state.

## Lo que SE INVESTIGÓ

### 1. Transport choice: named pipe (fifo)

Considered:
- **Chardev backend**: QEMU's first-party mechanism, cleanest
  integration. Requires `-chardev` cmdline option + property
  binding. Heavier setup; the cmdline isn't trivially wrappable
  by the Velxio backend.
- **Unix socket server**: would need accept/connection state.
- **TCP socket**: portable but adds bind/port management.
- **Plain file polling**: trivially simple but adds latency
  (poll period).
- **Named pipe (mkfifo)**: zero-config, zero-latency, supported
  natively by `open(O_RDONLY|O_NONBLOCK)`, and the frontend can
  write with `echo '...' > $FIFO` from any language without
  needing QEMU-specific knowledge.

Chose fifo. Same env-var-gated pattern as the Phase 2.X output
log. Frontend creates the fifo with `mkfifo` before launching
QEMU; QEMU opens it for reading on machine init.

### 2. JSON schema (matches Phase 2.X output)

Each line is one JSON object:

```json
{"pin":N,"level":M}
```

- `pin`: 0..31 (GPIO number).
- `level`: 0 or 1 (low/high).

Same shape as Phase 2.X output records (minus `t_ns` — incoming
events are time-stamped at receipt). Symmetric schema makes
proxying trivial: a frontend can record output events and replay
them back later just by piping `cat output.log | grep -v event > fifo`.

### 3. Non-blocking + reopen-on-EOF

`open(path, O_RDONLY | O_NONBLOCK)` on a fifo with no writer
**succeeds immediately** (POSIX behaviour for read side; only
write side returns ENXIO). The fd is valid and readable; reads
return 0 if no data. The QEMU main loop polls the fd via
`qemu_set_fd_handler`.

When a writer connects (`echo > fifo`), the read returns the
written bytes. When the writer closes its end, the next read
returns 0 (EOF) — at which point the fd needs to be closed and
reopened so a *new* writer can connect later. The
`esp32p4_gpio_input_reopen()` helper handles this cleanly: it
re-opens the fifo and re-registers the fd handler.

### 4. Line accumulator across partial reads

JSON events are line-delimited but a single `read()` may return:
- A partial line (frontend wrote slowly).
- Multiple complete lines.
- A complete line plus a partial line.

Solution: per-state `input_buf[512]` accumulator and `input_len`
cursor. After each read, we scan for `\n`, parse complete lines,
slide the partial leftover back to buffer start. Standard
line-buffered input pattern.

### 5. Parsing strategy

Used `sscanf(line, " { \"pin\" : %d , \"level\" : %d", &pin, &level)`.
Tolerant of whitespace around `{`/`:`/`,`, but strict about quoted
field names — frontend formats per the documented schema.

Considered using a real JSON parser (cJSON, jansson) but that
would pull in a build dependency for what's a trivial format.
sscanf with strict-quote pattern is sufficient.

## Lo que SÍ funcionó

End-to-end test (see `autosearch/scripts/test_input_channel.sh`):

1. `mkfifo /tmp/velxio-input.fifo`
2. Launch QEMU with `VELXIO_GPIO_INPUT=/tmp/velxio-input.fifo` and
   `VELXIO_GPIO_LOG=/tmp/velxio-gpio.jsonl`.
3. Inject 4 events from a separate shell (with 500ms gaps):
   ```
   {"pin":8,"level":1}
   {"pin":12,"level":1}
   {"pin":8,"level":0}
   {"pin":12,"level":0}
   ```
4. Verify each event appears in `/tmp/velxio-gpio.jsonl` with
   correct timestamps and pin numbers.

QEMU stderr:
```
[esp32p4.gpio] event log opened: /tmp/velxio-gpio.jsonl
[esp32p4.gpio] input fifo opened: /tmp/velxio-input.fifo
[esp32p4] machine init complete ...
Hello from QEMU ESP32-P4!
[esp32p4.gpio] pin 5 -> 1                ← guest output continues
[esp32p4.gpio] pin 8 -> 1                ← FRONTEND INJECTION
[esp32p4.gpio] pin 12 -> 1               ← FRONTEND INJECTION
[esp32p4.gpio] pin 8 -> 0                ← FRONTEND INJECTION
[esp32p4.gpio] pin 12 -> 0               ← FRONTEND INJECTION
... (more guest output)
```

JSON log capture (only the frontend-injected pins shown):
```
{"t_ns":1363840691,"pin":8,"level":1}
{"t_ns":1867674014,"pin":12,"level":1}
{"t_ns":2371045580,"pin":8,"level":0}
{"t_ns":2873016041,"pin":12,"level":0}
```

The 503ms / 503ms / 502ms gaps between events match the `sleep 0.5`
intervals in the test script — confirming wall-clock-accurate
delivery.

Pins 8 and 12 are NEVER touched by the guest's running-light blob
(which uses pins 5/6/7) or the fake button (which uses pin 0). They
appear in the output log because and only because the frontend
injected them. **Bidirectional channel verified.**

## Lo que NO funcionó (descartado durante diseño)

1. **`O_RDWR` to keep fifo "always alive"**: would let us never
   need to reopen on EOF. Rejected because read on a fifo opened
   `O_RDWR` with no other writers reads back the writer side
   buffer (mostly empty) — confusing semantics.

2. **Pre-fill `input_buf` with last partial line on EOF**: would
   risk parsing stale data that was supposed to be discarded
   when the writer disconnected. Reset is safer.

3. **Real JSON parser (jansson)**: would be more robust to
   reordered fields, optional fields, etc. Skipped — strict
   schema is fine for a tightly-coupled frontend.

## Lessons learned

1. **Fifo + non-blocking open is the simplest IPC for line-
   delimited streams**: zero config on either side, no port
   numbers, no socket handshake, just `mkfifo` and write.

2. **`qemu_set_fd_handler` integrates fd-based I/O cleanly with
   QEMU's main loop**: no threads needed. The handler runs on the
   main loop thread, so it can call device functions directly
   (no mutex acquisition).

3. **Reopen-on-EOF is the standard fifo idiom** for long-lived
   readers. Without it, after the first writer disconnects, the
   reader sees infinite EOFs and can't accept future writers.

4. **Line accumulator pattern is mandatory for read-from-fd**:
   never assume `read()` returns whole lines. The `\n`-scan +
   memmove pattern handles partial reads correctly.

5. **Symmetric I/O schema enables tooling**: making the input
   schema a subset of the output schema means the same code can
   parse, log, replay, mutate. Good design hygiene.

## Implementación final

### `include/hw/gpio/esp32p4_gpio.h`

Added 4 fields:
- `int  input_fd;`            — current fifo fd or -1.
- `char input_path[256];`     — saved for reopen-on-EOF.
- `char input_buf[512];`      — line accumulator.
- `int  input_len;`           — current accumulator length.

### `hw/gpio/esp32p4_gpio.c`

- `esp32p4_gpio_input_fd_read`: fd-handler. Reads available
  bytes, scans for `\n`, parses each complete line, forwards via
  `esp32p4_gpio_input_handler`.
- `esp32p4_gpio_input_reopen`: closes current fd, opens fresh
  `O_RDONLY|O_NONBLOCK`, re-registers fd handler.
- `esp32p4_gpio_realize`: when `VELXIO_GPIO_INPUT` is set, copy
  the path into `input_path[]` and call `_input_reopen` to start
  listening.

### `autosearch/scripts/test_input_channel.sh`

End-to-end test: mkfifo, launch QEMU, inject 4 events with 500ms
gaps, verify output log. Useful for regression testing and
demonstration.

## Estado consolidado (post-2.X.input)

| Hito                                              | Estado       |
|---------------------------------------------------|--------------|
| GPIO output (running light)                       | ✅           |
| GPIO input (fake button + ENABLE-gated)           | ✅           |
| **JSON event log** (Phase 2.X)                    | ✅           |
| **JSON input fifo** (Phase 2.X.input)             | ✅           |
| **Bidirectional emulator ↔ frontend channel**     | ✅ Phase 2.X.input |
| Real SYSTIMER-based delays                        | ⏳ Phase 2.Y |
| Pin-transition GPIO interrupts                    | ⏳ Phase 2.Z |
| Real FreeRTOS port (unblocks setup()/loop())      | ⏳ Phase 2.V |

## Próximas fases

- **Phase 2.Y**: replace busy-wait delay in the running-light
  blob with `SYSTIMER_UNIT0_VALUE_LO/HI` reads. Determines
  consistent timing across host CPUs.

- **Phase 2.Z**: pin-transition GPIO interrupts (RISING/FALLING/
  LEVEL) routed through the interrupt matrix to the CPU. Lets
  Arduino's `attachInterrupt(pin, ISR, RISING)` work end-to-end —
  e.g., the user clicks a virtual button on the frontend → fifo
  → input pad → interrupt matrix → CLIC → IDF handler → user ISR.
