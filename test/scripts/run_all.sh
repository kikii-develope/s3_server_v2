#!/usr/bin/env bash
# ============================================================================
# run_all.sh — Run all test scenarios in recommended order
#
# Usage:
#   ./run_all.sh                    # standard tests (1MB/50MB/120MB)
#   ./run_all.sh --large            # include 1GB/1.5GB tests
#   ./run_all.sh --skip-chaos       # skip chaos kill test
#   ./run_all.sh --skip-pressure    # skip disk pressure test
#   ./run_all.sh --skip-k6          # skip k6 load test
#
# Recommended execution order:
#   1. Basic performance (single + multi upload)
#   2. Same-name race condition
#   3. Chaos kill during upload
#   4. Disk pressure
#   5. WebDAV backend fault
#   6. Range download leak detection
#   7. k6 load test (if installed)
# ============================================================================
set -uo pipefail
source "$(dirname "$0")/_common.sh"

# Parse flags
RUN_LARGE=0
SKIP_CHAOS=0
SKIP_PRESSURE=0
SKIP_K6=0

for arg in "$@"; do
  case "$arg" in
    --large)          RUN_LARGE=1 ;;
    --skip-chaos)     SKIP_CHAOS=1 ;;
    --skip-pressure)  SKIP_PRESSURE=1 ;;
    --skip-k6)        SKIP_K6=1 ;;
    --help|-h)
      echo "Usage: $0 [--large] [--skip-chaos] [--skip-pressure] [--skip-k6]"
      exit 0 ;;
  esac
done

# ── Initialization ───────────────────────────────────────────────────────────
header "WebDAV Test Suite"
info "Base URL:      ${BASE_URL}"
info "Upload Path:   ${UPLOAD_PATH}"
info "Project Dir:   ${PROJECT_DIR}"
info "Results Dir:   ${RESULTS_DIR}"
info "OS Tmpdir:     ${OS_TMPDIR}"
info "Multer Tmpdir: ${MULTER_TMPDIR}"
info "Large files:   $([ $RUN_LARGE = 1 ] && echo 'YES' || echo 'no')"
echo ""

# Clear previous results
rm -f "${RESULTS_DIR}/results.jsonl"

# Check server
if ! wait_for_server 5; then
  fail "Server not reachable at ${BASE_URL}"
  fail "Start with: cd ${PROJECT_DIR} && npm run dev"
  exit 1
fi
ok "Server is running (PID: $(get_server_pid))"

# ── Phase 0: Generate Test Files ─────────────────────────────────────────────
header "Phase 0: Generate Test Files"
if [ "$RUN_LARGE" = "1" ]; then
  bash "${SCRIPT_DIR}/gen_test_files.sh" --large
else
  bash "${SCRIPT_DIR}/gen_test_files.sh"
fi

# ── Phase 1: Basic Performance ───────────────────────────────────────────────
header "Phase 1: Basic Performance"
bash "${SCRIPT_DIR}/single_upload.sh" || true
bash "${SCRIPT_DIR}/multi_upload.sh" || true

# Large file individual tests
if [ "$RUN_LARGE" = "1" ]; then
  for f in test_1gb.bin test_1500mb.bin; do
    fpath="${TEST_FILES_DIR}/${f}"
    if [ -f "$fpath" ]; then
      info "Large file test: ${f}"
      bash "${SCRIPT_DIR}/single_upload.sh" --file "$fpath" --filename "$f" || true
    fi
  done
fi

# ── Phase 2: Race Condition ──────────────────────────────────────────────────
header "Phase 2: Same-name Race Condition"
bash "${SCRIPT_DIR}/dir_race_same_name.sh" 8 || true

# ── Phase 3: Chaos Kill ──────────────────────────────────────────────────────
if [ "$SKIP_CHAOS" = "0" ]; then
  header "Phase 3: Chaos Kill During Upload"
  bash "${SCRIPT_DIR}/chaos_kill_during_upload.sh" || true
  # Ensure server is back
  if ! wait_for_server 30; then
    warn "Server not available after chaos test, restarting..."
    start_server || { fail "Could not restart server"; exit 1; }
  fi
else
  info "Skipping chaos test (--skip-chaos)"
fi

# ── Phase 4: Disk Pressure ───────────────────────────────────────────────────
if [ "$SKIP_PRESSURE" = "0" ]; then
  header "Phase 4: Disk Pressure (/tmp)"
  bash "${SCRIPT_DIR}/tmp_disk_pressure.sh" || true
else
  info "Skipping disk pressure test (--skip-pressure)"
fi

# ── Phase 5: WebDAV Fault ────────────────────────────────────────────────────
header "Phase 5: WebDAV Backend Fault Injection"
bash "${SCRIPT_DIR}/webdav_fault.sh" || true

# ── Phase 6: Range Download ──────────────────────────────────────────────────
header "Phase 6: Range Download Leak Detection"
bash "${SCRIPT_DIR}/range_download_loop.sh" 100 || true

# ── Phase 7: k6 Load Test ───────────────────────────────────────────────────
if [ "$SKIP_K6" = "0" ]; then
  if command -v k6 &>/dev/null; then
    header "Phase 7: k6 Load Test"
    cd "${SCRIPT_DIR}/../k6"
    k6 run \
      --out json="${RESULTS_DIR}/k6_results.json" \
      -e BASE_URL="${BASE_URL}" \
      -e UPLOAD_PATH="${UPLOAD_PATH}" \
      load_test.js || true
    cd - > /dev/null
  else
    warn "k6 not installed. Skipping load test."
    warn "Install with: brew install k6"
  fi
else
  info "Skipping k6 test (--skip-k6)"
fi

# ── Final Cleanup ────────────────────────────────────────────────────────────
header "Cleanup"
cleanup_webdav "${UPLOAD_PATH}"
ok "WebDAV test directory cleaned"

# ── Summary ──────────────────────────────────────────────────────────────────
print_summary

# Archive results
if [ -f "${RESULTS_DIR}/results.jsonl" ]; then
  ts=$(date +%Y%m%d_%H%M%S)
  cp "${RESULTS_DIR}/results.jsonl" "${RESULTS_DIR}/results_${ts}.jsonl"
  ok "Results archived: results_${ts}.jsonl"
fi

# Exit with failure if any test failed
if grep -q '"status":"FAIL"' "${RESULTS_DIR}/results.jsonl" 2>/dev/null; then
  exit 1
fi
exit 0
