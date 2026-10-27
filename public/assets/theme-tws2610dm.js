/* tws-dark-v1: light/dark theme for Staff Hub. Standalone: no app code is changed.
   Loaded as a plain script at the top of <head> so the theme is set before the first paint (no light flash).
   Choice is saved per device ('tws-theme' = 'dark' | 'light'); with no saved choice it follows the device setting.
   The switch is added to the menu footer, above Sign out. Styles: assets/theme-tws2610dm.css. */
(function () {
  'use strict';
  if (window.__twsTheme) return;
  window.__twsTheme = true;
  var KEY = 'tws-theme';
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var LIGHT_BAR = '#1f3a2e';
  var DARK_BAR = '#121613';

  function saved() { try { var v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; } catch (e) { return null; } }
  function save(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function wanted() { return saved() || (mq && mq.matches ? 'dark' : 'light'); }
  function current() { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }

  function metaBar(t) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? DARK_BAR : LIGHT_BAR);
  }
  function sync(btn) {
    btn.setAttribute('aria-checked', current() === 'dark' ? 'true' : 'false');
  }
  function apply(t) {
    if (t === 'dark') root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme');
    metaBar(t);
    var b = document.querySelector('.tws-themetoggle');
    if (b) sync(b);
  }
  apply(wanted());

  function set(t) { save(t); apply(t); }
  window.twsTheme = { set: set, get: current, toggle: function () { set(current() === 'dark' ? 'light' : 'dark'); } };

  // A device setting change applies only while the person hasn't picked a theme here.
  if (mq) {
    var onMq = function () { if (!saved()) apply(wanted()); };
    mq.addEventListener ? mq.addEventListener('change', onMq) : mq.addListener && mq.addListener(onMq);
  }
  // Keep other open tabs in step.
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(wanted()); });

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';

  function mount() {
    var aside = document.getElementById('sidemenu');
    if (!aside) return;
    var foot = aside.querySelector('.side-foot');
    if (!foot || foot.querySelector('.tws-themetoggle')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sidelink tws-themetoggle';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('data-testid', 'theme-toggle');
    btn.innerHTML = ICON + '<span class="lbl">Dark mode</span><span class="tws-sw" aria-hidden="true"></span>';
    sync(btn);
    btn.addEventListener('click', function () { window.twsTheme.toggle(); });
    var links = foot.querySelectorAll('.sidelink');
    var last = links.length ? links[links.length - 1] : null; // Sign out
    if (last && last.tagName === 'BUTTON') foot.insertBefore(btn, last); else foot.appendChild(btn);
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(function () { queued = false; mount(); });
  }
  function start() {
    mount();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
