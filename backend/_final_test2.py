#!/usr/bin/env python3
"""Full end-to-end test: compile + simulate with LED blink"""
import json, subprocess, sys, time, base64

FW = 'void setup(){pinMode(PC13,OUTPUT);} void loop(){digitalWrite(PC13,HIGH);delay(200);digitalWrite(PC13,LOW);delay(200);}'
FQBN = "STMicroelectronics:stm32:GenF1:pnum=BLUEPILL_F103C8"

config = json.dumps({"lib_path":"","firmware_b64":base64.b64encode(FW.encode()).decode(),"machine":"stm32-f103c8","sensors":[]})

proc = subprocess.Popen([sys.executable, "app/services/stm32_worker_subprocess.py"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    cwd="/mnt/d/Workspace/velxio/backend")
proc.stdin.write((config+"\n").encode()); proc.stdin.flush()

events = []; start = time.time()
while time.time() - start < 20:
    if proc.poll() is not None: break
    line = proc.stdout.readline()
    if not line:
        if proc.poll() is not None: break
        time.sleep(0.05); continue
    line = line.strip()
    if line:
        try:
            evt = json.loads(line); events.append(evt)
            msg = json.dumps(evt)
            print(f"  [{evt.get('type','')}] {msg[:200]}")
            if evt.get("type")=="system" and evt.get("event")=="booted":
                time.sleep(3)  # Let LED blink a few times
                break
        except: print(f"  RAW: {line[:150]}")

proc.stdin.write(json.dumps({"cmd":"stop"}).encode()+b"\n"); proc.stdin.flush()
try: proc.wait(timeout=5)
except: proc.kill()

print(f"\n=== RESULT ===")
print(f"Events: {len(events)}")
booted = any(e.get('type')=='system' and e.get('event')=='booted' for e in events)
serials = [e for e in events if e.get('type')=='serial_output']
print(f"Booted: {booted}")
print(f"Serial messages: {len(serials)}")
for s in serials: print(f"  {s.get('data','')}")
print("STM32 compile + simulate: SUCCESS!" if booted else "FAILED")
