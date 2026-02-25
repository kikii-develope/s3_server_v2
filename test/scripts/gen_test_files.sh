#!/usr/bin/env bash
# ============================================================================
# gen_test_files.sh — Generate test files of various sizes
#
# Usage:
#   ./gen_test_files.sh           # 1MB, 50MB, 120MB only
#   ./gen_test_files.sh --large   # + 1GB, 1.5GB
#
# Files are created in test/test_files/ using random header + zero-fill
# for speed (1MB random ensures unique hashes, zeros fill the rest fast).
# ============================================================================
set -uo pipefail
source "$(dirname "$0")/_common.sh"

header "Generating Test Files"

gen() {
  local name="$1" size_mb="$2"
  local filepath="${TEST_FILES_DIR}/${name}"
  local expected_bytes=$((size_mb * 1048576))

  # Skip if already exists with correct size
  if [ -f "$filepath" ]; then
    local actual
    actual=$(file_size_bytes "$filepath")
    if [ "$actual" = "$expected_bytes" ]; then
      info "Skip (exists): ${name} (${size_mb}MB)"
      return
    fi
  fi

  info "Generating: ${name} (${size_mb}MB)..."

  # 1MB random header (unique hash) + zeros for speed
  dd if=/dev/urandom of="$filepath" bs=1048576 count=1 2>/dev/null
  if [ "$size_mb" -gt 1 ]; then
    dd if=/dev/zero bs=1048576 count=$((size_mb - 1)) >> "$filepath" 2>/dev/null
  fi

  ok "Created: ${name} ($(file_size_bytes "$filepath") bytes)"
}

gen "test_1mb.bin"     1
gen "test_50mb.bin"    50
gen "test_120mb.bin"   120

if [ "${1:-}" = "--large" ] || [ "${GENERATE_LARGE:-}" = "1" ]; then
  gen "test_1gb.bin"     1024
  gen "test_1500mb.bin"  1536
else
  info "Skipping 1GB/1.5GB. Use --large to generate."
fi

echo ""
info "Test files in ${TEST_FILES_DIR}:"
ls -lh "${TEST_FILES_DIR}/"
ok "File generation complete"
