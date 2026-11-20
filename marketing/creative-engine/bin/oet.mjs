#!/usr/bin/env node
// oet — Ontario Extern Tracker carousels: tracker-backed facts → engine render → publish artifacts.
// Exit codes: 0 ok, 1 factual/visual errors or refused decision, 2 usage error.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpec } from '../src/spec/schema.js';
import { prepareSpec, verifySpec } from '../src/spec/verify.js';
import { torontoToday } from '../src/util/dates.js';
import { loadEvidence } from '../src/tracker/evidence.js';
import { compileCampaign } from '../src/tracker/bridge.js';
import { buildArtifacts, recordDecision } from '../src/publish/artifact.js';
import { artifactJsonSchema } from '../src/publish/schema.js';
import { exportPackage, imageInfo, SCHEMA_PATH } from '../src/handoff/pubkit.js';
import { checkSourceQuotes } from '../src/handoff/sources.js';
import { composeCaption } from '../src/spec/verify.js';
import { loadRegistry } from '../src/assets/registry.js';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ENGINE, '../..');
const DEFAULT_DATA = path.join(REPO, 'data/hospitals.json');
const DEFAULT_EVIDENCE = path.resolve(REPO, '../../research/raw/manual'); // workspace/research/raw/manual
const APPROVALS = path.join(ENGINE, 'approvals');
const DEFAULT_VOICE = path.resolve(REPO, '../../voice/voice-profile.json'); // workspace/voice (personal details; not in the repo)

/** The voice profile for student-voice posts, or null. Errors when it's missing or consent isn't signed. */
export function loadVoiceProfile(file = process.env.OET_VOICE_PROFILE ?? DEFAULT_VOICE) {
  if (!existsSync(file)) return { profile: null, errors: [{ code: 'VOICE_PROFILE_MISSING', where: 'voice', message: `No voice profile at ${file}.` }] };
  const profile = JSON.parse(readFileSync(file, 'utf8'));
  const errors = [];
  if (profile.consent?.signed !== true) errors.push({ code: 'VOICE_CONSENT', where: 'voice', message: 'The voice profile has no signed consent.' });
  return { profile: errors.length ? null : profile, errors };
}

const HELP = `oet — tracker-backed carousels for Ontario Extern Tracker

Usage
  oet check <campaign.json>     Factual checks only (tracker data + saved captures + fact rules). No browser.
  oet build <campaign.json>     check, then render both platforms with visual QA, then write
                                out/<id>/validation.json and out/<id>/publish/<platform>.json
  oet approve <out/<id>> --platform tiktok|instagram|all --by "<name>" [--note "…"]
  oet reject  <out/<id>> --platform tiktok|instagram|all --by "<name>" [--note "…"]
  oet schema                    Print the publish-artifact JSON Schema (schema/publish-artifact.schema.json)
  oet export <spec.json> --post-id <id>
                                Grokbot handoff (manifest v1): factual + source checks, TikTok render + visual QA,
                                JPEG export, validation (ours, then Grokbot's bin/validate.py), atomic write of
                                <inbox>/<project>/<post_id>/ with READY.json last. Never publishes or approves.
      --inbox <dir>             default ~/AgentHandoff/publishing/inbox
      --project <id>            default ontario-extern-tracker
      --account <@handle>       default @ontarioextern
      --visibility <v>          default only_you
      --supersedes <post_id>    earlier post this one replaces
      --kit <dir>               Grokbot publishing kit (default $PUBKIT_DIR or ~/Downloads/publishing-kit)
      --validator-python <py>   Python with Pillow for the kit's validate.py (default $PUBKIT_PYTHON or python3)
      --offline                 skip the live source fetch (saved captures only)
      --notes-prefix "<text>"   line put verbatim at the start of manifest notes (e.g. the brief's Notes line)
      --alt-covers <id,id>      also render slide 1 with each registered photo into alt-covers/ (previews for a
                                one-time cover choice; outside assets/, not in the fingerprint)

Options
  --data <file>        tracker data (default: data/hospitals.json in this repo)
  --evidence <dir>     folder of saved captures, repeatable (default: $OET_EVIDENCE_DIR or ${DEFAULT_EVIDENCE})
  --today <YYYY-MM-DD> date to check against (default: today in Toronto)
  --out <dir>          output folder for build (default: out/<id>)
  --json               machine-readable output
Nothing here publishes anything.`;

function parseArgs(argv) {
  const a = { _: [], flags: {}, evidence: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) { a._.push(t); continue; }
    const [k, v] = t.slice(2).split('=');
    const val = ['data', 'evidence', 'today', 'out', 'platform', 'by', 'note', 'post-id', 'inbox', 'project', 'account', 'visibility', 'supersedes', 'kit', 'validator-python', 'slot', 'alt-covers', 'notes-prefix'].includes(k) ? v ?? argv[++i] : v ?? true;
    if (k === 'evidence') a.evidence.push(val); else a.flags[k] = val;
  }
  return a;
}

const show = (list, mark) => list.map((e) => `  ${mark} ${e.code.padEnd(26)} ${e.where ?? ''}\n${' '.repeat(32)}${e.message}${e.fix ? `\n${' '.repeat(32)}fix: ${e.fix}` : ''}`).join('\n');

/** Factual stage: bridge + engine fact rules. Never opens a browser. */
export const DEFAULT_CAMPAIGN_FORMAT = 'c';

/** "; cover: ..." for manifest notes, so performance can be compared by cover type. */
export function coverType(spec) {
  const first = spec.slides.find((s) => !s._auto);
  if (!first?.photo) return '; cover: designed (no photo)';
  const a = loadRegistry().byId.get(first.photo);
  return `; cover: ${a?.identifiable_faces ? 'face cover (licensed stock model, not a student)' : a?.contains_people ? 'licensed stock photo with people, no faces' : 'faceless licensed photo'} (${first.photo})`;
}

/** Every photo slide (c_photo, c_notes, b_cover) must have rendered its registered photo. Checks the render manifest. */
export function photoLayerErrors(spec, platform) {
  return (platform?.slides ?? []).flatMap((s) => {
    const slide = spec.slides[s.n - 1];
    if (!slide?.photo) return [];
    const ok = (s.assets ?? []).some((a) => a.id === slide.photo);
    return ok ? [] : [{ code: 'PHOTO_LAYER_MISSING', where: `slide ${s.n} ${s.layout}`, message: `The rendered slide has no photo layer for "${slide.photo}".` }];
  });
}

export function factualCheck(file, { dataFile, evidenceDirs, today, voiceProfileFile }) {
  const campaign = JSON.parse(readFileSync(file, 'utf8'));
  const voice = campaign.voice === 'student' ? loadVoiceProfile(voiceProfileFile) : { profile: null, errors: [] };
  campaign.format ??= DEFAULT_CAMPAIGN_FORMAT; // marketing posts are format C unless the spec says otherwise
  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  const evidence = loadEvidence(evidenceDirs);
  const compiled = compileCampaign(campaign, { data, evidence, today });
  const errors = [...compiled.errors, ...voice.errors];
  const warnings = [...compiled.warnings];
  if (!campaign.brief && campaign.format !== 'classic')
    warnings.push({ code: 'BRIEF_MISSING', where: 'brief', message: 'Marketing posts carry a content brief (problem, candidate hooks, why, payoff, evidence). See docs/CONTENT.md.' });
  let spec = null;
  if (!errors.length) {
    const parsed = parseSpec(compiled.spec);
    if (!parsed.spec) errors.push(...parsed.errors);
    else {
      spec = parsed.spec;
      const r = verifySpec(prepareSpec(spec), { today, voiceProfile: voice.profile });
      errors.push(...r.errors.filter((e) => !(e.code === 'VOICE_PROFILE_MISSING' && voice.errors.length)));
      warnings.push(...r.warnings);
    }
  }
  return { voiceProfile: voice.profile, spec, provenance: compiled.provenance, factual: { passed: errors.length === 0, errors, warnings }, captures: evidence.size };
}

async function main() {
  const { _: [cmd, target], flags, evidence } = parseArgs(process.argv.slice(2));
  if (!cmd || cmd === 'help' || flags.help) { console.log(HELP); return 0; }
  const today = flags.today ?? torontoToday();
  const json = Boolean(flags.json);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return usage('--today must be YYYY-MM-DD');
  if (cmd === 'schema') { console.log(JSON.stringify(artifactJsonSchema(), null, 2)); return 0; }
  if (!target) return usage(`"${cmd}" needs a file or folder.`);

  if (cmd === 'approve' || cmd === 'reject') {
    const platforms = !flags.platform || flags.platform === 'all' ? ['tiktok', 'instagram'] : String(flags.platform).split(',');
    let code = 0;
    for (const p of platforms) {
      const file = path.join(target, 'publish', `${p}.json`);
      if (!existsSync(file)) { console.error(`✗ ${file} not found (run oet build first)`); code = 1; continue; }
      try {
        const a = recordDecision(file, { decision: cmd === 'approve' ? 'approved' : 'rejected', by: flags.by, note: flags.note ?? null, today }, APPROVALS);
        console.log(`✓ ${a.postId}: ${a.approval.status} by ${a.approval.by}. publishable: ${a.publishable ? 'yes' : 'no'}`);
      } catch (e) { console.error(`✗ ${p}: ${e.message}`); code = 1; }
    }
    return code;
  }

  if (cmd === 'export') return exportCmd(target, flags, evidence, today, json);
  if (!['check', 'build'].includes(cmd)) return usage(`Unknown command "${cmd}".`);
  const dataFile = flags.data ?? DEFAULT_DATA;
  const evidenceDirs = evidence.length ? evidence : [process.env.OET_EVIDENCE_DIR ?? DEFAULT_EVIDENCE];
  const fc = factualCheck(target, { dataFile, evidenceDirs, today });
  if (!json) {
    console.log(`\n${fc.factual.passed ? '✓' : '✗'} factual check  ${target}  (checked against ${today}; ${fc.captures} saved captures indexed)`);
    if (fc.factual.errors.length) console.log(show(fc.factual.errors, '✗'));
    if (fc.factual.warnings.length) console.log(show(fc.factual.warnings, '!'));
  }
  if (cmd === 'check' || !fc.factual.passed) {
    if (json) console.log(JSON.stringify({ factual: fc.factual }, null, 2));
    if (!fc.factual.passed && cmd === 'build' && !json) console.log('  Not rendered: fix the factual errors first.');
    return fc.factual.passed ? 0 : 1;
  }

  // Visual stage: the engine renders and runs layout QA in Chromium.
  const { renderSpec } = await import('../src/render/render.js');
  const outDir = flags.out ?? path.join(ENGINE, 'out', fc.spec.id);
  const res = await renderSpec(fc.spec, { outDir, today, specPath: path.resolve(target), voiceProfile: fc.voiceProfile });
  writeFileSync(path.join(outDir, 'spec.compiled.json'), JSON.stringify(fc.spec, null, 2) + '\n');
  const layerErrors = Object.values(res.manifest.platforms).flatMap((p) => photoLayerErrors(fc.spec, p));
  if (layerErrors.length && !json) console.log(`✗ photo layers\n${show(layerErrors, '✗')}`);
  const artifacts = buildArtifacts({ manifest: res.manifest, outDir, factual: fc.factual, provenance: fc.provenance, approvalsDir: APPROVALS, specPath: path.relative(REPO, path.resolve(target)) });
  const validation = { checkedAgainst: today, factual: fc.factual, visual: Object.fromEntries(Object.entries(artifacts).map(([p, a]) => [p, a.validation.visual])) };
  writeFileSync(path.join(outDir, 'validation.json'), JSON.stringify(validation, null, 2) + '\n');
  let ok = layerErrors.length === 0;
  for (const [p, a] of Object.entries(artifacts)) {
    ok &&= a.validation.passed;
    if (json) continue;
    console.log(`${a.validation.visual.passed ? '✓' : '✗'} visual QA      ${p.padEnd(10)} ${a.images.length} slides  ${path.join(outDir, a.contactSheet.replace(/^\.\.\//, ''))}`);
    if (a.validation.visual.errors.length) console.log(show(a.validation.visual.errors, '✗'));
    if (a.validation.visual.warnings.length) console.log(show(a.validation.visual.warnings, '!'));
    console.log(`  artifact  ${path.join(outDir, 'publish', `${p}.json`)}  approval: ${a.approval.status}  publishable: ${a.publishable ? 'yes' : 'no'}`);
  }
  if (json) console.log(JSON.stringify({ factual: fc.factual, artifacts: Object.fromEntries(Object.entries(artifacts).map(([p, a]) => [p, { postId: a.postId, passed: a.validation.passed, approval: a.approval.status }])) }, null, 2));
  return ok ? 0 : 1;
}


// ---------------------------------------------------------------- Grokbot handoff export
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** Run the kit's own validator on a finished (temp) folder. The only failure allowed is the missing approval. */
export function grokbotValidator({ kit, python, today }) {
  return async (dir) => {
    let out;
    try { out = execFileSync(python, [path.join(kit, 'bin/validate.py'), dir, '--kit', kit, '--today', today, '--json'], { encoding: 'utf8' }); }
    catch (e) { out = e.stdout?.toString() ?? ''; if (!out) return { ok: false, detail: `validate.py did not run: ${e.message.split('\n')[0]}` }; }
    let r; try { r = JSON.parse(out); } catch { return { ok: false, detail: `validate.py output unreadable: ${out.slice(0, 200)}` }; }
    const failed = r.checks.filter((c) => !c.ok);
    const ok = r.verdict === 'APPROVAL_REQUIRED' && failed.every((c) => c.category === 'approval');
    return { ok, verdict: r.verdict, checks: r.checks, detail: ok ? 'APPROVAL_REQUIRED (content checks all pass; approval is by the owner, via Grokbot)' : `${r.verdict}: ${failed.map((c) => `${c.check} (${c.detail})`).join('; ')}` };
  };
}

async function exportCmd(target, flags, evidenceFlags, today, json) {
  const postId = flags['post-id'];
  if (!postId) return usage('export needs --post-id');
  const inbox = flags.inbox ?? path.join(os.homedir(), 'AgentHandoff/publishing/inbox');
  const project = flags.project ?? 'ontario-extern-tracker';
  const kit = flags.kit ?? process.env.PUBKIT_DIR ?? path.join(os.homedir(), 'Downloads/publishing-kit');
  const python = flags['validator-python'] ?? process.env.PUBKIT_PYTHON ?? 'python3';
  const dataFile = flags.data ?? DEFAULT_DATA;
  const evidenceDirs = evidenceFlags.length ? evidenceFlags : [process.env.OET_EVIDENCE_DIR ?? DEFAULT_EVIDENCE];
  const preflight = [];
  const log = (s) => { if (!json) console.log(s); };

  // the kit's schema must be the one we vendored
  const kitSchema = path.join(kit, 'schema/publish-manifest.v1.schema.json');
  if (!existsSync(kitSchema)) preflight.push({ code: 'KIT_MISSING', message: `Grokbot kit not found at ${kit} (schema + validate.py are required)` });
  else if (sha256(readFileSync(kitSchema)) !== sha256(readFileSync(SCHEMA_PATH))) preflight.push({ code: 'SCHEMA_DRIFT', message: `${kitSchema} differs from the vendored schema/grokbot copy; update deliberately before exporting` });
  const projectFile = path.join(kit, 'projects', `${project}.json`);
  const projectConfig = existsSync(projectFile) ? JSON.parse(readFileSync(projectFile, 'utf8')) : null;
  if (!projectConfig) preflight.push({ code: 'PROJECT_CONFIG', message: `no ${projectFile}` });
  const dest = projectConfig?.destinations?.find((d) => d.platform === 'tiktok');
  const destination = { platform: 'tiktok', account: flags.account ?? dest?.account ?? '@ontarioextern', format: 'photo_carousel', visibility_requested: flags.visibility ?? dest?.default_visibility ?? 'only_you' };

  // 1. facts (tracker bridge + engine rules)
  const fc = factualCheck(target, { dataFile, evidenceDirs, today });
  log(`${fc.factual.passed ? '✓' : '✗'} factual check   ${target}`);
  if (!fc.factual.passed) preflight.push(...fc.factual.errors);
  const spec = fc.spec;
  if (spec && spec.status !== 'verified') preflight.push({ code: 'NOT_VERIFIED', message: 'demo specs are never exported' });
  // The voice approves every post in their voice before it's published. Only automatic when the voice is the
  // publishing approver (Grokbot approval of the exact fingerprint is then the sign-off); otherwise refuse.
  if (spec?.voice === 'student' && fc.voiceProfile && fc.voiceProfile.approval?.same_person_as_publisher !== true && !postId.startsWith('oet-dryrun-'))
    preflight.push({ code: 'VOICE_SIGNOFF_REQUIRED', message: 'The voice is not the publishing approver; their sign-off step is not built yet, so student-voice posts are not exported.' });
  if (spec && !spec.platforms.includes('tiktok')) preflight.push({ code: 'PLATFORM', message: 'spec does not target tiktok' });

  // 2. sources: every quote on its primary page (saved capture + live page)
  let src = { results: [], blockers: [], warnings: [] };
  if (spec) {
    src = await checkSourceQuotes(spec, { evidence: loadEvidence(evidenceDirs), online: !flags.offline });
    log(`${src.blockers.length ? '✗' : '✓'} source checks   ${src.results.length} quote checks (${src.results.filter((r) => r.capture?.found).length} in saved capture, ${src.results.filter((r) => r.online?.found).length} on live page)`);
    for (const b of src.blockers) log(`    ✗ ${b}`);
    for (const w of src.warnings) log(`    ! ${w}`);
  }

  // 3. render (TikTok) + visual QA, only if the facts passed
  let res = null; let browser = null; const outDir = path.join(ENGINE, 'out', `${spec?.id ?? 'x'}--${postId}`);
  try {
    if (spec && !preflight.length) {
      const { renderSpec, launchBrowser } = await import('../src/render/render.js');
      browser = await launchBrowser();
      res = await renderSpec(spec, { outDir, today, specPath: path.resolve(target), platforms: ['tiktok'], browser, voiceProfile: fc.voiceProfile });
      const qa = res.manifest.platforms.tiktok.slides.flatMap((s) => s.qa.errors.map((e) => ({ ...e, where: `slide ${s.n} ${s.layout}` })));
      log(`${qa.length ? '✗' : '✓'} visual QA       tiktok ${res.manifest.platforms.tiktok.slides.length} slides`);
      preflight.push(...qa, ...photoLayerErrors(spec, res.manifest.platforms.tiktok));
      if (!res.manifest.verification.publishable) preflight.push({ code: 'ENGINE_NOT_PUBLISHABLE', message: res.manifest.verification.blockers.join('; ') });
    }
    const toJpeg = async (png) => {
      const { width, height } = imageInfo(png);
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      try {
        await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff"><img id="i" style="display:block" src="data:image/png;base64,${png.toString('base64')}"></body></html>`);
        await page.waitForFunction(() => document.getElementById('i').complete);
        return await page.locator('#i').screenshot({ type: 'jpeg', quality: 92 });
      } finally { await page.close(); }
    };
    const tt = res?.manifest.platforms.tiktok;
    // --alt-covers id,id: slide 1 re-rendered with each alternative registered photo, as previews for a one-time cover
    // choice. They sit in alt-covers/, outside assets/, so they're not part of the fingerprint; picking one means a
    // re-export with that cover (new post_id).
    const altCovers = [];
    const altIds = (flags['alt-covers'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (tt && !preflight.length && altIds.length) {
      const first = spec.slides.findIndex((s) => !s._auto);
      const { renderSpec } = await import('../src/render/render.js');
      for (const [i, id] of altIds.entries()) {
        const alt = structuredClone(spec);
        alt.slides[first].photo = id;
        const altOut = path.join(outDir, `alt-cover-${id}`);
        const ar = await renderSpec(alt, { outDir: altOut, today, specPath: path.resolve(target), platforms: ['tiktok'], browser, voiceProfile: fc.voiceProfile });
        const s1 = ar.manifest.platforms.tiktok.slides.find((s) => s.n === first + 1);
        const errs = [...s1.qa.errors, ...photoLayerErrors({ ...alt, slides: [alt.slides[first]] }, { slides: [s1] })];
        if (!ar.manifest.verification.publishable) errs.push({ code: 'ENGINE_NOT_PUBLISHABLE', message: ar.manifest.verification.blockers.join('; ') });
        if (errs.length) { preflight.push(...errs.map((e) => ({ ...e, where: `alt cover ${id}` }))); continue; }
        altCovers.push({ rel: `alt-covers/01-cover-${String.fromCharCode(98 + i)}-${id}.jpg`, png: path.join(altOut, s1.file), id });
      }
      log(`${altCovers.length === altIds.length ? '✓' : '✗'} alt covers      ${altCovers.map((a) => a.rel).join(', ')}`);
    }
    const r = await exportPackage({
      inbox, project, postId, today, projectConfig, destination,
      supersedes: flags.supersedes ?? null,
      preflight: [...preflight, ...src.blockers.map((b) => ({ code: 'SOURCE', message: b }))],
      slides: tt ? tt.slides.map((s) => ({ png: path.join(outDir, s.file), layout: s.layout, alt: s.alt })) : [],
      contactSheetPng: tt ? path.join(outDir, tt.contactSheet) : null,
      extraFiles: altCovers,
      toJpeg,
      caption: spec ? composeCaption(spec, 'tiktok') : '',
      generator: { name: '@oet/creative-engine', version: JSON.parse(readFileSync(path.join(ENGINE, 'package.json'), 'utf8')).version, created_by: 'hermes', ...(spec && { spec_id: spec.id, spec_sha256: sha256(readFileSync(target)) }) },
      sourceVerification: {
        state: src.blockers.length ? 'failed' : 'verified', checked_at: today,
        reverify_by: res?.report.reverifyBy ?? null, expires_at: res?.report.postBy ?? null,
        sources: (spec?.sources ?? []).map((s) => ({ url: s.url, publisher: s.publisher, title: s.title, primary: s.primary, accessed_at: s.accessedAt })),
        blockers: src.blockers, conflicts: [], engagement_claims: [],
      },
      notes: spec ? `${flags['notes-prefix'] ? `${flags['notes-prefix'].trim()} ` : ''}${altCovers.length ? `Cover options (one-time choice; previews in alt-covers/, not in the fingerprint): a = ${spec.slides.find((s) => !s._auto).photo} (this package), ${altCovers.map((a) => `${a.rel.split('/')[1].slice(9, 10)} = ${a.id}`).join(', ')}; choosing another option means a re-export with that cover (new post_id). ` : ''}Style: format ${(spec.format ?? 'c').toUpperCase()} (${[...new Set(spec.slides.filter((s) => !s._auto).map((s) => s.layout))].join(', ')}); voice: ${spec.voice === 'student' ? 'first person (account owner)' : 'neutral (second/third person)'}${spec.brief ? `; brief type: ${spec.brief.type}` : ''}${coverType(spec)}${flags.slot ? `; slot: ${flags.slot}` : ''}. Source checks ${today}: ${src.results.length} verbatim quotes checked against the primary source, ${src.results.filter((r) => r.capture?.found).length} found in the saved capture${src.results[0]?.capture ? ` (${path.basename(src.results[0].capture.file)}, captured ${src.results[0].capture.capturedAt})` : ''} and ${src.results.filter((r) => r.online?.found).length} on the live page${src.results[0]?.online?.status ? ` (HTTP ${src.results[0].online.status})` : ''}. Rendered by the creative engine (visual QA passed); PNG slides exported to JPEG (quality 92) by Chromium; hashes are of these JPEGs.${photoNotes(tt)}` : undefined,
      externalCheck: grokbotValidator({ kit, python, today }),
    });
    const report = { ok: r.ok, post_id: postId, dir: r.dir, errors: r.errors, source_checks: src, ready: r.ready ?? null, fingerprint: r.manifest?.content_fingerprint ?? null };
    if (res) writeFileSync(path.join(outDir, 'handoff-report.json'), JSON.stringify(report, null, 2) + '\n');
    if (json) console.log(JSON.stringify(report, null, 2));
    else if (r.ok) console.log(`✓ exported        ${r.dir}\n  post_id ${postId}  assets ${r.ready.asset_count}  fingerprint ${r.manifest.content_fingerprint}\n  READY.json written last; Grokbot validate.py: APPROVAL_REQUIRED (approval is by the owner, via Grokbot)`);
    else { console.log('✗ not exported (nothing written to the inbox)'); for (const e of r.errors) console.log(`    ✗ ${e.code} ${e.where ?? ''} ${e.message}`); }
    return r.ok ? 0 : 1;
  } finally { await browser?.close(); }
}

/** Photo provenance, as plain text: manifest v1 has no field for it, and its assets[] rejects extra keys. */
export function photoNotes(platform) {
  const used = (platform?.slides ?? []).flatMap((s) => (s.assets ?? []).map((a) => ({ n: s.n, ...a })));
  if (!used.length) return '';
  const lic = [...new Set(used.map((a) => `${a.licence} (${a.licence_url}, checked ${a.checked})`))].join('; ');
  return ` Photos: ${used.map((a) => `slide ${a.n} ${a.id} by ${a.photographer} (${a.page_url})${a.role === 'blurred-background' ? ' blurred' : ''}`).join('; ')}. Licence: ${lic}. Stock models are not students, nurses or externs and are never described as such.`;
}

function usage(msg) { console.error(`${msg}\n\n${HELP}`); return 2; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then((c) => process.exit(c), (e) => { console.error(e.stack || e.message); process.exit(1); });
