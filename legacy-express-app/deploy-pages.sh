#!/usr/bin/env bash
# Builds the in-browser demo and publishes it to https://andyjxck.github.io/twsched/
# (gh-pages branch of github.com/andyjxck/twsched). Only demo code and made-up data go up.
set -euo pipefail
cd "$(dirname "$0")"
npm run build:pages
rm -f dist-pages/sw.js
python3 - <<'EOF'
import json
p = 'dist-pages/manifest.webmanifest'
d = json.load(open(p))
d['id'] = d['start_url'] = d['scope'] = '/twsched/'
d['name'] = 'White Swan Staff (demo)'
for i in d['icons']:
    i['src'] = i['src'].lstrip('/')
json.dump(d, open(p, 'w'), indent=2)
EOF
touch dist-pages/.nojekyll
cp dist-pages/index.html dist-pages/404.html
TMP=$(mktemp -d)
cp -r dist-pages/. "$TMP"/
cd "$TMP"
git init -q -b gh-pages
git config user.name andyjxck
git config user.email andyjxck@users.noreply.github.com
git add -A
git commit -qm "White Swan Staff demo (made-up data, runs in the browser)"
GIT_SSH_COMMAND="ssh -i $HOME/.ssh/twsched_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=no" git push -f git@github.com:andyjxck/twsched.git gh-pages
echo "Published: https://andyjxck.github.io/twsched/"
