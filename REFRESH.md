# Data refresh checklist (about 20 minutes, every 2–3 days while the experiment runs)

Full process and rationale: docs/DATA-WORKFLOW.md. Also search each tracked hospital's board for "extern": hospitals add separate postings (one per unit, or a new intake) without changing the old URL.

The page marks every entry **Unconfirmed** once it's 8 or more days since it was checked. Nothing goes stale silently.

1. Run `node scripts/check-data.mjs` to see what each entry shows today and which are due for a check.
2. For each entry due for a check, open its `source_url` in a normal browser. Workday and iCIMS pages need JavaScript.
3. Confirm, in our own words (never paste posting text):
   - **Is the posting still live?** If it says "expired" or "no longer available", set `posting_type: "closed"` and add a short `window_text`.
   - **Vacancy or pool?**
     - Talent pool / "not for an existing vacancy" → `open_talent_pool`, with a `pool_note`.
     - States a number of positions → `open_vacancies`, with `positions_listed` set to exactly that number.
     - States neither → `open_unspecified`.
   - **Closing date:** use the date only (`deadline: "YYYY-MM-DD"`). Never add a time. If no date is shown, use `null`.
   - **Pay:** copy the posted rate exactly into `pay_text`, or use `null`.
   - **Eligibility:** year, program and BCLS as written. If the posting says "entering", set `semantics: "entering"`.
4. Set `last_verified` to today's date (Ontario).
5. If the page won't load: set `source_ok: false`. The tracker then shows **Unconfirmed**, which is correct.
   If the page loads for people but blocks our checks (e.g. Njoyn's CAPTCHA at North York General and Michael Garron)
   and nobody has checked it by hand: set `posting_type: "unconfirmed"` with an `unconfirmed_reason` that says when it
   was last seen and why it isn't re-checked, remove `positions_listed`, keep `source_url` and leave `last_verified` at the
   real date it was last seen. Never move `last_verified` for a page nobody read.
   Keep two cases apart: **we could not read it** (blocked, error) → `unconfirmed`; **we read the official board and
   it has no such posting** → `check_employer` with a `window_text` saying which board was searched and when (or `closed`
   if a posting we listed is gone). A clean search is a finding, not an unknown.
6. **New posting found** (e.g. the HHS official posting, or CHEO in February): add an entry with `source_kind: "posting"`. An "Open" status is only allowed with a posting link.
7. Run `node scripts/build-ics.mjs`, then `node --test tests/*.test.mjs` and `node scripts/check-data.mjs`; all must pass.
8. Set `dataset_checked` to the **oldest** `last_verified` in the file (today only if every entry was checked today). It is
   the page's "Last full check" line, and `check-data`/the build reject a date later than the oldest entry. Commit on a
   `preview/data-<date>` branch, push, review the preview, then merge to `main` (docs/DEPLOY.md).

**Do not:**
- use job aggregators (Indeed, talent.com, jobs.ca) as the source for an Open status;
- guess pay, deadlines, position counts or windows.
