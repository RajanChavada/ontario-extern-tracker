# Data workflow: how a hospital posting gets onto ontarioexterns.ca

This describes the process as it runs today: manual, with tested guard rails. The proposed watcher (docs/WATCH-DESIGN.md) only adds a step-1 signal. Every other step stays the same.

```
discover a lead → verify on the hospital's own page → edit data/hospitals.json
  → tests + check-data → push preview/* branch → review the preview URL
  → merge the PR to main → Cloudflare builds and deploys automatically
  → statuses then change by date in the visitor's browser (no redeploy needed)
```

## 1. Discovery: where leads come from
A lead is anything that suggests a posting exists or changed. **A lead is never a source.**
- **Official boards of tracked hospitals:** re-checked at least every 7 days (see §5, staleness). Search the board for "extern", not just the known posting URL. New postings often appear beside the old one, e.g. Humber has one posting per unit.
- **Aggregators:** Glassdoor, Indeed, jobs.ca, SimplyHired, Workopolis. Useful for spotting hospitals we don't track; the Nov 10 check found five this way.
- **Students:** corrections from feedback, DMs and replies.
- **Community threads:** e.g. r/OntarioNurses.

## 2. Verification: what counts as a source
- Only the hospital's own careers site or its ATS counts: Workday, iCIMS, Oracle, Dayforce, Njoyn, Talcura, SmartRecruiters, Taleo, AppOne, Infor, or a page on the hospital's domain.
- Open the posting itself and record in our own words (never paste posting text):
  - **posting type:**
    - a number of positions stated → `open_vacancies` + `positions_listed`;
    - "talent pool" or "not a specific vacancy" → `open_talent_pool` + `pool_note`;
    - neither → `open_unspecified`;
  - **closing date:** the date only, exactly as shown. Never add a time. `null` if none is shown;
  - **pay:** copied exactly into `pay_text`, or `null`;
  - **eligibility:** per program (BScN / PN / IEN), year rules as written (`minYear`/`maxYear`, `finalYearOnly`, `anyYear`, `semantics: "entering"`), `bcls: true` only when BCLS is required. Other certifications (CPR, BLS) go in `also_listed`. Use `check: true` with a `note` when the wording is ambiguous.
- Keep a dated text capture of the page outside this repository, so every fact can be traced.
- Hard to read:
  - Workday, Dayforce, Oracle and Talcura need a real browser;
  - iCIMS works with `?in_iframe=1`;
  - Njoyn (North York General, Michael Garron) puts a bot check in front of automated browsers.

## 3. The data file
`data/hospitals.json` is the single source the site reads:
- one entry per hospital programme;
- `dataset_checked` = the last day every entry was checked (never later than the oldest `last_verified`; shown as "Last full check");
- each entry's `last_verified` = the day that entry was checked on the official page.

`scripts/build-ics.mjs` regenerates `cal/<id>.ics` for entries with a closing date. `build-dist.mjs` runs it.

**Rules enforced in code** (`validateData` in `assets/logic.js`; the build fails if any is broken):
- an Open status needs a `posting` as its source, never a program page;
- `positions_listed` is only allowed on `open_vacancies`, and must be an integer;
- every required field is present, and every posting type is known.

## 4. Testing
Run all three before pushing:
```
npm test                        # dates, deadlines, staleness, eligibility, calendar files, build output, stale-data blocking
node scripts/check-data.mjs     # what each entry shows today, and which entries are due for re-checking
node scripts/build-dist.mjs     # production-equivalent build with leak scan
```
- Tests that state real-data facts (e.g. "THP is any year") must be updated in the same commit as the data. A failing fact test means either the data changed or the test is stale. Decide which deliberately.
- Carousel posts restate data facts. `node marketing/carousel/render.mjs <post>` refuses to render a post whose facts no longer match the data. Re-run it after every data change and fix any post that fails before it's published again.

## 5. Date-based status (automatic, in the visitor's browser)
`status()` in `assets/logic.js` runs on every page view using today's date in Ontario (America/Toronto). This happens with no redeploy:
- **Closing day is still open.** On the day after `deadline`, an entry shows **Closed**. Example: NYGH closes Nov 16, so it shows Closed on Nov 17.
- **Staleness.** Once today − `last_verified` ≥ `stale_after_days` (7), an entry shows **Unconfirmed**, whatever it said before. An unchecked entry never keeps saying "Open".
- `source_ok: false` → **Unconfirmed** immediately.
- **Sorting:** listed positions → live postings → talent pools; nearest closing date first; then not open / no live posting / unconfirmed / closed.

So closings take care of themselves, but **every entry needs re-verifying at least every 7 days**, or it goes Unconfirmed.

## 6. From reviewed update to production
1. Commit on a `preview/<topic>-<date>` branch and push it. Cloudflare builds a preview at `https://<branch-slug>.ontario-externtracker.pages.dev`. Previews have analytics off and noindex.
2. Rajan reviews the preview and the PR diff. For data changes, the diff of `data/hospitals.json` is the review.
3. Merge to `main` → **Cloudflare deploys to ontarioexterns.ca automatically** (automatic production deploys are enabled).
4. **Production guard:** a `main` build fails if any listing would be shown as open (taking applications) on a check more than 2 days old, if the whole dataset (`dataset_checked`) is more than 7 days old (backstop: by then every entry shows Unconfirmed anyway), if any test or data check fails, or if the leak scan finds private paths, `JobPosting` markup or unexpected files. A failed build leaves the previous version live. This applies to *any* merge, including non-data ones. Listings shown as Closed, Not open now or Unconfirmed don't block a deploy, so a correction can ship while another hospital's board can't be re-checked.
5. Spot-check after deploy: the live JSON shows the new `dataset_checked`; the changed rows render correctly on a phone.
