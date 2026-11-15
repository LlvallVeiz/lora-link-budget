#!/usr/bin/env bash
# Regenerate examples/output/* by running the real CLI.
# Run from the project root:  npm run examples
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build >/dev/null
CLI="node dist/src/cli.js"
OUT="examples/output"
mkdir -p "$OUT"

$CLI budget --preset rfm95 --freq 868 --distance 2 --sf 12 --bw 125 --env urban > "$OUT/budget-urban-sf12.txt"
$CLI range --preset sx1262-node --freq 915 --bw 125 --model log-distance --env rural > "$OUT/range-rural-sf12.txt"
$CLI airtime --sf 7 --bw 125 --payload 20 --duty 0.01 > "$OUT/airtime-sf7-20b.txt"
$CLI airtime --sf 12 --bw 125 --payload 64 --region US915 > "$OUT/airtime-sf12-64b-us915.txt"
$CLI sensitivity --chip sx1276 > "$OUT/sensitivity-sx1276.txt"
$CLI compare --file examples/batch-scenarios.json > "$OUT/compare-scenarios.txt"
# The CSV intentionally contains one bad row (SF6); compare exits 1, so
# tolerate it here — the error outcome is the point of that example.
$CLI compare --file examples/batch-scenarios.csv > "$OUT/compare-csv.txt" || true
$CLI batch --input examples/batch-scenarios.json --output "$OUT/batch-results.json"

echo "Regenerated $(ls "$OUT" | wc -l) files in $OUT/"
