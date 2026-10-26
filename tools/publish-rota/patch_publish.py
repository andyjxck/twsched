#!/usr/bin/env python3
"""Publish rota button (Andy, 26 Oct). Idempotent anchor patch on the minified main bundle.
Usage: patch_publish.py <in.js> <out.js>
- Rota toolbar: one management-only button. "Publish rota" until the week is published, then "Publish changes"
  while there are drafts or changed shifts nobody has been told about (weeks/{w}.pending, kept by the server),
  otherwise a disabled "Published". An "Unpublished changes" pill shows next to the week status.
- Shift editor: one "Save". New shifts are drafts; editing a published shift keeps it published. No per-shift publish.
- Confirm/toast wording for publish, approve week and the day tick.
"""
import sys
MARK = '/*tws-publish-rota*/'

src, out = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
if MARK in s:
    open(out, 'w', encoding='utf-8').write(s)
    print('already patched')
    sys.exit(0)

def rep(old, new):
    global s
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'anchor found {n} times: {old[:80]!r}')
    s = s.replace(old, new)

HELPER = (MARK + 'function __twsPubState(b,Bn,Br){var st=b&&b.status,isPub=st==="published"||st==="approved",'
          'pend=b&&b.pending?Object.keys(b.pending).length:0,dr=Bn?Bn.length:0,has=dr>0||pend>0,'
          'parts=[];if(dr)parts.push(dr+" draft shift"+(dr===1?"":"s"));'
          'if(pend)parts.push(pend+(pend===1?" person":" people")+" with changed shifts");'
          'return{isPub:isPub,pend:pend,dr:dr,has:has,can:isPub?has:(Br?Br.length:0)>0,'
          'label:isPub?(has?"Publish changes":"Published"):"Publish rota",'
          'title:has?"Not sent yet: "+parts.join(" and ")+". Staff are told when you press Publish.":void 0}}')

# helper at module scope, just before the time-picker constants that follow the shift editor
rep('const HO={hours:23,minutes:59};', HELPER + 'const HO={hours:23,minutes:59};')

# publish handler: confirm, then one toast
rep('async function eo(){_(!0);try{const V=await mn("publishWeek",{weekStart:i});t(`Published ${V.published} shift${V.published===1?"":"s"}. ${V.staffNotified} ${V.staffNotified===1?"person":"people"} told.`',
    'async function eo(){const Ps=__twsPubState(b,Bn,Br),Pw=mt(i,{day:"numeric",month:"long"});'
    'if(!window.confirm(Ps.isPub?`Publish the changes for the week of ${Pw}?\n\nOnly the people whose shifts changed get one email and one notification with their shifts for that week.`'
    ':`Publish the rota for the week of ${Pw}?\n\nEveryone on it gets one email and one notification listing their shifts for that week.`))return;'
    '_(!0);try{const V=await mn("publishWeek",{weekStart:i});t((Ps.isPub?"Changes published. ":"Rota published. ")+(V.staffNotified?`${V.staffNotified} ${V.staffNotified===1?"person":"people"} told.`:"Nobody\u2019s upcoming shifts changed, so no one was told.")')

# toolbar button
rep('f.jsx("button",{className:"btn secondary sm",disabled:g||!Bn.length,onClick:eo,children:Bn.length?`Publish ${Bn.length} change${Bn.length===1?"":"s"}`:"All published"})',
    'f.jsx("button",{className:"btn sm","data-testid":"publish-rota",disabled:g||!__twsPubState(b,Bn,Br).can,title:__twsPubState(b,Bn,Br).title,onClick:eo,children:__twsPubState(b,Bn,Br).label})')
rep('!P&&f.jsx("button",{className:"btn sm",disabled:g||ms,onClick:to,children:"Approve week"})',
    '!P&&f.jsx("button",{className:"btn secondary sm",disabled:g||ms,onClick:to,children:"Approve week"})')

# pill next to the week status
rep('children:P?"Approved":b&&b.status==="published"?"Published":"Not published"}),',
    'children:P?"Approved":b&&b.status==="published"?"Published":"Not published"}),'
    '!D&&__twsPubState(b,Bn,Br).isPub&&__twsPubState(b,Bn,Br).has&&f.jsx("span",{className:"pill amber","data-testid":"unpublished-changes",title:__twsPubState(b,Bn,Br).title,children:"Unpublished changes"}),')

# approve week confirm and toast
rep('${Bn.length?`${Bn.length} draft shift${Bn.length===1?"":"s"} will be published. `:""}After this only management can change this week.`',
    '${__twsPubState(b,Bn,Br).has?"This also publishes the rota: anyone whose shifts changed gets one email and one notification. ":""}After this only management can change this week.`')
rep('try{await mn("approveWeek",{weekStart:i}),t("Week approved and finalised.")}',
    'try{const Va=await mn("approveWeek",{weekStart:i});t("Week approved and finalised."+(Va&&Va.staffNotified?` ${Va.staffNotified} ${Va.staffNotified===1?"person":"people"} told about their shifts.`:""))}')

# help text
rep('"Dashed shifts are drafts. Staff only see them once you publish."',
    '"Dashed shifts are drafts. Publish rota shows the week to staff and sends each person one email with their shifts. After that, changes aren\u2019t sent until you press Publish changes."')

# day tick: publishes that day\'s drafts but tells nobody
rep("Any draft shifts that day get published, and after that only management can change that day's shifts.",
    "Any draft shifts that day get published, but nobody is emailed until you press Publish. After that only management can change that day's shifts.")

# shift editor: one Save, no per-shift publishing
rep('(!_.id||!_.published)&&f.jsx("button",{className:"btn secondary sm",disabled:O,onClick:()=>D(!1),children:"Save draft"}),f.jsx("button",{className:"btn sm",disabled:O,onClick:()=>D(!0),children:_.id&&_.published?"Save":"Save & publish"})',
    'f.jsx("button",{className:"btn sm",disabled:O,onClick:()=>D(!1),children:"Save"})')
rep('g(ye?_.id?"Shift updated.":"Shift added and published.":"Saved as a draft.")',
    'g(ye?"Shift updated. Staff are told when you press Publish changes.":"Saved as a draft. Staff see it when you publish.")')

open(out, 'w', encoding='utf-8').write(s)
print('patched')
