#!/usr/bin/env python3
"""Right to Work checks (Andy, 26 Oct): patch the live main bundle in place, like the earlier tws2610 patches.

Usage: python3 patch_rtw.py public/assets/index-tws2610i.js public/assets/index-tws2610j.js

- Replaces the old multi-file picker `rv` with the check picker in rtw-picker.js (route dropdown, one or two
  files, each by scan/file upload or camera photo, date of the check, owner's confirmation).
- E2 saves checkId, route, slot, checkedOn and declared with each file.
- New document types and labels.
- Staff editor: correct the 'can't be put on a shift' wording (Right to Work doesn't hold back shifts), show
  the date of the check, let the owner open the files of an incomplete check.
- Owner's file list: date of the check, which file of a two-file check, removal warning.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()


def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        sys.exit(f'anchor found {n} times, wanted {count}: {old[:90]!r}')
    s = s.replace(old, new)


helpers = open(os.path.join(HERE, 'rtw-helpers.js'), encoding='utf-8').read()
picker = open(os.path.join(HERE, 'rtw-picker.js'), encoding='utf-8').read()
strip = lambda t: '\n'.join(l for l in t.splitlines() if not l.startswith('//'))

# 1. The picker. Old rv runs from 'function rv(' to just before 'async function sv('.
a = s.find('function rv({files:n,setFiles:e,disabled:t}){')
b = s.find('async function sv(', a)
if a < 0 or b < 0 or s.count('function rv(') != 1:
    sys.exit('rv not found')
s = s[:a] + strip(helpers) + '\n' + strip(picker) + s[b:]

# 2. Save the check details with each file.
rep('async function E2({staffId:n,staffName:e,file:t,docType:r,me:i}){',
    'async function E2({staffId:n,staffName:e,file:t,docType:r,item:ck,me:i}){if(!ck||!ck.checkId)throw new Error("Fill in the whole check first.");')
rep('uploadedBy:i.uid,uploadedByName:String(i.name||"").slice(0,80)})}',
    'uploadedBy:i.uid,uploadedByName:String(i.name||"").slice(0,80),checkId:ck.checkId,route:ck.route,slot:ck.slot,checkedOn:ck.checkedOn,declared:!0})}')
rep('docType:l.docType,me:r}', 'docType:l.docType,item:l,me:r}')

# 3. Document types.
rep('qk=[["passport","Passport"],["share_code","Share code check (GOV.UK)"],["brp","Residence permit (BRP)"],["visa","Visa or eVisa"],["birth_certificate","Birth certificate + NI number"],["other","Other"]]',
    'qk=[["passport","Passport"],["passport_card","Irish passport card"],["birth_certificate","Birth or adoption certificate"],["naturalisation_certificate","Naturalisation or registration certificate"],["ni_evidence","National Insurance proof"],["share_code","Online check result (GOV.UK)"],["brp","Residence permit (BRP)"],["visa","Visa or eVisa"],["other","Other"]]')

# 4. Staff editor (T2).
rep('"On file",i.count>1?` (${i.count} documents)`:""]',
    '"On file",i.lastCheckedOn?`, checked ${__twsRtwDate(i.lastCheckedOn)}`:"",i.count>1?` (${i.count} checks)`:""]')
rep('children:["Missing. ",M?"You":n.name.split(/\\s+/)[0]," can’t be put on a shift until this is uploaded."]',
    'children:[i&&i.incomplete?"Not complete: a file is missing from the check.":"Missing."]')
rep('e.isOwner&&a&&f.jsx("button",{type:"button",className:"btn ghost sm",onClick:()=>k(!T)',
    'e.isOwner&&(a||i&&i.files>0)&&f.jsx("button",{type:"button",className:"btn ghost sm",onClick:()=>k(!T)')
rep('r.docs&&!a&&!_&&(te?', 'r.docs&&!a&&!_&&!T&&(te?')
rep('e.isOwner&&a&&T&&f.jsx(I2,{person:n})', 'e.isOwner&&T&&f.jsx(I2,{person:n})')

# 5. Owner's file list (I2).
rep('T.uploadedAt&&T.uploadedAt.toDate?`, ${T.uploadedAt.toDate().toLocaleDateString("en-GB")}`:"",T.checked?"":" · checking"]',
    'T.uploadedAt&&T.uploadedAt.toDate?`, ${T.uploadedAt.toDate().toLocaleDateString("en-GB")}`:"",T.checkedOn?` · checked ${__twsRtwDate(T.checkedOn)}`:"",__twsRtwPart(T,p),T.checked?"":" · checking"]')
a = s.find('async function _(T){const k=p.length===1;if(window.confirm(`Remove ${T.fileName}?${k?`')
b = s.find(':""}`)){d(T.id);', a)
if a < 0 or b < 0 or b - a > 400:
    sys.exit('remove confirm not found')
s = s[:a] + 'async function _(T){const k=__twsRtwRemoveNote(T,p,n);if(window.confirm(`Remove ${T.fileName}?${k}`)){d(T.id);' + s[b + len(':""}`)){d(T.id);'):]

open(dst, 'w', encoding='utf-8').write(s)
print('wrote', dst, len(s))
