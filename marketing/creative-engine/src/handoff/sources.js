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
    .replace(/<\/?(?:sup|sub|b|i|em|strong|u|span|a|small|mark)\b[^>]*>/gi, '') // inline tags don't split words: 2<sup>nd</sup> -> 2nd
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[\p{Cf}]/gu, '')
    .replace(/[\s\u00A0]+/g, ' ')
    .trim();
}

/**
 * Dayforce career sites (jobs.dayforcehcm.com) send the posting only as Next.js page data: the visible job text is
 * an HTML string inside <script id="__NEXT_DATA__" type="application/json">, which normalizeForQuote (rightly) drops
 * with every other script. This reads that one JSON block, and only when its jobPostingId is the job id in the URL,
 * so another job's data can never confirm a quote. It returns:
 *  - the job description, normalized like any page;
 *  - the "Posted … | Expires …" line the browser builds from the two timestamps, rebuilt in Toronto time in the
 *    site's own wording, so a date quote still has to match exactly.
 * Any other host, or a missing / mismatched job id, returns '' (no extra text: the quote check stays as strict as before).
 */
export function dayforcePageText(url, html) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (u.hostname !== 'jobs.dayforcehcm.com') return '';
  const jobId = u.pathname.match(/\/jobs\/(\d+)\/?$/)?.[1];
  const m = String(html).match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!jobId || !m) return '';
  let job;
  try { job = JSON.parse(m[1])?.props?.pageProps?.jobData; } catch { return ''; }
  if (!job || String(job.jobPostingId) !== jobId) return '';
  const when = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(+d)) return null;
    const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(d);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
    return `${date} at ${time}`;
  };
  const posted = when(job.postingStartTimestampUTC), expires = when(job.postingExpiryTimestampUTC);
  const header = posted && expires ? `Posted ${posted} | Expires ${expires}` : posted ? `Posted ${posted}` : '';
  return normalizeForQuote(`${header}\n${job.jobTitle ?? ''}\n${job.jobPostingContent?.jobDescription ?? ''}`);
}

/**
 * Returns { results, blockers, warnings }.
 *  evidence: index from loadEvidence(); online: fetch the live page too; fetchImpl for tests.
 */
/**
 * The verbatim pieces of a fact quote. The tracker bridge joins several posting lines with " … " and clips long lines
 * with a trailing "…"; each piece must be found on its own (all of them, verbatim), never the joined string.
 */
export function quoteSegments(quote) {
  return String(quote).split(/\s+…\s+/).map((p) => normalizeForQuote(p.replace(/…\s*$/, ''))).filter(Boolean);
}
const hasAll = (text, segs) => segs.every((q) => text.includes(q));

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
    const segs = quoteSegments(f.quote);
    for (const s of prim) {
      const r = { fact: f.id, url: s.url, capture: null, online: null };
      const all = evidence?.forUrl(s.url) ?? [];
      const cap = s.snapshot ? all.find((c) => c.capturedAt === s.snapshot && hasAll(normalizeForQuote(c.text), segs)) ?? all.find((c) => c.capturedAt === s.snapshot) : all[0];
      if (cap) r.capture = { file: cap.file, capturedAt: cap.capturedAt, found: hasAll(normalizeForQuote(cap.text), segs) };
      if (s.snapshot) { if (!cap) blockers.push(`${f.id}: no saved capture from ${s.snapshot} of ${s.url}`); else warnings.push(`${f.id}: historical fact, checked against the saved capture from ${s.snapshot} (not the live page)`); }
      if (online && !s.snapshot) {
        const key = normalizeUrl(s.url);
        if (!live.has(key)) {
          try {
            const res = await fetchImpl(s.url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'Mozilla/5.0 (oet source check)' } });
            const html = res.ok ? await res.text() : null;
            live.set(key, { status: res.status, text: html === null ? null : normalizeForQuote(html), pageData: html === null ? '' : dayforcePageText(s.url, html) });
          } catch (e) { live.set(key, { status: null, error: e.cause?.code ?? e.name, text: null }); }
        }
        const page = live.get(key);
        const inHtml = page.text ? hasAll(page.text, segs) : null;
        const inData = !inHtml && page.pageData ? hasAll(page.pageData, segs) : false;
        r.online = { status: page.status, error: page.error ?? null, found: inHtml || inData ? true : inHtml, via: inHtml ? 'html' : inData ? 'page-data' : null };
        if (inData) warnings.push(`${f.id}: confirmed in the live page's own job data (Dayforce __NEXT_DATA__ for this job id), not in static HTML`);
      }
      results.push(r);
      if (r.online?.status >= 400) blockers.push(`${s.url} returned HTTP ${r.online.status}`);
      if (r.online && r.online.found === false) blockers.push(`${f.id}: quote no longer on the live page ${s.url}`);
      if (r.capture && r.capture.found === false) blockers.push(`${f.id}: quote not in the saved capture ${r.capture.file}`);
      if (!r.capture && !s.snapshot && (!r.online || r.online.found !== true)) blockers.push(`${f.id}: no saved capture and no live confirmation for ${s.url}`);
      if (online && r.online && r.online.found === null) warnings.push(`${f.id}: live page not checked (${r.online.error ?? 'HTTP ' + r.online.status}); saved capture used`);
      if (r.capture && f.verifiedAt > r.capture.capturedAt) warnings.push(`${f.id}: verifiedAt ${f.verifiedAt} is later than the newest capture (${r.capture.capturedAt})`);
    }
  }
  return { results, blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}
