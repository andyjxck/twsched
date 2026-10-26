/* tws-sidebar-v1: collapsible desktop sidebar for Staff Hub. Standalone: no app code is changed. */
(function () {
  'use strict';
  if (window.__twsSidebar) return;
  window.__twsSidebar = true;
  var KEY = 'tws-sidebar-collapsed';
  var CLS = 'tws-side-collapsed';
  var DESK = '(min-width: 900px)';
  var root = document.documentElement;

  function stored() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function store(v) { try { v ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch (e) {} }
  function isCollapsed() { return root.classList.contains(CLS); }
  function isDesk() { return !window.matchMedia || window.matchMedia(DESK).matches; }
  if (stored()) root.classList.add(CLS);

  var C = 'html.' + CLS;
  var SR = 'position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;white-space:nowrap!important;border:0!important;flex:none!important';
  var css = [
    'html .tws-sidetoggle{display:none}',
    '@media (min-width:900px){',
    'html .sidemenu{transition:width .18s ease,padding .18s ease}',
    'html #main{transition:margin-left .18s ease}',
    'html .sidemenu .side-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}',
    'html .sidemenu .side-head>div:first-child{min-width:0}',
    'html .tws-sidetoggle{display:inline-grid;place-items:center;flex:none;width:34px;height:34px;margin:-3px -6px 0 0;padding:0;border:0;border-radius:9px;background:transparent;color:var(--muted);cursor:pointer}',
    'html .tws-sidetoggle:hover{background:var(--bg);color:var(--ink)}',
    'html .tws-sidetoggle:focus-visible{outline:none;box-shadow:var(--focus)}',
    'html .tws-sidetoggle svg{width:20px;height:20px;display:block}',
    C + '{--side-w:72px;--frame:1408px}',
    C + ' .sidemenu{padding:14px 10px 12px;overflow-x:hidden}',
    C + ' .sidemenu .side-head{flex-direction:column;align-items:center;padding:0 0 10px;margin-bottom:2px}',
    C + ' .sidemenu .side-head>div:first-child{display:none}',
    C + ' .tws-sidetoggle{width:44px;height:44px;margin:0}',
    C + ' .sidemenu .side-group{height:1px;margin:10px 8px;padding:0;background:var(--line);font-size:0;line-height:0;color:transparent;overflow:hidden}',
    C + ' .sidemenu .sidelink{justify-content:center;gap:0;padding:0;min-height:44px}',
    C + ' .sidemenu .sidelink .lbl{' + SR + '}',
    C + ' .sidemenu .sidelink .badge{position:absolute;top:3px;right:3px;min-width:18px;height:18px;padding:0 5px;font-size:.68rem}',
    C + ' .sidemenu .side-foot{padding-top:10px}',
    C + ' .sidemenu .side-user{justify-content:center;padding:6px 0 8px}',
    C + ' .sidemenu .side-name{' + SR + '}',
    'html .tws-sidetip{position:fixed;z-index:95;left:0;top:0;pointer-events:none;padding:6px 10px;border-radius:8px;background:var(--ink);color:#fff;font-size:.84rem;font-weight:500;line-height:1.3;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.18);opacity:0;visibility:hidden;transform:translateX(-4px);transition:opacity .12s ease,transform .12s ease,visibility 0s .12s}',
    'html .tws-sidetip.show{opacity:1;visibility:visible;transform:none;transition:opacity .12s ease,transform .12s ease,visibility 0s}',
    '}',
    '@media (max-width:899px){html .tws-sidetip{display:none}}',
    '@media (prefers-reduced-motion:reduce){html .sidemenu,html #main,html .tws-sidetip{transition:none!important}}'
  ].join('\n');
  var st = document.createElement('style');
  st.id = 'tws-sidebar-css';
  st.textContent = css;
  (document.head || root).appendChild(st);

  var ICON_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path d="M15.5 9.5 13 12l2.5 2.5"/></svg>';
  var ICON_SHUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path d="M13 9.5 15.5 12 13 14.5"/></svg>';

  var tip = null;
  function getTip() {
    if (tip && tip.isConnected) return tip;
    tip = document.createElement('div');
    tip.className = 'tws-sidetip';
    tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);
    return tip;
  }
  function hideTip() { if (tip) tip.classList.remove('show'); }
  function tipText(el) {
    if (el.classList.contains('tws-sidetoggle')) return el.getAttribute('aria-label');
    if (!isCollapsed()) return '';
    var lbl = el.querySelector('.lbl');
    if (!lbl) return '';
    var t = lbl.textContent.trim();
    var b = el.querySelector('.badge');
    if (b && b.firstChild && b.firstChild.nodeType === 3) {
      var n = b.firstChild.nodeValue.trim();
      if (n) t += ' (' + n + ')';
    }
    return t;
  }
  function showTip(el) {
    if (!isDesk()) return hideTip();
    var t = tipText(el);
    if (!t) return hideTip();
    var tp = getTip();
    tp.textContent = t;
    var r = el.getBoundingClientRect();
    tp.style.left = Math.round(r.right + 10) + 'px';
    tp.style.top = '0px';
    var h = tp.offsetHeight || 28;
    tp.style.top = Math.round(r.top + r.height / 2 - h / 2) + 'px';
    tp.classList.add('show');
  }

  function sync(btn) {
    var c = isCollapsed();
    btn.setAttribute('aria-expanded', c ? 'false' : 'true');
    btn.setAttribute('aria-label', c ? 'Expand menu' : 'Collapse menu');
    btn.innerHTML = c ? ICON_SHUT : ICON_OPEN;
  }
  function setCollapsed(v) {
    root.classList.toggle(CLS, !!v);
    store(!!v);
    var btn = document.querySelector('#sidemenu .tws-sidetoggle');
    if (btn) sync(btn);
    hideTip();
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
  }
  window.twsSidebar = { collapse: function () { setCollapsed(true); }, expand: function () { setCollapsed(false); }, isCollapsed: isCollapsed };

  var bound = null;
  function mount() {
    var aside = document.getElementById('sidemenu');
    if (!aside) return;
    var head = aside.querySelector('.side-head');
    if (head && !head.querySelector('.tws-sidetoggle')) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tws-sidetoggle';
      btn.setAttribute('aria-controls', 'sidemenu');
      btn.setAttribute('data-testid', 'sidebar-toggle');
      sync(btn);
      btn.addEventListener('click', function () {
        setCollapsed(!isCollapsed());
        if (btn.matches(':hover') || document.activeElement === btn) showTip(btn);
      });
      head.appendChild(btn);
    }
    if (bound !== aside) {
      bound = aside;
      aside.addEventListener('mouseover', function (e) {
        var el = e.target.closest && e.target.closest('a,button');
        if (el && aside.contains(el)) showTip(el);
      });
      aside.addEventListener('mouseleave', hideTip);
      aside.addEventListener('focusin', function (e) {
        var el = e.target.closest && e.target.closest('a,button');
        if (el && aside.contains(el)) showTip(el); else hideTip();
      });
      aside.addEventListener('focusout', function (e) {
        if (!e.relatedTarget || !aside.contains(e.relatedTarget)) hideTip();
      });
      aside.addEventListener('scroll', hideTip, { passive: true });
      aside.addEventListener('click', function (e) {
        var el = e.target.closest && e.target.closest('a,button');
        if (el && !el.classList.contains('tws-sidetoggle')) hideTip();
      });
    }
  }

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
  window.addEventListener('hashchange', hideTip);
  if (window.matchMedia) {
    var mq = window.matchMedia(DESK);
    var onMq = function () { hideTip(); };
    mq.addEventListener ? mq.addEventListener('change', onMq) : mq.addListener && mq.addListener(onMq);
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
