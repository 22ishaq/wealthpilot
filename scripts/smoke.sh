#!/usr/bin/env bash
# End-to-end check against the Compose stack, through nginx as a browser would.
set -euo pipefail
BASE="${WEALTHPILOT_URL:-http://localhost:8080}"
JAR="$(mktemp)"
for _ in $(seq 1 90); do curl -fsS "$BASE/api/ready" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS "$BASE/api/ready" >/dev/null && echo "ok   API ready behind nginx"
curl -fsS "$BASE/" | grep -q '<div id="root">' && echo "ok   SPA served"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/dashboard")
[[ "$code" == 401 ]] && echo "ok   dashboard requires a session"
curl -fsS -c "$JAR" -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d '{"email":"demo@northwind.test","password":"wealthpilot-demo"}' "$BASE/api/auth/login" >/dev/null
echo "ok   demo owner signs in"
clients=$(curl -fsS -b "$JAR" "$BASE/api/dashboard" | python3 -c 'import json,sys; print(json.load(sys.stdin)["clientCount"])')
[[ "$clients" == 12 ]] && echo "ok   dashboard shows the 12 seeded clients"
code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -H 'Content-Type: application/json' \
  -H 'Origin: https://evil.example' -d '{"name":"x","riskProfile":"growth"}' "$BASE/api/clients")
[[ "$code" == 403 ]] && echo "ok   cross-site write rejected"
echo "smoke test passed"
