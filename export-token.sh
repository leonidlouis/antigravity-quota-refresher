#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Export Antigravity Refresh Token (No Node.js required)
# ─────────────────────────────────────────────────────────────
# 
# Requires: sqlite3, base64
# Works on: Linux, macOS
# ─────────────────────────────────────────────────────────────

set -e

# Determine database path based on OS
case "$(uname -s)" in
    Darwin)
        DB_PATH="$HOME/Library/Application Support/Antigravity/User/globalStorage/state.vscdb"
        ;;
    Linux)
        DB_PATH="$HOME/.config/Antigravity/User/globalStorage/state.vscdb"
        ;;
    MINGW*|CYGWIN*|MSYS*)
        DB_PATH="$APPDATA/Antigravity/User/globalStorage/state.vscdb"
        ;;
    *)
        echo "Unsupported OS" >&2
        exit 1
        ;;
esac

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    echo "Error: Antigravity database not found at $DB_PATH" >&2
    echo "Make sure Antigravity IDE is installed and you've made at least one request." >&2
    exit 1
fi

# Check for sqlite3
if ! command -v sqlite3 &> /dev/null; then
    echo "Error: sqlite3 is required. Install it with:" >&2
    echo "  Ubuntu/Debian: sudo apt install sqlite3" >&2
    echo "  macOS: brew install sqlite3" >&2
    exit 1
fi

# Extract base64 data from database
RAW_DATA=$(sqlite3 "$DB_PATH" "SELECT value FROM ItemTable WHERE key = 'jetskiStateSync.agentManagerInitState'" 2>/dev/null)

if [ -z "$RAW_DATA" ]; then
    echo "Error: No auth data found. Open Antigravity IDE and make a request first." >&2
    exit 1
fi

# Decode base64 and extract token (tokens start with "1//")
TOKEN=$(echo "$RAW_DATA" | base64 -d 2>/dev/null | strings | grep -oE '1//[A-Za-z0-9_-]+' | head -1)

if [ -z "$TOKEN" ]; then
    echo "Error: Could not extract token from database." >&2
    exit 1
fi

# Output only the token (for easy piping)
echo "$TOKEN"
