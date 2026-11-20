// Producer side of Grokbot's publishing kit (HERMES_HANDOFF.md, manifest v1).
//
// Writes  <inbox>/<project>/<post_id>/
//           publish-manifest.json   manifest v1 (schema/grokbot/publish-manifest.v1.schema.json, vendored byte-for-byte)
//           assets/NN-<layout>.jpg  the exact upload files, 1080×1920
//           contact-sheet.jpg       for humans
//           READY.json              written last
//
// Finalisation is atomic: everything (READY.json last) is written into a hidden
// sibling folder ".<post_id>.tmp-<pid>", validated there, and only then renamed to
// "<post_id>". Grokbot never sees a partial folder, and a package that fails any
// check is deleted instead of finalised. An existing <post_id> folder is never touched.

import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = path.resolve(HERE, '../../schema/grokbot/publish-manifest.v1.schema.json');
export const loadSchema = (p = SCHEMA_PATH) => JSON.parse(readFileSync(p, 'utf8'));

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sha256Text = (s) => sha256(Buffer.from(s, 'utf8'));

// ---------------------------------------------------------------- pubkit.py ports (must match exactly)
/** fp1, as bin/pubkit.py fingerprint(): no Unicode or whitespace normalisation. */
export function fingerprint(assets, caption, hashtags) {
  const lines = ['pubkit-fp1'];
  for (const a of [...assets].sort((x, y) => x.index - y.index)) lines.push(`asset:${a.index}:${a.sha256.toLowerCase()}`);
  lines.push('caption:' + sha256Text(caption));
  lines.push('hashtags:' + sha256Text(hashtags.join('\n')));
  return sha256Text(lines.join('\n') + '\n');
}

/** pubkit.py HASHTAG_RE = (?:(?<=\s)|^)#(\w+). Python's Unicode \w = letters, numbers (str.isalnum) and "_". */
export function parseHashtags(caption) {
  return [...caption.matchAll(/(?:(?<=\s)|^)#([\p{L}\p{N}_]+)/gu)].map((m) => '#' + m[1]);
}

/** validate.py ENGAGEMENT_RE: comment/reply/testimonial/like-count wording that needs a real link. */
export const ENGAGEMENT_RE = /reply to @[\w.]+|replying to @[\w.]+|@[\w.]+.{0,3}s comment|testimonial|★★★|\b\d[\d,.]*k?\s*(likes|followers|views)\b/i;

// ---------------------------------------------------------------- JSON Schema (the subset the v1 schema uses)
export function schemaErrors(inst, sch, at = '$') {
  const errs = [];
  const is = { object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v), array: Array.isArray, string: (v) => typeof v === 'string', integer: Number.isInteger, number: (v) => typeof v === 'number', boolean: (v) => typeof v === 'boolean', null: (v) => v === null };
  if (sch.type) {
    const types = [].concat(sch.type);
    if (!types.some((t) => is[t](inst))) return [`${at}: expected ${types.join('|')}`];
  }
  if ('const' in sch && inst !== sch.const) errs.push(`${at}: must be ${JSON.stringify(sch.const)}`);
  if (sch.enum && !sch.enum.includes(inst)) errs.push(`${at}: ${JSON.stringify(inst)} not in ${JSON.stringify(sch.enum)}`);
  if (typeof inst === 'string') {
    if (sch.pattern && !new RegExp(sch.pattern, 'u').test(inst)) errs.push(`${at}: does not match ${sch.pattern}`);
    if (sch.minLength != null && inst.length < sch.minLength) errs.push(`${at}: shorter than ${sch.minLength}`);
    if (sch.format === 'date-time' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(inst)) errs.push(`${at}: not an RFC 3339 date-time`);
  }
  if (typeof inst === 'number' && sch.minimum != null && inst < sch.minimum) errs.push(`${at}: below ${sch.minimum}`);
  if (Array.isArray(inst)) {
    if (sch.minItems != null && inst.length < sch.minItems) errs.push(`${at}: fewer than ${sch.minItems} items`);
    if (sch.items) inst.forEach((v, i) => errs.push(...schemaErrors(v, sch.items, `${at}[${i}]`)));
  }
  if (is.object(inst)) {
    for (const k of sch.required ?? []) if (!(k in inst)) errs.push(`${at}: missing ${k}`);
    for (const [k, v] of Object.entries(inst)) {
      if (sch.properties?.[k]) errs.push(...schemaErrors(v, sch.properties[k], `${at}.${k}`));
      else if (sch.additionalProperties === false) errs.push(`${at}: unexpected property ${k}`);
    }
  }
  return errs;
}

// ---------------------------------------------------------------- images
/** { format, width, height } read from the file's own header (JPEG SOF or PNG IHDR). */
export function imageInfo(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { format: 'jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return { format: null, width: null, height: null };
}

/** Plain readable alt text: no emoji, arrows, invisible format characters or doubled punctuation. */
export function cleanAlt(s) {
  return String(s)
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\uFE0E\uFE0F\u200D]/gu, ' ')
    .replace(/[\p{Cf}\p{Co}\u0000-\u0009\u000B-\u001F\u007F-\u009F]/gu, ' ') // control/format chars, but keep \n for the step below
    .replace(/[\u2190-\u21FF\u2794-\u27BF\u2900-\u297F\u25A0-\u25FF]/gu, ' ')
    .replace(/\s*\n\s*/g, '. ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/([.!?])\.+/g, '$1')
    .replace(/\.(\s*\.)+/g, '.')
    .replace(/^[\s.]+|\s+$/g, '');
}

// ---------------------------------------------------------------- manifest
/**
 * Build a manifest v1 object. `assets` must already describe files on disk
 * ({index, file, sha256, width, height, alt}).
 */
export function buildManifest({ postId, project, createdAt, generator, destination, assets, caption, sourceVerification, supersedes = null, notes }) {
  const hashtags = parseHashtags(caption);
  const m = {
    manifest_version: '1.0',
    post_id: postId,
    project,
    created_at: createdAt,
    generator,
    destination,
    assets,
    caption,
    hashtags,
    source_verification: sourceVerification,
    approval_state: 'not_requested',
    content_fingerprint: fingerprint(assets, caption, hashtags),
    supersedes,
  };
  if (notes) m.notes = notes;
  return m;
}

/**
 * Producer-side checks, mirroring what Grokbot's bin/validate.py enforces on content
 * (it remains the authority). `dir` holds the files the manifest points at.
 */
export function checkPackage(m, dir, { schema = loadSchema(), project = null, today }) {
  const errors = [];
  const e = (code, message) => errors.push({ code, message });
  for (const s of schemaErrors(m, schema)) e('SCHEMA', s);
  if (errors.length) return errors;

  const idx = m.assets.map((a) => a.index);
  if (JSON.stringify(idx) !== JSON.stringify(idx.map((_, i) => i + 1))) e('ASSET_ORDER', `asset indexes must run 1..N in order, got ${idx.join(',')}`);
  if (new Set(m.assets.map((a) => a.file)).size !== m.assets.length) e('ASSET_FILES', 'asset files must be unique');
  const want = project?.destinations?.find((d) => d.platform === m.destination.platform && d.account === m.destination.account && d.format === m.destination.format);
  if (project && !want) e('DESTINATION', `${m.destination.platform} ${m.destination.account} is not configured for ${m.project}`);
  if (want && !want.allowed_visibilities.includes(m.destination.visibility_requested)) e('VISIBILITY', `${m.destination.visibility_requested} not allowed`);
  const size = want?.overrides?.recommended_size ?? (m.destination.platform === 'tiktok' ? [1080, 1920] : null);
  if (m.assets.length > 35) e('ASSET_COUNT', `${m.assets.length} assets (max 35)`);
  for (const a of m.assets) {
    const f = path.join(dir, a.file);
    if (!existsSync(f)) { e('ASSET_MISSING', a.file); continue; }
    const buf = readFileSync(f);
    if (sha256(buf) !== a.sha256) e('ASSET_HASH', `${a.file}: sha256 doesn't match the file`);
    if (buf.length > 52428800) e('ASSET_BYTES', `${a.file}: over 50 MB`);
    const info = imageInfo(buf);
    const ext = a.file.split('.').pop().toLowerCase().replace('jpg', 'jpeg');
    if (info.format !== ext) e('ASSET_TYPE', `${a.file}: extension says ${ext}, bytes are ${info.format}`);
    if (info.width !== a.width || info.height !== a.height) e('ASSET_DIMS', `${a.file}: file is ${info.width}×${info.height}, manifest says ${a.width}×${a.height}`);
    if (size && (info.width !== size[0] || info.height !== size[1])) e('ASSET_SIZE', `${a.file}: ${info.width}×${info.height}, project requires ${size.join('×')}`);
    if (cleanAlt(a.alt) !== a.alt || !a.alt) e('ALT_TEXT', `${a.file}: alt text is empty or has stray characters`);
  }
  const cap = m.caption;
  if (cap.includes('\r') || cap !== cap.trimEnd()) e('CAPTION', 'caption must have LF line breaks and no trailing whitespace or newline');
  if (JSON.stringify(parseHashtags(cap)) !== JSON.stringify(m.hashtags)) e('HASHTAGS', 'hashtags must equal the hashtags parsed from the caption');
  const rules = project?.hashtag_rules ?? { min: 1, max: 5, case: 'lower', forbidden: [] };
  if (m.hashtags.length < rules.min || m.hashtags.length > rules.max) e('HASHTAG_COUNT', `${m.hashtags.length} hashtags (rule ${rules.min}-${rules.max})`);
  if (rules.case === 'lower' && m.hashtags.some((t) => t !== t.toLowerCase())) e('HASHTAG_CASE', 'hashtags must be lowercase');
  const forbidden = new Set((rules.forbidden ?? []).map((t) => t.toLowerCase()));
  if (m.hashtags.some((t) => forbidden.has(t.toLowerCase()))) e('HASHTAG_FORBIDDEN', m.hashtags.filter((t) => forbidden.has(t.toLowerCase())).join(' '));
  const sv = m.source_verification;
  if (sv.state !== 'verified') e('SOURCES_NOT_VERIFIED', `state=${sv.state}`);
  if (sv.blockers.length) e('BLOCKERS', sv.blockers.join('; '));
  if (sv.conflicts?.length) e('CONFLICTS', sv.conflicts.join('; '));
  if (!sv.reverify_by || (today && today > sv.reverify_by)) e('REVERIFY_BY', `reverify_by ${sv.reverify_by} (today ${today})`);
  if (sv.expires_at && today && today > sv.expires_at) e('EXPIRED', `expires_at ${sv.expires_at}`);
  if (!sv.sources.some((s) => s.primary)) e('PRIMARY_SOURCE', 'no primary source');
  const hits = [...m.assets.map((a) => a.alt), cap].filter((t) => ENGAGEMENT_RE.test(t));
  const linked = (sv.engagement_claims ?? []).filter((c) => String(c.url ?? '').startsWith('http'));
  if (hits.length > linked.length) e('UNLINKED_ENGAGEMENT', `engagement wording without a real link: ${hits.map((h) => h.match(ENGAGEMENT_RE)[0]).join(', ')}`);
  if (fingerprint(m.assets, cap, m.hashtags) !== m.content_fingerprint) e('FINGERPRINT', 'content_fingerprint does not match fp1 over the files, caption and hashtags');
  if (m.approval_state !== 'not_requested' && m.approval_state !== 'requested') e('APPROVAL_STATE', 'the producer never sets approval');
  return errors;
}

// ---------------------------------------------------------------- atomic export
function writeDurable(file, data, onWrite) {
  const fd = openSync(file, 'w');
  try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  onWrite?.(file);
}

/**
 * Write one package. Returns { ok, dir, manifest, errors }.
 *  slides:        [{ png: Buffer|path, layout, alt }] in posting order (from the engine render)
 *  toJpeg(png):   async converter returning JPEG bytes (the browser does this in the CLI)
 *  preflight:     errors found before export (factual/visual/source checks); any → nothing is written
 *  externalCheck: optional async (tmpDir) → { ok, detail } run on the finished temp folder, READY.json included
 */
export async function exportPackage(opts) {
  const { inbox, project, postId, slides, toJpeg, contactSheetPng = null, extraFiles = [], caption, destination, generator, sourceVerification, supersedes = null, notes, preflight = [], today, projectConfig = null, externalCheck = null, onWrite = null, now = () => new Date() } = opts;
  const errors = [...preflight];
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(postId ?? '')) errors.push({ code: 'POST_ID', message: `invalid post_id "${postId}"` });
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(project ?? '')) errors.push({ code: 'PROJECT', message: `invalid project "${project}"` });
  if (sourceVerification.state !== 'verified' || sourceVerification.blockers.length) errors.push({ code: 'SOURCES_NOT_VERIFIED', message: `source verification ${sourceVerification.state}: ${sourceVerification.blockers.join('; ')}` });
  const parent = path.join(inbox, project ?? '');
  const finalDir = path.join(parent, postId ?? '');
  if (postId && existsSync(finalDir)) errors.push({ code: 'POST_ID_EXISTS', message: `${finalDir} already exists; post_ids are never reused (write a new post_id with "supersedes")` });
  if (errors.length) return { ok: false, dir: null, manifest: null, errors };

  mkdirSync(parent, { recursive: true });
  const tmp = path.join(parent, `.${postId}.tmp-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(path.join(tmp, 'assets'), { recursive: true });
  try {
    const assets = [];
    for (const [i, s] of slides.entries()) {
      const jpg = await toJpeg(Buffer.isBuffer(s.png) ? s.png : readFileSync(s.png));
      const file = `assets/${String(i + 1).padStart(2, '0')}-${s.layout.replace(/[^A-Za-z0-9._-]/g, '-')}.jpg`;
      writeDurable(path.join(tmp, file), jpg, onWrite);
      const info = imageInfo(jpg);
      assets.push({ index: i + 1, file, sha256: sha256(jpg), width: info.width, height: info.height, alt: cleanAlt(s.alt) });
    }
    // previews only (e.g. alt-covers/): outside assets/, so not in the manifest or the content fingerprint
    for (const f of extraFiles) {
      if (!/^alt-covers\/[a-z0-9._-]+\.jpg$/.test(f.rel)) throw new Error(`extra file ${f.rel} must be alt-covers/<name>.jpg`);
      mkdirSync(path.join(tmp, 'alt-covers'), { recursive: true });
      writeDurable(path.join(tmp, f.rel), await toJpeg(Buffer.isBuffer(f.png) ? f.png : readFileSync(f.png)), onWrite);
    }
    if (contactSheetPng) writeDurable(path.join(tmp, 'contact-sheet.jpg'), await toJpeg(Buffer.isBuffer(contactSheetPng) ? contactSheetPng : readFileSync(contactSheetPng)), onWrite);

    const manifest = buildManifest({ postId, project, createdAt: now().toISOString(), generator, destination, assets, caption, sourceVerification, supersedes, notes });
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    writeDurable(path.join(tmp, 'publish-manifest.json'), manifestBytes, onWrite);

    // validate what is on disk, not what we meant to write
    const onDisk = JSON.parse(readFileSync(path.join(tmp, 'publish-manifest.json'), 'utf8'));
    const problems = checkPackage(onDisk, tmp, { project: projectConfig, today });
    if (problems.length) throw Object.assign(new Error('package failed validation'), { problems });

    // READY.json: last file written; binds the exact manifest bytes
    const ready = { post_id: postId, manifest_sha256: sha256(readFileSync(path.join(tmp, 'publish-manifest.json'))), asset_count: assets.length, written_at: now().toISOString() };
    writeDurable(path.join(tmp, 'READY.json'), JSON.stringify(ready, null, 2) + '\n', onWrite);

    if (externalCheck) {
      const ext = await externalCheck(tmp);
      if (!ext.ok) throw Object.assign(new Error('external validator rejected the package'), { problems: [{ code: 'EXTERNAL_VALIDATOR', message: ext.detail }] });
    }
    if (existsSync(finalDir)) throw Object.assign(new Error('race'), { problems: [{ code: 'POST_ID_EXISTS', message: `${finalDir} appeared during export` }] });
    renameSync(tmp, finalDir); // atomic on the same filesystem: the folder appears complete, READY.json included
    const dfd = openSync(parent, 'r'); try { fsyncSync(dfd); } finally { closeSync(dfd); }
    return { ok: true, dir: finalDir, manifest, ready, errors: [] };
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    return { ok: false, dir: null, manifest: null, errors: err.problems ?? [{ code: 'EXPORT_FAILED', message: err.message }] };
  }
}
