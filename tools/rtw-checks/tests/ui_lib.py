from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:8791/'
def guard(p,log):
    def h(route):
        log.append('BLOCKED '+route.request.url[:120]); route.abort()
    import urllib.parse as up
    p.route(lambda u: not (up.urlparse(u).hostname or '') in ('127.0.0.1','localhost'), h)
def login(p,email):
    p.goto(URL,wait_until='networkidle'); p.wait_for_timeout(800)
    p.fill('input[type=email]',email); p.fill('input[type=password]','Test-pass-12345')
    p.click('button:has-text("Sign in")'); p.wait_for_timeout(3000)
