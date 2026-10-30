/* tws-rota-print: printable weekly rota for Staff Hub (Andy, 30 Oct).
   Standalone plain script. The Rota page (management only) calls window.__twsRotaPrint(data) from its
   "Print" button with what it has already loaded for the week, so this reads nothing from Firestore.
   Opens the print preview as a full page in the same tab (no popup; Back closes it) with one A4 landscape sheet, laid out like the pub's paper rota:
   one table for the whole team in the Rota page's order, names down the left, Monday to Sunday along the top, short pub-style times (17:00-23:00 -> "5-11"), and an Events row from the app's
   own events. Printing hides everything except the sheet, in light colours whatever the theme.
   Buttons: Print (window.print, with a message where the browser can't print, e.g. the Sesame in-app browser
   or a home-screen web app on iPhone) and Save PDF (a real PDF drawn with jsPDF: the share sheet on iPhone,
   so it can be printed, saved to Files or sent; a download elsewhere).
   Styles: assets/rotaprint-tws2610pa.css. Source: tools/rota-print/. */
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

  /* ---------- the PDF (Save PDF button) ----------
     Drawn straight from the same plan as the sheet with jsPDF (loaded only when the preview opens), so it
     works where window.print() does nothing: the Sesame in-app browser and other iPhone web views, and
     home-screen web apps. One A4 landscape page, vector text, same layout and colours as the sheet. */

  var JSPDF_SRC = '/assets/jspdf-4.2.1.umd.min.js';
  var jsPdfLoading = null;
  function loadJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (jsPdfLoading) return jsPdfLoading;
    jsPdfLoading = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = JSPDF_SRC; sc.async = true;
      sc.onload = function () { window.jspdf && window.jspdf.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF missing')); };
      sc.onerror = function () { jsPdfLoading = null; reject(new Error('Could not load the PDF maker')); };
      document.head.appendChild(sc);
    });
    return jsPdfLoading;
  }

  var logoCache = null;
  function loadLogo() {
    if (logoCache) return logoCache;
    logoCache = new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          resolve({ data: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight });
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = '/icons/logo-black-tws1.png';
    });
    return logoCache;
  }

  // The built-in PDF fonts only know Western European letters: other accented letters lose the accent
  // (\u0141uk\u0105sz -> Lukasz), and letters from other alphabets become '?'.
  function pdfText(t) {
    var LAT = { '\u0141': 'L', '\u0142': 'l', '\u0110': 'D', '\u0111': 'd', '\u0131': 'i', '\u0152': 'OE', '\u0153': 'oe', '\u00df': 'ss' };
    return String(t == null ? '' : t).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
      .replace(/[^\u0000-\u00ff\u2013\u2014\u2026\u20ac]/g, function (ch) {
        if (LAT[ch]) return LAT[ch];
        var base = ch.normalize ? ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : ch;
        return /^[\u0000-\u00ff]+$/.test(base) ? base : '?';
      });
  }

  function pdfFileName(data) {
    var ws = d(data.weekStart);
    return 'Rota-w-c-' + ws.getDate() + '-' + MONTHS[ws.getMonth()].slice(0, 3) + '-' + ws.getFullYear() + '.pdf';
  }

  function buildPdf(JsPDF, data, withDrafts, logo) {
    var P = plan(data, withDrafts), days = data.days, ws = d(data.weekStart), we = d(days[6]);
    var doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    var PW = 297, PH = 210, M = 8, CW = PW - 2 * M, AVAIL = PH - 2 * M;
    var PT = 25.4 / 72; // mm per point
    var GREEN = [31, 58, 46], INK = [28, 31, 27], MUTED = [93, 96, 88], AMBER = [125, 90, 28], DRAFT = [138, 90, 0], LINE = [211, 210, 202];
    var nameW = CW * 0.13, dayW = (CW - nameW) / 7;
    var events = data.events || [];
    var anyEvent = events.some(function (l) { return l && l.length; });

    function font(style, size, family) { doc.setFont(family || 'helvetica', style); doc.setFontSize(size); }
    function lh(size) { return size * PT * 1.2; }
    function wrap(t, w) { return doc.splitTextToSize(pdfText(t), Math.max(1, w)); }

    // Lay out every cell at base size f (pt). Returns rows with heights; draws nothing.
    function layout(f) {
      var pad = f * PT * 0.35, inner = dayW - 2 * pad, out = { f: f, pad: pad, rows: [] };
      var small = f * 0.8, tiny = f * 0.75;
      font('bold', f);
      out.head = days.map(function (x, i) { return wrap(DAYS[i] + ' ' + ord(d(x).getDate()), inner); });
      out.headH = 2 * pad + Math.max.apply(null, out.head.map(function (l) { return l.length; })) * lh(f);
      P.tables.forEach(function (tb) {
        tb.rows.forEach(function (r) {
          font('bold', f);
          var nm = wrap(r.name, nameW - 2 * pad), cells = [], h = nm.length * lh(f);
          days.forEach(function (x) {
            var list = P.byKey[r.id + '|' + x] || [];
            var b = !r.open && data.blocks ? data.blocks[r.id + '|' + x] : null;
            var hol = b && b.kind === 'holiday', items = [], ch = 0;
            if (hol && !list.length) { items.push({ kind: 'hol' }); ch = lh(small); }
            list.forEach(function (s, si) {
              var it = { kind: 'sh', s: s, t: short(s.start) + '\u2013' + short(s.end), gap: si ? f * PT * 0.5 : 0 };
              var extra = [];
              if (!s.published) extra.push('draft');
              if (hol) extra.push('on holiday');
              it.extra = extra.join(' ');
              font('normal', small);
              it.notes = s.notes ? wrap(s.notes, inner) : [];
              it.h = lh(f) + it.notes.length * lh(small) + it.gap;
              ch += it.h;
              items.push(it);
            });
            cells.push({ items: items, h: ch, hol: hol });
            h = Math.max(h, ch);
          });
          out.rows.push({ r: r, nm: nm, cells: cells, h: Math.max(h, lh(f)) + 2 * pad });
        });
      });
      font('bold', f * 0.85);
      out.ev = days.map(function (x, i) {
        return (events[i] || []).slice().sort(function (a, b) { return (a.start || '').localeCompare(b.start || ''); })
          .map(function (e) { return wrap(eventText(e).toUpperCase(), inner); });
      });
      var evLines = Math.max.apply(null, out.ev.map(function (c) { return c.reduce(function (n, l) { return n + l.length; }, 0); }).concat([1]));
      out.evH = Math.max(f * PT * 2.4, evLines * lh(f * 0.85) + 2 * pad);
      out.titleH = lh(f * 2) * 0.95;
      out.hdH = Math.max(f * PT * 3.6, out.titleH + lh(f)) + f * PT * 0.6;
      out.warnH = withDrafts && P.drafts ? lh(f) + 2 * pad + f * PT * 0.6 : 0;
      var tableH = P.tables.length ? out.headH + out.rows.reduce(function (n, r) { return n + r.h; }, 0) + out.evH : lh(f * 1.2) * 3;
      out.total = out.hdH + f * PT * 0.7 + out.warnH + tableH + f * PT * 0.8 + lh(tiny);
      return out;
    }

    var L = null;
    for (var f = 11; f >= 4.5; f -= 0.25) { L = layout(f); if (L.total <= AVAIL) break; }
    // A very big week that still overflows at the smallest size: shrink the whole page to fit.
    var zoom = L.total > AVAIL ? AVAIL / L.total : 1;
    if (zoom < 1) L = layout(4.5 * zoom);
    f = L.f;
    var pad = L.pad, small = f * 0.8, y = M;

    function star(cx, cy, r) {
      var pts = [];
      for (var i = 0; i < 10; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
        pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
      }
      var rel = [];
      for (var j = 1; j < pts.length; j++) rel.push([pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]]);
      doc.setFillColor(184, 137, 59);
      doc.lines(rel, pts[0][0], pts[0][1], [1, 1], 'F', true);
    }
    function fill(rgb, x, yy, w, h) { doc.setFillColor(rgb[0], rgb[1], rgb[2]); doc.rect(x, yy, w, h, 'F'); }
    function color(rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

    // Header: logo, title and dates, status and printed time.
    var lgH = f * PT * 3.6, x0 = M;
    if (logo) {
      var lgW = lgH * logo.w / logo.h;
      try { doc.addImage(logo.data, 'PNG', M, y, lgW, lgH); x0 = M + lgW + f * PT; } catch (e) {}
    }
    var title = 'Rota w/c ' + DAYS[0] + ' ' + ord(ws.getDate()) + ' ' + MONTHS[ws.getMonth()] + ' ' + ws.getFullYear();
    var sub = 'The White Swan \u00b7 ' + ord(ws.getDate()) + (ws.getMonth() !== we.getMonth() ? ' ' + MONTHS[ws.getMonth()] : '') +
      ' to ' + ord(we.getDate()) + ' ' + MONTHS[we.getMonth()] + (ws.getFullYear() !== we.getFullYear() ? ' ' + we.getFullYear() : '');
    var hTop = y + (L.hdH - f * PT * 0.6 - (L.titleH + lh(f))) / 2;
    font('bold', f * 2, 'times'); color(GREEN);
    doc.text(pdfText(title), x0, hTop + L.titleH * 0.8);
    font('normal', f); color(MUTED);
    doc.text(pdfText(sub), x0, hTop + L.titleH + lh(f) * 0.8);
    var st = data.status === 'approved' ? 'APPROVED' : data.status === 'published' ? 'PUBLISHED' : 'NOT PUBLISHED YET';
    var now = new Date();
    var printed = 'Printed ' + now.getDate() + ' ' + MONTHS[now.getMonth()].slice(0, 3) + ' ' + now.getFullYear() + ', ' +
      String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    font('bold', f * 0.85); color(GREEN);
    doc.text(st, PW - M, hTop + lh(f * 0.85) * 0.8, { align: 'right' });
    font('normal', f * 0.85); color(MUTED);
    doc.text(printed, PW - M, hTop + lh(f * 0.85) * 1.9, { align: 'right' });
    y += L.hdH;
    doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]); doc.setLineWidth(0.5);
    doc.line(M, y - f * PT * 0.3, PW - M, y - f * PT * 0.3);
    y += f * PT * 0.7 - f * PT * 0.3;

    if (L.warnH) {
      var wh = L.warnH - f * PT * 0.6;
      fill([247, 239, 220], M, y, CW, wh);
      doc.setDrawColor(DRAFT[0], DRAFT[1], DRAFT[2]); doc.setLineWidth(0.25); doc.setLineDashPattern([1, 0.8], 0);
      doc.rect(M, y, CW, wh, 'S'); doc.setLineDashPattern([], 0);
      font('bold', f); color(INK);
      doc.text('Includes ' + P.drafts + ' draft shift' + (P.drafts === 1 ? '' : 's') + ' (marked draft). Drafts can still change.', M + pad * 2, y + pad + lh(f) * 0.8);
      y += L.warnH;
    }

    if (P.tables.length) {
      var tTop = y;
      // Day headings.
      fill([228, 236, 230], M + nameW, y, CW - nameW, L.headH);
      fill(GREEN, M, y, nameW, L.headH);
      font('bold', f * 0.95); doc.setTextColor(255, 255, 255);
      doc.text('NAME', M + pad, y + L.headH / 2 + f * PT * 0.35);
      font('bold', f); color(GREEN);
      L.head.forEach(function (lines, i) {
        var cx = M + nameW + dayW * i + dayW / 2, ty = y + (L.headH - lines.length * lh(f)) / 2 + lh(f) * 0.8;
        lines.forEach(function (ln, k) { doc.text(ln, cx, ty + k * lh(f), { align: 'center' }); });
      });
      y += L.headH;
      var rowLines = [];
      L.rows.forEach(function (R, ri) {
        var odd = ri % 2 === 1;
        if (odd) fill([249, 248, 244], M + nameW, y, CW - nameW, R.h);
        fill(odd ? [243, 242, 236] : [250, 250, 247], M, y, nameW, R.h);
        font(R.r.open ? 'bolditalic' : 'bold', f); color(R.r.open ? DRAFT : INK);
        var ny = y + (R.h - R.nm.length * lh(f)) / 2 + lh(f) * 0.8;
        R.nm.forEach(function (ln, k) { doc.text(ln, M + pad, ny + k * lh(f)); });
        R.cells.forEach(function (C, i) {
          var cx = M + nameW + dayW * i;
          if (C.hol) fill([247, 239, 220], cx, y, dayW, R.h);
          var cy = y + (R.h - C.h) / 2, mid = cx + dayW / 2;
          C.items.forEach(function (it) {
            if (it.kind === 'hol') {
              font('bold', small); color(AMBER);
              doc.text('HOLIDAY', mid, cy + lh(small) * 0.8, { align: 'center' });
              cy += lh(small);
              return;
            }
            cy += it.gap;
            font('bold', f);
            var tw = doc.getTextWidth(it.t), sw = it.s.leader ? f * PT * 0.9 : 0, ew = 0;
            if (it.extra) { font('italic', f * 0.75); ew = doc.getTextWidth(' ' + it.extra); }
            var sx = mid - (tw + sw + ew) / 2, base = cy + lh(f) * 0.8;
            font('bold', f); color(it.s.published ? INK : MUTED);
            doc.text(it.t, sx, base);
            if (sw) star(sx + tw + sw * 0.55, base - f * PT * 0.33, f * PT * 0.36);
            if (ew) { font('italic', f * 0.75); color(DRAFT); doc.text(' ' + it.extra, sx + tw + sw, base); }
            cy += lh(f);
            if (it.notes.length) {
              font('normal', small); color(MUTED);
              it.notes.forEach(function (ln) { doc.text(ln, mid, cy + lh(small) * 0.8, { align: 'center' }); cy += lh(small); });
            }
          });
        });
        y += R.h;
        rowLines.push(y);
      });
      // Events along the bottom.
      var evTop = y;
      fill([253, 250, 242], M, y, CW, L.evH);
      font('bold', f * 0.85); color(AMBER);
      doc.text('EVENTS', M + pad, y + L.evH / 2 + f * PT * 0.3);
      L.ev.forEach(function (list, i) {
        var n = list.reduce(function (a, l) { return a + l.length; }, 0);
        var cy = y + (L.evH - n * lh(f * 0.85)) / 2 + lh(f * 0.85) * 0.8, mid = M + nameW + dayW * i + dayW / 2;
        list.forEach(function (lines) { lines.forEach(function (ln) { doc.text(ln, mid, cy, { align: 'center' }); cy += lh(f * 0.85); }); });
      });
      y += L.evH;
      // Grid lines, then the heavier lines on top.
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.2);
      rowLines.slice(0, -1).forEach(function (ly) { doc.line(M, ly, PW - M, ly); });
      for (var c = 1; c <= 7; c++) { var lx = M + nameW + dayW * (c - 1); doc.line(lx, tTop, lx, y); }
      doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]); doc.setLineWidth(0.4);
      doc.line(M, tTop + L.headH, PW - M, tTop + L.headH);
      doc.line(M, evTop, PW - M, evTop);
      doc.rect(M, tTop, CW, y - tTop, 'S');
      y += f * PT * 0.8;
    } else {
      font('normal', f * 1.2); color(MUTED);
      doc.text(withDrafts ? 'No shifts on the rota this week.' : 'No published shifts this week yet.', PW / 2, y + lh(f * 1.2) * 1.5, { align: 'center' });
      y += lh(f * 1.2) * 3 + f * PT * 0.8;
    }

    // Footer.
    font('normal', f * 0.8); color(MUTED);
    var notes = ['Times are start to finish, e.g. 5\u201311 is 5pm to 11pm.'];
    if (P.shifts.some(function (s) { return s.leader; })) notes.push('* Shift leader');
    if (!anyEvent) notes.push('No events this week.');
    var fx = M;
    notes.forEach(function (t) {
      if (t.charAt(0) === '*') { star(fx + f * PT * 0.35, y + lh(f * 0.8) * 0.8 - f * PT * 0.28, f * PT * 0.3); color(MUTED); doc.text(t.slice(1), fx + f * PT * 0.6, y + lh(f * 0.8) * 0.8); fx += doc.getTextWidth(t) + f * PT * 2; return; }
      doc.text(t, fx, y + lh(f * 0.8) * 0.8); fx += doc.getTextWidth(t) + f * PT * 2;
    });

    doc.setProperties({ title: pdfText(title), creator: 'Staff Hub' });
    return { blob: doc.output('blob'), size: f, zoom: zoom, fits: L.total <= AVAIL + 0.01 };
  }

  /* ---------- the preview ----------
     Opens over the app as a full page in the same tab (no popup, so nothing for an in-app browser to
     block). The phone's Back button closes it. Buttons: Print (window.print), Save PDF (share sheet on
     iPhone, so it can be printed, saved to Files or sent; a download elsewhere), Close. */

  function pageStyle(on) {
    var id = 'tws-rp-page';
    var s = document.getElementById(id);
    if (on && !s) {
      s = el('style'); s.id = id;
      s.textContent = '@page{size:A4 landscape;margin:8mm}';
      document.head.appendChild(s);
    } else if (!on && s) s.parentNode.removeChild(s);
  }

  function scalePreview() {
    var box = document.querySelector('#tws-rp .tws-rp-stage'), pg = document.querySelector('#tws-rp .tws-rp-page');
    if (!box || !pg) return;
    var w = Math.round(297 * MM), h = Math.max(Math.round(210 * MM), pg.scrollHeight);
    var sc = Math.min(1, (box.clientWidth - 24) / w);
    pg.style.transform = 'scale(' + sc + ')';
    pg.style.webkitTransform = 'scale(' + sc + ')';
    pg.parentNode.style.width = Math.round(w * sc) + 'px';
    pg.parentNode.style.height = Math.round(h * sc) + 'px';
  }

  var IOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function note(text, link) {
    var n = document.querySelector('#tws-rp .tws-rp-note');
    if (!n) return;
    n.textContent = '';
    if (!text) { n.style.display = 'none'; return; }
    n.appendChild(document.createTextNode(text));
    if (link) {
      var a = el('a', '', link.label);
      a.href = link.href;
      if (link.download) a.setAttribute('download', link.download);
      a.setAttribute('data-testid', 'rota-print-open-pdf');
      n.appendChild(document.createTextNode(' '));
      n.appendChild(a);
    }
    n.style.display = '';
  }

  // Build the PDF in the background whenever the sheet changes, so Save PDF can hand it over
  // straight away (the iPhone share sheet only opens from the tap itself).
  function preparePdf() {
    if (!state) return;
    var my = state, key = my.drafts ? 'd' : 'p';
    var btn = document.querySelector('#tws-rp [data-testid=rota-print-pdf]');
    if (my.pdf && my.pdf.key === key) return;
    my.pdf = { key: key, ready: false };
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing PDF\u2026'; }
    Promise.all([loadJsPdf(), loadLogo()]).then(function (r) {
      if (state !== my || my.pdf.key !== key) return;
      var out = buildPdf(r[0], my.data, my.drafts, r[1]);
      if (my.pdf.url) try { URL.revokeObjectURL(my.pdf.url); } catch (e) {}
      my.pdf = { key: key, ready: true, blob: out.blob, url: URL.createObjectURL(out.blob), name: pdfFileName(my.data), size: out.size, zoom: out.zoom };
      if (btn) { btn.disabled = false; btn.textContent = 'Save PDF'; }
    }).catch(function (e) {
      if (state !== my) return;
      my.pdf = null;
      if (btn) { btn.disabled = false; btn.textContent = 'Save PDF'; }
      note('The PDF couldn\u2019t be made (' + (e && e.message || 'error') + '). Check your signal and tap Save PDF again.');
    });
  }

  function download(pdf) {
    var a = el('a');
    a.href = pdf.url; a.download = pdf.name; a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
  }

  function savePdf() {
    var pdf = state && state.pdf;
    if (!pdf || !pdf.ready) { preparePdf(); return; }
    var openLink = { label: 'Open the PDF', href: pdf.url };
    var file = null;
    try { file = new File([pdf.blob], pdf.name, { type: 'application/pdf' }); } catch (e) {}
    if (file && navigator.canShare && navigator.share) {
      var ok = false;
      try { ok = navigator.canShare({ files: [file] }); } catch (e) {}
      if (ok) {
        note('');
        navigator.share({ files: [file], title: pdf.name.replace(/\.pdf$/, '') }).catch(function (e) {
          if (e && e.name === 'AbortError') return; // closed the share sheet
          download(pdf);
          note('If the PDF didn\u2019t appear:', openLink);
        });
        return;
      }
    }
    download(pdf);
    note(IOS ? 'If the PDF didn\u2019t appear:' : '', IOS ? openLink : null);
  }

  // window.print() does nothing at all in some iPhone web views (the Sesame in-app browser, apps added
  // to the home screen). A real print fires beforeprint; if it hasn't within a moment, say what to do.
  function doPrint() {
    var fired = false;
    function on() { fired = true; }
    window.addEventListener('beforeprint', on);
    var mq = window.matchMedia ? window.matchMedia('print') : null;
    function onMq(e) { if (e.matches) fired = true; }
    if (mq) { if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq); }
    note('');
    try { window.print(); } catch (e) {}
    setTimeout(function () {
      window.removeEventListener('beforeprint', on);
      if (mq) { if (mq.removeEventListener) mq.removeEventListener('change', onMq); else if (mq.removeListener) mq.removeListener(onMq); }
      if (!fired && state) note('Printing isn\u2019t available in this browser. Tap Save PDF instead, then print it from the share menu (Print), or save it to Files.');
    }, 1200);
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
    preparePdf();
  }

  function teardown() {
    var ov = document.getElementById('tws-rp');
    if (ov) ov.parentNode.removeChild(ov);
    document.documentElement.classList.remove('tws-rp-open');
    pageStyle(false);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', scalePreview);
    window.removeEventListener('popstate', onPop);
    var t = state && state.trigger;
    if (state && state.pdf && state.pdf.url) { var u = state.pdf.url; setTimeout(function () { try { URL.revokeObjectURL(u); } catch (e) {} }, 60000); }
    state = null;
    if (t && t.focus) try { t.focus(); } catch (e) {}
  }
  // Close: step back over the history entry the preview added (so Back doesn't need two taps later).
  function close() {
    if (!state) return teardown();
    if (state.pushed && history.state && history.state.twsRotaPrint) { state.pushed = false; history.back(); return; }
    teardown();
  }
  function onPop() { if (state) { state.pushed = false; teardown(); } }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open(data) {
    if (!data || !data.weekStart || !data.days) return;
    if (state) teardown();
    state = { data: data, drafts: false, trigger: document.activeElement, pushed: false };
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
    var pb = el('button', 'btn sm', 'Print'); pb.type = 'button'; pb.setAttribute('data-testid', 'rota-print-go');
    pb.addEventListener('click', doPrint);
    var sv = el('button', 'btn sm', 'Save PDF'); sv.type = 'button'; sv.setAttribute('data-testid', 'rota-print-pdf');
    sv.addEventListener('click', savePdf);
    var cl = el('button', 'btn secondary sm', 'Close'); cl.type = 'button'; cl.setAttribute('data-testid', 'rota-print-close');
    cl.addEventListener('click', close);
    acts.appendChild(pb); acts.appendChild(sv); acts.appendChild(cl);
    bar.appendChild(acts);
    var nt = el('div', 'tws-rp-note'); nt.setAttribute('role', 'status'); nt.setAttribute('data-testid', 'rota-print-note'); nt.style.display = 'none';
    bar.appendChild(nt);
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
    try {
      var hs = {}, cur = history.state;
      if (cur && typeof cur === 'object') for (var k in cur) hs[k] = cur[k];
      hs.twsRotaPrint = 1;
      history.pushState(hs, '', location.href);
      state.pushed = true;
      window.addEventListener('popstate', onPop);
    } catch (e) {}
    try { render(); } catch (e) {
      note('The rota couldn\u2019t be drawn (' + (e && e.message || 'error') + ').');
      if (window.console) console.error(e);
    }
    try { window.scrollTo(0, 0); } catch (e) {}
    pb.focus();
  }

  window.__twsRotaPrint = open;
  window.__twsRotaPrint.close = close;
  window.__twsRotaPrint._short = short;
  // Test hook: the current PDF, once made.
  window.__twsRotaPrint._pdf = function () { return state && state.pdf; };
})();
