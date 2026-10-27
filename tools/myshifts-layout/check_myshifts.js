// My shifts layout check. usage: node ms.js <outdir> [engine]
const pw = require('/tmp/pwt/node_modules/playwright-core');
const fs = require('fs');
const OUT = process.argv[2] || '/tmp/msfix/shots';
const ENGINE = process.argv[3] || 'chromium';
const WIDTHS = (process.env.WIDTHS || '360,375,390,414,430,768,1024,1440').split(',').map(Number);
const ROUTE = process.env.ROUTE || 'rota';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROBE = () => {
  const res = { fails: [], cards: 0 };
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) res.fails.push('page scrolls sideways');
  const box = (e) => e.getBoundingClientRect();
  const lines = (e) => { const r = document.createRange(); r.selectNodeContents(e); const tops = new Set([...r.getClientRects()].map((x) => Math.round(x.top))); return tops.size; };
  const ov = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
  for (const li of document.querySelectorAll('[data-testid=my-shift]')) {
    res.cards++;
    const grow = li.querySelector('.grow');
    const date = grow.querySelector('strong');
    const time = grow.children[1];
    const acts = li.querySelector('.actions');
    const btns = [...acts.querySelectorAll('button')];
    const name = date.innerText;
    if (lines(date) > 1) res.fails.push(`${name}: date wraps (${lines(date)} lines)`);
    if (lines(time) > 1) res.fails.push(`${name}: time line wraps "${time.innerText}"`);
    const g = box(grow);
    for (const b of btns) {
      const r = box(b);
      if (ov(r, box(date)) || ov(r, box(time))) res.fails.push(`${name}: ${b.innerText} overlaps the text`);
      if (r.right > vw + 0.5 || r.left < -0.5) res.fails.push(`${name}: ${b.innerText} off screen`);
      if (b.scrollWidth > b.clientWidth + 1) res.fails.push(`${name}: ${b.innerText} text clipped`);
    }
    for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) if (ov(box(btns[i]), box(btns[j]))) res.fails.push(`${name}: ${btns[i].innerText} x ${btns[j].innerText}`);
    for (const e of [date, time]) { if (e.scrollWidth > e.clientWidth + 1) res.fails.push(`${name}: text clipped "${e.innerText}"`); if (box(e).right > vw + 0.5) res.fails.push(`${name}: text off screen`); }
    if (vw < 640 && box(acts).top < g.bottom - 1) res.fails.push(`${name}: actions not below the text on a phone`);
    if (box(li).right > vw + 0.5) res.fails.push(`${name}: card wider than screen`);
  }
  return res;
};
(async () => {
  const browser = await pw[ENGINE].launch();
  let fails = 0; const errors = [];
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1, hasTouch: w < 800, isMobile: ENGINE === 'chromium' && w < 800 });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${w}: ${e.message}`));
    await p.goto('http://127.0.0.1:9021/');
    await p.fill('input[type=email]', process.env.EMAIL || 'sam@example.test');
    await p.fill('input[type=password]', 'Test-pass-12345');
    await p.click('button:has-text("Sign in")');
    await p.waitForFunction(() => !document.querySelector('input[type=password]') && document.body.innerText.length > 100, null, { timeout: 25000 });
    await sleep(1000);
    await p.goto('http://127.0.0.1:9021/#/' + ROUTE);
    await p.waitForSelector('[data-testid=my-shift]', { timeout: 15000 }).catch(() => {});
    await sleep(1200);
    await p.screenshot({ path: `${OUT}/myshifts-${ENGINE}-${w}.png`, fullPage: true });
    const r = await p.evaluate(PROBE);
    const u = [...new Set(r.fails)];
    fails += u.length;
    console.log(`${ENGINE} ${w}px: ${r.cards} cards, ${u.length ? u.length + ' problems' : 'ok'}`);
    for (const f of u.slice(0, 8)) console.log('   ' + f);
    await ctx.close();
  }
  console.log('page errors:', errors.length, errors.slice(0, 3).join(' | '));
  await browser.close();
  process.exit(fails || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
