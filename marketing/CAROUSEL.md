# Carousel-first campaign (TikTok Photo Mode + Instagram carousels)

Drafts only. Nothing is published, no accounts are created, and there are no paid ads, automated posting, engagement buying or testimonials. Each post needs Rajan's approval. The two video scripts (in the launch notes kept outside this repo) are on hold.

## 1. Making a post (about 10 minutes once the copy exists)
```
node scripts/check-data.mjs                     # data verified within 2 days? if not: REFRESH.md
node marketing/carousel/capture.mjs [live-url]  # fresh product screenshots (default: local preview)
node marketing/carousel/render.mjs <id|all>     # refuses if any stated fact no longer matches the data
node marketing/carousel/render.mjs <id> --guides   # review only: shades TikTok's UI zones
node marketing/carousel/check-overflow.mjs      # flags any slide whose text leaves the safe area
```
Output: `out/<id>/ig/NN.png` (1080×1350) and `out/<id>/tt/NN.png` (1080×1920), plus `out/<id>/review.html` with both formats side by side. Before posting, AirDrop the PNGs of one format to your phone.

A new post is a JSON file in `posts/`. Copy the closest existing one and edit the copy. Each slide uses a few fields:
- `title`, `meta`, `sub`, `note`;
- `rows`: label/value pairs, with an optional tone (positive, caution, negative, strong) and a small line;
- `entries`: several hospitals on one slide;
- `quote`: the posting's own words plus a citation;
- `img`: a product screenshot plus an optional caption. Use `imgFirst` to put it under the title.
- `layout`: cover, info, statement or cta.

Any field can take `{ "ig": …, "tt": … }` to differ by platform. The CTA uses this: Instagram says "Link in bio", TikTok shows a URL to type.

**The fact gate:** every post lists the `facts` it states (posting type, closing date, positions, pay, or the eligibility verdict for a given program and year). The renderer recomputes each one from `data/hospitals.json`, using the same logic as the site, and refuses to render if any differs. It also refuses if the data is more than 2 days old, if the screenshots are older than the data, or if a stated closing date has passed. A post that was true on Nov 10 can't be re-posted on Dec 1 by mistake.

## 2. The visual system
It's the site's own editorial language, so a slide and the product look like the same thing:
- **Paper and ink:** a warm off-white background (#fbfaf7) and near-black text. There's one accent, a dark blue, used only for the URL.
- **Type:** a serif for titles and hospital names (Charter, falling back to Georgia) and the system sans-serif for everything else. Sizes:
  - Instagram: cover 104 px, title 72, body 38, label 27.
  - TikTok: about 12% larger (126 / 90 / 48 / 33), because the slide is shown smaller relative to the text.
- **Structure:** every slide has a masthead (wordmark and "2/6") on a heavy rule, the content, and a footer saying "Checked <date> against each hospital's own posting. Not affiliated with any hospital."
- **Content:** facts are set in ruled rows like the site's listings. Status is coloured words, the same as the site: green for positions listed, amber for a talent pool or "check". There are no badges, icons, emoji, gradients or illustrations.
- **Screenshots:** real ones from the live product, shown flat with a hairline border, never inside a fake phone frame. The relative countdown ("in 20 days") is hidden, because a post stays visible for days.
- **Instagram:** 1080×1350 (4:5). This is the safe default that every route accepts. 3:4 is taller, but the first slide sets the shape for all slides. Text sits 92 px in from each side, so the 3:4 profile grid crop (about 34 px per side) never cuts it.
- **TikTok Photo Mode:** 1080×1920 (9:16). Text stays out of the top 176 px (tabs), the bottom 480 px (caption, sound, nav) and the right 150 px (like, comment and share buttons). `--guides` shows these zones. TikTok needs at least 4 photos per post; ours have 5–6.

## 3. What the examples review found (time-boxed, Nov 10)
- **Access:** TikTok discover pages and Instagram tag pages need a login. We didn't log in or work around that. Searchable public caption text from nursing-education carousel accounts (QLexNursing, alicia.in.scrubs, NCLEX "hallmark signs" posts) shows the common pattern:
  - one topic per carousel;
  - an explicit "swipe" or "save this for your exam" ask;
  - question hooks ("Which patient do you see first?");
  - caption hashtags such as #nursingstudent #nursingschool #studentnurse #nclexprep.

  These are study accounts. Nobody visible was doing Ontario extern carousels, which is both an opening and a sign that there's no proven format to copy.
- **What we took:** one idea per post, a cover that answers "is this for me?" (a date, a year, or a word like "vacancy"), and a save-worthy reference slide.
- **What we didn't take:** comment-bait quizzes, emoji walls, "follow for more".
- **To inspect yourself, about 15 minutes, logged in on your phone.** Search TikTok and Instagram for `nursing extern`, `clinical extern`, `nursing student ontario`, `nursing student jobs` and `#nursingstudent`. For the 5 most-viewed **photo** posts of the last 3 months, write down:
  - the cover text, word for word;
  - the number of slides;
  - text per slide (a line, or a paragraph);
  - whether the caption or the slides carry the information;
  - the CTA;
  - views, saves and comments.

  Tell me what you find. I'll adjust the four posts, not the system.

## 4. Links: what's actually clickable (checked against the platforms' help pages, Nov 10)
| Placement | Clickable? | Our route |
|---|---|---|
| Instagram profile Links (Edit profile → Links, up to 5) | **Yes, any account** (set up in the app, not on desktop) | Point it at the current post's short link (`/i1`, then `/i2` …) and update it when each post goes up |
| Instagram Story **link sticker** | Yes, for organic stories. Instagram withholds it from **new accounts** and rule-breaking accounts | Share each carousel to your story with a sticker → `/s` |
| Instagram post caption | **No** (plain text) | "Link in bio" plus the short URL written out |
| TikTok profile website link | **Only with ≥1,000 followers or a Verified Business Account** (business verification is available in Canada and needs business documents) | Most likely **not available**. Don't write "link in bio" on TikTok unless the Links → Add option shows on your profile |
| TikTok caption | No | The short URL is written on the last slide and in the caption, to be typed |

**Before the first post, check in the apps (I can't see your accounts):**
1. Instagram: Edit profile → Links → "Add external link". Is it there?
2. Instagram: create a test story → Stickers. Is "Link" in the list? (Delete the test story.)
3. TikTok: Edit profile. Is there "Links → Add" or a "Website" field? If not, the TikTok CTA stays a typed URL.
4. Which account posts: yours (with "I built this") or a nursing-student friend's ("my friend built this")? A friend's established account may have the link sticker and a more relevant audience.

**Short links** (Cloudflare `_redirects`, generated from `links.json`; uppercase works too):
- `/t1`–`/t4`: TikTok, posts 1–4.
- `/i1`–`/i4`: Instagram bio, posts 1–4.
- `/s`: Instagram story sticker.
- `/d`: your DMs.
- `/c`: class chats.

Each one redirects to `/?utm_source=…&utm_medium=…&utm_campaign=extern-nov26&utm_content=<post>`.

Slides and captions use the production domain from `site.json` (ontarioexterns.ca/t1 etc.).

## 5. The four posts
| # | File | Message tested | Hypothesis | Main signal |
|---|---|---|---|---|
| 1 | `01-nov30-deadlines` | Deadline urgency | A dated deadline gets students to visit and check the criteria | p1 visitors → `posting_click` on Southlake/SHN, `calendar_add` |
| 2 | `02-talent-pool-vs-vacancy` | Vacancy vs talent-pool clarity | Explaining posting types in the postings' own words gets saved/shared and drives visits | saves+shares ÷ views; p2 `posting_click` by status |
| 3 | `03-second-year` | Eligibility relevance | Naming one group (year-2 BScN) brings visitors who use the year filter | share of p3 visitors with `filter_used` = year |
| 4 | `04-one-list` | Convenience | "One list instead of 11 sites" brings visitors who save it and come back | saves; p4 `return_visit_estimate`, `calendar_add` |

The slide copy, captions (per platform), search terms, CTA and metrics are in each JSON file. Rendered drafts are in `out/`.

## 6. Schedule (Day 0 = the approved deploy day)
| Day | Post | Platforms | Also |
|---|---|---|---|
| 0 | — | — | Deploy; DEPLOY.md §7 checklist; set the Instagram bio link to `/i1` |
| 1 | **1: Nov 30 deadlines** | IG carousel + TikTok photo post | Story share with a link sticker (`/s`); student DMs (`/d`) |
| 3 | **2: Talent pool vs vacancy** | both | Bio link → `/i2`; data refresh first |
| 5 | Read-out 1: compare posts 1 vs 2 (content metrics + site visits) | — | Adjust post 3's cover if one style clearly won |
| 6 | **3: Second-year BScN** | both | Bio link → `/i3` |
| 8 | **4: One list** | both | Bio link → `/i4` |
| Nov 27 | Optional story only: "SHN and Southlake close Monday" | IG story (`/s`) | Only if posts 1–2 got real visits |
| Dec 1 | Final read-out | — | Posts 1 and 3 mention Nov 30, so **don't re-share them after Nov 30** (the renderer refuses anyway) |

Post 1 must go up while there's time left before Nov 30. If deploy slips past about Nov 20, post 1 first and post 3 immediately after; 2 and 4 don't depend on the date.

Cadence: at most one post every 2 days, posted by hand. Reply to comments personally and honestly. Corrections go into the data and the next refresh.

## 7. Measuring: content numbers stay separate from site numbers
- **Platform (record by hand 48 h after posting, in the scorecard (kept outside this repo)):** views/reach, likes, comments, **saves**, **shares**, profile visits, and Instagram link taps (bio and sticker).
- **Site (Umami, by `utm_content`):** visitors, filter use, `posting_click`, `calendar_add`, `feedback`.
- **Reading:** a post "worked" only if it produced site visitors who did something (a posting click or calendar add). Views and likes alone are not validation. High saves with no visits means the content was useful but the CTA or link route failed (likely on TikTok without a clickable link). That's a distribution problem, not a message problem.
