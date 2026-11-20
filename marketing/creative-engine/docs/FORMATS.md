# Formats C and B

Formats C (primary) and B (complementary) were approved by Rajan on 2026-11-14, with revisions, in the
reference package `oet-hermes-package/` (HANDOFF.md, copy-deck.json, asset-register.json,
reference/final-reference.html). The engine reproduces both. Nothing here publishes anything.

| | Format C: student-made hybrid | Format B: saveable guide |
|---|---|---|
| Use for | relatable explainers that should feel made in TikTok's own editor | requirements, timelines, decoders, checklists people save |
| Layouts | `c_photo`, `c_notes` (notes card over a blurred photo), `c_paper` (lined paper + sticky tags) | `b_cover`, `b_card` (numbered reference card), `b_cta` |
| Reference spec | `specs/formats/c-what-a-clinical-extern-is.json` | `specs/formats/b-what-a-clinical-extern-is.json` |

The two reference specs carry identical copy, facts, sources and caption. A test compares them with
`test/fixtures/formats/copy-deck.json`, which is the package's file, byte for byte.

## Campaign default: format C (since 2026-11-14)

`oet check / build / export` (tracker campaigns and every Grokbot export) treat a spec as `"format": "c"` unless it says
otherwise. If the slides don't render in the requested format, the check fails with `FORMAT_NOT_RENDERED`. It never falls
back to the flat classic layouts.

- Relatable TikTok posts, including hospital deadline announcements: format C (`c_photo`, `c_notes`, `c_paper`).
  Example: `specs/tracker/wch-closes-nov20-c.json`.
- Dense educational or reference carousels: `"format": "b"` with `b_*` layouts.
- Classic layouts only on purpose: `"format": "classic"`. Published classic specs (`wch-closes-nov20.json`, the
  `what-is-an-extern` post) keep `"format": "classic"` so they rebuild exactly.
- Time-sensitive posts show the deadline on the cover (`DEADLINE_NOT_ON_COVER`): the date must be visible in the hook or
  in a short secondary line (`body`), and the cover must cite the deadline fact. Covers allow a 12-word hook plus 10
  words of secondary text and asides; the generated source line isn't counted.
- What to write (hooks, structure, briefs, honesty): docs/CONTENT.md.
- After rendering, every photo slide must carry its registered photo in the render manifest (`PHOTO_LAYER_MISSING`).
  The tests also check the rendered PNGs themselves: no photo slide may be a flat background.

Why: the first Women's College post (`oet-2026-11-14-wch-closes-nov20`) was built from a spec copied from the
pre-format tracker example (classic `hook` / `deadline` / `big_stat` / `checklist` / `cta` on the wine theme). Nothing
asked for a format, so it rendered flat without any warning.

## Make a carousel

```bash
cd marketing/creative-engine
export CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cp specs/formats/c-what-a-clinical-extern-is.json specs/posts/<new-id>.json   # or the B spec
# edit id, title, slides, facts, sources, caption
node bin/creative.mjs validate specs/posts/<new-id>.json            # facts, imagery, voice, density
node bin/creative.mjs render   specs/posts/<new-id>.json            # 1080x1920 + 1080x1350 (defaults)
node bin/creative.mjs render   specs/posts/<new-id>.json --platform tiktok-3x4   # opt-in 3:4 candidate
node bin/creative.mjs layouts                                        # every layout, incl. C and B
```

Output goes to `out/<id>/<platform>/NN-<layout>.png`, plus `preview/` (UI overlay), a contact sheet per platform
and `manifest.json`. Photo slides list their provenance under `slides[].assets`.

Export to Grokbot is unchanged: `node bin/oet.mjs export <spec> --post-id <new id>` (TikTok 1080x1920 only).

### Format C slide fields

- `c_photo`: `photo` (registry id), `title`, optional `titleTail` (the handwritten end of the headline), `body`, `fine`,
  `mark` `{kind: circle|highlight, phrase, in: title|body}`, `asides` (handwritten, cover or CTA only),
  `place` (`auto` = the photo's registered `quiet_area`), `nudge` (±10 px).
- `c_notes`: `photo` (shown blurred), `label`, `title`, `body`, `mark`.
- `c_paper`: `title`, `body`, `tags` (up to three).

### Format B slide fields

- `b_cover`: `photo` (a study desk: no people), `title`, `sticker`. A trailing `(…)` in the title gets its own line.
- `b_card`: `chip`, `icon` (one of hospital, clipboard, calendar, handshake, briefcase), `title`, `body`, optional `color`
  (rose, teal, violet, amber, blue). By default the colours follow the card number.
- `b_cta`: `title`, `site`, `body`, `fine`, `footer`.

Source lines are generated from each slide's facts, for example "Source: Ontario Health, Enhanced Extern Program page,
updated June 4, 2026". Use the source's `label` and `updated` fields; posting facts (deadlines, pay,
eligibility, vacancies) also get ", checked <date>". Covers and CTAs about the tracker show fine print instead.

## Rules the validator enforces

**Errors:**

- **Photo provenance:**
  - every photo must be in `assets/registry.json`, with source, page URL, photographer, licence URL and check date;
  - no guardrail flags (clinical tools, badges or IDs, patients or clinical settings, third-party screens, legible logos);
  - identifiable faces only under the registry's `face_policy` (owner approval, 2026-11-18) and only on photos marked `stock_person_not_student: true`. Stock models are never captioned as students, nurses or externs, never carry first-person lines, and are never implied to run the account. B covers may use them too. Check that the cover title doesn't sit over a face;
  - the file's sha256 must match the registry;
  - blur-only assets can't be used unblurred;
  - no photos from the rejected list;
  - no people on a B cover.
- **Annotations:**
  - at most two asides per carousel, on the cover or the CTA only;
  - asides never carry money, dates or counts (`titleTail` is checked the same way);
  - one word-mark per slide, and it must appear in the slide's text.
- **Voice:**
  - no first-person student claims ("I got", "my extern", "I landed", "my first", …) in slides or captions, in any format;
  - no first-person copy over a stock photo;
  - alt text must never call a pictured stock model a student, nurse or extern.
- **Format:**
  - one format per carousel;
  - C allows at most two designed slides and at most one emoji per slide;
  - density: covers up to 12 words; inner slides up to 40 words in C and 45 in B, counting the source line and fixed labels.
- **Reply sticker:** `hook` with `variant: "reply"` fails with `REPLY_STICKER_RETIRED`. The two examples that used it now have plain hooks.

**Warnings:**

- `SAME_SHOOT`: two photos from one shoot in a carousel (editorial preference, decision 3).
- `SAME_COMPOSITION`: adjacent photo slides with the same composition.
- `CLINICAL_EMOJI`, `VOICE_CASE`.

**Visual QA (in the browser):**

- All existing checks apply: safe area, minimum 30 px, contrast, overflow, line breaks, overlap, mark collision, emoji and fonts.
- New checks:
  - text directly on a photo with no caption box and no outline → `TEXT_ON_PHOTO`;
  - outlined text is contrast-checked against its outline;
  - word-circles use the reference geometry and are checked word by word (`MARK_COLLISION`);
  - photos smaller than the canvas → `PHOTO_RESOLUTION` warning.

## Platforms

Defaults are unchanged: TikTok 1080x1920 and Instagram 1080x1350. `tiktok-3x4` (1080x1440) is a **candidate**:

- it renders only when a spec lists it or `--platform` asks for it;
- it uses the package's provisional margins (left 72, top 80, right 140, bottom 170);
- it never gets a publish artifact;
- it can't be exported to Grokbot, whose project requires exactly 1080x1920.

C and B sizes are the reference's 3:4 pixels times `--cu`, so 3:4 matches the reference exactly and 9:16 and 4:5 scale (0.988, 0.95).

## Interpretation decisions (where the reference left room)

1. **"(ontario edition)" is the headline's handwritten tail (`titleTail`), not an aside.** The copy deck lists it in
   the headline, while the reference draws three handwritten elements against a rule of at most two asides. Treating it as part of the
   headline keeps the reference and the rule; the tail is still checked like an aside.
2. **Ontario Health's date is "Last Updated", not a publish date.** The source uses `updated: 2026-06-04`, and the
   line reads "updated June 4, 2026", as in the reference.
3. **Facts carry verbatim quotes** from the saved Nov 14 captures, so `oet export` can re-check them live. The copy deck had
   claims only.
4. **Headline line breaks** follow the engine's existing rule: no line ends on a short word ("an", "is"). C2, C3 and
   B3 therefore break one word earlier than the reference. The B cover keeps "(ontario edition)" on its own line, as in the reference.
5. **Icons are Twemoji**, the engine's emoji font, rather than the Apple emoji in the reference screenshots.
6. **C4's text block starts at y 630** (reference 640, spec range 620–640), so it fits without shrinking at 3:4.
7. **The `composition` field (hands/object/scene)** was added to the registry by Hermes from the images. Claude's register has no such field.
8. **C/B alt text drops pictographs and arrows**: icons, stickers and "↓" are decoration.

## Content corrections after approval (Rajan, 2026-11-14)

- **C2's notes label is "extern notes 📝"**, not "extern notes 🩺". A stethoscope is a clinical tool, and externs work in
  unregulated care provider roles.
- **C6 uses pexels-2440970 (glasses on a notebook, no people)** instead of pexels-5965524 (two people walking on campus).
  Under "some externs get hired into permanent positions", a photo of people could read as those people being externs who were
  hired. The claim and highlight are unchanged. This leaves C6 and C7 as two desk photos in a row, which the
  validator flags as a `SAME_COMPOSITION` warning (editorial only).
- **The caption separates the sources.** "The program facts are from Ontario Health's … page", and ontarioexterns.ca is "our own
  independent tracker". The deck's "every fact here is from Ontario Health" was wrong for the CTA slide.
- **Every unblurred C photo gets the format's one grade** (HANDOFF §2), whatever its registry `treatment`, which describes
  where the asset was first used. B covers stay ungraded.
