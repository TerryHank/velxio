#!/usr/bin/env bash
# Trace ROM/bootloader execution looking for the boot_comm chip ID check
cd /root
( /root/qemu-p4-build/qemu-system-riscv32 \
    -M esp32p4 \
    -bios /root/p4rom.elf \
    -drive file=/root/blink.merged.bin,if=mtd,format=raw \
    -nographic \
    -d in_asm,exec -D /root/qrun_bc.log 2>&1 ) > /root/qrun_bc_stdout.log &
QEMU_PID=$!
sleep 10
kill -15 $QEMU_PID 2>/dev/null || true
wait 2>/dev/null

echo "=== stdout ==="
cat /root/qrun_bc_stdout.log
echo
echo "=== qrun_bc.log lines ==="
wc -l /root/qrun_bc.log
echo
echo "=== Find bootloader_common_check_chip_validity flow ==="
echo "Last 50 lines (right before error):"
tail -50 /root/qrun_bc.log
