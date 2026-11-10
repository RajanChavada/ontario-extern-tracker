# Design notes (v0.3)

An editorial job directory, not a SaaS dashboard. Type, rules and alignment set the hierarchy. Colour and boxes are used only where they carry meaning.

## References (looked at Nov 9, 2026, at 1440 and 390 px; principles only)
- **GOV.UK search results** (gov.uk/search): one strong serif-free title, results as plain rows separated by hairlines, the link as the headline, metadata in small grey text, a count line above the list. Taken: the result-count sentence, hairline rows, no containers, underlined text links as secondary actions.
- **Stripe Careers** (stripe.com/jobs/search): a real table with column headers (team, location) and a heavy top rule; rows compare across columns; filters are compact lists beside the table. Taken: the desktop comparison grid with quiet column headings, a 2px rule above each list, the filter bar sitting on the list.
- **80,000 Hours job board** (jobs.80000hours.org): dense listing rows with organisation name in bold, role and location below, tags as plain small text; a restrained palette on off-white. Taken: name-then-meta stacking, off-white paper, status as words rather than chips.

## Rules
1. **No cards, shadows or pills.** Lists are rows separated by 1px rules; sections start with a 1px ink rule. The only filled surfaces are the primary button, selected filter segments, and the expanded detail panel (a flat tint).
2. **One accent** (ink blue `#1f4f8f`): links, the "View posting" button and focus rings. Nothing decorative uses it.
3. **Status is words in colour, not badges.** Green = positions listed / meets criteria; amber = talent pool, unconfirmed, check with employer; red = doesn't meet criteria or closing within 7 days; grey = not open, closed. Each status has a plain-language note beside it.
4. **One primary action per listing.** "View posting" only on listings taking applications. Not-open and closed listings get a text link ("Hospital page", "Expired posting"). Requirements and calendar are underlined text toggles.
5. **Type carries the design.** A serif (Charter/Georgia fallback) for the title, section titles and hospital names; system sans for everything else. Scale: 30/42 title, 20 section, 18 name, 15 body, 13.5 meta, 12.5 fine print. Tabular numerals for dates and pay.
6. **No hero.** Title, one factual sentence (counts and the next closing date), one dateline. The filters follow immediately.
7. **Desktop is a table**, not two columns of cards: Hospital · Listing · Closes · Pay · Your criteria · Action, with column headings.

## Tokens
See the top of `assets/styles.css`: paper/ink/muted/rule colours, one accent, three status colours, a 7-step 4px-based spacing scale, and a single 3px radius used only on controls.
