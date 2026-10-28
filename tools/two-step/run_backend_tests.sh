#!/usr/bin/env bash
# Two-step backend tests: real firestore.rules, storage.rules and Cloud Functions from this branch on
# LOCAL emulators only (project id demo-twostep: the demo- prefix means the emulators never contact a
# real Firebase project). Made-up people only. Usage: tools/two-step/run_backend_tests.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
W=/tmp/tws-twostep-e2e; rm -rf "$W"; mkdir -p "$W"
cp "$REPO/firestore.rules" "$REPO/storage.rules" "$W/"
rsync -a --exclude node_modules "$REPO/functions/" "$W/functions/"
ln -s "$REPO/functions/node_modules" "$W/functions/node_modules"
echo 'SMTP_PASS=not-a-real-secret' > "$W/functions/.secret.local"
cat > "$W/firebase.json" <<'JSON'
{
  "firestore": { "rules": "firestore.rules" },
  "storage": { "rules": "storage.rules" },
  "functions": [{ "source": "functions", "codebase": "default" }],
  "emulators": {
    "auth": { "port": 9741 }, "firestore": { "port": 8641, "websocketPort": 9651 }, "storage": { "port": 9641 },
    "functions": { "port": 5641 }, "ui": { "enabled": false }, "hub": { "port": 4441 },
    "logging": { "port": 4541 }, "eventarc": { "port": 9341 }, "tasks": { "port": 9541 }, "singleProjectMode": true
  }
}
JSON
cd "$W"
FUNCTIONS_DISCOVERY_TIMEOUT=90 "$REPO/tools/node_modules/.bin/firebase" emulators:exec --project demo-twostep \
  --only auth,firestore,storage,functions "node $HERE/backend_test.js"
