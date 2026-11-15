// Producer side of Grokbot's publishing kit (HERMES_HANDOFF.md, manifest v1).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanAlt, checkPackage, exportPackage, fingerprint, imageInfo, loadSchema, parseHashtags, schemaErrors, SCHEMA_PATH } from '../src/handoff/pubkit.js';
import { checkSourceQuotes, normalizeForQuote } from '../src/handoff/sources.js';
import { makeIndex, parseCapture } from '../src/tracker/evidence.js';

const FIX = new URL('./fixtures/grokbot/', import.meta.url);
const TEST001 = JSON.parse(readFileSync(new URL('test-001.publish-manifest.json', FIX)));
const PROJECT = JSON.parse(readFileSync(new URL('project.ontario-extern-tracker.json', FIX)));
const KIT = process.env.PUBKIT_DIR ?? path.join(homedir(), 'Downloads/publishing-kit');
const HAVE_KIT = existsSync(path.join(KIT, 'bin/pubkit.py'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const TODAY = '2026-11-14';

// ---------------------------------------------------------------- fp1 + hashtags + schema (pure)
test("fp1 reproduces Grokbot's published test vector for test-001", () => {
  assert.equal(fingerprint(TEST001.assets, TEST001.caption, TEST001.hashtags), 'f20c243e89cf3d2b0ca2be314d9de8c185a754373387602204001295cabdf58d');
  assert.equal(TEST001.content_fingerprint, 'f20c243e89cf3d2b0ca2be314d9de8c185a754373387602204001295cabdf58d');
});

test('hashtags are parsed exactly like pubkit.py: in order, only after whitespace or at the start', () => {
  assert.deepEqual(parseHashtags(TEST001.caption), TEST001.hashtags);
  assert.deepEqual(parseHashtags('#first word #second\n#third'), ['#first', '#second', '#third']);
  assert.deepEqual(parseHashtags('email a#b and #c#d, #e_f!'), ['#c', '#e_f']);
  assert.deepEqual(parseHashtags('#infirmière #nurse2026'), ['#infirmière', '#nurse2026']);
});

test('the vendored schema is byte-identical to the kit, and the real test-001 manifest passes it', { skip: !HAVE_KIT && 'kit not on this machine' }, () => {
  assert.equal(sha(readFileSync(SCHEMA_PATH)), sha(readFileSync(path.join(KIT, 'schema/publish-manifest.v1.schema.json'))));
});

test('schema check accepts Grokbot\'s own example and rejects what Grokbot rejects', () => {
  const schema = loadSchema();
  assert.deepEqual(schemaErrors(TEST001, schema), []);
  const bad = (mut) => { const m = structuredClone(TEST001); mut(m); return schemaErrors(m, schema); };
  assert.match(bad((m) => { m.approval_state = 'approved'; }).join(), /approval_state/);
  assert.match(bad((m) => { m.extra = 1; }).join(), /unexpected property extra/);
  assert.match(bad((m) => { m.assets[0].sha256 = 'XYZ'; }).join(), /assets\[0\]\.sha256/);
  assert.match(bad((m) => { m.assets[0].file = '01-hook.jpg'; }).join(), /assets\[0\]\.file/);
  assert.match(bad((m) => { delete m.source_verification.reverify_by; }).join(), /missing reverify_by/);
  assert.match(bad((m) => { m.destination.format = 'video'; }).join(), /destination\.format/);
  assert.match(bad((m) => { m.manifest_version = '2.0'; }).join(), /manifest_version/);
});

test('alt text is plain: no emoji, arrows, invisible characters or doubled punctuation', () => {
  assert.equal(cleanAlt('receipts 🧾\nswipe →'), 'receipts. swipe');
  assert.equal(cleanAlt('twice –\u2060once in October'), 'twice – once in October');
  assert.equal(cleanAlt('not just nursing students 🙌🏽\nmore allied health students'), 'not just nursing students. more allied health students');
  assert.equal(cleanAlt('done.\n\nnext'), 'done. next');
});

test('source checks find quotes through invisible characters but fail when a quote is gone', async () => {
  assert.equal(normalizeForQuote('twice –\u2060once&nbsp;in <b>October</b>'), 'twice –once in October');
  const spec = { facts: [{ id: 'f', kind: 'program', quote: 'matched with hospitals twice – once in October', sources: ['s'], verifiedAt: TODAY }], sources: [{ id: 's', url: 'https://example.org/page', primary: true }] };
  const page = '<p>Each year, students are matched with hospitals twice –\u2060once in October and again in February</p>';
  const evidence = makeIndex([parseCapture(`URL: https://example.org/page\nCAPTURED: ${TODAY} 12:00\n\n${page}`, 'cap.txt')]);
  const ok = await checkSourceQuotes(spec, { evidence, fetchImpl: async () => new Response(page, { status: 200 }) });
  // the quote has a space after the dash and the page has none: verbatim means verbatim
  assert.deepEqual(ok.blockers, ['f: quote no longer on the live page https://example.org/page', 'f: quote not in the saved capture cap.txt']);
  spec.facts[0].quote = 'matched with hospitals twice –once in October';
  const good = await checkSourceQuotes(spec, { evidence, fetchImpl: async () => new Response(page, { status: 200 }) });
  assert.deepEqual(good.blockers, []);
  const gone = await checkSourceQuotes(spec, { evidence, fetchImpl: async () => new Response('moved', { status: 404 }) });
  assert.deepEqual(gone.blockers, ['https://example.org/page returned HTTP 404']);
});

// ---------------------------------------------------------------- export (real JPEGs from Chromium)
let browser; const JPEGS = [];
before(async () => {
  const { launchBrowser } = await import('../src/render/render.js');
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  for (const [i, c] of ['#8fb3d9', '#f2c14e', '#6a2c3b'].entries()) {
    await page.setContent(`<body style="margin:0;background:${c};font:120px sans-serif"><p style="margin:300px 80px">slide ${i + 1}</p></body>`);
    JPEGS.push(await page.screenshot({ type: 'jpeg', quality: 92 }));
  }
  const small = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  JPEGS.push(await small.screenshot({ type: 'jpeg', quality: 92 }));
});
after(async () => { await browser?.close(); });

const sv = (over = {}) => ({ state: 'verified', checked_at: TODAY, reverify_by: '2027-05-13', expires_at: null, sources: [{ url: 'https://www.ontariohealth.ca/news/enhanced-extern-program', publisher: 'Ontario Health', primary: true, accessed_at: TODAY }], blockers: [], conflicts: [], engagement_claims: [], ...over });
const CAPTION = 'externing, explained: paid hospital work while you’re a student.\n\n#nursingstudent #externship';
function opts(inbox, over = {}) {
  return {
    inbox, project: 'ontario-extern-tracker', postId: 'oet-test-handoff', today: TODAY, projectConfig: PROJECT,
    destination: { platform: 'tiktok', account: '@ontarioextern', format: 'photo_carousel', visibility_requested: 'only_you' },
    slides: JPEGS.slice(0, 3).map((b, i) => ({ png: b, layout: ['hook', 'board', 'cta'][i], alt: `slide ${i + 1} 🧾\nswipe →` })),
    toJpeg: async (b) => b, caption: CAPTION,
    generator: { name: '@oet/creative-engine', version: '0.1.0', created_by: 'hermes', spec_id: 'test' },
    sourceVerification: sv(), now: () => new Date('2026-11-14T17:00:00Z'), ...over,
  };
}
const tmpInbox = () => mkdtempSync(path.join(tmpdir(), 'oet-inbox-'));
const listAll = (d) => existsSync(d) ? readdirSync(d, { recursive: true }).map(String) : [];

test('a package matches the schema, its checksums match the files, and image order is preserved', async () => {
  const inbox = tmpInbox();
  try {
    const r = await exportPackage(opts(inbox));
    assert.deepEqual(r.errors, []);
    const dir = path.join(inbox, 'ontario-extern-tracker', 'oet-test-handoff');
    assert.equal(r.dir, dir);
    assert.deepEqual(readdirSync(dir).sort(), ['READY.json', 'assets', 'publish-manifest.json']);
    const m = JSON.parse(readFileSync(path.join(dir, 'publish-manifest.json'), 'utf8'));
    assert.deepEqual(schemaErrors(m, loadSchema()), []);
    assert.deepEqual(checkPackage(m, dir, { project: PROJECT, today: TODAY }), []);
    assert.deepEqual(m.assets.map((a) => [a.index, a.file]), [[1, 'assets/01-hook.jpg'], [2, 'assets/02-board.jpg'], [3, 'assets/03-cta.jpg']]);
    for (const [i, a] of m.assets.entries()) {
      const bytes = readFileSync(path.join(dir, a.file));
      assert.equal(sha(bytes), a.sha256);                 // checksum = file on disk
      assert.ok(bytes.equals(JPEGS[i]));                    // slide i is exactly input i
      assert.deepEqual(imageInfo(bytes), { format: 'jpeg', width: 1080, height: 1920 });
      assert.deepEqual([a.width, a.height], [1080, 1920]);
    }
    assert.deepEqual(m.assets.map((a) => a.alt), ['slide 1. swipe', 'slide 2. swipe', 'slide 3. swipe']);
    assert.deepEqual(m.hashtags, ['#nursingstudent', '#externship']);
    assert.equal(m.approval_state, 'not_requested');
    assert.equal(m.content_fingerprint, fingerprint(m.assets, m.caption, m.hashtags));
    const ready = JSON.parse(readFileSync(path.join(dir, 'READY.json'), 'utf8'));
    assert.deepEqual(ready, { post_id: 'oet-test-handoff', manifest_sha256: sha(readFileSync(path.join(dir, 'publish-manifest.json'))), asset_count: 3, written_at: '2026-11-14T17:00:00.000Z' });
    assert.deepEqual(listAll(path.join(inbox, 'ontario-extern-tracker')).filter((f) => f.includes('.tmp')), []);
  } finally { rmSync(inbox, { recursive: true, force: true }); }
});

test('READY.json is the last file written, and the folder only appears once it is complete', async () => {
  const inbox = tmpInbox();
  const finalDir = path.join(inbox, 'ontario-extern-tracker', 'oet-test-handoff');
  const writes = [];
  try {
    const r = await exportPackage(opts(inbox, { contactSheetPng: JPEGS[3], onWrite: (f) => writes.push({ file: path.basename(f), finalExists: existsSync(finalDir) }) }));
    assert.equal(r.ok, true);
    assert.deepEqual(writes.map((w) => w.file), ['01-hook.jpg', '02-board.jpg', '03-cta.jpg', 'contact-sheet.jpg', 'publish-manifest.json', 'READY.json']);
    assert.ok(writes.every((w) => w.finalExists === false));   // every write happened in the hidden temp folder
    const mtimes = readdirSync(finalDir, { recursive: true }).map(String).filter((f) => !f.endsWith('assets')).map((f) => [f, statSync(path.join(finalDir, f)).mtimeMs]);
    const readyT = mtimes.find(([f]) => f === 'READY.json')[1];
    assert.ok(mtimes.every(([, t]) => t <= readyT));
  } finally { rmSync(inbox, { recursive: true, force: true }); }
});

test('any change to images, order, caption or hashtags changes the fingerprint', async () => {
  const fps = [];
  for (const over of [{}, { caption: CAPTION.replace('student.', 'student!') }, { caption: CAPTION.replace('#externship', '#externships') },
    { slides: opts('').slides.slice().reverse().map((s, i) => ({ ...s, layout: ['hook', 'board', 'cta'][i] })) },
    { slides: opts('').slides.map((s, i) => (i === 1 ? { ...s, png: Buffer.concat([s.png, Buffer.from([0])]) } : s)) }]) {
    const inbox = tmpInbox();
    try { fps.push((await exportPackage(opts(inbox, over))).manifest.content_fingerprint); } finally { rmSync(inbox, { recursive: true, force: true }); }
  }
  assert.equal(new Set(fps).size, 5);
  // and the same content always gives the same fingerprint
  const again = tmpInbox();
  try { assert.equal((await exportPackage(opts(again))).manifest.content_fingerprint, fps[0]); } finally { rmSync(again, { recursive: true, force: true }); }
});

test('failed validation never produces a ready package (nothing in the inbox, no temp folder left)', async () => {
  const cases = {
    preflight: { preflight: [{ code: 'MIN_FONT', message: 'slide 4: 29px text' }] },
    failedSources: { sourceVerification: sv({ state: 'failed', blockers: ['permanent-hires: quote no longer on the live page'] }) },
    wrongSize: { slides: [{ png: JPEGS[3], layout: 'hook', alt: 'a' }] },                              // 1080×1350
    fictionalReply: { slides: [{ png: JPEGS[0], layout: 'hook', alt: "Reply to @future.rn's comment: wait what even is an extern" }] },
    tooManyHashtags: { caption: 'x\n\n#a #b #c #d #e #f' },
    forbiddenHashtag: { caption: 'x\n\n#nursingstudent #fyp' },
    trailingNewline: { caption: CAPTION + '\n' },
    expired: { sourceVerification: sv({ reverify_by: '2026-11-13' }) },
    badPostId: { postId: 'Bad ID' },
    externalValidatorSaysNo: { externalCheck: async () => ({ ok: false, detail: 'CONTENT_INVALID: asset_sha256_all_match' }) },
  };
  for (const [name, over] of Object.entries(cases)) {
    const inbox = tmpInbox();
    try {
      const r = await exportPackage(opts(inbox, over));
      assert.equal(r.ok, false, name);
      assert.ok(r.errors.length, name);
      assert.deepEqual(listAll(inbox).filter((f) => f.endsWith('READY.json') || f.includes('oet-test-handoff')), [], name);
    } finally { rmSync(inbox, { recursive: true, force: true }); }
  }
});

test('an existing post folder is never overwritten; a revision needs a new post_id', async () => {
  const inbox = tmpInbox();
  try {
    const first = await exportPackage(opts(inbox));
    const mPath = path.join(first.dir, 'publish-manifest.json');
    const before = sha(readFileSync(mPath));
    const second = await exportPackage(opts(inbox, { caption: CAPTION.replace('student.', 'student!') }));
    assert.equal(second.ok, false);
    assert.deepEqual(second.errors.map((e) => e.code), ['POST_ID_EXISTS']);
    assert.equal(sha(readFileSync(mPath)), before);
    const rev = await exportPackage(opts(inbox, { postId: 'oet-test-handoff-r2', supersedes: 'oet-test-handoff', caption: CAPTION.replace('student.', 'student!') }));
    assert.equal(rev.ok, true);
    assert.equal(rev.manifest.supersedes, 'oet-test-handoff');
  } finally { rmSync(inbox, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- Grokbot's own code, when the kit is here
test("Grokbot's pubkit.py accepts our manifest: schema errors none, same fp1", { skip: !HAVE_KIT && 'kit not on this machine' }, async () => {
  const inbox = tmpInbox();
  try {
    const r = await exportPackage(opts(inbox));
    const py = `import sys,json; sys.path.insert(0, sys.argv[1]+'/bin'); import pubkit as pk
m = pk.load_json(sys.argv[2]); print(json.dumps({"errors": pk.schema_errors(m, pk.load_schema()), "fp": pk.fingerprint(m["assets"], m["caption"], m["hashtags"]), "tags": pk.parse_hashtags(m["caption"])}))`;
    const out = JSON.parse(execFileSync('python3', ['-c', py, KIT, path.join(r.dir, 'publish-manifest.json')], { encoding: 'utf8' }));
    assert.deepEqual(out, { errors: [], fp: r.manifest.content_fingerprint, tags: ['#nursingstudent', '#externship'] });
  } finally { rmSync(inbox, { recursive: true, force: true }); }
});

const PY = process.env.PUBKIT_PYTHON;
test("Grokbot's validate.py: every content check passes, only the approval is missing", { skip: !(HAVE_KIT && PY) && 'needs PUBKIT_PYTHON (Python with Pillow) and the kit' }, async () => {
  const inbox = tmpInbox();
  try {
    const r = await exportPackage(opts(inbox));
    let out;
    try { out = execFileSync(PY, [path.join(KIT, 'bin/validate.py'), r.dir, '--kit', KIT, '--state-dir', mkdtempSync(path.join(tmpdir(), 'oet-state-')), '--today', TODAY, '--json'], { encoding: 'utf8' }); }
    catch (e) { out = e.stdout; assert.equal(e.status, 3); }
    const v = JSON.parse(out);
    assert.equal(v.verdict, 'APPROVAL_REQUIRED');
    assert.deepEqual(v.checks.filter((c) => !c.ok).map((c) => c.check), ['exact_approval_on_record']);
  } finally { rmSync(inbox, { recursive: true, force: true }); }
});
