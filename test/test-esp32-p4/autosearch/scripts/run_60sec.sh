#!/usr/bin/env bash
cd /root
/root/qemu-p4-build/qemu-system-riscv32 \
  -M esp32p4 \
  -bios /root/p4rom.elf \
  -drive file=/root/blink.merged.bin,if=mtd,format=raw \
  -nographic > /root/qlong60.log 2>&1 &
QPID=$!
sleep 60
kill -15 $QPID 2>/dev/null
wait 2>/dev/null

echo "=== qlong60.log ==="
cat /root/qlong60.log
