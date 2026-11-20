import { z } from 'zod';

// The publish artifact: what a supervised publisher (Grokbot) reads. One per post per platform.
// schema/publish-artifact.schema.json is generated from this file (node bin/oet.mjs schema).

const isoDate = z.iso.date();
const finding = z.object({ code: z.string(), where: z.string().optional(), message: z.string().optional() }).loose();
const check = z.strictObject({ passed: z.boolean(), errors: z.array(finding), warnings: z.array(finding) });

export const PublishArtifactSchema = z.strictObject({
  schemaVersion: z.literal('oet.publish-artifact/1'),
  postId: z.string().regex(/^oet-[a-z0-9-]+-(tiktok|instagram)$/).describe('Stable: same campaign + platform = same post. A publisher never posts the same postId twice.'),
  specId: z.string(),
  title: z.string(),
  status: z.enum(['verified', 'demo']),
  platform: z.enum(['tiktok', 'instagram']),
  aspectRatio: z.enum(['9:16', '4:5']),
  size: z.strictObject({ width: z.number().int(), height: z.number().int() }),
  images: z.array(z.strictObject({
    order: z.number().int().min(1),
    path: z.string().describe('Relative to this artifact file.'),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    alt: z.string(),
    layout: z.string(),
    assets: z.array(z.strictObject({
      id: z.string(), role: z.enum(['photo', 'blurred-background']), source: z.string(), page_url: z.string(), photographer: z.string().nullable(),
      licence: z.string().nullable(), licence_url: z.string().nullable(), rights: z.literal('unlicensed').optional(), checked: isoDate.nullable(), shoot_id: z.string().nullable().optional(), file_sha256: z.string().nullable(),
    })).optional().describe('Provenance of each photo on the slide (formats C and B).'),
  })).min(1).max(20),
  previews: z.array(z.string()).describe('Interface-overlay previews for human review. Never publish these.'),
  contactSheet: z.string(),
  caption: z.strictObject({ text: z.string(), hashtags: z.array(z.string()), full: z.string().describe('Exactly what to paste: text + blank line + hashtags.') }),
  sources: z.array(z.strictObject({
    id: z.string(), url: z.url(), publisher: z.string(), title: z.string(), primary: z.boolean(), accessedAt: isoDate,
    evidence: z.strictObject({ file: z.string(), capturedAt: isoDate }).optional(),
  })),
  facts: z.array(z.strictObject({ id: z.string(), kind: z.string(), value: z.string().nullable(), claim: z.string(), verifiedAt: isoDate, sources: z.array(z.string()) })),
  verification: z.strictObject({
    checkedAgainst: isoDate,
    oldestVerifiedAt: isoDate.nullable(),
    newestVerifiedAt: isoDate.nullable(),
    postBy: isoDate.nullable().describe('Last day this may be published (the day before the earliest deadline).'),
    reverifyBy: isoDate.nullable(),
  }),
  validation: z.strictObject({ passed: z.boolean(), factual: check, visual: check }),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  approval: z.strictObject({
    status: z.enum(['pending', 'approved', 'rejected', 'invalidated']),
    by: z.string().nullable(),
    at: z.string().nullable(),
    approvedContentHash: z.string().nullable(),
    note: z.string().nullable(),
  }),
  publishable: z.boolean().describe('validation.passed AND approval.status = approved AND approval matches contentHash. The publisher must still check postBy and its own ledger.'),
  generatedAt: z.string(),
  generator: z.strictObject({ engine: z.string(), spec: z.string().nullable() }),
});

export const artifactJsonSchema = () => z.toJSONSchema(PublishArtifactSchema, { io: 'input' });
