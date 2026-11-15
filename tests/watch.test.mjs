// Watcher step 1 tests. No network: parsers run on saved official responses (tests/fixtures/watch),
// and diff() runs on the real data file with synthetic board results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWorkday, parseIcims, parseOracle, parseSmartRecruiters, pageExcerpt, isNursingExtern, diff, renderReport, checkSource, idIn, complete } from '../scripts/watch.mjs';

const fx = f => readFileSync(new URL(`./fixtures/watch/${f}`, import.meta.url), 'utf8');
// Frozen copy of data/hospitals.json as of 2026-11-12 (what these tests were written against), so later data
// fixes (e.g. Southlake closed on 2026-11-14) don't change what the watcher logic is tested on.
const data = JSON.parse(fx('hospitals-2026-11-12.json'));
const { sources } = JSON.parse(readFileSync(new URL('../watch/sources.json', import.meta.url), 'utf8'));
const S = id => sources.find(s => s.id === id);
const TODAY = '2026-11-12', NOW = '2026-11-12T15:00:00Z';

// ---------- Parsers on real (trimmed) responses ----------
test('Workday: Southlake extern posting matches the site link', () => {
  const ps = parseWorkday(JSON.parse(fx('workday-southlake.json')), S('southlake-workday').params);
  const ext = ps.find(p => p.title === 'Clinical Extern');
  assert.ok(ext); assert.equal(ext.key, 'Clinical-Extern_JR-102401');
  assert.ok(idIn(data.entries.find(e => e.id === 'southlake').source_url, ext));
});

test('iCIMS: Humber cards give id, title, posted time and a direct job URL', () => {
  const ps = parseIcims(fx('icims-humber.html'), S('humber-icims').params);
  assert.equal(ps.length, 3);
  assert.deepEqual(ps[0], { id: '24856', key: '/jobs/24856/', title: 'Student Nurse Extern - Critical Care 6 West', posted: '10/22/2026 11:59 AM', closes: null, url: 'https://careersen-hrrh.icims.com/jobs/24856/job' });
});

test('Oracle: Trillium requisition 6976 present and matches the site link', () => {
  const ps = parseOracle(JSON.parse(fx('oracle-thp.json')), S('thp-oracle').params);
  const q = ps.find(p => p.id === '6976');
  assert.ok(q && /Nursing/.test(q.title));
  assert.ok(idIn(data.entries.find(e => e.id === 'thp').source_url, q));
});

test('SmartRecruiters: postings parse; unexpected shapes throw instead of returning []', () => {
  assert.ok(parseSmartRecruiters(JSON.parse(fx('smartrecruiters-uhn.json')), { company: 'UniversityHealthNetwork' }).length > 0);
  for (const bad of [{}, { content: null }, null]) assert.throws(() => parseSmartRecruiters(bad, { company: 'x' }));
  assert.throws(() => parseWorkday({ error: 'x' }, { host: 'h', site: 's' }));
  assert.throws(() => parseIcims('<html>Radware captcha</html>', { host: 'h' }));
});

test('pageExcerpt keeps the sentences that matter and ignores scripts and timestamps', () => {
  const a = pageExcerpt(fx('program-page.html'));
  assert.ok(a.lines.some(l => /live from Jan\. 19, 2026 to Jan\. 25, 2026/.test(l)));
  assert.ok(a.lines.some(l => /halfway/.test(l)));
  assert.ok(!a.lines.some(l => /applications are open/.test(l)), 'script text must be dropped');
  const b = pageExcerpt(fx('program-page.html').replace('11:02:33', '23:59:59'));
  assert.equal(a.hash, b.hash, 'a footer timestamp change is not a page change');
  const c = pageExcerpt(fx('program-page.html').replace('Jan. 19, 2026 to Jan. 25, 2026', 'Jan. 18, 2027 to Jan. 24, 2027'));
  assert.notEqual(a.hash, c.hash);
  assert.equal(pageExcerpt('<html>' + 'x'.repeat(300) + ' Radware Captcha Page </html>').blocked, true);
});

test('nursing filter', () => {
  for (const t of ['Clinical Extern - Nursing (RN, RPN, IEN)', 'Student Nurse Extern - 7th Floor', 'Clinical & Research Extern (Hybrid)', 'HELP Externs', 'Clinical Extern'])
    assert.equal(isNursingExtern(t), true, t);
  for (const t of ['Clinical Extern - Allied Health (OT, PT, RT, Paramedic)', 'Respiratory Therapist Extern - Respiratory Therapy (BIR)', 'Clinical Extern Educator', 'Registered Nurse - 7th Floor'])
    assert.equal(isNursingExtern(t), false, t);
});

// ---------- Diff ----------
const humberAsOnSite = () => data.entries.find(e => e.id === 'humber').postings.map(q => {
  const id = q.url.match(/\/jobs\/(\d+)\//)[1];
  return { id, key: `/jobs/${id}/`, title: `Student Nurse Extern - ${q.label}`, posted: null, closes: null, url: q.url };
});
const run = (srcIds, results, prev = null) => diff({ sources: srcIds.map(S), results, prev, data, today: TODAY, now: NOW });

test('board matching the site exactly → "no differences", nothing to review', () => {
  const { items } = run(['humber-icims'], { 'humber-icims': { status: 'ok', postings: humberAsOnSite() } });
  assert.equal(items.newOnBoard.length + items.goneFromBoard.length + items.changed.length, 0);
  assert.equal(items.unchanged.length, 1);
});

test('new posting on a board → flagged for review; a missing one → flagged as not on the board', () => {
  const ps = humberAsOnSite();
  const missing = ps.pop();
  ps.push({ id: '99999', key: '/jobs/99999/', title: 'Student Nurse Extern - 5th Floor', posted: '11/12/2026', closes: null, url: 'https://careersen-hrrh.icims.com/jobs/99999/job' });
  const { items } = run(['humber-icims'], { 'humber-icims': { status: 'ok', postings: ps } });
  assert.deepEqual(items.newOnBoard.map(i => i.q.id), ['99999']);
  assert.deepEqual(items.goneFromBoard.map(i => i.url), [missing.url]);
  assert.equal(items.unchanged.length, 0);
});

test('an unreadable board is NOT CHECKED: never unchanged, never "removed", old snapshot carried forward', () => {
  const prev = { sources: { 'southlake-workday': { checked: '2026-11-10T12:00:00Z', postings: [{ id: '/job/x/Clinical-Extern_JR-102401', key: 'Clinical-Extern_JR-102401', title: 'Clinical Extern', url: 'https://southlake.wd10.myworkdayjobs.com/en-US/Southlake/job/x/Clinical-Extern_JR-102401' }] } } };
  const { items, snap } = run(['southlake-workday'], { 'southlake-workday': { status: 'error', reason: 'HTTP 403' } }, prev);
  assert.equal(items.notChecked.length, 1);
  assert.equal(items.notChecked[0].lastOk, '2026-11-10T12:00:00Z');
  assert.equal(items.unchanged.length, 0);
  assert.equal(items.goneFromBoard.length, 0);
  assert.equal(snap.sources['southlake-workday'].checked, '2026-11-10T12:00:00Z');
  const md = renderReport({ items, now: NOW, today: TODAY });
  assert.match(md, /NOT CHECKED: could not read the board this run \(1\)[\s\S]*\*\*Southlake Health\*\* \(workday\): HTTP 403/);
  assert.doesNotMatch(md.split('## Read successfully')[1], /Southlake/);
});

test('an "ok" but empty board where we list open postings is treated as not checked (layout change / block)', () => {
  const { items } = run(['southlake-workday'], { 'southlake-workday': { status: 'ok', postings: [] } });
  assert.equal(items.notChecked.length, 1);
  assert.match(items.notChecked[0].reason, /no extern postings/);
  assert.equal(items.goneFromBoard.length, 0);
});

test('a board for a hospital we now list as closed may be empty: checked, no differences, not flagged', () => {
  const closed = structuredClone(data);
  Object.assign(closed.entries.find((e) => e.id === 'southlake'), { posting_type: 'closed', deadline: null, positions_listed: null });
  const { items } = diff({ sources: [S('southlake-workday')], results: { 'southlake-workday': { status: 'ok', postings: [] } }, prev: null, data: closed, today: TODAY, now: NOW });
  assert.equal(items.notChecked.length, 0);
  assert.equal(items.goneFromBoard.length, 0);
  assert.equal(items.unchanged.length, 1);
});

test('manual boards are always listed as not checked, with our entries\' verification dates', () => {
  const { items } = run(['nygh-njoyn', 'mgh-njoyn'], { 'nygh-njoyn': { status: 'manual', reason: 'bot' }, 'mgh-njoyn': { status: 'manual', reason: 'bot' } });
  assert.equal(items.manual.length, 2);
  assert.equal(items.unchanged.length, 0);
  assert.match(items.manual[1].verified.join(' '), /mgh-help 2026-11-1\d/);
  assert.match(renderReport({ items, now: NOW, today: TODAY }), /2 board\(s\) NOT checked automatically/);
});

test('field changes since the last snapshot are reported', () => {
  const ps = humberAsOnSite();
  const prev = { sources: { 'humber-icims': { checked: 'x', postings: ps.map(q => ({ ...q })) } } };
  const now = ps.map(q => ({ ...q })); now[0].closes = '2026-12-01';
  const { items } = run(['humber-icims'], { 'humber-icims': { status: 'ok', postings: now } }, prev);
  assert.deepEqual(items.changed.map(c => [c.field, c.to]), [['closes', '2026-12-01']]);
});

test('page change shows added/removed sentences; first run is a baseline, not a change', () => {
  const a = pageExcerpt(fx('program-page.html'));
  const first = run(['sickkids-page'], { 'sickkids-page': { status: 'ok', page: a } });
  assert.equal(first.items.pageChanged.length, 0);
  assert.equal(first.items.unchanged[0].baseline, true);
  const c = pageExcerpt(fx('program-page.html').replace('Jan. 19, 2026 to Jan. 25, 2026', 'Jan. 18, 2027 to Jan. 24, 2027'));
  const { items } = run(['sickkids-page'], { 'sickkids-page': { status: 'ok', page: c } }, first.snap);
  assert.equal(items.pageChanged.length, 1);
  assert.ok(items.pageChanged[0].added.some(l => /2027/.test(l)));
  assert.ok(items.pageChanged[0].removed.some(l => /Jan\. 19, 2026/.test(l)));
});

test('checkSource: network errors and bot pages become "error", never "ok"', async () => {
  const boom = async () => { throw new Error('ECONNRESET'); };
  assert.equal((await checkSource(S('humber-icims'), boom)).status, 'error');
  const wall = async () => '<html><body>' + 'x'.repeat(300) + ' Radware Captcha Page </body></html>';
  assert.equal((await checkSource(S('cheo-page'), wall)).status, 'error');
  assert.equal((await checkSource(S('thp-oracle'), async () => 'not json')).status, 'error');
  assert.equal((await checkSource(S('nygh-njoyn'), boom)).status, 'manual');
});

test('a partially read board is not checked; Workday and SmartRecruiters page through all results', async () => {
  assert.equal(complete([{}, {}], 62).status, 'error');
  assert.equal(complete([{}, {}], 2).status, 'ok');
  const one = (i) => ({ title: i ? `Other job ${i}` : 'Clinical Extern', externalPath: `/job/x/Job_JR-${i}`, postedOn: 'Posted Today' });
  const pages = { 0: { total: 25, jobPostings: Array.from({ length: 20 }, (_, i) => one(i)) }, 20: { jobPostings: Array.from({ length: 5 }, (_, i) => one(20 + i)) } };
  const wd = async (url, opts) => JSON.stringify(pages[JSON.parse(opts.body).offset]);
  const r = await checkSource(S('southlake-workday'), wd);
  assert.equal(r.status, 'ok'); assert.equal(r.postings.length, 25);
  const stuck = async () => JSON.stringify({ total: 25, jobPostings: [] });
  assert.equal((await checkSource(S('southlake-workday'), stuck)).status, 'error');
  const sr = async url => JSON.stringify(new URL(url).searchParams.get('offset') === '0'
    ? { totalFound: 150, content: Array.from({ length: 100 }, (_, i) => ({ id: i, name: 'x' })) }
    : { totalFound: 150, content: [] });
  assert.match((await checkSource(S('uhn-smartrecruiters'), sr)).reason, /150 results but only 100/);
});

test('a page that lost its marker phrase (moved / redesigned) is not checked', async () => {
  const page = fx('program-page.html');
  assert.equal(pageExcerpt(page, 'Clinical Extern').marker, true);
  const r = await checkSource({ ...S('sickkids-page'), params: { ...S('sickkids-page').params, expect: 'Clinical Extern' } }, async () => page.replace(/Clinical Extern/g, 'Student Programs'));
  assert.equal(r.status, 'error'); assert.match(r.reason, /not found/);
  for (const src of sources.filter(s => s.adapter === 'page')) assert.ok(src.params.expect, `${src.id} needs an expect marker`);
});

test('every tracked data entry is covered by at least one watch source (automatic or manual)', () => {
  const covered = new Set(sources.flatMap(s => s.entries));
  assert.deepEqual(data.entries.map(e => e.id).filter(id => !covered.has(id)), []);
});
