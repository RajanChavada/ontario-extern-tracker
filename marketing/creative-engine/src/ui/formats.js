// Formats C (student-made hybrid, primary) and B (saveable guide, complementary).
// Design reference: reference package 2026-11-14, HANDOFF.md sections 2–3 and
// reference/final-reference.html. Sizes are the reference's 3:4 pixels times --cu
// (see platforms.js), so 1080x1440 matches the reference and other platforms scale.
//
// Same conventions as layouts.js (data-qa="block", data-role="heading", data-fitw,
// data-free, data-mark). New: data-mark="ring" is the C word-circle (reference geometry,
// checked word by word for collisions), and the canvas carries data-photo so contrast QA
// knows text there has no solid background unless it sits on a box or carries an outline.
import { html } from './h.js';
import { tidy } from './text.js';
import { sourceLine } from '../spec/sourceLine.js';
import { B_COLORS, B_ICONS } from '../spec/schema.js';

const B_SERIES = 'clinical extern 101';
const B_ORDER = ['rose', 'teal', 'violet', 'amber', 'blue'];
const CTA_PALETTE = { k: '#1E2742', p: '#FCE3EA' };
const QUIET_BOTTOM = 550 / 1190; // the reference's lower text position (y 630 on the 3:4 canvas)

/** Hyphenated words never break across lines (QA treats that as a broken word). */
function NoBreak({ text }) {
  const parts = String(text).split(/(\S*\p{L}-\p{L}\S*)/u);
  return parts.map((p, i) => (i % 2 ? html`<span key=${i} className="nowrap">${p}</span>` : p));
}
const nb = (t) => html`<${NoBreak} text=${t} />`;

/** Text with one phrase circled or highlighted. Circles take trailing punctuation inside. */
function Marked({ text, mark }) {
  const t = tidy(text);
  if (!mark) return nb(t);
  const phrase = tidy(mark.phrase);
  const i = t.indexOf(phrase);
  if (i < 0) return nb(t);
  let end = i + phrase.length;
  if (mark.kind === 'circle') while (/[.,!?;:]/.test(t[end] ?? '')) end++;
  const inner = t.slice(i, end);
  const span = mark.kind === 'circle'
    ? html`<span className="c-ring" data-mark="ring">${inner}</span>`
    : html`<span className="hl">${nb(inner)}</span>`;
  return html`${nb(t.slice(0, i))}${span}${nb(t.slice(end))}`;
}
const markFor = (slide, field) => (slide.mark && slide.mark.in === field ? slide.mark : null);

const Box = ({ cls = '', heading = false, children }) => html`
  <p className=${`c-ln c-box ${cls}`.trim()} data-qa="block" data-fitw data-role=${heading ? 'heading' : undefined}><span>${children}</span></p>`;
const SourceBox = ({ text }) => html`<p className="c-src c-box" data-qa="block"><span>${text}</span></p>`;

function Hand({ aside, i, cu }) {
  const rot = aside.rotate ?? (i === 0 ? -4 : -6);
  const style = { '--rot': `${rot}deg`, ...(aside.size && { '--hs': aside.size }) };
  if (aside.at === 'below') return html`<p className="c-hand below" data-qa="block" data-free style=${style}>${tidy(aside.text)}</p>`;
  return html`<p className="c-hand placed" data-qa="block" data-free style=${{ ...style, left: `${aside.at.x * 100}%`, top: `${aside.at.y * 100}%` }}>${tidy(aside.text)}</p>`;
}

/** Where the C text block starts, in px from the top of the safe box. */
export function cTextOffset(slide, ctx) {
  const { box, cunit } = ctx.platform;
  const quiet = ctx.photo?.(slide.photo)?.quiet_area ?? 'top';
  const place = slide.place && slide.place !== 'auto' ? slide.place : /^bottom/.test(quiet) ? 'bottom' : 'top';
  const nudge = (slide.nudge ?? 0) * cunit;
  return Math.round(place === 'bottom' ? box.height * QUIET_BOTTOM + nudge : 40 * cunit + nudge);
}

// --- Format C ------------------------------------------------------------------------------
function CPhoto({ slide, ctx }) {
  const line = sourceLine(slide, ctx.spec, { demo: ctx.demo });
  const asides = slide.asides ?? [];
  return html`
    <div className="main c-main" key="main" style=${{ paddingTop: `${cTextOffset(slide, ctx)}px` }}>
      <div className="c-wrap">
        <${Box} cls="hook" heading=${true}><${Marked} text=${slide.title} mark=${markFor(slide, 'title')} /></${Box}>
        ${slide.titleTail && html`<p className="c-hand below tail" data-qa="block" data-free style=${{ '--rot': '-4deg' }}>${tidy(slide.titleTail)}</p>`}
        ${slide.body && html`<${Box}><${Marked} text=${slide.body} mark=${markFor(slide, 'body')} /></${Box}>`}
        ${asides.map((a, i) => a.at === 'below' && html`<${Hand} key=${`b${i}`} aside=${a} i=${i} />`)}
        ${line && html`<${SourceBox} text=${line} />`}
        ${slide.fine && html`<${SourceBox} text=${tidy(slide.fine)} />`}
      </div>
    </div>
    ${asides.map((a, i) => a.at !== 'below' && html`<${Hand} key=${`p${i}`} aside=${a} i=${i} />`)}`;
}

function CNotes({ slide, ctx }) {
  const line = sourceLine(slide, ctx.spec, { demo: ctx.demo });
  const { cunit } = ctx.platform;
  return html`
    <div className="main c-main" style=${{ paddingTop: `${Math.round(70 * cunit)}px` }}>
      <div className="c-note">
        ${slide.label && html`<p className="c-note-lab" data-qa="block">${tidy(slide.label)}</p>`}
        <p className="c-note-title" data-qa="block" data-role="heading" data-fitw><${Marked} text=${slide.title} mark=${markFor(slide, 'title')} /></p>
        <p className="c-note-body" data-qa="block" data-fitw><${Marked} text=${slide.body} mark=${markFor(slide, 'body')} /></p>
        ${line && html`<p className="c-note-src" data-qa="block">${line}</p>`}
      </div>
    </div>`;
}

function CPaper({ slide, ctx }) {
  const line = sourceLine(slide, ctx.spec, { demo: ctx.demo });
  const { cunit } = ctx.platform;
  return html`
    <div className="main c-main" style=${{ paddingTop: `${Math.round(40 * cunit)}px` }}>
      <div className="c-wrap">
        <p className="c-paper-title" data-qa="block" data-role="heading" data-fitw>${tidy(slide.title, { heading: true })}</p>
        <p className="c-paper-body" data-qa="block" data-fitw>${nb(tidy(slide.body))}</p>
      </div>
      ${slide.tags.length > 0 && html`<div className="c-tags">${slide.tags.map((t, i) => html`<span key=${i} className=${`c-tag t${i + 1}`} data-qa="block" data-free>${tidy(t)}</span>`)}</div>`}
      ${line && html`<p className="c-paper-src" data-qa="block">${line}</p>`}
    </div>`;
}

// --- Format B ------------------------------------------------------------------------------
function BCover({ slide }) {
  // A trailing "(…)" gets its own line, as in the reference ("… actually is / (ontario edition)").
  const m = tidy(slide.title, { heading: true }).match(/^(.*\S)\s+(\([^()]+\))$/u);
  return html`
    <div className="main b-cover-main" key="main">
      <h1 className="b-cover-title" data-qa="block" data-role="heading" data-fitw>${m ? html`${m[1]}<span className="b-tail">${m[2]}</span>` : tidy(slide.title, { heading: true })}</h1>
    </div>
    ${slide.sticker && html`<div className="b-sticker" data-qa="block" data-free key="sticker">📌 ${tidy(slide.sticker)}</div>`}`;
}

export const bCardNumber = (slide, spec) => spec.slides.filter((s) => s.layout === 'b_card' && s._n <= slide._n).length;
export function bPalette(slide, spec) {
  if (slide.layout === 'b_cta') return CTA_PALETTE;
  if (slide.layout !== 'b_card') return null;
  return B_COLORS[slide.color ?? B_ORDER[(bCardNumber(slide, spec) - 1) % B_ORDER.length]];
}

function BCard({ slide, ctx }) {
  const line = sourceLine(slide, ctx.spec, { demo: ctx.demo });
  return html`
    <div className="main b-main">
      <div className="b-top">
        <div className="b-num" data-qa="block">${bCardNumber(slide, ctx.spec)}</div>
        <div className="b-chip" data-qa="block">${tidy(slide.chip)}</div>
        <div className="b-series" data-qa="block">${B_SERIES}</div>
      </div>
      <h2 className="b-h" data-qa="block" data-role="heading" data-fitw>${tidy(slide.title, { heading: true })}</h2>
      <div className="b-panel">
        <div className="b-ic" aria-hidden="true">${B_ICONS[slide.icon]}</div>
        <p className="b-body" data-qa="block" data-fitw>${nb(tidy(slide.body))}</p>
      </div>
      ${line && html`<div className="b-src" data-qa="block">${line}</div>`}
    </div>`;
}

function BCta({ slide }) {
  return html`
    <div className="main b-main">
      <div className="b-top">
        <div className="b-num emoji" aria-hidden="true">👇</div>
        <div className="b-series" data-qa="block">${B_SERIES}</div>
      </div>
      <h2 className="b-h" data-qa="block" data-role="heading" data-fitw>${tidy(slide.title, { heading: true })}</h2>
      <div className="b-panel col">
        <p className="b-site" data-qa="block" data-fitw>${slide.site}</p>
        <p className="b-body" data-qa="block" data-fitw>${nb(tidy(slide.body))}</p>
      </div>
      ${slide.fine && html`<p className="b-fine" data-qa="block">${tidy(slide.fine)}</p>`}
      ${slide.footer && html`<div className="b-src" data-qa="block">📌 ${tidy(slide.footer)}</div>`}
    </div>`;
}

export const FORMAT_COMPONENTS = { c_photo: CPhoto, c_notes: CNotes, c_paper: CPaper, b_cover: BCover, b_card: BCard, b_cta: BCta };

/** One C or B slide on one platform (the counterpart of Slide for the classic layouts). */
export function FormatSlide({ slide, ctx }) {
  const fmt = slide.layout.startsWith('c_') ? 'c' : 'b';
  const { width, height, box, unit, cunit, id: platformId } = ctx.platform;
  const Layout = FORMAT_COMPONENTS[slide.layout];
  const photo = slide.photo ? ctx.photo(slide.photo) : null;
  const blurred = slide.layout === 'c_notes';
  const graded = !blurred && photo?.treatment === 'c-grade';
  const surface = slide.layout === 'c_paper' ? '#FFFDF7' : fmt === 'b' ? '#FBF6F0' : '#3A3633';
  const pal = fmt === 'b' ? bPalette(slide, ctx.spec) : null;
  const style = {
    width: `${width}px`, height: `${height}px`, '--u': unit, '--cu': cunit, '--surface': surface, '--stroke': '#D0112F',
    ...(pal && { '--k': pal.k, '--p': pal.p }),
  };
  return html`
    <div
      className=${`canvas fmt fmt-${fmt} plat-${platformId} layout-${slide.layout}`}
      style=${style}
      data-slide=${slide._n ?? ''}
      data-box=${[box.x, box.y, box.width, box.height].join(',')}
      data-photo=${photo ? photo.id : undefined}
    >
      ${photo && html`<img className=${`photo${graded ? ' graded' : ''}${blurred ? ' blurred' : ''}`} src=${photo.url} alt="" />`}
      ${slide.layout === 'c_paper' && html`<div className="paper-lines"></div><div className="paper-margin"></div>`}
      ${pal && html`<div className="b-band"></div>`}
      <section className="safe" style=${{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` }}>
        ${ctx.demo && html`<div className="stamp" data-qa="block" data-free>sample data, not real postings</div>`}
        <${Layout} slide=${slide} ctx=${ctx} />
      </section>
      <svg className="marks" width=${width} height=${height} viewBox=${`0 0 ${width} ${height}`}></svg>
    </div>`;
}
