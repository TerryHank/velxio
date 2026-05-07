#!/usr/bin/env bash
# Sync, build, run with trace
set -e
cd /root/qemu-lcgamboa
rsync -a --no-perms --no-times \
  /mnt/c/Desarrollo/velxio/third-party/qemu-lcgamboa/hw/riscv/esp32p4.c \
  hw/riscv/esp32p4.c
dos2unix hw/riscv/esp32p4.c 2>/dev/null

cd /root/qemu-p4-build
make -j$(nproc) qemu-system-riscv32 2>&1 | tail -3

echo "=== Run with trace ==="
cd /root
( /root/qemu-p4-build/qemu-system-riscv32 \
    -M esp32p4 \
    -bios /root/p4rom.elf \
    -drive file=/root/blink.merged.bin,if=mtd,format=raw \
    -nographic \
    -d unimp,guest_errors,in_asm -D /root/qrun.log 2>&1 | head -25 ) &
QEMU_PID=$!
sleep 5
kill -15 $QEMU_PID 2>/dev/null || true
wait 2>/dev/null

echo
echo "=== log lines ==="
wc -l /root/qrun.log
echo
echo "=== Last 25 lines (current poll loop) ==="
tail -25 /root/qrun.log
echo
echo "=== Top 5 hot PCs ==="
grep -oE '0x4fc[0-9a-f]{5}' /root/qrun.log | sort | uniq -c | sort -rn | head -5
