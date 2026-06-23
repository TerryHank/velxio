from __future__ import annotations

import asyncio
import base64
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.arduino_cli import ArduinoCLIService, CLI_COMPILE_TIMEOUT_SECONDS


class ArduinoCliCompileTest(unittest.TestCase):
    def test_compile_timeout_returns_structured_failure(self) -> None:
        service = object.__new__(ArduinoCLIService)
        service.cli_path = "arduino-cli"

        def fake_run(cmd, **kwargs):
            self.assertIn("compile", cmd)
            self.assertEqual(kwargs["timeout"], CLI_COMPILE_TIMEOUT_SECONDS)
            raise subprocess.TimeoutExpired(
                cmd=cmd,
                timeout=kwargs["timeout"],
                output="partial stdout",
                stderr="partial stderr",
            )

        with patch.object(subprocess, "run", fake_run):
            result = asyncio.run(
                service.compile(
                    [{"name": "sketch.ino", "content": "void setup(){} void loop(){}"}],
                    "arduino:avr:uno",
                )
            )

        self.assertIs(result["success"], False)
        self.assertEqual(result["error"], f"arduino-cli compile timed out after {CLI_COMPILE_TIMEOUT_SECONDS}s")
        self.assertEqual(result["stdout"], "partial stdout")
        self.assertIn("partial stderr", result["stderr"])
        self.assertIn("timed out", result["stderr"])

    def test_stm32_compile_reuses_cached_elf_for_identical_inputs(self) -> None:
        service = object.__new__(ArduinoCLIService)
        service.cli_path = "arduino-cli"
        calls = 0

        def fake_run(cmd, **kwargs):
            nonlocal calls
            calls += 1
            out_dir = Path(cmd[cmd.index("--output-dir") + 1])
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "sketch.ino.elf").write_bytes(b"cached-elf")
            return subprocess.CompletedProcess(cmd, 0, stdout="compiled stm32", stderr="")

        with tempfile.TemporaryDirectory() as tmp, patch.dict(
            os.environ, {"VELXIO_STM32_COMPILE_CACHE_DIR": str(Path(tmp) / "stm32-cache")}
        ), patch.object(subprocess, "run", fake_run):
            files = [{"name": "sketch.ino", "content": "void setup(){} void loop(){}"}]
            first = asyncio.run(service.compile(files, "STMicroelectronics:stm32:GenF1:pnum=BLUEPILL_F103C8"))
            second = asyncio.run(service.compile(files, "STMicroelectronics:stm32:GenF1:pnum=BLUEPILL_F103C8"))

        self.assertIs(first["success"], True)
        self.assertIs(second["success"], True)
        self.assertEqual(first["binary_content"], base64.b64encode(b"cached-elf").decode("ascii"))
        self.assertEqual(second["binary_content"], first["binary_content"])
        self.assertEqual(second["binary_type"], "elf")
        self.assertIn("STM32 compile cache hit", second["stdout"])
        self.assertEqual(calls, 1)

    def test_stm32_compile_cache_invalidates_when_source_changes(self) -> None:
        service = object.__new__(ArduinoCLIService)
        service.cli_path = "arduino-cli"
        calls = 0

        def fake_run(cmd, **kwargs):
            nonlocal calls
            calls += 1
            sketch_dir = Path(cmd[-1])
            out_dir = Path(cmd[cmd.index("--output-dir") + 1])
            out_dir.mkdir(parents=True, exist_ok=True)
            sketch = (sketch_dir / "sketch.ino").read_text(encoding="utf-8")
            (out_dir / "sketch.ino.elf").write_bytes(f"elf-{calls}-{hash(sketch)}".encode("ascii"))
            return subprocess.CompletedProcess(cmd, 0, stdout=f"compiled stm32 {calls}", stderr="")

        with tempfile.TemporaryDirectory() as tmp, patch.dict(
            os.environ, {"VELXIO_STM32_COMPILE_CACHE_DIR": str(Path(tmp) / "stm32-cache")}
        ), patch.object(subprocess, "run", fake_run):
            first = asyncio.run(
                service.compile(
                    [{"name": "sketch.ino", "content": "void setup(){} void loop(){ digitalWrite(PC13, LOW); }"}],
                    "STMicroelectronics:stm32:GenF1:pnum=BLUEPILL_F103C8",
                )
            )
            second = asyncio.run(
                service.compile(
                    [{"name": "sketch.ino", "content": "void setup(){} void loop(){ digitalWrite(PC13, HIGH); }"}],
                    "STMicroelectronics:stm32:GenF1:pnum=BLUEPILL_F103C8",
                )
            )

        self.assertIs(first["success"], True)
        self.assertIs(second["success"], True)
        self.assertNotEqual(second["binary_content"], first["binary_content"])
        self.assertEqual(calls, 2)


if __name__ == "__main__":
    unittest.main()
