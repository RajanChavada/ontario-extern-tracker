# Deploying ontarioexterns.ca (GitHub → Cloudflare Pages)

**Workflow:** Hermes changes code or data on a `preview/*` branch → tests pass → you review the preview URL → merge to `main` → Cloudflare builds → ontarioexterns.ca updates.

**Automatic production deploys are enabled (Rajan, Nov 11, 2026): merging a PR into `main` is the release.** The review gate is the preview URL plus the PR diff. Never push directly to `main`. The full data process is in docs/DATA-WORKFLOW.md.

## 1. Cloudflare Pages project settings (exact values)
Workers & Pages → Create → Pages → **Connect to Git** → GitHub → install the Cloudflare app on the **RajanChavada** account with **"Only select repositories" → `ontario-extern-tracker`**.

| Setting | Value |
|---|---|
| Project name | `ontario-extern-tracker` (its pages.dev address is noindex and never shared) |
| Production branch | `main` |
| Framework preset | None |
| Build command | `npm test && node scripts/check-data.mjs && node scripts/build-dist.mjs` |
| Build output directory | `dist` |
| Root directory | *(empty: repository root)* |
| Environment variables, **Production** | `NODE_VERSION` = `22`; `UMAMI_WEBSITE_ID` = *(the UUID from Umami)* |
| Environment variables, **Preview** | `NODE_VERSION` = `22` (no Umami id; preview builds force analytics off anyway) |

Cloudflare installs dependencies from `package-lock.json` before the build command. The only dependency, `puppeteer-core`, is used by the carousel tools and downloads no browser.

**The build fails, so nothing deploys and the previous deployment stays live, if any of these happen:**
- a test fails (dates, deadlines, staleness, eligibility, calendar files, build output, stale-data blocking);
- `check-data` finds invalid data;
- on `main`, a listing would be shown as open on a check more than 2 days before the build date, or the whole dataset is more than 7 days old, or the output contains private paths, debug mode, `JobPosting` markup or unexpected files.

**Preview builds** (any branch other than `main`) never load analytics, only warn on stale data, and are served on `*.pages.dev` with `X-Robots-Tag: noindex`.

## 2. Branch control (Settings → Builds → Branch control)
- **Production branch:** `main`, with automatic production branch deployments **enabled**.
- **Preview branches:** "Custom branches", include `preview/*`.
- On GitHub Free, private repositories can't enforce branch protection. The rule is procedural: Hermes never pushes to `main`. Changes reach `main` only when you merge a pull request.

## 3. Custom domain (Pages project → Custom domains)
1. Check that the domain is on Cloudflare: Websites → `ontarioexterns.ca` should be Active. It was registered on Nov 10, 2026, and public nameservers weren't visible yet at 11:45 EST that day.
2. **Set up a custom domain** → `ontarioexterns.ca`. The DNS record is created automatically because the zone is on Cloudflare. Wait for "Active" and the SSL certificate.
3. Optional: add `www.ontarioexterns.ca` too, then add a free Redirect Rule (Rules → Redirect Rules): `www.ontarioexterns.ca/*` → `https://ontarioexterns.ca/${1}`, 301, keep the query string. Analytics already accept both hosts.
4. Attach the domain only after §5 passes on the pages.dev address. Attaching it is the moment the site becomes public.

## 4. First deployment and the manual gate
Connecting the repository starts one build of `main` straight away. It's served only on the noindex pages.dev address. After that, with automatic production deploys off:
- **To deploy `main`:** Settings → Builds → **Deploy hooks** → add one (name `manual-main`, branch `main`). Keep the URL private. Run `curl -X POST "<hook URL>"` when you approve a release.
- **Rollback:** Deployments → pick an earlier production deployment → "Rollback to this deployment".
- Launch verified and automatic deploys turned on (Nov 11, 2026). The deploy hook is optional now: it rebuilds `main` without a new commit.

## 5. Verification before attaching or announcing the domain
Run on the pages.dev address first, then on https://ontarioexterns.ca:
- [ ] The build log shows `pass 25`, check-data OK, and `dist/ built for https://ontarioexterns.ca … (Cloudflare Pages, branch main, production)`. If the Umami id is set, it also shows `analytics ON`.
- [ ] `/` loads on iPhone Safari and desktop Chrome, with a recent "Verified" date. The order is Southlake → Sunnybrook → SHN → Mackenzie.
- [ ] All 4 "View posting" links open live hospital postings. The other 7 links work.
- [ ] `/what-is-a-clinical-extern-ontario` loads. The `.html` version redirects to it. `/nope` shows the 404 page.
- [ ] `/robots.txt` and `/sitemap.xml` name `https://ontarioexterns.ca`. The page canonical is `https://ontarioexterns.ca/`.
- [ ] `curl -sI https://<project>.pages.dev/ | grep -i x-robots` shows `noindex`. The same command on `https://ontarioexterns.ca/` shows nothing.
- [ ] `/t1` → `/?utm_source=tiktok&…&utm_content=p1-deadlines`. `/i1`, `/s`, `/d`, `/c` and the uppercase `/T1` also work.
- [ ] `/docs/DEPLOY.md`, `/tests/logic.test.mjs`, `/site.json` and `/.git/config` all return 404. There are no CSP errors in the console.
- [ ] Calendar over HTTPS:
  - iPhone .ics opens the Add Event sheet (all-day Nov 30, alert 3 days before);
  - the Google Calendar link works;
  - desktop Chrome downloads with no warning.
- [ ] Umami, on a phone, with Umami Realtime open on a laptop:
  - `/?utm_source=founder` gives a pageview;
  - filter taps send `filter_used` with only `field`;
  - then `posting_click`, `calendar_add` and `feedback`;
  - afterwards set `localStorage.setItem('umami.disabled', 1)` on your devices.

## 6. Umami and Search Console
- **Umami Cloud (free Hobby plan):** Add website, domain `ontarioexterns.ca`. Put the Website ID in the Production variable `UMAMI_WEBSITE_ID`, then trigger a deploy (§4). Variables only apply to new builds.
- **Search Console:** add a **Domain** property for `ontarioexterns.ca` and verify with the DNS TXT record (Cloudflare can add it). No site change is needed, so `GSC_VERIFICATION` stays unset. Submit `https://ontarioexterns.ca/sitemap.xml` and request indexing for `/` and `/what-is-a-clinical-extern-ontario`.

## 7. What the Cloudflare build runs (same locally)
```
npm test                          # 25 tests
node scripts/check-data.mjs       # exits 1 on invalid data
node scripts/build-dist.mjs       # dist/ for https://ontarioexterns.ca (--umami-id <uuid> to include analytics locally)
```
Data refresh: REFRESH.md (checklist) and docs/DATA-WORKFLOW.md (full process), committed on a `preview/data-<date>` branch, reviewed, then merged.
