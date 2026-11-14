import test from 'node:test';
import assert from 'node:assert/strict';
import { base, check, codes, load, TODAY } from './helpers.mjs';
import { prepareSpec } from '../src/spec/verify.js';
import { parseSpec } from '../src/spec/schema.js';

test('example specs: verified ones are publishable, demos never are', () => {
  for (const name of ['explainer-what-is-an-extern', 'comparison-same-title-fine-print']) {
    const r = check(load(name));
    assert.deepEqual(codes(r), [], `${name}: ${JSON.stringify(r.errors)}`);
    assert.equal(r.publishable, true);
  }
  for (const name of ['demo-roundup-closing-soon', 'demo-product-and-community']) {
    const r = check(load(name));
    assert.deepEqual(codes(r), []);
    assert.equal(r.publishable, false);
  }
});

test('rejects an expired deadline', () => {
  // Fictional posting. (This test previously named Michael Garron J1026-1085 as a "real case" closed on
  // Nov 10, 2026; our saved captures of that posting show no closing date, so it stays unverified.)
  const s = base();
  s.facts.push({
    id: 'kbh', kind: 'deadline', org: 'Kestrel Bay Hospital', role: 'Student Clinical Extern', date: '2026-11-10', status: 'open',
    claim: 'Position closing date November 10, 2026.', quote: 'Position Closing Date: November 10, 2026',
    sources: ['kbh-src'], verifiedAt: TODAY,
  });
  s.sources.push({ id: 'kbh-src', publisher: 'Kestrel Bay Hospital', title: 'Student Clinical Extern', url: 'https://example.com/kestrel-bay/extern', accessedAt: TODAY, primary: true });
  s.slides.splice(1, 0, { layout: 'wristbands', title: 'closing soon', items: [{ fact: 'kbh' }] });
  assert.ok(codes(check(s)).includes('EXPIRED_DEADLINE'));
});

test('pay needs a primary source and a quote containing the same numbers', () => {
  const s = base();
  s.facts.push({ id: 'pay', kind: 'pay', org: 'X', claim: 'Pays $25/hr.', value: '$25.00/hr', sources: ['agg'], verifiedAt: TODAY });
  s.sources.push({ id: 'agg', publisher: 'Job board', title: 'listing', url: 'https://example.com/x', accessedAt: TODAY, primary: false });
  s.slides.splice(1, 0, { layout: 'big_stat', value: '$25', label: 'an hour', facts: ['pay'] });
  const c = codes(check(s));
  assert.ok(c.includes('NEEDS_PRIMARY_SOURCE'));
  assert.ok(c.includes('NEEDS_QUOTE'));

  s.sources[1].primary = true;
  s.facts[1].quote = 'Salary: $24.00 per hour';
  assert.ok(codes(check(s)).includes('VALUE_NOT_IN_QUOTE'));
});

test('flags specifics on a slide that no cited fact supports', () => {
  const s = base();
  s.slides[1].lines.push('and it pays $30/hr with 12 positions open');
  const r = check(s);
  assert.ok(codes(r).includes('UNSUPPORTED_SPECIFIC'));
  assert.match(r.errors.find((e) => e.code === 'UNSUPPORTED_SPECIFIC').message, /\$30/);
});

test('blocks application-outcome promises but allows honest disclaimers', () => {
  const s = base();
  s.slides[1].lines = ['externing is guaranteed to get you hired'];
  assert.ok(codes(check(s)).includes('OUTCOME_CLAIM'));
  s.slides[1].lines = ['no guarantees, but it’s a foot in the door'];
  assert.ok(!codes(check(s)).includes('OUTCOME_CLAIM'));
});

test('"now hiring" needs an open vacancy or deadline fact', () => {
  const s = base();
  s.slides[1].lines = ['Ontario hospitals are now hiring externs'];
  assert.ok(codes(check(s)).includes('HIRING_CLAIM'));
});

test('demo specs may not attach sample postings to real hospitals', () => {
  const s = load('demo-roundup-closing-soon');
  s.facts[0].org = 'Sunnybrook Health Sciences Centre';
  assert.ok(codes(check(s)).includes('DEMO_REAL_ORG'));
});

test('stale facts must be re-verified', () => {
  const s = base();
  s.facts.push({ id: 'd', kind: 'deadline', org: 'X', role: 'Y', date: '2026-12-20', claim: 'Closes December 20, 2026.', quote: 'Closing date: December 20, 2026', sources: ['oh'], verifiedAt: '2026-11-01' });
  s.slides.splice(1, 0, { layout: 'deadline', fact: 'd' });
  assert.ok(codes(check(s)).includes('STALE_FACT'));
});

test('information slides must cite facts', () => {
  const s = base();
  delete s.slides[1].facts;
  assert.ok(codes(check(s)).includes('MISSING_FACTS'));
  s.slides[1].basis = 'advice';
  assert.ok(!codes(check(s)).includes('MISSING_FACTS'));
});

test('schema is strict: misspelled fields fail loudly', () => {
  const s = base();
  s.slides[1].line = ['typo'];
  const r = check(s);
  assert.equal(r.schema, true);
  assert.ok(r.errors.some((e) => e.code === 'SCHEMA'));
});

test('a receipts slide is added automatically before the CTA', () => {
  const { spec } = parseSpec(base());
  const p = prepareSpec(spec);
  assert.deepEqual(p.slides.map((x) => x.layout), ['hook', 'text_stack', 'receipts', 'cta']);
});

test('postBy is the day before the earliest deadline', () => {
  const r = check(load('demo-roundup-closing-soon'));
  assert.equal(r.postBy, '2026-11-15');
});
