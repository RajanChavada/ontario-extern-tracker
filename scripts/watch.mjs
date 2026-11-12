#!/usr/bin/env node
// Watcher, step 1 (manual runs only; not scheduled).
//   node scripts/watch.mjs [--report watch/report.md] [--write-snapshot] [--today YYYY-MM-DD]
//                          [--data <hospitals.json>] [--snapshot <snapshot.json>]   (defaults: data/hospitals.json, watch/snapshot.json)
//
// Reads watch/sources.json, checks each official board once, and writes a markdown report of what a
// person should review. It NEVER edits data/hospitals.json, and nothing it finds goes live without the
// normal verify → preview → merge flow (docs/DATA-WORKFLOW.md).
//
// Rule: a board that couldn't be read (error, bot wall, empty result where postings existed, manual-only)
// is reported under "Not checked". It is never counted as unchanged, never produces "removed" signals,
// and its previous snapshot is carried forward with its old check time.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { status, ontarioToday, daysBetween } from '../assets/logic.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UA = 'Mozilla/5.0 (compatible; ontarioexterns.ca-watcher/0.1; +https://ontarioexterns.ca)';

// ---------- Filters ----------
const NON_NURSING = /\b(allied|respiratory|physio\w*|occupational|paramedic|pharmac\w*|OT|PT|RT|educator|coordinator)\b/i;
export function isNursingExtern(title) {
  if (!/extern/i.test(title || '')) return false;
  return /nurs/i.test(title) || !NON_NURSING.test(title);
}

// ---------- Parsers (pure; tested against saved responses) ----------
export function parseWorkday(json, { host, site }) {
  if (!json || !Array.isArray(json.jobPostings)) throw new Error('unexpected Workday response');
  return json.jobPostings.map(p => ({
    id: p.externalPath, key: p.externalPath.split('/').pop(), title: p.title, posted: p.postedOn || null, closes: null,
    url: `https://${host}/en-US/${site}${p.externalPath}`,
  }));
}

export function parseIcims(html, { host }) {
  if (typeof html !== 'string' || !/iCIMS/i.test(html)) throw new Error('unexpected iCIMS response');
  const out = [];
  for (const card of html.split('class="iCIMS_JobCardItem"').slice(1)) {
    const a = card.match(/href="https?:\/\/[^"]*\/jobs\/(\d+)\/[^"]*"[^>]*title="\d+\s*-\s*([^"]+)"/);
    if (!a) continue;
    const posted = card.match(/<span title="([^"]+)">/);
    out.push({ id: a[1], key: `/jobs/${a[1]}/`, title: decode(a[2]).trim(), posted: posted ? posted[1] : null, closes: null, url: `https://${host}/jobs/${a[1]}/job` });
  }
  return out;
}

export function parseOracle(json, { host, site }) {
  const list = json && json.items && json.items[0] && json.items[0].requisitionList;
  if (!Array.isArray(list)) throw new Error('unexpected Oracle response');
  return list.map(r => ({
    id: String(r.Id), key: `/job/${r.Id}/`, title: r.Title, posted: r.PostedDate || null, closes: r.PostingEndDate || null,
    url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${r.Id}/`,
  }));
}

export function parseSmartRecruiters(json, { company }) {
  if (!json || !Array.isArray(json.content)) throw new Error('unexpected SmartRecruiters response');
  return json.content.map(p => ({
    id: String(p.id), key: `/${p.id}`, title: p.name, posted: p.releasedDate ? p.releasedDate.slice(0, 10) : null, closes: null,
    url: `https://jobs.smartrecruiters.com/${company}/${p.id}`,
  }));
}

/** Program / posting / list pages: keep only the sentences that matter, so page chrome and timestamps don't trigger alerts. */
export function pageExcerpt(html) {
  if (typeof html !== 'string' || html.length < 200) throw new Error('page too short');
  const text = decode(html
    .replace(/<(script|style|noscript|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n'));
  // Split on page structure first; split long blocks only at real sentence ends (not "Jan. 19" or "e.g.").
  const SENT = /(?<!\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|St|Dr|No|Mr|Ms|vs|e\.g|i\.e))(?<=[.!?])\s+(?=[A-Z])/;
  const lines = text.split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .flatMap(s => (s.length > 400 ? s.split(SENT) : [s])).map(s => s.trim()).filter(Boolean);
  const KEEP = /extern|posting|intake|application|apply by|deadline|closing|expire|no longer|halfway|year of/i;
  const keep = [...new Set(lines.filter(l => KEEP.test(l) && l.length >= 12 && l.length <= 600))];
  const blocked = /captcha|access denied|unusual (traffic|activity)/i.test(text);
  const expired = /(this job|posting) (has )?expired|no longer (open|available|accepting)|does not exist/i.test(text);
  return { lines: keep, hash: sha(keep.join('\n')), blocked, expired };
}

const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
function decode(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&rsquo;|&#8217;/g, '’').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// ---------- Fetching (network; not used by tests) ----------
const MAX_PAGES = 10;
/** Only a complete read counts as "ok". */
export function complete(postings, total) {
  if (total != null && postings.length < total) return { status: 'error', reason: `board reports ${total} results but only ${postings.length} could be read` };
  return { status: 'ok', postings };
}
async function http(url, opts = {}) {
  const res = await fetch(url, { ...opts, redirect: 'follow', signal: AbortSignal.timeout(25000), headers: { 'User-Agent': UA, 'Accept-Language': 'en-CA', ...(opts.headers || {}) } });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return body;
}

export async function checkSource(src, fetcher = http) {
  const p = src.params || {};
  try {
    switch (src.adapter) {
      case 'manual': return { status: 'manual', reason: p.reason };
      case 'workday': {
        // Page through every result; a board we couldn't read completely is "not checked", never "unchanged".
        const all = []; let total = null;
        for (let offset = 0, page = 0; page < MAX_PAGES; page++, offset += 20) {
          const j = JSON.parse(await fetcher(`https://${p.host}/wday/cxs/${p.tenant}/${p.site}/jobs`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: 'extern' }) }));
          if (total === null) total = Number(j.total) || 0;      // Workday reports the total on the first page
          const got = parseWorkday(j, p); all.push(...got);
          if (!got.length || all.length >= total) break;
        }
        return complete(all, total);
      }
      case 'icims': return { status: 'ok', postings: parseIcims(await fetcher(`https://${p.host}/jobs/search?ss=1&searchKeyword=extern&in_iframe=1`), p) };
      case 'oracle': {
        const j = JSON.parse(await fetcher(`https://${p.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${p.site},keyword=extern,limit=200`));
        const total = j && j.items && j.items[0] && Number.isFinite(j.items[0].TotalJobsCount) ? j.items[0].TotalJobsCount : null;
        const ps = parseOracle(j, p);
        return complete(ps, total ?? ps.length);
      }
      case 'smartrecruiters': {
        const all = []; let total = null;
        for (let offset = 0, page = 0; page < MAX_PAGES; page++, offset += 100) {
          const j = JSON.parse(await fetcher(`https://api.smartrecruiters.com/v1/companies/${p.company}/postings?q=extern&limit=100&offset=${offset}`));
          total = Number(j.totalFound) || 0;
          const got = parseSmartRecruiters(j, p); all.push(...got);
          if (!got.length || all.length >= total) break;
        }
        return complete(all, total);
      }
      case 'page': {
        const ex = pageExcerpt(await fetcher(p.url));
        if (ex.blocked) return { status: 'error', reason: 'bot challenge or access denied' };
        return { status: 'ok', page: ex };
      }
      default: return { status: 'error', reason: `unknown adapter ${src.adapter}` };
    }
  } catch (e) {
    return { status: 'error', reason: String(e.message || e).slice(0, 120) };
  }
}

// ---------- Diff (pure) ----------
const host = u => { try { return new URL(u).hostname; } catch { return ''; } };
/** Does a site link point at this board posting? Same host, and the posting's key (req id / job id) appears in the link. */
export const idIn = (url, q) => host(url) === host(q.url) && (url === q.url || url.includes(q.key || q.id));

/**
 * results: { [sourceId]: checkSource result }, prev: previous snapshot or null, data: hospitals.json
 * Returns the review items and the next snapshot. Never marks an unread board as unchanged.
 */
export function diff({ sources, results, prev, data, today, now }) {
  const items = { newOnBoard: [], goneFromBoard: [], changed: [], pageChanged: [], notChecked: [], manual: [], unchanged: [], ignored: [], due: [] };
  const snap = { generated: now, sources: {} };
  const entries = Object.fromEntries(data.entries.map(e => [e.id, e]));
  // An entry's posting links: its separate postings if it has them (its source_url is then a search page), else its source_url.
  const siteLinks = data.entries.flatMap(e => ((e.postings && e.postings.length) ? e.postings.map(q => q.url) : [e.source_url]).map(u => ({ entry: e.id, url: u })));

  for (const src of sources) {
    const r = results[src.id] || { status: 'error', reason: 'not run' };
    const before = prev && prev.sources && prev.sources[src.id];
    if (r.status === 'manual') {
      items.manual.push({ src, reason: r.reason, verified: src.entries.map(id => `${id} ${entries[id] ? entries[id].last_verified : '?'}`) });
      if (before) snap.sources[src.id] = before;
      continue;
    }
    let postings = r.postings && r.postings.filter(q => { const keep = isNursingExtern(q.title); if (!keep) items.ignored.push({ src, q }); return keep; });
    // An "ok" board that suddenly returns nothing, while we have open listings on it or it had postings before, is suspect.
    const openHere = src.entries.filter(id => entries[id] && status(entries[id], today, data.stale_after_days).group === 0 && entries[id].source_kind === 'posting');
    const hadBefore = before && Array.isArray(before.postings) && before.postings.length > 0;
    if (r.status === 'ok' && postings && postings.length === 0 && (openHere.length || hadBefore)) {
      r.status = 'error'; r.reason = 'board returned no extern postings, but we list open postings here (possible layout change or block)';
    }
    if (r.status !== 'ok') {
      items.notChecked.push({ src, reason: r.reason, lastOk: before ? before.checked : null });
      if (before) snap.sources[src.id] = before;            // carried forward, old timestamp kept
      continue;
    }
    if (postings) {
      snap.sources[src.id] = { checked: now, postings };
      if (src.tracked !== false || postings.length) {
        for (const q of postings) if (!siteLinks.some(l => idIn(l.url, q))) items.newOnBoard.push({ src, q });
        for (const id of openHere) {
          const links = siteLinks.filter(l => l.entry === id);
          const gone = links.filter(l => !postings.some(q => idIn(l.url, q)));
          for (const l of gone) items.goneFromBoard.push({ src, entry: id, url: l.url });
        }
      }
      if (hadBefore) for (const q of postings) {
        const old = before.postings.find(o => o.id === q.id);
        if (old) for (const k of ['title', 'posted', 'closes']) if ((old[k] || null) !== (q[k] || null)) items.changed.push({ src, q, field: k, from: old[k], to: q[k] });
      }
      if (!items.newOnBoard.some(i => i.src === src) && !items.goneFromBoard.some(i => i.src === src) && !items.changed.some(i => i.src === src)) items.unchanged.push({ src, n: postings.length });
    } else if (r.page) {
      snap.sources[src.id] = { checked: now, page: { hash: r.page.hash, lines: r.page.lines } };
      const pageNote = src.params.mode === 'posting' && r.page.expired ? 'posting page now says it has expired or is no longer available' : null;
      if (before && before.page && before.page.hash !== r.page.hash) {
        const added = r.page.lines.filter(l => !before.page.lines.includes(l));
        const removed = before.page.lines.filter(l => !r.page.lines.includes(l));
        items.pageChanged.push({ src, added, removed, note: pageNote });
      } else if (pageNote) items.pageChanged.push({ src, added: [], removed: [], note: pageNote });
      else items.unchanged.push({ src, n: null, baseline: !before });
    }
  }
  for (const e of data.entries) {
    const age = daysBetween(e.last_verified, today), left = data.stale_after_days - age;
    if (left <= 2) items.due.push({ e, left });
  }
  return { items, snap };
}

// ---------- Report (pure) ----------
export function renderReport({ items, now, today }) {
  const L = [];
  const review = items.newOnBoard.length + items.goneFromBoard.length + items.changed.length + items.pageChanged.length;
  const unread = items.notChecked.length + items.manual.length;
  L.push(`# Watcher report: ${now}`, '');
  L.push(`**${review} item(s) to review. ${unread} board(s) NOT checked automatically** (listed below; they are not "unchanged").`);
  L.push(`Nothing here is published. Verify on the official page, then use the normal preview → merge flow (docs/DATA-WORKFLOW.md).`, '');
  const sec = (title, arr, fmt) => { L.push(`## ${title} (${arr.length})`); L.push(...(arr.length ? arr.map(fmt) : ['- none'])); L.push(''); };
  sec('New nursing extern postings on official boards, not on the site', items.newOnBoard, i => `- **${i.src.hospital}**: ${i.q.title}${i.q.posted ? ` (posted ${i.q.posted})` : ''}${i.src.tracked === false ? ' · *hospital not yet tracked*' : ''}\n  ${i.q.url}`);
  sec('Linked on the site as open, but not found on the board', items.goneFromBoard, i => `- **${i.src.hospital}** (\`${i.entry}\`): ${i.url}\n  Open it: expired → set closed; moved → update the link.`);
  sec('Changed since the last run', items.changed, i => `- **${i.src.hospital}**: ${i.q.title}: ${i.field} "${i.from ?? '—'}" → "${i.to ?? '—'}"`);
  sec('Program or posting pages changed', items.pageChanged, i => [`- **${i.src.hospital}** ${i.src.params.url}${i.note ? `\n  ⚠ ${i.note}` : ''}`, ...i.added.slice(0, 6).map(l => `  + ${l}`), ...i.removed.slice(0, 6).map(l => `  − ${l}`)].join('\n'));
  sec('NOT CHECKED: could not read the board this run', items.notChecked, i => `- **${i.src.hospital}** (${i.src.adapter}): ${i.reason}. Last successful check: ${i.lastOk || 'never'}. Check by hand.`);
  sec('NOT CHECKED: manual boards (open these yourself)', items.manual, i => `- **${i.src.hospital}**: ${i.src.params.url}\n  Why manual: ${i.reason}. Our entries: ${i.verified.join(', ') || 'none (watch-only)'}`);
  sec('Entries due for re-verification (≤ 2 days before they show Unconfirmed)', items.due, i => `- \`${i.e.id}\` last verified ${i.e.last_verified} (${i.left <= 0 ? 'now Unconfirmed' : `${i.left} day(s) left`})`);
  sec('Read successfully, no differences found', items.unchanged, i => `- ${i.src.hospital} (${i.src.adapter})${i.n != null ? `: ${i.n} nursing extern posting(s), all on the site` : i.baseline ? ': first run, baseline saved' : ': key sentences unchanged'}`);
  if (items.ignored.length) { L.push(`<details><summary>Ignored: ${items.ignored.length} other title(s) returned by board searches (not nursing extern postings)</summary>`, '', ...items.ignored.map(i => `- ${i.src.hospital}: ${i.q.title}`), '', '</details>', ''); }
  L.push(`_Today (Ontario): ${today}. "No differences" only covers boards listed in that section._`);
  return L.join('\n') + '\n';
}

// ---------- CLI ----------
async function main() {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const today = opt('--today') || ontarioToday();
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const { sources } = JSON.parse(readFileSync(`${ROOT}watch/sources.json`, 'utf8'));
  const abs = f => (f.startsWith('/') ? f : `${ROOT}${f}`);
  const data = JSON.parse(readFileSync(abs(opt('--data') || 'data/hospitals.json'), 'utf8'));
  const snapPath = abs(opt('--snapshot') || 'watch/snapshot.json');
  const prev = existsSync(snapPath) ? JSON.parse(readFileSync(snapPath, 'utf8')) : null;
  const results = {};
  for (const src of sources) results[src.id] = await checkSource(src);   // sequential: one polite request per board
  const { items, snap } = diff({ sources, results, prev, data, today, now });
  const report = renderReport({ items, now, today });
  const out = opt('--report');
  if (out) writeFileSync(out.startsWith('/') ? out : `${ROOT}${out}`, report); else process.stdout.write(report);
  if (args.includes('--write-snapshot')) writeFileSync(snapPath, JSON.stringify(snap, null, 1) + '\n');
  const unread = items.notChecked.length + items.manual.length;
  console.error(`watch: ${Object.keys(results).length} boards, ${unread} not checked automatically, report ${out || '(stdout)'}${args.includes('--write-snapshot') ? ', snapshot written' : ''}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(2); });
