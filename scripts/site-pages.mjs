// Build-time pages for search and answer engines: the guides hub and posts (/guides, /guides/<slug>),
// the postings list rendered into the home page's HTML, JSON-LD, and llms.txt.
//
// Posts live in content/guides/<slug>.md: a small front-matter block, then Markdown. Facts are never typed into a
// post. They are tokens that read data/hospitals.json at build time, so a post can't disagree with the tracker:
//   {{shn.deadline|date}}  {{shn.pay_text}}  {{humber.postings.length}}  {{shn|status}}  {{shn|checked}}  {{shn.source_url}}
// Every entry a post uses must be listed in its front matter `facts`. Unknown entries or fields fail the build.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { status, formatDate, daysBetween, sortEntries, openSummary, shownDeadline, countHospitals } from '../assets/logic.js';

export const GUIDES_PATH = '/guides'; // hub URL; posts are GUIDES_PATH/<slug>. Change here only, before anything is indexed.
export const ORG_NAME = 'Ontario Extern Tracker';

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const longDate = (iso) => formatDate(iso).replace(/^\w+, /, ''); // "Nov 23, 2026"
const shortDate = (iso) => longDate(iso).replace(/, \d{4}$/, ''); // "Nov 23"

// ---------------------------------------------------------------- posts
/** Parse "key: value" front matter between --- lines. Arrays are written [a, b]. */
export function parseFrontMatter(text, file = '') {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) throw new Error(`${file}: bad front-matter line "${line}"`);
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean);
    else v = v.replace(/^"(.*)"$/, '$1');
    meta[kv[1]] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}

const REQUIRED = ['title', 'description', 'slug', 'status', 'date_published', 'date_modified', 'facts', 'answer'];

/** Load every post. Drafts are dropped unless includeDrafts (preview builds show them for review). */
export function loadGuides(dir, { includeDrafts = false } = {}) {
  if (!existsSync(dir)) return [];
  const posts = readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const { meta, body } = parseFrontMatter(readFileSync(dir + f, 'utf8'), f);
    for (const k of REQUIRED) if (meta[k] === undefined || meta[k] === '') throw new Error(`${f}: front matter needs "${k}"`);
    if (`${meta.slug}.md` !== f) throw new Error(`${f}: slug "${meta.slug}" must match the file name`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.slug)) throw new Error(`${f}: slug must be lowercase words joined by hyphens`);
    if (!['draft', 'published'].includes(meta.status)) throw new Error(`${f}: status must be draft or published`);
    for (const k of ['date_published', 'date_modified']) if (!/^\d{4}-\d{2}-\d{2}$/.test(meta[k])) throw new Error(`${f}: ${k} must be YYYY-MM-DD`);
    if (meta.date_modified < meta.date_published) throw new Error(`${f}: date_modified is before date_published`);
    if (!Array.isArray(meta.facts)) throw new Error(`${f}: facts must be a list, e.g. [shn, mackenzie]`);
    const words = meta.answer.split(/\s+/).length;
    if (words < 30 || words > 70) throw new Error(`${f}: the answer (the snippet) should be 40-60 words; it has ${words}`);
    return { ...meta, body, file: f };
  });
  const seen = new Set();
  for (const p of posts) { if (seen.has(p.slug)) throw new Error(`duplicate slug ${p.slug}`); seen.add(p.slug); }
  return posts.filter((p) => includeDrafts || p.status === 'published');
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : k === 'length' ? o.length : o[k]), obj);

/** Replace {{entry.field|format}} tokens with values from the data. */
export function resolveTokens(text, post, data, today) {
  const byId = new Map(data.entries.map((e) => [e.id, e]));
  return text.replace(/\{\{\s*([a-z0-9-]+)(?:\.([a-z_.]+))?(?:\|([a-z]+))?\s*\}\}/g, (tok, id, field, fmt) => {
    const e = byId.get(id);
    if (!e) throw new Error(`${post.file}: ${tok}: no entry "${id}" in hospitals.json`);
    if (!post.facts.includes(id)) throw new Error(`${post.file}: ${tok}: add "${id}" to the post's facts list`);
    if (!field) {
      if (fmt === 'status') return status(e, today, data.stale_after_days).label;
      if (fmt === 'checked') return `checked ${longDate(e.last_verified)}`;
      throw new Error(`${post.file}: ${tok}: use {{${id}|status}}, {{${id}|checked}} or {{${id}.<field>}}`);
    }
    const v = getPath(e, field);
    if (v === undefined || v === null || v === '') throw new Error(`${post.file}: ${tok}: ${id}.${field} is empty in hospitals.json`);
    if (fmt === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${post.file}: ${tok}: not a date`);
      return daysBetween(v, today) > 0 ? `${longDate(v)} (that date has passed)` : longDate(v);
    }
    if (fmt) throw new Error(`${post.file}: ${tok}: unknown format "${fmt}"`);
    return String(v);
  });
}

/** Small Markdown subset: ## / ### headings, paragraphs, - and 1. lists, [links](url), **bold**, *italic*. */
export function markdown(md) {
  const inline = (s) => esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, (m, t, u) => `<a href="${u}"${u.startsWith('http') ? ' rel="noopener"' : ''}>${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{2,3})\s+(.*)$/))) { flushPara(); flushList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = line.match(/^(-|\d+\.)\s+(.*)$/))) {
      flushPara();
      const tag = m[1] === '-' ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(m[2]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('\n');
}

/** FAQ pairs from a page: after an <h2>FAQ</h2>, each <p><strong>Question?</strong> answer</p>. */
export function faqFromHtml(html) {
  const at = html.search(/<h2>\s*FAQ\s*<\/h2>/i);
  if (at < 0) return [];
  const rest = html.slice(at).split(/<h2>/i).slice(0, 2).join('');
  const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return [...rest.matchAll(/<p><strong>([^<]+\?)<\/strong>\s*([\s\S]*?)<\/p>/g)].map((m) => ({ q: strip(m[1]), a: strip(m[2]) }));
}

// ---------------------------------------------------------------- JSON-LD
export function orgGraph(site) {
  return [
    { '@type': 'Organization', '@id': `${site}/#org`, name: ORG_NAME, url: `${site}/`, description: "Independent tracker of Ontario nursing extern postings, checked on hospitals' own career pages. Not affiliated with any hospital or Ontario Health." },
    { '@type': 'WebSite', '@id': `${site}/#website`, name: ORG_NAME, url: `${site}/`, inLanguage: 'en-CA', publisher: { '@id': `${site}/#org` } },
  ];
}
export function faqNode(url, faqs) {
  return faqs.length ? { '@type': 'FAQPage', '@id': `${url}#faq`, url, mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) } : null;
}
export function ldScript(nodes) {
  // JSON-LD is a data block, not a script the browser runs. "<" is escaped so the text can never close the tag.
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes.filter(Boolean) }).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

// ---------------------------------------------------------------- pages
const head = ({ title, description, extra = '' }) => `<!doctype html>
<html lang="en-CA">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/styles.css">
  <script type="module" src="/assets/article.js"></script>${extra}
</head>`;

const nav = `<p class="crumbs"><a href="/">Ontario Extern Tracker</a> · <a href="${GUIDES_PATH}">Guides</a></p>`;

/** Entries a post uses, with their current check dates: the Sources list. */
function sourcesFor(post, data) {
  const byId = new Map(data.entries.map((e) => [e.id, e]));
  return post.facts.map((id) => byId.get(id)).filter(Boolean);
}

export function renderPost(post, data, today, site) {
  const url = `${site}${GUIDES_PATH}/${post.slug}`;
  const facts = sourcesFor(post, data);
  const checked = facts.map((e) => e.last_verified).sort()[0];
  const stale = facts.some((e) => daysBetween(e.last_verified, today) > (data.stale_after_days ?? 7));
  const body = markdown(resolveTokens(post.body, post, data, today));
  const answer = esc(resolveTokens(post.answer, post, data, today));
  const faqs = faqFromHtml(body);
  const ld = ldScript([
    ...orgGraph(site),
    {
      '@type': 'BlogPosting', '@id': `${url}#post`, headline: post.title, description: post.description, url,
      mainEntityOfPage: url, datePublished: post.date_published, dateModified: post.date_modified, inLanguage: 'en-CA',
      author: { '@id': `${site}/#org` }, publisher: { '@id': `${site}/#org` }, isPartOf: { '@id': `${site}/#website` },
      citation: facts.map((e) => e.source_url),
    },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: ORG_NAME, item: `${site}/` },
      { '@type': 'ListItem', position: 2, name: 'Guides', item: `${site}${GUIDES_PATH}` },
      { '@type': 'ListItem', position: 3, name: post.title, item: url },
    ] },
    faqNode(url, faqs),
  ]);
  return `${head({ title: post.title, description: post.description, extra: '\n  ' + ld })}
<body>
<article class="article">
  ${nav}
  <h1>${esc(post.title)}</h1>
  <p class="answer"><strong>Short answer:</strong> ${answer}</p>
  <p class="src">Published ${longDate(post.date_published)}${post.date_modified !== post.date_published ? `, updated ${longDate(post.date_modified)}` : ''}. Hospital facts last checked ${longDate(checked)} on each hospital's own page (linked below). Not affiliated with any hospital or Ontario Health.</p>
  ${stale ? `<p class="notice">Some details here were last checked more than ${data.stale_after_days ?? 7} days ago. Confirm on the hospital's own posting before applying.</p>` : ''}
  <a class="btn cta" href="/">See which extern postings are open now →</a>
${body}
  <h2>Sources</h2>
  <ul class="sources">${facts.map((e) => `<li><a href="${esc(e.source_url)}" rel="noopener">${esc(e.hospital)}: ${esc(e.program_name)}</a> <span class="src">(${esc(status(e, today, data.stale_after_days).label)}, checked ${longDate(e.last_verified)})</span></li>`).join('')}</ul>
  <a class="btn cta" href="/">Check open extern postings and your criteria →</a>
</article>
</body>
</html>
`;
}

/** Hub: every guide, newest first. `extraGuides` are standalone guide pages (e.g. the extern explainer). */
export function renderHub(posts, extraGuides, site) {
  const url = `${site}${GUIDES_PATH}`;
  const items = [
    ...posts.map((p) => ({ title: p.title, description: p.description, href: `${GUIDES_PATH}/${p.slug}`, date: p.date_modified })),
    ...extraGuides,
  ].sort((a, b) => b.date.localeCompare(a.date));
  const ld = ldScript([
    ...orgGraph(site),
    { '@type': 'CollectionPage', '@id': `${url}#page`, url, name: 'Guides for Ontario nursing externs', isPartOf: { '@id': `${site}/#website` },
      hasPart: items.map((i) => ({ '@type': 'Article', headline: i.title, url: `${site}${i.href}`, dateModified: i.date })) },
  ]);
  return `${head({ title: 'Guides for Ontario nursing externs: pay, talent pools, deadlines', description: 'Short, sourced answers about nursing externships at Ontario hospitals: what externs are, talent pools vs real vacancies, closing dates and criteria. Facts come from hospitals\' own pages.', extra: '\n  ' + ld })}
<body>
<article class="article">
  <p class="crumbs"><a href="/">Ontario Extern Tracker</a></p>
  <h1>Guides for Ontario nursing externs</h1>
  <p>Short answers to the questions students ask about extern postings. Every fact links to the hospital's own page and shows when we checked it.</p>
  <ul class="guide-list">${items.map((i) => `<li><a href="${esc(i.href)}"><strong>${esc(i.title)}</strong></a><br><span class="src">${esc(i.description)} Updated ${longDate(i.date)}.</span></li>`).join('')}</ul>
  <a class="btn cta" href="/">See which extern postings are open now →</a>
</article>
</body>
</html>
`;
}

// ---------------------------------------------------------------- home page, rendered at build time
/** The same headline the page script writes, so crawlers and no-JS readers get it too. */
export function staticIntro(data, today) {
  const sum = openSummary(data.entries, today);
  const parts = [];
  if (sum.positions) parts.push(`${sum.positions} list${sum.positions === 1 ? 's' : ''} positions`);
  if (sum.pools) parts.push(`${sum.pools} ${sum.pools === 1 ? 'is a talent pool' : 'are talent pools'}`);
  if (sum.other) parts.push(`${sum.other} ${sum.other === 1 ? "doesn't" : "don't"} say`);
  const standfirst = `<strong>${sum.hospitals} ${sum.hospitals === 1 ? 'hospital is' : 'hospitals are'} taking applications</strong>${sum.hospitals !== sum.listings ? ` (${sum.listings} listings)` : ''}${parts.length ? `: ${esc(parts.join(', '))}` : ''}.${sum.nextDeadline ? ` Next closing date: ${esc(shortDate(sum.nextDeadline))}.` : ''}`;
  const dateline = `Last full check of all ${data.entries.length} listings at ${countHospitals(data.entries)} hospitals, on their own career pages: ${shortDate(data.dataset_checked)}. Each listing shows the date we last checked it.`;
  return { standfirst, dateline };
}

/** Listings as plain HTML (the script replaces it with the interactive version on load). */
export function staticResults(data, today) {
  const host = (u) => { try { return new URL(u).host; } catch { return ''; } };
  const sorted = sortEntries(data.entries, today);
  const st = (e) => status(e, today, data.stale_after_days);
  const row = (e) => {
    const s = st(e);
    const dl = shownDeadline(e, today);
    const live = s.group === 0;
    const link = live
      ? `<a class="btn" href="${esc(e.source_url)}" rel="noopener">View posting</a>`
      : `<a class="sec" href="${esc(e.source_url)}" rel="noopener">${e.source_kind !== 'posting' ? 'Hospital page' : s.group === 4 ? 'Expired posting' : 'View posting'}</a>`;
    return `
    <article class="row${s.group === 4 ? ' is-closed' : ''}">
      <div class="c-hosp"><h3 class="name">${esc(e.hospital)}</h3><p class="meta">${esc(e.location)} · ${esc(e.program_name)}</p></div>
      <div class="c-status"><p class="status">${esc(s.label)}</p>${s.detail ? `<p class="meta">${esc(s.detail)}</p>` : ''}<p class="meta checked">Checked ${esc(shortDate(e.last_verified))}</p></div>
      <div class="c-when"><div class="c-close">${dl ? `Closes ${esc(longDate(dl.date))}` : live ? 'No closing date shown' : ''}</div><div class="c-pay">${e.pay_text ? esc(e.pay_text) : ''}</div></div>
      <div class="c-actions"><div class="c-act">${link}</div><p class="src">Source: ${esc(host(e.source_url))}</p></div>
    </article>`;
  };
  const section = (title, items) => items.length ? `
  <section class="section">
    <h2 class="section-h">${title} <span class="n">${items.length}</span></h2>
    <div class="rows">${items.map(row).join('')}</div>
  </section>` : '';
  return section('Taking applications', sorted.filter((e) => st(e).group === 0))
    + section('Not open now, or no live posting linked', sorted.filter((e) => [1, 2].includes(st(e).group)))
    + section("Unconfirmed: check the hospital's posting", sorted.filter((e) => st(e).group === 3))
    + section('Closed', sorted.filter((e) => st(e).group === 4));
}

// ---------------------------------------------------------------- llms.txt
export function llmsTxt({ site, data, today, posts, guides }) {
  const sum = openSummary(data.entries, today);
  return `# ${ORG_NAME}

> Independent, free tracker of nursing externship (clinical extern) postings at Ontario hospitals. Each listing is checked on the hospital's own careers page and shows its status (positions listed, talent pool, posting live, not open now, closed or unconfirmed), closing date, pay as posted, listed criteria (program, year, BCLS) and the date it was last checked. Not affiliated with any hospital, Ontario Health or the Ministry of Health.

Data: last full check ${data.dataset_checked}. ${data.entries.length} listings at ${countHospitals(data.entries)} hospitals. On ${today}: ${sum.hospitals} hospitals (${sum.listings} listings) taking applications. Listings are re-checked at least every ${data.stale_after_days ?? 7} days; a listing not re-checked within ${data.stale_after_days ?? 7} days is marked Unconfirmed, never Open. Talent pools are labelled as talent pools, never as vacancies.

## Main pages
- [Ontario extern postings: what's open, closing dates and criteria](${site}/): the tracker, with per-listing status, closing date, pay and a criteria check
- [What is a clinical extern in Ontario?](${site}/what-is-a-clinical-extern-ontario): extern vs clinical placement vs Nursing Graduate Guarantee, recruiting windows, typical requirements
- [Guides](${site}${GUIDES_PATH}): short sourced answers for nursing students

## Guides
${[...posts.map((p) => `- [${p.title}](${site}${GUIDES_PATH}/${p.slug}): ${p.description}`), ...guides.map((g) => `- [${g.title}](${site}${g.href}): ${g.description}`)].join('\n')}

## Data
- [hospitals.json](${site}/data/hospitals.json): the listings as JSON (status, deadline, pay_text, eligibility, source_url, last_verified for each)
`;
}
