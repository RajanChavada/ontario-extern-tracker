# Operating guide for agents

You produce TikTok and Instagram carousels for Ontario Extern Tracker by writing a
**content spec** (JSON) and running the CLI. You never edit code to make a post.
A human approves every post before it is published.

## The loop

```bash
cd creative-engine
node bin/creative.mjs layouts                      # what you can use
node bin/creative.mjs validate specs/my-post.json  # fact rules only, fast
node bin/creative.mjs render   specs/my-post.json  # images + QA + manifest
node bin/creative.mjs check-sources specs/my-post.json  # optional: re-fetch primary sources
```

Exit code `0` means done, `1` means the spec or the render has errors (read them,
fix the spec, run again), `2` means you called the CLI wrong. Add `--json` for
machine-readable results. Each error has a `code`, a `where` and usually a `fix`.

After a clean render, open the contact sheets (`out/<id>/tiktok-contact-sheet.png`,
`instagram-contact-sheet.png`) and the interface previews (`out/<id>/<platform>/preview/`)
and look at every slide. QA catches overflow, clipping, contrast, collisions and bad
line breaks; it does not judge whether the post is good. If a slide is dense
(`DENSE` warning) or reads poorly, shorten or split it.

Hand off `out/<id>/manifest.json`. Publish nothing unless `manifest.publishable` is
`true` **and** a human approved it, and never after `verification.postBy`.

## Posts about specific postings

For anything naming a hospital posting (deadline, pay, eligibility, vacancies), write a campaign in
`specs/tracker/` with a `"tracker": {"entries": [...]}` block and cite the generated fact ids
(`<entry>-deadline`, `-pay`, `-vacancy`, `-eligibility`, `-bcls`, `-listed-N`). Run
`node bin/oet.mjs check` then `build`. Hand-typed posting facts are refused. See docs/TRACKER-BRIDGE.md.

## Formats C and B

Posts are `"voice": "brand"` (default) or `"student"` (first person, Rajan; claims only from workspace/voice/voice-profile.json; see docs/CONTENT.md). Write marketing posts hook-first (docs/CONTENT.md): relatable hook → value → the Ontario posting as the real example → CTA, with a `brief` (candidate hooks, why, payoff, research evidence). Reference: `specs/tracker/shn-talent-pool-explainer.json`.
Campaigns (`oet`) default to format C and fail with `FORMAT_NOT_RENDERED` if the slides are another format; deadline posts start from `specs/tracker/wch-closes-nov20-c.json`. Set `"format": "b"` for dense reference posts and `"format": "classic"` only on purpose.
For new carousels, start from `specs/formats/c-what-a-clinical-extern-is.json` (format C, primary) or the B spec,
and read [docs/FORMATS.md](docs/FORMATS.md). Photos come only from `assets/registry.json`: never add an
unregistered image, never call a stock model a student, nurse or extern, and never write first-person copy over a photo.

## Rules that are not negotiable

1. **Never invent** a posting, deadline, pay rate, eligibility rule, vacancy count or
   application outcome. If you can't find it on the hospital's own page, it doesn't go in.
2. **Deadlines, pay, eligibility and vacancies** need the hospital's own careers page or
   job system as a source (`"primary": true`), plus a short verbatim `quote` copied
   from that page. Job boards and aggregators are leads, not sources.
3. Put the number in the fact's `value` exactly as the quote states it. The verifier
   checks that every number in `value` appears in `quote`.
4. Set `verifiedAt` to the day you actually looked. Deadline and vacancy facts expire
   after 7 days, pay and eligibility after 30, program facts after 180.
5. Never promise outcomes ("guaranteed", "you'll get hired"). Never say "now hiring"
   without an open vacancy or deadline fact on that slide.
6. If a posting says it is a talent pool ("not for an existing vacancy"), set
   `"status": "talent-pool"` and say so. Don't present it as an opening.
7. If you can't verify something, use `"status": "demo"` with fictional organisations.
   Demo posts are stamped "sample data" on every slide and can never be published.

## Writing a spec

Start from the closest example in `specs/examples/`:

| You want | Start from | Theme idea |
|---|---|---|
| Deadline roundup | `demo-roundup-closing-soon.json` (swap in verified facts) | `wine` |
| Explainer | `explainer-what-is-an-extern.json` | `ceil` |
| Comparison | `comparison-same-title-fine-print.json` | `board` |
| Product demo or community post | `demo-product-and-community.json` | `caribbean` |

Shape:

```jsonc
{
  "$schema": "../schema/content-spec.schema.json",
  "id": "roundup-2026-11-20",           // lowercase, hyphens; becomes the output folder
  "title": "Internal title",
  "status": "verified",                  // or "demo"
  "theme": "wine",                       // ceil | board | wine | caribbean
  "slides": [ /* 4–9 slides; first is usually "hook", last "cta" */ ],
  "facts":   [ /* every claim, with sources */ ],
  "sources": [ /* where the facts came from */ ],
  "caption": { "text": "…", "hashtags": ["#nursingstudent"] }
}
```

A deadline fact:

```json
{
  "id": "kbh-extern",
  "kind": "deadline",
  "claim": "Kestrel Bay Hospital's Clinical Extern (Nursing) posting closes November 20, 2026 at 10:00 AM.",
  "org": "Kestrel Bay Hospital",
  "role": "Clinical Extern (Nursing)",
  "date": "2026-11-20",
  "time": "10:00 AM",
  "status": "open",
  "quote": "Closing Date: November 20, 2026",
  "sources": ["kbh-posting"],
  "verifiedAt": "2026-11-13"
}
```

Slides cite facts with `"facts": ["id", …]`; wristbands, deadline and versus slides
cite through their items. Layouts pull dates, values and organisations **from the
facts**, so the image can't disagree with the data. Source lines and the receipts
slide are generated for you.

A slide that gives general guidance and states no facts sets `"basis": "advice"`.
Product claims use `"basis": "promo"`. Anything else that states information must cite facts.

## Copy that works here

- Write like a classmate, not a hospital: lowercase hooks, plain words, one idea per slide.
- Hooks: 4–8 words. Caption boxes: one sentence each, at most 3 per slide.
- Use absolute dates ("closes Fri Nov 20"), never "closes in 3 days": posts get seen late.
- One or two emoji per slide at most. Marker notes (`note`) are for asides, not facts.
- End with one action (`save`, `follow`, `comment` or `share`); the arrow points at
  the real button for each platform.

## Reading QA results

| Code | Meaning | What to do |
|---|---|---|
| `OVERFLOW`, `OVERFLOW_X` | Copy doesn't fit even at 70% size | Shorten, or split the slide |
| `SAFE_AREA` | Text under TikTok/Instagram interface | Usually a layout bug: report it |
| `CONTRAST`, `MIN_FONT` | Hard to read | Report it; don't work around it |
| `MARK_COLLISION`, `OVERLAP` | Marker or text collides | Shorten nearby copy |
| `BROKEN_WORD` | A word split across lines | Shorten or rephrase |
| `EMOJI_MISSING`, `FONT` | Rendering environment problem | Run `npm install`; report if it persists |
| `AUTO_FIT`, `DENSE` (warnings) | Type was shrunk | Fine at `AUTO_FIT`; trim copy at `DENSE` |
