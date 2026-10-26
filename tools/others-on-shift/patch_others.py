#!/usr/bin/env python3
""""Others on this shift" button on My shifts (next to Swap / Problem).

Idempotent anchor patch on the built main bundle (marker /*tws-others-shift*/).
Usage: python3 patch_others.py <in.js> <out.js>

Adds a button to every upcoming shift on My shifts (#/rota for team members), always shown, also when
a swap/problem is pending. It opens a small sheet listing colleagues on overlapping published shifts:
name, position (shift area), start-end time and a star for the shift (team) leader. The data comes
from the callable othersOnShift (functions/othersOnShift.js), which returns only those fields.
"""
import re, sys

MARK = '/*tws-others-shift*/'

def main(src, dst):
    s = open(src, encoding='utf-8').read()
    if MARK in s:
        open(dst, 'w', encoding='utf-8').write(s)
        print('already patched')
        return

    # 1. actions block: Swap + Problem only when nothing is pending; Others always.
    pat = re.compile(
        r'!(?P<pend>\w+)&&(?P<j>\w+)\.jsxs\("div",\{className:"actions",children:\['
        r'(?P<swap>(?P=j)\.jsx\("button",\{className:"btn secondary sm",onClick:\(\)=>(?P<set>\w+)\(\{kind:"swap",shift:(?P<sh>\w+)\}\),children:"Swap"\}\)),'
        r'(?P<prob>(?P=j)\.jsx\("button",\{className:"btn ghost sm",onClick:\(\)=>(?P=set)\(\{kind:"problem",shift:(?P=sh)\}\),children:"Problem"\}\))\]\}\)')
    m = list(pat.finditer(s))
    assert len(m) == 1, f'actions anchor found {len(m)} times'
    m = m[0]
    j, pend, setter, sh = m['j'], m['pend'], m['set'], m['sh']
    new_actions = (
        f'{j}.jsxs("div",{{className:"actions",children:[!{pend}&&{m["swap"]},!{pend}&&{m["prob"]},'
        f'{j}.jsx("button",{{className:"btn ghost sm","data-testid":"others-btn",onClick:()=>{setter}({{kind:"others",shift:{sh}}}),children:"Others on this shift"}})]}})')
    s = s[:m.start()] + new_actions + s[m.end():]

    # 2. render the sheet instead of the swap/problem form for kind "others"
    pat2 = re.compile(r'(?P<act>\w+)&&(?P<j>\w+)\.jsx\((?P<form>\w+),\{act:(?P=act),onClose:\(\)=>(?P<set>\w+)\(null\)\}\)')
    hits = [x for x in pat2.finditer(s) if x['set'] == setter]
    assert len(hits) == 1, f'sheet anchor found {len(hits)} times'
    h = hits[0]
    form = h['form']
    new_render = (f'{h["act"]}&&({h["act"]}.kind==="others"?{j}.jsx(TwOthersOnShift,{{shift:{h["act"]}.shift,onClose:()=>{setter}(null)}})'
                  f':{j}.jsx({form},{{act:{h["act"]},onClose:()=>{setter}(null)}}))')
    s = s[:h.start()] + new_render + s[h.end():]

    # 3. helper names from the bundle: React, sheet, spinner, error text, callable, shift label
    def need(rx, what):
        mm = re.search(rx, s)
        assert mm, f'could not find {what}'
        return mm.group(1)
    react = need(r'\[\w+,' + re.escape(setter) + r'\]=(\w+)\.useState\(null\)', 'React')
    sheet = need(r'function (\w+)\(\{title:\w+,onClose:\w+,children:\w+\}\)\{return \w+\.useEffect', 'sheet component')
    spinner = need(r'function (\w+)\(\{label:\w+="Loading"\}', 'spinner')
    call = need(r'async function (\w+)\(\w+,\w+\)\{return\(await \w+\(\w+,\w+\)\(\w+\|\|\{\}\)\)\.data\}', 'callable helper')
    errtxt = need(r'\}function (\w+)\(\w+\)\{const \w+=\w+&&\w+\.code\|\|"",\w+=\{"auth/invalid-credential"', 'error text')
    label = need(r'function (\w+)\((\w+)\)\{return`\$\{\w+\(\2\.date\)\} \$\{\2\.start\}-\$\{\2\.end\}', 'shift label')

    R, J = react, j
    comp = (
        MARK +
        'function TwOthersOnShift({shift:n,onClose:e}){'
        f'const[t,r]={R}.useState(null),[i,a]={R}.useState("");'
        f'{R}.useEffect(()=>{{let x=!0;{call}("othersOnShift",{{shiftId:n.id}}).then(d=>{{x&&r(d&&Array.isArray(d.others)?d.others:[])}}).catch(d=>{{x&&a({errtxt}(d))}});return()=>{{x=!1}}}},[n.id]);'
        f'return {J}.jsx({sheet},{{title:"Others on this shift",onClose:e,children:{J}.jsxs("div",{{className:"stack","data-testid":"others-sheet",children:['
        f'{J}.jsx("div",{{className:"small",children:{J}.jsx("strong",{{children:{label}(n)}})}}),'
        f'i?{J}.jsx("div",{{className:"err",role:"alert",children:i}})'
        f':t===null?{J}.jsx({spinner},{{label:"Loading"}})'
        f':t.length===0?{J}.jsx("p",{{className:"muted",style:{{margin:0,lineHeight:1.6}},"data-testid":"others-none",children:"Nobody else is on this shift."}})'
        f':{J}.jsx("ul",{{className:"list","aria-label":"Others on this shift",children:t.map((d,k)=>{J}.jsxs("li",{{"data-testid":"other-on-shift",style:{{lineHeight:1.5}},children:['
        f'{J}.jsxs("div",{{style:{{display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap"}},children:[{J}.jsx("strong",{{children:d.name}}),'
        f'd.leader&&{J}.jsx("span",{{role:"img","aria-label":"Team leader",title:"Team leader","data-testid":"other-leader",style:{{color:"var(--brass)",fontSize:"1.1rem",lineHeight:1}},children:"\u2605"}})]}}),'
        f'{J}.jsx("div",{{className:"small",style:{{color:"var(--muted)",marginTop:"2px"}},children:[d.area,`${{d.start}}\u2013${{d.end}}`].filter(Boolean).join(" \u00b7 ")}})'
        f']}},k))}})]}})}})}}'
    )
    anchor = re.search(r'function ' + re.escape(form) + r'\(\{act:', s)
    assert anchor, 'form component anchor'
    s = s[:anchor.start()] + comp + s[anchor.start():]
    open(dst, 'w', encoding='utf-8').write(s)
    print('patched', dict(react=R, jsx=J, sheet=sheet, spinner=spinner, call=call, err=errtxt, label=label, form=form))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
