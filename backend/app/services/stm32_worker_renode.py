#!/usr/bin/env python3
"""Renode STM32 worker for STM32F103 Blue Pill style boards.

This worker is intentionally controlled through Renode's Robot Remote server.
On Windows, Renode 1.16's ``--console`` stdin/stdout path is not reliable
enough for Velxio's long-running websocket bridge: startup scripts may not run,
monitor commands may not be consumed, and UART analyzer text may never reach
stdout. The Robot Remote keywords are the same control path Renode's own STM32
tests use, so GPIO input, GPIO register polling, and UART terminal operations
are all executed through structured XML-RPC calls.
"""

import base64
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import xmlrpc.client
from pathlib import Path
from typing import Any


_RENODE_BIN = os.environ.get("RENODE_BIN", "/opt/renode/renode")
_REPL_DIR = Path(__file__).resolve().parent / "renode"

# Keep XML-RPC calls from hanging the worker indefinitely if Renode dies. Renode
# cold start on Windows can spend several seconds inside get_keyword_names().
socket.setdefaulttimeout(float(os.environ.get("RENODE_RPC_TIMEOUT", "8.0")))

_PIN_MAP: dict[int, tuple[str, int]] = {}
for i in range(16):
    _PIN_MAP[i] = ("sysbus.gpioPortA", i)
for i in range(16):
    _PIN_MAP[16 + i] = ("sysbus.gpioPortB", i)
for i in range(16):
    _PIN_MAP[32 + i] = ("sysbus.gpioPortC", i)

_GPIO_READS = [
    ("A", "sysbus.gpioPortA", 0, "CRL", 0x40010800),
    ("A", "sysbus.gpioPortA", 0, "CRH", 0x40010804),
    ("A", "sysbus.gpioPortA", 0, "ODR", 0x4001080C),
    ("B", "sysbus.gpioPortB", 16, "CRL", 0x40010C00),
    ("B", "sysbus.gpioPortB", 16, "CRH", 0x40010C04),
    ("B", "sysbus.gpioPortB", 16, "ODR", 0x40010C0C),
    ("C", "sysbus.gpioPortC", 32, "CRL", 0x40011000),
    ("C", "sysbus.gpioPortC", 32, "CRH", 0x40011004),
    ("C", "sysbus.gpioPortC", 32, "ODR", 0x4001100C),
]

_BLUEPILL_DIGITAL_TO_LINEAR = [
    25, 24, 23, 22, 21, 20, 19, 15, 12, 11, 10, 9, 8, 31, 30, 29, 28,
    45, 46, 47, 0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 26, 27, 18, 13, 14,
]
_BLUEPILL_ANALOG_TO_DIGITAL = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29]
_STM32DUINO_ANALOG_BASE = 0xC0
_STM32DUINO_ANALOG_INDEX = 0x3F

_UINT_RE = re.compile(r"0x[0-9A-Fa-f]+|\b\d+\b")
_STM32_SERIAL_WRITE_SYMBOLS = [
    "_ZN24VelxioRenodeUsart2Serial5writeEh",
]
_STM32_PWM_WRITE_SYMBOLS = [
    "VelxioRenodeAnalogWrite",
]
_STM32_SPI_TRANSFER_SYMBOLS = [
    "_ZN8SPIClass8transferEh",
]
_STM32_DIGITAL_WRITE_TRACE_SYMBOLS = [
    "VelxioRenodeDigitalWriteTrace",
]
_STM32_DIGITAL_WRITE_SYMBOLS = [
    "_ZL24VelxioRenodeDigitalWritemi",
]
_STM32_I2C_BEGIN_SYMBOLS = [
    "_ZN7TwoWire17beginTransmissionEh",
]
_STM32_I2C_WRITE_SYMBOLS = [
    "_ZN7TwoWire5writeEh",
]
_STM32_I2C_END_SYMBOLS = [
    "_ZN7TwoWire15endTransmissionEh",
]
_STM32_ADC_RAW_VALUE_SYMBOLS = [
    "VelxioRenodeAdcRawValues",
]
_STM32_ADC_CONFIGURED_SYMBOLS = [
    "VelxioRenodeAdcConfigured",
]


def _find_free_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _is_pass(response: Any) -> bool:
    return isinstance(response, dict) and response.get("status") == "PASS"


def _response_text(response: Any) -> str:
    if isinstance(response, dict):
        value = response.get("return", "")
        return "" if value is None else str(value)
    return "" if response is None else str(response)


def _parse_u32(text: str) -> int | None:
    match = _UINT_RE.search(text or "")
    if not match:
        return None
    token = match.group(0)
    try:
        return int(token, 16 if token.lower().startswith("0x") else 10) & 0xFFFFFFFF
    except ValueError:
        return None


def _linear_pin_name(pin: int) -> str:
    port = pin // 16
    bit = pin % 16
    if 0 <= port <= 6 and 0 <= bit <= 15:
        return f"P{chr(ord('A') + port)}{bit}"
    return f"PIN{pin}"


def _normalize_stm32duino_pin(pin: int) -> int:
    """Map STM32duino Blue Pill pin numbers/analog aliases to Velxio linear GPIO."""
    pin = int(pin)
    if (pin & _STM32DUINO_ANALOG_BASE) == _STM32DUINO_ANALOG_BASE:
        analog_index = pin & _STM32DUINO_ANALOG_INDEX
        if 0 <= analog_index < len(_BLUEPILL_ANALOG_TO_DIGITAL):
            digital_pin = _BLUEPILL_ANALOG_TO_DIGITAL[analog_index]
            return _BLUEPILL_DIGITAL_TO_LINEAR[digital_pin]
    if 0 <= pin < len(_BLUEPILL_DIGITAL_TO_LINEAR):
        return _BLUEPILL_DIGITAL_TO_LINEAR[pin]
    return pin


def _is_stm32_adc_linear_pin(pin: int) -> bool:
    port = pin // 16
    bit = pin % 16
    return (
        (port == 0 and 0 <= bit <= 7)
        or (port == 1 and bit in (0, 1))
        or (port == 2 and 0 <= bit <= 5)
    )


def _elf_symbol_address(path: str, names: list[str]) -> int | None:
    """Return a symbol value from a 32-bit ELF file without shelling out to nm."""
    try:
        data = Path(path).read_bytes()
    except Exception:
        return None
    if len(data) < 52 or data[:4] != b"\x7fELF" or data[4] != 1:
        return None
    endian = "<" if data[5] == 1 else ">" if data[5] == 2 else None
    if endian is None:
        return None

    import struct

    try:
        e_shoff = struct.unpack_from(endian + "I", data, 32)[0]
        e_shentsize = struct.unpack_from(endian + "H", data, 46)[0]
        e_shnum = struct.unpack_from(endian + "H", data, 48)[0]
    except Exception:
        return None
    if e_shoff <= 0 or e_shentsize < 40 or e_shnum <= 0:
        return None

    sections: list[dict[str, int]] = []
    for index in range(e_shnum):
        off = e_shoff + index * e_shentsize
        if off + 40 > len(data):
            return None
        try:
            (
                _sh_name,
                sh_type,
                _sh_flags,
                _sh_addr,
                sh_offset,
                sh_size,
                sh_link,
                _sh_info,
                _sh_addralign,
                sh_entsize,
            ) = struct.unpack_from(endian + "IIIIIIIIII", data, off)
        except Exception:
            return None
        sections.append({
            "type": sh_type,
            "offset": sh_offset,
            "size": sh_size,
            "link": sh_link,
            "entsize": sh_entsize,
        })

    wanted = set(names)
    for section in sections:
        if section["type"] not in (2, 11):  # SHT_SYMTAB / SHT_DYNSYM
            continue
        entsize = section["entsize"] or 16
        if entsize < 16:
            continue
        str_index = section["link"]
        if str_index < 0 or str_index >= len(sections):
            continue
        str_section = sections[str_index]
        str_start = str_section["offset"]
        str_end = str_start + str_section["size"]
        if str_start < 0 or str_end > len(data):
            continue
        strings = data[str_start:str_end]
        sym_start = section["offset"]
        sym_end = sym_start + section["size"]
        if sym_start < 0 or sym_end > len(data):
            continue
        for off in range(sym_start, sym_end, entsize):
            if off + 16 > len(data):
                break
            st_name, st_value, _st_size, _st_info, _st_other, _st_shndx = struct.unpack_from(
                endian + "IIIBBH", data, off
            )
            if st_name <= 0 or st_name >= len(strings) or st_value == 0:
                continue
            end = strings.find(b"\x00", st_name)
            if end < 0:
                continue
            try:
                name = strings[st_name:end].decode("ascii")
            except Exception:
                continue
            if name in wanted:
                # ARM EABI uses bit0 in function symbol values to mark Thumb
                # entry points. Renode CPU hooks expect the real instruction
                # address, so clear that marker bit.
                return int(st_value) & ~1
    return None
    token = match.group(0)
    try:
        return int(token, 16 if token.lower().startswith("0x") else 10) & 0xFFFFFFFF
    except ValueError:
        return None


class RenodeWorker:
    def __init__(self) -> None:
        self._proc: subprocess.Popen | None = None
        self._robot: xmlrpc.client.ServerProxy | None = None
        self._robot_lock = threading.RLock()
        self._running = False
        self._booted = False
        self._exit_emitted = False

        self._fw: str | None = None
        self._repl: str | None = None
        self._renode_home: tempfile.TemporaryDirectory[str] | None = None
        self._uart_hook_file: Path | None = None
        self._uart_hook_offset = 0
        self._pwm_hook_file: Path | None = None
        self._pwm_hook_offset = 0
        self._spi_hook_file: Path | None = None
        self._spi_hook_offset = 0
        self._spi_hook_pending = b""
        self._i2c_hook_file: Path | None = None
        self._i2c_hook_offset = 0
        self._i2c_hook_pending = b""
        self._i2c_tx_addr: int | None = None
        self._i2c_tx_bytes = bytearray()
        self._adc_values_addr: int | None = None
        self._adc_configured_addr: int | None = None
        self._adc_values: dict[int, int] = {}

        self._last_odr: dict[int, int] = {}
        self._gpio_regs: dict[tuple[int, str], int] = {}
        self._last_internal_inputs: dict[int, bool] = {}
        self._external_pins: set[int] = set()
        self._next_gpio_read_index = 0
        self._serial_emit_lock = threading.Lock()
        self._recent_serial_emits: list[tuple[float, tuple[int, str]]] = []
        self._initial_pins: list[tuple[int, str, int, bool]] = []
        self._initial_adc: list[dict[str, Any]] = []
        self._sensors: dict[int, dict[str, Any]] = {}
        self._sensors_lock = threading.RLock()
        self._debug_gpio = os.environ.get("VELXIO_STM32_DEBUG_GPIO") == "1"
        self._last_gpio_debug_emit = 0.0
        self._gpio_debug_started = False
        self._gpio_debug_raw_count = 0

    def _emit(self, msg: dict) -> None:
        sys.stdout.write(json.dumps(msg) + "\n")
        sys.stdout.flush()

    def init(
        self,
        machine: str,
        fw_b64: str,
        initial_pins: list[dict] | None = None,
        sensors: list[dict] | None = None,
        initial_adc: list[dict] | None = None,
    ) -> None:
        repl_path = _REPL_DIR / machine
        if not repl_path.exists():
            self._emit({"type": "error", "data": {"message": f"Platform not found: {machine}"}})
            return

        try:
            firmware = base64.b64decode(fw_b64)
            with tempfile.NamedTemporaryFile(suffix=".elf", delete=False) as fw:
                fw.write(firmware)
            self._fw = fw.name
            self._repl = str(repl_path)
            self._initial_pins = self._normalize_initial_pins(initial_pins or [])
            self._initial_adc = [dict(item) for item in initial_adc or [] if isinstance(item, dict)]
            self._adc_values = {}
            for item in self._initial_adc:
                normalized = self._normalize_adc_value(item)
                if normalized is not None:
                    pin, raw = normalized
                    self._adc_values[pin] = raw
            with self._sensors_lock:
                self._sensors = {}
                for sensor in sensors or []:
                    try:
                        pin = int(sensor.get("pin", 0))
                    except Exception:
                        continue
                    self._sensors[pin] = dict(sensor)
            self._emit({"type": "system", "data": {"event": "booting"}})
        except Exception as exc:
            self._emit({"type": "error", "data": {"message": str(exc)}})

    def run(self) -> None:
        if not self._fw or not self._repl:
            self._emit({"type": "error", "data": {"message": "Not initialized"}})
            return

        try:
            self._start_renode_remote()
            self._setup_machine()
        except Exception as exc:
            self._emit({"type": "error", "data": {"message": f"Renode startup failed: {exc}"}})
            self.stop()
            return

        self._running = True
        self._booted = True
        self._emit({"type": "system", "data": {"event": "booted"}})

        threading.Thread(target=self._process_watchdog, daemon=True).start()
        threading.Thread(target=self._uart_hook_file_reader, daemon=True).start()
        threading.Thread(target=self._pwm_hook_file_reader, daemon=True).start()
        threading.Thread(target=self._spi_hook_file_reader, daemon=True).start()
        threading.Thread(target=self._i2c_hook_file_reader, daemon=True).start()
        threading.Thread(target=self._gpio_poller, daemon=True).start()

    def stop(self) -> None:
        self._running = False
        robot = self._robot
        if robot is not None:
            try:
                with self._robot_lock:
                    robot.run_keyword("StopRemoteServer", [])
            except Exception:
                pass
        if self._proc and self._proc.poll() is None:
            try:
                self._proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                self._proc.kill()
                try:
                    self._proc.wait(timeout=2)
                except Exception:
                    pass
        if self._renode_home:
            try:
                self._renode_home.cleanup()
            except Exception:
                pass
            self._renode_home = None

    def set_pin(self, pin: int | str, value: bool) -> None:
        if not self._running:
            return
        try:
            pin_int = int(pin)
        except Exception:
            return
        mapped = _PIN_MAP.get(pin_int)
        if mapped is None:
            return
        port_obj, bit = mapped
        self._external_pins.add(pin_int)
        self._execute_command(f"{port_obj} OnGPIO {bit} {str(bool(value)).lower()}", emit_errors=False)

    def set_adc(self, value: dict[str, Any]) -> None:
        normalized = self._normalize_adc_value(value)
        if normalized is None:
            return
        pin, raw = normalized
        self._adc_values[pin] = raw
        if self._running:
            self._write_adc_value(pin, raw)

    def uart_send(self, uart_id: int | str, data_b64: str) -> None:
        if not self._running:
            return
        try:
            data = base64.b64decode(data_b64)
        except Exception:
            return
        if not data:
            return

        # We create sysbus.usart2 as the default terminal tester. The STM32
        # Arduino shim currently maps frontend Serial/Serial1 to USART2.
        text = data.decode("latin-1", errors="ignore")
        try:
            self._robot_run("WriteToUart", [text], emit_errors=False)
        except Exception:
            # Fall back to byte-wise writes if a future Renode version rejects
            # bulk strings.
            for byte in data:
                try:
                    self._robot_run("WriteCharOnUart", [chr(byte)], emit_errors=False)
                except Exception:
                    break

    def sensor_attach(self, sensor_type: str, pin: int | str, properties: dict[str, Any]) -> None:
        try:
            pin_int = int(pin)
        except Exception:
            return
        record = {
            "sensor_type": sensor_type,
            "pin": pin_int,
            **{k: v for k, v in properties.items() if k not in ("sensor_type", "pin")},
        }
        with self._sensors_lock:
            self._sensors[pin_int] = record
        self._apply_sensor(record)

    def sensor_update(self, pin: int | str, properties: dict[str, Any]) -> None:
        try:
            pin_int = int(pin)
        except Exception:
            return
        with self._sensors_lock:
            record = self._sensors.get(pin_int)
            if record is None:
                record = {"pin": pin_int}
                if pin_int >= 200:
                    record["addr"] = pin_int - 200
                self._sensors[pin_int] = record
            for key, value in properties.items():
                if key != "pin":
                    record[key] = value
            merged = dict(record)
        self._apply_sensor(merged)

    def sensor_detach(self, pin: int | str) -> None:
        try:
            pin_int = int(pin)
        except Exception:
            return
        with self._sensors_lock:
            self._sensors.pop(pin_int, None)
        # Renode's BME280 peripheral is declared statically in the platform, so
        # detaching means "stop live updates" rather than removing the device.

    def _apply_configured_sensors(self) -> None:
        with self._sensors_lock:
            sensors = [dict(sensor) for sensor in self._sensors.values()]
        for sensor in sensors:
            self._apply_sensor(sensor)

    def _apply_sensor(self, sensor: dict[str, Any]) -> None:
        sensor_type = str(sensor.get("sensor_type", "")).lower()
        if sensor_type in ("bmp280", "bme280"):
            self._apply_bme280(sensor)

    def _apply_bme280(self, sensor: dict[str, Any]) -> None:
        # The Blue Pill Renode platform exposes one BME280 at i2c1 address 0x76.
        # It is a BMP280-compatible superset for the Arduino examples.
        updates: list[tuple[str, float]] = []
        for prop, command in (
            ("temperature", "Temperature"),
            ("pressure", "Pressure"),
            ("humidity", "Humidity"),
        ):
            if prop not in sensor:
                continue
            try:
                updates.append((command, float(sensor[prop])))
            except Exception:
                continue
        for command, value in updates:
            self._try_execute_command(f"i2c1.bme280 {command} {value:g}")

    def _start_renode_remote(self) -> None:
        self._renode_home = tempfile.TemporaryDirectory(prefix="velxio-renode-")
        home = Path(self._renode_home.name)
        renode_config = home / "renode.config"
        self._uart_hook_file = home / "uart0.txt"
        self._uart_hook_file.write_text("", encoding="utf-8")
        self._pwm_hook_file = home / "pwm.txt"
        self._pwm_hook_file.write_text("", encoding="utf-8")
        self._spi_hook_file = home / "spi.bin"
        self._spi_hook_file.write_bytes(b"")
        self._i2c_hook_file = home / "i2c.bin"
        self._i2c_hook_file.write_bytes(b"")
        # Renode 1.16 on Windows can hang its Robot Remote server when a config
        # file sets history-path. Passing a unique missing config path keeps the
        # process isolated without triggering that startup bug.

        port = _find_free_tcp_port()
        cmd = [
            _RENODE_BIN,
            "--robot-server-port",
            str(port),
            "--hide-log",
            "--disable-gui",
            "--config",
            str(renode_config),
        ]
        self._proc = subprocess.Popen(
            cmd,
            cwd=str(Path(_RENODE_BIN).resolve().parent) if Path(_RENODE_BIN).exists() else None,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        self._robot = xmlrpc.client.ServerProxy(f"http://localhost:{port}/", allow_none=True)

        deadline = time.time() + 45.0
        last_error: Exception | None = None
        while time.time() < deadline:
            if self._proc.poll() is not None:
                raise RuntimeError(f"Renode exited early with code {self._proc.returncode}")
            try:
                self._robot.get_keyword_names()
                return
            except Exception as exc:
                last_error = exc
                time.sleep(0.25)
        raise RuntimeError(f"Renode Robot Remote did not start: {last_error}")

    def _setup_machine(self) -> None:
        self._robot_run("ResetEmulation", [])
        self._execute_command("mach create")
        self._execute_command(f"machine LoadPlatformDescription @{self._repl}")
        self._execute_command(f"sysbus LoadELF @{self._fw}")
        self._execute_command('cpu SP `sysbus GetSymbolAddress "_estack"`')
        self._execute_command('cpu PC `sysbus GetSymbolAddress "Reset_Handler"`')

        # Sensor defaults for current I2C examples. Ignore failures if a future
        # platform variant does not expose this peripheral.
        self._try_execute_command("i2c1.bme280 Temperature 25")
        self._try_execute_command("i2c1.bme280 Humidity 50")
        self._try_execute_command("i2c1.bme280 Pressure 1013.25")
        self._apply_configured_sensors()

        self._install_uart_hook()
        self._install_pwm_hook()
        self._install_i2c_hooks()
        self._install_digital_write_hook()
        self._install_spi_hook()
        self._robot_run("CreateTerminalTester", ["sysbus.usart2"])
        self._apply_adc_values()
        for pin, port_name, bit, value in self._initial_pins:
            self._external_pins.add(pin)
            self._execute_command(f"{port_name} OnGPIO {bit} {str(value).lower()}", emit_errors=False)
        self._robot_run("StartEmulation", [])

    def _install_uart_hook(self) -> None:
        if not self._uart_hook_file or not self._fw:
            return
        address = _elf_symbol_address(self._fw, _STM32_SERIAL_WRITE_SYMBOLS)
        if address is None:
            return
        # Forward slashes avoid Windows backslash escaping inside Renode's
        # IronPython hook string.
        hook_path = self._uart_hook_file.as_posix()
        hook_code = (
            "import System; "
            f"System.IO.File.AppendAllText(r'{hook_path}', "
            "chr(self.GetRegisterUlong(1) & 0xff))"
        )
        self._try_execute_command(f'cpu AddHook 0x{address:08X} "{hook_code}"')

    def _install_pwm_hook(self) -> None:
        if not self._pwm_hook_file or not self._fw:
            return
        address = _elf_symbol_address(self._fw, _STM32_PWM_WRITE_SYMBOLS)
        if address is None:
            return
        hook_path = self._pwm_hook_file.as_posix()
        hook_code = (
            "import System; "
            f"System.IO.File.AppendAllText(r'{hook_path}', "
            "str(self.GetRegisterUlong(0)) + ',' + "
            "str(self.GetRegisterUlong(1)) + '\\n')"
        )
        self._try_execute_command(f'cpu AddHook 0x{address:08X} "{hook_code}"')

    def _install_spi_hook(self) -> None:
        if not self._spi_hook_file or not self._fw:
            return
        address = _elf_symbol_address(self._fw, _STM32_SPI_TRANSFER_SYMBOLS)
        if address is None:
            return
        hook_path = self._spi_hook_file.as_posix()
        hook_code = (
            "import System; "
            f"System.IO.File.AppendAllText(r'{hook_path}', "
            "chr(83) + chr(self.GetRegisterUlong(1) & 0xff), "
            "System.Text.Encoding.GetEncoding(28591))"
        )
        self._try_execute_command(f'cpu AddHook 0x{address:08X} "{hook_code}"')

    def _install_i2c_hooks(self) -> None:
        if not self._i2c_hook_file or not self._fw:
            return
        begin_addr = _elf_symbol_address(self._fw, _STM32_I2C_BEGIN_SYMBOLS)
        write_addr = _elf_symbol_address(self._fw, _STM32_I2C_WRITE_SYMBOLS)
        end_addr = _elf_symbol_address(self._fw, _STM32_I2C_END_SYMBOLS)
        hook_path = self._i2c_hook_file.as_posix()
        encoding = "System.Text.Encoding.GetEncoding(28591)"
        if begin_addr is not None:
            hook_code = (
                "import System; "
                f"System.IO.File.AppendAllText(r'{hook_path}', "
                "chr(66) + chr(self.GetRegisterUlong(1) & 0xff), "
                f"{encoding})"
            )
            self._try_execute_command(f'cpu AddHook 0x{begin_addr:08X} "{hook_code}"')
        if write_addr is not None:
            hook_code = (
                "import System; "
                f"System.IO.File.AppendAllText(r'{hook_path}', "
                "chr(87) + chr(self.GetRegisterUlong(1) & 0xff), "
                f"{encoding})"
            )
            self._try_execute_command(f'cpu AddHook 0x{write_addr:08X} "{hook_code}"')
        if end_addr is not None:
            hook_code = (
                "import System; "
                f"System.IO.File.AppendAllText(r'{hook_path}', chr(69), {encoding})"
            )
            self._try_execute_command(f'cpu AddHook 0x{end_addr:08X} "{hook_code}"')

    def _install_digital_write_hook(self) -> None:
        if not self._spi_hook_file or not self._fw:
            return
        trace_address = _elf_symbol_address(self._fw, _STM32_DIGITAL_WRITE_TRACE_SYMBOLS)
        if trace_address is not None:
            hook_path = self._spi_hook_file.as_posix()
            hook_code = (
                "import System; "
                "_linear = int(self.GetRegisterUlong(0) & 0xff); "
                f"System.IO.File.AppendAllText(r'{hook_path}', "
                "chr(68) + chr(_linear & 0xff) + chr(self.GetRegisterUlong(1) & 0x01), "
                "System.Text.Encoding.GetEncoding(28591))"
            )
            self._try_execute_command(f'cpu AddHook 0x{trace_address:08X} "{hook_code}"')
            return

        address = _elf_symbol_address(self._fw, _STM32_DIGITAL_WRITE_SYMBOLS)
        if address is None:
            return
        hook_path = self._spi_hook_file.as_posix()
        pin_map = ",".join(str(pin) for pin in _BLUEPILL_DIGITAL_TO_LINEAR)
        hook_code = (
            "import System; "
            f"_map = [{pin_map}]; "
            "_pin = int(self.GetRegisterUlong(0) & 0xff); "
            "_linear = _map[_pin] if _pin < len(_map) else _pin; "
            f"System.IO.File.AppendAllText(r'{hook_path}', "
            "chr(68) + chr(_linear & 0xff) + chr(self.GetRegisterUlong(1) & 0x01), "
            "System.Text.Encoding.GetEncoding(28591))"
        )
        self._try_execute_command(f'cpu AddHook 0x{address:08X} "{hook_code}"')

    def _robot_run(self, keyword: str, args: list[Any] | None = None, emit_errors: bool = True) -> Any:
        if self._robot is None:
            raise RuntimeError("Renode Robot Remote is not connected")
        try:
            with self._robot_lock:
                response = self._robot.run_keyword(keyword, args or [])
        except Exception as exc:
            if emit_errors:
                self._emit({"type": "error", "data": {"message": f"{keyword} failed: {exc}"}})
            raise
        if not _is_pass(response):
            if emit_errors:
                self._emit({"type": "error", "data": {"message": f"{keyword} failed: {response}"}})
            raise RuntimeError(f"{keyword} failed: {response}")
        return response

    def _execute_command(self, command: str, emit_errors: bool = True) -> Any:
        return self._robot_run("ExecuteCommand", [command], emit_errors=emit_errors)

    def _try_execute_command(self, command: str) -> Any | None:
        try:
            return self._execute_command(command, emit_errors=False)
        except Exception:
            return None

    def _normalize_initial_pins(self, initial_pins: list[dict]) -> list[tuple[int, str, int, bool]]:
        result: list[tuple[int, str, int, bool]] = []
        for item in initial_pins:
            try:
                pin = int(item.get("pin", -1))
                value = bool(int(item.get("state", 0)))
            except Exception:
                continue
            mapped = _PIN_MAP.get(pin)
            if mapped:
                result.append((pin, mapped[0], mapped[1], value))
        return result

    def _normalize_adc_value(self, value: dict[str, Any]) -> tuple[int, int] | None:
        try:
            raw_pin = int(value.get("pin", -1))
        except Exception:
            return None
        pin = raw_pin if _is_stm32_adc_linear_pin(raw_pin) else _normalize_stm32duino_pin(raw_pin)
        if pin < 0 or pin >= 64:
            return None
        raw_value = value.get("raw")
        if raw_value is None:
            try:
                millivolts = float(value.get("millivolts", 0))
            except Exception:
                return None
            raw = round((max(0.0, min(3300.0, millivolts)) / 3300.0) * 4095)
        else:
            try:
                raw = int(raw_value)
            except Exception:
                return None
        return pin, max(0, min(4095, raw))

    def _resolve_adc_table_addresses(self) -> None:
        if not self._fw:
            return
        if self._adc_values_addr is None:
            self._adc_values_addr = _elf_symbol_address(self._fw, _STM32_ADC_RAW_VALUE_SYMBOLS)
        if self._adc_configured_addr is None:
            self._adc_configured_addr = _elf_symbol_address(self._fw, _STM32_ADC_CONFIGURED_SYMBOLS)

    def _apply_adc_values(self) -> None:
        self._resolve_adc_table_addresses()
        for pin, raw in list(self._adc_values.items()):
            self._write_adc_value(pin, raw)

    def _write_adc_value(self, pin: int, raw: int) -> None:
        if self._adc_values_addr is None or self._adc_configured_addr is None:
            self._resolve_adc_table_addresses()
        if self._adc_values_addr is None or self._adc_configured_addr is None:
            return
        offset = int(pin) * 4
        raw_clamped = max(0, min(4095, int(raw)))
        self._execute_command(
            f"sysbus WriteDoubleWord 0x{self._adc_values_addr + offset:08X} 0x{raw_clamped:08X}",
            emit_errors=False,
        )
        self._execute_command(
            f"sysbus WriteDoubleWord 0x{self._adc_configured_addr + offset:08X} 0x00000001",
            emit_errors=False,
        )

    def _process_watchdog(self) -> None:
        while self._running and self._proc and self._proc.poll() is None:
            time.sleep(0.25)
        if self._booted and not self._exit_emitted:
            self._exit_emitted = True
            self._emit({"type": "system", "data": {"event": "exited"}})

    def _uart_hook_file_reader(self) -> None:
        while self._running:
            path = self._uart_hook_file
            if not path:
                time.sleep(0.05)
                continue
            try:
                if path.exists():
                    size = path.stat().st_size
                    if size < self._uart_hook_offset:
                        self._uart_hook_offset = 0
                    if size > self._uart_hook_offset:
                        with path.open("r", encoding="utf-8", errors="replace") as f:
                            f.seek(self._uart_hook_offset)
                            text = f.read()
                            self._uart_hook_offset = f.tell()
                        if text:
                            self._emit_serial_output(text, 0, dedupe=False)
            except Exception:
                pass
            time.sleep(0.05)

    def _pwm_hook_file_reader(self) -> None:
        while self._running:
            path = self._pwm_hook_file
            if not path:
                time.sleep(0.05)
                continue
            try:
                if path.exists():
                    size = path.stat().st_size
                    if size < self._pwm_hook_offset:
                        self._pwm_hook_offset = 0
                    if size > self._pwm_hook_offset:
                        with path.open("r", encoding="utf-8", errors="replace") as f:
                            f.seek(self._pwm_hook_offset)
                            text = f.read()
                            self._pwm_hook_offset = f.tell()
                        for line in text.splitlines():
                            self._emit_pwm_line(line)
            except Exception:
                pass
            time.sleep(0.05)

    def _spi_hook_file_reader(self) -> None:
        while self._running:
            path = self._spi_hook_file
            if not path:
                time.sleep(0.02)
                continue
            try:
                if path.exists():
                    size = path.stat().st_size
                    if size < self._spi_hook_offset:
                        self._spi_hook_offset = 0
                    if size > self._spi_hook_offset:
                        with path.open("rb") as f:
                            f.seek(self._spi_hook_offset)
                            data = f.read()
                            self._spi_hook_offset = f.tell()
                        if data:
                            self._emit_spi_trace(data)
            except Exception:
                pass
            time.sleep(0.02)

    def _i2c_hook_file_reader(self) -> None:
        while self._running:
            path = self._i2c_hook_file
            if not path:
                time.sleep(0.02)
                continue
            try:
                if path.exists():
                    size = path.stat().st_size
                    if size < self._i2c_hook_offset:
                        self._i2c_hook_offset = 0
                    if size > self._i2c_hook_offset:
                        with path.open("rb") as f:
                            f.seek(self._i2c_hook_offset)
                            data = f.read()
                            self._i2c_hook_offset = f.tell()
                        if data:
                            self._emit_i2c_trace(data)
            except Exception:
                pass
            time.sleep(0.02)

    def _emit_i2c_trace(self, data: bytes) -> None:
        buf = self._i2c_hook_pending + data
        self._i2c_hook_pending = b""
        i = 0

        def finish_transaction() -> None:
            if self._i2c_tx_addr in (0x27, 0x3C) and self._i2c_tx_bytes:
                self._emit({
                    "type": "i2c_transaction",
                    "data": {
                        "addr": int(self._i2c_tx_addr),
                        "data": list(self._i2c_tx_bytes),
                    },
                })
            self._i2c_tx_addr = None
            self._i2c_tx_bytes.clear()

        while i < len(buf):
            marker = buf[i]
            if marker == ord("B"):
                if i + 1 >= len(buf):
                    break
                self._i2c_tx_addr = int(buf[i + 1])
                self._i2c_tx_bytes.clear()
                i += 2
            elif marker == ord("W"):
                if i + 1 >= len(buf):
                    break
                if self._i2c_tx_addr is not None:
                    self._i2c_tx_bytes.append(buf[i + 1])
                i += 2
            elif marker == ord("E"):
                finish_transaction()
                i += 1
            else:
                i += 1
        if i < len(buf):
            self._i2c_hook_pending = buf[i:]

    def _emit_spi_trace(self, data: bytes) -> None:
        buf = self._spi_hook_pending + data
        self._spi_hook_pending = b""
        spi_bytes = bytearray()
        i = 0

        def flush_spi() -> None:
            if not spi_bytes:
                return
            self._emit({
                "type": "spi_batch",
                "data": {"b64": base64.b64encode(bytes(spi_bytes)).decode("ascii")},
            })
            spi_bytes.clear()

        while i < len(buf):
            marker = buf[i]
            if marker == ord("S"):
                if i + 1 >= len(buf):
                    break
                spi_bytes.append(buf[i + 1])
                i += 2
            elif marker == ord("D"):
                if i + 2 >= len(buf):
                    break
                flush_spi()
                pin = int(buf[i + 1])
                state = 1 if buf[i + 2] else 0
                self._emit({
                    "type": "gpio_change",
                    "data": {
                        "pin": pin,
                        "pin_name": _linear_pin_name(pin),
                        "state": state,
                    },
                })
                i += 3
            else:
                # Backward compatibility for any worker launched between code
                # updates that still writes raw MOSI bytes without markers.
                spi_bytes.append(marker)
                i += 1
        flush_spi()
        if i < len(buf):
            self._spi_hook_pending = buf[i:]

    def _emit_pwm_line(self, line: str) -> None:
        try:
            pin_text, value_text = line.strip().split(",", 1)
            raw_pin = int(pin_text, 0)
            raw_value = int(value_text, 0)
        except Exception:
            return
        pin = _normalize_stm32duino_pin(raw_pin)
        value = max(0, min(255, raw_value))
        self._emit({
            "type": "pwm_change",
            "data": {
                "pin": pin,
                "pin_name": _linear_pin_name(pin),
                "arduino_pin": raw_pin,
                "value": value,
                "duty": value / 255.0,
            },
        })

    def _uart_line_reader(self) -> None:
        while self._running and self._proc and self._proc.poll() is None:
            try:
                response = self._robot_run("WaitForNextLineOnUart", [], emit_errors=False)
                value = response.get("return") if isinstance(response, dict) else None
                if isinstance(value, dict):
                    line = value.get("Line")
                else:
                    line = value
                if line is not None:
                    self._emit_serial_output(str(line) + "\n", 0, dedupe=False)
            except Exception:
                time.sleep(0.05)

    def _emit_serial_output(self, text: str, uart_id: int, dedupe: bool = True) -> None:
        if not text:
            return
        if dedupe:
            now = time.time()
            key = (int(uart_id), text)
            with self._serial_emit_lock:
                self._recent_serial_emits = [
                    item for item in self._recent_serial_emits
                    if now - item[0] < 0.75
                ]
                if any(item[1] == key for item in self._recent_serial_emits):
                    return
                self._recent_serial_emits.append((now, key))
        self._emit({"type": "serial_output", "data": {"data": text, "uart": int(uart_id)}})

    def _handle_gpio_reg_value(self, port_name: str, port_obj: str, base_pin: int, reg_name: str, val: int) -> None:
        self._gpio_regs[(base_pin, reg_name)] = val
        if reg_name == "ODR":
            self._handle_odr_value(port_name, base_pin, val)
        self._apply_internal_pull_inputs(port_obj, base_pin)

    def _handle_odr_value(self, port_name: str, base_pin: int, val: int) -> None:
        prev = self._last_odr.get(base_pin)
        self._last_odr[base_pin] = val
        if prev is None:
            return
        changed = (prev ^ val) & 0xFFFF
        if not changed:
            return
        for bit in range(16):
            if changed & (1 << bit):
                state = 1 if (val & (1 << bit)) else 0
                self._emit({
                    "type": "gpio_change",
                    "data": {
                        "pin": base_pin + bit,
                        "pin_name": f"P{port_name}{bit}",
                        "state": state,
                    },
                })

    def _apply_internal_pull_inputs(self, port_obj: str, base_pin: int) -> None:
        crl = self._gpio_regs.get((base_pin, "CRL"))
        crh = self._gpio_regs.get((base_pin, "CRH"))
        odr = self._gpio_regs.get((base_pin, "ODR"))
        if crl is None or crh is None or odr is None:
            return
        for bit in range(16):
            cfg = (crl >> (bit * 4)) & 0xF if bit < 8 else (crh >> ((bit - 8) * 4)) & 0xF
            linear = base_pin + bit
            if cfg != 0x8 or linear in self._external_pins:
                continue
            level = bool(odr & (1 << bit))
            if self._last_internal_inputs.get(linear) == level:
                continue
            self._last_internal_inputs[linear] = level
            self._execute_command(f"{port_obj} OnGPIO {bit} {str(level).lower()}", emit_errors=False)

    def _gpio_poller(self) -> None:
        if self._debug_gpio and not self._gpio_debug_started:
            self._gpio_debug_started = True
            self._emit({"type": "gpio_debug", "data": {"event": "poll_start"}})
        while self._running and self._proc and self._proc.poll() is None:
            port_name, port_obj, base_pin, reg_name, addr = _GPIO_READS[self._next_gpio_read_index]
            self._next_gpio_read_index = (self._next_gpio_read_index + 1) % len(_GPIO_READS)
            try:
                if self._debug_gpio and self._last_gpio_debug_emit == 0.0:
                    self._emit({
                        "type": "gpio_debug",
                        "data": {
                            "event": "before_read",
                            "port": port_name,
                            "reg": reg_name,
                            "addr": f"0x{addr:08X}",
                        },
                    })
                response = self._execute_command(f"sysbus ReadDoubleWord 0x{addr:08X}", emit_errors=False)
                if self._debug_gpio and self._gpio_debug_raw_count < 12:
                    self._gpio_debug_raw_count += 1
                    self._emit({
                        "type": "gpio_debug",
                        "data": {
                            "event": "raw_response",
                            "port": port_name,
                            "reg": reg_name,
                            "response": response,
                        },
                    })
                value = _parse_u32(_response_text(response))
                if value is not None:
                    if self._debug_gpio and reg_name == "ODR":
                        now = time.time()
                        if now - self._last_gpio_debug_emit > 0.5:
                            self._last_gpio_debug_emit = now
                            self._emit({
                                "type": "gpio_debug",
                                "data": {
                                    "port": port_name,
                                    "reg": reg_name,
                                    "value": f"0x{value:08X}",
                                },
                            })
                    self._handle_gpio_reg_value(port_name, port_obj, base_pin, reg_name, value)
            except Exception as exc:
                if self._debug_gpio:
                    self._emit({
                        "type": "gpio_debug",
                        "data": {
                            "port": port_name,
                            "reg": reg_name,
                            "error": str(exc),
                        },
                    })
            time.sleep(0.02)


def main() -> None:
    worker = RenodeWorker()
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue
        msg_type = msg.get("type", "")
        data = msg.get("data", {})
        try:
            if msg_type == "init":
                worker.init(
                    data.get("machine", ""),
                    data.get("firmware_b64", ""),
                    data.get("initial_pins", []),
                    data.get("sensors", []),
                    data.get("initial_adc", []),
                )
            elif msg_type == "run":
                worker.run()
            elif msg_type == "stop":
                worker.stop()
                break
            elif msg_type == "set_pin":
                worker.set_pin(data.get("pin", -1), data.get("value", False))
            elif msg_type == "set_adc":
                worker.set_adc(data)
            elif msg_type == "uart_send":
                worker.uart_send(data.get("uart", 0), data.get("data", ""))
            elif msg_type == "sensor_attach":
                worker.sensor_attach(data.get("sensor_type", ""), data.get("pin", 0), data)
            elif msg_type == "sensor_update":
                worker.sensor_update(data.get("pin", 0), data)
            elif msg_type == "sensor_detach":
                worker.sensor_detach(data.get("pin", 0))
        except Exception as exc:
            worker._emit({"type": "error", "data": {"message": str(exc)}})


if __name__ == "__main__":
    main()
