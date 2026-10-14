#!/bin/bash
# Send a Telegram message mid-task.
# Usage: notify.sh "message text"
# Reads <AGENT>_BOT_TOKEN (or TELEGRAM_BOT_TOKEN as fallback) and
# ALLOWED_CHAT_ID from .env in the project root.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "notify.sh: .env not found at $ENV_FILE" >&2
  exit 1
fi

read_env() {
  grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'"
}

# Per-agent bot token: SHAKA_BOT_TOKEN, MARK_BOT_TOKEN, etc.
# Falls back to TELEGRAM_BOT_TOKEN when no agent-specific token is set.
AGENT_ID="${CLAUDECLAW_AGENT_ID:-main}"
AGENT_TOKEN_VAR="$(echo "$AGENT_ID" | tr '[:lower:]' '[:upper:]')_BOT_TOKEN"

TOKEN=$(read_env "$AGENT_TOKEN_VAR")
if [ -z "$TOKEN" ]; then
  TOKEN=$(read_env TELEGRAM_BOT_TOKEN)
fi
CHAT_ID=$(read_env ALLOWED_CHAT_ID)

if [ -z "$TOKEN" ] || [ -z "$CHAT_ID" ]; then
  echo "notify.sh: no bot token found ($AGENT_TOKEN_VAR / TELEGRAM_BOT_TOKEN) or ALLOWED_CHAT_ID missing in .env" >&2
  exit 1
fi

curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -d chat_id="${CHAT_ID}" \
  -d text="${1}" \
  -d parse_mode="HTML" > /dev/null
