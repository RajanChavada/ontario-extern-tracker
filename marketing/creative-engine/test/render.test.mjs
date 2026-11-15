// Rendering tests need Chromium (see README). They render into a temp folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseSpec } from '../src/spec/schema.js';
import { renderSpec, launchBrowser, slideDocument } from '../src/render/render.js';
import { prepareSpec } from '../src/spec/verify.js';
import { geometry } from '../src/platforms.js';
import { base, load, pngSize, TODAY } from './helpers.mjs';

let browser;
test.before(async () => { browser = await launchBrowser(); });
test.after(async () => { await browser?.close(); });

async function render(raw, opts = {}) {
  const { spec, errors } = parseSpec(raw);
  assert.deepEqual(errors, []);
  const outDir = await mkdtemp(path.join(tmpdir(), 'creative-'));
  const res = await renderSpec(spec, { outDir, today: TODAY, browser, overlay: false, ...opts });
  return { ...res, outDir };
}
const allQa = (m, kind) => Object.values(m.platforms).flatMap((p) => p.slides.flatMap((s) => s.qa[kind]));

test('renders exact canvas sizes for both platforms, with a clean QA pass', async () => {
  const { ok, manifest, outDir } = await render(load('comparison-same-title-fine-print'));
  assert.equal(ok, true, JSON.stringify(allQa(manifest, 'errors')));
  assert.equal(manifest.publishable, true);
  for (const [pid, [w, h]] of [['tiktok', [1080, 1920]], ['instagram', [1080, 1350]]]) {
    for (const s of manifest.platforms[pid].slides) {
      assert.deepEqual(pngSize(await readFile(path.join(outDir, s.file))), [w, h], `${pid} ${s.file}`);
      assert.ok(s.alt.length > 10, 'alt text generated');
      assert.match(s.sha256, /^[0-9a-f]{64}$/);
    }
  }
});

test('runaway copy is scaled down or rejected, never clipped silently', async () => {
  const s = base();
  s.slides[1] = { layout: 'text_stack', title: 'a long title that keeps going for a while', basis: 'advice', lines: Array(5).fill('this caption box keeps talking well past the point where anyone would still be reading it on a phone') };
  const { manifest } = await render(s, { platforms: ['instagram'] });
  const slide = manifest.platforms.instagram.slides[1];
  const errs = slide.qa.errors.map((e) => e.code);
  assert.ok(slide.fit < 1 || errs.includes('OVERFLOW'), 'either auto-fit or an OVERFLOW error');
  if (!errs.includes('OVERFLOW')) assert.ok(!errs.includes('SAFE_AREA'), 'if it fit, it stays in the safe area');
});

test('a word wider than the line shrinks to fit or fails with OVERFLOW_X', async () => {
  const s = base();
  s.slides[0].title = 'supercalifragilisticexpialidocious deadlines';
  const { manifest } = await render(s, { platforms: ['tiktok'] });
  const errs = manifest.platforms.tiktok.slides[0].qa.errors.map((e) => e.code);
  assert.ok(!errs.includes('SAFE_AREA') || errs.includes('OVERFLOW_X'), JSON.stringify(errs));
});

test('emoji render as real glyphs (guards against a blank emoji font)', async () => {
  const s = base();
  s.slides[1] = { layout: 'text_stack', basis: 'advice', lines: ['set your alarms ⏰ and screenshot it 📸'], emoji: '🩺' };
  const { manifest } = await render(s, { platforms: ['tiktok'] });
  const errs = allQa(manifest, 'errors').map((e) => e.code);
  assert.ok(!errs.includes('EMOJI_MISSING'), JSON.stringify(errs));
  assert.ok(!errs.includes('FONT'));
});

test('validation errors stop the render unless forced', async () => {
  const s = base();
  s.slides[1].lines = ['it pays $99/hr'];
  const { ok, manifest } = await render(s);
  assert.equal(ok, false);
  assert.equal(manifest, null);
  const forced = await render(s, { force: true, platforms: ['tiktok'] });
  assert.equal(forced.manifest.publishable, false);
});

test('receipts never claim a source has no publish date: no date in our data means nothing is said', () => {
  // Bug (Nov 14): tracker sources carry no `published`, so receipts said "publish date not shown" for Women's College,
  // whose posting does show "Posted Friday, November 6, 2026". The slide must not make claims about the source we didn't check.
  const raw = load('explainer-what-is-an-extern');
  const markup = (mutate) => {
    const spec = prepareSpec(parseSpec(raw).spec);
    mutate(spec);
    const ctx = { spec, platform: geometry('tiktok'), facts: new Map(spec.facts.map((f) => [f.id, f])), sources: new Map(spec.sources.map((s) => [s.id, s])), refDate: TODAY, demo: false, asset: (x) => x };
    const slide = spec.slides.find((s) => s.layout === 'receipts');
    assert.ok(slide, 'example has a receipts slide');
    return slideDocument(slide, ctx);
  };
  const without = markup((spec) => spec.sources.forEach((s) => { delete s.published; }));
  assert.doesNotMatch(without, /publish date not shown/);
  assert.match(without, /checked /);
  const withDate = markup(() => {});
  assert.match(withDate, /published Jun 4, 2026/);
});
