// Publish artifacts: the hand-off contract between the creative engine and a
// supervised publisher (Grokbot, not built yet). One artifact per post per platform:
//   out/<spec id>/publish/<platform>.json
// The schema is schema/publish-artifact.schema.json; docs/PUBLISH-CONTRACT.md explains it.
//
// A publisher may post an artifact only when ALL of these hold:
//   artifact.publishable === true            (validation passed, approved, content unchanged since approval)
//   today (America/Toronto) <= verification.postBy   (when postBy is set)
//   artifact.postId is not already in the publisher's own posted ledger
// and it must re-hash the images before uploading (sha256 in images[]).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 'oet.publish-artifact/1';
export const ASPECT = { tiktok: '9:16', instagram: '4:5' };

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Stable identity of a post on one platform. Same campaign id + platform = same post, however often it is re-rendered. */
export const postIdFor = (specId, platform) => `oet-${specId}-${platform}`;

/** Hash of exactly what would be published: ordered image hashes + the full caption text. */
export function contentHash(images, captionFull) {
  return sha256(JSON.stringify({ images: images.map((i) => i.sha256), caption: captionFull }));
}

/** Approval state for a post, from the approvals ledger (one JSON file per postId). */
export function approvalFor(postId, hash, approvalsDir) {
  const file = approvalsDir && path.join(approvalsDir, `${postId}.json`);
  if (!file || !existsSync(file)) return { status: 'pending', by: null, at: null, approvedContentHash: null, note: null };
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  if (rec.status === 'approved' && rec.contentHash !== hash)
    return { status: 'invalidated', by: rec.by, at: rec.at, approvedContentHash: rec.contentHash, note: 'Content changed after approval; it must be approved again.' };
  return { status: rec.status, by: rec.by, at: rec.at, approvedContentHash: rec.status === 'approved' ? rec.contentHash : null, note: rec.note ?? null };
}

/**
 * Build one artifact per rendered platform.
 * manifest: the engine's manifest.json (already written); outDir: where it lives.
 * factual: { passed, errors, warnings } from the bridge + engine fact rules.
 * provenance: factId -> { capture, capturedAt, url } from the bridge.
 */
export function buildArtifacts({ manifest, outDir, factual, provenance = {}, approvalsDir, specPath = null }) {
  const out = {};
  const evidenceBySource = {};
  for (const f of manifest.facts) for (const sid of f.sources) if (provenance[f.id]) evidenceBySource[sid] = provenance[f.id];
  const sources = manifest.sources.map((s) => ({
    id: s.id, url: s.url, publisher: s.publisher, title: s.title, primary: s.primary, accessedAt: s.accessedAt,
    ...(evidenceBySource[s.id] && { evidence: { file: evidenceBySource[s.id].capture, capturedAt: evidenceBySource[s.id].capturedAt } }),
  }));
  const facts = manifest.facts.map((f) => ({ id: f.id, kind: f.kind, value: f.value ?? f.date ?? null, claim: f.claim, verifiedAt: f.verifiedAt, sources: f.sources }));
  const verifiedDates = facts.map((f) => f.verifiedAt).sort();

  for (const [platform, p] of Object.entries(manifest.platforms)) {
    if (p.candidate) continue; // e.g. tiktok-3x4: preview only until checked on a real device
    const pubDir = path.join(outDir, 'publish');
    const rel = (f) => path.relative(pubDir, path.join(outDir, f));
    const images = p.slides.map((s) => ({ order: s.n, path: rel(s.file), sha256: s.sha256, alt: s.alt ?? '', layout: s.layout, ...(s.assets && { assets: s.assets }) }));
    const visualErrors = p.slides.flatMap((s) => s.qa.errors.map((e) => ({ ...e, where: `slide ${s.n} ${s.layout}` })));
    const visualWarnings = p.slides.flatMap((s) => s.qa.warnings.map((e) => ({ ...e, where: `slide ${s.n} ${s.layout}` })));
    const visual = { passed: visualErrors.length === 0, errors: visualErrors, warnings: visualWarnings };
    const captionFull = p.caption;
    const hashtags = (captionFull.match(/(?:^|\s)(#[\p{L}\p{N}_]+)/gu) ?? []).map((t) => t.trim());
    const body = captionFull.replace(/\n\n(?:#[\p{L}\p{N}_]+\s*)+$/u, '');
    const hash = contentHash(images, captionFull);
    const postId = postIdFor(manifest.spec.id, platform);
    const approval = approvalFor(postId, hash, approvalsDir);
    const passed = factual.passed && visual.passed && manifest.spec.status === 'verified';
    const artifact = {
      schemaVersion: SCHEMA_VERSION,
      postId,
      specId: manifest.spec.id,
      title: manifest.spec.title,
      status: manifest.spec.status,
      platform,
      aspectRatio: ASPECT[platform] ?? `${p.size[0]}:${p.size[1]}`,
      size: { width: p.size[0], height: p.size[1] },
      images,
      previews: p.slides.map((s) => s.preview && rel(s.preview)).filter(Boolean),
      contactSheet: rel(p.contactSheet),
      caption: { text: body, hashtags, full: captionFull },
      sources,
      facts,
      verification: {
        checkedAgainst: manifest.verification.checkedAgainst,
        oldestVerifiedAt: verifiedDates[0] ?? null,
        newestVerifiedAt: verifiedDates.at(-1) ?? null,
        postBy: manifest.verification.postBy,
        reverifyBy: manifest.verification.reverifyBy,
      },
      validation: { passed, factual, visual },
      contentHash: hash,
      approval,
      publishable: passed && approval.status === 'approved' && approval.approvedContentHash === hash,
      generatedAt: manifest.generatedAt,
      generator: { engine: manifest.engine, spec: specPath },
    };
    mkdirSync(pubDir, { recursive: true });
    writeFileSync(path.join(pubDir, `${platform}.json`), JSON.stringify(artifact, null, 2) + '\n');
    out[platform] = artifact;
  }
  return out;
}

/**
 * Record a human decision for one artifact. Refuses to approve anything that failed
 * validation or is a demo. The ledger entry binds the decision to the content hash, so
 * any later change to images or caption shows up as "invalidated".
 */
export function recordDecision(artifactPath, { decision, by, note = null, now = new Date(), today }, approvalsDir) {
  if (!['approved', 'rejected'].includes(decision)) throw new Error('decision must be "approved" or "rejected"');
  if (!by || !String(by).trim()) throw new Error('--by is required: approvals are made by a named person');
  const a = JSON.parse(readFileSync(artifactPath, 'utf8'));
  if (decision === 'approved') {
    if (!a.validation.passed) throw new Error(`${a.postId} failed validation; it can't be approved.`);
    if (!today) throw new Error('today (YYYY-MM-DD, Ontario) is required to approve');
    if (a.verification.postBy && today > a.verification.postBy) throw new Error(`${a.postId} is past its post-by date (${a.verification.postBy}).`);
  }
  mkdirSync(approvalsDir, { recursive: true });
  const rec = { postId: a.postId, platform: a.platform, status: decision, contentHash: a.contentHash, by: String(by).trim(), at: now.toISOString(), ...(note && { note }) };
  writeFileSync(path.join(approvalsDir, `${a.postId}.json`), JSON.stringify(rec, null, 2) + '\n');
  a.approval = approvalFor(a.postId, a.contentHash, approvalsDir);
  a.publishable = a.validation.passed && a.approval.status === 'approved' && a.approval.approvedContentHash === a.contentHash;
  writeFileSync(artifactPath, JSON.stringify(a, null, 2) + '\n');
  return a;
}
