// Tracker bridge: hospital-job facts for carousels come from the Extern Tracker's
// data file (data/hospitals.json) and from saved captures of each hospital's own
// posting. Nothing about a specific posting is typed into a carousel spec.
//
// For every tracker entry a campaign names, the bridge:
//   1. checks the entry is shown as open on the site today (same status logic as the site);
//   2. finds the newest saved capture of the entry's official URL;
//   3. checks the job ID, and that the capture doesn't say the posting is gone;
//   4. finds a verbatim line in the capture for each value it will put on a slide
//      (closing date, pay, vacancy wording, eligibility, BCLS, other listed items);
//   5. emits engine facts whose verifiedAt is the capture date (not the data's date).
// Any missing, contradictory or unreadable evidence is an error: the entry's facts are
// withheld and the campaign is not publishable. This is the factual check only; layout
// and legibility are checked later by the renderer's visual QA.

import { status as siteStatus } from '../../../../assets/logic.js';
import { textHasDate, longDate } from '../util/dates.js';
import { normalizeUrl } from './evidence.js';

export const JOB_KINDS = new Set(['deadline', 'pay', 'eligibility', 'vacancy']);

// ---------------------------------------------------------------- job IDs
const ID_PATTERNS = [
  ['workday', /myworkdayjobs\.com\/.*_(JR-?\d+)(?:[/?#-]|$)/i],
  ['icims', /\.icims\.com\/jobs\/(\d+)(?:\/|$)/i],
  ['njoyn', /njoyn\.com\/.*[?&]Jobid=([A-Z]\d{4}-\d{4})/i],
  ['dayforce', /dayforcehcm\.com\/.*\/jobs\/(\d+)(?:[/?#]|$)/i],
  ['oracle', /oraclecloud\.com\/.*\/job\/(\d+)(?:[/?#]|$)/i],
  ['smartrecruiters', /smartrecruiters\.com\/[^/]+\/(\d{6,})(?:[-/?#]|$)/i],
  ['taleo', /taleo\.net\/.*[?&]job=(\d+)/i],
  ['talcura', /talcura\.com\/.*[?&]JobId=(\d+)/i],
];

/** Does a job number printed on the page name the same job as the URL? iCIMS prints "2026-24856" for job 24856. */
export function sameJob(printed, fromUrl) {
  const a = String(printed).toUpperCase().replace(/-/g, '');
  const b = String(fromUrl).toUpperCase().replace(/-/g, '');
  return a === b || (a.endsWith(b) && /^(?:19|20)\d{2}$/.test(a.slice(0, a.length - b.length)));
}

/** { ats, id } for a posting URL, or null when the URL names no specific posting. */
export function jobIdFromUrl(url) {
  for (const [ats, re] of ID_PATTERNS) {
    const m = String(url).match(re);
    if (m) return { ats, id: m[1].toUpperCase() };
  }
  return null;
}

// ---------------------------------------------------------------- reading captures
const REMOVED = /doesn['’]t exist|does not exist|no longer available|no longer accepting|job (?:has )?expired|posting (?:has )?(?:closed|expired)|position has been filled|this job is (?:closed|no longer)|job not found|page not found/i;
const CLOSING_KEY = /(?:closing date|close date|closes|closing|expires|expiry date|application deadline|deadline|apply by|posting end date|^end date)/gim;
const LABELLED_ID = /(?:job number|job id|job requisition id|requisition id)\s*:?\s*([A-Z]{0,3}\d*-?\d{3,})/i;
// Pages that show a block or challenge instead of the posting. They are not evidence of anything.
const BLOCKED = /unauthori[sz]ed request blocked|request blocked|captcha|unusual traffic|verify you are human|access denied|please wait\W/i;
const readable = (cap) => !BLOCKED.test(cap.text) && (REMOVED.test(cap.text) || cap.text.replace(/\s+/g, ' ').length >= 300);

const lines = (text) => text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
/** Single lines first, then each pair of consecutive lines (ATS pages often put "Label:" and its value on separate lines). */
const candidates = (text) => { const L = lines(text); return [...L, ...L.slice(1).map((l, i) => `${L[i]} ${l}`)]; };
const clip = (s, max = 300) => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…');
const numRe = (n) => new RegExp(`(?<![\\d.])${String(n).replace('.', '\\.')}(?![\\d])`);
const numbersIn = (s) => [...String(s).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ''));

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
const ORDINALS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const SUFFIX = { 1: 'st', 2: 'nd', 3: 'rd' };
/** Does the text mention study year n (2, 2nd, two, second)? */
const mentionsYear = (text, n) => new RegExp(`\\b(?:${n}(?:${SUFFIX[n] ?? 'th'})?|${WORDS[n]}|${ORDINALS[n]})\\b`, 'i').test(text);

const PROGRAM_WORDS = {
  BSCN: /\bBScN\b|\bBN\b|Bachelor of Science in Nursing|baccalaureate|nursing degree|degree program|Registered Nursing Program|\bRN\b program/i,
  PN: /practical nurs|\bR?PN\b|diploma/i,
  IEN: /internationally educated|\bIENs?\b/i,
};
const PROGRAM_LABEL = { BSCN: 'BScN', PN: 'PN', IEN: 'IEN' };

/** Display text for one program rule, with study years written as words so the
 *  engine's "numbers must appear in the quote" check can't be fooled by 3 vs "three". */
export function describeProgram(code, r) {
  const label = PROGRAM_LABEL[code] ?? code;
  if (r.check) return `${label}, check the posting`;
  if (r.anyYear) return `${label}${r.note ? ` (${r.note})` : ', any year'}`;
  const pre = r.semantics === 'entering' ? 'entering ' : '';
  if (r.finalYearOnly) return `${label}, ${pre}final year`;
  if (r.finalYearOk) return `${label}, ${pre}year ${WORDS[r.minYear]} or final year`;
  if (r.minYear === r.maxYear) return `${label}, ${pre}year ${WORDS[r.minYear]}`;
  return `${label}, ${pre}years ${WORDS[r.minYear]} to ${WORDS[r.maxYear]}`;
}

/** Eligibility for a slide value (schema: 80 chars) and the full wording for the claim. Long notes stay in the claim only. */
export function eligibilityText(programs) {
  const full = programs.map(([c, r]) => describeProgram(c, r)).join('; ');
  const short = programs.map(([c, r]) => describeProgram(c, { ...r, note: undefined })).join('; ');
  return { full, value: full.length <= 80 ? full : short.length <= 80 ? short : `${short.slice(0, 77)}...` };
}

/** What a capture line must show to support a program rule. */
function programSupported(line, code, r) {
  if (!PROGRAM_WORDS[code]?.test(line)) return false;
  if (r.check || r.anyYear) return true;
  if (r.finalYearOnly) return /final/i.test(line);
  if (!mentionsYear(line, r.minYear)) return false;
  if (r.finalYearOk) return /final/i.test(line) || mentionsYear(line, r.maxYear);
  return mentionsYear(line, r.maxYear);
}

// ---------------------------------------------------------------- per entry
/**
 * Facts and sources for one tracker entry.
 * Returns { facts, sources, errors, warnings, provenance }.
 */
export function entryFacts(entry, evidence, { today, staleAfterDays = 7 }) {
  const errors = [];
  const warnings = [];
  const err = (code, message, fix) => errors.push({ code, where: `tracker.${entry.id}`, message, ...(fix && { fix }) });
  const warn = (code, message) => warnings.push({ code, where: `tracker.${entry.id}`, message });
  const out = { facts: [], sources: [], errors, warnings, provenance: {} };

  // 1. the site itself must show it as open today
  const st = siteStatus(entry, today, staleAfterDays);
  if (st.group !== 0) {
    err('ENTRY_NOT_OPEN', `The tracker shows ${entry.hospital} as "${st.label ?? st.key}" on ${today}. Only postings the site shows as open can be promoted.`);
    return out;
  }
  if (entry.source_kind !== 'posting') { err('NOT_A_POSTING', `${entry.hospital}'s source is a ${entry.source_kind}, not a specific posting.`); return out; }

  // 2. job ID from the official URL
  // An entry links one posting (source_url), or a search page plus several postings (postings[]).
  const linked = (entry.postings ?? []).map((p) => p.url);
  const mainUrl = jobIdFromUrl(entry.source_url) || !linked.length ? entry.source_url : linked[0];
  const job = jobIdFromUrl(mainUrl);
  if (!job) { err('NO_JOB_ID', `Can't identify a job ID in ${mainUrl}.`); return out; }
  const postingUrls = [...new Set([mainUrl, ...linked])];
  const ids = postingUrls.map((u) => jobIdFromUrl(u)?.id ?? null);
  const dupes = ids.filter((x, i) => x && ids.indexOf(x) !== i);
  if (dupes.length) err('DUPLICATE_JOB_ID', `Job ID ${[...new Set(dupes)].join(', ')} is linked more than once.`);
  if (ids.some((x) => !x)) err('NO_JOB_ID', 'One of the linked postings has no job ID in its URL.');

  // 3. newest capture of every linked posting; none may say the posting is gone
  let main = null;
  for (const url of postingUrls) {
    const all = evidence.forUrl(url);
    const cap = all.find(readable);
    if (!all.length) { err('NO_CAPTURE', `No saved capture of ${url}.`, 'Open the posting, save its text with URL:/CAPTURED: header lines, and run again.'); continue; }
    if (!cap) { err('CAPTURE_UNREADABLE', `Every saved capture of ${url} is a block page or nearly empty (newest: ${short(all[0].file)}).`, 'Open the posting in a normal browser and save its text.'); continue; }
    if (cap !== all[0]) warn('NEWEST_CAPTURE_UNREADABLE', `The newest capture of ${url} (${all[0].capturedAt}, ${short(all[0].file)}) is a block page or nearly empty; using the readable one from ${cap.capturedAt}.`);
    if (url === mainUrl) main = cap;
    if (REMOVED.test(cap.text)) err('CAPTURE_SAYS_REMOVED', `The newest readable capture (${cap.capturedAt}, ${short(cap.file)}) says "${cap.text.match(REMOVED)[0]}", but the tracker shows the posting as open.`, 'Re-check the posting; if it is gone, fix data/hospitals.json first.');
    const labelled = cap.text.match(LABELLED_ID);
    const want = jobIdFromUrl(url)?.id;
    if (labelled && want && !sameJob(labelled[1], want)) err('JOB_ID_CONFLICT', `The capture's page shows job ${labelled[1]}, but the URL names job ${want}.`);
  }
  if (!main || errors.length) return out;
  if (main.capturedAt < entry.last_verified) warn('EVIDENCE_OLDER_THAN_DATA', `The newest capture is from ${main.capturedAt}, older than the tracker's last_verified ${entry.last_verified}. Facts are dated by the capture.`);
  if (main.capturedAt > today) { err('FUTURE_CAPTURE', `Capture date ${main.capturedAt} is after ${today}.`); return out; }

  const L = candidates(main.text);
  const verifiedAt = main.capturedAt;
  const sourceId = `${entry.id}-posting`;
  out.sources.push({ id: sourceId, publisher: entry.hospital, title: `${entry.program_name} (job ${job.id})`, url: mainUrl, accessedAt: verifiedAt, primary: true });
  const status = entry.posting_type === 'open_talent_pool' ? 'talent-pool' : 'open';
  const base = { org: entry.hospital, role: entry.program_name, status, sources: [sourceId], verifiedAt };
  const add = (fact, quoteLine) => {
    out.facts.push({ ...fact, ...base, quote: clip(quoteLine) });
    out.provenance[fact.id] = { entry: entry.id, capture: main.file, capturedAt: main.capturedAt, url: main.url };
  };

  // 4a. closing date: must be in the capture, and the capture must not name a different one
  if (entry.deadline) {
    const conflicting = new Set();
    for (const m of main.text.matchAll(CLOSING_KEY)) {
      const after = main.text.slice(m.index, m.index + m[0].length + 60);
      const found = after.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\b\d{4}-\d{2}-\d{2}\b/i);
      if (found && !textHasDate(found[0], entry.deadline)) conflicting.add(found[0]);
    }
    const line = L.find((l) => textHasDate(l, entry.deadline) && new RegExp(CLOSING_KEY.source, 'im').test(l));
    if (conflicting.size) err('DEADLINE_CONFLICT', `The tracker says ${longDate(entry.deadline)}, but the capture's closing line says ${[...conflicting].join(', ')}.`);
    else if (!line) err('DEADLINE_NOT_IN_CAPTURE', `The capture has no closing-date line for ${longDate(entry.deadline)}.`);
    else add({ id: `${entry.id}-deadline`, kind: 'deadline', date: entry.deadline, claim: `${entry.hospital}'s ${entry.program_name} posting closes ${longDate(entry.deadline)}.` }, line);
  }

  // 4b. pay, exactly as the tracker shows it
  if (entry.pay_text) {
    const nums = numbersIn(entry.pay_text);
    const line = nums.length && L.find((l) => l.includes('$') && nums.every((n) => numRe(n).test(l)));
    if (!line) err('PAY_NOT_IN_CAPTURE', `The capture has no pay line containing ${entry.pay_text}.`);
    else add({ id: `${entry.id}-pay`, kind: 'pay', value: entry.pay_text, claim: `${entry.hospital} lists ${entry.pay_text} for its ${entry.program_name} posting.` }, line);
  }

  // 4c. vacancy wording
  if (entry.posting_type === 'open_talent_pool') {
    // prefer the posting's own explanation over a title that merely says "Talent Pool"
    const line = L.find((l) => /not for an existing vacancy|does not reflect a specific vacant|candidate pool|future (?:vacancies|opportunities)/i.test(l))
      ?? L.find((l) => /talent pool/i.test(l));
    if (!line) err('VACANCY_NOT_IN_CAPTURE', 'The tracker says talent pool, but the capture has no talent-pool wording.');
    else add({ id: `${entry.id}-vacancy`, kind: 'vacancy', value: 'talent pool, not a current vacancy', claim: `${entry.hospital}'s posting builds a candidate pool and is not a specific vacant position.` }, line);
  } else if (entry.posting_type === 'open_vacancies') {
    const n = entry.positions_listed;
    const line = n != null
      ? L.find((l) => numRe(n).test(l) && /position|vacanc|opening/i.test(l))
      : L.find((l) => /existing vacancy|current vacancy|vacant position/i.test(l));
    if (!line) err('VACANCY_NOT_IN_CAPTURE', n != null ? `The capture has no line stating ${n} positions.` : 'The capture has no vacancy wording.');
    else add({ id: `${entry.id}-vacancy`, kind: 'vacancy', value: n != null ? `${n} position${n === 1 ? '' : 's'} listed` : 'posted for an existing vacancy', claim: n != null ? `${entry.hospital}'s posting lists ${n} position${n === 1 ? '' : 's'}.` : `${entry.hospital}'s posting says it is for an existing vacancy.` }, line);
  }
  // open_unspecified: the posting doesn't say, so no vacancy fact exists to cite.

  // 4d. eligibility: one quote per program rule
  const programs = Object.entries(entry.eligibility?.programs ?? {});
  if (programs.length) {
    const quotes = [];
    for (const [code, rule] of programs) {
      const line = L.find((l) => programSupported(l, code, rule));
      if (!line) err('ELIGIBILITY_NOT_IN_CAPTURE', `The capture has no line supporting "${describeProgram(code, rule)}".`);
      else if (!quotes.includes(line)) quotes.push(line);
    }
    if (quotes.length === programs.length || (quotes.length && !errors.some((e) => e.code === 'ELIGIBILITY_NOT_IN_CAPTURE'))) {
      const { full, value } = eligibilityText(programs);
      add({ id: `${entry.id}-eligibility`, kind: 'eligibility', value, claim: `${entry.hospital}'s posting lists: ${full}.` }, quotes.map((q) => clip(q, 190)).join(' … '));
    }
  }
  if (entry.eligibility?.bcls === true) {
    const line = L.find((l) => /\bB\.?C\.?L\.?S\.?\b|Basic Cardiac Life Support|\bBLS\b/i.test(l));
    if (!line) err('BCLS_NOT_IN_CAPTURE', 'The tracker says BCLS is required, but the capture has no BCLS line.');
    else add({ id: `${entry.id}-bcls`, kind: 'eligibility', value: 'BCLS required', claim: `${entry.hospital}'s posting requires Basic Cardiac Life Support (BCLS).` }, line);
  }
  // A posting that doesn't mention BCLS gets no fact: absence is never shown as "not required".

  // 4e. other listed items (e.g. weekly hours)
  (entry.eligibility?.also_listed ?? []).forEach((item, i) => {
    const text = item.replace(/\s*\(as posted\)\s*$/i, '');
    const nums = numbersIn(text);
    const words = (text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w));
    // the tracker words these items in its own language, so require most of the significant words (and every number)
    const covered = (l) => words.filter((w) => l.toLowerCase().includes(w)).length;
    const line = L.find((l) => nums.every((n) => numRe(n).test(l)) && words.length && covered(l) >= Math.ceil(words.length * 0.75));
    if (!line) warn('LISTED_ITEM_NOT_IN_CAPTURE', `"${item}" has no matching line in the capture; it can't be cited.`);
    else add({ id: `${entry.id}-listed-${i + 1}`, kind: 'other', value: text, claim: `${entry.hospital}'s posting lists: ${text}.` }, line);
  });

  if (errors.length) { out.facts = []; out.sources = []; out.provenance = {}; }
  return out;
}

const short = (f) => f.split('/').slice(-2).join('/');
const STOP = new Set(['with', 'that', 'this', 'from', 'your', 'have', 'will', 'must', 'their', 'they', 'about', 'only', 'posting', 'posted']);

// ---------------------------------------------------------------- campaigns
/**
 * Compile a campaign into an engine content spec.
 *
 * A campaign is an engine spec plus an optional  "tracker": { "entries": ["wch", …] }  block.
 * Without that block (general / educational carousels) the spec passes through unchanged.
 * Hand-written deadline, pay, eligibility or vacancy facts are refused either way: posting
 * facts live in data/hospitals.json and nowhere else.
 */
export function compileCampaign(campaign, { data, evidence, today }) {
  const errors = [];
  const warnings = [];
  const provenance = {};
  const { tracker, ...spec } = structuredClone(campaign);
  spec.facts ??= [];
  spec.sources ??= [];

  for (const f of spec.facts) {
    if (JOB_KINDS.has(f.kind) && spec.status !== 'demo')
      errors.push({ code: 'HAND_WRITTEN_JOB_FACT', where: `facts.${f.id}`, message: `"${f.id}" is a ${f.kind} fact typed into the spec. Posting facts must come from data/hospitals.json.`, fix: 'Add the hospital\'s entry id to "tracker.entries" and cite the generated fact id instead.' });
  }

  if (tracker) {
    const byId = new Map(data.entries.map((e) => [e.id, e]));
    for (const id of tracker.entries ?? []) {
      const entry = byId.get(id);
      if (!entry) { errors.push({ code: 'UNKNOWN_ENTRY', where: `tracker.${id}`, message: `No tracker entry "${id}" in data/hospitals.json.` }); continue; }
      const r = entryFacts(entry, evidence, { today, staleAfterDays: data.stale_after_days ?? 7 });
      errors.push(...r.errors);
      warnings.push(...r.warnings);
      spec.facts.push(...r.facts);
      spec.sources.push(...r.sources);
      Object.assign(provenance, r.provenance);
    }
    // facts the slides don't use are dropped, so the receipts slide lists only what's shown
    const used = usedFactIds(spec);
    spec.facts = spec.facts.filter((f) => used.has(f.id) || !provenance[f.id]);
    const cited = new Set(spec.facts.flatMap((f) => f.sources));
    spec.sources = spec.sources.filter((s) => cited.has(s.id) || !s.id.endsWith('-posting'));
    for (const id of used) if (!spec.facts.some((f) => f.id === id) && !errors.length)
      errors.push({ code: 'FACT_NOT_AVAILABLE', where: `facts.${id}`, message: `A slide cites "${id}", but the tracker data has no such value for that posting.` });
  }
  return { spec, errors, warnings, provenance };
}

function usedFactIds(spec) {
  const ids = new Set();
  for (const s of spec.slides) {
    (s.facts ?? []).forEach((f) => ids.add(f));
    if (s.layout === 'wristbands') s.items.forEach((i) => ids.add(i.fact));
    if (s.layout === 'deadline') { ids.add(s.fact); (s.details ?? []).forEach((d) => ids.add(d.fact)); }
    if (s.layout === 'versus') { ids.add(s.a.fact); ids.add(s.b.fact); }
  }
  if (spec.slides.some((s) => s.layout === 'hook' && s.variant === 'count')) spec.facts.filter((f) => f.kind === 'deadline').forEach((f) => ids.add(f.id));
  return ids;
}

export { normalizeUrl };
