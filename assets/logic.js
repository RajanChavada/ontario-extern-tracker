// Pure logic for the Ontario Extern Tracker. No DOM and no network.
// Shared by the browser (app.js) and the tests (tests/logic.test.mjs).

export const TZ = 'America/Toronto';

/** Today's calendar date in Ontario as YYYY-MM-DD. `now` is a Date (injectable for tests). */
export function ontarioToday(now = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Whole calendar days from date a to date b (both YYYY-MM-DD). b later gives a positive number. */
export function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  // Use a UTC date and format in UTC so the day can't shift
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export const STATUS = {
  open_vacancies:   { group: 0, label: 'Open · positions listed', tone: 'open' },
  open_unspecified: { group: 0, label: 'Open · posting live', tone: 'open' },
  open_talent_pool: { group: 0, label: 'Open · talent pool', tone: 'pool' },
  typical_window:   { group: 1, label: 'Not open now', tone: 'later' },
  check_employer:   { group: 2, label: 'No live posting linked', tone: 'check' },
  unconfirmed:      { group: 3, label: 'Unconfirmed', tone: 'unconfirmed' },
  closed:           { group: 4, label: 'Closed', tone: 'closed' },
};

const OPEN_TYPES = new Set(['open_vacancies', 'open_unspecified', 'open_talent_pool']);

/**
 * Display status for one entry on a given Ontario date.
 * Rules, in order:
 * 1. Missing or inaccessible source, or bad verification date: unconfirmed.
 * 2. Verified more than staleAfter days ago: unconfirmed. An open badge never shows on stale data.
 * 3. Deadline passed (today is after the deadline date): closed.
 * 4. Otherwise the stored posting_type.
 * Never "open" unless posting_type is open AND the source is a posting (not a program page).
 */
export function status(entry, today, staleAfter = 7) {
  const out = (key, detail) => ({ key, ...STATUS[key], detail });
  if (!entry.source_url || !/^https:\/\//.test(entry.source_url) || entry.source_ok === false) {
    return out('unconfirmed', 'No working official source link.');
  }
  if (!isIsoDate(entry.last_verified)) return out('unconfirmed', 'No valid verification date.');
  const age = daysBetween(entry.last_verified, today);
  if (age > staleAfter) {
    return out('unconfirmed', `We haven't re-checked this in ${age} days. Confirm on the hospital's page.`);
  }
  if (entry.deadline && isIsoDate(entry.deadline) && daysBetween(entry.deadline, today) > 0) {
    return out('closed', `Closing date (${formatDate(entry.deadline)}) has passed.`);
  }
  const t = entry.posting_type;
  if (!STATUS[t]) return out('unconfirmed', 'Unknown status in our data.');
  if (OPEN_TYPES.has(t) && entry.source_kind !== 'posting') {
    return out('unconfirmed', 'Marked open, but the linked source is not a job posting.');
  }
  if (t === 'unconfirmed') return out('unconfirmed', entry.unconfirmed_reason || 'Not confirmed on an official source.');
  if (t === 'open_vacancies') {
    return out(t, Number.isInteger(entry.positions_listed) ? `${entry.positions_listed} position${entry.positions_listed === 1 ? '' : 's'} listed on the posting.` : 'The posting lists openings.');
  }
  if (t === 'open_talent_pool') return out(t, entry.pool_note || 'Builds a pool for future openings. Not a current vacancy.');
  if (t === 'open_unspecified') return out(t, (entry.posted_text ? entry.posted_text + '. ' : '') + "The posting doesn't say whether it's a vacancy or a pool.");
  return out(t, entry.window_text || '');
}

/** Closing-date line. Returns null when there's no deadline. Never invents a time of day. */
export function deadlineInfo(entry, today) {
  if (!entry.deadline || !isIsoDate(entry.deadline)) return null;
  const n = daysBetween(today, entry.deadline);
  let when;
  if (n < 0) when = 'passed';
  else if (n === 0) when = 'today';
  else if (n === 1) when = 'tomorrow';
  else when = `in ${n} days`;
  return { date: entry.deadline, pretty: formatDate(entry.deadline), daysAway: n, when, note: 'Closing time not published' };
}

/**
 * Compare a student's profile with the requirements the employer lists.
 * profile: { program: 'BSCN'|'PN'|'IEN'|'', year: 1..4|null, finalYear: bool, bcls: 'yes'|'no'|'unsure'|'' }
 * Returns { verdict: 'meets'|'check'|'not_met'|'incomplete', label, items: [{text, state}] }
 * state: 'ok' | 'no' | 'check' | 'info'
 */
export const PROGRAM_NAMES = { BSCN: 'BScN/BN', PN: 'Practical Nursing (PN/diploma)', IEN: 'IEN' };

export function eligibility(entry, profile) {
  const LABEL = { meets: 'Meets listed criteria', check: 'Check with employer', not_met: "Doesn't meet listed criteria", incomplete: 'Pick your program and year' };
  const e = entry.eligibility || { listed: false };
  const items = [];
  if (!e.listed) {
    items.push({ text: "We couldn't confirm the criteria from an official source", state: 'check' });
    return { verdict: 'check', label: LABEL.check, items };
  }
  if (!profile || !profile.program || (profile.program !== 'IEN' && !profile.year && !profile.finalYear)) {
    for (const [k, r] of Object.entries(e.programs)) items.push({ text: `${PROGRAM_NAMES[k]}: ${describeRule(r)}`, state: 'info' });
    if (e.bcls === true) items.push({ text: 'Current BCLS required', state: 'info' });
    for (const a of e.also_listed || []) items.push({ text: a, state: 'info' });
    return { verdict: 'incomplete', label: LABEL.incomplete, items };
  }
  const states = [];
  const rule = e.programs[profile.program];
  if (!rule) {
    const listedFor = Object.keys(e.programs).map(k => PROGRAM_NAMES[k]).join(', ');
    if (profile.program === 'IEN') {
      items.push({ text: `IENs aren't mentioned (listed: ${listedFor})`, state: 'check' });
      states.push('check');
    } else {
      items.push({ text: `Listed for ${listedFor} only`, state: 'no' });
      states.push('not_met');
    }
  } else {
    const r = checkYear(rule, profile);
    items.push({ text: `${PROGRAM_NAMES[profile.program]}: ${describeRule(rule)}`, state: r === 'meets' ? 'ok' : r === 'check' ? 'check' : 'no' });
    states.push(r);
  }
  if (e.bcls === true) {
    const s = profile.bcls === 'yes' ? 'meets' : profile.bcls === 'no' ? 'not_met' : 'check';
    items.push({ text: 'Current BCLS required', state: s === 'meets' ? 'ok' : s === 'check' ? 'check' : 'no' });
    states.push(s);
  }
  for (const a of e.also_listed || []) items.push({ text: `${a} (check yourself)`, state: 'info' });
  const verdict = states.includes('not_met') ? 'not_met' : states.includes('check') ? 'check' : 'meets';
  return { verdict, label: LABEL[verdict], items };
}

function checkYear(rule, p) {
  if (rule.check) return 'check';
  if (rule.anyYear) return 'meets';
  if (rule.finalYearOnly) {
    if (rule.semantics === 'entering') return p.finalYear ? 'meets' : 'check';
    return p.finalYear ? 'meets' : 'not_met';
  }
  const y = p.year;
  const inRange = y != null && y >= rule.minYear && y <= rule.maxYear;
  if (rule.semantics === 'entering') {
    // "Entering year N" depends on how the employer counts the current year, so never claim a hard match.
    if (inRange || (y != null && y === rule.minYear - 1)) return 'check';
    if (rule.finalYearOk && p.finalYear) return 'check';
    return 'not_met';
  }
  if (inRange) return 'meets';
  if (rule.finalYearOk && p.finalYear) return 'meets';
  return 'not_met';
}

export function describeRule(r) {
  if (r.check) return r.note || 'criteria unclear, check the posting';
  if (r.anyYear) return 'any year' + (r.note ? ` (${r.note})` : '');
  const pre = r.semantics === 'entering' ? 'entering ' : '';
  if (r.finalYearOnly) return `${pre}final year only`;
  const yrs = r.minYear === r.maxYear ? `year ${r.minYear}` : `years ${r.minYear}–${r.maxYear}`;
  return `${pre}${yrs}${r.finalYearOk ? ' or final year' : ''}${r.note ? ` (${r.note})` : ''}`;
}

/** Sort: status group, then nearest deadline, then name. */
// Within open listings: stated positions first, then live postings that don't say, then talent pools.
const OPEN_RANK = { open_vacancies: 0, open_unspecified: 1, open_talent_pool: 2 };

export function sortEntries(entries, today) {
  return [...entries].sort((a, b) => {
    const sa = status(a, today), sb = status(b, today);
    if (sa.group !== sb.group) return sa.group - sb.group;
    const ra = OPEN_RANK[sa.key] ?? 9, rb = OPEN_RANK[sb.key] ?? 9;
    if (ra !== rb) return ra - rb;
    const da = a.deadline || '9999-12-31', db = b.deadline || '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    return a.hospital.localeCompare(b.hospital);
  });
}

/** RFC 5545 §3.1: fold content lines longer than 75 octets (CRLF + one space), without splitting multi-byte characters. */
export function foldIcsLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '', curBytes = 0, limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      // Don't split an escape like "\," across lines: some lenient parsers mishandle it.
      let carry = '';
      if (cur.endsWith('\\')) { carry = '\\'; cur = cur.slice(0, -1); }
      parts.push(cur); cur = carry; curBytes = carry.length; limit = 74; // continuation lines start with a space
    }
    cur += ch; curBytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/** All-day iCalendar event on the closing date, with no invented time and a reminder 3 days before.
 *  DTSTAMP defaults to the entry's verification date, so generated files are reproducible. */
export function icsForDeadline(entry, nowUtc = null) {
  if (!entry.deadline || !isIsoDate(entry.deadline)) return null;
  const d = entry.deadline.replace(/-/g, '');
  const [y, m, dd] = entry.deadline.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, dd + 1));
  const d2 = next.toISOString().slice(0, 10).replace(/-/g, '');
  const stampDate = nowUtc || new Date(`${isIsoDate(entry.last_verified) ? entry.last_verified : '2026-01-01'}T12:00:00Z`);
  const stamp = stampDate.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ontario Extern Tracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${entry.id}-${d}@extern-tracker.local`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d}`,
    `DTEND;VALUE=DATE:${d2}`,
    `SUMMARY:${esc(`Closing date: ${entry.hospital} – ${entry.program_name}`)}`,
    `DESCRIPTION:${esc(`Closing date listed on the posting. Closing time not published, so apply early. Official posting: ${entry.source_url}`)}`,
    `URL:${entry.source_url}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P3D', `DESCRIPTION:${esc(`${entry.hospital} extern closes in 3 days`)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/** Google Calendar "add event" link for an all-day event on the closing date (end date is exclusive). */
export function googleCalendarUrl(entry) {
  if (!entry.deadline || !isIsoDate(entry.deadline)) return null;
  const [y, m, dd] = entry.deadline.split('-').map(Number);
  const d1 = entry.deadline.replace(/-/g, '');
  const d2 = new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10).replace(/-/g, '');
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Closing date: ${entry.hospital} – ${entry.program_name}`,
    dates: `${d1}/${d2}`,
    details: `Closing date listed on the posting. Closing time not published, so apply early.\n${entry.source_url}`,
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** Data-file checks, used by tests and scripts/check-data.mjs. Returns a list of problems. */
export function validateData(data) {
  const problems = [];
  const ids = new Set();
  for (const e of data.entries || []) {
    const p = m => problems.push(`${e.id || '?'}: ${m}`);
    if (!e.id) p('missing id');
    if (ids.has(e.id)) p('duplicate id');
    ids.add(e.id);
    for (const k of ['hospital', 'program_name', 'posting_type', 'source_url', 'last_verified', 'region']) if (!e[k]) p(`missing ${k}`);
    if (e.source_url && !/^https:\/\//.test(e.source_url)) p('source_url must be https');
    if (e.deadline && !isIsoDate(e.deadline)) p('bad deadline date');
    if (e.last_verified && !isIsoDate(e.last_verified)) p('bad last_verified');
    if (!STATUS[e.posting_type]) p(`unknown posting_type ${e.posting_type}`);
    if (OPEN_TYPES.has(e.posting_type) && e.source_kind !== 'posting') p('open status needs a posting as source');
    if (e.posting_type === 'open_vacancies' && !Number.isInteger(e.positions_listed) && e.positions_listed !== undefined) p('positions_listed must be an integer');
    if (e.positions_listed !== undefined && e.posting_type !== 'open_vacancies') p('positions_listed only allowed on open_vacancies');
  }
  return problems;
}
