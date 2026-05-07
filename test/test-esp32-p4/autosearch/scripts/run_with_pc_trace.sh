#!/usr/bin/env bash
cd /root
/root/qemu-p4-build/qemu-system-riscv32 \
  -M esp32p4 \
  -bios /root/p4rom.elf \
  -drive file=/root/blink.merged.bin,if=mtd,format=raw \
  -nographic \
  -d in_asm -D /root/qpc.log > /root/qpc_stdout.log 2>&1 &
QPID=$!
sleep 180
kill -15 $QPID 2>/dev/null
wait 2>/dev/null

echo "=== STDOUT ==="
cat /root/qpc_stdout.log
echo
echo "=== Trace size ==="
wc -l /root/qpc.log
echo
echo "=== Hot PCs ==="
grep -oE '0x4(ff|fc|00)[0-9a-f]{5}' /root/qpc.log | sort | uniq -c | sort -rn | head -15
echo
echo "=== Last 30 trace lines ==="
tail -30 /root/qpc.log
