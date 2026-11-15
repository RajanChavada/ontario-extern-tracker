# creative-engine

Spec-driven TikTok and Instagram carousel renderer for Ontario Extern Tracker.
An agent (or a person) writes a JSON **content spec**; the engine checks the facts,
renders every slide for both platforms, runs visual QA in a real browser, and writes
a manifest a publishing step can trust. No code changes per post.

Agents: read [AGENT.md](AGENT.md) first.

**Posts about specific hospital postings go through the tracker bridge** (`bin/oet.mjs`): facts come from
`data/hospitals.json` plus saved captures of the hospitals' own pages, never from hand-typed specs.
See [docs/TRACKER-BRIDGE.md](docs/TRACKER-BRIDGE.md). Output for a future supervised publisher (one
artifact per platform, with approval bound to the exact images and caption): [docs/PUBLISH-CONTRACT.md](docs/PUBLISH-CONTRACT.md).

**Grokbot handoff:** `node bin/oet.mjs export <spec> --post-id <id>` writes a manifest-v1 package to
`~/AgentHandoff/publishing/inbox/<project>/<post_id>/` (READY.json last, atomic). See [docs/GROKBOT-HANDOFF.md](docs/GROKBOT-HANDOFF.md).

## Quick start

```bash
cd creative-engine
npm install
npx playwright-core install chromium      # once per machine (or set CHROMIUM_PATH)

node bin/creative.mjs render specs/examples/explainer-what-is-an-extern.json
npm test                                   # fact rules + rendering tests (~15 s)
npm run examples                           # re-render all examples into out/examples
```

Output for a spec with id `my-post`:

```
out/my-post/
  manifest.json                 verification, QA, captions, alt text, file hashes
  tiktok-contact-sheet.png      every slide at a glance, QA flags under each
  instagram-contact-sheet.png
  tiktok/01-hook.png …          1080×1920 finished slides
  tiktok/preview/01-hook.png …  same, with TikTok's interface and the safe area drawn on
  instagram/01-hook.png …       1080×1350 finished slides
  instagram/preview/…           with the 1/N counter and the profile-grid 3:4 crop
  */_html/                      the exact HTML each slide was rendered from (debugging)
```

## How it works

```
spec.json ─► parse (zod, strict) ─► prepare (defaults, auto receipts slide)
          ─► verify (fact rules)  ─► for each platform, for each slide:
                React component → HTML → Chromium → fit type → draw marker marks
                → QA (overflow, safe area, contrast, size, line breaks, collisions,
                  emoji, fonts) → PNG + interface preview
          ─► contact sheets + manifest.json
```

| Path | What it is |
|---|---|
| `bin/creative.mjs` | CLI: `validate`, `render`, `check-sources`, `layouts`, `schema` |
| `src/spec/schema.js` | The content spec (zod). `schema/content-spec.schema.json` is generated from it |
| `src/spec/verify.js` | Fact rules: sources, quotes, freshness, expired deadlines, unsupported specifics, outcome claims |
| `src/spec/ontario-hospitals.js` | Real hospital names, so demo content stays fictional |
| `src/ui/layouts.js`, `Slide.js` | The 12 slide layouts as React components (written with `htm`, no build step) |
| `src/ui/styles.css` | The whole visual system |
| `src/themes.js`, `src/platforms.js` | Colour tokens; canvas sizes and safe areas |
| `src/render/runtime.js` | Runs in the browser: auto-fit, hand-drawn marks, QA, interface overlay |
| `src/render/render.js` | Orchestration, contact sheets, manifest |

Dependencies are pinned and small: React, htm, zod, playwright-core, and three font
packages (TikTok Sans, Caveat Brush, Twemoji). Fonts load from `node_modules`, so a
render looks the same on every machine.

## The visual system: "Shift Report"

The previous generator read as a professional deck. This one is built from the
material world of a nursing student on a hospital unit, typeset in TikTok's own font,
so posts look native to the feed rather than designed for a boardroom.

- **Type.** [TikTok Sans](https://github.com/tiktok/TikTokSans) carries everything.
  Its width axis does the work: 150% wide black for hooks (giant stacked words),
  condensed for wristband print, regular for caption boxes. Caveat Brush plays the
  dry-erase marker. Twemoji renders emoji identically everywhere.
- **Colour.** Scrub colours, not brand gradients: ceil blue, wine, caribbean, plus the
  whiteboard. Text on caption boxes is true black on white, like the app's text tool.
- **Objects as formats.** Each storytelling format borrows a real object:
  wristbands for deadlines (band colour is urgency), the patient whiteboard for
  explainers, sticky notes for comparisons, TikTok's comment-reply sticker for hooks,
  an ID badge on a badge reel for announcements, and a receipt for sources.
- **Marker marks.** Circles, underlines and arrows are drawn at render time around
  the actual text, so they fit whatever copy the agent writes. The CTA arrow points
  at the real save/follow/comment/share button for each platform.
- **Restraint.** No fake 01/02/03 numbering, no all-caps eyebrows, no card grids.
  One loud element per slide.

### Layouts

`node bin/creative.mjs layouts` prints the current list. In short: `hook` (reply,
count, versus or plain), `text_stack`, `big_stat`, `board`, `checklist`, `wristbands`,
`deadline`, `versus`, `phone`, `badge`, `receipts` (auto-added), `cta`.

### Platforms and safe areas

| | Canvas | Safe box (left, top, right, bottom margins) |
|---|---|---|
| TikTok | 1080×1920 | 72, 210, 150, 460: clear of tabs, the right action rail and the caption block |
| Instagram feed | 1080×1350 | 84, 110, 84, 110: clear of the 1/N counter and the 3:4 profile-grid crop |

Layouts are designed against the safe box. Every size is `N × --s`, where `--s` is
the platform unit times an auto-fit factor, so the same layout adapts to both boxes
and shrinks evenly (down to 70%) when copy runs long. Text below 30px never ships.

The TikTok button positions in `platforms.js` are measured estimates. Check them
against a real screen recording when the app's layout changes.

## Fact rules

`validate` and `render` refuse a spec when:

- a fact or source reference doesn't resolve, or a fact has no source;
- a deadline, pay, eligibility or vacancy fact lacks a **primary** source (the
  hospital's own page) or a verbatim **quote**, or its value has numbers the quote doesn't;
- a deadline has passed, or a fact is older than its kind allows (7 / 30 / 180 days);
- slide or caption text contains money, dates, percentages or counts that no cited fact states;
- a slide states information without citing facts (`basis: "advice"` opts out, and then it
  may not contain specifics);
- text promises an outcome ("guaranteed", "you'll get hired") or says "now hiring"
  without an open vacancy;
- a demo spec puts sample postings next to a real hospital's name.

Demo specs (`status: "demo"`) skip the source requirements but get a "sample data"
stamp on every slide and `publishable: false`. Citation lines and the receipts slide
are generated from the facts, so they can't be forgotten or contradict the data.

`check-sources` re-fetches each primary source, reports pages that are gone or say the
posting closed, and confirms the quote still appears (pages built with JavaScript,
such as some applicant tracking systems, can't be confirmed this way and get a warning).

## Visual QA

Runs in Chromium on every slide after fonts load and type is fitted. Errors fail the
render: content that doesn't fit, text outside the safe box, contrast below WCAG
(4.5:1, or 3:1 for large text), text under 30px, words split across lines,
overlapping text, marker marks crossing other text, mock app text clipped by the
phone, blank emoji, missing fonts or images. Warnings: auto-fit applied, dense
slides, headline orphans and dangling short words, near-miss alignment.

Before QA, the runtime fixes what it safely can: it binds a short word stranded at a
line end ("the", "of") to the next word, and a lone last word to the one before,
undoing either if it would overflow.

## Extending

- **New layout:** add a component to `src/ui/layouts.js` and register it in
  `LAYOUT_COMPONENTS`; add its schema to `src/spec/schema.js` (and a line in
  `LAYOUTS`); add CSS; list its free-text fields in `slideTexts()` in `verify.js` so
  they're fact-checked. Render the examples and look at the previews.
- **New theme:** add tokens to `src/themes.js`. QA will fail the render if any text
  pairing lacks contrast.
- **New platform:** add a canvas, safe area and button targets to `src/platforms.js`.
- **Video:** see [docs/VIDEO.md](docs/VIDEO.md).

## Known limits

- The phone layout's built-in mock is illustrative; use `screen.image` with real
  screenshots for anything published.
- Fact checks are deterministic text rules. They catch invented numbers and dates, not
  every false sentence. That is what primary sources, quotes and human approval are for.
