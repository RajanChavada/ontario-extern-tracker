# Grokbot handoff (producer side, manifest v1)

Implements the Hermes half of Grokbot's publishing kit (`HERMES_HANDOFF.md`). The schema is vendored
byte-for-byte at `schema/grokbot/publish-manifest.v1.schema.json`; export refuses to run if the kit's
copy differs (`SCHEMA_DRIFT`).

```bash
cd marketing/creative-engine
export CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
export PUBKIT_PYTHON=/path/to/python-with-Pillow       # for the kit's bin/validate.py
node bin/oet.mjs export specs/posts/what-is-an-extern.json --post-id oet-2026-11-14-what-is-an-extern --supersedes test-001
```

Writes `~/AgentHandoff/publishing/inbox/<project>/<post_id>/`:

| File | What |
|---|---|
| `publish-manifest.json` | manifest v1: destination (TikTok `@ontarioextern`, `photo_carousel`, `only_you` by default), ordered assets with sha256/size/alt, caption + parsed hashtags, `source_verification`, `approval_state: not_requested`, fp1 `content_fingerprint`, `supersedes`, `notes` (source-check summary) |
| `assets/NN-<layout>.jpg` | the exact upload files: engine PNGs converted to 1080×1920 JPEG (quality 92) by Chromium |
| `contact-sheet.jpg` | for humans |
| `READY.json` | `post_id`, `manifest_sha256`, `asset_count`, `written_at`, **written last** |

## Order of operations

1. **Facts**: tracker bridge + engine fact rules (`oet check`). Educational specs pass through unchanged.
2. **Sources**: every fact's verbatim quote is looked up on its primary source, both in the newest saved
   capture and on the live page (`--offline` skips the live fetch). Invisible format characters
   (Ontario Health's U+2060 word joiner) are ignored; everything else must match exactly.
3. **Render** TikTok only, with the engine's visual QA.
4. **Export** into a hidden temp folder `.<post_id>.tmp-<pid>`: assets → contact sheet → manifest.
5. **Validate what's on disk** (schema, contiguous order, sha256 of each file, JPEG header size =
   1080×1920, alt text clean, caption LF/no trailing newline, hashtags = parsed from caption and the
   project's rules, sources verified and in date, no unlinked engagement wording, fp1 recomputed).
6. Write **READY.json** (last file), then run **Grokbot's own `bin/validate.py`** on the temp folder. The
   only failure allowed is `exact_approval_on_record`, so the verdict must be `APPROVAL_REQUIRED`.
7. **Atomic rename** of the temp folder to `<post_id>`. The folder appears complete, READY.json included.

Any failure at any step deletes the temp folder: nothing appears in the inbox, and no READY.json exists.
An existing `<post_id>` folder is never touched (`POST_ID_EXISTS`); a revision needs a new post_id with
`--supersedes`.

## What the producer never does

- It never approves or publishes, never sets `approval_state` to anything but `not_requested`, and
  never touches TikTok or Grokbot.
- It writes no credentials.
- It never exports demo specs (refused with `NOT_VERIFIED`).

## Known limits

- The hand-drawn marker (e.g. the circle on a `big_stat` slide) isn't byte-reproducible between renders.
  Re-exporting the same spec can change that slide's hash and so the fingerprint, which needs a new
  post_id. Approve the exact package you reviewed.
- `expires_at` is set from the engine's post-by date (the day before the earliest deadline), so it's
  null for posts that name no deadline.
