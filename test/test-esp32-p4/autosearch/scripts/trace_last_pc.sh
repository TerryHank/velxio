#!/usr/bin/env bash
# Run with PC trace for 20s, then examine LAST 200 lines (current execution state)
# rather than aggregate hot-PCs.
cd /root
/root/qemu-p4-build/qemu-system-riscv32 \
  -M esp32p4 \
  -kernel /root/blink.elf \
  -drive file=/root/blink.merged.bin,if=mtd,format=raw \
  -nographic \
  -d in_asm -D /root/qlast.log > /root/qlast_stdout.log 2>&1 &
QPID=$!
sleep 20
kill -15 $QPID 2>/dev/null
wait 2>/dev/null

echo "=== STDOUT ==="
cat /root/qlast_stdout.log | head -10
echo
echo "=== Trace size ==="
wc -l /root/qlast.log
echo
echo "=== Distinct functions in LAST 1000 lines ==="
tail -1000 /root/qlast.log | grep '^IN: ' | sort -u
echo
echo "=== LAST PCs (most recent) ==="
tail -50 /root/qlast.log
