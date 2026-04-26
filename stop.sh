#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PID_FILE=".workspace/run/dev.pid"

usage() {
  cat <<'EOF'
Usage: ./stop.sh

Stops the dev environment started by ./start.sh.
EOF
}

case "${1:-}" in
  "" ) ;;
  -h|--help) usage; exit 0 ;;
  *)
    echo "[stop] unknown argument: $1" >&2
    usage >&2
    exit 2
    ;;
esac

if [[ ! -f "$PID_FILE" ]]; then
  echo "[stop] not running (missing $PID_FILE)"
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "$PID" ]]; then
  rm -f "$PID_FILE"
  echo "[stop] removed empty pid file"
  exit 0
fi

if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "[stop] process not running (stale pid $PID); cleaned up"
  exit 0
fi

echo "[stop] stopping (pid $PID)..."
kill -TERM "$PID" 2>/dev/null || true

for _ in $(seq 1 10); do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "[stop] stopped"
    exit 0
  fi
  sleep 1
done

echo "[stop] still running after 10s; sending SIGKILL..."
kill -KILL "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
echo "[stop] stopped (SIGKILL)"

