// Carousel renderer: posts/<id>.json -> out/<id>/{ig,tt}/NN.png using the installed Google Chrome (headless).
//
//   node marketing/carousel/render.mjs <post-id|all> [--guides] [--today YYYY-MM-DD]
//
// Before rendering it checks every fact the post states against data/hospitals.json (posting type,
// closing date, positions, pay, verification age). It refuses to render if anything differs or the data
// is more than 2 days old, so a stale slide can't be produced by accident.
// --guides draws TikTok's UI overlay zones and is for review only. Never post a --guides render.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { ontarioToday, daysBetween, status, eligibility } from '../../assets/logic.js';

const HERE = new URL('./', import.meta.url).pathname;
const ROOT = new URL('../../', import.meta.url).pathname;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const which = args.find(a => !a.startsWith('--')) || 'all';
const guides = args.includes('--guides');
const today = args.includes('--today') ? args[args.indexOf('--today') + 1] : ontarioToday();
const FORMATS = { ig: [1080, 1350], tt: [1080, 1920] };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Inline markup allowed in copy: **bold** only.
const md = s => esc(String(s ?? '').replaceAll('{HOST}', SITE.host))
  .replace(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2})\b/g, '<span class="nw">$1</span>') // keep "Nov 30" together
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

const data = JSON.parse(readFileSync(ROOT + 'data/hospitals.json'));
const SITE = { host: new URL(JSON.parse(readFileSync(ROOT + 'site.json')).origin).hostname };
// Newest screenshot folder (from capture.mjs). Slides refer to it as shots/{SHOTS}/name.png.
const SHOTS = existsSync(HERE + 'shots') ? readdirSync(HERE + 'shots').filter(d => /^\d{4}-\d\d-\d\d$/.test(d)).sort().at(-1) : null;
const byId = Object.fromEntries(data.entries.map(e => [e.id, e]));

function checkFacts(post) {
  const problems = [];
  const age = daysBetween(data.dataset_checked, today);
  if (age > 2) problems.push(`data last checked ${data.dataset_checked} (${age} days ago): re-verify first (REFRESH.md)`);
  if (!SHOTS) problems.push('no screenshots: run node marketing/carousel/capture.mjs');
  else if (SHOTS < data.dataset_checked) problems.push(`screenshots (${SHOTS}) are older than the data (${data.dataset_checked}): re-run capture.mjs`);
  for (const f of post.facts || []) {
    const e = byId[f.entry];
    if (!e) { problems.push(`unknown entry ${f.entry}`); continue; }
    const actual = f.verdict ? eligibility(e, { finalYear: false, region: 'all', bcls: '', ...f.verdict }).verdict
      : f.field === 'status' ? status(e, today, data.stale_after_days).key : e[f.field];
    if (JSON.stringify(actual) !== JSON.stringify(f.equals)) problems.push(`${f.entry}.${f.field || 'verdict ' + JSON.stringify(f.verdict)} is ${JSON.stringify(actual)}, slide says ${JSON.stringify(f.equals)}`);
  }
  for (const id of new Set((post.facts || []).map(f => f.entry))) {
    const d = daysBetween(byId[id].last_verified, today);
    if (d > 2) problems.push(`${id} last verified ${byId[id].last_verified}`);
  }
  if (post.facts?.some(f => f.field === 'deadline') && post.facts.filter(f => f.field === 'deadline').some(f => f.equals && f.equals < today))
    problems.push('a closing date on these slides has passed');
  return problems;
}

function slideHtml(post, slide, i, n, fmt) {
  const img = s => s ? `<div class="shot ${slide.imgFirst ? 'natural' : ''}"><img src="file://${HERE}${esc(s.src.replace('{SHOTS}', SHOTS))}" alt="">${s.cap ? `<p class="cap">${md(s.cap)}</p>` : ''}</div>` : '';
  const rows = r => r ? `<div class="rows">${r.map(([k, v, tone, small]) => `<div class="row"><span class="k">${md(k)}</span><span class="v ${tone || ''}">${md(v)}${small ? `<small>${md(small)}</small>` : ''}</span></div>`).join('')}</div>` : '';
  const entries = es => es ? `<div class="entries">${es.map(e => `<div class="entry"><div class="n">${md(e.name)}</div>${e.status ? `<div class="s ${e.tone || ''}">${md(e.status)}</div>` : ''}${e.detail ? `<div class="d">${md(e.detail)}</div>` : ''}</div>`).join('')}</div>` : '';
  const pick = v => (v && typeof v === 'object' && !Array.isArray(v) && (v.ig || v.tt)) ? v[fmt] : v; // per-format overrides
  const s = Object.fromEntries(Object.entries(slide).map(([k, v]) => [k, pick(v)]));
  const text = `${s.sub ? `<p class="sub">${md(s.sub)}</p>` : ''}
    ${rows(s.rows)}${entries(s.entries)}
    ${s.quote ? `<blockquote>${md(s.quote.text)}<cite>${md(s.quote.cite)}</cite></blockquote>` : ''}
    ${s.note ? `<p class="note">${md(s.note)}</p>` : ''}
    ${s.url ? `<p class="url">${md(s.url)}</p>` : ''}${s.how ? `<p class="how">${md(s.how)}</p>` : ''}`;
  const head = `${s.title ? `<h1>${md(s.title)}</h1>` : ''}${s.meta ? `<p class="meta">${md(s.meta)}</p>` : ''}`;
  const body = s.imgFirst ? head + img(s.img) + text : head + text + img(s.img);
  const zones = guides && fmt === 'tt' ? `
    <div class="guide-zone" style="left:0;right:0;top:0;height:150px"></div>
    <div class="guide-zone" style="left:0;right:0;bottom:0;height:470px"></div>
    <div class="guide-zone" style="right:0;width:140px;top:700px;bottom:470px"></div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="file://${HERE}template.css"></head>
<body class="${fmt} ${esc(s.layout || 'info')}">
  <div class="safe">
    <div class="mast"><b>Ontario Extern Tracker</b><span>${i + 1}/${n}</span></div>
    <div class="body">${body}</div>
    <p class="foot">${md(post.footer || `Checked ${post.verified_label} against each hospital's own posting. Not affiliated with any hospital.`)}</p>
  </div>${zones}
<script>
  // Mark the slide if any content spills out of the safe area or its own box.
  addEventListener('load', () => {
    const safe = document.querySelector('.safe').getBoundingClientRect();
    const bad = [...document.querySelectorAll('.safe *')].some(el => { const r = el.getBoundingClientRect();
      return r.bottom > safe.bottom + 1 || r.right > safe.right + 1 || el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible'; });
    if (bad) document.body.insertAdjacentHTML('beforeend', '<div class="overflow-flag">CONTENT OUTSIDE SAFE AREA: shorten copy</div>');
  });
</script></body></html>`;
}

function render(post) {
  const problems = checkFacts(post);
  if (problems.length) { console.error(`\n${post.id}: NOT RENDERED\n  - ${problems.join('\n  - ')}`); return false; }
  const out = guides ? `${HERE}out/_guides/${post.id}/` : `${HERE}out/${post.id}/`; // review renders never overwrite the real ones
  rmSync(out, { recursive: true, force: true });
  const profile = `${tmpdir()}/carousel-chrome-${process.pid}`;
  for (const [fmt, [w, h]] of Object.entries(FORMATS)) {
    mkdirSync(`${out}${fmt}`, { recursive: true });
    post.slides.forEach((slide, i) => {
      const nn = String(i + 1).padStart(2, '0');
      const htmlPath = `${out}${fmt}/${nn}.html`;
      writeFileSync(htmlPath, slideHtml(post, slide, i, post.slides.length, fmt));
      execFileSync(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars',
        '--force-device-scale-factor=1', `--window-size=${w},${h}`, '--virtual-time-budget=2000',
        `--screenshot=${out}${fmt}/${nn}.png`, `file://${htmlPath}`], { stdio: 'ignore' });
    });
  }
  rmSync(profile, { recursive: true, force: true });
  // Captions with the real host filled in, ready to paste.
  const cap = post.caption || {};
  writeFileSync(`${out}captions.txt`, Object.entries(cap).map(([k, v]) => `=== ${k} ===\n${String(v).replaceAll('{HOST}', SITE.host)}\n`).join('\n'));
  if (guides) { console.log(`${post.id}: review render with TikTok UI zones → out/_guides/${post.id}/ (do not post these)`); return true; }
  // Review sheet: both formats side by side.
  const imgs = fmt => readdirSync(`${out}${fmt}`).filter(f => f.endsWith('.png')).sort().map(f => `<img src="${fmt}/${f}">`).join('');
  writeFileSync(`${out}review.html`, `<!doctype html><meta charset="utf-8"><title>${esc(post.id)}</title>
<style>body{margin:24px;font:15px system-ui;background:#e9e6df}h2{margin:18px 0 8px}.r{display:flex;gap:12px;flex-wrap:wrap}.ig img{width:270px}.tt img{width:216px}img{border:1px solid #bbb;background:#fff}</style>
<h1>${esc(post.id)}: ${esc(post.message)}</h1><h2>Instagram 1080×1350</h2><div class="r ig">${imgs('ig')}</div><h2>TikTok 1080×1920</h2><div class="r tt">${imgs('tt')}</div>`);
  console.log(`${post.id}: ${post.slides.length} slides × 2 formats → marketing/carousel/out/${post.id}/ (facts checked against data ${data.dataset_checked})`);
  return true;
}

const files = readdirSync(`${HERE}posts`).filter(f => f.endsWith('.json')).sort();
const chosen = which === 'all' ? files : files.filter(f => f.startsWith(which));
if (!chosen.length) { console.error(`no post matching ${which}`); process.exit(1); }
let ok = true;
for (const f of chosen) ok = render(JSON.parse(readFileSync(`${HERE}posts/${f}`))) && ok;
process.exit(ok ? 0 : 1);
