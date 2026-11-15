// Themes are scrub colours and unit surfaces, not brand gradients.
// Every token pair used for text is checked for contrast by the QA pass, so a
// new theme that fails contrast will fail the render rather than ship.
//
//   surface      slide background
//   ink          type set directly on the surface
//   boxBg/boxInk TikTok-style caption boxes (true black on white, like the app)
//   marker       handwritten type on the surface (must pass contrast)
//   stroke       hand-drawn circles, arrows and underlines (decoration only)
//   paper        receipts, sticky notes, badges
//   texture      twill (scrub fabric) | board (whiteboard) | none

export const THEMES = {
  ceil: {
    label: 'Ceil blue scrubs',
    surface: '#8FB6DA',
    ink: '#000000',
    boxBg: '#FFFFFF',
    boxInk: '#000000',
    marker: '#0E2A78',
    stroke: '#D7261E',
    accent: '#FFE14D',
    accentInk: '#000000',
    paper: '#FFFFFF',
    paperInk: '#000000',
    texture: 'twill',
  },
  board: {
    label: 'Unit whiteboard',
    surface: '#F3F5F2',
    ink: '#000000',
    boxBg: '#000000',
    boxInk: '#FFFFFF',
    marker: '#1B3BB8',
    stroke: '#D7261E',
    accent: '#FFE14D',
    accentInk: '#000000',
    paper: '#FFF6A8',
    paperInk: '#000000',
    texture: 'board',
  },
  wine: {
    label: 'Wine scrubs',
    surface: '#5C1830',
    ink: '#FFFFFF',
    boxBg: '#FFFFFF',
    boxInk: '#000000',
    marker: '#FFD6E2',
    stroke: '#FFD23F',
    accent: '#FFD23F',
    accentInk: '#000000',
    paper: '#FFFFFF',
    paperInk: '#000000',
    texture: 'twill',
  },
  caribbean: {
    label: 'Caribbean scrubs',
    surface: '#14A3B0',
    ink: '#000000',
    boxBg: '#FFFFFF',
    boxInk: '#000000',
    marker: '#052F35',
    stroke: '#FFFFFF',
    accent: '#FFE14D',
    accentInk: '#000000',
    paper: '#FFFFFF',
    paperInk: '#000000',
    texture: 'twill',
  },
};

// Fixed object colours shared by every theme.
export const OBJECTS = {
  bandRed: '#E2382E',
  bandYellow: '#F7D433',
  bandWhite: '#FFFFFF',
  bandBlue: '#9CC3E6',
  markerRed: '#C4241D',
  markerGreen: '#0E7A3E',
  markerBlue: '#1B3BB8',
  stickyYellow: '#FFF09A',
  stickyPink: '#FFC7DB',
};

export const THEME_IDS = Object.keys(THEMES);

export function themeVars(id) {
  const t = THEMES[id];
  if (!t) throw new Error(`Unknown theme "${id}". Use one of: ${THEME_IDS.join(', ')}`);
  return {
    '--surface': t.surface,
    '--ink': t.ink,
    '--box-bg': t.boxBg,
    '--box-ink': t.boxInk,
    '--marker': t.marker,
    '--stroke': t.stroke,
    '--accent': t.accent,
    '--accent-ink': t.accentInk,
    '--paper': t.paper,
    '--paper-ink': t.paperInk,
  };
}
