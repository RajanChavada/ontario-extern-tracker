// Usage: node scripts/check-data.mjs [YYYY-MM-DD]
// Validates data/hospitals.json and shows what each entry displays today (Ontario date).
import { readFileSync } from 'node:fs';
import { validateData, status, ontarioToday, daysBetween } from '../assets/logic.js';

const data = JSON.parse(readFileSync(new URL('../data/hospitals.json', import.meta.url)));
const today = process.argv[2] || ontarioToday();
const problems = validateData(data);
console.log(`Ontario date: ${today}   entries: ${data.entries.length}`);
if (problems.length) { console.log('\nDATA PROBLEMS:'); problems.forEach(p => console.log('  - ' + p)); }
console.log('\nid              shows                        verified  age  stale-in  deadline');
for (const e of data.entries) {
  const st = status(e, today, data.stale_after_days);
  const age = daysBetween(e.last_verified, today);
  const staleIn = data.stale_after_days - age;
  console.log(`${e.id.padEnd(15)} ${st.label.padEnd(28)} ${e.last_verified}  ${String(age).padStart(3)}  ${String(staleIn).padStart(8)}  ${e.deadline || '-'}`);
}
const due = data.entries.filter(e => data.stale_after_days - daysBetween(e.last_verified, today) <= 2);
if (due.length) console.log(`\nRe-check within 2 days: ${due.map(e => e.id).join(', ')}`);
process.exit(problems.length ? 1 : 0);
