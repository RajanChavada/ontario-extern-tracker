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

export const SlideSchema = z.discriminatedUnion('layout', [
  hook, textStack, bigStat, board, checklist, wristbands, deadline, versus, phone, badge, receipts, cta,
]);

export const LAYOUTS = {
  hook: 'Cover. Variants: reply (TikTok comment-reply sticker), count (number of deadline facts), versus (two labels + operator), plain.',
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
  accessedAt: isoDate,
  primary: z.boolean(), // true = the hospital / agency's own page
});

export const SpecSchema = z.strictObject({
  $schema: z.string().optional(),
  id,
  title: text(120),
  status: z.enum(['verified', 'demo']),
  theme: z.enum(THEME_IDS),
  platforms: z.array(z.enum(PLATFORM_IDS)).min(1).default(['tiktok', 'instagram']),
  demo: z.strictObject({ referenceDate: isoDate, reason: text(200) }).optional(),
  brand: z.strictObject({ name: text(40), handle: text(40).optional() }).default({ name: 'Ontario Extern Tracker' }),
  slides: z.array(SlideSchema).min(2).max(20),
  facts: z.array(FactSchema).default([]),
  sources: z.array(SourceSchema).default([]),
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
