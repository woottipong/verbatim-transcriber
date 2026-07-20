#!/usr/bin/env bash

# Stop processes listening on the local backend port.
# Usage: ./clear.sh [port]

set -euo pipefail

PORT="${1:-3000}"

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
    echo "❌ Invalid port: $PORT" >&2
    exit 1
fi

if ! command -v lsof >/dev/null 2>&1; then
    echo "❌ lsof is required to find the process listening on port $PORT" >&2
    exit 1
fi

PIDS="$(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"

if [[ -z "$PIDS" ]]; then
    echo "✅ Port $PORT is already clear"
    exit 0
fi

for PID in $PIDS; do
    echo "🛑 Stopping PID $PID"
    kill -TERM "$PID" 2>/dev/null || true
done

for _ in {1..25}; do
    if ! lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "✅ Port $PORT is clear"
        exit 0
    fi
    sleep 0.2
done

echo "⚠️  Port $PORT is still in use; the process did not stop after SIGTERM" >&2
exit 1
