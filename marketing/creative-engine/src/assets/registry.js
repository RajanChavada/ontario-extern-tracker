// Photo provenance and imagery rules (reference package HANDOFF.md section 4).
//
// Errors (a slide cannot ship):
//   - the asset isn't in assets/registry.json, or is on its rejected list
//   - missing source, page URL, photographer, licence URL or check date
//   - any guardrail flag: clinical tools held or in use, badges or IDs, patients or clinical
//     settings, third-party screens, legible logos, identifiable faces
//   - the local file is missing or its sha256 differs from the registry
//   - a blur-only asset used unblurred (treatment "blur-…")
//   - a B cover photo with people in it
// Warnings (editorial preference, decision 3):
//   - two assets from the same shoot in one carousel
//   - adjacent photo slides with the same composition (hands / object / scene)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets');
export const REGISTRY_PATH = path.join(ASSETS_DIR, 'registry.json');
export const FLAG_LABELS = {
  clinical_tools: 'clinical tools held or in use',
  badge_or_id: 'a badge or ID',
  patient_or_clinical_setting: 'a patient or clinical setting',
  third_party_screen: 'a third-party screen',
  legible_logo: 'a legible logo',
};

const cache = new Map();
/** Load a registry (default assets/registry.json). Files resolve relative to the registry. */
export function loadRegistry(file = REGISTRY_PATH) {
  const abs = path.resolve(file);
  if (!cache.has(abs)) {
    const raw = JSON.parse(readFileSync(abs, 'utf8'));
    cache.set(abs, { ...raw, dir: path.dirname(abs), byId: new Map(raw.assets.map((a) => [a.id, a])), rejectedById: new Map((raw.rejected ?? []).map((r) => [r.id, r])) });
  }
  return cache.get(abs);
}

export const assetPath = (registry, asset) => path.resolve(registry.dir, asset.file);
export const blurOnly = (asset) => /^blur/.test(asset.treatment ?? '');

/** Photos a slide uses, with the role each plays. */
export function slidePhotos(slide) {
  if (!slide.photo) return [];
  return [{ id: slide.photo, role: slide.layout === 'c_notes' ? 'blurred-background' : 'photo' }];
}

/** Provenance record for the manifest (per slide). */
export function provenance(asset, role) {
  return {
    id: asset.id, role, source: asset.source, page_url: asset.page_url, photographer: asset.photographer,
    licence: asset.licence?.name ?? null, licence_url: asset.licence?.url ?? null, checked: asset.checked ?? null,
    shoot_id: asset.shoot_id, file_sha256: asset.sha256,
  };
}

const hashCache = new Map();
function fileSha(file) {
  if (!hashCache.has(file)) hashCache.set(file, createHash('sha256').update(readFileSync(file)).digest('hex'));
  return hashCache.get(file);
}

/** Check every photo a spec uses. Returns { errors, warnings } in the verifier's shape. */
export function checkImagery(spec, registry) {
  const errors = [];
  const warnings = [];
  const err = (code, where, message, fix) => errors.push({ code, where, message, ...(fix && { fix }) });
  const warn = (code, where, message) => warnings.push({ code, where, message });
  const seenShoot = new Map();
  let prev = null; // composition of the previous slide's unblurred photo

  for (const slide of spec.slides) {
    const where = `slides[${slide._n ?? '?'}] ${slide.layout}`;
    const photos = slidePhotos(slide);
    let current = null;
    for (const { id, role } of photos) {
      const loc = `${where} photo ${id}`;
      const rejected = registry.rejectedById.get(id);
      if (rejected) { err('REJECTED_ASSET', loc, `"${id}" was rejected in review: ${rejected.reason}`); continue; }
      const a = registry.byId.get(id);
      if (!a) { err('UNKNOWN_ASSET', loc, `"${id}" is not in assets/registry.json.`, 'Register the photo with source, page URL, photographer, licence URL, check date and guardrail flags first.'); continue; }

      const missing = [
        ['source', a.source], ['page_url', a.page_url], ['photographer', a.photographer],
        ['licence.url', a.licence?.url], ['checked', a.checked],
      ].filter(([, v]) => !v || !String(v).trim()).map(([k]) => k);
      if (a.checked && !/^\d{4}-\d{2}-\d{2}$/.test(a.checked)) missing.push('checked (YYYY-MM-DD)');
      if (missing.length) err('ASSET_PROVENANCE', loc, `Missing provenance: ${missing.join(', ')}.`, 'Every photo needs its source, page URL, photographer, licence URL and the date the licence was checked.');

      const flags = Object.entries(a.flags ?? {}).filter(([, v]) => v === true).map(([k]) => FLAG_LABELS[k] ?? k);
      // Face covers (owner, 2026-11-18): identifiable stock faces are allowed when the registry's face policy is on and the
      // photo is recorded as a stock model who is not a student (never captioned as one, no first person over it).
      const faceOk = registry.face_policy?.allowed === true && a.stock_person_not_student === true;
      if (a.identifiable_faces && !faceOk) flags.push(registry.face_policy?.allowed ? 'identifiable faces (not marked stock_person_not_student)' : 'identifiable faces');
      if (!a.flags) flags.push('no guardrail flags recorded');
      if (flags.length) err('ASSET_FLAGGED', loc, `Photo shows ${flags.join(', ')}. Not allowed (imagery guardrails).`);

      const file = a.file ? assetPath(registry, a) : null;
      if (!file || !existsSync(file)) err('ASSET_FILE', loc, `Image file ${a.file ?? '(none)'} is missing.`);
      else if (a.sha256 && fileSha(file) !== a.sha256) err('ASSET_FILE', loc, `${a.file} does not match the registered sha256; the image changed since it was reviewed.`);

      if (blurOnly(a) && role !== 'blurred-background') err('ASSET_TREATMENT', loc, `"${id}" may only be used blurred (${a.treatment}). ${a.notes ?? ''}`.trim());
      if (slide.layout === 'b_cover' && a.contains_people && !(registry.face_policy?.allowed && a.stock_person_not_student === true)) err('B_COVER_PEOPLE', loc, 'B covers use a study-desk photo: no people, clinical objects or screens.');

      if (a.shoot_id) {
        if (seenShoot.has(a.shoot_id)) warn('SAME_SHOOT', loc, `Same shoot as slide ${seenShoot.get(a.shoot_id)} (${a.shoot_id}). Repeats can read as one real person's story.`);
        else seenShoot.set(a.shoot_id, slide._n);
      }
      if (role === 'photo') current = a.composition ?? null;
    }
    if (current && prev && current === prev) warn('SAME_COMPOSITION', where, `Same composition (${current}) as the previous slide. Alternate hands, object and scene.`);
    prev = current;
  }
  return { errors, warnings };
}
