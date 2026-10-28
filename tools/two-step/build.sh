#!/usr/bin/env bash
# Builds the two-step module and the patched main bundle. Local files only; deploys nothing.
#   tools/two-step/build.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
cd "$HERE"; [ -d node_modules ] || npm ci --silent
mkdir -p "$REPO/public/assets/twostep"
./node_modules/.bin/esbuild src/twostep.js --bundle --minify --format=esm --target=es2020 \
  --legal-comments=eof --outfile="$REPO/public/assets/twostep/twostep-tws2610ts.js"
python3 "$HERE/patch_twostep.py" "$REPO/public/assets/index-tws2610pb.js" "$REPO/public/assets/index-tws2610tf.js"
python3 - "$REPO/public/index.html" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace('/assets/index-tws2610pb.js','/assets/index-tws2610tf.js')
tag='<script type="module" src="/assets/twostep/twostep-tws2610ts.js"></script>'
if tag not in s:
    s=s.replace('</head>', '    '+tag+'\n</head>',1)
open(p,'w').write(s)
print('index.html ->', 'index-tws2610tf.js' in s, tag in s)
PY
