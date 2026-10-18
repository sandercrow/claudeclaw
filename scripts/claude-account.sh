#!/usr/bin/env bash
# Switch the Claude account used by this ClaudeClaw agent. No restart needed:
# agent.ts re-reads CLAUDE_CODE_OAUTH_TOKEN from .env on every query.
# Usage: scripts/claude-account.sh [status|lc|iw]
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=.env
get() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2-; }
case "${1:-status}" in
  lc|iw)
    KEY=CLAUDE_TOKEN_$(echo "$1" | tr a-z A-Z); TOK=$(get "$KEY")
    [ -n "$TOK" ] || { echo "no token in $KEY"; exit 1; }
    if grep -qE '^CLAUDE_CODE_OAUTH_TOKEN=' "$ENV"; then sed -i "s|^CLAUDE_CODE_OAUTH_TOKEN=.*|CLAUDE_CODE_OAUTH_TOKEN=$TOK|" "$ENV"; else echo "CLAUDE_CODE_OAUTH_TOKEN=$TOK" >> "$ENV"; fi
    echo "active: $1";;
  status)
    A=$(get CLAUDE_CODE_OAUTH_TOKEN); echo -n "active: "
    if [ -n "$A" ] && [ "$A" = "$(get CLAUDE_TOKEN_LC)" ]; then echo lc; elif [ -n "$A" ] && [ "$A" = "$(get CLAUDE_TOKEN_IW)" ]; then echo iw; elif [ -n "$A" ]; then echo custom; else echo "none (uses ~/.claude credentials)"; fi
    for k in LC IW; do [ -n "$(get CLAUDE_TOKEN_$k)" ] && echo "$k: configured" || echo "$k: missing"; done;;
  *) echo "usage: $0 [status|lc|iw]"; exit 1;;
esac
