// UI smoke test: Show on screen + email change, real patched bundle against local emulators (made-up people).
const { chromium } = require('/tmp/rpx/node_modules/playwright-core');
const fs = require('fs');
const seed = JSON.parse(fs.readFileSync('/home/sprite/tws-showpw-preview/seed-ids.json'));
const BASE = 'http://127.0.0.1:8097';
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${!c && d ? '  -> ' + d : ''}`); };
const exe = fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').filter((x) => x.startsWith('chromium-'))[0];
(async () => {
  const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/${exe}/chrome-linux64/chrome`, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  try {
    await page.goto(BASE + '/');
    await page.fill('input[type=email]', 'owner@preview.test');
    await page.fill('input[type=password]', seed.password);
    await page.locator('button[type=submit], button:has-text("Sign in")').first().click();
    await page.waitForTimeout(4000);
    await page.locator('a:has-text("Team"), button:has-text("Team")').first().click();
    await page.waitForTimeout(3000);
    const ivyPill = await page.locator('text=Not signed in yet').count();
    check('Team page loads with Ivy listed', (await page.locator('text=Ivy Icloud').count()) > 0);
    // open Ivy's page
    const row = page.locator('xpath=//strong[normalize-space()="Ivy Icloud"]/ancestor::*[.//button[normalize-space()="Edit"]][1]//button[normalize-space()="Edit"]').first();
    await row.click();
    await page.waitForTimeout(1500);
    const btn = page.locator('[data-testid=show-login]');
    check('Show on screen button next to Resend login', (await btn.count()) === 1 && (await page.locator('button:has-text("Resend login")').count()) >= 1);
    const emailInput = page.locator('[data-testid=staff-email]');
    check('email field is editable for the owner', (await emailInput.count()) === 1 && !(await emailInput.isDisabled()));
    await btn.click();
    await page.waitForTimeout(4000);
    if (!(await page.locator('[data-testid=shown-password]').count())) console.log('PAGE:', (await page.innerText('body')).slice(-1500));
    await page.waitForSelector('[data-testid=shown-password]', { timeout: 15000 });
    const pw = (await page.locator('[data-testid=shown-password]').innerText()).trim();
    check('temporary password shown on screen', pw.length >= 10, pw);
    check('says no email was sent', (await page.locator('[data-testid=shown-ok]').innerText()).includes('No email was sent'));
    await page.click('[data-testid=shown-copy]');
    await page.waitForTimeout(500);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check('Copy button copies the password', clip === pw, clip);
    await page.screenshot({ path: '/home/sprite/tws-showpw-preview/shot-shown.png' });
    await page.keyboard.press('Escape');
    await page.locator('button:has-text("Close"), button[aria-label=Close]').first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await page.locator('a:has-text("Home"), button:has-text("Home")').first().click().catch(() => {});
    await page.waitForTimeout(1000);
    await page.locator('a:has-text("Team"), button:has-text("Team")').first().click();
    await page.waitForTimeout(2500);
    check('Team list shows "Password shown on screen"', (await page.locator('text=Password shown on screen').count()) > 0);
    // change Kit's email
    await page.locator('xpath=//strong[normalize-space()="Kit Kitchen"]/ancestor::*[.//button[normalize-space()="Edit"]][1]//button[normalize-space()="Edit"]').first().click();
    await page.waitForTimeout(1500);
    await page.fill('[data-testid=staff-email]', 'kit.new@preview.test');
    await page.locator('button:has-text("Save")').last().click();
    await page.waitForSelector('[data-testid=email-changed]', { timeout: 15000 });
    check('email change confirmed on screen', (await page.locator('[data-testid=email-changed]').innerText()).includes('kit.new@preview.test'));
    await page.screenshot({ path: '/home/sprite/tws-showpw-preview/shot-email.png' });
    // a taken address
    await page.fill('[data-testid=staff-email]', 'staff@preview.test');
    await page.locator('button:has-text("Save")').last().click();
    await page.waitForTimeout(3000);
    check('taken address refused with a clear message', (await page.locator('text=Another login already uses').count()) > 0);
  } catch (e) {
    check('no exception', false, e.message.split('\n')[0]);
    await page.screenshot({ path: '/home/sprite/tws-showpw-preview/shot-fail.png' }).catch(() => {});
  }
  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
})();
