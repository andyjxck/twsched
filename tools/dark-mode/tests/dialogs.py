import re, json
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:8871'; JS=open('/tmp/twsdark/audit.js').read()
low={}; light={}; opened=[]
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for who in ('olly','sam'):
        c=b.new_context(viewport={'width':1280,'height':860},color_scheme='dark')
        c.route('**/*', lambda r: r.continue_() if r.request.url.startswith(('http://127.0.0.1','data:','blob:')) else r.abort())
        p=c.new_page(); p.goto(BASE+'/'); p.wait_for_selector('input[type=password]')
        p.fill('input[type=email]', who+'@example.test'); p.fill('input[type=password]','Test-pass-12345'); p.keyboard.press('Enter')
        p.wait_for_selector('#sidemenu',state='attached'); p.wait_for_timeout(1500)
        hs=[x for x in p.eval_on_selector_all('#sidemenu a.sidelink','e=>e.map(x=>x.getAttribute("href"))') if x and x.startswith('#')]
        for h in dict.fromkeys(hs):
            p.goto(BASE+'/'+h); p.wait_for_timeout(1200)
            btns=p.locator('main button:visible, .main button:visible, .content button:visible')
            n=min(btns.count(),40); tried=0
            for i in range(n):
                if tried>=3: break
                bt=btns.nth(i)
                try: t=(bt.inner_text(timeout=500) or '').strip()
                except Exception: continue
                if not re.search(r'^(\+ ?)?(Add|New|Request|Edit|Book|Create|Invite|Swap|Give|Report|Open|Reply|Compose|Message)\b',t,re.I): continue
                if re.search(r'delete|remove|publish|send|sign out|approve|decline',t,re.I): continue
                try: bt.click(timeout=1500)
                except Exception: continue
                p.wait_for_timeout(700); tried+=1
                d=p.locator('[role=dialog]:visible, .modal:visible, .sheet:visible, dialog[open]')
                if d.count():
                    opened.append('%s %s %r'%(who,h,t))
                    p.screenshot(path='/tmp/twsdark/shots/dialog-%s-%s-%d.png'%(who,h.strip('#/') or 'home',i))
                    r=p.evaluate(JS)
                    for x in r['low']: low.setdefault((x['el'],x['fg'],x['bg']),(who,h,t,x['ratio'],x['text']))
                    for x in r['light']: light.setdefault((x['el'],x['bg']),(who,h,t,x['text']))
                p.keyboard.press('Escape'); p.wait_for_timeout(300)
                p.goto(BASE+'/'+h); p.wait_for_timeout(900)
                btns=p.locator('main button:visible, .main button:visible, .content button:visible')
        c.close()
    b.close()
print('opened dialogs:',len(opened)); [print('  ',o) for o in opened]
print('LOW:'); [print('  ',k,v) for k,v in low.items()]
print('LIGHT:'); [print('  ',k,v) for k,v in light.items()]
