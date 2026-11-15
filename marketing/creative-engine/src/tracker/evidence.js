// Saved official-source captures ("evidence").
//
// A capture is a .txt or .md file whose first lines are
//   URL: <the official page that was opened>
//   CAPTURED: <YYYY-MM-DD>[ HH:MM] …
// followed by the page text. Files without both header lines are ignored
// (search-result dumps, notes, JSON). Captures are written by people or agents
// when they check a posting; this module only reads them.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Normalise a URL for matching: lower-case host, no trailing slash, no tracking or iframe parameters. */
export function normalizeUrl(u) {
  let url;
  try { url = new URL(String(u).trim()); } catch { return null; }
  url.hash = '';
  for (const k of [...url.searchParams.keys()]) if (/^(in_iframe|utm_\w+|mobile|width|height|bga|needsredirect|jan1offset|jun1offset|ss)$/i.test(k)) url.searchParams.delete(k);
  url.searchParams.sort();
  const p = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host.toLowerCase()}${p}${url.search}`;
}

/** Parse one capture file's header. Returns null when it isn't a capture. */
export function parseCapture(text, file = '') {
  const head = text.split('\n', 6);
  const urlLine = head.find((l) => /^URL:\s*\S/.test(l));
  const capLine = head.find((l) => /^CAPTURED:?\s*\d{4}-\d{2}-\d{2}/.test(l));
  if (!urlLine || !capLine) return null;
  const url = urlLine.replace(/^URL:\s*/, '').trim();
  const m = capLine.match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/);
  const bodyStart = text.indexOf('\n', text.indexOf(capLine)) + 1;
  return {
    file,
    url,
    key: normalizeUrl(url),
    capturedAt: m[1],
    capturedTime: m[2] ? m[2].padStart(5, '0') : null,
    text: text.slice(bodyStart).replace(/^\r?\n/, ''), // the blank line after the header isn't page text
  };
}

function walk(dir, out = []) {
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n.startsWith('.') || n === 'node_modules') continue;
    const p = path.join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(txt|md)$/i.test(n) && st.size < 2_000_000) out.push(p);
  }
  return out;
}

/** Index every capture under the given directories. */
export function loadEvidence(dirs) {
  const captures = [];
  for (const dir of [].concat(dirs).filter(Boolean)) {
    for (const file of walk(dir)) {
      const c = parseCapture(readFileSync(file, 'utf8'), file);
      if (c && c.key) captures.push(c);
    }
  }
  return makeIndex(captures);
}

/** Build an index from already-parsed captures (used by tests). */
export function makeIndex(captures) {
  const byKey = new Map();
  for (const c of captures) {
    if (!byKey.has(c.key)) byKey.set(c.key, []);
    byKey.get(c.key).push(c);
  }
  // newest first: date, then time (captures without a time count as start of day), then file name
  for (const list of byKey.values())
    list.sort((a, b) => `${b.capturedAt} ${b.capturedTime ?? '00:00'} ${b.file}`.localeCompare(`${a.capturedAt} ${a.capturedTime ?? '00:00'} ${a.file}`));
  return {
    size: captures.length,
    /** All captures of this URL, newest first. */
    forUrl(u) { return byKey.get(normalizeUrl(u)) ?? []; },
  };
}
