// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ontarioToday, daysBetween, isIsoDate, status, deadlineInfo, eligibility,
  icsForDeadline, validateData, sortEntries, foldIcsLine, googleCalendarUrl, countHospitals } from '../assets/logic.js';
import { execFileSync } from 'node:child_process';

const data = JSON.parse(readFileSync(new URL('../data/hospitals.json', import.meta.url)));
const byId = Object.fromEntries(data.entries.map(e => [e.id, e]));
// Southlake's entry as verified on Nov 11, 2026 (open, 40 positions, end date Nov 30). The posting was removed on Nov 14;
// the generic status/calendar/eligibility tests keep using this frozen copy as their 'open with a closing date' example.
const SOUTHLAKE_NOV11 = {"id": "southlake", "hospital": "Southlake Health", "region": "gta", "location": "Newmarket", "program_name": "Clinical Extern", "posting_type": "open_vacancies", "positions_listed": 40, "deadline": "2026-11-30", "pay_text": "$21.80/hr", "source_url": "https://southlake.wd10.myworkdayjobs.com/en-US/Southlake/job/Clinical-Extern_JR-102401", "source_kind": "posting", "source_ok": true, "last_verified": "2026-11-11", "eligibility": {"listed": true, "programs": {"BSCN": {"minYear": 2, "maxYear": 4}, "PN": {"finalYearOnly": true}}, "bcls": null, "also_listed": ["Recent acute care experience (preferred)"]}};
const fx = { ...byId, southlake: SOUTHLAKE_NOV11 };
const fresh = (e, verified) => ({ ...e, last_verified: verified });

// ---------- Ontario dates (hand-computed reference values) ----------
test('ontarioToday uses the America/Toronto calendar date, not UTC', () => {
  assert.equal(ontarioToday(new Date('2026-11-10T04:30:00Z')), '2026-11-09'); // 23:30 EST
  assert.equal(ontarioToday(new Date('2026-11-10T05:00:00Z')), '2026-11-10'); // 00:00 EST
  assert.equal(ontarioToday(new Date('2026-11-01T03:59:00Z')), '2026-10-31'); // 23:59 EDT
  assert.equal(ontarioToday(new Date('2026-11-01T05:30:00Z')), '2026-11-01'); // 01:30 EDT, DST ends at 06:00Z
  assert.equal(ontarioToday(new Date('2026-07-01T03:59:00Z')), '2026-06-30'); // EDT, UTC-4
  assert.equal(ontarioToday(new Date('2026-07-01T04:00:00Z')), '2026-07-01');
});

test('daysBetween counts calendar days across month, year, leap and DST changes', () => {
  assert.equal(daysBetween('2026-11-09', '2026-11-30'), 21);
  assert.equal(daysBetween('2026-11-30', '2026-11-30'), 0);
  assert.equal(daysBetween('2026-12-01', '2026-11-30'), -1);
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
  assert.equal(daysBetween('2027-02-28', '2027-03-01'), 1);
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2); // leap year
  assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2); // across DST end
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2); // across DST start
});

test('isIsoDate rejects impossible dates', () => {
  assert.ok(isIsoDate('2026-11-30'));
  assert.ok(!isIsoDate('2026-11-31'));
  assert.ok(!isIsoDate('2026-02-29'));
  assert.ok(isIsoDate('2028-02-29'));
  assert.ok(!isIsoDate('Nov 30'));
});

// ---------- Deadline display ----------
test('deadlineInfo: boundaries, and no invented closing time', () => {
  const s = fx.southlake;
  assert.equal(deadlineInfo(s, '2026-11-09').daysAway, 21);
  assert.equal(deadlineInfo(s, '2026-11-09').when, 'in 21 days');
  assert.equal(deadlineInfo(s, '2026-11-29').when, 'tomorrow');
  assert.equal(deadlineInfo(s, '2026-11-30').when, 'today');
  assert.equal(deadlineInfo(s, '2026-12-01').when, 'passed');
  assert.equal(deadlineInfo(s, '2026-11-09').note, 'Closing time not published');
  assert.equal(deadlineInfo(byId.mackenzie, '2026-11-09'), null);
});

// ---------- Status ----------
test('status on the verification day keeps vacancy, pool and window distinct', () => {
  const t = '2026-11-09';
  assert.equal(status(fx.southlake, t).key, 'open_vacancies');
  assert.match(status(fx.southlake, t).detail, /40 positions listed/);
  assert.equal(status(byId.shn, t).key, 'open_talent_pool');
  assert.equal(status(byId.mackenzie, t).key, 'open_talent_pool');
  assert.equal(status(byId.sunnybrook, t).key, 'open_unspecified');
  assert.equal(status(byId.cheo, t).key, 'typical_window');
  assert.match(status(byId.cheo, t).detail, /not a guaranteed opening/);
  assert.equal(status(byId.thp, t).key, 'open_unspecified'); // live posting since Nov 10 data update
  assert.equal(status(byId.mgh, t).key, 'open_vacancies');
  assert.match(status(byId.mgh, t).detail, /^1 position listed/); // singular
  assert.match(status(fx.southlake, t).detail, /^40 positions listed/);
  assert.equal(status(byId.lhsc, t).key, 'check_employer');
  assert.equal(status(byId.uhn, t).key, 'closed');
  assert.equal(status(byId.osler, t).key, 'closed');
  assert.equal(status(byId.hhs, t).key, 'unconfirmed');
});

test('status: deadline day is still open; the day after is closed', () => {
  const s = fresh(fx.southlake, '2026-11-28');
  assert.equal(status(s, '2026-11-30').key, 'open_vacancies');
  assert.equal(status(s, '2026-12-01').key, 'closed');
});

// Staleness tests are relative to the verification date, so they keep passing after each data refresh.
const plusDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

test('status: 7 days after verification is still current; 8 days is unconfirmed', () => {
  const v = fx.southlake.last_verified;
  assert.equal(status(fx.southlake, plusDays(v, 7)).key, 'open_vacancies');
  const st = status(fx.southlake, plusDays(v, 8));
  assert.equal(st.key, 'unconfirmed');
  assert.match(st.detail, /8 days/);
});

test('status: every entry is unconfirmed once stale, so no stale "Open" can show', () => {
  for (const e of data.entries) assert.equal(status(e, plusDays(e.last_verified, 8)).key, 'unconfirmed', e.id);
});

test('status: open needs an https posting link that was reachable', () => {
  const t = '2026-11-09';
  assert.equal(status({ ...fx.southlake, source_url: '' }, t).key, 'unconfirmed');
  assert.equal(status({ ...fx.southlake, source_url: 'http://x.example' }, t).key, 'unconfirmed');
  assert.equal(status({ ...fx.southlake, source_ok: false }, t).key, 'unconfirmed');
  assert.equal(status({ ...fx.southlake, source_kind: 'program_page' }, t).key, 'unconfirmed');
  assert.equal(status({ ...fx.southlake, last_verified: 'yesterday' }, t).key, 'unconfirmed');
  assert.equal(status({ ...fx.southlake, posting_type: 'made_up' }, t).key, 'unconfirmed');
});

test('sortEntries: open first (positions, then unstated, then talent pools), nearest deadline first; closed last', () => {
  const ids = sortEntries(data.entries, '2026-11-10').map(e => e.id);
  // positions listed (dated first), then live postings by nearest deadline then name, then talent pools (shn has a closing date)
  assert.deepEqual(ids.slice(0, 4).sort(), ['humber', 'mgh', 'mgh-help', 'mgh-hro']); // vacancies stated, no date
  assert.deepEqual(ids.slice(4, 9), ['wch', 'sunnybrook', 'thp', 'shn', 'mackenzie']);
  assert.ok(ids.indexOf('southlake') > ids.indexOf('hhs'));                       // removed before its end date (Nov 14)
  assert.ok(ids.indexOf('nygh') > ids.indexOf('hhs'));                            // removed before its closing date (Nov 12)
  assert.ok(ids.indexOf('mackenzie') < ids.indexOf('cheo'));
  assert.ok(ids.indexOf('cheo') < ids.indexOf('lhsc'));
  assert.ok(ids.indexOf('hhs') < ids.indexOf('uhn'));
  assert.deepEqual(ids.slice(-4).sort(), ['nygh', 'osler', 'southlake', 'uhn']);  // closed entries last
});

// ---------- Eligibility (wording: "Meets listed criteria", never "eligible") ----------
const P = (program, year, extra = {}) => ({ program, year, finalYear: false, bcls: '', ...extra });

test('Southlake: BScN years 2–4, or final-year PN; BCLS not listed', () => {
  const s = fx.southlake;
  assert.equal(eligibility(s, P('BSCN', 2)).verdict, 'meets');
  assert.equal(eligibility(s, P('BSCN', 4)).verdict, 'meets');
  assert.equal(eligibility(s, P('BSCN', 1)).verdict, 'not_met');
  assert.equal(eligibility(s, P('PN', 2, { finalYear: true })).verdict, 'meets');
  assert.equal(eligibility(s, P('PN', 1)).verdict, 'not_met');
  assert.equal(eligibility(s, P('IEN', null)).verdict, 'check');
  assert.equal(eligibility(s, P('BSCN', 2, { bcls: 'no' })).verdict, 'meets'); // BCLS not on this posting
  assert.equal(eligibility(s, P('BSCN', 2)).label, 'Meets listed criteria');
});

test('SHN: BScN year 3 or final year, and current BCLS', () => {
  const s = byId.shn;
  assert.equal(eligibility(s, P('BSCN', 3, { bcls: 'yes' })).verdict, 'meets');
  assert.equal(eligibility(s, P('BSCN', 3, { bcls: 'no' })).verdict, 'not_met');
  assert.equal(eligibility(s, P('BSCN', 3, { bcls: 'unsure' })).verdict, 'check');
  assert.equal(eligibility(s, P('BSCN', 2, { bcls: 'yes' })).verdict, 'not_met');
  assert.equal(eligibility(s, P('PN', 2, { finalYear: true, bcls: 'yes' })).verdict, 'not_met');
});

test('Mackenzie: "entering" years never give a hard match; returns check', () => {
  const m = byId.mackenzie;
  assert.equal(eligibility(m, P('BSCN', 1, { bcls: 'yes' })).verdict, 'check');
  assert.equal(eligibility(m, P('BSCN', 3, { bcls: 'yes' })).verdict, 'check');
  assert.equal(eligibility(m, P('PN', 1, { bcls: 'yes' })).verdict, 'check');
  assert.equal(eligibility(m, P('PN', 1, { finalYear: true, bcls: 'yes' })).verdict, 'meets');
  assert.equal(eligibility(m, P('BSCN', 3, { bcls: 'no' })).verdict, 'not_met');
});

test('THP (live posting, Nov 10): any year BScN/PN; IENs listed', () => {
  const t = byId.thp;
  assert.equal(eligibility(t, P('BSCN', 4)).verdict, 'meets');
  assert.equal(eligibility(t, P('BSCN', 1)).verdict, 'meets');
  assert.equal(eligibility(t, P('PN', 1)).verdict, 'meets');
  assert.equal(eligibility(t, P('IEN', null)).verdict, 'meets');
});

test('new Nov 10 entries: NYGH, WCH, MGH, Humber criteria', () => {
  assert.equal(eligibility(byId.nygh, P('BSCN', 2, { bcls: 'yes' })).verdict, 'meets');
  assert.equal(eligibility(byId.nygh, P('BSCN', 2, { bcls: 'no' })).verdict, 'not_met'); // BCLS required
  assert.equal(eligibility(byId.nygh, P('PN', 1)).verdict, 'not_met');          // final-year PN only
  assert.equal(eligibility(byId.wch, P('BSCN', 1, { bcls: 'yes' })).verdict, 'meets');
  assert.equal(eligibility(byId.wch, P('PN', 2, { bcls: 'yes' })).verdict, 'not_met');   // BScN only
  assert.equal(eligibility(byId.mgh, P('BSCN', 1)).verdict, 'not_met');
  assert.equal(eligibility(byId.mgh, P('IEN', null)).verdict, 'check');
  assert.equal(eligibility(byId.humber, P('BSCN', 3)).verdict, 'meets');
  assert.equal(eligibility(byId.humber, P('PN', 2)).verdict, 'check');          // program type not named
  assert.equal(byId.humber.postings.length, 10);
  assert.equal(status(byId.humber, '2026-11-12').key, 'open_vacancies');       // each posting: 'existing vacancy'
  assert.equal(byId.humber.positions_listed, undefined);                         // no count is stated, so none is invented
  assert.doesNotMatch(status(byId.humber, '2026-11-12').detail, /vacancy or a pool/);
  assert.equal(new Set(byId.humber.postings.map(q => q.url)).size, 10);          // ten distinct job ids
  assert.equal(eligibility(byId['mgh-help'], P('BSCN', 2)).verdict, 'check');    // "entering" wording
  assert.equal(eligibility(byId['mgh-hro'], P('BSCN', 1)).verdict, 'not_met');
  assert.match(status(byId['mgh-help'], '2026-11-11').detail, /^4 positions listed/);
  assert.equal(status(byId.nygh, '2026-11-12').key, 'closed');                   // hospital removed the posting early
  assert.equal(byId.nygh.deadline, null);                                         // so no calendar file or countdown is offered
});

test('postings list: 2+ distinct postings, https, same official host', () => {
  const base = { ...byId.sunnybrook, id: 'x', source_url: 'https://careersen-hrrh.icims.com/jobs/search?ss=1&searchKeyword=extern' };
  const ok = { ...base, postings: [{ label: 'A', url: 'https://careersen-hrrh.icims.com/jobs/1/job' }, { label: 'B', url: 'https://careersen-hrrh.icims.com/jobs/2/job' }] };
  assert.deepEqual(validateData({ entries: [ok] }), []);
  const probs = validateData({ entries: [
    { ...base, id: 'one', postings: [{ label: 'A', url: 'https://careersen-hrrh.icims.com/jobs/1/job' }] },
    { ...base, id: 'agg', postings: [{ label: 'A', url: 'https://careersen-hrrh.icims.com/jobs/1/job' }, { label: 'B', url: 'https://www.indeed.com/viewjob?jk=1' }] },
    { ...base, id: 'http', postings: [{ label: 'A', url: 'http://careersen-hrrh.icims.com/jobs/1/job' }, { label: 'B', url: 'https://careersen-hrrh.icims.com/jobs/2/job' }] },
  ] }).join('\n');
  assert.match(probs, /one: postings must list 2 or more/);
  assert.match(probs, /agg: posting url not on the official host/);
  assert.match(probs, /http: posting url must be https/);
});

test('a certification the posting does not mention is flagged, never treated as not required', () => {
  const txt = r => r.items.map(i => i.text).join(' | ');
  for (const id of ['thp', 'southlake', 'mgh-hro']) {
    assert.match(txt(eligibility(fx[id], P('BSCN', 3, { bcls: 'no' }))), /isn't mentioned on the posting/, id);
    assert.match(txt(eligibility(fx[id], null)), /isn't mentioned on the posting/, id);
  }
  for (const id of ['shn', 'nygh', 'humber', 'mgh-help']) // BCLS required, or CPR/BLS listed
    assert.doesNotMatch(txt(eligibility(byId[id], P('BSCN', 3))), /isn't mentioned/, id);
});

test('CHEO and LHSC per-program years', () => {
  assert.equal(eligibility(byId.cheo, P('BSCN', 3)).verdict, 'meets');
  assert.equal(eligibility(byId.cheo, P('BSCN', 2)).verdict, 'not_met');
  assert.equal(eligibility(byId.cheo, P('PN', 2)).verdict, 'meets');
  assert.equal(eligibility(byId.lhsc, P('PN', 2)).verdict, 'meets');
  assert.equal(eligibility(byId.lhsc, P('PN', 1)).verdict, 'not_met');
  assert.equal(eligibility(byId.lhsc, P('BSCN', 2)).verdict, 'not_met');
});

test('Unconfirmed criteria always return check, and an incomplete profile asks for input', () => {
  assert.equal(eligibility(byId.hhs, P('BSCN', 3)).verdict, 'check');
  assert.equal(eligibility(byId.osler, P('BSCN', 3)).verdict, 'check');
  assert.equal(eligibility(fx.southlake, P('', null)).verdict, 'incomplete');
  assert.equal(eligibility(fx.southlake, P('BSCN', null)).verdict, 'incomplete');
  assert.equal(eligibility(byId.sickkids, P('BSCN', 3)).verdict, 'check'); // "halfway through" can't be mapped to a year
});

// ---------- Calendar export ----------
test('ics: all-day event on the closing date, no invented time, CRLF line endings', () => {
  const ics = icsForDeadline(fx.southlake, new Date('2026-11-09T12:00:00Z'));
  assert.match(ics, /DTSTART;VALUE=DATE:20261130\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261201\r\n/);
  assert.doesNotMatch(ics, /DTSTART:\d{8}T/);
  assert.match(ics.replace(/\r\n /g, ''), /Closing time not published/); // unfold before matching (lines are folded per RFC 5545)
  assert.match(ics, /TRIGGER:-P3D/);
  assert.ok(ics.split('\r\n').every(l => !l.includes('\n')));
  assert.equal(icsForDeadline(byId.mackenzie), null);
  const ye = icsForDeadline({ ...fx.southlake, deadline: '2026-12-31' });
  assert.match(ye, /DTEND;VALUE=DATE:20270101/);
});

// ---------- Data file ----------
test('data file passes validation', () => {
  assert.deepEqual(validateData(data), []);
  assert.equal(data.entries.length, 17);
  assert.equal(countHospitals(data.entries), 15); // Michael Garron has 3 listings
});

test('validation catches the mistakes the rules forbid', () => {
  const bad = { entries: [
    { ...fx.southlake, id: 'a', source_kind: 'program_page' },
    { ...byId.cheo, id: 'b', positions_listed: 10 },
    { ...byId.shn, id: 'c', deadline: '2026-11-31' },
  ] };
  const probs = validateData(bad).join(' | ');
  assert.match(probs, /a: open status needs a posting/);
  assert.match(probs, /b: positions_listed only allowed/);
  assert.match(probs, /c: bad deadline date/);
});

// ---------- Added in the v0.2 redesign ----------
test('ics: every physical line is at most 75 octets, and unfolding restores the content', () => {
  const ics = icsForDeadline(byId.shn);
  const enc = new TextEncoder();
  for (const line of ics.split('\r\n')) assert.ok(enc.encode(line).length <= 75, `too long: ${line}`);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /URL:https:\/\/shn\.wd10\.myworkdayjobs\.com\/en-US\/SHN_External_Career_Site\/job\/Clinical-Nurse-Extern--Talent-Pool--2026-_JR105532\r\n/);
  assert.match(unfolded, /SUMMARY:Closing date: Scarborough Health Network – Clinical Nurse Extern \(talent pool\)\r\n/);
  const long = 'DESCRIPTION:' + 'é'.repeat(80); // multi-byte characters are never split
  assert.ok(foldIcsLine(long).split('\r\n').every(l => enc.encode(l).length <= 75));
  assert.equal(foldIcsLine(long).replace(/\r\n /g, ''), long);
});

test('ics: generated files are reproducible (DTSTAMP from the verification date)', () => {
  assert.equal(icsForDeadline(fx.southlake), icsForDeadline(fx.southlake));
  assert.match(icsForDeadline(fx.southlake), new RegExp(`DTSTAMP:${fx.southlake.last_verified.replace(/-/g, '')}T120000Z`));
});

test('Google Calendar link: an all-day event with an exclusive end date and no time', () => {
  const u = new URL(googleCalendarUrl(fx.southlake));
  assert.equal(u.hostname, 'calendar.google.com');
  assert.equal(u.searchParams.get('dates'), '20261130/20261201');
  assert.doesNotMatch(u.searchParams.get('dates'), /T/);
  assert.match(u.searchParams.get('details'), /Closing time not published/);
  assert.equal(googleCalendarUrl(byId.mackenzie), null);
});

test('static cal/*.ics files match the data (run scripts/build-ics.mjs after any data change)', () => {
  execFileSync(process.execPath, [new URL('../scripts/build-ics.mjs', import.meta.url).pathname]);
  for (const e of data.entries) {
    let file = null;
    try { file = readFileSync(new URL(`../cal/${e.id}.ics`, import.meta.url), 'utf8'); } catch {}
    if (e.deadline) assert.equal(file, icsForDeadline(e), e.id); else assert.equal(file, null, e.id);
  }
});

// Builds in tests must not inherit Cloudflare's build variables (CF_PAGES, UMAMI_WEBSITE_ID, ...),
// otherwise the suite behaves differently on Cloudflare than locally.
const BUILD_VARS = ['CF_PAGES', 'CF_PAGES_BRANCH', 'CF_PAGES_URL', 'CF_PAGES_COMMIT_SHA', 'UMAMI_WEBSITE_ID', 'GSC_VERIFICATION', 'ET_TODAY'];
const cleanEnv = (extra = {}) => { const e = { ...process.env }; for (const k of BUILD_VARS) delete e[k]; return { ...e, ...extra }; };

test('production build: allow-listed files only, no internal note, canonical + sitemap use final URLs', () => {
  const root = new URL('../', import.meta.url).pathname;
  // Build into a temporary folder so running the tests never overwrites a real dist/.
  const out = mkdtempSync(join(tmpdir(), 'et-dist-'));
  execFileSync(process.execPath, [root + 'scripts/build-dist.mjs', '--out', out, '--allow-stale'], { stdio: 'pipe', env: cleanEnv() });
  const rd = f => readFileSync(join(out, f), 'utf8');
  const site = JSON.parse(readFileSync(root + 'site.json', 'utf8')).origin;
  assert.equal(site, 'https://ontarioexterns.ca');
  const pub = JSON.parse(rd('data/hospitals.json'));
  assert.equal(pub.note, undefined);
  assert.equal(pub.entries.length, data.entries.length);
  const html = rd('index.html');
  assert.match(html, /<link rel="canonical" href="https:\/\/ontarioexterns\.ca\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/ontarioexterns\.ca\/">/);
  assert.match(rd('what-is-a-clinical-extern-ontario.html'), /<link rel="canonical" href="https:\/\/ontarioexterns\.ca\/what-is-a-clinical-extern-ontario">/);
  assert.doesNotMatch(html, /JobPosting|data-website-id|pages\.dev/); // no structured job data; no analytics without an id
  assert.match(rd('sitemap.xml'), /<loc>https:\/\/ontarioexterns\.ca\/what-is-a-clinical-extern-ontario<\/loc>/);
  assert.match(rd('robots.txt'), /^Sitemap: https:\/\/ontarioexterns\.ca\/sitemap\.xml$/m);
  assert.match(rd('_headers'), /^https:\/\/:project\.pages\.dev\/\*\n  X-Robots-Tag: noindex$/m);
  const cfg = rd('assets/config.js');
  assert.match(cfg, /DEBUG: false/);
  assert.match(cfg, /UMAMI_DOMAINS: "ontarioexterns\.ca,www\.ontarioexterns\.ca"/);
  const redirects = rd('_redirects');
  assert.match(redirects, /^\/t1 \/\?utm_source=tiktok&utm_medium=social&utm_campaign=extern-nov26&utm_content=p1-deadlines 302$/m);
  assert.match(redirects, /^\/T1 /m);
  assert.match(redirects, /^\/i1 \/\?utm_source=instagram&/m);
  // With an analytics id, the tag is locked to the real domain.
  execFileSync(process.execPath, [root + 'scripts/build-dist.mjs', '--out', out, '--allow-stale', '--umami-id', '00000000-0000-4000-8000-000000000000'], { stdio: 'pipe', env: cleanEnv() });
  assert.match(rd('index.html'), /data-website-id="00000000-0000-4000-8000-000000000000" data-domains="ontarioexterns\.ca,www\.ontarioexterns\.ca" data-do-not-track="true"/);
  // Cloudflare preview branch: analytics forced off even if the variable is set.
  execFileSync(process.execPath, [root + 'scripts/build-dist.mjs', '--out', out, '--allow-stale'], { stdio: 'pipe',
    env: cleanEnv({ CF_PAGES: '1', CF_PAGES_BRANCH: 'preview/test', UMAMI_WEBSITE_ID: '00000000-0000-4000-8000-000000000000' }) });
  assert.doesNotMatch(rd('index.html'), /data-website-id/);
  // Cloudflare production: the id comes from the environment.
  execFileSync(process.execPath, [root + 'scripts/build-dist.mjs', '--out', out, '--allow-stale'], { stdio: 'pipe',
    env: cleanEnv({ CF_PAGES: '1', CF_PAGES_BRANCH: 'main', UMAMI_WEBSITE_ID: '00000000-0000-4000-8000-000000000000' }) });
  assert.match(rd('index.html'), /data-website-id="00000000-0000-4000-8000-000000000000"/);
  rmSync(out, { recursive: true, force: true });
});

test('production build fails on stale data (blocks the deploy)', () => {
  const root = new URL('../', import.meta.url).pathname;
  const out = mkdtempSync(join(tmpdir(), 'et-dist-'));
  // Pretend today is 10 days after the last check.
  const v = data.dataset_checked; const [y, m, d] = v.split('-').map(Number);
  const later = new Date(Date.UTC(y, m - 1, d + 10)).toISOString().slice(0, 10);
  let failed = false;
  try { execFileSync(process.execPath, [root + 'scripts/build-dist.mjs', '--out', out], { stdio: 'pipe', env: cleanEnv({ CF_PAGES: '1', CF_PAGES_BRANCH: 'main', ET_TODAY: later }) }); }
  catch (e) { failed = true; assert.match(String(e.stderr), /BUILD FAILED: data last checked/); }
  assert.ok(failed, 'build should fail');
  rmSync(out, { recursive: true, force: true });
});

test('data: postings removed before their closing date are closed, with no date, countdown or calendar file', () => {
  for (const [id, checked] of [['nygh', '2026-11-12'], ['southlake', '2026-11-14']]) {
    assert.equal(status(byId[id], '2026-11-14').key, 'closed', id);
    assert.equal(byId[id].deadline, null, id);
    assert.equal(byId[id].last_verified, checked, id);
  }
  assert.equal(byId.southlake.positions_listed, undefined);   // no vacancy count shown for a removed posting
});
