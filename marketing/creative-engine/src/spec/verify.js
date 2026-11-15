import { PLATFORMS } from '../platforms.js';
import { addDays, daysBetween, findDates, longDate, shortDay, textHasDate } from '../util/dates.js';
import { findRealOrg } from './ontario-hospitals.js';
import { sourceLine } from './sourceLine.js';
import { checkImagery, loadRegistry } from '../assets/registry.js';

// Rules, in plain words:
// 1. Every fact cites at least one source, and every reference resolves.
// 2. Deadlines, pay, eligibility and vacancies (the "sensitive" kinds) need a
//    primary source (the hospital's own page) and a short verbatim quote. The
//    numbers shown on slides must appear in that quote; a deadline's date must too.
// 3. Expired deadlines are rejected. Facts go stale: each kind has a maximum age.
// 4. Slides that state information must cite the facts they rely on. Any money,
//    date, percentage or counted quantity in free text must appear in a cited fact.
// 5. No application-outcome promises ("guaranteed", "you'll get hired"), and no
//    "now hiring" language without an open vacancy or deadline fact.
// 6. Demo specs are allowed unverified data, but they render with a visible
//    sample stamp, are never publishable, and may not use real hospital names.

export const SENSITIVE = new Set(['deadline', 'pay', 'eligibility', 'vacancy']);
export const MAX_AGE_DAYS = { deadline: 7, vacancy: 7, pay: 30, eligibility: 30, product: 90, program: 180, stat: 180, other: 180 };

const FACT_LAYOUTS = new Set(['text_stack', 'big_stat', 'board', 'wristbands', 'deadline', 'versus', 'c_notes', 'c_paper', 'b_card']);
const DEFAULT_BASIS = { checklist: 'advice', phone: 'promo', badge: 'promo', hook: 'opinion', cta: 'opinion', receipts: 'opinion', c_photo: 'opinion', b_cover: 'opinion', b_cta: 'promo' };

/** 'classic' | 'c' | 'b' | 'mixed', from the layouts a spec uses (auto-added slides ignored). */
export function formatOf(spec) {
  const kinds = new Set(spec.slides.filter((s) => !s._auto).map((s) => (s.layout.startsWith('c_') ? 'c' : s.layout.startsWith('b_') ? 'b' : 'classic')));
  return kinds.size === 1 ? [...kinds][0] : 'mixed';
}

// Brand voice (R7): the account is not a student and never speaks as one.
const FIRST_PERSON_CLAIM = /\b(?:I|we)\s+(?:just\s+)?(?:got|landed|matched|was hired|were hired|got hired|got accepted|got in)\b|\bI['’]m\s+(?:an?\s+)?(?:extern|nursing student|student nurse|nurse|RPN|RN)\b|\bmy\s+(?:extern(?:ship)?|first|offer|interview|placement|preceptor|unit|shift|hospital)\b/i;
// Context rule: no first-person copy over stock photos (it reads as the pictured person speaking).
const FIRST_PERSON = /\bI\b|\bI['’](?:m|ve|d|ll)\b|\b(?:[Mm]e|[Mm]y|[Mm]ine|[Ww]e|[Oo]urs?|[Uu]s)\b/;
const PERSON_LABEL = /\b(?:students?|nurses?|externs?|RNs?|RPNs?|nursing)\b/i;
// Asides are decoration: never money, dates or counts.
const ASIDE_SPECIFIC = /[\d$%]|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|hundred|thousand|million|once|twice)\b/i;
const CLINICAL_EMOJI = /[\u{1FA7A}\u{1F489}\u{1F48A}\u{1FA7B}\u{1FA78}\u{1F321}\u{1F9EA}\u{1FA79}]/u;
const EMOJI = /\p{Extended_Pictographic}/gu;
const wordsIn = (s) => String(s).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
export const DENSITY = { c: { cover: 12, inner: 40 }, b: { cover: 12, inner: 45 } };
/** Words allowed on a cover besides its hook (title): a short secondary line such as a deadline callout, plus asides. */
export const COVER_SECONDARY = 10;
const B_SERIES = 'clinical extern 101';

/** Words a C/B slide shows, including its generated source line and fixed labels. The cover's limit is about the
 *  hook, so a cover's small source line isn't counted (a deadline cover must cite its date; Rajan, 2026-11-14). */
export function slideWordCount(slide, spec, { cover = false } = {}) {
  const parts = slideTexts(slide).filter(([p]) => p !== 'mark.phrase').map(([, t]) => t);
  const line = cover ? null : sourceLine(slide, spec);
  if (line) parts.push(line);
  if (slide.layout === 'b_card' || slide.layout === 'b_cta') parts.push(B_SERIES);
  return parts.reduce((n, t) => n + wordsIn(t), 0);
}

function checkFormat(spec, fmt, err, warn) {
  const slides = spec.slides.filter((s) => !s._auto);
  const last = slides.length;
  if (fmt === 'c') {
    const designed = slides.filter((s) => s.layout === 'c_notes' || s.layout === 'c_paper').length;
    if (designed > 2) err('C_DESIGNED_MAX', 'slides', `${designed} designed slides (notes card / lined paper); format C allows at most two.`);
    const asides = slides.flatMap((s) => (s.asides ?? []).map((a) => ({ s, a })));
    if (asides.length > 2) err('ASIDE_COUNT', 'slides', `${asides.length} handwritten asides; at most two per carousel (cover and CTA).`);
    for (const { s } of asides) if (s._n !== 1 && s._n !== last) err('ASIDE_PLACEMENT', `slides[${s._n}] ${s.layout}`, 'Handwritten asides go on the cover or the CTA only.');
  }
  for (const s of slides) {
    const where = `slides[${s._n}] ${s.layout}`;
    for (const [p, t] of [...(s.asides ?? []).map((a, i) => [`asides[${i}]`, a.text]), ...(s.titleTail ? [['titleTail', s.titleTail]] : [])])
      if (ASIDE_SPECIFIC.test(t)) err('ASIDE_SPECIFIC', `${where} ${p}`, `"${t}": handwritten asides never carry money, dates or counts. Put specifics in the cited copy.`);
    if (s.mark) {
      const target = s.mark.in === 'title' ? s.title : s.body;
      if (!target || !target.includes(s.mark.phrase)) err('MARK_NOT_FOUND', `${where} mark`, `"${s.mark.phrase}" does not appear in the slide's ${s.mark.in}.`);
    }
    const texts = slideTexts(s).filter(([p]) => p !== 'mark.phrase').map(([, t]) => t).join(' ');
    if (fmt === 'c' && (texts.match(EMOJI) ?? []).length > 1) err('EMOJI_COUNT', where, 'Format C allows at most one emoji per slide.');
    if (CLINICAL_EMOJI.test(texts)) warn('CLINICAL_EMOJI', where, 'An emoji shows a clinical tool. Externs work in unregulated care provider roles; check it doesn\'t imply clinical duties.');
    if (fmt === 'c' && s.title && /^\p{Lu}/u.test(s.title)) warn('VOICE_CASE', where, 'Format C headlines are lowercase.');
    if (s._n === 1) {
      const hook = wordsIn(s.title ?? '');
      const rest = slideWordCount(s, spec, { cover: true }) - hook;
      if (hook > DENSITY[fmt].cover) err('DENSITY', where, `The hook is ${hook} words; covers in format ${fmt.toUpperCase()} allow ${DENSITY[fmt].cover}.`, 'Cut the hook.');
      if (rest > COVER_SECONDARY) err('DENSITY', where, `${rest} words besides the hook (secondary line, asides, fine print; the source line isn't counted); covers allow ${COVER_SECONDARY}.`, 'Keep the secondary line to a short callout.');
    } else {
      const n = slideWordCount(s, spec);
      if (n > DENSITY[fmt].inner) err('DENSITY', where, `${n} words (including the source line); inner slides in format ${fmt.toUpperCase()} allow ${DENSITY[fmt].inner}.`, 'Cut copy or split the slide.');
    }
  }
  const factById = new Map((spec.facts ?? []).map((f) => [f.id, f]));
  const cited = (s) => (s.facts ?? []).map((id) => factById.get(id)).filter(Boolean);
  const shown = (s) => slideTexts(s).filter(([p]) => p !== 'mark.phrase').map(([, t]) => t).join(' ');
  // Time-sensitive posts show the deadline on the cover: in the hook or a short secondary line, citing the deadline fact.
  if (slides.some((s) => cited(s).some((f) => f.kind === 'deadline'))) {
    const onCover = cited(slides[0]).filter((f) => f.kind === 'deadline');
    if (!onCover.some((f) => textHasDate(shown(slides[0]), f.date)))
      err('DEADLINE_NOT_ON_COVER', 'slides[1]', 'This carousel cites a closing date, so the cover must show that date (in the hook or a short secondary line) and cite the deadline fact.', 'e.g. hook "not every externship posting means there\'s an open job" + line "ontario example: a talent pool closing nov 30".');
  }
  // A talent pool is never presented as a vacancy: slides citing its deadline or pay, and the caption, say "talent pool".
  const pool = (spec.facts ?? []).filter((f) => f.status === 'talent-pool');
  if (pool.length) {
    for (const s of slides)
      if (cited(s).some((f) => f.status === 'talent-pool' && (f.kind === 'deadline' || f.kind === 'pay')) && !/talent pool/i.test(shown(s)))
        err('TALENT_POOL_UNLABELLED', `slides[${s._n}] ${s.layout}`, 'This slide cites a talent pool\'s deadline or pay but doesn\'t say "talent pool"; it would read as a vacancy.');
    const anyPool = slides.some((s) => cited(s).some((f) => f.status === 'talent-pool'));
    for (const key of ['text', 'instagram'])
      if (anyPool && spec.caption?.[key] && !/talent pool/i.test(spec.caption[key])) err('TALENT_POOL_UNLABELLED', `caption.${key}`, 'The post cites a talent pool; the caption must say "talent pool".');
  }
  // Content brief: the cover hook must be one of the candidates considered (docs/CONTENT.md).
  if (spec.brief && !spec.brief.hooks.includes(slides[0].title)) err('BRIEF_HOOK_MISMATCH', 'brief.hooks', `The cover hook "${slides[0].title}" isn't among the brief's candidate hooks.`);
  if (fmt === 'b' && slides[0].layout !== 'b_cover') warn('B_ORDER', 'slides[1]', 'Format B carousels open with a b_cover.');
  if (fmt === 'b' && slides.slice(1).some((s) => s.layout === 'b_cover')) err('B_ORDER', 'slides', 'Only the first slide can be a b_cover.');
}

const SPECIFIC_PATTERNS = [
  /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:-|–|to)\s?\$?\s?\d[\d,]*(?:\.\d+)?)?/gi,
  /\b\d+(?:\.\d+)?\s?%/g,
  /\b\d+(?:\.\d+)?\s?(?:k|m|million|thousand|billion)\b\+?/gi,
  /\b\d[\d,]*(?:\.\d+)?\+?\s+(?:hours?|hrs?|positions?|spots?|vacanc(?:y|ies)|openings?|students?|hospitals?|externs?|days?|weeks?|months?|shifts?|jobs?|postings?|seats?)\b/gi,
];

const OUTCOME_PATTERNS = [
  /\bguarantee(?:d|s)?\b/i,
  /\b(?:you(?:'|’)ll|you will|you'll definitely|everyone will|everyone)\s+(?:get|be)\s+(?:hired|accepted|an offer|the job|a job|in)\b/i,
  /\b100\s?%/,
  /\b(?:easy|instant|automatic)\s+(?:offer|hire|acceptance|job)\b/i,
];
const NEGATED = /\b(?:no|not|never|without|isn['’]t|aren['’]t|can['’]t|won['’]t)\s+(?:\w+\s+){0,2}(?:guarantee\w*|promise\w*)/gi;
export const promisesOutcome = (text) => OUTCOME_PATTERNS.some((re) => re.test(String(text).replace(NEGATED, ' ')));
const HIRING_PATTERN = /\b(?:now hiring|hiring now|actively hiring|spots? left|positions? (?:available|open)|openings? available)\b/i;

const numbersIn = (s) => [...String(s).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => parseFloat(m[0].replace(/,/g, '')));

/** Normalise a spec: default each slide's basis and auto-add a receipts slide. */
export function prepareSpec(spec) {
  const s = structuredClone(spec);
  s.slides = s.slides.map((slide, i) => ({
    ...slide,
    _n: i + 1,
    basis: slide.basis ?? (slide.facts?.length || FACT_LAYOUTS.has(slide.layout) ? 'facts' : DEFAULT_BASIS[slide.layout] ?? 'opinion'),
  }));
  if (s.facts.length && formatOf(s) === 'classic' && !s.slides.some((x) => x.layout === 'receipts')) {
    const receipts = { layout: 'receipts', title: 'receipts', basis: 'opinion', _auto: true };
    const last = s.slides.at(-1);
    if (last.layout === 'cta') s.slides.splice(s.slides.length - 1, 0, receipts);
    else s.slides.push(receipts);
  }
  return s;
}

/** Facts a slide relies on, including those referenced by its items. */
export function slideFactIds(slide, spec) {
  const ids = new Set(slide.facts ?? []);
  if (slide.layout === 'wristbands') slide.items.forEach((it) => ids.add(it.fact));
  if (slide.layout === 'deadline') {
    ids.add(slide.fact);
    slide.details?.forEach((d) => ids.add(d.fact));
  }
  if (slide.layout === 'versus') [slide.a.fact, slide.b.fact].forEach((f) => ids.add(f));
  if (slide.layout === 'hook' && slide.variant === 'count') spec.facts.filter((f) => f.kind === 'deadline').forEach((f) => ids.add(f.id));
  return [...ids];
}

/** Every free-text field on a slide, with a readable path. */
export function slideTexts(slide) {
  const out = [];
  const push = (path, v) => typeof v === 'string' && out.push([path, v]);
  ['title', 'sub', 'value', 'label', 'context', 'name', 'role', 'body', 'note', 'titleTail', 'fine', 'footer', 'sticker', 'chip', 'site'].forEach((k) => push(k, slide[k]));
  slide.lines?.forEach((l, i) => push(`lines[${i}]`, l));
  slide.items?.forEach((it, i) => typeof it === 'string' && push(`items[${i}]`, it));
  slide.tags?.forEach((t, i) => push(`tags[${i}]`, t));
  slide.asides?.forEach((a, i) => push(`asides[${i}]`, a.text));
  slide.rows?.forEach((r, i) => { push(`rows[${i}].label`, r.label); push(`rows[${i}].value`, r.value); });
  slide.callouts?.forEach((c, i) => push(`callouts[${i}]`, c));
  if (slide.reply) push('reply.comment', slide.reply.comment);
  if (slide.count) push('count.label', slide.count.label);
  if (slide.versus) { push('versus.left', slide.versus.left); push('versus.right', slide.versus.right); }
  ['a', 'b'].forEach((k) => slide[k] && (push(`${k}.name`, slide[k].name), push(`${k}.label`, slide[k].label)));
  slide.details?.forEach((d, i) => push(`details[${i}].label`, d.label));
  slide.screen?.mock?.items?.forEach((it, i) => { push(`screen.items[${i}].title`, it.title); push(`screen.items[${i}].meta`, it.meta); });
  return out;
}

function supportText(facts) {
  return facts.map((f) => [f.claim, f.value, f.quote, f.org, f.role, f.date && longDate(f.date), f.asOf && longDate(f.asOf)].filter(Boolean).join(' \n ')).join(' \n ');
}

function unsupportedSpecifics(text, facts) {
  const support = supportText(facts);
  const supportNums = new Set(numbersIn(support));
  const factDates = facts.flatMap((f) => [f.date, f.asOf, f.verifiedAt].filter(Boolean));
  const problems = [];
  for (const re of SPECIFIC_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const nums = numbersIn(m[0]);
      if (nums.some((n) => !supportNums.has(n))) problems.push(m[0].trim());
    }
  }
  const supportDates = [...factDates, ...findDates(support)];
  for (const d of findDates(text)) {
    const ok = supportDates.some((sd) => sd === d || (sd.slice(4) === d.slice(4) && (sd.startsWith('????') || d.startsWith('????'))));
    if (!ok) problems.push(d.replace('????-', ''));
  }
  return [...new Set(problems)];
}

export function verifySpec(spec, opts) {
  const { today } = opts;
  const errors = [];
  const warnings = [];
  const err = (code, where, message, fix) => errors.push({ code, where, message, ...(fix && { fix }) });
  const warn = (code, where, message) => warnings.push({ code, where, message });

  const demo = spec.status === 'demo';
  if (demo && !spec.demo) err('DEMO_BLOCK', 'demo', 'Demo specs need demo.referenceDate and demo.reason.', 'Add "demo": {"referenceDate": "YYYY-MM-DD", "reason": "…"}');
  if (!demo && spec.demo) err('DEMO_BLOCK', 'demo', 'Verified specs must not carry a demo block.', 'Remove "demo", or set status to "demo".');
  const refDate = demo && spec.demo ? spec.demo.referenceDate : today;

  const facts = new Map(spec.facts.map((f) => [f.id, f]));
  const sources = new Map(spec.sources.map((s) => [s.id, s]));
  const usedFacts = new Set();
  const usedSources = new Set();

  // --- duplicate ids
  const dupes = (arr) => arr.filter((x, i) => arr.indexOf(x) !== i);
  dupes(spec.facts.map((f) => f.id)).forEach((d) => err('DUPLICATE_ID', `facts.${d}`, `Fact id "${d}" is used twice.`));
  dupes(spec.sources.map((s) => s.id)).forEach((d) => err('DUPLICATE_ID', `sources.${d}`, `Source id "${d}" is used twice.`));

  // --- sources
  for (const s of spec.sources) {
    if (daysBetween(today, s.accessedAt) > 0) err('FUTURE_DATE', `sources.${s.id}.accessedAt`, `accessedAt ${s.accessedAt} is in the future.`);
  }

  // --- facts
  for (const f of spec.facts) {
    const where = `facts.${f.id}`;
    const srcs = f.sources.map((id) => sources.get(id));
    f.sources.forEach((id, i) => (srcs[i] ? usedSources.add(id) : err('UNKNOWN_SOURCE', where, `Source "${id}" is not defined in sources[].`)));

    if (daysBetween(refDate, f.verifiedAt) > 0) err('FUTURE_DATE', `${where}.verifiedAt`, `verifiedAt ${f.verifiedAt} is after ${refDate}.`);
    const age = daysBetween(f.verifiedAt, refDate);
    const maxAge = MAX_AGE_DAYS[f.kind];
    if (age > maxAge) err('STALE_FACT', where, `${f.kind} facts must be re-verified within ${maxAge} days; this one was checked ${age} days ago (${f.verifiedAt}).`, 'Re-check the source and update verifiedAt.');

    if (f.kind === 'deadline') {
      if (!f.date) err('DEADLINE_DATE', where, 'Deadline facts need a date (YYYY-MM-DD).');
      if (!f.org || !f.role) err('DEADLINE_FIELDS', where, 'Deadline facts need org and role so the wristband can name the posting.');
      if (f.date) {
        const left = daysBetween(refDate, f.date);
        if (left < 0) err('EXPIRED_DEADLINE', where, `${f.org ?? 'Posting'} closed on ${longDate(f.date)} (${-left} days before ${refDate}). Expired postings cannot be promoted.`, 'Remove this posting from the spec.');
        else if (left <= 2) warn('DEADLINE_SOON', where, `Closes ${shortDay(f.date)} — the post may be stale before it is published.`);
      }
      if (f.status === 'closed') err('CLOSED_POSTING', where, 'A closed posting cannot be shown as a deadline.');
    }

    if (SENSITIVE.has(f.kind) && !demo) {
      if (!srcs.some((s) => s?.primary)) err('NEEDS_PRIMARY_SOURCE', where, `${f.kind} facts need a primary source (the hospital's own careers page or ATS), not an aggregator.`, 'Add the hospital posting URL with "primary": true.');
      if (!f.quote) err('NEEDS_QUOTE', where, `${f.kind} facts need a short verbatim quote from the source.`, 'Copy the exact line from the posting into "quote".');
      if (f.quote && f.value) {
        const q = new Set(numbersIn(f.quote));
        const missing = numbersIn(f.value).filter((n) => !q.has(n));
        if (missing.length) err('VALUE_NOT_IN_QUOTE', where, `Value "${f.value}" contains ${missing.join(', ')}, which the quote does not.`, 'Use the numbers exactly as the source states them.');
      }
      if (f.kind === 'deadline' && f.quote && f.date && !textHasDate(f.quote, f.date)) err('DATE_NOT_IN_QUOTE', where, `The quote does not contain the deadline ${longDate(f.date)}.`);
    }

    if (demo && SENSITIVE.has(f.kind)) {
      const real = findRealOrg([f.org, f.claim, f.value].filter(Boolean).join(' '));
      if (real) err('DEMO_REAL_ORG', where, `Demo data names a real hospital ("${real}"). Demo postings, pay and vacancies must use fictional organisations.`);
    }
  }

  // --- slides
  for (const slide of spec.slides) {
    const where = `slides[${slide._n ?? '?'}] ${slide.layout}`;
    const ids = slideFactIds(slide, spec);
    const resolved = [];
    for (const id of ids) {
      const f = facts.get(id);
      if (!f) err('UNKNOWN_FACT', where, `Fact "${id}" is not defined in facts[].`);
      else { resolved.push(f); usedFacts.add(id); }
    }

    if (slide.basis === 'facts' && !ids.length && slide.layout !== 'receipts')
      err('MISSING_FACTS', where, 'This slide states information but cites no facts.', 'Add "facts": [...], or set "basis": "advice" | "opinion" | "promo" if it makes no factual claim.');

    if (slide.layout === 'wristbands' || slide.layout === 'deadline') {
      const deadlineIds = slide.layout === 'deadline' ? [slide.fact] : slide.items.map((i) => i.fact);
      deadlineIds.forEach((id) => facts.get(id) && facts.get(id).kind !== 'deadline' && err('WRONG_FACT_KIND', where, `"${id}" is a ${facts.get(id).kind} fact; this layout needs deadline facts.`));
    }
    if (slide.layout === 'versus') ['a', 'b'].forEach((k) => {
      const f = facts.get(slide[k].fact);
      if (f && !f.value) err('NEEDS_VALUE', `${where} ${k}`, `Fact "${f.id}" needs a short "value" to display.`);
    });
    if (slide.layout === 'hook' && (slide.variant === 'reply' || slide.reply)) err('REPLY_STICKER_RETIRED', where, 'The comment-reply sticker is retired: it shows a comment nobody wrote. Use a plain hook.', 'Set "variant": "plain", remove "reply", and put the question in the title or "sub".');
    if (slide.layout === 'hook' && slide.variant === 'count' && !slide.count) err('HOOK_FIELDS', where, 'variant "count" needs count: {of, label}.');
    if (slide.layout === 'hook' && slide.variant === 'versus' && !slide.versus) err('HOOK_FIELDS', where, 'variant "versus" needs versus: {left, right, op}.');

    for (const [path, text] of slideTexts(slide)) {
      const loc = `${where} ${path}`;
      const bad = unsupportedSpecifics(text, resolved);
      if (bad.length) err('UNSUPPORTED_SPECIFIC', loc, `"${bad.join('", "')}" is not backed by any fact this slide cites.`, 'Cite the fact that states it, or remove the specific.');
      if (promisesOutcome(text)) err('OUTCOME_CLAIM', loc, `"${text}" promises an application outcome. Never imply anyone will be hired or accepted.`);
      if (HIRING_PATTERN.test(text) && !resolved.some((f) => (f.kind === 'vacancy' || f.kind === 'deadline') && f.status !== 'closed' && f.status !== 'talent-pool'))
        err('HIRING_CLAIM', loc, `"${text}" says someone is hiring, but the slide cites no open vacancy or deadline.`);
      if (demo) { const real = findRealOrg(text); if (real && ids.some((id) => SENSITIVE.has(facts.get(id)?.kind))) err('DEMO_REAL_ORG', loc, `Demo slide mentions a real hospital ("${real}") next to sample postings.`); }
      if (FIRST_PERSON_CLAIM.test(text)) err('FIRST_PERSON_CLAIM', loc, `"${text}" speaks as a student. The account isn't one and can't claim an experience.`, 'Say what the source says, in the second or third person.');
      else if (slide.photo && FIRST_PERSON.test(text)) err('STOCK_FIRST_PERSON', loc, `"${text}" is first person over a stock photo; it reads as the pictured person speaking.`);
    }
    if (slide.photo && slide.alt && PERSON_LABEL.test(slide.alt)) {
      const a = (opts.registry ?? loadRegistry()).byId.get(slide.photo);
      if (a?.contains_people) err('PHOTO_PERSON_LABEL', `${where} alt`, 'Alt text calls the pictured stock model a student, nurse or extern. Describe the scene, not who they are.');
    }
  }

  // --- formats C and B, and photo provenance
  const fmt = formatOf(spec);
  if (fmt === 'mixed') err('FORMAT_MIX', 'slides', 'Use one format per carousel: classic layouts, format C (c_*) or format B (b_*).');
  if (spec.format && fmt !== 'mixed' && fmt !== spec.format) {
    const got = fmt === 'classic' ? 'classic (flat background) layouts' : `format ${fmt.toUpperCase()} layouts`;
    err('FORMAT_NOT_RENDERED', 'format', `This post asks for ${spec.format === 'classic' ? 'classic layouts' : `format ${spec.format.toUpperCase()}`}, but its slides are ${got}. Marketing posts default to format C (c_photo / c_notes / c_paper); dense reference posts use format B with "format": "b". To use classic layouts on purpose, set "format": "classic".`);
  }
  if (fmt === 'c' || fmt === 'b') checkFormat(spec, fmt, err, warn);
  if (spec.slides.some((s) => s.photo)) {
    const img = checkImagery(spec, opts.registry ?? loadRegistry());
    errors.push(...img.errors);
    warnings.push(...img.warnings);
  }

  // --- caption
  for (const pid of spec.platforms) {
    const p = PLATFORMS[pid];
    const body = composeCaption(spec, pid);
    if (body.length > p.captionLimit) err('CAPTION_LENGTH', `caption.${pid}`, `Caption is ${body.length} characters; ${p.label} allows ${p.captionLimit}.`);
    const slides = spec.slides.length;
    if (slides > p.maxSlides) err('TOO_MANY_SLIDES', pid, `${slides} slides; ${p.label} allows ${p.maxSlides}.`);
  }
  if (spec.caption.hashtags.length > 5) warn('HASHTAGS', 'caption.hashtags', `${spec.caption.hashtags.length} hashtags. 3–5 specific tags tend to read better than a wall of them.`);
  for (const key of ['text', 'tiktok', 'instagram']) {
    const text = spec.caption[key];
    if (!text) continue;
    const bad = unsupportedSpecifics(text, spec.facts);
    if (bad.length) err('UNSUPPORTED_SPECIFIC', `caption.${key}`, `"${bad.join('", "')}" is not backed by any fact in the spec.`);
    if (promisesOutcome(text)) err('OUTCOME_CLAIM', `caption.${key}`, 'Caption promises an application outcome.');
    if (FIRST_PERSON_CLAIM.test(text)) err('FIRST_PERSON_CLAIM', `caption.${key}`, 'Caption speaks as a student. The account isn\'t one.');
  }
  if (spec.slides.length > 10) warn('LONG_CAROUSEL', 'slides', `${spec.slides.length} slides. Swipe-through drops off after about 8–10.`);

  // --- hygiene
  spec.facts.filter((f) => !usedFacts.has(f.id)).forEach((f) => warn('UNUSED_FACT', `facts.${f.id}`, 'Fact is not used on any slide.'));
  spec.sources.filter((s) => !usedSources.has(s.id)).forEach((s) => warn('UNUSED_SOURCE', `sources.${s.id}`, 'Source is not cited by any fact.'));

  // --- shelf life
  const deadlines = spec.facts.filter((f) => f.kind === 'deadline' && usedFacts.has(f.id) && f.date).map((f) => f.date).sort();
  const postBy = deadlines.length ? addDays(deadlines[0], -1) : null;
  const reverify = spec.facts.filter((f) => usedFacts.has(f.id)).map((f) => addDays(f.verifiedAt, MAX_AGE_DAYS[f.kind])).sort();
  const reverifyBy = reverify[0] ?? null;
  if (!demo && postBy && daysBetween(today, postBy) < 0) warn('SHELF_LIFE', 'facts', `The earliest deadline is ${longDate(deadlines[0])}; there is less than a day to publish.`);

  const blockers = [...(demo ? ['Demo content: sample data, not real postings.'] : []), ...errors.map((e) => `${e.code} ${e.where}`)];
  return { errors, warnings, publishable: !demo && errors.length === 0, blockers, today, referenceDate: refDate, postBy, reverifyBy };
}

export function composeCaption(spec, platformId) {
  const body = spec.caption[platformId] ?? spec.caption.text;
  const tags = spec.caption.hashtags.join(' ');
  return tags ? `${body}\n\n${tags}` : body;
}

// Optional online re-check: confirms each sensitive fact's source still loads and,
// where the page is server-rendered, that the quote is still on it.
export async function checkSourcesOnline(spec, { timeoutMs = 15000 } = {}) {
  const findings = [];
  const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  for (const f of spec.facts.filter((x) => SENSITIVE.has(x.kind))) {
    for (const sid of f.sources) {
      const s = spec.sources.find((x) => x.id === sid);
      if (!s?.primary) continue;
      try {
        const res = await fetch(s.url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (creative-engine source check)' } });
        if (res.status === 404 || res.status === 410) { findings.push({ level: 'error', code: 'SOURCE_GONE', where: `sources.${sid}`, message: `${s.url} returned ${res.status}; the posting may have been removed.` }); continue; }
        if (!res.ok) { findings.push({ level: 'warning', code: 'SOURCE_STATUS', where: `sources.${sid}`, message: `${s.url} returned ${res.status}.` }); continue; }
        const page = strip(await res.text());
        if (/no longer accepting|job (?:has )?expired|posting (?:is )?closed|position (?:has been )?filled/.test(page)) findings.push({ level: 'error', code: 'SOURCE_CLOSED', where: `sources.${sid}`, message: `${s.url} says the posting is closed.` });
        if (f.quote) {
          const probe = f.quote.toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
          if (!page.includes(probe)) findings.push({ level: 'warning', code: 'QUOTE_NOT_FOUND', where: `facts.${f.id}`, message: `Quote not found in the page HTML (it may be rendered by JavaScript). Check ${s.url} by hand.` });
        }
      } catch (e) {
        findings.push({ level: 'warning', code: 'SOURCE_UNREACHABLE', where: `sources.${sid}`, message: `${s.url}: ${e.cause?.code ?? e.name}` });
      }
    }
  }
  return findings;
}
