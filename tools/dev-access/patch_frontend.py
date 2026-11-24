#!/usr/bin/env python3
"""Developer access, front end (24 Nov 2026). Patches the prebuilt app bundle in place, like the earlier
tools/hide-developer patch. Usage: python3 patch_frontend.py public/assets/index-XXXX.js

- Developer without a valid grant: normal layout and navigation, every page replaced by black bars and a
  code box (components.js TwsRedacted). The data hook He returns nothing without querying, and no real
  page mounts, so nothing is fetched; the rules refuse it anyway.
- Developer with an active, unexpired grant (claim devGrant, devAccess doc checked live): owner view with
  a banner, switching back to redaction the moment the grant ends or expires (TwsDevGate).
- Team > developer row: owners get Give access / Cancel code / End access and the access log.
"""
import sys, os
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
if 'TwsDevGate' in s:
    sys.exit('already patched')

def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        sys.exit(f'anchor found {n} times, expected {count}: {old[:90]}')
    s = s.replace(old, new)

h = s.find('function He(n,e){')
body = s[h:h + 500]
if 'const i=n();' not in body:
    sys.exit('He body changed: ' + body)
s = s[:h] + body.replace('function He(n,e){', 'function He(n,e){const __twsRed=!!(window.__twsCtx&&window.__twsCtx.redacted);', 1).replace('const i=n();', 'const i=__twsRed?null:n();', 1) + s[h + 500:]

rep('if(t==="developer")return f.jsx(TwsMaintenance,{user:n});', 'if(t==="developer")return f.jsx(TwsDevGate,{user:n,profile:i});')
FULL = 't.redacted?{role:"owner",isManager:!0,isOwner:!0}:t'
rep('Y=__twsNav(t,0,', 'Y=__twsNav(' + FULL + ',0,')
rep('ne=__twsNav(t,1,', 'ne=__twsNav(' + FULL + ',1,')
rep('...t.isManager?[{p:"team",label:"Team",icon:"team"}]:[]', '...t.isManager||t.redacted?[{p:"team",label:"Team",icon:"team"}]:[]')
rep('!t.isManager&&n==="team"', '!t.isManager&&!t.redacted&&n==="team"')
rep('O=C?k[n]:__twsFallback(k,n)', 'O=t.redacted?f.jsx(TwsRedacted,{path:n},"red-"+n):C?k[n]:__twsFallback(k,n)')
rep('M=C?n:""', 'M=C||t.redacted?n:""')

old_pill = 'Developer maintenance login. It can’t see any staff information. Only owners can see it'
if old_pill in s:
    rep(old_pill, 'Developer login. Staff information is blacked out for it unless an owner gives access. Only owners can see it')
anchor = '"data-testid":"dev-pill"'
if s.count(anchor) != 1:
    sys.exit('dev-pill anchor')
i = s.find(anchor)
j = s.find('})', i) + 2
s = s[:j] + ',__twsIsDev(n)&&window.__twsCtx&&window.__twsCtx.isOwner&&!window.__twsCtx.devAccess&&f.jsx(TwsDevAccess,{dev:n})' + s[j:]

comp = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'components.js'), encoding='utf-8').read().replace('\n', '')
k = s.find('function U2(')
s = s[:k] + comp + s[k:]
open(p, 'w', encoding='utf-8').write(s)
print('patched', p)
