/* tws-consent-v1: cookie choice + Google Analytics for Staff Hub. Standalone: no app code is changed.
   - Nothing from Google loads until the person taps "Accept". Consent Mode v2 starts as denied.
   - Privacy: every hit reports the same page ("/", title "Staff Hub") with no referrer, so no
     names, IDs, emails, links or query strings from the app reach Google. No user ID is ever set.
     Advertising signals and Google signals stay off.
   - The choice is kept on this device for 12 months ('tws-cookie-choice'), then asked again.
     "Cookie settings" on the privacy notice reopens it; saying no later removes the _ga cookies.
   - With no ID in /analytics-config.js nothing loads and no banner shows. */
(function () {
  var ID = String(window.TWS_GA_ID || '');
  if (!/^G-[A-Z0-9]{4,}$/.test(ID)) { window.twsCookieSettings = function () {}; return; }
  var KEY = 'tws-cookie-choice', MAX_AGE = 365 * 864e5, loaded = false, box = null;
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
  gtag('set', 'ads_data_redaction', true);
  var SAFE = { page_location: location.origin + '/', page_path: '/', page_title: 'Staff Hub', page_referrer: '' };

  function read() {
    try { var c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && (c.a === 'granted' || c.a === 'denied') && Date.now() - c.t < MAX_AGE) return c.a; } catch (e) {}
    return null;
  }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify({ a: v, t: Date.now() })); } catch (e) {} }

  function start() {
    gtag('consent', 'update', { analytics_storage: 'granted' });
    if (loaded) return;
    loaded = true;
    gtag('js', new Date());
    gtag('set', SAFE);
    gtag('config', ID, Object.assign({ allow_google_signals: false, allow_ad_personalization_signals: false }, SAFE));
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ID);
    document.head.appendChild(s);
  }
  function stop() {
    if (loaded) gtag('consent', 'update', { analytics_storage: 'denied' });
    var parts = location.hostname.split('.'), doms = [''];
    for (var i = 0; i < parts.length - 1; i++) doms.push('.' + parts.slice(i).join('.'));
    document.cookie.split(';').forEach(function (c) {
      var n = c.trim().split('=')[0];
      if (/^_ga/.test(n)) doms.forEach(function (d) { document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : ''); });
    });
  }
  function hide() { if (box) { box.remove(); box = null; } }
  function choose(v) { save(v); if (v === 'granted') start(); else stop(); hide(); }

  function css() {
    if (document.getElementById('tws-consent-css')) return;
    var st = document.createElement('style');
    st.id = 'tws-consent-css';
    st.textContent =
      '.tws-cookie{position:fixed;z-index:2147483000;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));width:min(360px,calc(100% - 32px));box-sizing:border-box;' +
      'padding:16px;background:var(--paper,#fff);color:var(--ink,#22251f);border:1px solid var(--line,#ddd3c0);border-radius:var(--radius,12px);' +
      'box-shadow:0 14px 36px -14px rgba(0,0,0,.35);font:400 14px/1.5 var(--sans,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif)}' +
      '.tws-cookie p{margin:0 0 12px}.tws-cookie b{font-weight:600}' +
      '.tws-cookie .row{display:flex;gap:8px}' +
      '.tws-cookie button{flex:1;min-height:40px;border-radius:999px;font:inherit;font-weight:600;cursor:pointer}' +
      '.tws-cookie .yes{background:var(--green,#1f3a2e);color:#fff;border:1px solid var(--green,#1f3a2e)}' +
      '.tws-cookie .no{background:transparent;color:var(--ink,#22251f);border:1px solid var(--line,#ddd3c0)}' +
      '.tws-cookie button:focus-visible{outline:none;box-shadow:0 0 0 3px var(--paper,#fff),0 0 0 5px var(--gold,#b8893b)}' +
      'html[data-theme=dark] .tws-cookie .yes{background:var(--gold,#b8893b);border-color:var(--gold,#b8893b);color:#16130d}' +
      '@media (max-width:640px){.tws-cookie{left:10px;right:10px;width:auto;bottom:calc(10px + env(safe-area-inset-bottom))}}';
    document.head.appendChild(st);
  }
  function show() {
    if (box || !document.body) return;
    css();
    box = document.createElement('div');
    box.className = 'tws-cookie';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Cookie choice');
    box.innerHTML = '<p><b>Can we count your visit?</b> We\u2019d like to use Google Analytics cookies to see how many people use the Staff Hub. ' +
      'They never include your name or shifts, and stay off unless you say yes.</p>' +
      '<div class="row"><button type="button" class="yes" data-v="granted">Accept</button><button type="button" class="no" data-v="denied">No thanks</button></div>';
    box.addEventListener('click', function (e) { var b = e.target.closest('button[data-v]'); if (b) choose(b.getAttribute('data-v')); });
    document.body.appendChild(box);
  }
  window.twsCookieSettings = show;

  var c = read();
  if (c === 'granted') start();
  else if (c === null) { if (document.body) show(); else document.addEventListener('DOMContentLoaded', show); }
})();
