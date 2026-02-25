#!/usr/bin/env bash
# ============================================================================
# chaos_kill_during_upload.sh — Kill server during upload, verify cleanup
#
# Usage:
#   ./chaos_kill_during_upload.sh
#
# Flow:
#   1. Start uploading 120MB file in background
#   2. Kill server after 3 seconds
#   3. Check tmpdir for leftover files
#   4. Restart server
#   5. Re-upload same file
#   6. Verify success + no stale filename reservations + stats normal
#
# WARNING: This WILL kill your running dev server and restart it in background.
#          After the test, the server runs via `nohup npm run dev &`.
# ============================================================================
set -uo pipefail
source "$(dirname "$0")/_common.sh"

SCENARIO="chaos-kill-upload"
UPLOAD_DIR="${UPLOAD_PATH}/chaos-test"
TEST_FILE="${TEST_FILES_DIR}/test_120mb.bin"
FNAME="chaos_test.bin"
KILL_DELAY=3

trap 'cleanup_webdav "${UPLOAD_DIR}" 2>/dev/null' EXIT

begin_scenario "$SCENARIO"
passed=1

if [ ! -f "$TEST_FILE" ]; then
  fail "Missing: ${TEST_FILE} (run gen_test_files.sh)"
  end_scenario "$SCENARIO" 0
  exit 1
fi

# --- 1. Snapshot tmpdir before ---
multer_before=$(count_multer_tmp)
merge_before=$(count_merge_tmp)
info "Tmpdir before: multer=${multer_before}, merge=${merge_before}"

# --- 2. Start upload in background ---
fsize=$(file_size_bytes "$TEST_FILE")
info "Starting background upload: ${FNAME} (${fsize} bytes)..."

curl -s -X POST "${BASE_URL}/webdav/upload" \
  -F "path=${UPLOAD_DIR}" \
  -F "filename=${FNAME}" \
  -F "file=@${TEST_FILE}" \
  --max-time 120 \
  > "${RESULTS_DIR}/chaos_upload_resp.json" 2>&1 &
UPLOAD_PID=$!

# --- 3. Wait then kill ---
info "Waiting ${KILL_DELAY}s before kill..."
sleep "$KILL_DELAY"

kill_server

# Give curl time to see the connection drop
sleep 2
kill "$UPLOAD_PID" 2>/dev/null || true
wait "$UPLOAD_PID" 2>/dev/null || true

# --- 4. Check tmpdir after crash ---
multer_after_crash=$(count_multer_tmp)
merge_after_crash=$(count_merge_tmp)
info "Tmpdir after crash: multer=${multer_after_crash}, merge=${merge_after_crash}"

multer_leaked=$((multer_after_crash - multer_before))
merge_leaked=$((merge_after_crash - merge_before))

if [ "$multer_leaked" -gt 0 ]; then
  warn "Multer tmp leaked: +${multer_leaked} (expected on crash — no cleanup handler ran)"
fi
if [ "$merge_leaked" -gt 0 ]; then
  warn "Merge tmp leaked: +${merge_leaked} (expected on crash — finally block didn't run)"
fi

# --- 5. Restart server ---
info "Restarting server..."
if ! start_server; then
  fail "Server restart failed"
  end_scenario "$SCENARIO" 0
  exit 1
fi

# --- 6. Re-upload same file ---
info "Re-uploading ${FNAME} after restart..."
retry_start=$(now_ms)
retry_resp=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/webdav/upload" \
  -F "path=${UPLOAD_DIR}" \
  -F "filename=${FNAME}" \
  -F "file=@${TEST_FILE}" \
  --max-time 300)

retry_code=$(echo "$retry_resp" | tail -1)
retry_body=$(echo "$retry_resp" | sed '$d')
retry_elapsed=$(( $(now_ms) - retry_start ))

if [ "$retry_code" = "200" ]; then
  retry_fname=$(jval "$retry_body" ".filename")
  ok "Re-upload succeeded: HTTP ${retry_code} | ${retry_elapsed}ms | name=${retry_fname}"

  # Stale reservation check: original name should be available after server restart
  if [ "$retry_fname" = "$FNAME" ]; then
    ok "No stale filename reservation (got original name)"
  else
    warn "Filename changed to '${retry_fname}' — possible stale reservation or prior upload completed"
  fi
else
  fail "Re-upload failed: HTTP ${retry_code} | ${retry_elapsed}ms"
  fail "Body: $(echo "$retry_body" | head -c 300)"
  passed=0
fi

# --- 7. Check tmpdir after successful re-upload ---
sleep 2
multer_final=$(count_multer_tmp)
merge_final=$(count_merge_tmp)
info "Tmpdir final: multer=${multer_final}, merge=${merge_final}"

if [ "$merge_final" -gt "$merge_before" ]; then
  fail "Merge tmp dirs not cleaned: ${merge_final} (was ${merge_before})"
  passed=0
else
  ok "Merge tmp dirs clean"
fi

# --- 8. Post-restart stats ---
info "Post-restart stats:"
info "  Heap: $(get_heap_mb)MB | RSS: $(get_rss_mb)MB | FD: $(get_fd_count)"

end_scenario "$SCENARIO" "$passed"
[ "$passed" = "1" ] && exit 0 || exit 1
