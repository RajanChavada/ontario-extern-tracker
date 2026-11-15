// All dates are calendar dates (YYYY-MM-DD) interpreted in Ontario time.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function torontoToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((toUTC(toIso) - toUTC(fromIso)) / 86400000);
}

export function addDays(iso, n) {
  return new Date(toUTC(iso) + n * 86400000).toISOString().slice(0, 10);
}

/** "Fri Nov 20" */
export function shortDay(iso) {
  const d = new Date(toUTC(iso));
  return `${DAYS[d.getUTCDay()]} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Nov 20, 2026" */
export function longDate(iso) {
  const d = new Date(toUTC(iso));
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "Nov 2026" */
export function monthYear(iso) {
  const d = new Date(toUTC(iso));
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Find calendar dates written in free text. Returns ISO strings. */
export function findDates(text) {
  const out = new Set();
  const t = String(text);
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.add(`${m[1]}-${m[2]}-${m[3]}`);
  const re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi;
  for (const m of t.matchAll(re)) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    const year = m[3] ?? '????';
    out.add(`${year}-${String(mi + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`);
  }
  const re2 = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?\b/gi;
  for (const m of t.matchAll(re2)) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    const year = m[3] ?? '????';
    out.add(`${year}-${String(mi + 1).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`);
  }
  return [...out];
}

/** Does any date found in text match iso (year-less matches count)? */
export function textHasDate(text, iso) {
  return findDates(text).some((d) => d === iso || (d.startsWith('????') && d.slice(4) === iso.slice(4)));
}
