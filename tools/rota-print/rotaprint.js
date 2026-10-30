/* tws-rota-print: printable weekly rota for Staff Hub (Andy, 30 Oct).
   Standalone plain script. The Rota page (management only) calls window.__twsRotaPrint(data) from its
   "Print" button with what it has already loaded for the week, so this reads nothing from Firestore.
   Opens a print preview over the app with one A4 landscape sheet, laid out like the pub's paper rota:
   one table for the whole team in the Rota page's order, names down the left, Monday to Sunday along the top, short pub-style times (17:00-23:00 -> "5-11"), and an Events row from the app's
   own events. Printing hides everything except the sheet, in light colours whatever the theme.
   Styles: assets/rotaprint-tws2610rx.css. Source: tools/rota-print/. */
(function () {
  'use strict';
  if (window.__twsRotaPrint) return;

  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // A4 landscape with 8 mm margins: the printable area, in CSS pixels (96 per inch).
  var MM = 96 / 25.4, PAGE_W = Math.round(281 * MM), PAGE_H = Math.floor(194 * MM);

  function d(iso) { var p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12); }
  function ord(n) { var t = n % 100; if (t >= 11 && t <= 13) return n + 'th'; return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'); }
  // "17:00" -> "5", "17:30" -> "5:30", "12:00" -> "12", "00:00" -> "12". Pub style, no am/pm.
  function short(t) {
    if (!t) return '';
    var p = t.split(':'), h = Number(p[0]) % 12, m = p[1] || '00';
    return String(h === 0 ? 12 : h) + (m === '00' ? '' : ':' + m);
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var state = null; // { data, drafts, trigger }

  /* ---------- the sheet ---------- */

  function plan(data, withDrafts) {
    var days = data.days, inWeek = {};
    days.forEach(function (x) { inWeek[x] = true; });
    var shifts = (data.shifts || []).filter(function (s) { return inWeek[s.date] && (s.published || withDrafts); });
    var people = data.people || [];
    var byKey = {};
    shifts.forEach(function (s) { var k = (s.staffId || '') + '|' + s.date; (byKey[k] = byKey[k] || []).push(s); });
    Object.keys(byKey).forEach(function (k) { byKey[k].sort(function (a, b) { return (a.start || '').localeCompare(b.start || ''); }); });

    // One table for everyone, in the Rota page's own order (Andy, 30 Oct: no department sections).
    var rows = [];
    people.forEach(function (p) {
      if (p.open) return;
      if (p.gone && !shifts.some(function (s) { return s.staffId === p.id; })) return; // left: only with shifts this week
      rows.push({ id: p.id, name: p.name || 'No name' });
    });
    if (shifts.some(function (s) { return !s.staffId; })) rows.push({ id: '', name: 'Open shift', open: true });
    var tables = rows.length && shifts.length ? [{ dept: { key: 'all', name: 'Name' }, rows: rows }] : [];
    return { tables: tables, byKey: byKey, shifts: shifts, drafts: shifts.filter(function (s) { return !s.published; }).length };
  }

  function cell(data, P, row, day) {
    var td = el('td', 'c');
    var list = P.byKey[row.id + '|' + day] || [];
    var b = !row.open && data.blocks ? data.blocks[row.id + '|' + day] : null;
    var hol = b && b.kind === 'holiday';
    if (hol && !list.length) { td.className += ' hol'; td.appendChild(el('span', 'tag', 'Holiday')); return td; }
    list.forEach(function (s) {
      var w = el('div', 'sh' + (s.published ? '' : ' draft'));
      var t = el('span', 't', short(s.start) + '\u2013' + short(s.end));
      w.appendChild(t);
      if (s.leader) w.appendChild(el('span', 'star', '\u2605'));
      if (!s.published) w.appendChild(el('span', 'dr', 'draft'));
      if (hol) w.appendChild(el('span', 'dr', 'on holiday'));
      if (s.notes) w.appendChild(el('div', 'nt', s.notes));
      td.appendChild(w);
    });
    return td;
  }

  function eventText(e) {
    return (e.title || '').trim() + (e.start ? ' \u00b7 ' + short(e.start) : '');
  }

  function sheet(data, withDrafts) {
    var P = plan(data, withDrafts), days = data.days, ws = d(data.weekStart), we = d(days[6]);
    var root = el('div', 'tws-rp-sheet');
    root.setAttribute('data-testid', 'rota-print-sheet');

    var head = el('header', 'hd');
    var logo = el('img', 'logo'); logo.src = '/icons/logo-black-tws1.png'; logo.alt = ''; head.appendChild(logo);
    var tt = el('div', 'tt');
    tt.appendChild(el('h1', '', 'Rota w/c ' + DAYS[0] + ' ' + ord(ws.getDate()) + ' ' + MONTHS[ws.getMonth()] + ' ' + ws.getFullYear()));
    tt.appendChild(el('div', 'sub', 'The White Swan \u00b7 ' + ord(ws.getDate()) + (ws.getMonth() !== we.getMonth() ? ' ' + MONTHS[ws.getMonth()] : '') +
      ' to ' + ord(we.getDate()) + ' ' + MONTHS[we.getMonth()] + (ws.getFullYear() !== we.getFullYear() ? ' ' + we.getFullYear() : '')));
    head.appendChild(tt);
    var meta = el('div', 'meta');
    var st = data.status === 'approved' ? 'Approved' : data.status === 'published' ? 'Published' : 'Not published yet';
    meta.appendChild(el('div', 'st', st));
    var now = new Date();
    meta.appendChild(el('div', '', 'Printed ' + now.getDate() + ' ' + MONTHS[now.getMonth()].slice(0, 3) + ' ' + now.getFullYear() + ', ' +
      String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')));
    head.appendChild(meta);
    root.appendChild(head);

    if (withDrafts && P.drafts) root.appendChild(el('div', 'warn', 'Includes ' + P.drafts + ' draft shift' + (P.drafts === 1 ? '' : 's') + ' (marked draft). Drafts can still change.'));

    var events = data.events || [];
    var anyEvent = events.some(function (l) { return l && l.length; });
    P.tables.forEach(function (tb, ti) {
      var t = el('table', 'grid dept-' + tb.dept.key);
      var cg = el('colgroup'); cg.appendChild(el('col', 'cn'));
      days.forEach(function () { cg.appendChild(el('col', 'cd')); });
      t.appendChild(cg);
      var th = el('thead'), hr = el('tr');
      hr.appendChild(el('th', 'dept', tb.dept.name));
      days.forEach(function (x, i) {
        var c = el('th', 'day');
        c.appendChild(el('span', 'dn', DAYS[i] + ' '));
        c.appendChild(el('span', 'dd', ord(d(x).getDate())));
        hr.appendChild(c);
      });
      th.appendChild(hr); t.appendChild(th);
      var tbody = el('tbody');
      tb.rows.forEach(function (r, ri) {
        var tr = el('tr', (ri % 2 ? 'odd' : '') + (r.open ? ' open' : ''));
        tr.appendChild(el('th', 'nm', r.name));
        days.forEach(function (x) { tr.appendChild(cell(data, P, r, x)); });
        tbody.appendChild(tr);
      });
      // The week's events from the app's Events, along the bottom.
      var er = el('tr', 'ev');
      er.appendChild(el('th', 'nm', 'Events'));
      days.forEach(function (x, i) {
        var c = el('td', 'c');
        (events[i] || []).slice().sort(function (a, b) { return (a.start || '').localeCompare(b.start || ''); }).forEach(function (e) { c.appendChild(el('div', 'evt', eventText(e))); });
        er.appendChild(c);
      });
      tbody.appendChild(er);
      t.appendChild(tbody);
      root.appendChild(t);
    });
    if (!P.tables.length) root.appendChild(el('p', 'empty', withDrafts ? 'No shifts on the rota this week.' : 'No published shifts this week yet.'));

    var ft = el('footer', 'ft');
    ft.appendChild(el('span', '', 'Times are start to finish, e.g. 5\u201311 is 5pm to 11pm.'));
    if (P.shifts.some(function (s) { return s.leader; })) ft.appendChild(el('span', '', '\u2605 Shift leader'));
    if (!anyEvent) ft.appendChild(el('span', '', 'No events this week.'));
    root.appendChild(ft);
    return { node: root, plan: P };
  }

  // Largest text size (px) that keeps the sheet on one A4 landscape page. A very big week that still
  // overflows at the smallest size is laid out wider and scaled down (transform) to fill the page width,
  // inside a box of the scaled height, so it still prints on one page.
  function fit(node) {
    var box = node.parentNode;
    node.style.width = PAGE_W + 'px';
    node.style.transform = '';
    node.classList.remove('scaled');
    box.style.height = '';
    var size = 12;
    for (; size > 7; size -= 0.25) {
      node.style.fontSize = size + 'px';
      if (node.scrollHeight <= PAGE_H) return { size: size, zoom: 1 };
    }
    var z = 1;
    while (z > 0.5) {
      z = Math.round((z - 0.025) * 1000) / 1000;
      node.style.width = Math.floor(PAGE_W / z) + 'px';
      if (node.scrollHeight * z <= PAGE_H) break;
    }
    node.classList.add('scaled');
    node.style.transform = 'scale(' + z + ')';
    box.style.height = Math.ceil(node.scrollHeight * z) + 'px';
    return { size: size, zoom: z };
  }

  /* ---------- the preview ---------- */

  function pageStyle(on) {
    var id = 'tws-rp-page';
    var s = document.getElementById(id);
    if (on && !s) {
      s = el('style'); s.id = id;
      s.textContent = '@page{size:A4 landscape;margin:8mm}';
      document.head.appendChild(s);
    } else if (!on && s) s.remove();
  }

  function scalePreview() {
    var box = document.querySelector('#tws-rp .tws-rp-stage'), pg = document.querySelector('#tws-rp .tws-rp-page');
    if (!box || !pg) return;
    var w = Math.round(297 * MM), h = Math.max(Math.round(210 * MM), pg.scrollHeight);
    var sc = Math.min(1, (box.clientWidth - 24) / w);
    pg.style.transform = 'scale(' + sc + ')';
    pg.parentNode.style.width = Math.round(w * sc) + 'px';
    pg.parentNode.style.height = Math.round(h * sc) + 'px';
  }

  function render() {
    var ov = document.getElementById('tws-rp');
    if (!ov || !state) return;
    var holder = ov.querySelector('.tws-rp-page');
    holder.textContent = '';
    var s = sheet(state.data, state.drafts);
    var box = el('div', 'tws-rp-fit');
    box.appendChild(s.node);
    holder.appendChild(box);
    state.fit = fit(s.node);
    var cb = ov.querySelector('.tws-rp-drafts');
    var nDrafts = (state.data.shifts || []).filter(function (x) { return !x.published && state.data.days.indexOf(x.date) >= 0; }).length;
    cb.parentNode.style.display = nDrafts ? '' : 'none';
    cb.parentNode.lastChild.textContent = ' Include ' + nDrafts + ' draft shift' + (nDrafts === 1 ? '' : 's');
    scalePreview();
  }

  function close() {
    var ov = document.getElementById('tws-rp');
    if (ov) ov.remove();
    document.documentElement.classList.remove('tws-rp-open');
    pageStyle(false);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', scalePreview);
    var t = state && state.trigger;
    state = null;
    if (t && t.focus) try { t.focus(); } catch (e) {}
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open(data) {
    if (!data || !data.weekStart || !data.days) return;
    close();
    state = { data: data, drafts: false, trigger: document.activeElement };
    var ov = el('div', 'tws-rp');
    ov.id = 'tws-rp';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Print rota');
    var bar = el('div', 'tws-rp-bar');
    var ws = d(data.weekStart);
    var ttl = el('div', 'tws-rp-title');
    ttl.appendChild(el('strong', '', 'Print rota'));
    ttl.appendChild(el('span', '', ' w/c ' + ws.getDate() + ' ' + MONTHS[ws.getMonth()].slice(0, 3) + ' ' + ws.getFullYear()));
    bar.appendChild(ttl);
    var lab = el('label', 'tws-rp-check');
    var cb = el('input', 'tws-rp-drafts'); cb.type = 'checkbox';
    cb.addEventListener('change', function () { state.drafts = cb.checked; render(); });
    lab.appendChild(cb); lab.appendChild(el('span', '', ''));
    bar.appendChild(lab);
    var acts = el('div', 'tws-rp-acts');
    var pb = el('button', 'btn sm', 'Print or save PDF'); pb.type = 'button'; pb.setAttribute('data-testid', 'rota-print-go');
    pb.addEventListener('click', function () { window.print(); });
    var cl = el('button', 'btn secondary sm', 'Close'); cl.type = 'button'; cl.setAttribute('data-testid', 'rota-print-close');
    cl.addEventListener('click', close);
    acts.appendChild(pb); acts.appendChild(cl);
    bar.appendChild(acts);
    ov.appendChild(bar);
    var stage = el('div', 'tws-rp-stage');
    var wrap = el('div', 'tws-rp-wrap');
    wrap.appendChild(el('div', 'tws-rp-page'));
    stage.appendChild(wrap);
    ov.appendChild(stage);
    document.body.appendChild(ov);
    document.documentElement.classList.add('tws-rp-open');
    pageStyle(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', scalePreview);
    render();
    pb.focus();
  }

  window.__twsRotaPrint = open;
  window.__twsRotaPrint.close = close;
  window.__twsRotaPrint._short = short;
})();
