from __future__ import annotations

import asyncio
import io
import json
import unittest
from unittest.mock import patch

from app.services.stm32_lib_manager import Stm32LibManager
from app.services.stm32_worker_renode import RenodeWorker


class FakeProcess:
    pid = 12345

    def __init__(self):
        self.stdin = io.StringIO()
        self.stdout = io.StringIO("")
        self.stderr = io.StringIO("")
        self.killed = False
        self.returncode = None

    def poll(self):
        return self.returncode

    def kill(self):
        self.killed = True

    def wait(self, timeout=None):
        return 0


class Stm32AdcProtocolTest(unittest.TestCase):
    def test_start_instance_forwards_initial_adc_to_worker(self) -> None:
        proc = FakeProcess()

        def fake_popen(*_args, **_kwargs):
            return proc

        events: list[tuple[str, dict]] = []

        async def callback(event_type: str, data: dict) -> None:
            events.append((event_type, data))

        manager = Stm32LibManager()
        with patch("app.services.stm32_lib_manager.subprocess.Popen", fake_popen):
            asyncio.run(
                manager.start_instance(
                    "client-1",
                    "stm32-bluepill",
                    callback,
                    firmware_b64="ZmFrZS1lbGY=",
                    sensors=[],
                    initial_pins=[{"pin": 0, "state": 1}],
                    initial_adc=[{"pin": 0, "millivolts": 1650, "raw": 2048}],
                )
            )

        init_line = proc.stdin.getvalue().splitlines()[0]
        init_msg = json.loads(init_line)

        self.assertEqual(events, [("system", {"event": "booting"})])
        self.assertEqual(init_msg["type"], "init")
        self.assertEqual(
            init_msg["data"]["initial_adc"],
            [{"pin": 0, "millivolts": 1650, "raw": 2048}],
        )

    def test_worker_writes_adc_raw_value_to_guest_memory(self) -> None:
        worker = RenodeWorker()
        worker._running = True
        worker._adc_values_addr = 0x20001000
        worker._adc_configured_addr = 0x20002000
        commands: list[str] = []
        worker._execute_command = lambda command, emit_errors=True: commands.append(command)

        worker.set_adc({"pin": 0, "millivolts": 1650})

        self.assertEqual(worker._adc_values[0], 2048)
        self.assertEqual(
            commands,
            [
                "sysbus WriteDoubleWord 0x20001000 0x00000800",
                "sysbus WriteDoubleWord 0x20002000 0x00000001",
            ],
        )
