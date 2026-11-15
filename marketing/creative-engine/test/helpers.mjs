import { readFileSync } from 'node:fs';
import { parseSpec } from '../src/spec/schema.js';
import { prepareSpec, verifySpec } from '../src/spec/verify.js';

export const TODAY = '2026-11-13';
export const load = (name) => JSON.parse(readFileSync(new URL(`../specs/examples/${name}.json`, import.meta.url)));

/** Parse + verify, returning the report (or schema errors). */
export function check(raw, today = TODAY) {
  const { spec, errors } = parseSpec(raw);
  if (!spec) return { errors, warnings: [], publishable: false, schema: true };
  return verifySpec(prepareSpec(spec), { today });
}
export const codes = (report) => report.errors.map((e) => e.code);

/** A minimal valid verified spec to mutate in tests. */
export function base() {
  return {
    id: 'test-spec',
    title: 'Test',
    status: 'verified',
    theme: 'ceil',
    slides: [
      { layout: 'hook', variant: 'plain', title: 'a hook' },
      { layout: 'text_stack', lines: ['externs work as unregulated care providers'], facts: ['ucp'] },
      { layout: 'cta', action: 'save', title: 'save this' },
    ],
    facts: [{ id: 'ucp', kind: 'program', claim: 'Externs work in unregulated care provider roles.', sources: ['oh'], verifiedAt: TODAY }],
    sources: [{ id: 'oh', publisher: 'Ontario Health', title: 'Enhanced Extern Program', url: 'https://www.ontariohealth.ca/news/enhanced-extern-program', accessedAt: TODAY, primary: true }],
    caption: { text: 'caption', hashtags: [] },
  };
}

/** PNG width/height from the IHDR chunk. */
export function pngSize(buf) {
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
