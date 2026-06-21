#!/usr/bin/env python3
"""STM32 full-chain test: compile -> simulate -> verify output"""
import json, base64, time, subprocess, sys, os

BASE = "http://localhost:8002"
FW_CODE = """void setup(){pinMode(PC13,OUTPUT);Serial.begin(115200);Serial.println("HELLO");} void loop(){digitalWrite(PC13,HIGH);delay(200);digitalWrite(PC13,LOW);delay(200);}"""
FQBN = "STMicroelectronics:stm32:GenF1:pnum=BLUEPILL_F103C8"

# Step 1: Compile
print("=== Step 1: Compile ===")
import urllib.request, urllib.error
req = urllib.request.Request(
    f"{BASE}/api/compile/start",
    data=json.dumps({"files": [{"name": "sketch.ino", "content": FW_CODE}], "board_fqbn": FQBN}).encode(),
    headers={"Content-Type": "application/json", "Origin": "https://terryhank.github.io"}
)
resp = urllib.request.urlopen(req)
job = json.loads(resp.read())
job_id = job["job_id"]
print(f"  Job ID: {job_id}")

# Wait for compile
for i in range(30):
    time.sleep(3)
    req2 = urllib.request.Request(f"{BASE}/api/compile/status/{job_id}")
    resp2 = urllib.request.urlopen(req2)
    st = json.loads(resp2.read())
    if st["state"] == "done":
        break
    print(f"  ... {st['state']}")

result = st.get("result", {})
if not result.get("success"):
    print(f"  COMPILE FAILED: {result.get('error')}")
    sys.exit(1)

print(f"  COMPILE OK: {result.get('binary_type')}, stdout: {result.get('stdout','')[:100]}")

# Step 2: Test worker directly
print("\n=== Step 2: Test stm32_worker ===")
fw_b64 = result["binary_content"]
cfg = json.dumps({
    "lib_path": "/app/app/services/libqemu-arm.so",
    "firmware_b64": fw_b64,
    "machine": "stm32-f103c8-picsimlab-new",
    "sensors": []
})

proc = subprocess.Popen(
    [sys.executable, "/app/app/services/stm32_worker.py"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE
)
proc.stdin.write((cfg + "\n").encode())
proc.stdin.flush()

# Read events with timeout
import select, signal
signal.alarm(20)  # 20 second timeout
events = []
try:
    while True:
        line = proc.stdout.readline()
        if not line:
            break
        line = line.strip()
        if line:
            try:
                evt = json.loads(line)
                events.append(evt)
                etype = evt.get("type", "")
                print(f"  Event: {etype} -> {json.dumps(evt)[:150]}")
                if etype == "system" and evt.get("event") in ("booted", "crash"):
                    break
            except:
                print(f"  RAW: {line[:200]}")
except Exception as e:
    print(f"  Exception: {e}")

# Read stderr
stderr = proc.stderr.read().decode(errors='replace')
if stderr:
    for line in stderr.strip().split('\n')[:10]:
        print(f"  stderr: {line[:200]}")

# Stop worker
try:
    proc.stdin.write(b'{"cmd":"stop"}\n')
    proc.stdin.flush()
    proc.wait(timeout=5)
except:
    proc.kill()

print(f"\n  Total events: {len(events)}")
booted = any(e.get("type") == "system" and e.get("event") == "booted" for e in events)
print(f"  Booted: {booted}")
if not booted:
    print("  *** WORKER DID NOT BOOT ***")
    sys.exit(1)

print("\n=== RESULT: STM32 simulation works! ===")
