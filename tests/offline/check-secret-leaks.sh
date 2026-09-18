#!/usr/bin/env bash
# Runs the offline fillSecret spec with the HTML reporter and trace on, unpacks every zip
# (the report's embedded base64 zip and each trace.zip), then greps for the dummy values.
# Passes when the fillSecret value is found 0 times and the plain-fill canary is found.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${SECRET_CHECK_OUT:-$(mktemp -d)}"
export SECRET_CHECK_OUT="$OUT"
rm -rf "$OUT/report" "$OUT/test-results" "$OUT/unzipped"

npx playwright test -c offline/playwright.config.js

SECRET=$(node -p "require('./offline/secrets').SECRET")
CANARY=$(node -p "require('./offline/secrets').CANARY")
UNZ="$OUT/unzipped"
mkdir -p "$UNZ/report-embedded"

grep -o 'data:application/zip;base64,[A-Za-z0-9+/=]*' "$OUT/report/index.html" \
    | sed 's/^data:application\/zip;base64,//' | base64 -d > "$UNZ/report-embedded.zip"
unzip -o -q "$UNZ/report-embedded.zip" -d "$UNZ/report-embedded"

n=0
while IFS= read -r z; do
    n=$((n + 1))
    unzip -o -q "$z" -d "$UNZ/trace-$n"
done < <(find "$OUT/report" "$OUT/test-results" -name '*.zip')

echo
echo "output: $OUT"
echo "zips unpacked: report-embedded + $n trace zips"
echo "files scanned: $(find "$OUT/report" "$OUT/test-results" "$UNZ" -type f | wc -l)"

# Prints per-file hits to stderr and the total to stdout.
scan() {
    local label=$1 value=$2 hits
    hits=$(grep -rao -- "$value" "$OUT/report" "$OUT/test-results" "$UNZ" | wc -l)
    echo "$label hits: $hits (files below show matching lines)" >&2
    grep -raoc -- "$value" "$OUT/report" "$OUT/test-results" "$UNZ" | grep -v ':0$' | sed "s|$OUT/|  |" >&2 || true
    echo "$hits"
}

secret_hits=$(scan "fillSecret value" "$SECRET")
canary_hits=$(scan "plain fill canary" "$CANARY")

if [ "$secret_hits" -ne 0 ]; then
    echo "FAIL: the fillSecret value leaked" >&2
    exit 1
fi
if [ "$canary_hits" -eq 0 ]; then
    echo "FAIL: canary not found, so the scan is not seeing the recorded data" >&2
    exit 1
fi
echo "PASS"
