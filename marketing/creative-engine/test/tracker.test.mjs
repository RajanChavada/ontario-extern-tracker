// Tracker bridge: facts for job postings come from data/hospitals.json + saved official captures.
// Fixtures: test/fixtures/tracker/hospitals.json (wch, shn as of Nov 14, 2026) and
// test/fixtures/tracker/evidence/*.txt (lines copied verbatim from the Nov 14 captures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEvidence, makeIndex, parseCapture, normalizeUrl } from '../src/tracker/evidence.js';
import { compileCampaign, entryFacts, jobIdFromUrl, sameJob, describeProgram } from '../src/tracker/bridge.js';
import { factualCheck } from '../bin/oet.mjs';

const FIX = new URL('./fixtures/tracker/', import.meta.url);
const DATA = JSON.parse(readFileSync(new URL('hospitals.json', FIX)));
const EVIDENCE_DIR = fileURLToPath(new URL('evidence/', FIX));
const TODAY = '2026-11-14';
const byId = Object.fromEntries(DATA.entries.map((e) => [e.id, e]));
const ev = loadEvidence([EVIDENCE_DIR]);
const codes = (list) => list.map((e) => e.code);

// a capture built in the test, for the failure cases
const cap = (url, date, body, time = '09:00') => parseCapture(`URL: ${url}\nCAPTURED: ${date} ${time} EST (browser)\n\n${body}`, `fixture-${date}-${time}.txt`);
const FILLER = 'This is the full text of the hospital posting page as captured, long enough to count as a readable page. '.repeat(4);
const kestrel = (over = {}) => ({
  id: 'kestrel', hospital: 'Kestrel Bay Hospital', program_name: 'Clinical Extern', posting_type: 'open_vacancies', positions_listed: 5,
  deadline: '2026-11-20', pay_text: '$21.50/hr', source_url: 'https://kestrel.wd3.myworkdayjobs.com/en-US/Kestrel/job/Clinical-Extern_JR-1234',
  source_kind: 'posting', source_ok: true, last_verified: '2026-11-13',
  eligibility: { listed: true, programs: { BSCN: { minYear: 2, maxYear: 4 } }, bcls: null, also_listed: [] }, ...over,
});
const KESTREL_OK = `Clinical Extern\nPosting Closing Date: November 20, 2026\nNumber of Positions: 5\nHourly rate: $21.50\nBScN students in 2nd, 3rd or 4th year\n${FILLER}`;

// ---------------------------------------------------------------- IDs and URLs
test('job IDs are read from each applicant-tracking system the tracker links', () => {
  assert.deepEqual(jobIdFromUrl('https://southlake.wd10.myworkdayjobs.com/en-US/Southlake/job/Clinical-Extern_JR-102401'), { ats: 'workday', id: 'JR-102401' });
  assert.deepEqual(jobIdFromUrl('https://shn.wd10.myworkdayjobs.com/en-US/SHN_External_Career_Site/job/Clinical-Nurse-Extern--Talent-Pool--2026-_JR105532'), { ats: 'workday', id: 'JR105532' });
  assert.deepEqual(jobIdFromUrl('https://employment-mackenziehealth.icims.com/jobs/18701/2026-18701/job'), { ats: 'icims', id: '18701' });
  assert.deepEqual(jobIdFromUrl('https://tehn.njoyn.com/CL3/xweb/xweb.asp?clid=55587&Page=JobDetails&Jobid=J1026-1085&BRID=366273&lang=1'), { ats: 'njoyn', id: 'J1026-1085' });
  assert.deepEqual(jobIdFromUrl('https://jobs.dayforcehcm.com/en-US/wch/CANDIDATEPORTAL/jobs/3892'), { ats: 'dayforce', id: '3892' });
  assert.deepEqual(jobIdFromUrl('https://iadyup.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_4001/job/6976/'), { ats: 'oracle', id: '6976' });
  assert.deepEqual(jobIdFromUrl('https://jobs.smartrecruiters.com/haltonhealthcare1/3743990012431576'), { ats: 'smartrecruiters', id: '3743990012431576' });
  assert.deepEqual(jobIdFromUrl('https://sunnybrook.talcura.com/Candidates/m/ShowJob.aspx?JobId=14354'), { ats: 'talcura', id: '14354' });
  assert.equal(jobIdFromUrl('https://www.sickkids.ca/en/learning/student-centre/nursing-learners/nursing-clinical-extern-program/'), null);
  assert.equal(jobIdFromUrl('https://careersen-hrrh.icims.com/jobs/search?ss=1&searchKeyword=extern'), null);
});

test('a job number printed on the page must name the same job as the URL', () => {
  assert.equal(sameJob('2026-24856', '24856'), true);   // iCIMS prints a year prefix
  assert.equal(sameJob('JR105532', 'JR105532'), true);
  assert.equal(sameJob('JR-102401', 'JR102401'), true);
  assert.equal(sameJob('2026-24857', '24856'), false);
  assert.equal(sameJob('J1026', 'J1026-1085'), false);
  assert.equal(sameJob('12324856', '24856'), false);    // only a 4-digit year may precede the ID
});

test('captures are matched to the tracker URL regardless of iframe/tracking parameters, newest first', () => {
  assert.equal(normalizeUrl('https://Employment-MackenzieHealth.icims.com/jobs/18701/2026-18701/job/?in_iframe=1&utm_source=x'), 'https://employment-mackenziehealth.icims.com/jobs/18701/2026-18701/job');
  assert.equal(ev.size, 2);
  assert.equal(ev.forUrl(byId.wch.source_url)[0].capturedAt, '2026-11-14');
  const idx = makeIndex([cap('https://x.example/jobs/1', '2026-11-10', 'a'), cap('https://x.example/jobs/1', '2026-11-12', 'b'), cap('https://x.example/jobs/1', '2026-11-12', 'c', '18:30')]);
  assert.deepEqual(idx.forUrl('https://x.example/jobs/1/').map((c) => c.text), ['c', 'b', 'a']);
  assert.equal(parseCapture('just some notes\nno header'), null);
});

// ---------------------------------------------------------------- the real Women's College and SHN postings
test("Women's College: every fact comes from the tracker value plus a verbatim line of the Nov 14 capture", () => {
  const r = entryFacts(byId.wch, ev, { today: TODAY });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  const base = { org: "Women's College Hospital", role: 'Clinical Extern - Professional Practice', status: 'open', sources: ['wch-posting'], verifiedAt: '2026-11-14' };
  assert.deepEqual(r.facts, [
    { id: 'wch-deadline', kind: 'deadline', date: '2026-11-20', claim: "Women's College Hospital's Clinical Extern - Professional Practice posting closes Nov 20, 2026.", ...base, quote: 'Posted Friday, November 6, 2026 at 12:00 AM | Expires Friday, November 20, 2026 at 11:59 PM' },
    { id: 'wch-pay', kind: 'pay', value: '$20.60/hr', claim: "Women's College Hospital lists $20.60/hr for its Clinical Extern - Professional Practice posting.", ...base, quote: 'Hourly Rate: $20.60' },
    { id: 'wch-eligibility', kind: 'eligibility', value: 'BScN (year not specified on the posting)', claim: "Women's College Hospital's posting lists: BScN (year not specified on the posting).", ...base, quote: 'Enrolled in an accredited degree (Bachelor of Science in Nursing)' },
    { id: 'wch-bcls', kind: 'eligibility', value: 'BCLS required', claim: "Women's College Hospital's posting requires Basic Cardiac Life Support (BCLS).", ...base, quote: 'Completion of Basic Cardiac Life Support (B.C.L.S.) required.' },
    { id: 'wch-listed-1', kind: 'other', value: 'Up to 7.5 hours per week', claim: "Women's College Hospital's posting lists: Up to 7.5 hours per week.", ...base, quote: 'Maximum of 7.5 hours per week' },
  ]);
  assert.deepEqual(r.sources, [{ id: 'wch-posting', publisher: "Women's College Hospital", title: 'Clinical Extern - Professional Practice (job 3892)', url: 'https://jobs.dayforcehcm.com/en-US/wch/CANDIDATEPORTAL/jobs/3892', accessedAt: '2026-11-14', primary: true }]);
  // the posting doesn't say vacancy vs pool (open_unspecified), so no vacancy fact exists to cite
  assert.equal(r.facts.some((f) => f.kind === 'vacancy'), false);
});

test("SHN: talent pool wording is the posting's own explanation, years are written so the quote supports them", () => {
  const r = entryFacts(byId.shn, ev, { today: TODAY });
  assert.deepEqual(r.errors, []);
  const f = Object.fromEntries(r.facts.map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(f), ['shn-deadline', 'shn-pay', 'shn-vacancy', 'shn-eligibility', 'shn-bcls', 'shn-listed-1']);
  assert.equal(f['shn-deadline'].quote, 'End Date: November 30, 2026 (15 days left to apply)');
  assert.equal(f['shn-vacancy'].status, 'talent-pool');
  assert.equal(f['shn-vacancy'].value, 'talent pool, not a current vacancy');
  assert.equal(f['shn-vacancy'].quote, 'This posting is being used to establish a candidate pool for upcoming vacancies and does not reflect a specific vacant position.');
  assert.equal(f['shn-eligibility'].value, 'BScN, year three or final year');
  assert.equal(f['shn-pay'].quote, 'Minimum - Maximum Hourly Rate: $25.379 - $25.379');
});

test('program rules are described in words, matching what postings print', () => {
  assert.equal(describeProgram('BSCN', { minYear: 2, maxYear: 4 }), 'BScN, years two to four');
  assert.equal(describeProgram('BSCN', { minYear: 3, maxYear: 4, finalYearOk: true }), 'BScN, year three or final year');
  assert.equal(describeProgram('PN', { finalYearOnly: true, semantics: 'entering' }), 'PN, entering final year');
  assert.equal(describeProgram('BSCN', { anyYear: true }), 'BScN, any year');
});

// ---------------------------------------------------------------- unknown or contradictory = not publishable
test('a posting whose newest capture says it is gone is withheld, even though the data says open (Southlake, Nov 14)', () => {
  const e = kestrel();
  const idx = makeIndex([cap(e.source_url, '2026-11-11', KESTREL_OK), cap(e.source_url, '2026-11-14', "Skip to main content\nThe page you are looking for doesn't exist.\nSearch for Jobs")]);
  const r = entryFacts(e, idx, { today: TODAY });
  assert.deepEqual(codes(r.errors), ['CAPTURE_SAYS_REMOVED']);
  assert.deepEqual(r.facts, []);
  assert.deepEqual(r.sources, []);
});

test('a block page is not evidence: the bridge falls back to the newest readable capture and dates facts by it', () => {
  const e = kestrel();
  const blocked = 'Njoyn - Unauthorized Request Blocked\nVous voyez cette page parce que nous avons détecté une activité non autorisée.';
  const r = entryFacts(e, makeIndex([cap(e.source_url, '2026-11-13', KESTREL_OK), cap(e.source_url, '2026-11-14', blocked)]), { today: TODAY });
  assert.deepEqual(codes(r.errors), []);
  assert.deepEqual(codes(r.warnings), ['NEWEST_CAPTURE_UNREADABLE']);
  assert.deepEqual([...new Set(r.facts.map((f) => f.verifiedAt))], ['2026-11-13']);
  const only = entryFacts(e, makeIndex([cap(e.source_url, '2026-11-14', blocked)]), { today: TODAY });
  assert.deepEqual(codes(only.errors), ['CAPTURE_UNREADABLE']);
});

test('a closing date that differs from the posting is a conflict, not a fact', () => {
  const e = kestrel();
  const r = entryFacts(e, makeIndex([cap(e.source_url, '2026-11-14', KESTREL_OK.replace('November 20, 2026', 'November 30, 2026'))]), { today: TODAY });
  assert.deepEqual(codes(r.errors), ['DEADLINE_CONFLICT']);
  assert.match(r.errors[0].message, /tracker says Nov 20, 2026, but the capture's closing line says November 30, 2026/);
  assert.deepEqual(r.facts, []);
});

test('pay, positions and eligibility must each appear in the capture exactly as the tracker shows them', () => {
  const e = kestrel();
  const run = (text) => codes(entryFacts(e, makeIndex([cap(e.source_url, '2026-11-14', text)]), { today: TODAY }).errors);
  assert.deepEqual(run(KESTREL_OK), []);
  assert.deepEqual(run(KESTREL_OK.replace('$21.50', '$21.00')), ['PAY_NOT_IN_CAPTURE']);
  assert.deepEqual(run(KESTREL_OK.replace('Number of Positions: 5', 'Number of Positions: 3')), ['VACANCY_NOT_IN_CAPTURE']);
  assert.deepEqual(run(KESTREL_OK.replace('2nd, 3rd or 4th year', '3rd or 4th year')), ['ELIGIBILITY_NOT_IN_CAPTURE']);
  assert.deepEqual(run(KESTREL_OK.replace('Number of Positions: 5', 'Job Number: JR-9999\nNumber of Positions: 5')), ['JOB_ID_CONFLICT']);
});

test('a posting that does not mention BCLS gets no BCLS fact (absence is never shown as "not required")', () => {
  const e = kestrel();
  const r = entryFacts(e, makeIndex([cap(e.source_url, '2026-11-14', KESTREL_OK)]), { today: TODAY });
  assert.deepEqual(r.facts.map((f) => f.id), ['kestrel-deadline', 'kestrel-pay', 'kestrel-vacancy', 'kestrel-eligibility']);
  assert.equal(r.facts.find((f) => f.id === 'kestrel-vacancy').value, '5 positions listed');
  assert.equal(entryFacts(kestrel({ positions_listed: 1 }), makeIndex([cap(kestrel().source_url, '2026-11-14', KESTREL_OK.replace('Positions: 5', 'Positions: 1'))]), { today: TODAY }).facts.find((f) => f.kind === 'vacancy').value, '1 position listed');
});

test('only entries the site shows as open today can be promoted; missing evidence is an error', () => {
  const idx = makeIndex([cap(kestrel().source_url, '2026-11-14', KESTREL_OK)]);
  assert.deepEqual(codes(entryFacts(kestrel({ posting_type: 'closed' }), idx, { today: TODAY }).errors), ['ENTRY_NOT_OPEN']);
  assert.deepEqual(codes(entryFacts(kestrel({ last_verified: '2026-11-01' }), idx, { today: TODAY }).errors), ['ENTRY_NOT_OPEN']); // stale → Unconfirmed on the site
  assert.deepEqual(codes(entryFacts(kestrel({ deadline: '2026-11-13' }), idx, { today: TODAY }).errors), ['ENTRY_NOT_OPEN']);   // closing date passed
  assert.deepEqual(codes(entryFacts(kestrel(), makeIndex([]), { today: TODAY }).errors), ['NO_CAPTURE']);
});

// ---------------------------------------------------------------- campaigns
const campaign = (over = {}) => ({
  id: 'wch-test', title: 'WCH test', status: 'verified', theme: 'wine', tracker: { entries: ['wch'] },
  slides: [
    { layout: 'hook', variant: 'plain', title: 'one posting closes nov 20', facts: ['wch-deadline'] },
    { layout: 'deadline', fact: 'wch-deadline', details: [{ label: 'Pay', fact: 'wch-pay' }] },
    { layout: 'cta', action: 'save', title: 'save this' },
  ],
  caption: { text: "Women's College closes Nov 20 ($20.60/hr as posted).", hashtags: ['#NursingStudent'] },
  ...over,
});

test('a campaign compiles to an engine spec holding only the facts its slides cite', () => {
  const c = compileCampaign(campaign(), { data: DATA, evidence: ev, today: TODAY });
  assert.deepEqual(c.errors, []);
  assert.equal('tracker' in c.spec, false);
  assert.deepEqual(c.spec.facts.map((f) => f.id), ['wch-deadline', 'wch-pay']);
  assert.deepEqual(c.spec.sources.map((s) => s.url), ['https://jobs.dayforcehcm.com/en-US/wch/CANDIDATEPORTAL/jobs/3892']);
  assert.equal(c.provenance['wch-pay'].capturedAt, '2026-11-14');
});

test('posting facts typed into a spec are refused; unknown entries and unavailable values are errors', () => {
  const typed = { id: 'wch-deadline-typed', kind: 'deadline', claim: 'x', org: "Women's College Hospital", role: 'x', date: '2026-11-20', sources: ['s'], verifiedAt: TODAY };
  assert.deepEqual(codes(compileCampaign(campaign({ facts: [typed] }), { data: DATA, evidence: ev, today: TODAY }).errors), ['HAND_WRITTEN_JOB_FACT']);
  assert.deepEqual(codes(compileCampaign(campaign({ tracker: { entries: ['nope'] } }), { data: DATA, evidence: ev, today: TODAY }).errors), ['UNKNOWN_ENTRY']);
  const vac = campaign({ slides: [...campaign().slides.slice(0, 2), { layout: 'text_stack', lines: ['how many spots?'], facts: ['wch-vacancy'] }, campaign().slides[2]] });
  assert.deepEqual(codes(compileCampaign(vac, { data: DATA, evidence: ev, today: TODAY }).errors), ['FACT_NOT_AVAILABLE']);
});

test('general educational carousels (no tracker block) pass through unchanged', () => {
  const edu = JSON.parse(readFileSync(new URL('../specs/examples/explainer-what-is-an-extern.json', import.meta.url)));
  const c = compileCampaign(edu, { data: DATA, evidence: ev, today: TODAY });
  assert.deepEqual(c.errors, []);
  assert.deepEqual(c.spec, edu);
});

test('factual check runs without a browser and includes the engine fact rules (caption numbers must be cited)', () => {
  const tmp = new URL('./fixtures/tracker/_campaign.tmp.json', import.meta.url);
  const write = (obj) => { writeFileSync(tmp, JSON.stringify(obj)); return fileURLToPath(tmp); };
  try {
    const ok = factualCheck(write(campaign()), { dataFile: fileURLToPath(new URL('hospitals.json', FIX)), evidenceDirs: [EVIDENCE_DIR], today: TODAY });
    assert.equal(ok.factual.passed, true);
    const bad = factualCheck(write(campaign({ caption: { text: 'Pays $22.00/hr.', hashtags: [] } })), { dataFile: fileURLToPath(new URL('hospitals.json', FIX)), evidenceDirs: [EVIDENCE_DIR], today: TODAY });
    assert.equal(bad.factual.passed, false);
    assert.deepEqual(codes(bad.factual.errors), ['UNSUPPORTED_SPECIFIC']);
    const late = factualCheck(write(campaign()), { dataFile: fileURLToPath(new URL('hospitals.json', FIX)), evidenceDirs: [EVIDENCE_DIR], today: '2026-11-21' });
    assert.deepEqual(codes(late.factual.errors), ['ENTRY_NOT_OPEN']); // after Nov 20 the site shows it closed
  } finally { rmSync(tmp, { force: true }); }
});

