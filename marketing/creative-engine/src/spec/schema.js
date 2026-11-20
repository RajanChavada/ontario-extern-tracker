import { z } from 'zod';
import { THEME_IDS } from '../themes.js';
import { PLATFORM_IDS } from '../platforms.js';

// The content spec is the only thing an agent writes. It is platform-agnostic:
// the same spec renders TikTok and Instagram carousels today and is shaped so a
// video renderer can consume it later (see docs/VIDEO.md).
//
// Objects are strict: an unknown or misspelled field is an error, not a no-op.

const isoDate = z.iso.date();
const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'use lowercase letters, numbers and hyphens');
const text = (max) => z.string().trim().min(1).max(max);

// basis says what kind of statement a slide makes.
//   facts   – states information; must list the facts it relies on (default for content layouts)
//   advice  – general guidance (e.g. "read the posting twice"); no factual claims allowed
//   opinion – the account's own take
//   promo   – about the tracker product itself
const basis = z.enum(['facts', 'advice', 'opinion', 'promo']);

const common = {
  facts: z.array(id).optional(),
  basis: basis.optional(),
  note: text(90).optional(), // a handwritten marker annotation
  alt: text(400).optional(), // override generated alt text
  theme: z.enum(THEME_IDS).optional(), // per-slide theme override
};

const hook = z.strictObject({
  layout: z.literal('hook'),
  variant: z.enum(['reply', 'count', 'versus', 'plain']).default('plain'),
  title: text(90),
  sub: text(140).optional(),
  reply: z.strictObject({ user: text(30), comment: text(90) }).optional(),
  // count: the big number is computed from facts, never typed by hand.
  count: z.strictObject({ of: z.enum(['deadlines']), label: text(40) }).optional(),
  versus: z.strictObject({ left: text(24), right: text(24), op: z.enum(['vs', '≠', '=']).default('vs') }).optional(),
  ...common,
});

const textStack = z.strictObject({
  layout: z.literal('text_stack'),
  title: text(80).optional(),
  lines: z.array(text(150)).min(1).max(5),
  emoji: z.string().max(8).optional(),
  ...common,
});

const bigStat = z.strictObject({
  layout: z.literal('big_stat'),
  value: text(10),
  label: text(90),
  context: text(140).optional(),
  ...common,
});

const board = z.strictObject({
  layout: z.literal('board'),
  title: text(70),
  rows: z
    .array(z.strictObject({ label: text(30), value: text(60), mark: z.enum(['circle', 'underline', 'none']).default('none') }))
    .min(1)
    .max(5),
  ...common,
});

const checklist = z.strictObject({
  layout: z.literal('checklist'),
  title: text(70),
  items: z.array(text(90)).min(2).max(6),
  ...common,
});

const wristbands = z.strictObject({
  layout: z.literal('wristbands'),
  title: text(70),
  items: z.array(z.strictObject({ fact: id })).min(1).max(5),
  ...common,
});

const deadline = z.strictObject({
  layout: z.literal('deadline'),
  fact: id,
  details: z.array(z.strictObject({ label: text(24), fact: id })).max(4).optional(),
  ...common,
});

const side = z.strictObject({ fact: id, name: text(40).optional(), label: text(60).optional() });
const versus = z.strictObject({
  layout: z.literal('versus'),
  title: text(60),
  a: side,
  b: side,
  ...common,
});

const phone = z.strictObject({
  layout: z.literal('phone'),
  title: text(70),
  screen: z.union([
    z.strictObject({ image: text(300) }),
    z.strictObject({
      mock: z.strictObject({
        header: text(40),
        items: z.array(z.strictObject({ title: text(40), meta: text(50), tag: text(14).optional() })).min(1).max(4),
      }),
    }),
  ]),
  callouts: z.array(text(48)).max(3).default([]),
  ...common,
});

const badge = z.strictObject({
  layout: z.literal('badge'),
  title: text(70),
  name: text(40),
  role: text(50).optional(),
  body: text(160).optional(),
  emoji: z.string().max(8).optional(),
  ...common,
});

const receipts = z.strictObject({
  layout: z.literal('receipts'),
  title: text(40).default('receipts'),
  ...common,
});

const cta = z.strictObject({
  layout: z.literal('cta'),
  title: text(70),
  sub: text(120).optional(),
  action: z.enum(['save', 'follow', 'comment', 'share']),
  ...common,
});

// --- Formats C (student-made hybrid) and B (saveable guide) -----------------------------
// Reference package 2026-11-14 (HANDOFF.md). Sizes are drawn for the 3:4 safe box and scale.
// These layouts take no theme or marker note: the format fixes the look.
const fmtCommon = { facts: z.array(id).optional(), basis: basis.optional(), alt: text(400).optional() };
const photo = id.describe('asset id from assets/registry.json');
// Handwritten aside (Caveat, red, white outline). Never facts or numbers. At most two per
// carousel, only on the cover and the CTA. "below" flows under the text; {x, y} places it
// at a fraction of the safe box (top-left of the aside).
const aside = z.strictObject({
  text: text(32),
  at: z.union([z.literal('below'), z.strictObject({ x: z.number().min(0).max(0.9), y: z.number().min(0).max(0.95) })]).default('below'),
  size: z.number().int().min(56).max(90).optional(),
  rotate: z.number().min(-7).max(-4).optional(),
});
// One word-mark per slide: a hand-drawn circle or a highlighter stroke on a phrase.
const wordMark = z.strictObject({ kind: z.enum(['circle', 'highlight']), phrase: text(60), in: z.enum(['title', 'body']).default('body') });

const cPhoto = z.strictObject({
  layout: z.literal('c_photo'),
  photo,
  title: text(90),
  titleTail: text(30).optional(), // handwritten continuation of the headline, e.g. "(ontario edition)"
  body: text(220).optional(),
  fine: text(90).optional(), // fine print in the source-line slot (CTA: "Not affiliated with …")
  place: z.enum(['auto', 'top', 'bottom']).default('auto'), // auto = the photo's registered quiet area
  nudge: z.number().int().min(-10).max(10).default(0), // px at 3:4, keeps the block in y 110–130 / 620–640
  asides: z.array(aside).max(2).optional(),
  mark: wordMark.optional(),
  ...fmtCommon,
});
const cNotes = z.strictObject({
  layout: z.literal('c_notes'),
  photo, // shown blurred behind the card
  label: text(40).optional(),
  title: text(90),
  body: text(220),
  mark: wordMark.optional(),
  ...fmtCommon,
});
const cPaper = z.strictObject({
  layout: z.literal('c_paper'),
  title: text(90),
  body: text(220),
  tags: z.array(text(24)).max(3).default([]),
  ...fmtCommon,
});
export const B_ICONS = { hospital: '🏥', clipboard: '📋', calendar: '🗓️', handshake: '🤝', briefcase: '💼' };
export const B_COLORS = {
  rose: { k: '#AE2A52', p: '#FCE3EA' },
  teal: { k: '#22766C', p: '#DDF1EC' },
  violet: { k: '#5B4AB3', p: '#E9E4FA' },
  amber: { k: '#94600C', p: '#FFF0CC' },
  blue: { k: '#24609F', p: '#DCEAFB' },
};
const bCover = z.strictObject({
  layout: z.literal('b_cover'),
  photo,
  title: text(90),
  sticker: text(30).optional(),
  ...fmtCommon,
});
const bCard = z.strictObject({
  layout: z.literal('b_card'),
  chip: text(20),
  icon: z.enum(Object.keys(B_ICONS)), // topic icons only; nothing that depicts a clinical task
  title: text(90),
  body: text(220),
  color: z.enum(Object.keys(B_COLORS)).optional(), // default: rose, teal, violet, amber, blue in order
  ...fmtCommon,
});
const bCta = z.strictObject({
  layout: z.literal('b_cta'),
  title: text(60),
  site: text(40),
  body: text(220),
  fine: text(90).optional(),
  footer: text(60).optional(),
  ...fmtCommon,
});

export const FORMAT_C_LAYOUTS = ['c_photo', 'c_notes', 'c_paper'];
export const FORMAT_B_LAYOUTS = ['b_cover', 'b_card', 'b_cta'];

export const SlideSchema = z.discriminatedUnion('layout', [
  hook, textStack, bigStat, board, checklist, wristbands, deadline, versus, phone, badge, receipts, cta,
  cPhoto, cNotes, cPaper, bCover, bCard, bCta,
]);

export const LAYOUTS = {
  hook: 'Cover. Variants: count (number of deadline facts), versus (two labels + operator), plain. (reply is retired: no fabricated comment stickers.)',
  text_stack: 'TikTok-native caption boxes stacked on the theme surface. 1–5 short lines, optional emoji sticker.',
  big_stat: 'One number, hand-circled, with a label. Number must appear in a referenced fact.',
  board: 'Patient whiteboard: printed labels with marker values. Good for explainers and timelines.',
  checklist: 'Hand-ticked checklist. Usually basis: "advice".',
  wristbands: 'Deadline roundup. Each item is a deadline fact drawn as a hospital wristband, coloured by urgency.',
  deadline: 'One posting in detail: big wristband plus whiteboard rows of supporting facts.',
  versus: 'Two sticky notes compared on one dimension (pay, who can apply…). Values come from facts.',
  phone: 'Product demo: phone with a screenshot or a simple mock list, plus marker callouts.',
  badge: 'Community announcement styled as a hospital ID badge on a badge reel.',
  receipts: 'Sources as a receipt. Auto-added at the end when a spec has facts.',
  cta: 'Closing call to action; a marker arrow points at the real platform button (save, follow, comment, share).',
  c_photo: 'Format C: full-bleed licensed photo + white TikTok caption boxes on the photo\'s quiet area; optional circle/highlight, handwritten asides (cover/CTA only), fine print.',
  c_notes: 'Format C designed slide: white notes card over the blurred photo, one highlight.',
  c_paper: 'Format C designed slide: lined paper with up to three sticky-note tags.',
  b_cover: 'Format B cover: study-desk photo (no people), outlined title, "save this" sticker.',
  b_card: 'Format B reference card: number circle, topic chip, series label, headline, tinted panel with one topic icon, source line.',
  b_cta: 'Format B closing card: site name, verified tracker copy, not-affiliated line, save prompt.',
};

export const FactSchema = z.strictObject({
  id,
  kind: z.enum(['deadline', 'pay', 'eligibility', 'vacancy', 'program', 'stat', 'product', 'other']),
  claim: text(300), // the full sentence the fact supports, in plain words
  value: text(80).optional(), // the short display value used on slides
  org: text(60).optional(),
  role: text(60).optional(),
  date: isoDate.optional(), // deadline date
  time: text(20).optional(), // e.g. "10:00 AM"
  status: z.enum(['open', 'closed', 'talent-pool']).optional(),
  asOf: isoDate.optional(), // date the source said this (e.g. posting date)
  quote: text(400).optional(), // short verbatim excerpt from the source
  sources: z.array(id).min(1),
  verifiedAt: isoDate,
});

export const SourceSchema = z.strictObject({
  id,
  publisher: text(60),
  title: text(160),
  url: z.url(),
  published: isoDate.optional(),
  updated: isoDate.optional(), // the page's own "last updated" date, when it shows one instead of a publish date
  label: text(60).optional(), // short name for source lines, e.g. "Enhanced Extern Program page"
  snapshot: isoDate.optional(), // historical: the quote is checked against the saved capture from this date, not the live page
  accessedAt: isoDate,
  primary: z.boolean(), // true = the hospital / agency's own page
});

export const SpecSchema = z.strictObject({
  $schema: z.string().optional(),
  id,
  title: text(120),
  status: z.enum(['verified', 'demo']),
  theme: z.enum(THEME_IDS),
  // The look this post asks for. oet campaigns (tracker posts, Grokbot exports) default to 'c'; the slides must
  // actually render in it (FORMAT_NOT_RENDERED), so a campaign never falls back to the flat classic layouts silently.
  format: z.enum(['c', 'b', 'classic']).optional(),
  platforms: z.array(z.enum(PLATFORM_IDS)).min(1).default(['tiktok', 'instagram']),
  demo: z.strictObject({ referenceDate: isoDate, reason: text(200) }).optional(),
  brand: z.strictObject({ name: text(40), handle: text(40).optional() }).default({ name: 'Ontario Extern Tracker' }),
  slides: z.array(SlideSchema).min(2).max(20),
  facts: z.array(FactSchema).default([]),
  sources: z.array(SourceSchema).default([]),
  // Who speaks (docs/CONTENT.md, decision 9): 'brand' (default, third/second person) or 'student' (first person, the
  // real student in the voice profile; experience claims must be in the profile's true_statements).
  voice: z.enum(['brand', 'student']).optional(),
  // Content brief (docs/CONTENT.md): the reasoning behind the post, kept with it. Not rendered or exported.
  brief: z.strictObject({
    type: z.enum(['listing', 'deadline', 'talent_pool', 'checklist', 'explainer', 'relatable']),
    problem: text(240), // the nursing-student problem this post solves
    hooks: z.array(text(90)).min(3).max(8), // candidate cover hooks considered; the cover title must be one of them
    why: text(800), // why this hook won, and which slides deliver on it
    payoff: text(240), // what the reader has after the last slide
    evidence: z.array(text(200)).min(1), // research references, e.g. "tiktok-research-2026-11-14 CONCEPTS #10"
  }).optional(),
  caption: z.strictObject({
    text: text(2000),
    hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]+$/u, 'hashtags look like #nursingstudent')).max(30).default([]),
    tiktok: text(2000).optional(),
    instagram: text(2000).optional(),
  }),
});

export function parseSpec(raw) {
  const result = SpecSchema.safeParse(raw);
  if (result.success) return { spec: result.data, errors: [] };
  const errors = result.error.issues.map((i) => ({
    code: 'SCHEMA',
    where: i.path.join('.') || '(root)',
    message: i.message,
  }));
  return { spec: null, errors };
}

export function jsonSchema() {
  return z.toJSONSchema(SpecSchema, { io: 'input' });
}
