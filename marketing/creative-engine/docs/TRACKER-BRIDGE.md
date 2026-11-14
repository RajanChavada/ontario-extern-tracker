# Tracker bridge: carousels backed by the Extern Tracker's data

Posting facts never get typed into a carousel. A **campaign** names tracker entries; the bridge
builds the facts from `data/hospitals.json` (repo root) plus the newest saved capture of each
hospital's own posting, and the engine renders only what both agree on.

```bash
cd marketing/creative-engine
export CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   # or npx playwright-core install chromium
node bin/oet.mjs check specs/tracker/wch-nov20.json   # factual only, no browser
node bin/oet.mjs build specs/tracker/wch-nov20.json   # factual → render + visual QA → publish artifacts
```

## Inputs (the only sources of truth)

| Input | Where | What it decides |
|---|---|---|
| Tracker data | `data/hospitals.json` (`--data`) | Which postings exist, status, closing date, pay, positions, eligibility, BCLS, listed items. The same `status()` the website uses decides whether a posting is open today. |
| Saved captures | `--evidence <dir>` (repeatable), else `$OET_EVIDENCE_DIR`, else `../../research/raw/manual` next to this repo | The verbatim line backing each value, and the verification date. A capture is a `.txt`/`.md` file starting `URL: <official page>` / `CAPTURED: YYYY-MM-DD[ HH:MM]`. |

Captures stay outside this repository (they are research material). Save a new one whenever you
re-check a posting; the bridge always uses the newest *readable* one per URL.

## A campaign

An engine content spec (see `AGENT.md`) plus a `tracker` block, and **no** posting facts:

```json
{ "id": "wch-nov20", "status": "verified", "theme": "wine",
  "tracker": { "entries": ["wch", "shn"] },
  "slides": [ { "layout": "deadline", "fact": "wch-deadline",
                "details": [ { "label": "Pay", "fact": "wch-pay" } ] }, … ],
  "caption": { … } }
```

Generated fact ids, per entry `<id>`:

| Fact | When it exists | Value |
|---|---|---|
| `<id>-deadline` | entry has a `deadline` | the date; the capture must show it on a closing line |
| `<id>-pay` | `pay_text` | exactly `pay_text`; every number must be on one capture line with `$` |
| `<id>-vacancy` | `open_vacancies` / `open_talent_pool` | "N positions listed", "posted for an existing vacancy" or "talent pool, not a current vacancy" |
| `<id>-eligibility` | `eligibility.programs` | e.g. "BScN, year three or final year" (years in words, so 3 vs "third" can't slip) |
| `<id>-bcls` | `eligibility.bcls === true` | "BCLS required". A posting that doesn't mention BCLS gets **no** fact |
| `<id>-listed-N` | `eligibility.also_listed[N-1]` | the item text; needs every number and ¾ of its words on one line |

Only facts the slides cite are kept (so the receipts slide lists what's shown). Every fact's
`verifiedAt` is the **capture date**, so the engine's freshness rules (deadline/vacancy 7 days,
pay/eligibility 30) apply to when someone actually looked.

General or educational carousels (no `tracker` block) pass through unchanged and use their own
`program`/`stat` facts, e.g. `specs/examples/explainer-what-is-an-extern.json`.

## Factual check: what makes a campaign unpublishable

Errors (the entry's facts are withheld; nothing renders):

| Code | Meaning |
|---|---|
| `ENTRY_NOT_OPEN` | The website shows this entry as closed, unconfirmed, stale or not open today |
| `NO_JOB_ID`, `DUPLICATE_JOB_ID` | The linked URL names no specific posting, or a job is linked twice |
| `NO_CAPTURE`, `CAPTURE_UNREADABLE` | No saved capture, or every capture is a block page / nearly empty |
| `CAPTURE_SAYS_REMOVED` | The newest readable capture says the posting is gone ("doesn't exist", "no longer available"). Fix `hospitals.json` first |
| `JOB_ID_CONFLICT` | The page prints a different job number than the URL |
| `DEADLINE_CONFLICT`, `DEADLINE_NOT_IN_CAPTURE` | The capture's closing line names another date, or none |
| `PAY_/VACANCY_/ELIGIBILITY_/BCLS_NOT_IN_CAPTURE` | The tracker value can't be found on the page as stated |
| `HAND_WRITTEN_JOB_FACT` | A deadline/pay/eligibility/vacancy fact was typed into the spec |
| `UNKNOWN_ENTRY`, `FACT_NOT_AVAILABLE` | Unknown entry id, or a slide cites a value the tracker doesn't have |

Warnings: `NEWEST_CAPTURE_UNREADABLE` (fell back to an older readable capture, dated as such),
`EVIDENCE_OLDER_THAN_DATA`, `LISTED_ITEM_NOT_IN_CAPTURE` (that item can't be cited).

After the bridge, the engine's own fact rules run (unsupported numbers or dates in slide text or
captions, outcome promises, stale facts, expired deadlines). All of this happens before a browser
opens. **Visual QA** (overflow, safe areas, contrast, minimum text size, collisions) runs only at
render time, and is reported separately in `out/<id>/validation.json` and each artifact.

## Known limits

- Matching is deterministic text search. It proves a value appears on the page, not that the
  sentence means what the tracker says; the receipts slide and human approval cover that.
- An entry whose tracker value combines several postings (Humber's "$17.60/hr ($17.95/hr on 10 East
  & West)") can't be matched to one capture, so it is refused rather than guessed.
- Posted closing **times** (e.g. WCH "11:59 PM") are not in `hospitals.json`, so slides show the date only.
- Captures are only as fresh as the last time someone saved one. Re-capture every posting a post
  names on the day you build it.
