// Runs inside Chromium after the slide's HTML has laid out. Playwright serialises
// these functions, so each must be self-contained (no imports, no outer variables).

/**
 * Fit type to the safe box, draw marker marks, then measure the result.
 * Returns { fit, alt, errors, warnings }.
 */
export async function fitDrawAndCheck(opts) {
  const { box, targets } = opts.platform;
  const errors = [];
  const warnings = [];
  const snippet = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  const E = (code, message, el) => errors.push({ code, message, ...(el ? { text: snippet(el) } : {}) });
  const W = (code, message, el) => warnings.push({ code, message, ...(el ? { text: snippet(el) } : {}) });

  // Fonts --------------------------------------------------------------------
  const allText = document.querySelector('.safe')?.textContent ?? '';
  await Promise.all([
    document.fonts.load('900 100px "TikTok Sans Variable"', allText),
    document.fonts.load('400 100px "TikTok Sans Variable"', allText),
    document.fonts.load('400 60px "Caveat Brush"', allText),
    document.fonts.load('400 60px "Twemoji"', allText),
  ]);
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  for (const f of document.fonts) if (f.status === 'error') E('FONT', `Font file failed to load: ${f.family}`);
  const loaded = (fam) => [...document.fonts].some((f) => f.family.replace(/"/g, '') === fam && f.status === 'loaded');
  if (!loaded('TikTok Sans Variable')) E('FONT', 'TikTok Sans did not load; the render would use a fallback font.');
  if (document.querySelector('.marker, .row .val') && !loaded('Caveat Brush')) E('FONT', 'Caveat Brush did not load.');

  const canvas = document.querySelector('.canvas');
  const safe = canvas.querySelector('.safe');
  const mains = [...safe.querySelectorAll('.main')];
  const overflowing = () => safe.scrollHeight > safe.clientHeight + 1 || mains.some((m) => m.scrollHeight > m.clientHeight + 1);

  // 1. Shrink all type together until the content fits the safe box (floor: 70%).
  let fit = 1;
  const fitHeight = () => {
    while (overflowing() && fit > 0.7) {
      fit = Math.round((fit - 0.025) * 1000) / 1000;
      canvas.style.setProperty('--fit', String(fit));
    }
  };
  fitHeight();

  // 1b. Headlines: where a line actually ends on a short word ("the", "of"…), bind it
  // to the next word. Measured, so we only glue words where the break is bad.
  const SHORT_END = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', '&', 'is', 'my', 'your', 'by', 'with']);
  for (const el of safe.querySelectorAll('[data-role="heading"]')) {
    for (let pass = 0; pass < 4; pass++) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      const words = [];
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode())
        for (const m of n.textContent.matchAll(/[^ \t\n\r\u00a0]+/g)) {
          const r = document.createRange();
          r.setStart(n, m.index);
          r.setEnd(n, m.index + m[0].length);
          const q = r.getClientRects()[0];
          if (q) words.push({ n, end: m.index + m[0].length, w: m[0].toLowerCase(), top: q.top });
        }
      const bad = words.find((w, i) => i < words.length - 1 && SHORT_END.has(w.w) && words[i + 1].top - w.top > size * 0.5 && w.n.textContent[w.end] === ' ');
      if (!bad) break;
      const t = bad.n.textContent;
      bad.n.textContent = t.slice(0, bad.end) + '\u00a0' + t.slice(bad.end + 1);
      const er = el.getBoundingClientRect(), sr = safe.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 1 || er.right > sr.right + 1) { bad.n.textContent = t; break; }
    }
  }

  // 1c. Any multi-line block whose last line is one lonely word: bind it to the word before.
  for (const el of safe.querySelectorAll('[data-qa="block"]')) {
    if (el.closest('.marker, .reply') || el.dataset.role === 'heading') continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    const words = [];
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode())
      for (const m of n.textContent.matchAll(/[^ \t\n\r\u00a0]+/g)) {
        const r = document.createRange();
        r.setStart(n, m.index);
        r.setEnd(n, m.index + m[0].length);
        const q = r.getClientRects()[0];
        if (q) words.push({ n, start: m.index, top: q.top });
      }
    if (words.length < 4) continue;
    const last = words.at(-1), prev = words.at(-2);
    if (last.top - prev.top > size * 0.5 && last.n === prev.n && last.n.textContent[last.start - 1] === ' ') {
      const t = last.n.textContent;
      last.n.textContent = t.slice(0, last.start - 1) + '\u00a0' + t.slice(last.start);
      const er = el.getBoundingClientRect(), sr = safe.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 1 || er.right > sr.right + 1 || overflowing()) last.n.textContent = t; // undo if it doesn't fit
    }
  }

  // 2. Shrink individual elements whose longest word is wider than the box.
  for (const el of safe.querySelectorAll('[data-fitw]')) {
    let size = parseFloat(getComputedStyle(el).fontSize);
    const min = size * 0.6;
    let guard = 0;
    while (el.scrollWidth > el.clientWidth + 1 && size > min && guard++ < 40) {
      size *= 0.95;
      el.style.fontSize = `${size}px`;
    }
    if (el.scrollWidth > el.clientWidth + 1) E('OVERFLOW_X', `A word is wider than the box even at ${Math.round(size)}px.`, el);
  }
  fitHeight(); // line fixes and width fits can change heights; settle again
  if (fit < 1) W('AUTO_FIT', `Copy was long, so type was scaled to ${Math.round(fit * 100)}%.`);
  if (fit < 0.8) W('DENSE', 'Type had to shrink below 80%. Consider splitting this slide.');
  if (overflowing()) E('OVERFLOW', 'Content does not fit the safe area even at 70% type size. Shorten the copy or split the slide.');

  // 3. Hand-drawn marks -----------------------------------------------------------
  const cR = canvas.getBoundingClientRect();
  const s = parseFloat(getComputedStyle(canvas).getPropertyValue('--u')) * fit;
  const stroke = getComputedStyle(canvas).getPropertyValue('--stroke').trim();
  const svg = canvas.querySelector('svg.marks');
  let seed = opts.seed >>> 0 || 1;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const textRect = (el) => {
    const rects = [];
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.textContent.trim()) continue;
      const fs = parseFloat(getComputedStyle(n.parentElement).fontSize);
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const q of r.getClientRects()) {
        if (q.width <= 0 || q.height <= 0) continue;
        const inset = Math.max(0, (q.height - fs * 0.9) / 2);
        rects.push({ left: q.left, right: q.right, top: q.top + inset, bottom: q.bottom - inset });
      }
    }
    if (!rects.length) return el.getBoundingClientRect();
    const left = Math.min(...rects.map((q) => q.left));
    const top = Math.min(...rects.map((q) => q.top));
    const right = Math.max(...rects.map((q) => q.right));
    const bottom = Math.max(...rects.map((q) => q.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };
  const marks = [];
  const path = (d, w, src, kind = 'mark') => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    marks.push({ p, w: w * s, src, kind });
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', String(w * s));
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
  };
  const smooth = (pts) => {
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  };
  const circle = (r) => {
    const cx = (r.left + r.right) / 2 - cR.left, cy = (r.top + r.bottom) / 2 - cR.top;
    const rx = r.width / 2 + 30 * s, ry = r.height / 2 + 24 * s;
    const start = -2.3 + rand() * 0.4, sweep = Math.PI * 2 + 0.55, n = 52;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = start + (sweep * i) / n;
      const k = 1 + (rand() - 0.5) * 0.03 + (i / n) * 0.07;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return smooth(pts);
  };
  const arrow = (x1, y1, x2, y2, bend) => {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const cx = (x1 + x2) / 2 - ((y2 - y1) / len) * len * bend, cy = (y1 + y2) / 2 + ((x2 - x1) / len) * len * bend;
    const ang = Math.atan2(y2 - cy, x2 - cx), h = 40 * s;
    const a1 = ang + Math.PI - 0.5, a2 = ang + Math.PI + 0.5;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)} M${(x2 + Math.cos(a1) * h).toFixed(1)} ${(y2 + Math.sin(a1) * h).toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} L${(x2 + Math.cos(a2) * h).toFixed(1)} ${(y2 + Math.sin(a2) * h).toFixed(1)}`;
  };
  for (const el of safe.querySelectorAll('[data-mark]')) {
    const r = textRect(el);
    if (el.dataset.mark === 'circle') path(circle(r), 9, el);
    if (el.dataset.mark === 'underline') {
      const y = r.bottom - cR.top + 6 * s, x0 = r.left - cR.left - 8 * s, x1 = r.right - cR.left + 12 * s;
      path(`M${x0} ${y + 6 * s} Q${(x0 + x1) / 2} ${y - 8 * s} ${x1} ${y}`, 10, el);
    }
  }
  for (const el of safe.querySelectorAll('[data-arrow-to]')) {
    const to = el.dataset.arrowTo;
    const r = textRect(el);
    if (to === 'right') {
      const x1 = r.right - cR.left + 20 * s, y1 = (r.top + r.bottom) / 2 - cR.top + 6 * s;
      path(arrow(x1, y1, x1 + 140 * s, y1 + 4 * s, -0.16), 8, el, 'arrow');
    } else if (to.startsWith('target:') && targets[to.slice(7)]) {
      const [tx, ty] = targets[to.slice(7)];
      const top = r.top - cR.top, bottom = r.bottom - cR.top, left = r.left - cR.left, right = r.right - cR.left;
      let x1, y1; // leave the text block on the side facing the target
      if (ty < top) { x1 = Math.min(Math.max(tx, left + 20), right - 20); y1 = top - 30 * s; }
      else if (ty > bottom) { x1 = Math.min(right + 16 * s, box.x + box.width - 10); y1 = bottom + 30 * s; }
      else { x1 = right + 24 * s; y1 = ty; }
      // End just short of the button: beside it on the TikTok rail, above it for buttons under the image.
      const below = ty >= opts.platform.height - 1, above = ty <= 1;
      const x2 = below || above ? tx : tx - 70, y2 = below ? ty - 60 : above ? ty + 60 : ty;
      path(arrow(x1, y1, x2, y2, 0.2), 10, el, 'arrow');
    } else if (to.startsWith('#')) {
      const t = document.querySelector(to)?.getBoundingClientRect();
      if (t) {
        const x1 = r.left - cR.left - 14 * s, y1 = (r.top + r.bottom) / 2 - cR.top;
        const x2 = t.right - cR.left - 36 * s;
        const y2 = Math.min(Math.max(y1, t.top - cR.top + 90 * s), t.bottom - cR.top - 90 * s);
        path(arrow(x1, y1, x2, y2, 0.16), 8, el, 'arrow');
      }
    }
  }

  // 4. QA ---------------------------------------------------------------------------
  const bx = { left: cR.left + box.x, top: cR.top + box.y, right: cR.left + box.x + box.width, bottom: cR.top + box.y + box.height };
  const toRgb = (str) => {
    if (!str) return null;
    if (str.startsWith('#')) {
      const h = str.length === 4 ? str.slice(1).split('').map((c) => c + c).join('') : str.slice(1, 7);
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    }
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.dataset?.qaBg) { layers.push(toRgb(n.dataset.qaBg)); break; }
      const c = toRgb(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    return layers.reduceRight((acc, l) => over(l, acc), { r: 255, g: 255, b: 255, a: 1 });
  };
  const lum = (c) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s\u200d\ufe0f]+$/u;

  const walker = document.createTreeWalker(safe, NodeFilter.SHOW_TEXT);
  const seenEl = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const txt = node.textContent;
    if (!txt.trim()) continue;
    const el = node.parentElement;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10);
    const emojiOnly = EMOJI_ONLY.test(txt);
    if (!seenEl.has(el)) {
      seenEl.add(el);
      const inUi = Boolean(el.closest('[data-ui]'));
      if (inUi && !emojiOnly && size < 22) E('MIN_FONT', `${Math.round(size)}px app text is unreadable even as a screenshot.`, el);
      else if (inUi) { if (!emojiOnly && size < 28) W('SMALL_FONT', `${Math.round(size)}px app text inside the phone.`, el); }
      else if (!emojiOnly && size < 30) E('MIN_FONT', `${Math.round(size)}px text is too small to read on a phone (minimum 30px on the 1080px canvas).`, el);
      else if (!emojiOnly && size < 31.5) W('SMALL_FONT', `${Math.round(size)}px text is at the edge of readable.`, el);
      if (!emojiOnly) {
        const bg = bgOf(el);
        let fg = toRgb(cs.color);
        if (fg.a < 1) fg = over(fg, bg);
        const need = size >= 50 || (size >= 39 && weight >= 700) ? 3 : 4.5;
        const cr = ratio(fg, bg);
        if (cr < need) E('CONTRAST', `Contrast ${cr.toFixed(2)}:1 is below ${need}:1 for ${Math.round(size)}px text.`, el);
      }
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const raw of range.getClientRects()) {
      if (raw.width < 1) continue;
      const inset = Math.max(0, (raw.height - size * 0.96) / 2);
      const q = { left: raw.left, right: raw.right, top: raw.top + inset, bottom: raw.bottom - inset };
      if (q.left < bx.left - 2 || q.right > bx.right + 2 || q.top < bx.top - 2 || q.bottom > bx.bottom + 2) {
        E('SAFE_AREA', 'Text extends outside the platform safe area.', el);
        break;
      }
    }
    for (const m of txt.matchAll(/[^ \t\n\r]+/g)) {
      const r = document.createRange();
      r.setStart(node, m.index);
      r.setEnd(node, m.index + m[0].length);
      const tops = [...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top));
      if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > size * 0.5) E('BROKEN_WORD', `"${m[0]}" is split across two lines.`, el);
    }
    for (const m of txt.matchAll(/\p{Extended_Pictographic}/gu)) {
      const r = document.createRange();
      r.setStart(node, m.index);
      r.setEnd(node, m.index + m[0].length);
      const q = r.getBoundingClientRect();
      if (q.width < size * 0.5) E('EMOJI_MISSING', `Emoji ${m[0]} rendered blank (no glyph from the emoji font).`, el);
    }
  }

  // Headline line breaks: orphans and dangling short words.
  const SHORTW = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', '&', 'is', 'my', 'your']);
  for (const el of safe.querySelectorAll('[data-role="heading"]')) {
    const size = parseFloat(getComputedStyle(el).fontSize);
    const words = [];
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      for (const m of n.textContent.matchAll(/[^ \t\n\r]+/g)) {
        const r = document.createRange();
        r.setStart(n, m.index);
        r.setEnd(n, m.index + m[0].length);
        const q = r.getClientRects()[0];
        if (q) words.push({ w: m[0], top: q.top });
      }
    }
    const lines = [];
    for (const w of words) {
      const line = lines.find((l) => Math.abs(l.top - w.top) < size * 0.5);
      if (line) line.words.push(w.w);
      else lines.push({ top: w.top, words: [w.w] });
    }
    if (lines.length >= 2) {
      const last = lines.at(-1).words;
      if (last.length === 1 && last[0].replace(/\u00a0/g, ' ').split(' ').length === 1 && last[0].length <= 4 && lines.at(-2).words.length >= 2)
        W('ORPHAN', `Headline ends with a lone short word "${last[0]}".`, el);
      lines.slice(0, -1).forEach((l) => {
        const end = l.words.at(-1).toLowerCase().split('\u00a0').at(-1);
        if (SHORTW.has(end)) W('DANGLING', `Line ends with "${end}".`, el);
      });
    }
  }

  // Overlapping text blocks.
  const blocks = [...safe.querySelectorAll('[data-qa="block"]')].map((el) => ({ el, r: textRect(el) }));
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i], b = blocks[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 6 && h > 6) E('OVERLAP', `Text overlaps "${snippet(b.el)}".`, a.el);
    }
  }

  // Hand-drawn marks crossing text they don't belong to.
  for (const m of marks) {
    const len = m.p.getTotalLength();
    const hits = new Set();
    for (let d = 0; d <= len; d += 6) {
      const pt = m.p.getPointAtLength(d);
      const x = pt.x + cR.left, y = pt.y + cR.top;
      for (const b of blocks) {
        if (b.el === m.src || b.el.contains(m.src) || (m.kind !== 'arrow' && m.src.contains(b.el)) || hits.has(b.el)) continue;
        const pad = m.w / 2;
        if (x > b.r.left - pad && x < b.r.right + pad && y > b.r.top - pad && y < b.r.bottom + pad) hits.add(b.el);
      }
    }
    for (const el of hits) E('MARK_COLLISION', `A hand-drawn ${m.kind === 'arrow' ? 'arrow' : m.src.dataset.mark} crosses "${snippet(el)}".`, m.src);
  }

  // Near-miss alignment between unrotated blocks (1.5–10px apart reads as a mistake).
  const edge = (b) => (b.el.classList.contains('tt') ? b.el.firstElementChild.getClientRects()[0]?.left ?? b.r.left : b.r.left);
  const lefts = blocks.filter((b) => !b.el.closest('[data-free]')).map((b) => ({ x: edge(b), el: b.el }));
  for (let i = 0; i < lefts.length; i++)
    for (let j = i + 1; j < lefts.length; j++) {
      const d = Math.abs(lefts[i].x - lefts[j].x);
      if (d > 1.5 && d < 10) W('NEAR_MISS_ALIGN', `Left edges are ${d.toFixed(1)}px apart: "${snippet(lefts[j].el)}".`, lefts[i].el);
    }

  for (const sc of safe.querySelectorAll('[data-ui]')) if (sc.scrollHeight > sc.clientHeight + 1) E('PHONE_OVERFLOW', 'The mock app screen has more content than fits on the phone. Use fewer or shorter items.');
  for (const img of safe.querySelectorAll('img')) if (!img.complete || !img.naturalWidth) E('IMAGE', `Image failed to load: ${img.getAttribute('src')}`);

  const alt = safe.innerText
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((l) => (/[.!?:…)]$/.test(l) ? l : `${l}.`))
    .join(' ');

  return { fit, alt, errors, warnings };
}

/** Draw the platform interface on top of the slide for a review preview. */
export function drawInterfaceGhost(opts) {
  const { id, width, height, box, targets } = opts.platform;
  const canvas = document.querySelector('.canvas');
  const g = document.createElement('div');
  g.className = 'ghost';
  const add = (cls, style, text) => {
    const d = document.createElement('div');
    d.className = cls;
    Object.assign(d.style, style);
    if (text) d.textContent = text;
    g.appendChild(d);
    return d;
  };
  add('safeline', { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
  if (id === 'tiktok') {
    add('zone', { left: 0, top: 0, width: `${width}px`, height: '170px' });
    add('t', { left: '0', width: `${width}px`, top: '92px', textAlign: 'center', fontSize: '42px' }, 'Following      For You');
    add('zone', { left: `${width - 150}px`, top: '960px', width: '150px', height: '860px' });
    for (const k of ['follow', 'comment', 'save', 'share']) add('ic', { left: `${targets[k][0]}px`, top: `${targets[k][1]}px` });
    add('ic', { left: `${targets.follow[0]}px`, top: '1214px' });
    add('zone', { left: 0, top: `${height - 430}px`, width: `${width - 150}px`, height: '430px' });
    add('t', { left: '40px', top: `${height - 360}px`, fontSize: '44px' }, `@${opts.handle || 'yourhandle'}`);
    add('t', { left: '40px', top: `${height - 296}px`, fontSize: '38px', fontWeight: 500, width: '760px' }, 'caption text sits here and can run to two lines before it truncates… more');
    add('t', { left: '40px', top: `${height - 170}px`, fontSize: '34px', fontWeight: 500 }, '♫ original sound');
  } else {
    add('t', { right: '36px', top: '36px', fontSize: '34px', background: 'rgba(0,0,0,.65)', padding: '8px 20px', borderRadius: '30px' }, `${opts.index}/${opts.total}`);
    add('ic', { left: '80px', top: `${height - 80}px`, width: '64px', height: '64px', margin: '-32px 0 0 -32px' });
    const crop = (height * 3) / 4;
    const off = (width - crop) / 2;
    add('safeline', { left: `${off}px`, top: '0', width: `${crop}px`, height: `${height}px`, border: '3px dotted rgba(255,255,255,.85)' });
  }
  canvas.appendChild(g);
}
