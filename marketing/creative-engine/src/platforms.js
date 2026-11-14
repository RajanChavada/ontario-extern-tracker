// Canvas sizes and interface safe areas, in canvas pixels.
//
// Layouts are designed against the *safe box*, not the canvas. Backgrounds and
// decoration bleed to the edges; text never leaves the safe box (QA enforces it).
//
// TikTok 1080x1920: the For You feed overlays the top tabs (~180px), the right
// action rail (avatar, like, comment, save, share: ~140px wide) and the bottom
// block (username, caption, sound, photo-mode dots: ~420px). Margins below add
// a little headroom on top of those because the overlay grows with long captions.
//
// Instagram feed 1080x1350 (4:5): nothing overlays the image except the "1/8"
// counter (top right) and the tag icon (bottom left). The profile grid crops
// covers to 3:4 (about 34px off each side), which the side margins absorb.

export const PLATFORMS = {
  tiktok: {
    id: 'tiktok',
    label: 'TikTok photo carousel',
    width: 1080,
    height: 1920,
    safe: { top: 210, right: 150, bottom: 460, left: 72 },
    // Approximate centres of right-rail buttons, used by CTA arrows.
    targets: {
      follow: [1006, 1046],
      comment: [1006, 1372],
      save: [1006, 1528],
      share: [1006, 1680],
    },
    maxSlides: 35,
    captionLimit: 4000,
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram feed carousel',
    width: 1080,
    height: 1350,
    safe: { top: 110, right: 84, bottom: 110, left: 84 },
    // Save and share live below the image, follow above it.
    targets: {
      follow: [120, 0],
      comment: [150, 1350],
      share: [250, 1350],
      save: [1030, 1350],
    },
    maxSlides: 20,
    captionLimit: 2200,
    maxHashtags: 30,
  },
};

// The reference safe box the type scale was tuned on (TikTok). Every size in
// the stylesheet is multiplied by --u, so a shorter box gets slightly smaller type.
const REF_BOX = { width: 858, height: 1250 };

export function geometry(platformId) {
  const p = PLATFORMS[platformId];
  if (!p) throw new Error(`Unknown platform "${platformId}". Use one of: ${Object.keys(PLATFORMS).join(', ')}`);
  const box = {
    x: p.safe.left,
    y: p.safe.top,
    width: p.width - p.safe.left - p.safe.right,
    height: p.height - p.safe.top - p.safe.bottom,
  };
  const unit = Math.min(box.width / REF_BOX.width, box.height / REF_BOX.height);
  return { ...p, box, unit: Math.round(unit * 1000) / 1000 };
}

export const PLATFORM_IDS = Object.keys(PLATFORMS);
