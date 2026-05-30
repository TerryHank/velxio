#!/usr/bin/env bash
# Phase 2.DN — run the DMA-mode AES self-test.
set -u
ROM=/mnt/c/Desarrollo/velxio/third-party/esp-rom-elfs/esp32p4_rev0_rom.elf
FW=/mnt/c/Desarrollo/velxio/test/test-esp32-p4/sketches/blink/build/esp32.esp32.esp32p4/blink.ino.merged.bin
QEMU="$HOME/qemu-p4-build/qemu-system-riscv32"
export VELXIO_GPIO_LOG=/tmp/aesdma_events.jsonl
rm -f /tmp/aesdma_events.jsonl /tmp/aesdma_stderr.txt

timeout 5 "$QEMU" -M esp32p4 -bios "$ROM" \
  -drive file="$FW",if=mtd,format=raw -nographic \
  >/tmp/aesdma_stdout.txt 2>/tmp/aesdma_stderr.txt

echo "=== AES-DMA self-test ==="
grep -i "esp32p4.aes\] self-test DMA" /tmp/aesdma_stderr.txt | head
echo "=== AES-DMA op lines ==="
grep -iE "esp32p4.aes\] op#.*DMA" /tmp/aesdma_stderr.txt | head
echo "=== regression (SHA-DMA + AXI-DMA still pass) ==="
grep -iE "DMA-SHA256|axi_dma\] self-test A" /tmp/aesdma_stderr.txt | head -3
