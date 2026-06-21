#!/usr/bin/env python3
"""
stm32_worker_v2.py — STM32 emulation via QEMU subprocess (no dlopen).

Communicates with stm32_lib_manager via:
  stdin  line 1 : JSON config {"firmware_b64","machine","sensors"}
  stdin  line 2+: JSON commands (set_pin, stop)
  stdout       : JSON event lines (system, gpio_change, serial_output, error)

PICSimLab machines support -chardev socket for GPIO and UART communication.
We connect to those sockets and relay events to the manager.
"""
import json, base64, sys, os, subprocess, socket, threading, time, tempfile

STDIN  = sys.stdin
STDOUT = sys.stdout
STDERR = sys.stderr

def emit(obj: dict):
    line = json.dumps(obj) + '\n'
    STDOUT.write(line)
    STDOUT.flush()

def log(msg: str):
    STDERR.write(f'[stm32_worker_v2] {msg}\n')
    STDERR.flush()

def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

def main():
    raw_cfg = STDIN.readline()
    if not raw_cfg.strip():
        os._exit(1)
    cfg = json.loads(raw_cfg)
    firmware_b64 = cfg['firmware_b64']
    machine = cfg.get('machine', 'stm32-f103c8-picsimlab-new')
    
    # Write firmware to temp file
    fw_bytes = base64.b64decode(firmware_b64)
    tmp = tempfile.NamedTemporaryFile(suffix='.elf', delete=False)
    tmp.write(fw_bytes)
    tmp.close()
    fw_path = tmp.name
    
    # Find QEMU binary (same path as the old .so location)
    qemu_bin = os.environ.get('QEMU_STM32_LIB', '/app/app/services/libqemu-arm.so')
    
    # Allocate ports for GPIO and serial chardevs
    gpio_port = find_free_port()
    serial_port = find_free_port()
    
    # Build QEMU command
    cmd = [
        qemu_bin,
        '-M', machine,
        '-nographic',
        '-kernel', fw_path,
        '-chardev', f'socket,id=gpio0,port={gpio_port},host=127.0.0.1,nodelay=on,server=on,wait=off',
        '-chardev', f'socket,id=uart0,port={serial_port},host=127.0.0.1,nodelay=on,server=on,wait=off',
    ]
    
    log(f'Starting QEMU: machine={machine} gpio_port={gpio_port} serial_port={serial_port}')
    emit({'type': 'system', 'event': 'booting'})
    
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        log(f'Failed to start QEMU: {e}')
        emit({'type': 'error', 'message': f'QEMU launch failed: {e}'})
        os.unlink(fw_path)
        os._exit(1)
    
    log(f'QEMU PID: {proc.pid}')
    
    def connect_chardev(port: int, name: str) -> socket.socket | None:
        for attempt in range(30):
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(5)
                sock.connect(('127.0.0.1', port))
                log(f'Connected to {name} chardev on port {port}')
                return sock
            except (ConnectionRefusedError, OSError):
                time.sleep(0.5)
        log(f'Failed to connect to {name} chardev on port {port}')
        return None
    
    gpio_sock = connect_chardev(gpio_port, 'GPIO')
    serial_sock = connect_chardev(serial_port, 'Serial')
    
    if not gpio_sock and not serial_sock:
        emit({'type': 'error', 'message': 'Failed to connect to any QEMU chardev'})
        proc.kill()
        proc.wait()
        os.unlink(fw_path)
        os._exit(1)
    
    emit({'type': 'system', 'event': 'booted'})
    log('QEMU booted')
    
    stopped = threading.Event()
    
    # GPIO reader thread
    def gpio_reader():
        buf = b''
        while not stopped.is_set():
            try:
                gpio_sock.settimeout(1.0)
                data = gpio_sock.recv(4096)
                if not data:
                    break
                buf += data
                while b'\n' in buf:
                    line, buf = buf.split(b'\n', 1)
                    line = line.strip()
                    if line.startswith(b'GPIO '):
                        parts = line.split()
                        if len(parts) >= 3:
                            try:
                                pin = int(parts[1])
                                state = int(parts[2])
                                emit({'type': 'gpio_change', 'pin': pin, 'state': state})
                            except ValueError:
                                pass
            except socket.timeout:
                continue
            except Exception:
                break
    
    # Serial reader thread
    def serial_reader():
        while not stopped.is_set():
            try:
                serial_sock.settimeout(1.0)
                data = serial_sock.recv(4096)
                if not data:
                    break
                try:
                    text = data.decode('utf-8', errors='replace')
                    emit({'type': 'serial_output', 'data': text, 'uart': 0})
                except Exception:
                    pass
            except socket.timeout:
                continue
            except Exception:
                break
    
    t_gpio = threading.Thread(target=gpio_reader, daemon=True, name='gpio-reader')
    t_serial = threading.Thread(target=serial_reader, daemon=True, name='serial-reader')
    if gpio_sock:
        t_gpio.start()
    if serial_sock:
        t_serial.start()
    
    # Command loop
    for raw_line in STDIN:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        try:
            cmd = json.loads(raw_line)
        except Exception:
            continue
        
        c = cmd.get('cmd', '')
        if c == 'set_pin':
            pin = cmd['pin']
            val = cmd.get('value', 0)
            try:
                if gpio_sock:
                    gpio_sock.sendall(f'SET {pin} {val}\n'.encode())
            except Exception:
                pass
        elif c == 'stop':
            stopped.set()
            break
    
    # Cleanup
    if gpio_sock:
        gpio_sock.close()
    if serial_sock:
        serial_sock.close()
    proc.kill()
    proc.wait(timeout=5)
    try:
        os.unlink(fw_path)
    except OSError:
        pass
    log('Worker stopped')
    os._exit(0)

if __name__ == '__main__':
    main()
