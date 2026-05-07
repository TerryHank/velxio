#!/usr/bin/env bash
# Trace post-CLIC ROM execution
cd /root
timeout 5 /root/qemu-p4-build/qemu-system-riscv32 \
  -M esp32p4 \
  -bios /root/p4rom.elf \
  -drive file=/root/blink.merged.bin,if=mtd,format=raw \
  -nographic \
  -d unimp,guest_errors,in_asm -D /root/qrun_2d.log 2>&1 | head -30 || true

echo
echo "=== Total log lines ==="
wc -l /root/qrun_2d.log

echo
echo "=== Last 30 lines (whats it doing now?) ==="
tail -30 /root/qrun_2d.log

echo
echo "=== Unique PCs (most-hit, top 10) ==="
grep -oE '0x4fc[0-9a-f]{5}' /root/qrun_2d.log | sort | uniq -c | sort -rn | head -10
