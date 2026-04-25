#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${DATA_DIR:-./projects}"
OUT_DIR="${1:-./backups}"
KEEP="${KEEP:-14}"

mkdir -p "$OUT_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$OUT_DIR/projects-$timestamp.tar.gz"

data_dir_abs="$(cd "$(dirname "$DATA_DIR")" && pwd)/$(basename "$DATA_DIR")"
parent_abs="$(dirname "$data_dir_abs")"
base_name="$(basename "$data_dir_abs")"

tar -czf "$archive" -C "$parent_abs" "$base_name"
echo "$archive"

if [[ "$KEEP" -gt 0 ]]; then
  mapfile -t backups < <(ls -1t "$OUT_DIR"/projects-*.tar.gz 2>/dev/null || true)
  if [[ "${#backups[@]}" -gt "$KEEP" ]]; then
    for old in "${backups[@]:$KEEP}"; do
      rm -f -- "$old"
    done
  fi
fi
