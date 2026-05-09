#!/usr/bin/env bash
LOG=${LOG:-/tmp/velxio-gpio.jsonl}
echo "=== Pin distribution ==="
grep -oP '"pin":\d+' "$LOG" | sort | uniq -c | sort -rn | head -15
echo
echo "=== First 5 timg events ==="
grep -E 'timg' "$LOG" | head -5
echo
echo "=== Pin 8 transitions (first 8) ==="
grep '"pin":8,' "$LOG" | head -8
echo
echo "=== Total counts ==="
echo "  total: $(wc -l < "$LOG")"
echo "  pin8:  $(grep -c '"pin":8,' "$LOG")"
echo "  timg:  $(grep -cE 'event":"timg"' "$LOG")"
echo "  timg_irq: $(grep -cE 'event":"timg_irq"' "$LOG")"
