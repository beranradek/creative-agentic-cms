#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

STATE_DIR=".workspace/run"
LOG_DIR=".workspace/logs"
PID_FILE="${STATE_DIR}/dev.pid"
LOG_FILE="${LOG_DIR}/dev.log"

usage() {
  cat <<'EOF'
Usage: ./start.sh [--foreground] [--skip-install]

Starts the Creative Agentic CMS dev environment (server + web + watch builds).

Options:
  --foreground     Run in the foreground (recommended for local interactive use).
  --skip-install   Skip `pnpm install` (useful if deps are already installed).
EOF
}

wait_for_url() {
  local url="$1"
  local timeout_ms="$2"

  node - "$url" "$timeout_ms" <<'EOF'
const [url, timeoutRaw] = process.argv.slice(2);
const timeoutMs = Number(timeoutRaw);
const startedAt = Date.now();

async function main() {
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  process.exitCode = 1;
}

await main();
EOF
}

FOREGROUND=0
SKIP_INSTALL=0
for arg in "${@:-}"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --foreground) FOREGROUND=1 ;;
    --skip-install) SKIP_INSTALL=1 ;;
    *)
      echo "[start] unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v pnpm >/dev/null 2>&1; then
  cat >&2 <<'EOF'
[start] pnpm not found.

Install via corepack (Node.js 20+):
  corepack enable
  corepack prepare pnpm@9.15.6 --activate
EOF
  exit 1
fi

mkdir -p "$STATE_DIR" "$LOG_DIR"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$EXISTING_PID" ]] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "[start] already running (pid $EXISTING_PID)"
    echo "[start] web:    http://localhost:5173"
    echo "[start] server: http://localhost:5174"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if [[ ! -f ".env" ]]; then
  if [[ -f ".env.example" ]]; then
    cp .env.example .env
    echo "[start] created .env from .env.example (edit .env as needed)"
  else
    echo "[start] missing .env and .env.example" >&2
    exit 1
  fi
fi

if [[ "$SKIP_INSTALL" -eq 0 ]]; then
  pnpm install
fi

echo "[start] starting dev environment..."
echo "[start] web:    http://localhost:5173"
echo "[start] server: http://localhost:5174"

if [[ "$FOREGROUND" -eq 1 ]]; then
  exec pnpm dev
fi

nohup pnpm dev >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
echo "[start] running in background (pid $(cat "$PID_FILE"))"
echo "[start] logs: $LOG_FILE"

START_PID="$(cat "$PID_FILE")"
for _ in $(seq 1 20); do
  if ! kill -0 "$START_PID" 2>/dev/null; then
    echo "[start] dev process exited during startup" >&2
    tail -n 40 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    exit 1
  fi
  sleep 0.5
done

if ! wait_for_url "http://127.0.0.1:5174/api/health" 30000; then
  echo "[start] server did not become ready" >&2
  tail -n 40 "$LOG_FILE" >&2 || true
  exit 1
fi

if ! wait_for_url "http://127.0.0.1:5173" 30000; then
  echo "[start] web UI did not become ready" >&2
  tail -n 40 "$LOG_FILE" >&2 || true
  exit 1
fi

echo "[start] ready"
