// Product screenshots for carousels, taken from the real site with your installed Chrome.
//
//   node marketing/carousel/capture.mjs [site-url]      (default http://127.0.0.1:8731/, the local preview)
//
// Output: marketing/carousel/shots/<Ontario date>/*.png at 390px wide × 3 (phone-sharp).
// Only one thing is changed on the page: the relative countdown ("in 20 days") is hidden, because a post
// is seen for days after it's published. Everything else is the product exactly as students see it.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { ontarioToday } from '../../assets/logic.js';

const SITE = (process.argv[2] || 'http://127.0.0.1:8731/').replace(/\/?$/, '/');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = new URL(`./shots/${ontarioToday()}/`, import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

async function fresh() {
  await page.goto(SITE + '?utm_source=founder&utm_medium=capture', { waitUntil: 'networkidle0' });
  await page.evaluate(() => sessionStorage.setItem('et_fb', '1'));       // no feedback prompt in shots
  await page.addStyleTag({ content: '.c-close .meta{display:none!important}' });
  await page.waitForSelector('.row');
}
const tap = (field, v) => page.click(`.seg[data-field="${field}"] button[data-v="${v}"]`);
async function shot(name, selector, pad = 10) {
  const box = await page.evaluate(sel => {
    const els = [...document.querySelectorAll(sel)];
    if (!els.length) return null;
    const rs = els.map(e => e.getBoundingClientRect());
    const x = Math.min(...rs.map(r => r.left)), y = Math.min(...rs.map(r => r.top));
    return { x, y: y + scrollY, w: Math.max(...rs.map(r => r.right)) - x, h: Math.max(...rs.map(r => r.bottom)) - y };
  }, selector);
  if (!box) throw new Error(`nothing matches ${selector} for ${name}`);
  const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(390, box.w + 2 * pad), height: box.h + 2 * pad };
  await page.screenshot({ path: `${OUT}${name}.png`, clip, captureBeyondViewport: true });
  console.log(`  ${name}.png`);
}

console.log(`capturing ${SITE} → ${OUT}`);
await fresh();
await shot('top', '.intro');
for (const id of ['southlake', 'shn', 'sunnybrook', 'mackenzie']) await shot(`row-${id}`, `.row[data-id="${id}"]`);
await shot('list-open-default', '.section:first-of-type');
await page.click('button[data-toggle="req-mackenzie"]'); await shot('mackenzie-requirements', '.row[data-id="mackenzie"]');
await page.click('button[data-toggle="req-mackenzie"]');
await page.click('button[data-toggle="cal-southlake"]'); await shot('southlake-calendar', '.row[data-id="southlake"]');

await fresh();
await tap('program', 'BSCN'); await tap('year', '2'); await page.click('#more-btn'); await tap('bcls', 'yes');
await shot('y2-filters', '.filters, #summary');
await shot('y2-open-list', '.section:first-of-type');
await shot('y2-sunnybrook', '.row[data-id="sunnybrook"]');
await page.click('button[data-toggle="req-mackenzie"]'); await shot('y2-mackenzie-requirements', '.row[data-id="mackenzie"]');
await shot('y2-not-open', '.section:nth-of-type(2)');
await browser.close();
