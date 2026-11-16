#!/bin/sh
# Install, start and stop a local VoiceStudio backend for cloned voiceovers.
#   scripts/voicestudio.sh install | start | stop | status
# Settings (environment): VOICESTUDIO_DIR (default ~/VoiceStudio),
# VOICESTUDIO_REPO, VOICESTUDIO_ENGINE (default voxcpm2), VOICESTUDIO_PORT (3900).
set -eu
DIR="${VOICESTUDIO_DIR:-$HOME/VoiceStudio}"
REPO="${VOICESTUDIO_REPO:-https://github.com/daviddamilola/VoiceStudio}"
ENGINE="${VOICESTUDIO_ENGINE:-voxcpm2}"
PORT="${VOICESTUDIO_PORT:-3900}"
LOG="$DIR/backend-run.log"
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is required. $2" >&2; exit 1; }; }
health() { curl -s -m 3 "http://127.0.0.1:$PORT/health" 2>/dev/null || true; }

case "${1:-}" in
  install)
    need git "Install git."
    need uv "Install it with: brew install uv"
    need node "Install Node 22 or newer."
    if [ ! -d "$DIR/.git" ]; then git clone --depth 1 "$REPO" "$DIR"; fi
    cd "$DIR"
    # Installs PyTorch and the backend's Python dependencies (about 2 GB).
    node scripts/setup-api.mjs
    # VoxCPM2 is the Apache-2.0 cloning engine; the default engine's weights
    # are non-commercial.
    if [ "$ENGINE" = "voxcpm2" ]; then uv pip install "voxcpm>=2.0.3"; fi
    echo "Installed in $DIR. Start it with: $0 start"
    echo "The first generated line downloads the model (about 5 GB for VoxCPM2)."
    ;;
  start)
    [ -d "$DIR/.venv" ] || { echo "error: not installed. Run: $0 install" >&2; exit 1; }
    case "$(health)" in *'"status"'*) echo "already running on port $PORT"; exit 0;; esac
    cd "$DIR"
    # --no-sync: a plain `uv run` may re-resolve the environment and undo the
    # PyTorch variant chosen at install time.
    OMNIVOICE_TTS_BACKEND="$ENGINE" nohup uv run --no-sync uvicorn main:app --app-dir backend --host 127.0.0.1 --port "$PORT" >"$LOG" 2>&1 &
    printf "starting"
    i=0
    while [ $i -lt 120 ]; do
      case "$(health)" in *'"status":"ok"'*) echo " ready at http://127.0.0.1:$PORT ($ENGINE)"; exit 0;; esac
      printf "."; sleep 2; i=$((i + 1))
    done
    echo; echo "error: it did not become ready. See $LOG" >&2; exit 1
    ;;
  stop)
    # The backend finishes its current job before honouring a polite stop, and
    # a line can take minutes: ask, wait briefly, then insist. A backend left
    # running keeps the model in memory and answers /health for the next one.
    pattern="uvicorn main:app --app-dir backend --host 127.0.0.1 --port $PORT"
    pgrep -f "$pattern" >/dev/null 2>&1 || { echo "not running"; exit 0; }
    pkill -f "$pattern" 2>/dev/null || true
    i=0
    while [ $i -lt 10 ] && pgrep -f "$pattern" >/dev/null 2>&1; do sleep 1; i=$((i + 1)); done
    if pgrep -f "$pattern" >/dev/null 2>&1; then pkill -9 -f "$pattern" 2>/dev/null || true; sleep 1; fi
    pids="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
    echo "stopped"
    ;;
  status)
    h="$(health)"; [ -n "$h" ] && echo "$h" || { echo "not running"; exit 1; }
    ;;
  *)
    echo "usage: $0 install | start | stop | status" >&2; exit 2
    ;;
esac
