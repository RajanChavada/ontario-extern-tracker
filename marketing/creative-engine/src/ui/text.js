// Small typographic fixes applied before text reaches the page.

const SHORT = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'and', 'or', '&', 'is', 'it', 'my', 'your', 'vs', 'no', 'so', 'if']);
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f]+$/u;
const NBSP = '\u00A0';
// Never glue words into a chunk longer than this: wide display type must still wrap.
const MAX_CHUNK = 8;

/**
 * Curly quotes; emoji stay with the previous word; in headings, short function
 * words stay with the next word and a short last word stays with the one before,
 * but only while the glued chunk is short enough to wrap safely.
 */
export function tidy(text, { heading = false } = {}) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/"([^"]*)"/g, '“$1”').replace(/'/g, '’');
  const out = [];
  for (const w of t.split(' ')) {
    const prev = out.at(-1);
    if (prev !== undefined && EMOJI_ONLY.test(w)) { out[out.length - 1] = prev + NBSP + w; continue; }
    if (heading && prev !== undefined) {
      const lastPrev = prev.split(NBSP).at(-1).toLowerCase();
      if (SHORT.has(lastPrev) && (prev + w).length <= MAX_CHUNK) { out[out.length - 1] = prev + NBSP + w; continue; }
    }
    out.push(w);
  }
  if (heading && out.length >= 3) {
    const [prev, last] = out.slice(-2);
    if (last.length <= 5 && (prev + last).length <= MAX_CHUNK) out.splice(-2, 2, prev + NBSP + last);
  }
  return out.join(' ');
}

/** Shorten a URL for display: drop scheme, www and query. */
export function displayUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '').replace(/\.html?$/, '');
    return `${u.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return url;
  }
}
