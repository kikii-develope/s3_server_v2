#!/usr/bin/env bash
# ============================================================================
# _common.sh — Shared configuration, helpers, and lifecycle functions
# Source this from every test script:
#   source "$(dirname "$0")/_common.sh"
# ============================================================================

# ── Configuration (override via environment) ─────────────────────────────────
export BASE_URL="${BASE_URL:-http://localhost:8000}"
export UPLOAD_PATH="${UPLOAD_PATH:-test-automation}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
export RESULTS_DIR="${SCRIPT_DIR}/../results"
export TEST_FILES_DIR="${SCRIPT_DIR}/../test_files"
export SERVER_LOG="${RESULTS_DIR}/server.log"

# Detect OS temp dir (same as Node.js os.tmpdir())
if command -v node &>/dev/null; then
  export OS_TMPDIR="$(node -e "process.stdout.write(require('os').tmpdir())")"
else
  export OS_TMPDIR="${TMPDIR:-/tmp}"
fi
export MULTER_TMPDIR="${OS_TMPDIR}/file-upload-server"

mkdir -p "$RESULTS_DIR" "$TEST_FILES_DIR"

# ── Colors ───────────────────────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; C='\033[0;36m'; N='\033[0m'

info()   { printf "${B}[INFO]${N} %s\n" "$*"; }
ok()     { printf "${G}[PASS]${N} %s\n" "$*"; }
fail()   { printf "${R}[FAIL]${N} %s\n" "$*"; }
warn()   { printf "${Y}[WARN]${N} %s\n" "$*"; }
header() {
  printf "\n${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}\n"
  printf "${C}  %s${N}\n" "$*"
  printf "${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}\n"
}

# ── Timestamp (ms) — macOS-safe ──────────────────────────────────────────────
now_ms() {
  python3 -c "import time; print(int(time.time()*1000))"
}

# ── JSON field extraction ────────────────────────────────────────────────────
jval() {
  local json="$1" jpath="$2"
  if command -v jq &>/dev/null; then
    printf '%s' "$json" | jq -r "$jpath" 2>/dev/null || echo "N/A"
  else
    python3 << PYEOF 2>/dev/null || echo "N/A"
import json, sys
try:
    d = json.loads('''${json}''')
    for k in '${jpath}'.lstrip('.').split('.'):
        if isinstance(d, dict):
            d = d[k]
        else:
            d = d[int(k)]
    print(d)
except:
    print('N/A')
PYEOF
  fi
}

# ── Server stats ─────────────────────────────────────────────────────────────
get_stats_json() {
  curl -s --max-time 5 "${BASE_URL}/webdav/stats" 2>/dev/null || echo '{}'
}

get_heap_mb() { jval "$(get_stats_json)" ".memory.heapUsedMB"; }
get_rss_mb()  { jval "$(get_stats_json)" ".memory.rssMB"; }
get_cpu_pct() { jval "$(get_stats_json)" ".cpu.percent"; }

# ── Server PID (port-based, reliable) ────────────────────────────────────────
_extract_port() {
  echo "$BASE_URL" | grep -oE ':[0-9]+' | tr -d ':' || echo "8000"
}

get_server_pid() {
  local port
  port=$(_extract_port)
  lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | head -1 || echo ""
}

# ── FD count ─────────────────────────────────────────────────────────────────
get_fd_count() {
  local pid="${1:-$(get_server_pid)}"
  [ -z "$pid" ] && { echo "0"; return; }
  if [ "$(uname)" = "Darwin" ]; then
    lsof -p "$pid" 2>/dev/null | wc -l | tr -d ' '
  else
    ls "/proc/$pid/fd" 2>/dev/null | wc -l | tr -d ' '
  fi
}

# ── Wait for server (listening) ──────────────────────────────────────────────
wait_for_server() {
  local max="${1:-30}" i=0
  while [ "$i" -lt "$max" ]; do
    if curl -s --max-time 2 "${BASE_URL}/webdav/info" &>/dev/null; then
      return 0
    fi
    sleep 1; i=$((i + 1))
  done
  return 1
}

# ── Wait for server readiness (startup sweeper complete) ─────────────────────
wait_for_ready() {
  local max="${1:-30}" i=0
  while [ "$i" -lt "$max" ]; do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "${BASE_URL}/ready" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
      return 0
    fi
    sleep 1; i=$((i + 1))
  done
  return 1
}

# ── Start server (background) ───────────────────────────────────────────────
start_server() {
  info "Starting server (npm run dev, background)..."
  cd "$PROJECT_DIR"
  nohup npm run dev > "$SERVER_LOG" 2>&1 &
  cd - > /dev/null
  if wait_for_server 30; then
    info "Server listening (PID: $(get_server_pid)), waiting for ready..."
    if wait_for_ready 30; then
      ok "Server started and ready (PID: $(get_server_pid))"
      return 0
    else
      fail "Server started but /ready did not return 200 within 30s"
      return 1
    fi
  else
    fail "Server failed to start within 30s"
    return 1
  fi
}

# ── Kill server ──────────────────────────────────────────────────────────────
kill_server() {
  local port
  port=$(_extract_port)
  local main_pid
  main_pid=$(lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | head -1)

  if [ -n "$main_pid" ]; then
    info "Killing server PID ${main_pid} (port ${port})..."
    pkill -9 -P "$main_pid" 2>/dev/null || true
    kill -9 "$main_pid" 2>/dev/null || true
    sleep 1
    # Double-check
    local remaining
    remaining=$(lsof -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)
    if [ -n "$remaining" ]; then
      echo "$remaining" | xargs kill -9 2>/dev/null || true
      sleep 1
    fi
    ok "Server killed"
  else
    warn "No process listening on port ${port}"
  fi
}

# ── Scenario lifecycle ───────────────────────────────────────────────────────
_sc_start_ts=""
_sc_start_heap=""
_sc_start_rss=""
_sc_start_fd=""
_sc_start_cpu=""

begin_scenario() {
  local name="$1"
  header "$name"
  _sc_start_ts=$(now_ms)
  _sc_start_heap=$(get_heap_mb)
  _sc_start_rss=$(get_rss_mb)
  _sc_start_fd=$(get_fd_count)
  _sc_start_cpu=$(get_cpu_pct)
  info "Before -> Heap: ${_sc_start_heap}MB | RSS: ${_sc_start_rss}MB | FD: ${_sc_start_fd} | CPU: ${_sc_start_cpu}%"
}

end_scenario() {
  local name="$1" passed="$2"
  local end_ts end_heap end_rss end_fd end_cpu duration status
  end_ts=$(now_ms)
  duration=$((end_ts - _sc_start_ts))
  end_heap=$(get_heap_mb)
  end_rss=$(get_rss_mb)
  end_fd=$(get_fd_count)
  end_cpu=$(get_cpu_pct)

  echo ""
  info "Resource delta [$name]:"
  info "  Heap: ${_sc_start_heap}MB -> ${end_heap}MB"
  info "  RSS:  ${_sc_start_rss}MB -> ${end_rss}MB"
  info "  FD:   ${_sc_start_fd} -> ${end_fd}"
  info "  CPU:  ${_sc_start_cpu}% -> ${end_cpu}%"
  info "  Duration: ${duration}ms"

  status="FAIL"
  [ "$passed" = "1" ] && status="PASS"
  if [ "$status" = "PASS" ]; then
    ok "$name -> PASSED (${duration}ms)"
  else
    fail "$name -> FAILED (${duration}ms)"
  fi

  # Append to JSONL results
  printf '{"scenario":"%s","status":"%s","duration_ms":%d,"start_heap":"%s","end_heap":"%s","start_rss":"%s","end_rss":"%s","start_fd":"%s","end_fd":"%s","ts":%d}\n' \
    "$name" "$status" "$duration" \
    "$_sc_start_heap" "$end_heap" "$_sc_start_rss" "$end_rss" \
    "$_sc_start_fd" "$end_fd" "$(date +%s)" \
    >> "${RESULTS_DIR}/results.jsonl"
}

# ── Cleanup uploaded test files from WebDAV ──────────────────────────────────
cleanup_webdav() {
  local p="${1:-${UPLOAD_PATH}}"
  curl -s -X DELETE "${BASE_URL}/webdav/directory/${p}?force=true" &>/dev/null || true
}

# ── File size (portable macOS / Linux) ───────────────────────────────────────
file_size_bytes() {
  if [ "$(uname)" = "Darwin" ]; then
    stat -f%z "$1" 2>/dev/null || echo "0"
  else
    stat -c%s "$1" 2>/dev/null || echo "0"
  fi
}

# ── Count tmp files ──────────────────────────────────────────────────────────
count_multer_tmp() {
  if [ -d "${MULTER_TMPDIR}" ]; then
    ls "${MULTER_TMPDIR}/" 2>/dev/null | wc -l | tr -d ' '
  else
    echo "0"
  fi
}

count_merge_tmp() {
  ls -d "${OS_TMPDIR}"/merge-* 2>/dev/null | wc -l | tr -d ' '
}

# ── Available disk space (MB) ────────────────────────────────────────────────
get_avail_mb() {
  df -Pm "${OS_TMPDIR}" 2>/dev/null | awk 'NR==2{print $4}'
}

# ── Print summary from results.jsonl ─────────────────────────────────────────
print_summary() {
  local rf="${RESULTS_DIR}/results.jsonl"
  [ ! -f "$rf" ] && { warn "No results file found"; return; }

  echo ""
  echo "================================================================="
  echo "                    TEST RESULTS SUMMARY"
  echo "================================================================="
  printf "  %-30s  %-6s  %10s  %-14s\n" "Scenario" "Status" "Duration" "Heap delta"
  echo "-----------------------------------------------------------------"

  local pass=0 fail_count=0
  while IFS= read -r line; do
    local sc st dur sh eh
    sc=$(python3 -c "import json,sys;print(json.loads(sys.stdin.read())['scenario'])" <<< "$line" 2>/dev/null || echo "?")
    st=$(python3 -c "import json,sys;print(json.loads(sys.stdin.read())['status'])" <<< "$line" 2>/dev/null || echo "?")
    dur=$(python3 -c "import json,sys;print(json.loads(sys.stdin.read())['duration_ms'])" <<< "$line" 2>/dev/null || echo "0")
    sh=$(python3 -c "import json,sys;print(json.loads(sys.stdin.read())['start_heap'])" <<< "$line" 2>/dev/null || echo "?")
    eh=$(python3 -c "import json,sys;print(json.loads(sys.stdin.read())['end_heap'])" <<< "$line" 2>/dev/null || echo "?")

    local color="$R"
    if [ "$st" = "PASS" ]; then
      color="$G"; pass=$((pass + 1))
    else
      fail_count=$((fail_count + 1))
    fi
    printf "  %-30s  ${color}%-6s${N}  %8sms  %s->%sMB\n" "$sc" "$st" "$dur" "$sh" "$eh"
  done < "$rf"

  echo "-----------------------------------------------------------------"
  printf "  Total: %-3d  |  ${G}Pass: %-3d${N}  |  ${R}Fail: %-3d${N}\n" $((pass + fail_count)) $pass $fail_count
  echo "================================================================="
  echo ""
}
