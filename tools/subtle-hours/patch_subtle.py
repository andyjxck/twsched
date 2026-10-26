#!/usr/bin/env python3
"""Rota hours warnings made subtle: one small orange "!" beside the person's name
(hover / tap / keyboard focus shows what's wrong). Removes the loud row tags, the
shift-chip "No break"/"Short break" tags and the "Hours to check this week" box.
Warning logic and thresholds (__twsWeek, __twsLongNoBreak) are untouched.
The shift editor hint (__twsPopBreak) stays.
Usage: patch_subtle.py in.js out.js   (idempotent: refuses to double-apply)"""
import sys

src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf-8").read()
if "__TwsBang" in s:
    sys.exit("already patched")
if "__twsWeek(" not in s:
    sys.exit("hours warnings patch not present in input")


def rep(old, new):
    global s
    n = s.count(old)
    if n != 1:
        sys.exit(f"anchor found {n} times: {old[:90]}")
    s = s.replace(old, new)


# 1. Orange ! right after the name (rota grid is managers/owners only: FO -> qO).
rep('f.jsx("strong",{children:V.name}),V.gone?',
    'f.jsx("strong",{children:V.name}),!V.open&&!V.gone&&f.jsx(__TwsBang,{w:__twsWeek(V.id,l,$r,fs,twC),'
    'days:l,cells:$r,id:V.id,name:V.name}),V.gone?')

# 2. Row: plain total, no tags, no red colouring.
rep('f.jsx("div",{className:`hrs ${tw.level?"over":""}`,title:__twsHrsTitle(tw),children:Li(ee)}),__twsRowFlags(tw)]',
    'f.jsx("div",{className:"hrs",title:__twsHrsTitle(tw),children:Li(ee)})]')

# 3. Shift chips: no "No break" / "Short break" tag (it's in the name's tooltip).
rep('__twsChipFlag(et),ir(et)&&f.jsxs("div",{className:"chip-clash"',
    'ir(et)&&f.jsxs("div",{className:"chip-clash"')

# 4. No "Hours to check this week" box above the rota.
rep('__twsHoursNote(Oe,l,$r,fs,twC),f.jsx(xn,{error:te.error||F.error||ne.error||ie.error})',
    'f.jsx(xn,{error:te.error||F.error||ne.error||ie.error})')

HELPERS = r'''
/* tws-subtle-hours-v1 */
function __twsDayName(d){try{return["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(d+"T12:00:00Z").getUTCDay()]||""}catch(x){return""}}
function __twsBangLines(w,days,cells,id){var o=[];if(!w)return o;var dr=w.draft?" ("+Li(w.draft)+" of it draft)":"";
w.level&&o.push(Li(w.worked)+" this week"+dr+", "+(w.level==="over52"?"over 52h":w.level==="near"?"close to 52h":"over 48h"));
w.under&&o.push("Under contract: "+Li(w.total)+" of "+Li(w.contract)+(w.hol?", holiday included":""));
if(w.noBreak){var none=[],short=[];(days||[]).forEach(function(d){(cells[id+"|"+d]||[]).forEach(function(s){var k=__twsLongNoBreak(s);k==="none"?none.push(__twsDayName(s.date||d)):k==="short"&&short.push(__twsDayName(s.date||d))})});
none.length&&o.push((none.length===1?"1 shift":none.length+" shifts")+" over 6h with no break ("+none.join(", ")+")");
short.length&&o.push((short.length===1?"1 shift":short.length+" shifts")+" over 6h with a break under 20 min ("+short.join(", ")+")");
none.length||short.length||o.push(w.noBreak===1?"1 shift over 6h with no break":w.noBreak+" shifts over 6h with no break")}
return o}
function __TwsBang(p){var lines=__twsBangLines(p.w,p.days,p.cells,p.id),h=G.useState(!1),fo=G.useState(!1),pi=G.useState(!1),ps=G.useState(null),btn=G.useRef(null),tip=G.useRef(null),open=h[0]||fo[0]||pi[0];
function place(){var b=btn.current;if(!b)return;var r=b.getBoundingClientRect(),vw=window.innerWidth||document.documentElement.clientWidth,vh=window.innerHeight||document.documentElement.clientHeight,mw=Math.min(260,vw-16),left=Math.max(8,Math.min(r.left-6,vw-mw-8)),st={left:left+"px",maxWidth:mw+"px"};r.bottom+110>vh&&r.top>120?st.bottom=vh-r.top+6+"px":st.top=r.bottom+6+"px";ps[1](st)}
G.useLayoutEffect(function(){open&&place()},[open]);
G.useEffect(function(){if(!open)return;function shut(){h[1](!1);fo[1](!1);pi[1](!1)}function key(e){if(e.key==="Escape"){shut()}}function down(e){if(btn.current&&btn.current.contains(e.target))return;if(tip.current&&tip.current.contains(e.target))return;pi[1](!1);h[1](!1)}function mv(){place()}document.addEventListener("keydown",key);document.addEventListener("pointerdown",down,!0);window.addEventListener("scroll",mv,!0);window.addEventListener("resize",mv);return function(){document.removeEventListener("keydown",key);document.removeEventListener("pointerdown",down,!0);window.removeEventListener("scroll",mv,!0);window.removeEventListener("resize",mv)}},[open]);
if(!lines.length)return null;
var label="Hours to check for "+(p.name||"this person")+": "+lines.join(". "),tipId="tws-bang-"+p.id;
var t=open&&ps[0]?f.jsx("div",{ref:tip,id:tipId,role:"tooltip",className:"tws-bang-tip",style:ps[0],"data-testid":"hours-tip",children:lines.map(function(x,i){return f.jsx("div",{children:x},i)})}):null;
return f.jsxs(f.Fragment,{children:[f.jsx("button",{ref:btn,type:"button",className:"tws-bang","aria-label":label,"aria-expanded":open?"true":"false","aria-describedby":open?tipId:void 0,"data-testid":"hours-bang",
 onPointerEnter:function(e){e.pointerType==="mouse"&&h[1](!0)},onPointerLeave:function(e){e.pointerType==="mouse"&&h[1](!1)},
 onFocus:function(e){var v=!1;try{v=e.target.matches(":focus-visible")}catch(x){}v&&fo[1](!0)},onBlur:function(){fo[1](!1);pi[1](!1)},
 onPointerDown:function(e){e.stopPropagation()},onClick:function(e){e.stopPropagation();e.preventDefault();if(open&&!pi[0]&&!h[0]&&fo[0]){fo[1](!1);return}pi[1](!pi[0])},
 children:"!"}),t?typeof Vn!=="undefined"&&Vn.createPortal&&typeof document!=="undefined"?Vn.createPortal(t,document.body):t:null]})}
(function(){try{if(typeof document>"u"||document.getElementById("tws-bang-css"))return;var e=document.createElement("style");e.id="tws-bang-css";e.textContent=".tws-bang{position:relative;display:inline-block;appearance:none;-webkit-appearance:none;border:0;background:none;margin:0 0 0 3px;padding:0 3px;font:inherit;font-size:.85rem;font-weight:800;line-height:1;color:#d9620b;cursor:pointer;vertical-align:baseline;border-radius:4px}.tws-bang::after{content:'';position:absolute;inset:-8px -7px}.tws-bang:hover,.tws-bang[aria-expanded=true]{color:#b44f05}.tws-bang:focus{outline:none}.tws-bang:focus-visible{box-shadow:var(--focus,0 0 0 3px #c9952f)}.tws-bang-tip{position:fixed;z-index:2000;background:var(--paper,#fff);color:var(--ink,#22251f);border:1px solid var(--line-2,#d3d2ca);border-radius:8px;box-shadow:0 6px 20px rgba(20,24,18,.14);padding:7px 10px;font-size:.8rem;font-weight:400;line-height:1.4;text-align:left;white-space:normal;pointer-events:auto}.tws-bang-tip div+div{margin-top:3px}";(document.head||document.documentElement).appendChild(e)}catch(x){}})();
'''

marker = "\n//# sourceMappingURL"
if marker in s:
    idx = s.rindex(marker)
    s = s[:idx] + HELPERS + s[idx:]
else:
    s = s.rstrip("\n") + "\n" + HELPERS
open(dst, "w", encoding="utf-8").write(s)
print("ok", len(s))
