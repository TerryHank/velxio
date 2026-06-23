"""
Stm32LibManager — STM32 simulation via Renode (replaces PICSimLab/QEMU).

Each start_instance() launches stm32_worker_renode.py that starts Renode
headless with the STM32F103 platform, loads firmware ELF, and streams
UART/GPIO events back over stdin/stdout JSON lines.

Events emitted via callback(event_type, data):
  system        {event: 'booting'|'booted'|'crash'|'exited'}
  serial_output {data: str, uart: int}
  gpio_change   {pin: int, state: int}
  pwm_change    {pin: int, value: int, duty: float}
  set_adc       frontend command {pin: int, millivolts: int, raw: int}
  error         {message: str}
"""
import asyncio
import dataclasses
import json
import logging
import os
import pathlib
import subprocess
import sys
import threading
from typing import Callable, Awaitable

logger = logging.getLogger(__name__)

_SERVICES_DIR = pathlib.Path(__file__).parent

# ── Renode worker config ──────────────────────────────────────────────

_WORKER_SCRIPT = _SERVICES_DIR / 'stm32_worker_renode.py'

import shutil
_RENODE_PATH = shutil.which('renode')
if _RENODE_PATH:
    _RENODE_BIN = _RENODE_PATH
else:
    if sys.platform == 'win32':
        _RENODE_BIN = 'D:\\Program Files\\Renode\\renode.exe'
        if not os.path.isfile(_RENODE_BIN):
            _RENODE_BIN = 'C:\\Program Files\\Renode\\renode.exe'
    else:
        _RENODE_BIN = '/opt/renode/renode'

EventCallback = Callable[[str, dict], Awaitable[None]]

# Board kind → Renode .repl platform (relative to services/renode/)
_MACHINE: dict[str, str] = {
    'stm32-bluepill':        'stm32f103_bluepill.repl',
    'stm32-blackpill':       'stm32f103_bluepill.repl',
    'stm32-bluepill-f103cb': 'stm32f103_bluepill.repl',
    'stm32-blackpill-f401':  'stm32f103_bluepill.repl',
    'stm32-f4-discovery':    'stm32f103_bluepill.repl',
    'stm32-olimex-h405':     'stm32f103_bluepill.repl',
    'stm32-netduino-plus2':  'stm32f103_bluepill.repl',
    'stm32-netduino2':       'stm32f103_bluepill.repl',
    'stm32-vldiscovery':     'stm32f103_bluepill.repl',
    'stm32f4-discovery':     'stm32f103_bluepill.repl',
    'netduinoplus2':         'stm32f103_bluepill.repl',
    'olimex-stm32-h405':     'stm32f103_bluepill.repl',
    'netduino2':             'stm32f103_bluepill.repl',
}


@dataclasses.dataclass
class _UartBuffer:
    uart_id: int
    buf: str = ''

    def feed(self, byte_val: int) -> str | None:
        ch = chr(byte_val)
        if ch in ('\r', '\n'):
            result = self.buf
            self.buf = ''
            if ch == '\n' and result:
                return result + '\n'
            if ch == '\r' and result:
                return result
            return None
        self.buf += ch
        return None


@dataclasses.dataclass
class _WorkerInstance:
    process: subprocess.Popen
    stdin_lock: threading.Lock
    callback: EventCallback
    board_type: str
    uart_bufs: dict[int, _UartBuffer]
    threads: list[threading.Thread]
    loop: asyncio.AbstractEventLoop
    sensors: list = dataclasses.field(default_factory=list)
    running: bool = True


class Stm32LibManager:
    """Manage STM32 simulations via Renode worker processes."""

    def __init__(self):
        self._instances: dict[str, _WorkerInstance] = {}
        self._instances_lock = threading.Lock()

    @staticmethod
    def is_available() -> bool:
        """Check if Renode binary exists."""
        return _WORKER_SCRIPT.exists() and os.path.isfile(_RENODE_BIN)

    def get_instance(self, client_id: str) -> _WorkerInstance | None:
        with self._instances_lock:
            return self._instances.get(client_id)

    async def start_instance(
        self,
        client_id: str,
        board_type: str,
        callback: EventCallback,
        firmware_b64: str | None = None,
        sensors: list | None = None,
        initial_pins: list | None = None,
        initial_adc: list | None = None,
    ) -> None:
        if client_id in self._instances:
            logger.info('start_instance: %s already running — stopping first', client_id)
            await self.stop_instance(client_id)

        if not firmware_b64:
            logger.info('start_instance %s: no firmware — skipping worker launch', client_id)
            return

        machine = _MACHINE.get(board_type, 'stm32f103_bluepill.repl')

        init_cmd = json.dumps({
            'type': 'init',
            'data': {
                'machine': machine,
                'firmware_b64': firmware_b64,
                'sensors': list(sensors or []),
                'initial_pins': list(initial_pins or []),
                'initial_adc': list(initial_adc or []),
            },
        })
        run_cmd = json.dumps({'type': 'run'})

        logger.info('Launching renode_worker for %s (machine=%s)', client_id, machine)
        try:
            await callback('system', {'event': 'booting'})
        except Exception as exc:
            logger.warning('start_instance %s: booting event failed: %s', client_id, exc)

        try:
            logger.info('[%s] Launching renode worker subprocess...', client_id)
            env = os.environ.copy()
            env["RENODE_BIN"] = _RENODE_BIN
            proc = subprocess.Popen(
                [sys.executable, str(_WORKER_SCRIPT)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                env=env,
            )
            logger.info('[%s] Worker PID=%d launched', client_id, proc.pid)
        except Exception as exc:
            logger.error('Failed to launch renode_worker for %s: %r', client_id, exc)
            await callback('error', {'message': f'Worker launch failed: {exc}'})
            return

        try:
            assert proc.stdin is not None
            proc.stdin.write(init_cmd + '\n')
            proc.stdin.write(run_cmd + '\n')
            proc.stdin.flush()
            logger.info('[%s] Wrote init+run to worker stdin', client_id)
        except Exception as exc:
            logger.error('Failed to write init to renode_worker %s: %r', client_id, exc)
            proc.kill()
            return

        loop = asyncio.get_running_loop()
        inst = _WorkerInstance(
            process=proc,
            stdin_lock=threading.Lock(),
            callback=callback,
            board_type=board_type,
            uart_bufs={0: _UartBuffer(0), 1: _UartBuffer(1), 2: _UartBuffer(2)},
            threads=[],
            loop=loop,
            sensors=list(sensors or []),
        )
        with self._instances_lock:
            self._instances[client_id] = inst

        t_out = threading.Thread(target=self._thread_read_stdout,
                                 args=(inst, client_id), daemon=True,
                                 name=f'stm32-stdout-{client_id[:8]}')
        t_err = threading.Thread(target=self._thread_read_stderr,
                                 args=(inst, client_id), daemon=True,
                                 name=f'stm32-stderr-{client_id[:8]}')
        inst.threads.extend([t_out, t_err])
        t_out.start()
        t_err.start()

    async def stop_instance(self, client_id: str) -> None:
        with self._instances_lock:
            inst = self._instances.pop(client_id, None)
        if inst is None:
            return
        inst.running = False
        try:
            self._write_cmd(inst, {'type': 'stop'})
        except Exception:
            pass
        try:
            inst.process.stdin.close()
        except Exception:
            pass
        try:
            inst.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            inst.process.kill()
        for t in inst.threads:
            t.join(timeout=1)

    def load_firmware(self, client_id: str, firmware_b64: str) -> None:
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if inst is None:
            logger.warning('load_firmware: no instance for %s', client_id)
            return
        self._write_cmd(inst, {
            'type': 'load_firmware',
            'data': {'firmware_b64': firmware_b64},
        })

    def set_pin_state(self, client_id: str, pin: int | str, state_val: int) -> None:
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if inst and inst.running and inst.process.returncode is None:
            self._write_cmd(inst, {
                'type': 'set_pin',
                'data': {'pin': int(pin), 'value': bool(state_val)},
            })

    def set_adc_value(self, client_id: str, pin: int | str, value: dict) -> None:
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if inst and inst.running and inst.process.returncode is None:
            self._write_cmd(inst, {
                'type': 'set_adc',
                'data': {
                    'pin': int(pin),
                    'millivolts': value.get('millivolts'),
                    'raw': value.get('raw'),
                },
            })

    def get_status(self, client_id: str) -> dict:
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if inst is None:
            return {'running': False}
        rc = inst.process.returncode
        return {
            'running': inst.running and rc is None,
            'returncode': rc,
        }

    async def send_serial_bytes(self, client_id: str, data: bytes, uart_id: int = 0) -> None:
        import base64 as _b64
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if inst and inst.running and inst.process.returncode is None:
            self._write_cmd(inst, {
                'type': 'uart_send',
                'data': {'uart': uart_id, 'data': _b64.b64encode(data).decode()},
            })

    # ── Generic sensor protocol offloading ─────────────────────────────

    def sensor_attach(self, client_id: str, sensor_type: str, pin: int,
                      properties: dict) -> None:
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if inst is None:
            return
        record = {
            'sensor_type': sensor_type,
            'pin': int(pin),
            **{k: v for k, v in properties.items() if k not in ('sensor_type', 'pin')},
        }
        inst.sensors.append(record)
        if inst.running and inst.process.returncode is None:
            self._write_cmd(inst, {'type': 'sensor_attach', 'data': record})

    def sensor_update(self, client_id: str, pin: int,
                      properties: dict) -> None:
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if inst is None:
            return
        pin = int(pin)
        existing = None
        for record in inst.sensors:
            try:
                if int(record.get('pin', -1)) == pin:
                    existing = record
                    break
            except Exception:
                continue
        if existing is None:
            existing = {'pin': pin}
            inst.sensors.append(existing)
        for key, value in properties.items():
            if key != 'pin':
                existing[key] = value
        if inst.running and inst.process.returncode is None:
            self._write_cmd(inst, {
                'type': 'sensor_update',
                'data': {'pin': pin, **{k: v for k, v in properties.items() if k != 'pin'}},
            })

    def sensor_detach(self, client_id: str, pin: int) -> None:
        with self._instances_lock:
            inst = self._instances.get(client_id)
        if inst is None:
            return
        pin = int(pin)
        inst.sensors = [
            record for record in inst.sensors
            if int(record.get('pin', -1)) != pin
        ]
        if inst.running and inst.process.returncode is None:
            self._write_cmd(inst, {'type': 'sensor_detach', 'data': {'pin': pin}})

    # ── Internals ──────────────────────────────────────────────────────

    def _write_cmd(self, inst: _WorkerInstance, cmd: dict) -> None:
        try:
            with inst.stdin_lock:
                assert inst.process.stdin is not None
                inst.process.stdin.write(json.dumps(cmd) + '\n')
                inst.process.stdin.flush()
        except Exception as exc:
            logger.debug('_write_cmd failed: %s', exc)

    def _thread_read_stdout(self, inst: _WorkerInstance, client_id: str) -> None:
        try:
            assert inst.process.stdout is not None
            for raw in inst.process.stdout:
                raw = raw.strip()
                if not raw:
                    continue
                logger.debug('[%s] stdout raw: %s', client_id, raw[:200])
                logger.info('[%s] stdout line: %s', client_id, raw[:200])
                # FIX: use str.find with str, not bytes.find
                idx = raw.find('{"type":')
                if idx > 0:
                    raw = raw[idx:]
                elif idx < 0:
                    continue
                try:
                    event = json.loads(raw)
                except Exception:
                    continue

                etype = event.pop('type', '')
                # Extract data payload — worker uses {"type":"...","data":{...}}
                payload = event.pop('data', event)
                if etype == 'uart_tx':
                    uart_id  = payload.get('uart', 0)
                    byte_val = payload.get('byte', 0)
                    buf = inst.uart_bufs.get(uart_id)
                    if buf:
                        text = buf.feed(byte_val)
                        if text:
                            self._dispatch(inst, 'serial_output',
                                           {'data': text, 'uart': uart_id})
                elif etype:
                    self._dispatch(inst, etype, payload)
        except Exception as exc:
            if inst.running:
                logger.debug('[%s] _thread_read_stdout ended: %s', client_id, exc)
        finally:
            rc = inst.process.returncode
            if rc is None:
                inst.process.poll()
                rc = inst.process.returncode
            if inst.running and rc is not None:
                logger.warning('[%s] stm32 worker exited (code %s)', client_id, rc)
                self._dispatch(inst, 'system',
                               {'event': 'crash', 'reason': 'worker_exit', 'code': rc})

    def _thread_read_stderr(self, inst: _WorkerInstance, client_id: str) -> None:
        try:
            assert inst.process.stderr is not None
            for line in inst.process.stderr:
                logger.info('[stm32-worker:%s] %s', client_id,
                            line.rstrip())
        except Exception:
            pass

    def _dispatch(self, inst: _WorkerInstance, etype: str, data: dict) -> None:
        try:
            coro = inst.callback(etype, data)
            asyncio.run_coroutine_threadsafe(coro, inst.loop)
        except Exception as exc:
            logger.debug('_dispatch %s failed: %s', etype, exc)


# ── Shared library path (no longer required, kept for backward compat) ─

def _resolve_lib(env_var: str, lib_name: str, default_path: str) -> str:
    direct = os.environ.get(env_var, '')
    if direct and os.path.isfile(direct):
        return direct
    qemu_dir = os.environ.get('VELXIO_QEMU_PATH', '')
    if qemu_dir:
        candidate = os.path.join(qemu_dir, lib_name)
        if os.path.isfile(candidate):
            return candidate
    if os.path.isfile(default_path):
        return default_path
    return default_path


_LIB_ARM_NAME = 'libqemu-arm.so' if sys.platform != 'win32' else 'libqemu-arm.dll'
_DEFAULT_LIB_ARM = str(_SERVICES_DIR / _LIB_ARM_NAME)


def lib_arm_path() -> str | None:
    return _resolve_lib('QEMU_STM32_LIB', _LIB_ARM_NAME, _DEFAULT_LIB_ARM)


# ── Singleton ────────────────────────────────────────────────────────

stm32_lib_manager = Stm32LibManager()
