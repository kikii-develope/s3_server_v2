#!/usr/bin/env bash
# ============================================================================
# dir_race_same_name.sh — Same filename race condition test
#
# Usage:
#   ./dir_race_same_name.sh       # default: 8 concurrent uploads
#   ./dir_race_same_name.sh 12    # 12 concurrent uploads
#
# Uploads N copies of the same file with the same filename simultaneously.
# Verifies:
#   - All uploads succeed
#   - No filename collisions
#   - Naming pattern: a.bin, a(1).bin, a(2).bin, ...
# ============================================================================
set -uo pipefail
source "$(dirname "$0")/_common.sh"

SCENARIO="same-name-race"
N="${1:-8}"
UPLOAD_DIR="${UPLOAD_PATH}/race-test"
FNAME="race_test.bin"
TEST_FILE="${TEST_FILES_DIR}/test_1mb.bin"

TMPOUT_DIR=""
cleanup() {
  [ -n "$TMPOUT_DIR" ] && rm -rf "$TMPOUT_DIR" 2>/dev/null || true
  cleanup_webdav "${UPLOAD_DIR}" 2>/dev/null || true
}
trap 'cleanup' EXIT

begin_scenario "$SCENARIO"
passed=1

if [ ! -f "$TEST_FILE" ]; then
  fail "Missing: ${TEST_FILE} (run gen_test_files.sh)"
  end_scenario "$SCENARIO" 0
  exit 1
fi

TMPOUT_DIR=$(mktemp -d "${OS_TMPDIR}/race-out.XXXXXX")

info "Uploading ${N} copies of '${FNAME}' simultaneously..."

# Launch N concurrent uploads
PIDS=()
for i in $(seq 1 "$N"); do
  (
    resp=$(curl -s -X POST "${BASE_URL}/webdav/upload" \
      -F "path=${UPLOAD_DIR}" \
      -F "filename=${FNAME}" \
      -F "file=@${TEST_FILE}" \
      --max-time 60 2>/dev/null)
    echo "$resp" > "${TMPOUT_DIR}/resp_${i}.json"
  ) &
  PIDS+=($!)
done

# Wait for all
for pid in "${PIDS[@]}"; do
  wait "$pid" 2>/dev/null || true
done

info "All ${N} uploads finished. Analyzing results..."

# Collect results
success=0
fail_count=0
FILENAMES=()

for i in $(seq 1 "$N"); do
  resp_file="${TMPOUT_DIR}/resp_${i}.json"
  if [ ! -f "$resp_file" ] || [ ! -s "$resp_file" ]; then
    fail "  #${i}: No response"
    fail_count=$((fail_count + 1))
    continue
  fi

  body=$(cat "$resp_file")
  s=$(jval "$body" ".status")
  fname=$(jval "$body" ".filename")

  if [ "$s" = "200" ]; then
    success=$((success + 1))
    FILENAMES+=("$fname")
    ok "  #${i}: ${fname}"
  else
    fail_count=$((fail_count + 1))
    local_msg=$(jval "$body" ".message")
    fail "  #${i}: Failed — ${local_msg}"
  fi
done

info "Totals: ${success}/${N} success, ${fail_count} failed"

# --- Uniqueness check ---
if [ ${#FILENAMES[@]} -gt 0 ]; then
  unique_count=$(printf '%s\n' "${FILENAMES[@]}" | sort -u | wc -l | tr -d ' ')
  info "Unique filenames: ${unique_count} / ${#FILENAMES[@]}"

  if [ "$unique_count" -ne "${#FILENAMES[@]}" ]; then
    fail "DUPLICATE FILENAMES DETECTED!"
    printf '%s\n' "${FILENAMES[@]}" | sort | uniq -d | while IFS= read -r dup; do
      fail "  Duplicate: ${dup}"
    done
    passed=0
  else
    ok "All filenames unique"
  fi

  # --- Naming pattern check ---
  # Expect: race_test.bin, race_test(1).bin, race_test(2).bin, ...
  has_original=0
  max_counter=0
  for fn in "${FILENAMES[@]}"; do
    if [ "$fn" = "${FNAME}" ]; then
      has_original=1
    elif echo "$fn" | grep -qE '^race_test\([0-9]+\)\.bin$'; then
      counter=$(echo "$fn" | sed -E 's/^race_test\(([0-9]+)\)\.bin$/\1/')
      [ "$counter" -gt "$max_counter" ] && max_counter=$counter
    fi
  done

  info "Naming: original=${has_original}, max_counter=${max_counter}"

  if [ "$has_original" -eq 1 ]; then
    ok "Original filename present"
  else
    warn "Original filename not found (race condition: got (1) first?)"
  fi

  expected_max=$((success - 1))
  if [ "$max_counter" -ge "$expected_max" ] 2>/dev/null; then
    ok "Counter range looks correct (max=${max_counter}, expected~$((success-1)))"
  elif [ "$success" -gt 1 ]; then
    warn "Counter max=${max_counter}, expected around $((success-1))"
  fi
fi

[ "$fail_count" -gt 0 ] && passed=0

end_scenario "$SCENARIO" "$passed"
[ "$passed" = "1" ] && exit 0 || exit 1
