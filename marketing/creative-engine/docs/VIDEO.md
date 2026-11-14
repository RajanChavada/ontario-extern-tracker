# From carousels to short video

Not built yet, on purpose: the carousel renderer comes first. This is the plan, and the
reasons the current structure already supports it.

## What carries over unchanged

- **The content spec.** It is platform-agnostic: slides, facts, sources, caption. A video
  is the same story told over time, so the same spec (and the same verification) applies.
- **The slide components.** `src/ui/Slide.js` and `src/ui/layouts.js` are plain React with
  no build step. Remotion compositions are React, so each slide can be mounted as-is
  inside a `<Sequence>`.
- **The stylesheet and fonts.** Load `src/ui/styles.css` and the three font packages in
  the Remotion entry point; use the `tiktok` platform geometry (1080×1920).

## What needs adding

1. **A composition** that maps `spec.slides` to `<Sequence>`s with a duration per slide
   (default about 2.5 s, longer for slides with more words; reading speed, not a timer).
2. **The browser runtime as a hook.** `fitDrawAndCheck` in `src/render/runtime.js`
   fits type and draws marker marks after layout. In Remotion, call the same function
   from `useLayoutEffect` once fonts are ready (`delayRender` / `continueRender`), so the
   video frames match the carousel slides exactly.
3. **One motion idea per slide**, driven by `useCurrentFrame()`:
   caption boxes appear one by one; marker circles and arrows draw on (animate
   `stroke-dashoffset` on the paths the runtime already creates); wristbands slide in in
   date order. Keep it to that: one orchestrated moment beats constant movement.
4. **Optional spec fields**, added to the schema when needed and ignored by the carousel
   renderer: `durationSec` per slide, `voiceover` text, `music` (a licensed track id).
5. **QA on stills.** Render the last frame of each sequence with the carousel QA pass;
   that frame is the slide, so the same checks apply.

Start with a single `remotion/` folder that imports from `src/`; don't fork the components.
