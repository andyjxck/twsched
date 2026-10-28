#!/usr/bin/env python3
"""TEST ONLY. Copies public/ to a temp folder and points the copy at the LOCAL emulators (project
demo-twostep). The real public/ files are never changed by this. Usage: prep_web.py <public> <out>"""
import shutil, sys, re, os
src, out = sys.argv[1], sys.argv[2]
shutil.rmtree(out, ignore_errors=True)
shutil.copytree(src, out)
idx = open(os.path.join(out, 'index.html')).read()
m = re.search(r'/assets/(index-[a-z0-9]+\.js)', idx)
p = os.path.join(out, 'assets', m.group(1))
s = open(p, encoding='utf-8').read()

def rep(old, new):
    global s
    assert s.count(old) == 1, old
    s = s.replace(old, new)

rep('projectId:"twsched-f8b16",storageBucket:"twsched-f8b16.firebasestorage.app"',
    'projectId:"demo-twostep",storageBucket:"demo-twostep.appspot.com"')
rep('Sg=wT(lc,{localCache:xD({tabManager:PD()})})', 'Sg=wT(lc,{host:"127.0.0.1:8641",ssl:!1})')
rep('Mr=tN(lc);', 'Mr=tN(lc);Mr.config.emulator={url:"http://127.0.0.1:9741/"};'
    'Mr.emulatorConfig=Object.freeze({host:"127.0.0.1",port:9741,protocol:"http",options:Object.freeze({disableWarnings:!0})});'
    'Mr.settings.appVerificationDisabledForTesting=!0;')
rep('_O=mO(lc,"europe-west2");', '_O=mO(lc,"europe-west2");_O.emulatorOrigin="http://127.0.0.1:5641";Rl._host="127.0.0.1:9641";Rl._protocol="http";')
assert 'twsched-f8b16' not in s.replace('twsched-f8b16.firebaseapp.com', '')
open(p, 'w', encoding='utf-8').write(s)
print('test web copy ->', out, m.group(1))
