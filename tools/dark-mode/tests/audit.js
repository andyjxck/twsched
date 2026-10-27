() => {
  function parse(c) {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function blend(top, bot) {
    const a = top[3];
    return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1];
  }
  function bgOf(el) {
    const layers = []; let img = false;
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !layers.length) img = true;
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break; }
    }
    let base = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
    return { c: base, img };
  }
  function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function name(el) {
    let s = el.tagName.toLowerCase();
    if (el.classList.length) s += '.' + [...el.classList].slice(0, 3).join('.');
    const p = el.parentElement;
    if (p) { let q = p.tagName.toLowerCase(); if (p.classList.length) q += '.' + [...p.classList].slice(0, 2).join('.'); s = q + ' > ' + s; }
    return s;
  }
  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (Number(s.opacity) < 0.05) return false; if (e.hasAttribute('inert') || e.getAttribute('aria-hidden') === 'true') return false; }
    return true;
  }
  const low = [], light = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'NOSCRIPT'].includes(el.tagName.toUpperCase())) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    const isField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !['hidden', 'checkbox', 'radio', 'range', 'color', 'file'].includes(el.type);
    if ((hasText || isField) && visible(el)) {
      const cs = getComputedStyle(el);
      let fg = parse(cs.color);
      const b = bgOf(el);
      if (fg) {
        let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
        fg = blend([fg[0], fg[1], fg[2], fg[3] * op], b.c);
        const r = ratio(fg, b.c);
        const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
        const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
        const disabled = el.disabled || el.closest('[disabled],[aria-disabled=true]');
        if (r < need && !disabled) {
          const k = name(el) + '|' + cs.color + '|' + b.c.map(Math.round).join(',');
          if (!seen.has(k)) { seen.add(k); low.push({ el: name(el), text: (el.innerText || el.value || el.placeholder || '').trim().slice(0, 40), ratio: +r.toFixed(2), need, fg: cs.color, bg: 'rgb(' + b.c.slice(0, 3).map(Math.round).join(',') + ')', img: b.img }); }
        }
      }
    }
    if (visible(el)) {
      const c = parse(getComputedStyle(el).backgroundColor);
      const r = el.getBoundingClientRect();
      if (c && c[3] > 0.6 && lum(c) > 0.35 && r.width * r.height > 600) {
        const k = name(el) + '|' + getComputedStyle(el).backgroundColor;
        if (!seen.has(k)) { seen.add(k); light.push({ el: name(el), bg: getComputedStyle(el).backgroundColor, area: Math.round(r.width * r.height), text: (el.innerText || '').trim().slice(0, 30) }); }
      }
    }
  }
  return { low, light };
}
