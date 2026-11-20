// Formats C and B (reference package 2026-11-14): spec rules, imagery provenance, voice,
// platforms and the publish contract. No browser needed; rendering is in formats-render.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseSpec, LAYOUTS } from '../src/spec/schema.js';
import { prepareSpec, verifySpec, slideWordCount, formatOf } from '../src/spec/verify.js';
import { sourceLine } from '../src/spec/sourceLine.js';
import { geometry, PLATFORMS, DEFAULT_PLATFORMS } from '../src/platforms.js';
import { loadRegistry, REGISTRY_PATH, ASSETS_DIR } from '../src/assets/registry.js';
import { cTextOffset } from '../src/ui/formats.js';
import { buildArtifacts } from '../src/publish/artifact.js';
import { PublishArtifactSchema } from '../src/publish/schema.js';
import { buildManifest, loadSchema, schemaErrors } from '../src/handoff/pubkit.js';
import { photoNotes } from '../bin/oet.mjs';

const TODAY = '2026-11-14';
const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const C = () => read('../specs/formats/c-what-a-clinical-extern-is.json');
const B = () => read('../specs/formats/b-what-a-clinical-extern-is.json');
const DECK = read('./fixtures/formats/copy-deck.json');

function check(raw, { registry, today = TODAY } = {}) {
  const { spec, errors } = parseSpec(raw);
  if (!spec) return { errors, warnings: [], schema: true };
  return verifySpec(prepareSpec(spec), { today, ...(registry && { registry }) });
}
const codes = (r) => r.errors.map((e) => e.code);
const warnCodes = (r) => r.warnings.map((w) => w.code);

// A throwaway registry: one real photo file, entries edited per test.
function tempRegistry(edit = (a) => a, extra = [], top = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'oet-registry-'));
  const real = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  const src = real.assets.find((a) => a.id === 'pexels-5386483');
  copyFileSync(path.join(ASSETS_DIR, src.file), path.join(dir, 'photo.jpg'));
  const base = { ...structuredClone(src), id: 'test-photo', file: 'photo.jpg' };
  const others = real.assets.map((a) => ({ ...a, file: path.join(ASSETS_DIR, a.file) })); // the rest of the real registry
  const reg = { ...real, ...top, assets: [...others, edit(base), ...extra.map((e) => ({ ...structuredClone(src), file: 'photo.jpg', ...e }))] };
  const file = path.join(dir, 'registry.json');
  writeFileSync(file, JSON.stringify(reg));
  return loadRegistry(file);
}
// A one-photo C carousel using the temp registry's "test-photo".
const cWith = (photo = 'test-photo', extra = {}) => {
  const s = C();
  s.slides[2] = { ...s.slides[2], photo, ...extra };
  return s;
};

// ---------------------------------------------------------------- the approved reference copy
test('C and B carry the copy deck verbatim: same headlines, bodies, fine print, facts, caption', () => {
  const c = C(), b = B();
  assert.equal(c.slides.length, 7);
  assert.equal(b.slides.length, 7);
  const deckHead = DECK.slides.map((s) => s.headline);
  assert.deepEqual([`${c.slides[0].title} ${c.slides[0].titleTail}`, ...c.slides.slice(1).map((s) => s.title)], deckHead);
  assert.deepEqual(b.slides.map((s) => s.title), deckHead);
  const deckBody = DECK.slides.map((s) => s.body);
  assert.deepEqual(c.slides.map((s) => s.body ?? null), deckBody);
  assert.deepEqual(b.slides.map((s) => s.body ?? null), deckBody);
  assert.equal(c.slides[6].fine, 'Not affiliated with any hospital or Ontario Health.');
  assert.equal(b.slides[6].fine, c.slides[6].fine);
  assert.deepEqual(c.slides.map((s) => s.facts ?? []), DECK.slides.map((s) => s.facts));
  assert.deepEqual(b.slides.map((s) => s.facts ?? []), DECK.slides.map((s) => s.facts));
  for (const spec of [c, b]) {
    assert.deepEqual(spec.facts.map((f) => [f.id, f.claim, f.verifiedAt]), DECK.facts.map((f) => [f.id, f.claim, f.verifiedAt]));
    // Caption corrected 2026-11-14 (Rajan): the deck said "every fact here is from Ontario Health", but the
    // last slide describes our own site. Hashtags unchanged.
    assert.deepEqual(spec.caption.hashtags, DECK.caption.hashtags);
    assert.equal(spec.caption.text, "what a clinical extern actually is, in plain words. the program facts are from Ontario Health's Enhanced Extern Program page (updated June 4, 2026). looking for postings? ontarioexterns.ca is our own independent tracker, not affiliated with any hospital or Ontario Health. which part was new to you?");
    assert.doesNotMatch(spec.caption.text, /every fact/);
  }
  // C2 label: no clinical-tool emoji; C6: no people under the permanent-positions claim
  assert.equal(c.slides[1].label, 'extern notes 📝');
  assert.equal(c.slides[5].photo, 'pexels-2440970');
  assert.equal(loadRegistry().byId.get(c.slides[5].photo).contains_people, false);
  assert.deepEqual(c.facts, b.facts);
  assert.deepEqual(c.sources, b.sources);
  // the one documented change: Ontario Health shows "Last Updated", not a publish date
  const oh = c.sources.find((s) => s.id === 'ontario-health-extern');
  assert.equal(oh.updated, '2026-06-04');
  assert.equal(oh.published, undefined);
});

test('both reference carousels pass the fact rules: 7 slides, no receipts slide added', () => {
  const rc = check(C());
  assert.deepEqual(codes(rc), []);
  assert.deepEqual(warnCodes(rc), ['SAME_COMPOSITION']); // C6 and C7 are both desk/object photos (editorial)
  assert.equal(rc.publishable, true);
  const rb = check(B());
  assert.deepEqual(codes(rb), []);
  assert.deepEqual(warnCodes(rb), []);
  for (const raw of [C(), B()]) {
    const prepared = prepareSpec(parseSpec(raw).spec);
    assert.equal(prepared.slides.length, 7);
    assert.ok(!prepared.slides.some((s) => s.layout === 'receipts'));
  }
  assert.equal(formatOf(prepareSpec(parseSpec(C()).spec)), 'c');
  assert.equal(formatOf(prepareSpec(parseSpec(B()).spec)), 'b');
});

test('source lines are generated from the cited facts, never typed', () => {
  const c = prepareSpec(parseSpec(C()).spec);
  assert.equal(sourceLine(c.slides[1], c), 'Source: Ontario Health, Enhanced Extern Program page, updated June 4, 2026');
  assert.equal(sourceLine(c.slides[0], c), null); // cover: no facts
  assert.equal(sourceLine(c.slides[6], c), null); // CTA about the tracker: fine print instead
  // posting facts decay, so their line says when they were checked
  const s = structuredClone(c);
  s.facts.push({ id: 'd', kind: 'deadline', claim: 'x', date: '2026-11-20', sources: ['ontario-health-extern'], verifiedAt: '2026-11-13' });
  assert.equal(sourceLine({ layout: 'b_card', basis: 'facts', facts: ['d'] }, s), 'Source: Ontario Health, Enhanced Extern Program page, updated June 4, 2026, checked November 13, 2026');
  assert.equal(sourceLine(c.slides[1], c, { demo: true }), 'Sample data for illustration. Not real postings.');
});

test('word counts include the source line and fixed labels (literal, matching the reference QA)', () => {
  const c = prepareSpec(parseSpec(C()).spec);
  const b = prepareSpec(parseSpec(B()).spec);
  assert.deepEqual(c.slides.map((s) => slideWordCount(s, c)), [11, 38, 29, 37, 38, 39, 32]);
  assert.deepEqual(b.slides.map((s) => slideWordCount(s, b)), [12, 42, 34, 41, 38, 43, 39]);
});

// ---------------------------------------------------------------- imagery provenance (AC3, AC4)
test('an asset missing its licence URL, source, photographer, page URL or check date is rejected', () => {
  for (const [field, edit] of [
    ['licence.url', (a) => ({ ...a, licence: { name: 'Pexels License' } })],
    ['source', (a) => ({ ...a, source: '' })],
    ['photographer', (a) => { delete a.photographer; return a; }],
    ['page_url', (a) => ({ ...a, page_url: ' ' })],
    ['checked', (a) => { delete a.checked; return a; }],
  ]) {
    const r = check(cWith(), { registry: tempRegistry(edit) });
    assert.deepEqual(codes(r), ['ASSET_PROVENANCE'], field);
    assert.match(r.errors[0].message, new RegExp(field.replace('.', '\\.')));
  }
  const bad = check(cWith(), { registry: tempRegistry((a) => ({ ...a, checked: 'Nov 14' })) });
  assert.deepEqual(codes(bad), ['ASSET_PROVENANCE']);
});

test('every imagery guardrail flag, and identifiable faces, rejects the photo', () => {
  for (const flag of ['clinical_tools', 'badge_or_id', 'patient_or_clinical_setting', 'third_party_screen', 'legible_logo']) {
    const r = check(cWith(), { registry: tempRegistry((a) => ({ ...a, flags: { ...a.flags, [flag]: true } })) });
    assert.deepEqual(codes(r), ['ASSET_FLAGGED'], flag);
  }
  const faces = check(cWith(), { registry: tempRegistry((a) => ({ ...a, identifiable_faces: true })) });
  assert.deepEqual(codes(faces), ['ASSET_FLAGGED']);
  assert.match(faces.errors[0].message, /identifiable faces/);
  const noFlags = check(cWith(), { registry: tempRegistry((a) => { delete a.flags; return a; }) });
  assert.deepEqual(codes(noFlags), ['ASSET_FLAGGED']);
});

test('face covers (2026-11-18): faces pass only with the face policy on AND the photo marked stock_person_not_student', () => {
  const on = (edit) => tempRegistry(edit, [], { face_policy: { allowed: true } });
  assert.deepEqual(codes(check(cWith(), { registry: on((a) => ({ ...a, identifiable_faces: true, stock_person_not_student: true })) })), []);
  assert.deepEqual(codes(check(cWith(), { registry: on((a) => ({ ...a, identifiable_faces: true })) })), ['ASSET_FLAGGED']);
  // policy off (as before): faces refused even if marked
  assert.deepEqual(codes(check(cWith(), { registry: tempRegistry((a) => ({ ...a, identifiable_faces: true, stock_person_not_student: true }), [], { face_policy: { allowed: false } }) })), ['ASSET_FLAGGED']);
  // clinical tools stay forbidden on face photos
  assert.deepEqual(codes(check(cWith(), { registry: on((a) => ({ ...a, identifiable_faces: true, stock_person_not_student: true, flags: { ...a.flags, clinical_tools: true } })) })), ['ASSET_FLAGGED']);
});

test('unregistered, rejected-in-review, altered and blur-only photos are refused', () => {
  assert.deepEqual(codes(check(cWith('pexels-0000001'))), ['UNKNOWN_ASSET']);
  const rej = check(cWith('pexels-5206954'));
  assert.deepEqual(codes(rej), ['REJECTED_ASSET']);
  assert.match(rej.errors[0].message, /Stethoscope/);
  assert.deepEqual(codes(check(cWith(), { registry: tempRegistry((a) => ({ ...a, sha256: '0'.repeat(64) })) })), ['ASSET_FILE']);
  assert.deepEqual(codes(check(cWith(), { registry: tempRegistry((a) => ({ ...a, file: 'missing.jpg' })) })), ['ASSET_FILE']);
  // pexels-3973981 is registered "blur only": fine behind the notes card, refused as a plain photo
  assert.deepEqual(codes(check(cWith('pexels-3973981'))), ['ASSET_TREATMENT']);
  const b = B();
  b.slides[0].photo = 'pexels-5386483'; // hands: people on a B cover
  assert.deepEqual(codes(check(b)), ['B_COVER_PEOPLE']);
});

test('a repeated shoot only warns (editorial), as does the same composition on adjacent slides', () => {
  const reg = tempRegistry((a) => a, [{ id: 'test-photo-2' }]); // same shoot_id, same composition
  const s = cWith();
  s.slides[3] = { ...s.slides[3], photo: 'test-photo-2' };
  const r = check(s, { registry: reg });
  assert.deepEqual(codes(r), []);
  assert.ok(warnCodes(r).includes('SAME_SHOOT'));
  assert.ok(warnCodes(r).includes('SAME_COMPOSITION'));
  assert.equal(r.publishable, true);
});

// ---------------------------------------------------------------- annotations and voice (AC3)
test('asides never carry money, dates or counts', () => {
  for (const text of ['$20.60/hr!', 'closes nov 20', 'by friday', 'only 3 left', 'two spots', 'apply today']) {
    const s = C();
    s.slides[6].asides = [{ text, at: { x: 0.5, y: 0.78 } }];
    assert.ok(codes(check(s)).includes('ASIDE_SPECIFIC'), text); // money also trips UNSUPPORTED_SPECIFIC
  }
  const tail = C();
  tail.slides[0].titleTail = '(2026 edition)';
  assert.deepEqual(codes(check(tail)), ['ASIDE_SPECIFIC']);
});

test('at most two asides, on the cover and the CTA only; at most two designed slides', () => {
  const many = C();
  many.slides[0].asides.push({ text: 'yep', at: 'below' }); // cover 2 + CTA 1 = 3 (cover stays at 12 words)
  assert.deepEqual(codes(check(many)), ['ASIDE_COUNT']);
  const inner = C();
  inner.slides[2].asides = [{ text: 'wow', at: 'below' }];
  delete inner.slides[6].asides; // keep the total at two
  assert.deepEqual(codes(check(inner)), ['ASIDE_PLACEMENT']);
  const designed = C();
  designed.slides[5] = { layout: 'c_paper', title: 'some externs get hired', body: designed.slides[5].body, facts: ['oh-permanent-hires'] };
  designed.slides[3] = { layout: 'c_notes', photo: 'pexels-3973981', title: 'program matching', body: designed.slides[3].body, facts: ['oh-matching-rounds'] };
  assert.ok(codes(check(designed)).includes('C_DESIGNED_MAX'));
});

test('a clinical-tool emoji still warns (the stethoscope removed from C2 would be flagged)', () => {
  const s = C();
  s.slides[1].label = 'extern notes 🩺';
  assert.deepEqual(warnCodes(check(s)), ['CLINICAL_EMOJI', 'SAME_COMPOSITION']);
});

test('a word-mark must mark text that is on the slide', () => {
  const s = C();
  s.slides[3].mark = { kind: 'circle', phrase: 'March and April' };
  assert.deepEqual(codes(check(s)), ['MARK_NOT_FOUND']);
});

test('first-person student claims from the brand account are rejected', () => {
  for (const line of ['I got my extern offer at Sunnybrook', 'my first shift as an extern was wild', 'I landed an externship', "I'm a nursing student and this worked"]) {
    const s = B();
    s.slides[2].body = line;
    assert.ok(codes(check(s)).includes('FIRST_PERSON_CLAIM'), line);
  }
  const cap = B();
  cap.caption.text = 'we got hired after externing!';
  assert.deepEqual(codes(check(cap)), ['FIRST_PERSON_CLAIM']);
  // the same claim on a classic layout (not only the new formats)
  const legacy = read('../specs/examples/explainer-what-is-an-extern.json');
  legacy.slides[0].sub = 'how I landed my externship';
  assert.ok(codes(check(legacy, { today: '2026-11-13' })).includes('FIRST_PERSON_CLAIM'));
});

test('no first-person copy over stock photos, and alt text never labels a stock model', () => {
  const s = C();
  s.slides[5].body = 'We think hospitals are hiring externs for permanent positions.';
  assert.ok(codes(check(s)).includes('STOCK_FIRST_PERSON'));
  const alt = C();
  alt.slides[0].alt = 'Two nursing students studying in a park.'; // C1's photo shows people (hands)
  assert.deepEqual(codes(check(alt)), ['PHOTO_PERSON_LABEL']);
  const scene = C();
  scene.slides[0].alt = 'Hands writing in a notebook next to a laptop, outdoors.';
  assert.deepEqual(codes(check(scene)), []);
  const noPeople = C();
  noPeople.slides[5].alt = 'Glasses on a student notebook.'; // C6's photo has no people, so nobody is being labelled
  assert.deepEqual(codes(check(noPeople)), []);
});

test('the fabricated reply sticker is retired; other hook variants are unchanged', () => {
  const r = check({
    id: 'new-post', title: 't', status: 'verified', theme: 'ceil',
    slides: [{ layout: 'hook', variant: 'reply', reply: { user: '@someone', comment: 'what is an extern' }, title: 'a hook' }, { layout: 'cta', action: 'save', title: 'save this' }],
    caption: { text: 'caption' },
  });
  assert.deepEqual(codes(r), ['REPLY_STICKER_RETIRED']);
  for (const name of ['explainer-what-is-an-extern', 'demo-product-and-community', 'demo-roundup-closing-soon', 'comparison-same-title-fine-print']) {
    const spec = read(`../specs/examples/${name}.json`);
    assert.ok(!spec.slides.some((s) => s.variant === 'reply' || s.reply), `${name} migrated`);
  }
  const posts = read('../specs/posts/what-is-an-extern.json');
  assert.ok(!posts.slides.some((s) => s.variant === 'reply' || s.reply));
});

test('B icons are topic icons only: a clinical-task icon is not in the schema', () => {
  const s = B();
  s.slides[2].icon = 'syringe';
  const r = check(s);
  assert.equal(r.schema, true);
  assert.match(r.errors[0].where, /slides\.2\.icon/);
});

test('one format per carousel; density limits are enforced', () => {
  const mixed = C();
  mixed.slides[4] = { layout: 'b_card', chip: 'who', icon: 'handshake', title: mixed.slides[4].title, body: mixed.slides[4].body, facts: ['oh-allied-health'] };
  assert.ok(codes(check(mixed)).includes('FORMAT_MIX'));
  const dense = B();
  dense.slides[5].body += ' Ask each hospital how their program works before you apply.';
  const r = check(dense);
  assert.deepEqual(codes(r), ['DENSITY']);
  assert.match(r.errors[0].message, /^53 words .*allow 45\.$/);
});

// ---------------------------------------------------------------- platforms (AC5)
test('defaults stay 1080x1920 and 1080x1350; 3:4 is opt-in with the provisional margins', () => {
  assert.deepEqual(DEFAULT_PLATFORMS, ['tiktok', 'instagram']);
  const spec = parseSpec({ id: 'x', title: 'x', status: 'verified', theme: 'ceil', slides: [{ layout: 'hook', title: 'a' }, { layout: 'cta', action: 'save', title: 'b' }], caption: { text: 'c' } }).spec;
  assert.deepEqual(spec.platforms, ['tiktok', 'instagram']);
  assert.deepEqual([PLATFORMS.tiktok.width, PLATFORMS.tiktok.height, PLATFORMS.tiktok.safe], [1080, 1920, { top: 210, right: 150, bottom: 460, left: 72 }]);
  assert.deepEqual([PLATFORMS.instagram.width, PLATFORMS.instagram.height, PLATFORMS.instagram.safe], [1080, 1350, { top: 110, right: 84, bottom: 110, left: 84 }]);
  const g = geometry('tiktok-3x4');
  assert.deepEqual([g.width, g.height, g.box, g.cunit, g.candidate, g.optIn], [1080, 1440, { x: 72, y: 80, width: 868, height: 1190 }, 1, true, true]);
  assert.equal(geometry('tiktok').unit, 1); // the classic type scale is untouched
  assert.equal(geometry('tiktok').cunit, 0.988);
  assert.equal(geometry('instagram').cunit, 0.95);
});

test('C text sits on the photo\'s registered quiet area, never centred', () => {
  const c = prepareSpec(parseSpec(C()).spec);
  const reg = loadRegistry();
  const ctxFor = (pid) => ({ platform: geometry(pid), photo: (id) => reg.byId.get(id) });
  // slide 3: quiet area "top", nudge -10; slide 4: quiet area "bottom", nudge 0
  assert.deepEqual(['tiktok-3x4', 'tiktok', 'instagram'].map((p) => cTextOffset(c.slides[2], ctxFor(p))), [30, 30, 29]);
  assert.deepEqual(['tiktok-3x4', 'tiktok', 'instagram'].map((p) => cTextOffset(c.slides[3], ctxFor(p))), [550, 578, 522]);
  // at 3:4 that is canvas y 110 and 630: inside the handoff's 110–130 / 620–640 bands
  assert.deepEqual([80 + 30, 80 + 550], [110, 630]);
  assert.equal(cTextOffset({ ...c.slides[3], place: 'top' }, ctxFor('tiktok-3x4')), 40);
});

test('the layouts list includes every C and B layout (CLI `creative layouts`)', () => {
  for (const k of ['c_photo', 'c_notes', 'c_paper', 'b_cover', 'b_card', 'b_cta']) assert.ok(LAYOUTS[k], k);
  for (const k of ['hook', 'text_stack', 'big_stat', 'board', 'checklist', 'wristbands', 'deadline', 'versus', 'phone', 'badge', 'receipts', 'cta']) assert.ok(LAYOUTS[k], k);
});

// ---------------------------------------------------------------- publish contracts (AC6)
const fakeManifest = (platforms) => ({
  engine: '@oet/creative-engine@0.1.0', generatedAt: '2026-11-14T17:00:00.000Z',
  spec: { id: 'c-what-a-clinical-extern-is', title: 't', status: 'verified', theme: 'board', sha256: 'x', path: null },
  verification: { publishable: true, blockers: [], checkedAgainst: TODAY, postBy: null, reverifyBy: '2027-02-12', warnings: [] },
  facts: [], sources: [], platforms, qa: { errors: 0, passed: true }, publishable: true,
});
const slideOut = (pid, n, assets) => ({ n, layout: 'c_photo', file: `${pid}/0${n}-c_photo.png`, preview: null, sha256: 'a'.repeat(64), alt: 'alt.', qa: { errors: [], warnings: [] }, ...(assets && { assets }) });
const PROV = { id: 'pexels-5537938', role: 'photo', source: 'Pexels', page_url: 'https://www.pexels.com/photo/x-5537938/', photographer: 'Zen Chung', licence: 'Pexels License', licence_url: 'https://www.pexels.com/license/', checked: '2026-11-14', shoot_id: 'zen-chung/park-study-session', file_sha256: 'b'.repeat(64) };

test('publish artifacts: per-slide photo provenance is added; no artifact for the 3:4 candidate', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'oet-art-'));
  const plat = (pid, size) => ({ size, safeArea: {}, caption: 'c\n\n#nursingstudent', contactSheet: `${pid}-contact-sheet.png`, slides: [slideOut(pid, 1, [PROV]), slideOut(pid, 2)] });
  const arts = buildArtifacts({
    manifest: fakeManifest({ tiktok: plat('tiktok', [1080, 1920]), 'tiktok-3x4': { ...plat('tiktok-3x4', [1080, 1440]), candidate: true } }),
    outDir, factual: { passed: true, errors: [], warnings: [] }, approvalsDir: path.join(outDir, 'approvals'),
  });
  assert.deepEqual(Object.keys(arts), ['tiktok']);
  const a = arts.tiktok;
  assert.deepEqual(a.images[0].assets, [PROV]);
  assert.equal(a.images[1].assets, undefined);
  assert.equal(PublishArtifactSchema.safeParse(a).success, true);
  // existing artifact fields are unchanged
  assert.deepEqual(Object.keys(a.images[1]), ['order', 'path', 'sha256', 'alt', 'layout']);
  assert.equal(a.postId, 'oet-c-what-a-clinical-extern-is-tiktok');
  assert.equal(a.aspectRatio, '9:16');
});

test("Grokbot manifest v1 is unchanged: no new keys; photo provenance travels in the existing free-text notes", () => {
  const notes = photoNotes({ slides: [slideOut('tiktok', 1, [PROV]), slideOut('tiktok', 2, [{ ...PROV, id: 'pexels-3973981', photographer: 'Wendy Wei', page_url: 'https://www.pexels.com/photo/y-3973981/', role: 'blurred-background' }])] });
  assert.equal(notes, ' Photos: slide 1 pexels-5537938 by Zen Chung (https://www.pexels.com/photo/x-5537938/); slide 2 pexels-3973981 by Wendy Wei (https://www.pexels.com/photo/y-3973981/) blurred. Licence: Pexels License (https://www.pexels.com/license/, checked 2026-11-14). Stock models are not students, nurses or externs and are never described as such.');
  assert.equal(photoNotes({ slides: [slideOut('tiktok', 1)] }), '');
  const m = buildManifest({
    postId: 'oet-2026-11-14-c-test', project: 'ontario-extern-tracker', createdAt: '2026-11-14T17:00:00.000Z',
    generator: { name: '@oet/creative-engine', version: '0.1.0', created_by: 'hermes' },
    destination: { platform: 'tiktok', account: '@ontarioextern', format: 'photo_carousel', visibility_requested: 'only_you' },
    assets: [{ index: 1, file: 'assets/01-c_photo.jpg', sha256: 'c'.repeat(64), width: 1080, height: 1920, alt: 'alt.' }],
    caption: 'c\n\n#nursingstudent',
    sourceVerification: { state: 'verified', checked_at: TODAY, reverify_by: null, expires_at: null, sources: [], blockers: [], conflicts: [], engagement_claims: [] },
    notes: `Source checks.${notes}`,
  });
  assert.deepEqual(schemaErrors(m, loadSchema()), []);
  const allowed = Object.keys(loadSchema().properties);
  assert.deepEqual(Object.keys(m).filter((k) => !allowed.includes(k)), []);
  assert.deepEqual(Object.keys(m.assets[0]), ['index', 'file', 'sha256', 'width', 'height', 'alt']);
});

test('unlicensed photos (owner, 2026-11-20): only with the policy on, never an identifiable person, never a licence claim, flags still apply', () => {
  const un = (a) => { const b = { ...a, rights: 'unlicensed', source: 'Pinterest', page_url: 'https://www.pinterest.com/pin/1/' }; delete b.licence; delete b.photographer; return b; };
  const on = (edit) => tempRegistry(edit, [], { unlicensed_policy: { allowed: true }, face_policy: { allowed: true } });
  assert.deepEqual(codes(check(cWith(), { registry: on((a) => un(a)) })), []);
  // policy off: refused
  assert.deepEqual(codes(check(cWith(), { registry: tempRegistry((a) => un(a), [], { unlicensed_policy: { allowed: false } }) })), ['UNLICENSED_ASSET']);
  // identifiable person: refused even with the face policy on and the stock flag set
  assert.ok(codes(check(cWith(), { registry: on((a) => ({ ...un(a), identifiable_faces: true, stock_person_not_student: true })) })).includes('UNLICENSED_PERSON'));
  // a licence or photographer claim on an unlicensed photo: refused
  assert.deepEqual(codes(check(cWith(), { registry: on((a) => ({ ...un(a), photographer: 'someone' })) })), ['UNLICENSED_CLAIM']);
  // guardrail flags still apply
  assert.deepEqual(codes(check(cWith(), { registry: on((a) => ({ ...un(a), flags: { ...a.flags, legible_logo: true } })) })), ['ASSET_FLAGGED']);
  // licensed photos still need photographer + licence
  assert.deepEqual(codes(check(cWith(), { registry: on((a) => { const b = { ...a }; delete b.photographer; return b; }) })), ['ASSET_PROVENANCE']);
});

test('manifest notes never call an unlicensed photo licensed', async () => {
  const { photoNotes } = await import('../bin/oet.mjs');
  const n = photoNotes({ slides: [
    { n: 1, assets: [{ id: 'pinterest-1', role: 'photo', source: 'Pinterest', page_url: 'https://www.pinterest.com/pin/1/', photographer: null, licence: null, licence_url: null, checked: '2026-11-20', rights: 'unlicensed' }] },
    { n: 2, assets: [{ id: 'pexels-1', role: 'photo', source: 'Pexels', page_url: 'https://www.pexels.com/photo/x-1/', photographer: 'A', licence: 'Pexels License', licence_url: 'https://www.pexels.com/license/', checked: '2026-11-20' }] },
  ] });
  assert.match(n, /slide 1 pinterest-1 from https:\/\/www\.pinterest\.com\/pin\/1\/ \(NOT licensed/);
  assert.doesNotMatch(n, /pinterest-1 by/);
  assert.match(n, /Licence \(licensed photos only\): Pexels License/);
});
