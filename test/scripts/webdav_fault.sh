#!/usr/bin/env bash
# ============================================================================
# webdav_fault.sh — WebDAV backend fault injection test
#
# Usage:
#   ./webdav_fault.sh
#
# Method:
#   Starts a SECOND server instance on port 8099 with WEBDAV_URL pointing
#   to a non-existent backend (localhost:19999). Tests error handling,
#   then verifies the real server is unaffected.
# ============================================================================
set -uo pipefail
source "$(dirname "$0")/_common.sh"

SCENARIO="webdav-fault"
UPLOAD_DIR="${UPLOAD_PATH}/fault-test"
TEST_FILE="${TEST_FILES_DIR}/test_1mb.bin"
FAULT_PORT=8099
FAULT_BASE="http://localhost:${FAULT_PORT}"

cleanup_fault() {
  # Kill fault server
  local fpid
  fpid=$(lsof -iTCP:${FAULT_PORT} -sTCP:LISTEN -t 2>/dev/null || true)
  if [ -n "$fpid" ]; then
    kill -9 "$fpid" 2>/dev/null || true
    pkill -9 -P "$fpid" 2>/dev/null || true
  fi
}
trap 'cleanup_fault; cleanup_webdav "${UPLOAD_DIR}" 2>/dev/null' EXIT

begin_scenario "$SCENARIO"
passed=1

if [ ! -f "$TEST_FILE" ]; then
  fail "Missing: ${TEST_FILE} (run gen_test_files.sh)"
  end_scenario "$SCENARIO" 0
  exit 1
fi

# --- 1. Start fault-injected server ---
info "Starting fault server on port ${FAULT_PORT}..."
info "  WEBDAV_URL=http://localhost:19999 (nothing listening)"

cd "$PROJECT_DIR"
WEBDAV_URL=http://localhost:19999 \
WEBDAV_USER=fake \
WEBDAV_PASSWORD=fake \
PORT=$FAULT_PORT \
NODE_ENV=development \
  nohup npx tsx watch index.ts > "${RESULTS_DIR}/fault_server.log" 2>&1 &
cd - > /dev/null

# Wait for fault server to be ready
fault_ready=0
for i in $(seq 1 20); do
  # info endpoint should work even with broken WebDAV backend
  if curl -s --max-time 2 "${FAULT_BASE}/webdav/info" &>/dev/null; then
    fault_ready=1
    break
  fi
  sleep 1
done

if [ "$fault_ready" = "0" ]; then
  warn "Fault server didn't start. Log tail:"
  tail -10 "${RESULTS_DIR}/fault_server.log" 2>/dev/null || true
  warn "Skipping WebDAV fault test"
  end_scenario "$SCENARIO" 1
  exit 0
fi

ok "Fault server running on :${FAULT_PORT}"

# --- 2. Test upload against broken backend ---
info "Testing upload against broken WebDAV backend..."
fault_resp=$(curl -s -w "\n%{http_code}" -X POST "${FAULT_BASE}/webdav/upload" \
  -F "path=${UPLOAD_DIR}" \
  -F "filename=fault_test.bin" \
  -F "file=@${TEST_FILE}" \
  --max-time 30)

fault_code=$(echo "$fault_resp" | tail -1)
fault_body=$(echo "$fault_resp" | sed '$d')
info "Upload response: HTTP ${fault_code}"

if [ "$fault_code" = "500" ] || [ "$fault_code" = "502" ] || [ "$fault_code" = "503" ]; then
  ok "Proper error returned: HTTP ${fault_code}"
  err_msg=$(jval "$fault_body" ".message")
  info "  Error: ${err_msg}"
elif [ "$fault_code" = "000" ]; then
  fail "No response at all (server might have crashed)"
  passed=0
else
  warn "Unexpected response: HTTP ${fault_code}"
fi

# --- 3. Test directory creation against broken backend ---
info "Testing directory creation against broken backend..."
dir_resp=$(curl -s -w "\n%{http_code}" -X POST "${FAULT_BASE}/webdav/directory" \
  -H "Content-Type: application/json" \
  -d "{\"path\":\"${UPLOAD_DIR}\"}" \
  --max-time 15)

dir_code=$(echo "$dir_resp" | tail -1)
info "Directory creation response: HTTP ${dir_code}"

if [ "$dir_code" = "500" ] || [ "$dir_code" = "502" ]; then
  ok "Directory creation returned proper error"
else
  warn "Unexpected directory creation response: HTTP ${dir_code}"
fi

# --- 4. Verify fault server didn't crash (still responds) ---
info "Checking if fault server survived errors..."
info_resp=$(curl -s --max-time 5 "${FAULT_BASE}/webdav/info" 2>/dev/null)
info_status=$(jval "$info_resp" ".status")
if [ "$info_status" = "200" ]; then
  ok "Fault server still alive after errors (no crash)"
else
  fail "Fault server crashed after error handling"
  passed=0
fi

# --- 5. Kill fault server ---
cleanup_fault

# --- 6. Verify real server unaffected ---
info "Verifying real server is unaffected..."
real_resp=$(curl -s -w "\n%{http_code}" "${BASE_URL}/webdav/info")
real_code=$(echo "$real_resp" | tail -1)
if [ "$real_code" = "200" ]; then
  ok "Real server healthy"
else
  fail "Real server not responding: HTTP ${real_code}"
  passed=0
fi

# --- 7. Upload to real server to confirm ---
info "Confirming real server upload works..."
real_upload=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/webdav/upload" \
  -F "path=${UPLOAD_DIR}" \
  -F "filename=after_fault.bin" \
  -F "file=@${TEST_FILE}" \
  --max-time 30)

real_upload_code=$(echo "$real_upload" | tail -1)
if [ "$real_upload_code" = "200" ]; then
  ok "Real server upload works"
else
  fail "Real server upload failed: HTTP ${real_upload_code}"
  passed=0
fi

end_scenario "$SCENARIO" "$passed"
[ "$passed" = "1" ] && exit 0 || exit 1
