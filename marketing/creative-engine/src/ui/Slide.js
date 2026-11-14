import { html } from './h.js';
import { LAYOUT_COMPONENTS } from './layouts.js';
import { FORMAT_COMPONENTS, FormatSlide } from './formats.js';
import { THEMES, themeVars } from '../themes.js';
import { longDate, monthYear } from '../util/dates.js';

const keep = (t) => t.replace(/ /g, '\u00A0'); // keep a date on one line
import { slideFactIds } from '../spec/verify.js';

// Citations are generated from the facts a slide cites, so an agent cannot
// forget them and cannot write a citation that disagrees with the data.
function citation(slide, ctx) {
  if (['hook', 'receipts', 'cta'].includes(slide.layout)) return null;
  const facts = slideFactIds(slide, ctx.spec).map((id) => ctx.facts.get(id)).filter(Boolean);
  if (!facts.length) return null;
  if (ctx.demo) return 'sample data for illustration. not real postings.';
  const srcIds = [...new Set(facts.flatMap((f) => f.sources))];
  const srcs = srcIds.map((id) => ctx.sources.get(id)).filter(Boolean);
  const checked = facts.map((f) => f.verifiedAt).sort().at(-1);
  const names = srcs.map((s) => (s.published ? `${s.publisher}, ${keep(monthYear(s.published))}` : s.publisher));
  const label = names.length > 1 ? 'sources' : 'source';
  return `${label}: ${names.join('; ')}. checked ${keep(longDate(checked))}.`;
}

/**
 * One slide on one platform. Pure and static: the renderer adds fitting, hand-drawn
 * marks and QA in the browser; a video renderer can mount this component as is.
 */
export function Slide({ slide, ctx }) {
  if (FORMAT_COMPONENTS[slide.layout]) return html`<${FormatSlide} slide=${slide} ctx=${ctx} />`;
  const themeId = slide.theme ?? ctx.spec.theme;
  const theme = THEMES[themeId];
  const { width, height, box, unit, id: platformId } = ctx.platform;
  const Layout = LAYOUT_COMPONENTS[slide.layout];
  const cite = citation(slide, ctx);
  const style = { width: `${width}px`, height: `${height}px`, '--u': unit, ...themeVars(themeId) };
  return html`
    <div
      className=${`canvas theme-${themeId} tex-${theme.texture} plat-${platformId} layout-${slide.layout}`}
      style=${style}
      data-slide=${slide._n ?? ''}
      data-box=${[box.x, box.y, box.width, box.height].join(',')}
    >
      <div className="bg"></div>
      <section className="safe" style=${{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` }}>
        ${ctx.demo && html`<div className="stamp" data-qa="block" data-free>sample data, not real postings</div>`}
        <${Layout} slide=${slide} ctx=${ctx} />
        ${cite && html`<p className="cite" data-qa="block">${cite}</p>`}
      </section>
      <svg className="marks" width=${width} height=${height} viewBox=${`0 0 ${width} ${height}`}></svg>
    </div>`;
}
