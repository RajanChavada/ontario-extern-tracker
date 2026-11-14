// Publish artifacts: the contract a supervised publisher (Grokbot) will consume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArtifacts, contentHash, postIdFor, recordDecision, approvalFor } from '../src/publish/artifact.js';
import { PublishArtifactSchema } from '../src/publish/schema.js';
import { factualCheck } from '../bin/oet.mjs';

const FIX = new URL('./fixtures/tracker/', import.meta.url);
const TODAY = '2026-11-14';
const H = (c) => c.repeat(64);

// A manifest shaped like the engine's, without rendering anything.
function fakeManifest({ qaError = false } = {}) {
  const slides = (pid) => [1, 2].map((n) => ({
    n, layout: n === 1 ? 'hook' : 'cta', file: `${pid}/0${n}-${n === 1 ? 'hook' : 'cta'}.png`, preview: `${pid}/preview/0${n}.png`,
    sha256: H(String(n)), alt: `slide ${n}`, autoAdded: false, fit: 1,
    qa: { errors: qaError && n === 2 && pid === 'instagram' ? [{ code: 'MIN_FONT', message: '29px text' }] : [], warnings: [{ code: 'AUTO_FIT', message: 'scaled' }] },
  }));
  return {
    engine: '@oet/creative-engine@0.1.0', generatedAt: '2026-11-14T17:00:00.000Z',
    spec: { id: 'wch-nov20', title: 'WCH', status: 'verified' },
    verification: { checkedAgainst: TODAY, postBy: '2026-11-19', reverifyBy: '2026-11-21' },
    facts: [{ id: 'wch-deadline', kind: 'deadline', date: '2026-11-20', claim: 'closes', sources: ['wch-posting'], verifiedAt: '2026-11-14' }],
    sources: [{ id: 'wch-posting', publisher: "Women's College Hospital", title: 'Clinical Extern (job 3892)', url: 'https://jobs.dayforcehcm.com/en-US/wch/CANDIDATEPORTAL/jobs/3892', accessedAt: '2026-11-14', primary: true }],
    platforms: {
      tiktok: { size: [1080, 1920], caption: 'Closes Nov 20.\n\n#NursingStudent #ClinicalExtern', contactSheet: 'tiktok-contact-sheet.png', slides: slides('tiktok') },
      instagram: { size: [1080, 1350], caption: 'Closes Nov 20. Link in bio.\n\n#NursingStudent', contactSheet: 'instagram-contact-sheet.png', slides: slides('instagram') },
    },
  };
}
const factualOk = { passed: true, errors: [], warnings: [] };
const tmp = () => mkdtempSync(path.join(tmpdir(), 'oet-pub-'));

test('one artifact per platform: stable post id, aspect ratio, ordered images, caption split, sources with evidence', () => {
  const dir = tmp();
  try {
    const a = buildArtifacts({ manifest: fakeManifest(), outDir: dir, factual: factualOk, provenance: { 'wch-deadline': { capture: '/ev/wch-3892.txt', capturedAt: '2026-11-14' } }, approvalsDir: path.join(dir, 'approvals'), specPath: 'specs/tracker/wch-nov20.json' });
    assert.deepEqual(Object.keys(a), ['tiktok', 'instagram']);
    const t = a.tiktok;
    assert.equal(t.postId, 'oet-wch-nov20-tiktok');
    assert.equal(a.instagram.postId, 'oet-wch-nov20-instagram');
    assert.equal(t.aspectRatio, '9:16');
    assert.equal(a.instagram.aspectRatio, '4:5');
    assert.deepEqual(t.size, { width: 1080, height: 1920 });
    assert.deepEqual(t.images.map((i) => [i.order, i.path]), [[1, '../tiktok/01-hook.png'], [2, '../tiktok/02-cta.png']]);
    assert.deepEqual(t.caption, { text: 'Closes Nov 20.', hashtags: ['#NursingStudent', '#ClinicalExtern'], full: 'Closes Nov 20.\n\n#NursingStudent #ClinicalExtern' });
    assert.deepEqual(t.sources[0].evidence, { file: '/ev/wch-3892.txt', capturedAt: '2026-11-14' });
    assert.deepEqual(t.verification, { checkedAgainst: TODAY, oldestVerifiedAt: '2026-11-14', newestVerifiedAt: '2026-11-14', postBy: '2026-11-19', reverifyBy: '2026-11-21' });
    assert.equal(t.approval.status, 'pending');
    assert.equal(t.publishable, false);
    assert.equal(PublishArtifactSchema.safeParse(t).success, true);
    // written to disk where a publisher will look
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'publish', 'tiktok.json'), 'utf8')), t);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('factual and visual results are reported separately; a visual error on one platform blocks only that platform', () => {
  const dir = tmp();
  try {
    const a = buildArtifacts({ manifest: fakeManifest({ qaError: true }), outDir: dir, factual: factualOk, approvalsDir: path.join(dir, 'ap') });
    assert.deepEqual([a.tiktok.validation.factual.passed, a.tiktok.validation.visual.passed, a.tiktok.validation.passed], [true, true, true]);
    assert.deepEqual([a.instagram.validation.factual.passed, a.instagram.validation.visual.passed, a.instagram.validation.passed], [true, false, false]);
    assert.deepEqual(a.instagram.validation.visual.errors, [{ code: 'MIN_FONT', message: '29px text', where: 'slide 2 cta' }]);
    const f = buildArtifacts({ manifest: fakeManifest(), outDir: dir, factual: { passed: false, errors: [{ code: 'STALE_FACT' }], warnings: [] }, approvalsDir: path.join(dir, 'ap') });
    assert.deepEqual([f.tiktok.validation.factual.passed, f.tiktok.validation.visual.passed, f.tiktok.validation.passed], [false, true, false]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('approval is bound to the exact content: any change to images or caption invalidates it', () => {
  const dir = tmp(); const ap = path.join(dir, 'approvals');
  try {
    buildArtifacts({ manifest: fakeManifest(), outDir: dir, factual: factualOk, approvalsDir: ap });
    const file = path.join(dir, 'publish', 'tiktok.json');
    const approved = recordDecision(file, { decision: 'approved', by: 'Rajan Chavada', today: TODAY, now: new Date('2026-11-14T18:00:00Z') }, ap);
    assert.deepEqual(approved.approval, { status: 'approved', by: 'Rajan Chavada', at: '2026-11-14T18:00:00.000Z', approvedContentHash: approved.contentHash, note: null });
    assert.equal(approved.publishable, true);
    assert.deepEqual(JSON.parse(readFileSync(path.join(ap, 'oet-wch-nov20-tiktok.json'), 'utf8')), { postId: 'oet-wch-nov20-tiktok', platform: 'tiktok', status: 'approved', contentHash: approved.contentHash, by: 'Rajan Chavada', at: '2026-11-14T18:00:00.000Z' });

    // re-render with identical content: still approved
    assert.equal(buildArtifacts({ manifest: fakeManifest(), outDir: dir, factual: factualOk, approvalsDir: ap }).tiktok.approval.status, 'approved');
    // caption edited after approval: invalidated, not publishable
    const m = fakeManifest(); m.platforms.tiktok.caption = 'Closes Nov 20!\n\n#NursingStudent #ClinicalExtern';
    const changed = buildArtifacts({ manifest: m, outDir: dir, factual: factualOk, approvalsDir: ap }).tiktok;
    assert.equal(changed.postId, 'oet-wch-nov20-tiktok');            // same post…
    assert.equal(changed.approval.status, 'invalidated');           // …but the approval no longer covers it
    assert.equal(changed.publishable, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('approval is refused for failed validation, after the post-by date, or without a named approver; rejection is recorded', () => {
  const dir = tmp(); const ap = path.join(dir, 'approvals');
  try {
    buildArtifacts({ manifest: fakeManifest({ qaError: true }), outDir: dir, factual: factualOk, approvalsDir: ap });
    const ig = path.join(dir, 'publish', 'instagram.json');
    const tt = path.join(dir, 'publish', 'tiktok.json');
    assert.throws(() => recordDecision(ig, { decision: 'approved', by: 'Rajan', today: TODAY }, ap), /failed validation/);
    assert.throws(() => recordDecision(tt, { decision: 'approved', by: 'Rajan', today: '2026-11-20' }, ap), /past its post-by date \(2026-11-19\)/);
    assert.throws(() => recordDecision(tt, { decision: 'approved', by: ' ', today: TODAY }, ap), /--by is required/);
    const r = recordDecision(tt, { decision: 'rejected', by: 'Rajan', note: 'hook too long', today: TODAY }, ap);
    assert.deepEqual([r.approval.status, r.approval.note, r.publishable], ['rejected', 'hook too long', false]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('content hash and post id are deterministic', () => {
  const imgs = [{ sha256: H('a') }, { sha256: H('b') }];
  assert.equal(contentHash(imgs, 'x'), contentHash(imgs.map((i) => ({ ...i })), 'x'));
  assert.notEqual(contentHash(imgs, 'x'), contentHash(imgs, 'x '));
  assert.notEqual(contentHash(imgs, 'x'), contentHash([...imgs].reverse(), 'x'));
  assert.equal(postIdFor('wch-nov20', 'instagram'), 'oet-wch-nov20-instagram');
  assert.equal(approvalFor('oet-none-tiktok', 'h', null).status, 'pending');
});

test('end to end: a tracker campaign renders, and its artifacts match the schema and the PNG files on disk', { timeout: 120_000 }, async () => {
  const { renderSpec, launchBrowser } = await import('../src/render/render.js');
  const dir = tmp();
  const campaignFile = path.join(dir, 'campaign.json');
  writeFileSync(campaignFile, JSON.stringify({
    id: 'wch-e2e', title: 'WCH e2e', status: 'verified', theme: 'wine', platforms: ['tiktok'], tracker: { entries: ['wch'] },
    slides: [
      { layout: 'hook', variant: 'plain', title: 'one extern posting closes nov 20', facts: ['wch-deadline'] },
      { layout: 'deadline', fact: 'wch-deadline', details: [{ label: 'Pay', fact: 'wch-pay' }, { label: 'Certification', fact: 'wch-bcls' }] },
      { layout: 'cta', action: 'save', title: 'save this' },
    ],
    caption: { text: "Women's College Hospital's extern posting closes Nov 20 ($20.60/hr as posted).", hashtags: ['#NursingStudent'] },
  }));
  const browser = await launchBrowser();
  try {
    const fc = factualCheck(campaignFile, { dataFile: fileURLToPath(new URL('hospitals.json', FIX)), evidenceDirs: [fileURLToPath(new URL('evidence/', FIX))], today: TODAY });
    assert.equal(fc.factual.passed, true);
    const out = path.join(dir, 'out');
    const res = await renderSpec(fc.spec, { outDir: out, today: TODAY, browser });
    const a = buildArtifacts({ manifest: res.manifest, outDir: out, factual: fc.factual, provenance: fc.provenance, approvalsDir: path.join(dir, 'ap') }).tiktok;
    assert.equal(PublishArtifactSchema.safeParse(a).success, true);
    assert.equal(a.validation.visual.passed, true);
    assert.deepEqual(a.images.map((i) => i.layout), ['hook', 'deadline', 'receipts', 'cta']); // receipts slide added automatically
    for (const img of a.images) {
      const png = readFileSync(path.resolve(out, 'publish', img.path));
      assert.equal(createHash('sha256').update(png).digest('hex'), img.sha256);
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1080, 1920]);
    }
    assert.deepEqual(a.sources.map((s) => [s.url, s.accessedAt, path.basename(s.evidence.file)]), [['https://jobs.dayforcehcm.com/en-US/wch/CANDIDATEPORTAL/jobs/3892', '2026-11-14', 'wch-3892-2026-11-14.txt']]);
    assert.equal(a.verification.postBy, '2026-11-19');
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }
});
