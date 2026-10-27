#!/usr/bin/env bash
# Builds the handover-fixes front end from the live (pb / rp) files. Local only: deploys nothing.
set -euo pipefail
cd "$(dirname "$0")/../../public"
T=../tools/handover-fixes
python3 $T/patch_main.py assets/index-tws2610pb.js assets/index-tws2610hf.js
python3 $T/patch_pay.py assets/payroll/payroll-tws2610rp.js assets/payroll/payroll-tws2610hf.js
for f in index.html 404.html; do
  python3 - "$f" <<'EOF'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
def rep(a, b):
    global s
    if s.count(a) != 1:
        sys.exit(f'{p}: {a!r} found {s.count(a)} times')
    s = s.replace(a, b)
rep('index-tws2610pb.js', 'index-tws2610hf.js')
rep('payroll-tws2610rp.js', 'payroll-tws2610hf.js')
css = '<link rel="stylesheet" href="/assets/handover-tws2610hf.css">'
if css not in s:
    i = s.index('index-8c5eaaablg.css')
    j = s.index('>', i) + 1
    s = s[:j] + '\n    ' + css + s[j:]
open(p, 'w', encoding='utf-8').write(s)
EOF
done
cp assets/index-tws2610hf.js /tmp/_hf_check.mjs && node --check /tmp/_hf_check.mjs
cp assets/payroll/payroll-tws2610hf.js /tmp/_pay_check.mjs && node --check /tmp/_pay_check.mjs
echo built
