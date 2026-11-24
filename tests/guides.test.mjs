import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTokens, markdown, parseFrontMatter, loadGuides, faqFromHtml, staticIntro, GUIDES_PATH } from '../scripts/site-pages.mjs';

const root = new URL('../', import.meta.url).pathname;
const data = JSON.parse(readFileSync(root + 'data/hospitals.json', 'utf8'));
const BUILD_VARS = ['CF_PAGES', 'CF_PAGES_BRANCH', 'CF_PAGES_URL', 'CF_PAGES_COMMIT_SHA', 'UMAMI_WEBSITE_ID', 'GSC_VERIFICATION', 'ET_TODAY', 'ET_DATA'];
const cleanEnv = (extra = {}) => { const e = { ...process.env }; for (const k of BUILD_VARS) delete e[k]; return { ...e, ...extra }; };
const build = (env = {}) => {
  const out = mkdtempSync(join(tmpdir(), 'et-guides-'));
  execFileSync(process.execPath, [root + 'scripts/build-dist.mjs', '--out', out, '--allow-stale'], { stdio: 'pipe', env: cleanEnv(env) });
  return { out, rd: (f) => readFileSync(join(out, f), 'utf8'), has: (f) => existsSync(join(out, f)), done: () => rmSync(out, { recursive: true, force: true }) };
};
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => JSON.parse(m[1])['@graph']);

test('guides live at /guides and /guides/<slug>', () => {
  assert.equal(GUIDES_PATH, '/guides');
});

test('tokens read hospitals.json; unknown entries, unlisted entries and empty fields fail', () => {
  const post = { file: 't.md', facts: ['shn', 'humber'] };
  const t = '2026-11-23';
  assert.equal(resolveTokens('{{shn.deadline|date}}', post, data, t), 'Nov 30, 2026');
  assert.equal(resolveTokens('{{shn.deadline|date}}', post, data, '2026-12-01'), 'Nov 30, 2026 (that date has passed)');
  assert.equal(resolveTokens('{{humber.postings.length}}', post, data, t), String(data.entries.find((e) => e.id === 'humber').postings.length));
  assert.equal(resolveTokens('{{shn|status}}', post, data, t), 'Open · talent pool');
  assert.match(resolveTokens('{{shn|checked}}', post, data, t), /^checked [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  assert.throws(() => resolveTokens('{{nope.deadline}}', post, data, t), /no entry "nope"/);
  assert.throws(() => resolveTokens('{{mackenzie.pay_text}}', post, data, t), /add "mackenzie" to the post's facts/);
  assert.throws(() => resolveTokens('{{humber.deadline|date}}', post, data, t), /empty in hospitals.json/);
});

test('markdown subset escapes HTML and keeps links, lists, bold', () => {
  const h = markdown('## Hi\n\nA <b>x</b> **bold** and [link](https://example.org/a).\n\n- one\n- two');
  assert.match(h, /<h2>Hi<\/h2>/);
  assert.match(h, /A &lt;b&gt;x&lt;\/b&gt; <strong>bold<\/strong> and <a href="https:\/\/example.org\/a" rel="noopener">link<\/a>\./);
  assert.match(h, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.doesNotMatch(markdown('[x](javascript:alert(1))'), /href="javascript/);
});

test('front matter: drafts stay out unless asked; required fields enforced', () => {
  const dir = mkdtempSync(join(tmpdir(), 'et-posts-')) + '/';
  const fm = (slug, status) => `---\ntitle: T\ndescription: D\nslug: ${slug}\nstatus: ${status}\ndate_published: 2026-11-24\ndate_modified: 2026-11-24\nfacts: [shn]\nanswer: ${'word '.repeat(45).trim()}\n---\nBody`;
  writeFileSync(dir + 'a-post.md', fm('a-post', 'published'));
  writeFileSync(dir + 'b-post.md', fm('b-post', 'draft'));
  assert.deepEqual(loadGuides(dir).map((p) => p.slug), ['a-post']);
  assert.deepEqual(loadGuides(dir, { includeDrafts: true }).map((p) => p.slug), ['a-post', 'b-post']);
  writeFileSync(dir + 'c-post.md', fm('wrong', 'published'));
  assert.throws(() => loadGuides(dir), /must match the file name/);
  rmSync(dir, { recursive: true, force: true });
  assert.throws(() => parseFrontMatter('no front matter', 'x.md'), /missing front matter/);
});

test('every published post builds: answer first, Sources list, BlogPosting + Breadcrumb + FAQ JSON-LD, no leftover tokens', () => {
  const b = build();
  for (const p of loadGuides(root + 'content/guides/')) {
    const html = b.rd(`guides/${p.slug}.html`);
    assert.doesNotMatch(html, /\{\{/, `${p.slug}: unresolved token`);
    assert.match(html, /<p class="answer"><strong>Short answer:<\/strong>/);
    assert.match(html, /<h2>Sources<\/h2>/);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://ontarioexterns\\.ca/guides/${p.slug}">`));
    assert.match(html, /<meta property="og:type" content="article">/);
    const nodes = ld(html);
    const post = nodes.find((n) => n['@type'] === 'BlogPosting');
    assert.equal(post.datePublished, p.date_published);
    assert.equal(post.dateModified, p.date_modified);
    assert.equal(post.url, `https://ontarioexterns.ca/guides/${p.slug}`);
    assert.ok(nodes.some((n) => n['@type'] === 'BreadcrumbList'));
    assert.ok(nodes.some((n) => n['@type'] === 'Organization'));
    assert.doesNotMatch(html, /JobPosting/);
    // a talent pool is never called a vacancy or an opening in the same breath
    for (const sentence of html.replace(/<[^>]+>/g, ' ').split(/(?<=[.!?])\s+/))
      if (/talent pool/i.test(sentence) && /\b(is|are) (an? )?(open job|vacanc|opening)/i.test(sentence)) assert.fail(`${p.slug}: "${sentence.trim()}"`);
  }
  const faq = ld(b.rd('guides/talent-pool-vs-vacancy.html')).find((n) => n['@type'] === 'FAQPage');
  assert.ok(faq.mainEntity.length >= 2);
  b.done();
});

test('hub, sitemap, llms.txt and the home page HTML', () => {
  const b = build();
  const hub = b.rd('guides.html');
  assert.match(hub, /<link rel="canonical" href="https:\/\/ontarioexterns\.ca\/guides">/);
  assert.match(hub, /href="\/guides\/talent-pool-vs-vacancy"/);
  assert.match(hub, /href="\/what-is-a-clinical-extern-ontario"/);
  assert.ok(ld(hub).some((n) => n['@type'] === 'CollectionPage'));
  const sm = b.rd('sitemap.xml');
  for (const u of ['/', '/what-is-a-clinical-extern-ontario', '/guides', '/guides/talent-pool-vs-vacancy']) assert.match(sm, new RegExp(`<loc>https://ontarioexterns\\.ca${u.replace(/\//g, '\\/')}</loc><lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`));
  assert.match(sm, new RegExp(`<loc>https://ontarioexterns\\.ca/</loc><lastmod>${data.dataset_checked}</lastmod>`));
  const llms = b.rd('llms.txt');
  assert.match(llms, /^# Ontario Extern Tracker/);
  assert.match(llms, new RegExp(`last full check ${data.dataset_checked}`));
  assert.match(llms, /https:\/\/ontarioexterns\.ca\/guides\/talent-pool-vs-vacancy/);
  const home = b.rd('index.html');
  // listings are in the HTML, not only drawn by the script
  for (const e of data.entries) assert.ok(home.includes(e.hospital.replace(/&/g, '&amp;').replace(/'/g, "'")), e.hospital);
  assert.match(home, /<p class="standfirst" id="standfirst"><strong>\d+ hospitals? (is|are) taking applications<\/strong>/);
  assert.match(home, /id="dateline">Last full check of all \d+ listings/);
  assert.ok(ld(home).some((n) => n['@type'] === 'WebSite'));
  const guide = b.rd('what-is-a-clinical-extern-ontario.html');
  const gf = ld(guide).find((n) => n['@type'] === 'FAQPage');
  assert.ok(gf && gf.mainEntity.length >= 3, 'the explainer FAQ is marked up');
  assert.ok(ld(guide).some((n) => n['@type'] === 'Article'));
  b.done();
});

test('the build-time headline matches the page script for the same data and date', () => {
  const t = '2026-11-23';
  const { standfirst, dateline } = staticIntro(data, t);
  assert.match(standfirst, /taking applications/);
  assert.match(dateline, /^Last full check of all 17 listings at 15 hospitals/);
});

test('drafts show on preview builds only', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'et-repo-'));
  for (const d of ['assets', 'cal', 'data', 'scripts', 'content', 'marketing']) cpSync(root + d, join(tmp, d), { recursive: true });
  for (const f of ['index.html', 'what-is-a-clinical-extern-ontario.html', '404.html', 'favicon.svg', 'site.json']) cpSync(root + f, join(tmp, f));
  writeFileSync(join(tmp, 'content/guides/zz-draft.md'), `---\ntitle: Draft\ndescription: D\nslug: zz-draft\nstatus: draft\ndate_published: 2026-11-24\ndate_modified: 2026-11-24\nfacts: [shn]\nanswer: ${'word '.repeat(45).trim()}\n---\nIt closes {{shn.deadline|date}}.`);
  const run = (env) => { const out = mkdtempSync(join(tmpdir(), 'et-d-')); execFileSync(process.execPath, [join(tmp, 'scripts/build-dist.mjs'), '--out', out, '--allow-stale'], { stdio: 'pipe', env: cleanEnv(env) }); return out; };
  const prod = run({ CF_PAGES: '1', CF_PAGES_BRANCH: 'main', ET_TODAY: data.dataset_checked });
  const prev = run({ CF_PAGES: '1', CF_PAGES_BRANCH: 'preview/x', ET_TODAY: data.dataset_checked });
  assert.equal(existsSync(join(prod, 'guides/zz-draft.html')), false);
  assert.equal(existsSync(join(prev, 'guides/zz-draft.html')), true);
  for (const d of [tmp, prod, prev]) rmSync(d, { recursive: true, force: true });
});

test('FAQ extraction reads question/answer paragraphs under an FAQ heading', () => {
  assert.deepEqual(faqFromHtml('<h2>FAQ</h2>\n<p><strong>Paid?</strong> Yes.</p><p><strong>When?</strong> Often in <em>Feb</em>.</p><h2>Next</h2><p><strong>No?</strong> x</p>'),
    [{ q: 'Paid?', a: 'Yes.' }, { q: 'When?', a: 'Often in Feb.' }]);
});
