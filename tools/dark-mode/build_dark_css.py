#!/usr/bin/env python3
"""Build public/assets/theme-tws2610dm.css: the Staff Hub dark theme.

Standalone, like sidebar-tws2610s.js: no app code changes. The light theme is untouched; every rule
here is scoped to html[data-theme=dark], which assets/theme-tws2610dm.js sets before first paint.

1. The palette variables (--paper, --ink, --line ...) get dark values.
2. Every declaration in the app's stylesheets that uses a fixed colour, or uses a palette variable in a
   role the variable flip would break (e.g. var(--green) as a button fill, var(--ink) as the toast
   fill), is repeated under html[data-theme=dark] with a dark equivalent. Sources, in cascade order:
   main stylesheet, My shifts stylesheet, the CSS blocks injected by the main bundle, the payroll
   module's CSS block, the sidebar script's CSS.
3. A short hand-written tail for the few things a mapping can't judge.

Re-run after any stylesheet change:  python3 tools/dark-mode/build_dark_css.py
"""
import colorsys
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUB = ROOT / 'public'
OUT = PUB / 'assets' / 'theme-tws2610dm.css'
D = 'html[data-theme=dark]'


def read_index_assets():
    html = (PUB / 'index.html').read_text()
    css = re.findall(r'href="/(assets/[^"]+\.css)"', html)
    js = re.findall(r'src="/(assets/[^"]+\.js)"', html)
    return [c for c in css if 'theme-' not in c], js


def js_css_blocks(path):
    """CSS held in string literals inside a built JS file (injected at runtime).
    Finds CSS-looking text, then widens each hit to its enclosing ` or " literal."""
    s = (PUB / path).read_text()
    out, covered = [], []
    for m in re.finditer(r'\.[a-zA-Z][\w-]*[^{}"`;=()]{0,120}\{[a-z-]+:[^{}"`]{1,200}\}', s):
        i = m.start()
        if any(a <= i < b for a, b in covered):
            continue
        a = i
        while a > 0 and not (s[a] in '`"' and s[a - 1] != '\\'):
            a -= 1
        q = s[a]
        b = i
        while b < len(s) and not (s[b] == q and s[b - 1] != '\\'):
            b += 1
        t = s[a + 1:b]
        covered.append((a, b + 1))
        if len(t) < 200 or t.count('}') < 4 or 'function' in t or '=>' in t or 'return' in t:
            continue
        t = t.replace('\\n', '\n').replace('\\"', '"')
        t = re.sub(r'\$\{[^}]*\}', '', t)
        out.append(t)
    return out


def sidebar_css(path):
    s = (PUB / path).read_text()
    m = re.search(r'var css = \[(.*?)\]\.join', s, re.S)
    if not m:
        return []
    parts = re.findall(r"'((?:\\'|[^'])*)'", m.group(1))
    txt = '\n'.join(parts)
    txt = txt.replace("' + C + '", 'html.tws-side-collapsed')
    return [txt]


# ---------------------------------------------------------------- CSS parsing
def strip_comments(s):
    return re.sub(r'/\*.*?\*/', '', s, flags=re.S)


def parse(s):
    """Return list of (kind, prelude, body). kind: 'rule' or 'at' (body = nested list) or 'skip'."""
    s = strip_comments(s)
    i, n, out = 0, len(s), []
    while i < n:
        j = s.find('{', i)
        semi = s.find(';', i)
        if j < 0:
            break
        if 0 <= semi < j and s[i:semi].strip().startswith('@'):
            i = semi + 1  # @import / @charset
            continue
        prelude = s[i:j].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            if s[k] == '{':
                depth += 1
            elif s[k] == '}':
                depth -= 1
            k += 1
        body = s[j + 1:k - 1]
        if prelude.startswith('@media') or prelude.startswith('@supports'):
            out.append(('at', prelude, parse(body)))
        elif prelude.startswith('@'):
            out.append(('skip', prelude, body))  # keyframes, font-face, layer
        else:
            out.append(('rule', prelude, body))
        i = k
    return out


def decls(body):
    res, buf, depth = [], '', 0
    for ch in body:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ';' and depth == 0:
            res.append(buf)
            buf = ''
        else:
            buf += ch
    res.append(buf)
    out = []
    for d in res:
        if ':' not in d:
            continue
        p, v = d.split(':', 1)
        p, v = p.strip().lower(), v.strip()
        if p and v:
            out.append((p, v))
    return out


# ---------------------------------------------------------------- colours
NAMED = {'white': (255, 255, 255, 1.0), 'black': (0, 0, 0, 1.0)}
COLOR_RE = re.compile(r'#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b')


def parse_color(t):
    t = t.strip()
    if t.lower() in NAMED:
        return NAMED[t.lower()]
    if t.startswith('#'):
        h = t[1:]
        if len(h) in (3, 4):
            h = ''.join(c * 2 for c in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return (r, g, b, a)
    m = re.match(r'rgba?\(([^)]*)\)', t)
    if m:
        parts = [x for x in re.split(r'[\s,/]+', m.group(1).strip()) if x]
        r, g, b = (float(x.rstrip('%')) for x in parts[:3])
        a = float(parts[3]) if len(parts) > 3 else 1.0
        return (r, g, b, a)
    return None


def fmt(r, g, b, a):
    r, g, b = (max(0, min(255, round(x))) for x in (r, g, b))
    if a >= 0.999:
        return '#%02x%02x%02x' % (r, g, b)
    return 'rgba(%d,%d,%d,%s)' % (r, g, b, ('%.3f' % a).rstrip('0').rstrip('.'))


def hls(c):
    r, g, b, a = c
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return h, l, s, a


def from_hls(h, l, s, a):
    r, g, b = colorsys.hls_to_rgb(h, max(0, min(1, l)), max(0, min(1, s)))
    return fmt(r * 255, g * 255, b * 255, a)


def map_color(tok, role):
    c = parse_color(tok)
    if c is None:
        return tok
    h, l, s, a = hls(c)
    if role == 'bg':
        if a < 0.5 and l > 0.6:
            return tok  # faint light overlays: fine on dark
        if l >= 0.6 and s > 0.5 and l < 0.8:
            return tok  # bright accent fills (gold badges, dots): keep, with their own dark text
        if l >= 0.6:  # light surface -> dark surface, same hue, gentle tint
            if s < 0.15:  # neutral whites/greys follow the green-tinted dark palette
                return from_hls(0.36, 0.105 + (1 - l) * 0.6, 0.08, a)
            return from_hls(h, 0.115 + (1 - l) * 0.6, min(s * 0.5, 0.32), a)
        return tok  # dark or saturated fills keep (white text on them stays readable)
    if role == 'fg':
        if a < 0.5:
            return tok
        if l <= 0.6:  # dark text -> light text, same hue, keeps the light theme's hierarchy
            if s > 0.25:
                return from_hls(h, 0.86 - l * 0.25, min(s, 0.7), a)
            return from_hls(h, 0.92 - l * 0.6, min(s, 0.1), a)
        return tok
    if role == 'border':
        if a < 0.5:
            return tok
        if l >= 0.6:  # light hairline -> dark hairline
            return from_hls(h, 0.21 + (1 - l) * 0.45, min(s * 0.45, 0.3), a)
        if l < 0.2 and s < 0.2:
            return '#5b635c'  # black rules -> visible mid grey
        return tok
    if role == 'shadow':
        if a >= 0.5 and l >= 0.86:  # white/paper rings
            return from_hls(h, 0.12, min(s * 0.4, 0.2), a)
        if l < 0.3 and a < 0.5:  # soft dark shadows: a bit stronger on dark
            return fmt(0, 0, 0, min(0.6, a * 1.8 + 0.05))
        return tok
    return tok


# Palette variables whose dark value can't serve every role they play.
FILL = {  # used as a background / ring
    'green': 'var(--dm-fill)', 'green-2': 'var(--dm-fill-2)', 'cream': 'var(--dm-raised)',
    'ink': 'var(--dm-ink-fill)', 'red': 'var(--dm-red-fill)', 'ok': 'var(--dm-ok-fill)',
    'blue': 'var(--dm-blue-fill)', 'amber': 'var(--dm-amber-fill)', 'brass': 'var(--dm-brass-fill)',
    'muted': 'var(--dm-muted-fill)',
}
FG_FIX = {'paper': '#fff'}  # var(--paper) as text = white on a fill
BORDER_FIX = {'green': 'var(--dm-fill)', 'green-2': 'var(--dm-fill-2)', 'red': 'var(--dm-red-fill)',
              'ok': 'var(--dm-ok-fill)', 'ink': 'var(--line-2)'}
KNOWN_VARS = set()


def role_of(p):
    if p.startswith('--'):
        return 'bg'
    if p.startswith('background'):
        return 'bg'
    if p in ('color', 'fill', 'stroke', 'caret-color', 'text-decoration-color', '-webkit-text-fill-color',
             'text-emphasis-color', 'accent-color'):
        return 'fg'
    if p.startswith('border') or p in ('outline-color', 'column-rule', 'column-rule-color'):
        return 'border'
    if p in ('box-shadow', 'text-shadow', 'outline', 'filter', 'drop-shadow'):
        return 'shadow'
    return None


def drop_fallbacks(v):
    """var(--known, #fallback) -> var(--known): the fallback never applies here."""
    def rep(m):
        name = m.group(1)
        return 'var(--%s)' % name if name in KNOWN_VARS else m.group(0)
    prev = None
    while prev != v:
        prev = v
        v = re.sub(r'var\(--([a-z0-9-]+)\s*,[^()]*(?:\([^()]*\)[^()]*)*\)', rep, v)
    return v


def dark_value(p, v, keep_fg=False):
    role = role_of(p)
    if role is None:
        return None
    if role == 'fg' and keep_fg:
        return None
    v0 = drop_fallbacks(v)
    imp = ''
    if '!important' in v0:
        v0 = v0.replace('!important', '').strip()
        imp = '!important'
    nv = v0
    table = {'bg': FILL, 'border': BORDER_FIX, 'shadow': FILL, 'fg': FG_FIX}[role]
    if role == 'shadow' and p == 'outline':
        table = BORDER_FIX
    nv = re.sub(r'var\(--([a-z0-9-]+)\)', lambda m: table.get(m.group(1), m.group(0)), nv)
    if role == 'shadow' and 'var(--paper)' in nv:
        pass  # paper rings follow the palette
    nv = COLOR_RE.sub(lambda m: map_color(m.group(0), role), nv)
    if nv == v0:
        return None
    return nv + imp


def bright_accent(v):
    for t in COLOR_RE.findall(v):
        c = parse_color(t)
        if c and c[3] >= 0.5:
            h, l, s, a = hls(c)
            if 0.55 <= l < 0.8 and s > 0.5:
                return True
    return False


def changed_any(ds, dl):
    # Emit a rule whenever it sets any colour property: needed to keep cascade order (see emit).
    return bool(ds)


def scope(sel):
    out = []
    for part in split_selectors(sel):
        part = part.strip()
        if not part:
            continue
        if part.startswith(':root'):
            out.append(D + part[5:])
        elif re.match(r'html\b', part):
            out.append(D + part[4:])
        else:
            out.append(D + ' ' + part)
    return ','.join(out)


def split_selectors(sel):
    parts, buf, depth = [], '', 0
    for ch in sel:
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(buf)
            buf = ''
        else:
            buf += ch
    parts.append(buf)
    return parts


def emit(items, stats):
    out = []
    for kind, prelude, body in items:
        if kind == 'at':
            inner = emit(body, stats)
            if inner:
                out.append(prelude + '{' + ''.join(inner) + '}')
        elif kind == 'rule':
            if prelude.strip().startswith(':root') and all(p.startswith('--') or p in (
                    'font-family', 'font-size', 'color', 'background', '-webkit-text-size-adjust',
                    'text-size-adjust') for p, _ in decls(body)):
                continue  # palette blocks: replaced by the hand-tuned palette below
            ds = []
            dl = decls(body)
            keep_fg = any(p.startswith('background') and bright_accent(v) for p, v in dl)
            changed = False
            for idx, (p, v) in enumerate(dl):
                if p.startswith('--') and not COLOR_RE.search(v):
                    continue
                if role_of(p) is None:
                    continue
                nv = dark_value(p, v, keep_fg)
                if nv is None:
                    # Unchanged colour declarations are repeated too, so the original cascade between
                    # rules (e.g. .btn.ghost over .btn) still holds inside the dark scope.
                    ds.append('%s:%s' % (p, v))
                    continue
                changed = True
                if True:
                    ds.append('%s:%s' % (p, nv))
                    if p == 'background':  # the shorthand resets longhands set after it: repeat them
                        for p2, v2 in dl[idx + 1:]:
                            if p2.startswith('background-') and p2 != 'background-color':
                                ds.append('%s:%s' % (p2, dark_value(p2, v2) or v2))
            if ds and changed_any(ds, dl):
                stats['rules'] += 1
                stats['decls'] += len(ds)
                out.append(scope(prelude) + '{' + ';'.join(ds) + '}')
    return out


PALETTE = D + '''{color-scheme:dark;
--green:#8fc7a7;--green-2:#a6d6ba;--green-3:#74b493;--green-tint:#1d3228;
--cream:#f2eee4;--paper:#1b201c;--bg:#121613;--sand:#262d28;
--gold:#d4a85a;--brass:#ddb66d;--gold-tint:#3a2f18;
--ink:#ebe8e0;--muted:#a9ada2;--line:#2f3630;--line-2:#414a43;
--red:#f19a90;--amber:#e8b860;--ok:#8fd096;--blue:#9dbdf2;
--shadow-1:0 1px 2px rgba(0,0,0,.45);--shadow-2:0 10px 30px rgba(0,0,0,.55);
--focus:0 0 0 2px var(--paper),0 0 0 4px #e2b85a;
--dm-fill:#2f6b50;--dm-fill-2:#3a7d5f;--dm-raised:#262d28;--dm-ink-fill:#2c332e;
--dm-red-fill:#b0362b;--dm-ok-fill:#2f7336;--dm-blue-fill:#2f5ea8;--dm-amber-fill:#8a5a00;
--dm-brass-fill:#7d5a1c;--dm-muted-fill:#4a5049;
background:var(--bg);color:var(--ink)}
'''

# Things a colour mapping can't judge.
TAIL = '''
/* hand-tuned */
''' + D + ''' body{background:var(--bg);color:var(--ink)}
''' + D + ''' .login{background-color:#15261d}
''' + D + ''' .ticket{background-color:#1f3a2e}
''' + D + ''' .toast,''' + D + ''' .skip{border:1px solid var(--line-2);color:var(--ink)}
''' + D + ''' ::selection{background:#3a7d5f;color:#fff}
''' + D + ''' input:disabled,''' + D + ''' select:disabled,''' + D + ''' textarea:disabled,''' + D + ''' button:disabled{opacity:.6}
''' + D + ''' .tws-sidetip{background:#ebe8e0;color:#121613}
/* theme switch in the menu */
.tws-themetoggle .tws-sw{margin-left:auto;flex:none;position:relative;width:34px;height:20px;border-radius:999px;background:var(--line-2);transition:background .15s ease}
.tws-themetoggle .tws-sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .15s ease}
.tws-themetoggle[aria-checked=true] .tws-sw{background:var(--dm-fill-2,#3a7d5f)}
.tws-themetoggle[aria-checked=true] .tws-sw::after{transform:translateX(14px)}
html.tws-side-collapsed .tws-themetoggle .tws-sw{display:none}
@media (max-width:899px){html.tws-side-collapsed .tws-themetoggle .tws-sw{display:block}}
@media (prefers-reduced-motion:reduce){.tws-themetoggle .tws-sw,.tws-themetoggle .tws-sw::after{transition:none}}
'''


def main():
    css_files, js_files = read_index_assets()
    sources = []
    for c in css_files:
        sources.append((c, (PUB / c).read_text()))
    for j in js_files:
        if 'sidebar' in j:
            for t in sidebar_css(j):
                sources.append((j + ' (injected)', t))
            continue
        for t in js_css_blocks(j):
            sources.append((j + ' (injected)', t))
    # palette variables we define (fallbacks for these never apply)
    for name in re.findall(r'--([a-z0-9-]+)\s*:', PALETTE):
        KNOWN_VARS.add(name)
    blocks = []
    stats = {'rules': 0, 'decls': 0}
    for name, text in sources:
        out = emit(parse(text), stats)
        if out:
            blocks.append('/* from %s */\n%s' % (name, '\n'.join(out)))
    head = ('/* Staff Hub dark theme (tws-dark-v1). Generated by tools/dark-mode/build_dark_css.py from the\n'
            '   stylesheets linked in index.html. Applies only under html[data-theme=dark]; light is unchanged. */\n')
    OUT.write_text(head + PALETTE + '\n'.join(blocks) + '\n' + TAIL)
    print('wrote', OUT.relative_to(ROOT), 'sources:', len(sources), 'rules:', stats['rules'], 'decls:', stats['decls'],
          'bytes:', OUT.stat().st_size, file=sys.stderr)


if __name__ == '__main__':
    main()
