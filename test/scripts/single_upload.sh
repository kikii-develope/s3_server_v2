#!/usr/bin/env bash
# ============================================================================
# single_upload.sh — Single file upload test (various sizes)
#
# Usage:
#   ./single_upload.sh                                 # default: 1MB, 50MB, 120MB
#   ./single_upload.sh --file /path/to/file.bin        # specific file
#   ./single_upload.sh --file /path --filename foo.bin  # with custom name
#   ./single_upload.sh --upload-path my/dir             # custom WebDAV path
# ============================================================================
set -uo pipefail
source "$(dirname "$0")/_common.sh"

SCENARIO="single-upload"
FILE_OVERRIDE=""
UPLOAD_DIR="${UPLOAD_PATH}/single"
FNAME_OVERRIDE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --file)        FILE_OVERRIDE="$2"; shift 2 ;;
    --upload-path) UPLOAD_DIR="$2"; shift 2 ;;
    --filename)    FNAME_OVERRIDE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

begin_scenario "$SCENARIO"
passed=1

upload_one() {
  local file="$1" fname="${2:-}"
  [ -z "$fname" ] && fname=$(basename "$file")

  local fsize
  fsize=$(file_size_bytes "$file")
  local size_mb
  size_mb=$(python3 -c "print(round(${fsize}/1048576, 2))")
  info "Uploading: ${fname} (${size_mb}MB)"

  local start
  start=$(now_ms)

  local resp http_code body
  resp=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/webdav/upload" \
    -F "path=${UPLOAD_DIR}" \
    -F "filename=${fname}" \
    -F "file=@${file}" \
    --max-time 600)

  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')
  local elapsed=$(( $(now_ms) - start ))

  local speed="N/A"
  [ "$elapsed" -gt 0 ] && speed=$(python3 -c "print(round(${size_mb}/(${elapsed}/1000), 2))")

  if [ "$http_code" = "200" ]; then
    local etag upload_type
    etag=$(jval "$body" ".etag")
    upload_type=$(jval "$body" ".uploadType")
    ok "  HTTP ${http_code} | ${elapsed}ms | ${speed} MB/s | type=${upload_type} | ETag=${etag}"
  else
    fail "  HTTP ${http_code} | ${elapsed}ms"
    fail "  Body: $(echo "$body" | head -c 300)"
    passed=0
  fi
}

if [ -n "$FILE_OVERRIDE" ]; then
  upload_one "$FILE_OVERRIDE" "$FNAME_OVERRIDE"
else
  for f in test_1mb.bin test_50mb.bin test_120mb.bin; do
    fpath="${TEST_FILES_DIR}/${f}"
    if [ -f "$fpath" ]; then
      upload_one "$fpath"
    else
      warn "Missing: ${fpath} (run gen_test_files.sh first)"
      passed=0
    fi
  done
fi

end_scenario "$SCENARIO" "$passed"
cleanup_webdav "${UPLOAD_DIR}"
[ "$passed" = "1" ] && exit 0 || exit 1
