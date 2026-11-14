#!/usr/bin/env node
// creative — render TikTok / Instagram carousels from a content spec.
// Run `node bin/creative.mjs help` for usage. Exit codes: 0 ok, 1 content or QA errors, 2 usage error.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSpec, jsonSchema, LAYOUTS } from '../src/spec/schema.js';
import { checkSourcesOnline, prepareSpec, verifySpec } from '../src/spec/verify.js';
import { torontoToday } from '../src/util/dates.js';
import { THEMES } from '../src/themes.js';
import { PLATFORM_IDS } from '../src/platforms.js';

const HELP = `creative — Ontario Extern Tracker carousel engine

Usage
  creative validate <spec.json>...      Check schema and factual rules. Renders nothing.
  creative render <spec.json>...        Validate, render, run visual QA, write manifest.
  creative check-sources <spec.json>    Re-fetch primary sources and confirm quotes (needs network).
  creative layouts                      List slide layouts and themes.
  creative schema                       Print the spec's JSON Schema.

Options
  --out <dir>             Output folder (default: out/<spec id>). With several specs, each gets <dir>/<spec id>.
  --platform <list>       tiktok,instagram (default: the spec's platforms)
  --today <YYYY-MM-DD>    Date to check deadlines against (default: today in Toronto)
  --no-preview            Skip interface-overlay previews
  --force                 Render even if validation fails (output is marked unpublishable)
  --json                  Machine-readable output

Example
  node bin/creative.mjs render specs/examples/explainer-what-is-an-extern.json
`;

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      const takesValue = ['out', 'platform', 'today'].includes(k);
      args.flags[k] = takesValue ? v ?? argv[++i] : v ?? true;
    } else args._.push(a);
  }
  return args;
}

async function loadSpec(file) {
  let raw;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    return { file, spec: null, errors: [{ code: 'READ', where: file, message: e.message }] };
  }
  const { spec, errors } = parseSpec(raw);
  return { file, spec, errors };
}

const fmt = (list, mark) => list.map((e) => `  ${mark} ${e.code.padEnd(20)} ${e.where ?? ''}${e.where ? '\n' + ' '.repeat(26) : ''}${e.message}${e.fix ? `\n${' '.repeat(26)}fix: ${e.fix}` : ''}${e.text ? `\n${' '.repeat(26)}"${e.text}"` : ''}`).join('\n');

async function main() {
  const { _: [cmd, ...files], flags } = parseArgs(process.argv.slice(2));
  const json = Boolean(flags.json);
  const today = flags.today ?? torontoToday();
  if (flags.today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) return usage('--today must be YYYY-MM-DD');

  if (!cmd || cmd === 'help' || flags.help) { console.log(HELP); return 0; }

  if (cmd === 'layouts') {
    const out = { layouts: LAYOUTS, themes: Object.fromEntries(Object.entries(THEMES).map(([k, v]) => [k, v.label])), platforms: PLATFORM_IDS };
    if (json) console.log(JSON.stringify(out, null, 2));
    else {
      console.log('Layouts');
      for (const [k, v] of Object.entries(LAYOUTS)) console.log(`  ${k.padEnd(12)} ${v}`);
      console.log('\nThemes');
      for (const [k, v] of Object.entries(out.themes)) console.log(`  ${k.padEnd(12)} ${v}`);
    }
    return 0;
  }
  if (cmd === 'schema') { console.log(JSON.stringify(jsonSchema(), null, 2)); return 0; }

  if (!files.length) return usage(`"${cmd}" needs at least one spec file.`);
  if (!['validate', 'render', 'check-sources'].includes(cmd)) return usage(`Unknown command "${cmd}".`);

  if (cmd === 'check-sources') {
    const { spec, errors } = await loadSpec(files[0]);
    if (!spec) { console.error(fmt(errors, '✗')); return 1; }
    const findings = await checkSourcesOnline(spec);
    if (json) console.log(JSON.stringify(findings, null, 2));
    else console.log(findings.length ? fmt(findings, '!') : '  ✓ all primary sources reachable');
    return findings.some((f) => f.level === 'error') ? 1 : 0;
  }

  let exit = 0;
  const results = [];
  let browser = null;
  try {
    for (const file of files) {
      const { spec, errors } = await loadSpec(file);
      if (!spec) {
        exit = 1;
        results.push({ file, ok: false, errors, warnings: [] });
        if (!json) console.error(`\n✗ ${file}\n${fmt(errors, '✗')}`);
        continue;
      }
      if (cmd === 'validate') {
        const report = verifySpec(prepareSpec(spec), { today });
        const ok = report.errors.length === 0;
        if (!ok) exit = 1;
        results.push({ file, ok, ...report });
        if (!json) {
          console.log(`\n${ok ? '✓' : '✗'} ${file}  (${spec.status}, checked against ${report.referenceDate})`);
          if (report.errors.length) console.log(fmt(report.errors, '✗'));
          if (report.warnings.length) console.log(fmt(report.warnings, '!'));
          if (ok) console.log(`  publishable: ${report.publishable ? 'yes' : 'no (demo)'}${report.postBy ? `   post by: ${report.postBy}` : ''}`);
        }
        continue;
      }
      // render
      const { renderSpec, launchBrowser } = await import('../src/render/render.js');
      browser ??= await launchBrowser();
      const base = flags.out ?? 'out';
      const outDir = flags.out && files.length === 1 ? flags.out : path.join(base, spec.id);
      const platforms = flags.platform ? String(flags.platform).split(',') : undefined;
      const res = await renderSpec(spec, { outDir, today, specPath: file, platforms, overlay: !flags['no-preview'], browser, force: Boolean(flags.force) });
      if (!res.ok) exit = 1;
      const collect = (kind) => (res.manifest ? Object.entries(res.manifest.platforms).flatMap(([pid, p]) => p.slides.flatMap((s) => s.qa[kind].map((x) => ({ ...x, where: `${pid} slide ${s.n} ${s.layout}` })))) : []);
      const qa = collect('errors');
      const qaWarn = collect('warnings');
      results.push({ file, ok: res.ok, outDir: res.manifest ? outDir : null, errors: [...res.report.errors, ...qa], warnings: [...res.report.warnings, ...qaWarn], publishable: res.manifest?.publishable ?? false });
      if (!json) {
        console.log(`\n${res.ok ? '✓' : '✗'} ${file}  (${spec.status})`);
        if (!res.manifest) console.log(fmt(res.report.errors, '✗') + '\n  Nothing rendered. Fix the errors above, or pass --force to render a marked-up draft.');
        else {
          if (qa.length || res.report.errors.length) console.log(fmt([...res.report.errors, ...qa], '✗'));
          if (qaWarn.length || res.report.warnings.length) console.log(fmt([...res.report.warnings, ...qaWarn], '!'));
          for (const [pid, p] of Object.entries(res.manifest.platforms)) console.log(`  ${pid.padEnd(10)} ${p.slides.length} slides  ${path.join(outDir, p.contactSheet)}`);
          console.log(`  manifest   ${path.join(outDir, 'manifest.json')}   publishable: ${res.manifest.publishable ? 'yes' : 'no'}`);
        }
      }
    }
  } finally {
    await browser?.close();
  }
  if (json) console.log(JSON.stringify(results, null, 2));
  return exit;
}

function usage(msg) {
  console.error(`${msg}\n\n${HELP}`);
  return 2;
}

main().then((code) => process.exit(code), (e) => { console.error(e.stack || e.message); process.exit(1); });
