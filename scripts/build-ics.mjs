// Usage: node scripts/build-ics.mjs
// Writes one static all-day calendar file per entry with a closing date: cal/<id>.ics.
// Static same-origin files served as text/calendar open the "Add to Calendar" sheet in iOS Safari
// and download normally in desktop browsers on HTTPS. No Blob or object URL is needed.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { icsForDeadline } from '../assets/logic.js';

const root = new URL('../', import.meta.url);
const data = JSON.parse(readFileSync(new URL('data/hospitals.json', root)));
const dir = new URL('cal/', root);
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (f.endsWith('.ics')) unlinkSync(new URL(f, dir));
let n = 0;
for (const e of data.entries) {
  const ics = icsForDeadline(e);
  if (!ics) continue;
  writeFileSync(new URL(`${e.id}.ics`, dir), ics);
  n++;
}
console.log(`wrote ${n} calendar file(s) to cal/`);
