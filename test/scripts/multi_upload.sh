#!/usr/bin/env bash
# ============================================================================
# multi_upload.sh — Multiple file upload test
#
# Usage:
#   ./multi_upload.sh               # uploads test_1mb + test_50mb + test_120mb
#   ./multi_upload.sh --files-only  # skip stats (for embedding in run_all)
# ============================================================================
set -uo pipefail
source "$(dirname "$0")/_common.sh"

SCENARIO="multi-upload"
UPLOAD_DIR="${UPLOAD_PATH}/multi"

begin_scenario "$SCENARIO"
passed=1

# Collect available test files
FILES=()
FNAMES=()
for f in test_1mb.bin test_50mb.bin test_120mb.bin; do
  fpath="${TEST_FILES_DIR}/${f}"
  if [ -f "$fpath" ]; then
    FILES+=("$fpath")
    FNAMES+=("$f")
  else
    warn "Missing: ${fpath}"
  fi
done

if [ ${#FILES[@]} -lt 2 ]; then
  fail "Need at least 2 test files. Run gen_test_files.sh first."
  end_scenario "$SCENARIO" 0
  exit 1
fi

total_bytes=0
for fp in "${FILES[@]}"; do
  total_bytes=$((total_bytes + $(file_size_bytes "$fp")))
done
total_mb=$(python3 -c "print(round(${total_bytes}/1048576, 2))")
info "Uploading ${#FILES[@]} files (total ${total_mb}MB) to ${UPLOAD_DIR}..."

# Build curl command
CURL_ARGS=(-s -w "\n%{http_code}" -X POST "${BASE_URL}/webdav/upload-multiple"
  -F "path=${UPLOAD_DIR}" --max-time 600)

# Build filenames JSON array
FNAMES_JSON="["
for i in "${!FNAMES[@]}"; do
  [ "$i" -gt 0 ] && FNAMES_JSON+=","
  FNAMES_JSON+="\"${FNAMES[$i]}\""
done
FNAMES_JSON+="]"
CURL_ARGS+=(-F "filenames=${FNAMES_JSON}")

for fp in "${FILES[@]}"; do
  CURL_ARGS+=(-F "files=@${fp}")
done

start_ts=$(now_ms)
resp=$(curl "${CURL_ARGS[@]}")
http_code=$(echo "$resp" | tail -1)
body=$(echo "$resp" | sed '$d')
elapsed=$(( $(now_ms) - start_ts ))

info "HTTP ${http_code} | ${elapsed}ms"

if [ "$http_code" = "200" ] || [ "$http_code" = "207" ]; then
  success_count=$(jval "$body" ".summary.success")
  fail_c=$(jval "$body" ".summary.failed")
  total_c=$(jval "$body" ".summary.total")
  ok "Results: ${success_count}/${total_c} success, ${fail_c} failed"

  # Show per-file results
  python3 << PYEOF 2>/dev/null || true
import json, sys
try:
    d = json.loads('''${body}''')
    for r in d.get('results', []):
        status = 'OK' if r.get('success') else 'FAIL'
        name = r.get('filename', '?')
        size = r.get('size', 0)
        utype = r.get('uploadType', '?')
        print(f"    {status}: {name} ({size} bytes, {utype})")
except:
    pass
PYEOF

  if [ "$http_code" = "207" ]; then
    warn "Partial success (HTTP 207)"
    passed=0
  fi
  [ "$fail_c" != "0" ] && [ "$fail_c" != "N/A" ] && passed=0
else
  fail "HTTP ${http_code}"
  fail "Body: $(echo "$body" | head -c 300)"
  passed=0
fi

end_scenario "$SCENARIO" "$passed"
cleanup_webdav "${UPLOAD_DIR}"
[ "$passed" = "1" ] && exit 0 || exit 1
