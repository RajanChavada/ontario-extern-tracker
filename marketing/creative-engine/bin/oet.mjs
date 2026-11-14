#!/usr/bin/env node
// oet — Ontario Extern Tracker carousels: tracker-backed facts → engine render → publish artifacts.
// Exit codes: 0 ok, 1 factual/visual errors or refused decision, 2 usage error.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpec } from '../src/spec/schema.js';
import { prepareSpec, verifySpec } from '../src/spec/verify.js';
import { torontoToday } from '../src/util/dates.js';
import { loadEvidence } from '../src/tracker/evidence.js';
import { compileCampaign } from '../src/tracker/bridge.js';
import { buildArtifacts, recordDecision } from '../src/publish/artifact.js';
import { artifactJsonSchema } from '../src/publish/schema.js';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ENGINE, '../..');
const DEFAULT_DATA = path.join(REPO, 'data/hospitals.json');
const DEFAULT_EVIDENCE = path.resolve(REPO, '../../research/raw/manual'); // workspace/research/raw/manual
const APPROVALS = path.join(ENGINE, 'approvals');

const HELP = `oet — tracker-backed carousels for Ontario Extern Tracker

Usage
  oet check <campaign.json>     Factual checks only (tracker data + saved captures + fact rules). No browser.
  oet build <campaign.json>     check, then render both platforms with visual QA, then write
                                out/<id>/validation.json and out/<id>/publish/<platform>.json
  oet approve <out/<id>> --platform tiktok|instagram|all --by "<name>" [--note "…"]
  oet reject  <out/<id>> --platform tiktok|instagram|all --by "<name>" [--note "…"]
  oet schema                    Print the publish-artifact JSON Schema (schema/publish-artifact.schema.json)

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
    const val = ['data', 'evidence', 'today', 'out', 'platform', 'by', 'note'].includes(k) ? v ?? argv[++i] : v ?? true;
    if (k === 'evidence') a.evidence.push(val); else a.flags[k] = val;
  }
  return a;
}

const show = (list, mark) => list.map((e) => `  ${mark} ${e.code.padEnd(26)} ${e.where ?? ''}\n${' '.repeat(32)}${e.message}${e.fix ? `\n${' '.repeat(32)}fix: ${e.fix}` : ''}`).join('\n');

/** Factual stage: bridge + engine fact rules. Never opens a browser. */
export function factualCheck(file, { dataFile, evidenceDirs, today }) {
  const campaign = JSON.parse(readFileSync(file, 'utf8'));
  const data = JSON.parse(readFileSync(dataFile, 'utf8'));
  const evidence = loadEvidence(evidenceDirs);
  const compiled = compileCampaign(campaign, { data, evidence, today });
  const errors = [...compiled.errors];
  const warnings = [...compiled.warnings];
  let spec = null;
  if (!errors.length) {
    const parsed = parseSpec(compiled.spec);
    if (!parsed.spec) errors.push(...parsed.errors);
    else {
      spec = parsed.spec;
      const r = verifySpec(prepareSpec(spec), { today });
      errors.push(...r.errors);
      warnings.push(...r.warnings);
    }
  }
  return { spec, provenance: compiled.provenance, factual: { passed: errors.length === 0, errors, warnings }, captures: evidence.size };
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
  const res = await renderSpec(fc.spec, { outDir, today, specPath: path.resolve(target) });
  writeFileSync(path.join(outDir, 'spec.compiled.json'), JSON.stringify(fc.spec, null, 2) + '\n');
  const artifacts = buildArtifacts({ manifest: res.manifest, outDir, factual: fc.factual, provenance: fc.provenance, approvalsDir: APPROVALS, specPath: path.relative(REPO, path.resolve(target)) });
  const validation = { checkedAgainst: today, factual: fc.factual, visual: Object.fromEntries(Object.entries(artifacts).map(([p, a]) => [p, a.validation.visual])) };
  writeFileSync(path.join(outDir, 'validation.json'), JSON.stringify(validation, null, 2) + '\n');
  let ok = true;
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

function usage(msg) { console.error(`${msg}\n\n${HELP}`); return 2; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then((c) => process.exit(c), (e) => { console.error(e.stack || e.message); process.exit(1); });
