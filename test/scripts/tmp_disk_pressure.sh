#!/usr/bin/env bash
# ============================================================================
# tmp_disk_pressure.sh — /tmp disk pressure test
#
# Usage:
#   ./tmp_disk_pressure.sh
#
# Safety:
#   - Creates dummy files ONLY inside a dedicated subfolder
#   - Checks available space before proceeding (need 2GB+)
#   - Cleanup runs on exit (trap)
#   - Caps fill at 4GB max to prevent system damage
# ============================================================================
set -uo pipefail
source "$(dirname "$0")/_common.sh"

SCENARIO="tmp-disk-pressure"
UPLOAD_DIR="${UPLOAD_PATH}/disk-pressure"
TEST_FILE="${TEST_FILES_DIR}/test_120mb.bin"
PRESSURE_DIR="${OS_TMPDIR}/webdav-pressure-test"

cleanup_pressure() {
  info "Cleaning up pressure files..."
  rm -rf "${PRESSURE_DIR}" 2>/dev/null || true
}
trap 'cleanup_pressure; cleanup_webdav "${UPLOAD_DIR}" 2>/dev/null' EXIT

begin_scenario "$SCENARIO"
passed=1

if [ ! -f "$TEST_FILE" ]; then
  fail "Missing: ${TEST_FILE} (run gen_test_files.sh)"
  end_scenario "$SCENARIO" 0
  exit 1
fi

# --- 1. Check available space ---
avail_before=$(get_avail_mb)
info "Available space in ${OS_TMPDIR}: ${avail_before}MB"

if [ "$avail_before" -lt 2048 ]; then
  warn "Insufficient space for safe pressure test (need 2GB+, have ${avail_before}MB)"
  warn "Skipping test"
  end_scenario "$SCENARIO" 1
  exit 0
fi

# --- 2. Fill disk leaving ~200MB free ---
mkdir -p "$PRESSURE_DIR"
TARGET_FREE_MB=200
FILL_MB=$((avail_before - TARGET_FREE_MB))

# Safety cap
MAX_FILL_MB=4096
[ "$FILL_MB" -gt "$MAX_FILL_MB" ] && FILL_MB=$MAX_FILL_MB

info "Filling ${FILL_MB}MB in ${PRESSURE_DIR}..."
filled=0
chunk_idx=0
while [ "$filled" -lt "$FILL_MB" ]; do
  chunk_mb=512
  remaining=$((FILL_MB - filled))
  [ "$chunk_mb" -gt "$remaining" ] && chunk_mb=$remaining

  dd if=/dev/zero of="${PRESSURE_DIR}/fill_${chunk_idx}.dat" \
    bs=1048576 count="$chunk_mb" 2>/dev/null || {
    warn "dd failed at chunk ${chunk_idx} (disk might be full already)"
    break
  }
  filled=$((filled + chunk_mb))
  chunk_idx=$((chunk_idx + 1))
done

avail_after_fill=$(get_avail_mb)
info "Available after fill: ${avail_after_fill}MB (target: ~${TARGET_FREE_MB}MB)"

# --- 3. Try upload under pressure ---
info "Attempting 120MB upload under disk pressure (expect graceful failure)..."
upload_start=$(now_ms)
resp=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/webdav/upload" \
  -F "path=${UPLOAD_DIR}" \
  -F "filename=pressure_test.bin" \
  -F "file=@${TEST_FILE}" \
  --max-time 120)

http_code=$(echo "$resp" | tail -1)
body=$(echo "$resp" | sed '$d')
upload_elapsed=$(( $(now_ms) - upload_start ))

info "Response: HTTP ${http_code} (${upload_elapsed}ms)"

if [ "$http_code" = "200" ]; then
  # Succeeding despite low space is also acceptable (WebDAV backend has space)
  ok "Upload succeeded despite low local disk (WebDAV backend had space)"
elif [ "$http_code" = "500" ] || [ "$http_code" = "400" ] || [ "$http_code" = "413" ] || [ "$http_code" = "507" ]; then
  ok "Upload failed gracefully: HTTP ${http_code}"
  err_msg=$(jval "$body" ".message")
  info "Error message: ${err_msg}"
elif [ "$http_code" = "000" ]; then
  fail "No response (connection dropped — possible server crash)"
  passed=0
else
  warn "Unexpected response: HTTP ${http_code}"
fi

# --- 4. Release pressure ---
cleanup_pressure

# --- 5. Check cleanup ---
sleep 2
multer_count=$(count_multer_tmp)
merge_count=$(count_merge_tmp)
info "After pressure release: multer tmp=${multer_count}, merge dirs=${merge_count}"

# --- 6. Verify server is alive ---
if ! wait_for_server 10; then
  fail "Server not responsive after disk pressure test"
  passed=0
  # Try restart
  start_server || true
fi

# --- 7. Normal upload after pressure release ---
info "Verifying normal upload works after pressure release..."
verify_resp=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/webdav/upload" \
  -F "path=${UPLOAD_DIR}" \
  -F "filename=after_pressure.bin" \
  -F "file=@${TEST_FILES_DIR}/test_1mb.bin" \
  --max-time 30)

verify_code=$(echo "$verify_resp" | tail -1)
if [ "$verify_code" = "200" ]; then
  ok "Normal upload works after pressure release"
else
  fail "Normal upload failed after pressure release: HTTP ${verify_code}"
  passed=0
fi

end_scenario "$SCENARIO" "$passed"
[ "$passed" = "1" ] && exit 0 || exit 1
