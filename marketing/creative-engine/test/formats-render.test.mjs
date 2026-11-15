// Formats C and B, rendered (needs Chromium; see README). Renders the two approved reference
// carousels, checks the files, then breaks things on purpose to prove QA catches them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSpec } from '../src/spec/schema.js';
import { prepareSpec, verifySpec } from '../src/spec/verify.js';
import { renderSpec, launchBrowser, slideDocument } from '../src/render/render.js';
import { fitDrawAndCheck } from '../src/render/runtime.js';
import { geometry } from '../src/platforms.js';
import { assetPath, loadRegistry } from '../src/assets/registry.js';
import { checkPackage, exportPackage, fingerprint, loadSchema, schemaErrors } from '../src/handoff/pubkit.js';
import { photoNotes, factualCheck, photoLayerErrors } from '../bin/oet.mjs';
import { formatOf } from '../src/spec/verify.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pngSize } from './helpers.mjs';

const TODAY = '2026-11-14';
const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const C = () => read('../specs/formats/c-what-a-clinical-extern-is.json');
const B = () => read('../specs/formats/b-what-a-clinical-extern-is.json');
const PROJECT = read('./fixtures/grokbot/project.ontario-extern-tracker.json');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const SIZES = { 'tiktok-3x4': [1080, 1440], tiktok: [1080, 1920], instagram: [1080, 1350] };

let browser;
const rendered = {};
test.before(async () => {
  browser = await launchBrowser();
  for (const [k, raw] of [['c', C()], ['b', B()]]) {
    const outDir = await mkdtemp(path.join(tmpdir(), `oet-fmt-${k}-`));
    rendered[k] = { outDir, ...(await renderSpec(parseSpec(raw).spec, { outDir, today: TODAY, browser, overlay: false, platforms: ['tiktok-3x4', 'tiktok', 'instagram'] })) };
  }
});
test.after(async () => { await browser?.close(); });

const errorsOf = (m) => Object.entries(m.platforms).flatMap(([pid, p]) => p.slides.flatMap((s) => s.qa.errors.map((e) => `${pid} ${s.n} ${e.code}`)));

test('C renders 7 slides on 3:4, 9:16 and 4:5 with zero QA errors, in the approved order', async () => {
  const { ok, manifest, outDir } = rendered.c;
  assert.deepEqual(errorsOf(manifest), []);
  assert.equal(ok, true);
  for (const [pid, [w, h]] of Object.entries(SIZES)) {
    const p = manifest.platforms[pid];
    assert.deepEqual(p.slides.map((s) => s.layout), ['c_photo', 'c_notes', 'c_photo', 'c_photo', 'c_paper', 'c_photo', 'c_photo']);
    assert.deepEqual(p.slides.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7]);
    for (const s of p.slides) {
      const bytes = await readFile(path.join(outDir, s.file));
      assert.deepEqual(pngSize(bytes), [w, h], `${pid} ${s.file}`);
      assert.equal(sha(bytes), s.sha256, `${pid} ${s.file} hash`);
      assert.doesNotMatch(s.alt, /[\u2190-\u21FF]/u, 'no arrows in alt text');
    }
    // per-slide photo provenance, in slide order
    assert.deepEqual(p.slides.map((s) => (s.assets ?? []).map((a) => `${a.id}:${a.role}`)), [
      ['pexels-5537938:photo'], ['pexels-3973981:blurred-background'], ['pexels-5386483:photo'], ['pexels-5499136:photo'], [], ['pexels-2440970:photo'], ['pexels-7439131:photo'],
    ]);
    assert.deepEqual(Object.keys(p.slides[0].assets[0]), ['id', 'role', 'source', 'page_url', 'photographer', 'licence', 'licence_url', 'checked', 'shoot_id', 'file_sha256']);
    assert.equal(p.slides[0].assets[0].photographer, 'Zen Chung');
  }
  assert.equal(manifest.platforms['tiktok-3x4'].candidate, true);
  assert.equal(manifest.platforms.tiktok.candidate, undefined);
  assert.equal(manifest.platforms.tiktok.slides[0].alt, 'what a clinical extern actually is. (ontario edition) save for later.');
  assert.doesNotMatch(manifest.platforms.tiktok.slides[1].alt, /\p{Extended_Pictographic}/u); // "extern notes 🩺" → "extern notes."
  assert.match(manifest.platforms.tiktok.slides[1].alt, /^extern notes\. it’s a paid job/);
});

test('B renders 7 slides on all three sizes with zero QA errors', async () => {
  const { ok, manifest, outDir } = rendered.b;
  assert.deepEqual(errorsOf(manifest), []);
  assert.equal(ok, true);
  for (const [pid, [w, h]] of Object.entries(SIZES)) {
    const p = manifest.platforms[pid];
    assert.deepEqual(p.slides.map((s) => s.layout), ['b_cover', 'b_card', 'b_card', 'b_card', 'b_card', 'b_card', 'b_cta']);
    for (const s of p.slides) assert.deepEqual(pngSize(await readFile(path.join(outDir, s.file))), [w, h]);
    assert.deepEqual(p.slides.map((s) => (s.assets ?? []).map((a) => a.id)), [['pexels-2440970'], [], [], [], [], [], []]);
    assert.match(p.slides[1].alt, /^1\. what it is\. clinical extern 101\. it’s a paid job in an Ontario hospital\. Ontario Health describes/);
    for (const s of p.slides) assert.doesNotMatch(s.alt, /\p{Extended_Pictographic}/u, `${pid} ${s.n}: icons and stickers are decoration, not alt text`);
    assert.equal(p.slides[0].alt, 'what a clinical extern actually is. (ontario edition) save this for later.');
    assert.match(p.slides[1].alt, /Source: Ontario Health, Enhanced Extern Program page, updated June 4, 2026\.$/);
  }
});

test('without an explicit request only the default platforms render; 3:4 is opt-in', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'oet-fmt-default-'));
  const { manifest } = await renderSpec(parseSpec(B()).spec, { outDir, today: TODAY, browser, overlay: false });
  assert.deepEqual(Object.keys(manifest.platforms), ['tiktok', 'instagram']);
  assert.deepEqual((await readdir(outDir)).filter((f) => !f.endsWith('.png') && f !== 'manifest.json').sort(), ['instagram', 'tiktok']);
});

test('re-rendering gives byte-identical slides (stable hashes and order)', async () => {
  for (const k of ['c', 'b']) {
    const outDir = await mkdtemp(path.join(tmpdir(), `oet-fmt-again-${k}-`));
    const again = await renderSpec(parseSpec(k === 'c' ? C() : B()).spec, { outDir, today: TODAY, browser, overlay: false, platforms: ['tiktok'] });
    assert.deepEqual(again.manifest.platforms.tiktok.slides.map((s) => s.sha256), rendered[k].manifest.platforms.tiktok.slides.map((s) => s.sha256), k);
  }
});

test('invalid input renders nothing: an unregistered photo stops the render before any file is written', async () => {
  const raw = C();
  raw.slides[2].photo = 'pexels-9999999';
  const outDir = await mkdtemp(path.join(tmpdir(), 'oet-fmt-bad-'));
  const r = await renderSpec(parseSpec(raw).spec, { outDir, today: TODAY, browser, overlay: false });
  assert.equal(r.ok, false);
  assert.equal(r.manifest, null);
  assert.deepEqual(r.report.errors.map((e) => e.code), ['UNKNOWN_ASSET']);
  assert.deepEqual(await readdir(outDir), []);
});

// ---------------------------------------------------------------- QA catches broken designs
/** Run the in-browser QA on one slide, optionally with extra CSS that breaks something. */
async function qaSlide(raw, n, pid, css = '') {
  const spec = prepareSpec(parseSpec(raw).spec);
  verifySpec(spec, { today: TODAY });
  const reg = loadRegistry();
  const ctx = {
    spec, platform: geometry(pid), facts: new Map(spec.facts.map((f) => [f.id, f])), sources: new Map(spec.sources.map((s) => [s.id, s])),
    refDate: TODAY, demo: false, asset: (p) => p,
    photo: (id) => ({ ...reg.byId.get(id), url: pathToFileURL(assetPath(reg, reg.byId.get(id))).href }),
  };
  const dir = await mkdtemp(path.join(tmpdir(), 'oet-fmt-qa-'));
  const file = path.join(dir, 'slide.html');
  await writeFile(file, slideDocument(spec.slides[n - 1], ctx).replace('</head>', `<style>${css}</style></head>`));
  const page = await browser.newPage({ viewport: { width: ctx.platform.width, height: ctx.platform.height } });
  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    return await page.evaluate(fitDrawAndCheck, { platform: ctx.platform, seed: 7 });
  } finally { await page.close(); }
}
const qaCodes = (qa) => qa.errors.map((e) => e.code);

test('word-circle spacing is what keeps it clear: without the reference margins it collides', async () => {
  assert.deepEqual(qaCodes(await qaSlide(C(), 4, 'tiktok-3x4')), []);
  const tight = await qaSlide(C(), 4, 'tiktok-3x4', '.c-ring{margin:0!important;padding:0!important}');
  assert.ok(qaCodes(tight).includes('MARK_COLLISION'), JSON.stringify(tight.errors));
  assert.match(tight.errors.find((e) => e.code === 'MARK_COLLISION').message, /circle around "October and February\."/);
});

test('text on a photo must sit on a caption box or carry an outline; outline contrast is measured', async () => {
  assert.deepEqual(qaCodes(await qaSlide(C(), 1, 'tiktok')), []);
  const noOutline = await qaSlide(C(), 1, 'tiktok', '.c-hand{-webkit-text-stroke:0!important}');
  assert.deepEqual([...new Set(qaCodes(noOutline))], ['TEXT_ON_PHOTO']);
  assert.equal(noOutline.errors.length, 2); // "(ontario edition)" and "save for later"
  const noBox = await qaSlide(C(), 3, 'tiktok', '.c-box>span{background:transparent!important}');
  assert.ok(qaCodes(noBox).includes('TEXT_ON_PHOTO'));
  const pale = await qaSlide(C(), 7, 'tiktok', '.c-hand{color:#F4F4F4!important}');
  assert.deepEqual(qaCodes(pale), ['CONTRAST']);
  assert.match(pale.errors[0].message, /against its outline/);
  const bPale = await qaSlide(B(), 1, 'instagram', '.b-cover-title{-webkit-text-stroke-color:#FFC0CB!important}');
  assert.deepEqual(qaCodes(bPale), ['CONTRAST', 'CONTRAST']); // the title and its "(ontario edition)" line
});

test('B text contrast and minimum size are checked on the cards too', async () => {
  const low = await qaSlide(B(), 3, 'tiktok', '.b-chip{color:#BFE8E2!important}');
  assert.deepEqual(qaCodes(low), ['CONTRAST']);
  const tiny = await qaSlide(B(), 3, 'tiktok', '.b-series{font-size:24px!important}');
  assert.deepEqual(qaCodes(tiny), ['MIN_FONT']);
});

// ---------------------------------------------------------------- Grokbot handoff, unchanged
test("a C carousel exports to Grokbot's manifest v1: valid, in order, hashes match, READY.json last", async () => {
  const { manifest, outDir } = rendered.c;
  const tt = manifest.platforms.tiktok;
  const inbox = await mkdtemp(path.join(tmpdir(), 'oet-fmt-inbox-'));
  const toJpeg = async (png) => { // exportPackage passes the PNG bytes
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    try {
      await page.setContent(`<body style="margin:0"><img id="i" style="display:block" src="data:image/png;base64,${png.toString('base64')}"></body>`);
      await page.waitForFunction(() => document.getElementById('i').complete);
      return await page.locator('#i').screenshot({ type: 'jpeg', quality: 92 });
    } finally { await page.close(); }
  };
  const writes = [];
  const spec = C();
  const r = await exportPackage({
    inbox, project: 'ontario-extern-tracker', postId: 'oet-test-format-c', today: TODAY, projectConfig: PROJECT,
    destination: { platform: 'tiktok', account: '@ontarioextern', format: 'photo_carousel', visibility_requested: 'only_you' },
    slides: tt.slides.map((s) => ({ png: path.join(outDir, s.file), layout: s.layout, alt: s.alt })),
    toJpeg, caption: `${spec.caption.text}\n\n${spec.caption.hashtags.join(' ')}`,
    generator: { name: '@oet/creative-engine', version: '0.1.0', created_by: 'hermes', spec_id: spec.id },
    sourceVerification: { state: 'verified', checked_at: TODAY, reverify_by: '2027-05-13', expires_at: null, sources: spec.sources.map((s) => ({ url: s.url, publisher: s.publisher, title: s.title, primary: s.primary, accessed_at: s.accessedAt })), blockers: [], conflicts: [], engagement_claims: [] },
    notes: `Test export.${photoNotes(tt)}`,
    onWrite: (f) => writes.push(path.basename(f)), now: () => new Date('2026-11-14T17:00:00Z'),
  });
  assert.deepEqual(r.errors, []);
  const m = JSON.parse(await readFile(path.join(r.dir, 'publish-manifest.json'), 'utf8'));
  assert.deepEqual(schemaErrors(m, loadSchema()), []);
  assert.deepEqual(checkPackage(m, r.dir, { project: PROJECT, today: TODAY }), []);
  assert.deepEqual(m.assets.map((a) => a.file), ['01-c_photo', '02-c_notes', '03-c_photo', '04-c_photo', '05-c_paper', '06-c_photo', '07-c_photo'].map((n) => `assets/${n}.jpg`));
  for (const a of m.assets) assert.equal(sha(await readFile(path.join(r.dir, a.file))), a.sha256);
  assert.equal(m.content_fingerprint, fingerprint(m.assets, m.caption, m.hashtags));
  assert.deepEqual(m.hashtags, ['#nursingstudent', '#clinicalextern', '#ontario', '#studentnurse']);
  assert.match(m.notes, /Photos: slide 1 pexels-5537938 by Zen Chung/);
  assert.equal(writes.at(-1), 'READY.json');
});

// ---------------------------------------------------------------- campaigns default to format C (Nov 14 regression)
// The first Women's College post shipped in flat classic layouts because nothing asked for a format. Campaigns now
// default to format C, a classic spec must say so, and the rendered PNGs must actually carry the photo layers.
const TRACKER_FIX = new URL('./fixtures/tracker/', import.meta.url);
const campaignOpts = { dataFile: fileURLToPath(new URL('hospitals.json', TRACKER_FIX)), evidenceDirs: [fileURLToPath(new URL('evidence/', TRACKER_FIX))], today: TODAY };
const cCampaign = (over = {}) => ({
  id: 'wch-c-test', title: 'WCH format C test', status: 'verified', theme: 'board', platforms: ['tiktok'], tracker: { entries: ['wch'] },
  slides: [
    { layout: 'c_photo', photo: 'pexels-5537938', title: "women's college extern posting: what to know before it closes" },
    { layout: 'c_notes', photo: 'pexels-3973981', label: 'extern notes 📝', title: 'certification', body: 'BCLS certification is required.', facts: ['wch-bcls'] },
    { layout: 'c_photo', photo: 'pexels-5386483', title: 'the pay is $20.60/hr', basis: 'facts', facts: ['wch-pay'] },
    { layout: 'c_paper', title: 'before you hit submit', body: 'have your BCLS details ready and screenshot your confirmation.', tags: ['BCLS'], basis: 'advice' },
    { layout: 'c_photo', photo: 'pexels-7439131', title: 'looking for more extern postings?', body: "ontarioexterns.ca: Ontario extern postings, checked on each hospital's own careers page.", fine: 'Not affiliated with any hospital.', basis: 'promo' },
  ],
  caption: { text: "Women's College Hospital's extern posting pays $20.60/hr (as posted).", hashtags: ['#nursingstudent'] },
  ...over,
});
const classicCampaign = (over = {}) => ({
  id: 'wch-classic-test', title: 'WCH classic test', status: 'verified', theme: 'wine', platforms: ['tiktok'], tracker: { entries: ['wch'] },
  slides: [
    { layout: 'hook', variant: 'plain', title: 'one extern posting closes nov 20', facts: ['wch-deadline'] },
    { layout: 'deadline', fact: 'wch-deadline', details: [{ label: 'Pay', fact: 'wch-pay' }] },
    { layout: 'cta', action: 'save', title: 'save this' },
  ],
  caption: { text: "Women's College Hospital's extern posting closes Nov 20 ($20.60/hr as posted).", hashtags: ['#nursingstudent'] },
  ...over,
});
async function campaignFile(obj) {
  const dir = await mkdtemp(path.join(tmpdir(), 'oet-campaign-'));
  const f = path.join(dir, 'campaign.json');
  writeFileSync(f, JSON.stringify(obj));
  return f;
}
/** Share of the most common colour in a rendered PNG (sampled 108x192, 4 bits per channel). Calibrated Nov 14: format C photo
 *  slides 6-19%, a flat classic slide 45% (its faint texture splits the background colour). Thresholds: photo < 30%, flat > 40%. */
async function dominantColourShare(file) {
  const b64 = (await readFile(file)).toString('base64');
  const page = await browser.newPage();
  try {
    await page.setContent(`<img id="i" src="data:image/png;base64,${b64}">`);
    await page.waitForFunction(() => document.getElementById('i').complete);
    return await page.evaluate(() => {
      const img = document.getElementById('i'); const c = document.createElement('canvas'); c.width = 108; c.height = 192;
      const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(img, 0, 0, 108, 192); // sample pixels, don't blend them
      const d = x.getImageData(0, 0, 108, 192).data; const n = new Map();
      for (let i = 0; i < d.length; i += 4) { const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4); n.set(k, (n.get(k) ?? 0) + 1); }
      return Math.max(...n.values()) / (108 * 192);
    });
  } finally { await page.close(); }
}

test('campaigns default to format C; a classic campaign that does not say so is refused, not rendered flat', async () => {
  const c = factualCheck(await campaignFile(cCampaign()), campaignOpts);
  assert.deepEqual(c.factual.errors, []);
  assert.equal(c.spec.format, 'c');
  assert.equal(formatOf(c.spec), 'c');
  const silent = factualCheck(await campaignFile(classicCampaign()), campaignOpts);
  assert.equal(silent.factual.passed, false);
  assert.deepEqual(silent.factual.errors.map((e) => e.code), ['FORMAT_NOT_RENDERED']);
  const optedOut = factualCheck(await campaignFile(classicCampaign({ format: 'classic' })), campaignOpts);
  assert.equal(optedOut.factual.passed, true);
  // asking for B but writing C slides is refused too
  const wrong = factualCheck(await campaignFile(cCampaign({ format: 'b' })), campaignOpts);
  assert.ok(wrong.factual.errors.some((e) => e.code === 'FORMAT_NOT_RENDERED'));
});

test('a format C campaign renders its registered photos on the photo slides (checked on the PNGs, not the templates)', { timeout: 180_000 }, async () => {
  const fc = factualCheck(await campaignFile(cCampaign()), campaignOpts);
  const outDir = await mkdtemp(path.join(tmpdir(), 'oet-c-campaign-'));
  const { manifest } = await renderSpec(fc.spec, { outDir, today: TODAY, browser, overlay: false, platforms: ['tiktok'] });
  const tt = manifest.platforms.tiktok;
  assert.deepEqual(tt.slides.flatMap((s) => s.qa.errors), []);
  assert.deepEqual(photoLayerErrors(fc.spec, tt), []);
  const expectRole = { c_photo: 'photo', c_notes: 'blurred-background' };
  for (const s of tt.slides) {
    const want = fc.spec.slides[s.n - 1];
    const share = await dominantColourShare(path.join(outDir, s.file));
    if (want.photo) {
      assert.deepEqual((s.assets ?? []).map((a) => `${a.id}:${a.role}`), [`${want.photo}:${expectRole[want.layout]}`], `slide ${s.n}`);
      assert.ok(share < 0.3, `slide ${s.n} ${s.layout} looks flat: ${(share * 100).toFixed(0)}% one colour`);
    } else {
      assert.equal(s.assets, undefined, `slide ${s.n} (designed slide) has no photo`);
    }
  }
  // control: the same measure flags a flat classic slide, and a manifest without the photo layer is caught
  const cl = factualCheck(await campaignFile(classicCampaign({ format: 'classic' })), campaignOpts);
  const clDir = await mkdtemp(path.join(tmpdir(), 'oet-classic-campaign-'));
  const clRes = await renderSpec(cl.spec, { outDir: clDir, today: TODAY, browser, overlay: false, platforms: ['tiktok'] });
  const flat = await dominantColourShare(path.join(clDir, clRes.manifest.platforms.tiktok.slides[0].file));
  assert.ok(flat > 0.4, `classic hook is a flat background (${(flat * 100).toFixed(0)}% one colour)`);
  const stripped = { slides: tt.slides.map((s) => ({ ...s, assets: undefined })) };
  assert.deepEqual(photoLayerErrors(fc.spec, stripped).map((e) => e.where), ['slide 1 c_photo', 'slide 2 c_notes', 'slide 3 c_photo', 'slide 5 c_photo']);
});
