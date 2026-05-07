#!/usr/bin/env bash
cd /root
/root/qemu-p4-build/qemu-system-riscv32 \
  -M esp32p4 \
  -kernel /root/blink.elf \
  -drive file=/root/blink.merged.bin,if=mtd,format=raw \
  -nographic 2>&1 &
QPID=$!
sleep 8
kill -15 $QPID 2>/dev/null
wait 2>/dev/null
