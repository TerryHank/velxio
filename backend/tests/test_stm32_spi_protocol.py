from __future__ import annotations

import base64
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.arduino_cli import STM32_RENODE_SPI_HEADER, STM32_RENODE_SPI_IMPL
from app.services.stm32_worker_renode import RenodeWorker


class Stm32SpiProtocolTest(unittest.TestCase):
    def test_spi_shim_calls_exported_transfer_hook(self) -> None:
        self.assertIn("VelxioRenodeSpiTransfer", STM32_RENODE_SPI_HEADER)
        self.assertIn("VelxioRenodeDigitalWriteTrace", STM32_RENODE_SPI_HEADER)
        self.assertIn("#define digitalWrite(pin, value)", STM32_RENODE_SPI_HEADER)
        self.assertIn("uint8_t transfer(uint8_t data) __attribute__((noinline));", STM32_RENODE_SPI_HEADER)
        self.assertIn("static __attribute__((noinline)) void VelxioRenodeDigitalWrite", STM32_RENODE_SPI_HEADER)
        self.assertIn("volatile uint32_t VelxioRenodeSpiLastByte", STM32_RENODE_SPI_IMPL)
        self.assertIn("VelxioRenodeSpiLastByte = data;", STM32_RENODE_SPI_IMPL)
        self.assertIn("return VelxioRenodeSpiTransfer(data);", STM32_RENODE_SPI_IMPL)

    def test_worker_installs_spi_transfer_hook(self) -> None:
        worker = RenodeWorker()
        worker._fw = "firmware.elf"
        with tempfile.TemporaryDirectory() as tmp:
            worker._spi_hook_file = Path(tmp) / "spi.bin"
            commands: list[str] = []
            worker._try_execute_command = lambda command: commands.append(command)

            with patch("app.services.stm32_worker_renode._elf_symbol_address", return_value=0x08001234):
                worker._install_spi_hook()

        self.assertEqual(len(commands), 1)
        self.assertIn("cpu AddHook 0x08001234", commands[0])
        self.assertIn("AppendAllText", commands[0])
        self.assertIn("Encoding.GetEncoding(28591)", commands[0])
        self.assertIn("chr(83)", commands[0])
        self.assertIn("GetRegisterUlong(1)", commands[0])

    def test_worker_installs_digital_write_trace_hook(self) -> None:
        worker = RenodeWorker()
        worker._fw = "firmware.elf"
        with tempfile.TemporaryDirectory() as tmp:
            worker._spi_hook_file = Path(tmp) / "spi.bin"
            commands: list[str] = []
            worker._try_execute_command = lambda command: commands.append(command)

            def symbol_address(_path: str, names: list[str]) -> int | None:
                if names == ["VelxioRenodeDigitalWriteTrace"]:
                    return 0x08005678
                return None

            with patch("app.services.stm32_worker_renode._elf_symbol_address", side_effect=symbol_address):
                worker._install_digital_write_hook()

        self.assertEqual(len(commands), 1)
        self.assertIn("cpu AddHook 0x08005678", commands[0])
        self.assertIn("AppendAllText", commands[0])
        self.assertIn("Encoding.GetEncoding(28591)", commands[0])
        self.assertNotIn("_map =", commands[0])
        self.assertIn("_linear = int(self.GetRegisterUlong(0) & 0xff)", commands[0])
        self.assertIn("GetRegisterUlong(0)", commands[0])
        self.assertIn("GetRegisterUlong(1)", commands[0])

    def test_worker_replays_ordered_gpio_and_spi_events(self) -> None:
        worker = RenodeWorker()
        with tempfile.TemporaryDirectory() as tmp:
            worker._spi_hook_file = Path(tmp) / "spi.bin"
            worker._spi_hook_file.write_bytes(
                bytes([
                    ord("D"), 8, 0,
                    ord("S"), 0xAE,
                    ord("D"), 8, 1,
                    ord("S"), 0xFF,
                ])
            )
            worker._spi_hook_offset = 0
            worker._running = True
            emitted: list[dict] = []
            worker._emit = lambda msg: emitted.append(msg)

            thread = threading.Thread(target=worker._spi_hook_file_reader, daemon=True)
            thread.start()
            deadline = time.time() + 1.0
            while time.time() < deadline and not emitted:
                time.sleep(0.01)
            worker._running = False
            thread.join(timeout=1)

        self.assertEqual(
            emitted,
            [
                {"type": "gpio_change", "data": {"pin": 8, "pin_name": "PA8", "state": 0}},
                {
                    "type": "spi_batch",
                    "data": {"b64": base64.b64encode(bytes([0xAE])).decode("ascii")},
                },
                {"type": "gpio_change", "data": {"pin": 8, "pin_name": "PA8", "state": 1}},
                {
                    "type": "spi_batch",
                    "data": {"b64": base64.b64encode(bytes([0xFF])).decode("ascii")},
                },
            ],
        )
