#!/usr/bin/env bash
set -Eeuo pipefail

# -------------------------------
# Config / Inputs
# -------------------------------
BASE_URL="${1:-${BASE_URL:-https://login.dauth.me}}"
ALLURE_RESULTS_DIR="${ALLURE_RESULTS_DIR:-./reports}"   # matches pytest.ini addopts
CURL_FLAGS="${CURL_FLAGS:--fsSIL --max-time 10}"        # add -k if TLS is self-signed
WAIT_SECONDS="${WAIT_SECONDS:-120}"                     # total wait for health check

echo "[+] Target base URL: $BASE_URL"

# -------------------------------
# Virtualenv
# -------------------------------
if [[ ! -d "venv" ]]; then
  echo "[-] Virtual environment 'venv' not found. Run setup-environment.sh first."
  exit 1
fi
echo "[+] Activating virtual environment..."
# shellcheck disable=SC1091
source venv/bin/activate

# -------------------------------
# Tool checks
# -------------------------------
need() { command -v "$1" >/dev/null 2>&1 || { echo "[-] '$1' not found"; exit 1; }; }
need curl
need pytest
need allure || { echo "[-] 'allure' CLI not found. Install Allure first."; exit 1; }

# -------------------------------
# Skip Docker even if compose file exists
# -------------------------------
if [[ -f "docker-compose.yml" ]]; then
  echo "[i] docker-compose.yml detected; skipping Docker because the service is hosted."
fi

# -------------------------------
# Wait for hosted service
# -------------------------------
echo "[+] Waiting for remote service to be reachable..."
deadline=$((SECONDS + WAIT_SECONDS))
until curl $CURL_FLAGS "$BASE_URL" >/dev/null 2>&1; do
  if (( SECONDS >= deadline )); then
    echo "[-] Timed out after ${WAIT_SECONDS}s waiting for $BASE_URL"
    exit 1
  fi
  echo "[x] Remote service not ready yet; retrying..."
  sleep 5
done
echo "[+] Remote service is reachable!"

# -------------------------------
# Run tests (pytest.ini controls testpaths, patterns, and --alluredir)
# -------------------------------
echo "[+] Cleaning previous Allure results at: $ALLURE_RESULTS_DIR"
rm -rf "$ALLURE_RESULTS_DIR"

echo "[+] Running tests..."
export BASE_URL                         # make it visible to tests if they read BASE_URL
# If your suite prefers a CLI flag (e.g., --base-url), add it here:
# pytest --base-url "$BASE_URL"
pytest
TEST_EXIT_CODE=$?

if [[ $TEST_EXIT_CODE -eq 0 ]]; then
  echo "[+] All tests passed."
else
  echo "[!] Some tests failed; generating/viewing report anyway."
fi

# -------------------------------
# Serve Allure report
# -------------------------------
cleanup() {
  echo ""
  echo "[+] Cleanup complete."
}
trap cleanup SIGINT SIGTERM EXIT

echo "[+] Launching Allure report viewer from: $ALLURE_RESULTS_DIR"
if ! allure serve "$ALLURE_RESULTS_DIR"; then
  echo "[i] 'allure serve' failed or not supported; generating static report..."
  allure generate "$ALLURE_RESULTS_DIR" -c -o ./allure-report
  echo "[+] Static report generated at: ./allure-report"
  echo "[+] Starting simple HTTP server on http://localhost:8000 (Ctrl+C to stop)"
  python3 -m http.server 8000 --directory ./allure-report
fi

exit "$TEST_EXIT_CODE"

