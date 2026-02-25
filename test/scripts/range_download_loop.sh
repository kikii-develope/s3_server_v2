#!/usr/bin/env bash
# ============================================================================
# range_download_loop.sh — Range download N iterations with leak detection
#
# Usage:
#   ./range_download_loop.sh          # 100 iterations with test_120mb.bin
#   ./range_download_loop.sh 200      # 200 iterations
#
# Checks:
#   - HTTP 206 responses
#   - Content-Range header consistency
#   - FD count / RSS stability (no leaks)
#   - No MaxListeners warning in server log
# ============================================================================
set -uo pipefail
source "$(dirname "$0")/_common.sh"

SCENARIO="range-download-loop"
ITERATIONS="${1:-100}"
TEST_FILE="${TEST_FILES_DIR}/test_120mb.bin"
UPLOAD_DIR="${UPLOAD_PATH}/range-test"
FNAME="range_test_file.bin"

trap 'cleanup_webdav "${UPLOAD_DIR}"' EXIT

begin_scenario "$SCENARIO"
passed=1

# --- Pre-check ---
if [ ! -f "$TEST_FILE" ]; then
  fail "Missing: ${TEST_FILE} (run gen_test_files.sh)"
  end_scenario "$SCENARIO" 0
  exit 1
fi

# --- 1) Upload file for range testing ---
info "Uploading test file..."
upload_resp=$(curl -s -X POST "${BASE_URL}/webdav/upload" \
  -F "path=${UPLOAD_DIR}" \
  -F "filename=${FNAME}" \
  -F "file=@${TEST_FILE}" \
  --max-time 300)

upload_status=$(jval "$upload_resp" ".status")
if [ "$upload_status" != "200" ]; then
  fail "Upload failed: $(echo "$upload_resp" | head -c 200)"
  end_scenario "$SCENARIO" 0
  exit 1
fi

DOWNLOAD_PATH="${UPLOAD_DIR}/${FNAME}"
FILE_SIZE=$(file_size_bytes "$TEST_FILE")
ok "Uploaded: ${FNAME} (${FILE_SIZE} bytes)"

# --- 2) Range download loop ---
info "Starting ${ITERATIONS} random Range requests..."
status_206=0
status_200=0
status_416=0
status_other=0
cr_ok=0
cr_fail=0
fd_start=$(get_fd_count)
rss_start=$(get_rss_mb)

for i in $(seq 1 "$ITERATIONS"); do
  # Random range within file
  max_start=$((FILE_SIZE - 1024))
  [ "$max_start" -lt 1 ] && max_start=1
  range_start=$((RANDOM % max_start))
  range_len=$(( (RANDOM % 1048576) + 1024 ))   # 1KB ~ 1MB
  range_end=$((range_start + range_len - 1))
  [ "$range_end" -ge "$FILE_SIZE" ] && range_end=$((FILE_SIZE - 1))

  expected_len=$((range_end - range_start + 1))

  resp_headers=$(curl -s -D - -o /dev/null \
    -H "Range: bytes=${range_start}-${range_end}" \
    --max-time 10 \
    "${BASE_URL}/webdav/download/${DOWNLOAD_PATH}" 2>/dev/null)

  http_code=$(echo "$resp_headers" | grep -i "^HTTP/" | tail -1 | awk '{print $2}')

  case "$http_code" in
    206)
      status_206=$((status_206 + 1))
      # Verify Content-Range
      cr=$(echo "$resp_headers" | grep -i "^content-range:" | tr -d '\r')
      if echo "$cr" | grep -qi "bytes ${range_start}-${range_end}/${FILE_SIZE}"; then
        cr_ok=$((cr_ok + 1))
      else
        cr_fail=$((cr_fail + 1))
        [ "$cr_fail" -le 3 ] && warn "  Content-Range mismatch #${i}: ${cr}"
      fi
      ;;
    200) status_200=$((status_200 + 1)) ;;
    416) status_416=$((status_416 + 1)) ;;
    *)   status_other=$((status_other + 1))
         [ "$status_other" -le 3 ] && warn "  Unexpected status #${i}: ${http_code}" ;;
  esac

  # Progress
  if [ $((i % 25)) -eq 0 ]; then
    info "  Progress: ${i}/${ITERATIONS} | 206: ${status_206}"
  fi
done

fd_end=$(get_fd_count)
rss_end=$(get_rss_mb)

# --- 3) Results ---
echo ""
info "HTTP status distribution:"
info "  206 (Partial):  ${status_206}"
info "  200 (Full):     ${status_200}"
info "  416 (Invalid):  ${status_416}"
info "  Other:          ${status_other}"
info "Content-Range:  OK=${cr_ok}  Fail=${cr_fail}"
info "FD count:       ${fd_start} -> ${fd_end} (delta: $((fd_end - fd_start)))"
info "RSS:            ${rss_start}MB -> ${rss_end}MB"

# --- 4) MaxListeners check ---
if [ -f "$SERVER_LOG" ]; then
  ml_count=$(grep -c "MaxListeners" "$SERVER_LOG" 2>/dev/null || echo "0")
  if [ "$ml_count" -gt 0 ]; then
    fail "MaxListeners warning in server log (${ml_count} occurrences)"
    passed=0
  else
    ok "No MaxListeners warnings"
  fi
else
  info "(Server log not available for MaxListeners check)"
fi

# --- 5) Validation ---
min_206=$((ITERATIONS * 80 / 100))
if [ "$status_206" -lt "$min_206" ]; then
  fail "Too few 206 responses: ${status_206} < ${min_206} (80%)"
  passed=0
else
  ok "206 rate: ${status_206}/${ITERATIONS}"
fi

if [ "$cr_fail" -gt 0 ]; then
  fail "Content-Range mismatches: ${cr_fail}"
  passed=0
else
  ok "Content-Range all consistent"
fi

fd_delta=$((fd_end - fd_start))
if [ "$fd_delta" -gt 50 ]; then
  fail "FD leak suspected: +${fd_delta} over ${ITERATIONS} requests"
  passed=0
else
  ok "FD stable (delta: ${fd_delta})"
fi

end_scenario "$SCENARIO" "$passed"
[ "$passed" = "1" ] && exit 0 || exit 1
