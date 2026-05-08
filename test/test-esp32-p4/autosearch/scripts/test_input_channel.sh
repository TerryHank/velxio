#!/usr/bin/env bash
# Phase 2.X.input — end-to-end test of the reverse channel.
# Creates a fifo, launches QEMU with VELXIO_GPIO_INPUT pointing to it,
# writes a few JSON button events, and verifies that pin transitions
# show up in stderr.
set -u
FIFO=/tmp/velxio-input.fifo
LOG=/tmp/velxio-gpio.jsonl
rm -f "$FIFO" "$LOG" /tmp/qkrn_long.log
mkfifo "$FIFO"

cd /root
VELXIO_GPIO_INPUT="$FIFO" VELXIO_GPIO_LOG="$LOG" \
  /root/qemu-p4-build/qemu-system-riscv32 \
    -M esp32p4 \
    -kernel /root/blink.elf \
    -drive file=/root/blink.merged.bin,if=mtd,format=raw \
    -nographic > /tmp/qkrn_long.log 2>&1 &
QPID=$!

# Wait for QEMU to come up
sleep 1

# Inject 4 frontend events: pin 8 ON/OFF, then pin 12 ON, then pin 8 OFF.
# Use a background subshell so the writer doesn't block (fifo expects readers).
{
  sleep 0.5; echo '{"pin":8,"level":1}'
  sleep 0.5; echo '{"pin":12,"level":1}'
  sleep 0.5; echo '{"pin":8,"level":0}'
  sleep 0.5; echo '{"pin":12,"level":0}'
} > "$FIFO"

# Let the running light + button continue a moment, then kill.
sleep 2
kill -15 $QPID 2>/dev/null
wait 2>/dev/null

echo "=== STDERR (last 20 lines) ==="
tail -20 /tmp/qkrn_long.log
echo "=== Frontend-injected pins (8 + 12) in JSON log ==="
grep -E '"pin":(8|12)' "$LOG" 2>/dev/null
echo "=== Total events ==="
wc -l "$LOG" 2>/dev/null
