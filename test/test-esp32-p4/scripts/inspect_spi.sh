#!/usr/bin/env bash
LOG=${LOG:-/tmp/velxio-gpio.jsonl}
echo "=== spi + spi_rx events ==="
grep -E '"spi"|"spi_rx"' "$LOG"
echo
echo "=== all event types ==="
grep -oE '"event":"[a-z_]+"' "$LOG" | sort | uniq -c
echo
echo "=== total lines ==="
wc -l < "$LOG"
