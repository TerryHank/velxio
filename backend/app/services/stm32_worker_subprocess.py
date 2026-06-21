#!/usr/bin/env python3
"""stm32_worker_subprocess.py — QEMU subprocess wrapper for STM32 simulation.
Uses standard QEMU machines (UART -> stdio) for full serial output."""

import base64, json, os, subprocess, sys, tempfile, threading, time

QEMU_BIN = "/tmp/qemu-stm32/build-pic/qemu-system-arm"

def _emit(evt: dict) -> None:
    sys.stdout.write(json.dumps(evt) + "\n")
    sys.stdout.flush()

def main():
    raw = sys.stdin.readline()
    if not raw.strip():
        os._exit(1)
    cfg = json.loads(raw)
    firmware_b64 = cfg["firmware_b64"]
    machine = cfg.get("machine", "stm32-f103c8")

    try:
        fw_bytes = base64.b64decode(firmware_b64)
        tmp = tempfile.NamedTemporaryFile(suffix=".elf", delete=False)
        tmp.write(fw_bytes)
        tmp.close()
        fw_path = tmp.name
    except Exception as e:
        _emit({"type": "error", "message": f"Firmware decode: {e}"})
        os._exit(1)

    _emit({"type": "system", "event": "booting"})
    proc = subprocess.Popen(
        [QEMU_BIN, "-M", machine, "-nographic", "-kernel", fw_path],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )

    stop = threading.Event()
    uart_buf = bytearray()

    def read_output(stream, tag):
        try:
            for raw_line in stream:
                if stop.is_set():
                    break
                text = raw_line.decode("utf-8", errors="replace")
                for ch in text:
                    uart_buf.append(ord(ch))
                    if ch == '\n' and len(uart_buf) > 0:
                        data = bytes(uart_buf).decode("utf-8", errors="replace").rstrip()
                        uart_buf.clear()
                        if data:
                            _emit({"type": "serial_output", "data": data, "uart": 0})
        except Exception:
            pass

    threading.Thread(target=read_output, args=(proc.stdout, "out"), daemon=True).start()
    threading.Thread(target=read_output, args=(proc.stderr, "err"), daemon=True).start()

    time.sleep(1.5)
    if proc.poll() is not None:
        _emit({"type": "error", "message": "QEMU exited early"})
        os._exit(1)

    _emit({"type": "system", "event": "booted"})

    try:
        for raw_line in sys.stdin:
            raw_line = raw_line.strip()
            if not raw_line:
                continue
            try:
                cmd = json.loads(raw_line)
            except Exception:
                continue
            if cmd.get("cmd") == "stop":
                break
    finally:
        stop.set()
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
        if uart_buf:
            data = bytes(uart_buf).decode("utf-8", errors="replace").rstrip()
            if data:
                _emit({"type": "serial_output", "data": data, "uart": 0})
        try:
            os.unlink(fw_path)
        except OSError:
            pass

if __name__ == "__main__":
    main()
