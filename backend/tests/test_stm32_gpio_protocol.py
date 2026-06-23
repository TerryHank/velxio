from __future__ import annotations

import unittest

from app.services.arduino_cli import STM32_RENODE_SERIAL_SHIM, STM32_RENODE_SPI_HEADER


class Stm32GpioProtocolTest(unittest.TestCase):
    def test_serial_prelude_installs_gpio_shim_for_plain_sketches(self) -> None:
        self.assertIn("VelxioRenodeGpioIndex", STM32_RENODE_SERIAL_SHIM)
        self.assertIn("VelxioRenodeDigitalWriteTrace", STM32_RENODE_SERIAL_SHIM)
        self.assertIn("VelxioRenodeDigitalWriteTraceSink", STM32_RENODE_SERIAL_SHIM)
        self.assertIn("__attribute__((weak, noinline, used)) void VelxioRenodeDigitalWriteTrace", STM32_RENODE_SERIAL_SHIM)
        self.assertNotIn("static __attribute__((noinline, used)) void VelxioRenodeDigitalWriteTrace", STM32_RENODE_SERIAL_SHIM)
        self.assertIn("static __attribute__((noinline)) void VelxioRenodeDigitalWrite", STM32_RENODE_SERIAL_SHIM)
        self.assertIn("static __attribute__((noinline)) int VelxioRenodeDigitalRead", STM32_RENODE_SERIAL_SHIM)
        self.assertIn("#define pinMode(pin, mode)", STM32_RENODE_SERIAL_SHIM)
        self.assertIn("#define digitalWrite(pin, value)", STM32_RENODE_SERIAL_SHIM)
        self.assertIn("#define digitalRead(pin)", STM32_RENODE_SERIAL_SHIM)

    def test_spi_header_reuses_the_common_gpio_guard(self) -> None:
        self.assertIn("#ifndef VELXIO_RENODE_GPIO_SHIM", STM32_RENODE_SPI_HEADER)
        self.assertIn("#define VELXIO_RENODE_GPIO_SHIM", STM32_RENODE_SPI_HEADER)


if __name__ == "__main__":
    unittest.main()
