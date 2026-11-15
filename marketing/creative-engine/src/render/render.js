import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { geometry, PLATFORMS } from '../platforms.js';
import { composeCaption, prepareSpec, verifySpec } from '../spec/verify.js';
import { Slide } from '../ui/Slide.js';
import { drawInterfaceGhost, fitDrawAndCheck } from './runtime.js';
import { assetPath, loadRegistry, provenance, slidePhotos } from '../assets/registry.js';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(await readFile(path.join(ENGINE, 'package.json'), 'utf8'));
const FONT_CSS = [
  '@fontsource-variable/tiktok-sans/standard.css',
  '@fontsource/caveat-brush/index.css',
  '@fontsource/caveat/700.css',
  'twemoji-colr-font/twemoji.css',
].map((p) => pathToFileURL(require.resolve(p)).href);
const STYLES = [path.join(ENGINE, 'src/ui/styles.css'), path.join(ENGINE, 'src/ui/formats.css')];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const pad = (n) => String(n).padStart(2, '0');

export async function launchBrowser() {
  const { chromium } = await import('playwright-core');
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  try {
    return await chromium.launch({ executablePath });
  } catch (e) {
    throw new Error(`Could not start Chromium (${e.message.split('\n')[0]}).\nRun "npx playwright-core install chromium" once, or set CHROMIUM_PATH to a Chrome/Chromium binary.`);
  }
}

function buildContext(spec, platformId, report, specDir, registry) {
  return {
    spec,
    platform: geometry(platformId),
    facts: new Map(spec.facts.map((f) => [f.id, f])),
    sources: new Map(spec.sources.map((s) => [s.id, s])),
    fact(id) {
      const f = this.facts.get(id);
      if (!f) throw new Error(`Unknown fact "${id}"`);
      return f;
    },
    refDate: report.referenceDate,
    demo: spec.status === 'demo',
    asset: (p) => (/^(https?:|data:|file:)/.test(p) ? p : pathToFileURL(path.resolve(specDir, p)).href),
    // Photos come only from the registry (provenance checked by the verifier).
    photo(id) {
      const a = registry().byId.get(id);
      if (!a) throw new Error(`Unknown asset "${id}" (not in assets/registry.json)`);
      return { ...a, url: pathToFileURL(assetPath(registry(), a)).href };
    },
  };
}

export function slideDocument(slide, ctx) {
  const body = renderToStaticMarkup(createElement(Slide, { slide, ctx }));
  const links = FONT_CSS.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n');
  const styles = STYLES.map((f) => `<link rel="stylesheet" href="${pathToFileURL(f).href}">`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${links}
${styles}</head><body>${body}</body></html>`;
}

/**
 * Render a parsed spec. Returns { ok, report, manifest }.
 * ok is false when validation or visual QA found errors.
 * Opt-in platforms (tiktok-3x4) render only when asked for, by the spec or by `platforms`.
 */
export async function renderSpec(rawSpec, { outDir, today, specPath = null, platforms, overlay = true, browser: shared, force = false, registry: registryPath, voiceProfile = null }) {
  const registry = () => loadRegistry(registryPath);
  const spec = prepareSpec(rawSpec);
  const report = verifySpec(spec, { today, voiceProfile, ...(registryPath && { registry: registry() }) });
  if (report.errors.length && !force) return { ok: false, report, manifest: null };

  const specDir = specPath ? path.dirname(path.resolve(specPath)) : process.cwd();
  const targets = (platforms?.length ? platforms : spec.platforms).filter((p) => spec.platforms.includes(p) || PLATFORMS[p]?.optIn);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const browser = shared ?? (await launchBrowser());
  const manifest = {
    engine: `${pkg.name}@${pkg.version}`,
    generatedAt: new Date().toISOString(),
    spec: { id: spec.id, title: spec.title, status: spec.status, theme: spec.theme, sha256: sha256(JSON.stringify(rawSpec)), path: specPath },
    verification: {
      publishable: report.publishable,
      blockers: report.blockers,
      checkedAgainst: report.referenceDate,
      postBy: report.postBy,
      reverifyBy: report.reverifyBy,
      warnings: report.warnings,
    },
    platforms: {},
    facts: spec.facts,
    sources: spec.sources,
  };

  let qaErrors = 0;
  try {
    for (const pid of targets) {
      const ctx = buildContext(spec, pid, report, specDir, registry);
      const g = ctx.platform;
      const dir = path.join(outDir, pid);
      await mkdir(path.join(dir, '_html'), { recursive: true });
      if (overlay) await mkdir(path.join(dir, 'preview'), { recursive: true });
      const page = await browser.newPage({ viewport: { width: g.width, height: g.height }, deviceScaleFactor: 1 });
      const slides = [];
      for (const [i, slide] of spec.slides.entries()) {
        const name = `${pad(i + 1)}-${slide.layout}`;
        const htmlPath = path.join(dir, '_html', `${name}.html`);
        await writeFile(htmlPath, slideDocument(slide, ctx));
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
        const qa = await page.evaluate(fitDrawAndCheck, { platform: g, seed: (i + 1) * 7919 + spec.id.length });
        const file = path.join(dir, `${name}.png`);
        const png = await page.locator('.canvas').screenshot({ path: file, animations: 'disabled' });
        let previewFile = null;
        if (overlay) {
          await page.evaluate(drawInterfaceGhost, { platform: g, handle: spec.brand.handle?.replace(/^@/, ''), index: i + 1, total: spec.slides.length });
          previewFile = path.join(dir, 'preview', `${name}.png`);
          await page.locator('.canvas').screenshot({ path: previewFile, animations: 'disabled' });
        }
        qaErrors += qa.errors.length;
        const photos = slidePhotos(slide);
        slides.push({
          n: i + 1,
          layout: slide.layout,
          file: path.relative(outDir, file),
          preview: previewFile && path.relative(outDir, previewFile),
          sha256: sha256(png),
          alt: slide.alt ?? qa.alt,
          autoAdded: Boolean(slide._auto),
          fit: qa.fit,
          qa: { errors: qa.errors, warnings: qa.warnings },
          ...(photos.length && { assets: photos.map(({ id, role }) => provenance(registry().byId.get(id), role)) }),
        });
      }
      await page.close();
      const sheet = await contactSheet(browser, outDir, pid, slides, g, spec);
      manifest.platforms[pid] = {
        size: [g.width, g.height],
        safeArea: g.safe,
        ...(g.candidate && { candidate: true }),
        caption: composeCaption(spec, pid),
        contactSheet: path.relative(outDir, sheet),
        slides,
      };
    }
  } finally {
    if (!shared) await browser.close();
  }

  manifest.qa = { errors: qaErrors, passed: qaErrors === 0 };
  manifest.publishable = report.publishable && qaErrors === 0;
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { ok: report.errors.length === 0 && qaErrors === 0, report, manifest };
}

async function contactSheet(browser, outDir, pid, slides, g, spec) {
  const thumbW = 300;
  const thumbH = Math.round((thumbW * g.height) / g.width);
  const cols = Math.min(slides.length, 5);
  const cells = slides
    .map((s) => {
      const src = pathToFileURL(path.join(outDir, s.file)).href;
      const flags = [...s.qa.errors.map((e) => `<b>${e.code}</b>`), ...s.qa.warnings.map((w) => w.code)].join(' ');
      return `<figure><img src="${src}" width="${thumbW}" height="${thumbH}"><figcaption>${s.n}. ${s.layout} <em>${flags}</em></figcaption></figure>`;
    })
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONT_CSS[0]}"><style>
    body{margin:0;padding:36px;background:#E9E6E1;font:500 20px 'TikTok Sans Variable',sans-serif;color:#111;width:${cols * (thumbW + 24) + 48}px}
    h1{margin:0 0 6px;font-weight:850;font-stretch:115%;font-size:30px}p{margin:0 0 22px;font-size:18px}
    .grid{display:grid;grid-template-columns:repeat(${cols},${thumbW}px);gap:24px}
    figure{margin:0}img{display:block;border-radius:10px;box-shadow:0 2px 0 rgba(0,0,0,.12)}figcaption{margin-top:8px;font-size:17px}
    em{font-style:normal;color:#9A3412}b{color:#B91C1C}</style></head><body>
    <h1>${spec.title}</h1><p>${g.label} ${g.width}×${g.height}. ${spec.status === 'demo' ? 'Demo content.' : 'Verified content.'}</p>
    <div class="grid">${cells}</div></body></html>`;
  const htmlPath = path.join(outDir, pid, '_html', 'contact-sheet.html');
  await writeFile(htmlPath, html);
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(outDir, `${pid}-contact-sheet.png`);
  await page.screenshot({ path: out, fullPage: true });
  await page.close();
  return out;
}
