// Source lines for formats C and B, generated from the facts a slide cites (never typed by hand).
//   "Source: Ontario Health, Enhanced Extern Program page, updated June 4, 2026"
// Posting facts (deadline, pay, eligibility, vacancy) go stale, so their line also says when
// they were checked: "…, checked November 14, 2026".
import { fullDate } from '../util/dates.js';

const DECAYING = new Set(['deadline', 'pay', 'eligibility', 'vacancy']);

/** Facts a slide cites directly (formats C and B have no item-level fact references). */
const citedIds = (slide) => slide.facts ?? [];

/**
 * The slide's source line, or null when it shouldn't carry one (no facts, or not a facts slide:
 * covers and CTAs about the tracker itself show fine print instead).
 */
export function sourceLine(slide, spec, { demo = spec.status === 'demo' } = {}) {
  if ((slide.basis ?? 'facts') !== 'facts') return null;
  const facts = citedIds(slide).map((id) => spec.facts.find((f) => f.id === id)).filter(Boolean);
  if (!facts.length) return null;
  if (demo) return 'Sample data for illustration. Not real postings.';
  const srcIds = [...new Set(facts.flatMap((f) => f.sources))];
  const srcs = srcIds.map((id) => spec.sources.find((s) => s.id === id)).filter(Boolean);
  const names = srcs.map((s) => {
    const when = s.updated ? `, updated ${fullDate(s.updated)}` : s.published ? `, published ${fullDate(s.published)}` : '';
    return `${s.publisher}, ${s.label ?? s.title}${when}`;
  });
  const decaying = facts.filter((f) => DECAYING.has(f.kind)).map((f) => f.verifiedAt).sort();
  const checked = decaying.length ? `, checked ${fullDate(decaying[0])}` : '';
  return `${names.length > 1 ? 'Sources' : 'Source'}: ${names.join('; ')}${checked}`;
}
