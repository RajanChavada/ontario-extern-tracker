// Source checks for any spec (educational or tracker-backed): every quoted fact must still be
// on its primary source, both in the newest saved capture and, when reachable, on the live page.
// The engine's own check-sources only covers deadline/pay/eligibility/vacancy facts; this covers all.

import { normalizeUrl } from '../tracker/evidence.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };

/** Text for quote matching: HTML stripped, entities decoded, invisible format characters removed
 *  (Ontario Health's page puts a U+2060 word joiner after a dash), whitespace collapsed. Case and
 *  punctuation are kept: quotes must be verbatim. */
export function normalizeForQuote(s) {
  return String(s)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[\p{Cf}]/gu, '')
    .replace(/[\s\u00A0]+/g, ' ')
    .trim();
}

/**
 * Returns { results, blockers, warnings }.
 *  evidence: index from loadEvidence(); online: fetch the live page too; fetchImpl for tests.
 */
export async function checkSourceQuotes(spec, { evidence, online = true, fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const blockers = [];
  const warnings = [];
  const results = [];
  const live = new Map();
  const sources = new Map(spec.sources.map((s) => [s.id, s]));

  for (const f of spec.facts) {
    const prim = f.sources.map((id) => sources.get(id)).filter((s) => s?.primary);
    if (!prim.length) { blockers.push(`${f.id}: no primary source`); continue; }
    if (!f.quote) { blockers.push(`${f.id}: no verbatim quote to check`); continue; }
    const q = normalizeForQuote(f.quote);
    for (const s of prim) {
      const r = { fact: f.id, url: s.url, capture: null, online: null };
      const cap = evidence?.forUrl(s.url)?.[0];
      if (cap) r.capture = { file: cap.file, capturedAt: cap.capturedAt, found: normalizeForQuote(cap.text).includes(q) };
      if (online) {
        const key = normalizeUrl(s.url);
        if (!live.has(key)) {
          try {
            const res = await fetchImpl(s.url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'Mozilla/5.0 (oet source check)' } });
            live.set(key, { status: res.status, text: res.ok ? normalizeForQuote(await res.text()) : null });
          } catch (e) { live.set(key, { status: null, error: e.cause?.code ?? e.name, text: null }); }
        }
        const page = live.get(key);
        r.online = { status: page.status, error: page.error ?? null, found: page.text ? page.text.includes(q) : null };
      }
      results.push(r);
      if (r.online?.status >= 400) blockers.push(`${s.url} returned HTTP ${r.online.status}`);
      if (r.online && r.online.found === false) blockers.push(`${f.id}: quote no longer on the live page ${s.url}`);
      if (r.capture && r.capture.found === false) blockers.push(`${f.id}: quote not in the saved capture ${r.capture.file}`);
      if (!r.capture && (!r.online || r.online.found !== true)) blockers.push(`${f.id}: no saved capture and no live confirmation for ${s.url}`);
      if (online && r.online && r.online.found === null) warnings.push(`${f.id}: live page not checked (${r.online.error ?? 'HTTP ' + r.online.status}); saved capture used`);
      if (r.capture && f.verifiedAt > r.capture.capturedAt) warnings.push(`${f.id}: verifiedAt ${f.verifiedAt} is later than the newest capture (${r.capture.capturedAt})`);
    }
  }
  return { results, blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}
