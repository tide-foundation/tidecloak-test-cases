#!/usr/bin/env bash
# Copies test reports and scrubbed stack logs into a clean folder for upload,
# leaving out what must never be published: traces and other zips, browser
# auth state, env files. ci/scan-uploads.sh then checks what is left.
#
# Writes two folders:
#   $CI_UPLOAD_DIR/reports   HTML/JSON reports and stack logs
#   $CI_UPLOAD_DIR/status    the per-suite status files the summary reads
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
command -v rsync >/dev/null 2>&1 || die "rsync is not installed; the staging step needs it to leave traces and env files behind"
upload="${CI_UPLOAD_DIR:-${RUNNER_TEMP:-/tmp}/tide-upload}"
rm -rf "$upload"
mkdir -p "$upload/reports" "$upload/status"

if [ ! -d "$CI_REPORTS_DIR" ]; then
    log "no reports at $CI_REPORTS_DIR"
    exit 0
fi

rsync -a --no-links \
    --exclude 'status/' \
    --exclude '*.zip' --exclude 'trace/' --exclude 'traces/' \
    --exclude '.auth/' --exclude 'node_modules/' \
    --exclude '.env' --exclude '.env.*' --exclude '*.env' \
    --exclude 'storage-state*' --exclude 'storageState*' \
    --exclude '*.pem' --exclude '*.key' \
    "$CI_REPORTS_DIR/" "$upload/reports/"
if [ -d "$CI_REPORTS_DIR/status" ]; then
    rsync -a --no-links "$CI_REPORTS_DIR/status/" "$upload/status/"
fi
du -sh "$upload/reports" "$upload/status" | sed 's/^/[ci] staged /'
