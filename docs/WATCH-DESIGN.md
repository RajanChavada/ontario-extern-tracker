# Proposal: scheduled discovery and change detection (not implemented)

**Goal:** stop relying on ad-hoc research requests to notice new, removed or changed postings, without a scraper platform, a database or a backend. The watcher **reports**; it never edits what the site shows. People still verify (docs/DATA-WORKFLOW.md §2) and merge.

## Shape
```
GitHub Actions (daily cron)
  └─ node scripts/watch.mjs           stdlib fetch only, ~1 min
       ├─ reads watch/sources.json     one adapter config per hospital board
       ├─ fetches each board, keeps postings whose title matches /extern/i
       ├─ normalises → {source, id, title, url, posted, closes?}
       ├─ diffs against watch/snapshot.json (committed, a few KB)
       └─ writes watch/report.md
  └─ if anything changed: open/update ONE GitHub issue "Watcher: changes to review"
     and commit the new snapshot to the `watch` branch (never main)
```
No hosted services, no secrets beyond the workflow's built-in `GITHUB_TOKEN`.

## What it flags (and what a person does next)
| Signal | Meaning | Human action |
|---|---|---|
| **NEW posting** | An extern posting id appears that isn't in the snapshot | Open it, verify, and add or extend the entry on a `preview/` branch |
| **REMOVED** | A tracked id has disappeared from its board | Open the URL. If expired, set `closed`. If moved, update `source_url` |
| **CHANGED** | Same id, but the title, posted date or closing date differs | Re-verify the changed fields |
| **PAGE CHANGED** | The normalised text hash of a program page (CHEO, SickKids, UHN, LHSC, HHS) differs, shown with the changed "extern" paragraphs | Read the diff, which may announce a new intake |
| **NEW HOSPITAL** | An extern posting on a watch-only board (a hospital not yet tracked) | Decide whether to add it |
| **COULDN'T CHECK** | A fetch failed (HTTP error, bot wall, layout change) | That board goes on the manual list for this week |
| **DUE** | Entries within 2 days of going Unconfirmed (from `check-data.mjs`) | Re-verify |

**Optional, low-risk automation (proposed, not assumed):** a separate weekly PR, "re-confirm unchanged". It bumps `last_verified` only for entries whose official feed still shows the same id, title and closing date. It touches nothing else and still needs a merge, so it saves the routine re-checks without publishing anything uncertain. Eligibility and pay are read from the posting body, which the feed doesn't expose, so they can't change silently. Still, a human re-reads each posting body at least every 4 weeks.

## Coverage, tested Nov 11, 2026 with plain HTTP (as GitHub Actions would see it)
| Hospital(s) | System | Machine-readable? | Adapter |
|---|---|---|---|
| Southlake, SHN | Workday | **Yes**: JSON `POST /wday/cxs/<tenant>/<site>/jobs` with `searchText: "extern"` | `workday` |
| Humber River, Mackenzie | iCIMS | **Yes**: search HTML with `in_iframe=1`. All 10 Humber job ids came back | `icims` |
| Trillium | Oracle Recruiting Cloud | **Yes**: JSON `recruitingCEJobRequisitions` finder (returned req 6976 plus 16 others) | `oracle` |
| Sunnybrook | Talcura | **Yes**: posting HTML | `page` (posting) |
| Holland Bloorview | AppOne | **Yes**: listing HTML | `page` (list) |
| Osler | SmartRecruiters | **Yes**: public postings API (0 "extern" postings today, as expected) | `smartrecruiters` |
| CHEO, SickKids, UHN, LHSC, HHS careers | program pages | **Yes**: HTML; diff the "extern" paragraphs | `page` (hash) |
| Women's College, Sinai | Dayforce | **No** with plain HTTP: jobs load client-side via a session-bound search API | manual, or a later headless-browser adapter |
| North York General, Michael Garron | Njoyn | **No**: Radware bot challenge, even in a headless browser | manual |
| Unity Health | Infor | **No**: redirects into a session | manual |

So about 13 of 18 boards can be watched automatically. Five go on a short **manual list** printed at the top of every report, about 5 minutes a week. Don't try to get past bot walls. If a hospital blocks automated access, we check it by hand.

## Files (all small, all in this repo)
- `watch/sources.json`: `{ id, hospital, tracked: true|false, adapter, params, match: "extern" }`. Adding a future hospital is one line. Use `tracked: false` for watch-only boards (new-hospital discovery).
- `watch/snapshot.json`: the last normalised result per source.
- `scripts/watch.mjs`: about 200 lines. Five adapters, a diff and a markdown report. Polite: one request per board per day, a real User-Agent naming the site, and no retries beyond one.
- `.github/workflows/watch.yml`: daily cron (e.g. 10:00 UTC = 05:00/06:00 Ontario), `permissions: issues: write, contents: write`. It must never push to `main`.
- Tests: adapters run against saved fixture responses (no network in `npm test`), plus a diff test for each signal type.

## Cost and risk
- **Cost:** GitHub Actions on a private repo includes 2,000 free minutes a month; this uses about 30. No paid APIs.
- **Breakage:** ATS layouts and endpoints change, as THP's move from iCIMS to Oracle showed. A broken adapter shows up as "COULDN'T CHECK", never as "no postings". Silence is never read as "nothing changed".
- **Accuracy:** nothing the watcher sees goes live without a person verifying it and merging. The site's own 7-day staleness rule stays the backstop.

## Rollout (each step needs approval)
1. Build `watch.mjs` with fixtures and tests, run locally, and show one report. *No schedule yet.*
2. Add the Actions workflow with the cron. **This is a recurring job and a change to repo settings, so it needs explicit approval.**
3. After 2 weeks, review: false alarms, missed changes, minutes spent. Then decide on the "re-confirm unchanged" PR.

## Step 1 status (built Nov 12, 2026; manual runs only, not scheduled)
- `node scripts/watch.mjs --report watch/report.md --write-snapshot` checks all 19 boards in about 5 seconds. It's sequential and makes one request per page.
- Tests: `tests/watch.test.mjs` (17 tests, no network). They cover parsers on saved official responses, new/missing/changed detection, page-sentence diffs, pagination, and the rule that **an unreadable, partially read or suspiciously empty board is listed as NOT CHECKED, never as unchanged, and never produces "removed" signals**.
- Samples: `watch/report-live-2026-11-12.md` is a real run against the current data, with nothing to review. `watch/sample-change-report-2026-11-12.md` is a real run against the pre-update data (`main` on Nov 12). It flags exactly the 11 postings the Nov 10–11 coverage update added by hand: Humber ×10 and Trillium 6976.
- The watcher doesn't write verification dates, doesn't edit `data/hospitals.json`, and has no schedule.
- Further testing (Nov 12):
  - **Stability:** a second live run minutes later against the saved snapshot showed 0 differences and no false page changes.
  - **Live failure injection:** a wrong Workday tenant (HTTP 422), a DNS failure and a moved page (HTTP 404) were all reported as NOT CHECKED with their last successful time. Their snapshots were carried forward unchanged, and none produced "removed" items.
  - **Page markers:** every page source now requires a marker phrase (`params.expect`), so an error or redesigned page can't pass as "no change". This came from Holland Bloorview's list, which has no extern lines today.
  - **Known quirk:** Oracle's search ignores the site number. Matching uses the requisition id, so results stay correct.
