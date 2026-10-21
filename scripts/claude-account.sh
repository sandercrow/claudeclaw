#!/usr/bin/env bash
# Switch the Claude account used by this ClaudeClaw agent. No restart needed:
# agent.ts re-reads CLAUDE_CODE_OAUTH_TOKEN from .env on every query.
# Usage: scripts/claude-account.sh [status|lc|iw] [hours]   (hours: park the other account, default 6)
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=.env; STATE=store/claude-account-state.json
get() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2-; }
case "${1:-status}" in
  lc|iw)
    KEY=CLAUDE_TOKEN_$(echo "$1" | tr a-z A-Z); TOK=$(get "$KEY")
    [ -n "$TOK" ] || { echo "no token in $KEY"; exit 1; }
    if grep -qE '^CLAUDE_CODE_OAUTH_TOKEN=' "$ENV"; then sed -i "s|^CLAUDE_CODE_OAUTH_TOKEN=.*|CLAUDE_CODE_OAUTH_TOKEN=$TOK|" "$ENV"; else echo "CLAUDE_CODE_OAUTH_TOKEN=$TOK" >> "$ENV"; fi
    OTHER=$([ "$1" = lc ] && echo iw || echo lc); H=${2:-6}
    python3 - "$STATE" "$OTHER" "$H" <<'PY'
import json,sys,time,os
p,other,h=sys.argv[1],sys.argv[2],float(sys.argv[3])
try: st=json.load(open(p))
except Exception: st={}
st[other]=int((time.time()+h*3600)*1000)
json.dump(st,open(p,'w'))
PY
    echo "active: $1 (other account parked ${H}h)";;
  status)
    A=$(get CLAUDE_CODE_OAUTH_TOKEN); echo -n "active: "
    if [ -n "$A" ] && [ "$A" = "$(get CLAUDE_TOKEN_LC)" ]; then echo lc; elif [ -n "$A" ] && [ "$A" = "$(get CLAUDE_TOKEN_IW)" ]; then echo iw; elif [ -n "$A" ]; then echo custom; else echo "none (uses ~/.claude credentials)"; fi
    for k in LC IW; do [ -n "$(get CLAUDE_TOKEN_$k)" ] && echo "$k: configured" || echo "$k: missing"; done
    [ -f "$STATE" ] && echo "parked: $(cat "$STATE")";;
  *) echo "usage: $0 [status|lc|iw] [hours]"; exit 1;;
esac
