from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app.services.arduino_cli import STM32_RENODE_WIRE_HEADER, STM32_RENODE_WIRE_IMPL
from app.services.stm32_worker_renode import RenodeWorker


class Stm32I2cProtocolTest(unittest.TestCase):
    def test_wire_shim_keeps_hooked_methods_out_of_line(self) -> None:
        self.assertIn("void beginTransmission(uint8_t address) __attribute__((noinline));", STM32_RENODE_WIRE_HEADER)
        self.assertIn("uint8_t endTransmission(uint8_t sendStop) __attribute__((noinline));", STM32_RENODE_WIRE_HEADER)
        self.assertIn("virtual size_t write(uint8_t data) __attribute__((noinline));", STM32_RENODE_WIRE_HEADER)
        self.assertIn("__attribute__((noinline)) void TwoWire::beginTransmission", STM32_RENODE_WIRE_IMPL)
        self.assertIn("__attribute__((noinline)) uint8_t TwoWire::endTransmission", STM32_RENODE_WIRE_IMPL)
        self.assertIn("__attribute__((noinline)) size_t TwoWire::write(uint8_t data)", STM32_RENODE_WIRE_IMPL)

    def test_worker_installs_i2c_transaction_hooks(self) -> None:
        worker = RenodeWorker()
        worker._fw = "firmware.elf"
        with TemporaryDirectory() as tmp:
            worker._i2c_hook_file = Path(tmp) / "i2c.bin"
            commands: list[str] = []
            worker._try_execute_command = lambda command: commands.append(command)

            with patch("app.services.stm32_worker_renode._elf_symbol_address", side_effect=[0x08001000, 0x08002000, 0x08003000]):
                worker._install_i2c_hooks()

        self.assertEqual(len(commands), 3)
        self.assertIn("cpu AddHook 0x08001000", commands[0])
        self.assertIn("chr(66)", commands[0])
        self.assertIn("GetRegisterUlong(1)", commands[0])
        self.assertIn("cpu AddHook 0x08002000", commands[1])
        self.assertIn("chr(87)", commands[1])
        self.assertIn("GetRegisterUlong(1)", commands[1])
        self.assertIn("cpu AddHook 0x08003000", commands[2])
        self.assertIn("chr(69)", commands[2])

    def test_worker_replays_i2c_write_transactions(self) -> None:
        worker = RenodeWorker()
        emitted: list[dict] = []
        worker._emit = lambda msg: emitted.append(msg)

        worker._emit_i2c_trace(bytes([
            ord("B"), 0x3C,
            ord("W"), 0x00,
            ord("W"), 0xB0,
            ord("E"),
            ord("B"), 0x76,
            ord("W"), 0xF4,
            ord("E"),
        ]))

        self.assertEqual(
            emitted,
            [{"type": "i2c_transaction", "data": {"addr": 0x3C, "data": [0x00, 0xB0]}}],
        )


if __name__ == "__main__":
    unittest.main()
