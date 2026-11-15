import { html, Fragment } from './h.js';
import { tidy, displayUrl } from './text.js';
import { daysBetween, longDate, shortDay } from '../util/dates.js';

// Each layout renders into the safe box's `.main` column. Conventions:
//   data-qa="block"   a text block the QA pass checks for overflow, overlap and line breaks
//   data-role="heading" enables headline line-break checks
//   data-fitw         shrink this element's type if a single word is wider than the box
//   data-mark         ask the runtime to hand-draw a circle or underline around it
//   data-arrow-to     ask the runtime to draw a marker arrow to a target
//   data-free         intentionally rotated/offset; skip alignment checks

const Hero = ({ text, cls = 'hero' }) => html`<h1 className=${cls} data-qa="block" data-role="heading" data-fitw>${tidy(text, { heading: true })}</h1>`;
const H2 = ({ text }) => html`<h2 className="h2" data-qa="block" data-role="heading" data-fitw>${tidy(text, { heading: true })}</h2>`;
const Marker = ({ text, tilt = 'l', cls = '', ...rest }) =>
  html`<p className=${`marker tilt-${tilt} ${cls}`.trim()} data-qa="block" data-free ...${rest}>${tidy(text)}</p>`;
// Operators drawn as marker strokes: handwriting fonts rarely include ≠.
const HandOp = ({ op }) => {
  if (op === 'vs') return html`<span className="vs-op" data-qa="block" data-free>vs</span>`;
  return html`
    <svg className="hand-op" viewBox="0 0 160 120" aria-label=${op === '≠' ? 'is not the same as' : 'equals'}>
      <path d="M18 46 C 54 40, 100 42, 142 38" />
      <path d="M20 82 C 60 78, 104 80, 140 76" />
      ${op === '≠' && html`<path className="slash" d="M104 8 C 90 44, 72 80, 56 114" />`}
    </svg>`;
};
const Boxes = ({ lines }) =>
  html`<div className="stack">${lines.map((l, i) => html`<p key=${i} className="tt" data-qa="block" data-fitw><span>${tidy(l)}</span></p>`)}</div>`;

export function urgency(date, refDate) {
  const left = daysBetween(refDate, date);
  return left <= 3 ? 'red' : left <= 7 ? 'yellow' : 'white';
}

// --- Hook ------------------------------------------------------------------
function Hook({ slide, ctx }) {
  const v = slide.variant;
  const deadlines = ctx.spec.facts.filter((f) => f.kind === 'deadline');
  return html`
    <div className="main" key="main">
      ${v === 'reply' && slide.reply && html`
        <div className="reply" data-qa="block" data-free>
          <div className="who"><span className="avatar">${slide.reply.user.replace(/^@/, '').slice(0, 1).toUpperCase()}</span>Reply to ${slide.reply.user}’s comment</div>
          <div className="comment">${tidy(slide.reply.comment)}</div>
        </div>`}
      ${v === 'count' && slide.count && html`
        <div className="count-row">
          <p className="count-num" data-qa="block">${deadlines.length}</p>
          <p className="count-label" data-qa="block">${tidy(slide.count.label)}</p>
        </div>`}
      ${v === 'versus' && slide.versus && html`
        <div className="stack" style=${{ gap: 'calc(10px * var(--s))' }}>
          <p className="tt big" data-qa="block"><span>${tidy(slide.versus.left)}</span></p>
          <${HandOp} op=${slide.versus.op} />
          <p className="tt big accent" data-qa="block"><span>${tidy(slide.versus.right)}</span></p>
        </div>`}
      <${Hero} text=${slide.title} />
      ${slide.sub && html`<${Boxes} lines=${[slide.sub]} />`}
      ${slide.note && html`<${Marker} text=${slide.note} />`}
      <${Marker} text="swipe" tilt="r" cls="swipe" data-arrow-to="right" />
    </div>
    <div className="brand" data-qa="block" key="brand">${ctx.spec.brand.name}${ctx.spec.brand.handle && html`<span className="handle">${ctx.spec.brand.handle}</span>`}</div>`;
}

// --- Text stack -----------------------------------------------------------------
function TextStack({ slide }) {
  return html`
    <div className="main">
      ${slide.emoji && html`<div className="emoji-sticker" data-free aria-hidden="true">${slide.emoji}</div>`}
      ${slide.title && html`<${H2} text=${slide.title} />`}
      <${Boxes} lines=${slide.lines} />
      ${slide.note && html`<${Marker} text=${slide.note} />`}
    </div>`;
}

// --- Big stat --------------------------------------------------------------------
function BigStat({ slide }) {
  return html`
    <div className="main">
      <p className="stat" data-qa="block" data-fitw data-mark="circle">${slide.value}</p>
      <${H2} text=${slide.label} />
      ${slide.context && html`<${Boxes} lines=${[slide.context]} />`}
      ${slide.note && html`<${Marker} text=${slide.note} />`}
    </div>`;
}

// --- Whiteboard ----------------------------------------------------------------------
function Board({ slide }) {
  return html`
    <div className="main">
      <div className="boardpanel" data-qa-bg="#F3F5F2">
        <h2 className="panel-title" data-qa="block" data-role="heading" data-fitw>${tidy(slide.title, { heading: true })}</h2>
        <div className="rows">
          ${slide.rows.map((r, i) => html`
            <div className="row" key=${i}>
              <span className="lbl" data-qa="block">${tidy(r.label)}</span>
              <span className="val" data-qa="block" data-free data-mark=${r.mark !== 'none' ? r.mark : undefined}>${tidy(r.value)}</span>
              <div className="rule"></div>
            </div>`)}
        </div>
      </div>
      ${slide.note && html`<${Marker} text=${slide.note} />`}
    </div>`;
}

// --- Checklist -------------------------------------------------------------------------
const Tick = ({ seed }) => html`
  <svg viewBox="0 0 72 72" aria-hidden="true">
    <path d=${`M9 ${12 + (seed % 3)} C 26 8, 50 10, 63 ${11 + (seed % 2)} C 64 30, 62 48, 62 62 C 44 63, 24 64, 10 61 C 9 44, 8 28, 9 12`} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M18 36 L31 50 L58 16" fill="none" stroke="var(--stroke)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>`;
function Checklist({ slide }) {
  return html`
    <div className="main">
      <${H2} text=${slide.title} />
      <div className="checks">
        ${slide.items.map((it, i) => html`<div className="check" key=${i}><${Tick} seed=${i} /><span className="txt" data-qa="block" data-fitw>${tidy(it)}</span></div>`)}
      </div>
      ${slide.note && html`<${Marker} text=${slide.note} />`}
    </div>`;
}

// --- Wristbands ------------------------------------------------------------------------
function Band({ fact, refDate }) {
  const u = urgency(fact.date, refDate);
  return html`
    <div className=${`band ${u}`} data-free>
      <i className="snap"></i>
      <div className="label">
        <div className="org" data-qa="block" data-fitw>${fact.org}</div>
        <div className="role" data-qa="block">${tidy(fact.role)}</div>
      </div>
      <div className="when" data-qa="block">
        <span className="k">closes</span>
        <span className="d">${shortDay(fact.date)}</span>
        ${fact.time && html`<span className="t">${fact.time}</span>`}
      </div>
      <span className="holes"><i></i><i></i><i></i></span>
    </div>`;
}
const Legend = () => html`
  <div className="legend" data-qa="block">
    <span><i style=${{ '--band': '#E2382E' }}></i>closes within 3 days</span>
    <span><i style=${{ '--band': '#F7D433' }}></i>within a week</span>
    <span><i style=${{ '--band': '#FFFFFF' }}></i>later</span>
  </div>`;
function Wristbands({ slide, ctx }) {
  const items = slide.items.map((i) => ctx.fact(i.fact)).sort((a, b) => a.date.localeCompare(b.date));
  return html`
    <div className="main">
      <${H2} text=${slide.title} />
      <div className="bands">${items.map((f) => html`<${Band} key=${f.id} fact=${f} refDate=${ctx.refDate} />`)}</div>
      <${Legend} />
      ${slide.note && html`<${Marker} text=${slide.note} />`}
    </div>`;
}

// --- Deadline detail ---------------------------------------------------------------------
function Deadline({ slide, ctx }) {
  const f = ctx.fact(slide.fact);
  return html`
    <div className="main">
      <div className="bands"><${Band} fact=${f} refDate=${ctx.refDate} /></div>
      <div>
        <div className="closes-k" data-qa="block">closes</div>
        <p className="closes" data-qa="block" data-fitw>${shortDay(f.date)}${f.time ? ` ${f.time}` : ''}</p>
      </div>
      ${slide.details?.length && html`
        <div className="boardpanel" data-qa-bg="#F3F5F2"><div className="rows">
          ${slide.details.map((d, i) => html`
            <div className="row" key=${i}>
              <span className="lbl" data-qa="block">${tidy(d.label)}</span>
              <span className="val" data-qa="block" data-free>${tidy(ctx.fact(d.fact).value ?? ctx.fact(d.fact).claim)}</span>
              <div className="rule"></div>
            </div>`)}
        </div></div>`}
      ${slide.note && html`<${Marker} text=${slide.note} />`}
    </div>`;
}

// --- Versus ----------------------------------------------------------------------------------
function sideContext(side, f) {
  if (side.label) return side.label;
  const bits = [];
  if (f.status === 'talent-pool') bits.push('talent pool, not a current vacancy');
  else if (f.status === 'closed') bits.push('closed posting');
  bits.push(f.asOf ? `as posted ${longDate(f.asOf)}` : `page checked ${longDate(f.verifiedAt)}`);
  return bits.join(', ');
}
function Note({ side, cls, ctx }) {
  const f = ctx.fact(side.fact);
  const val = f.value ?? '';
  return html`
    <div className=${`note ${cls}`} data-free>
      <div className="who" data-qa="block">${side.name ?? f.org}</div>
      <div className=${`val${val.length > 22 ? ' long' : ' short'}`} data-qa="block" data-fitw>${tidy(val, { heading: val.length <= 22 })}</div>
      <div className="ctx" data-qa="block">${sideContext(side, f)}</div>
    </div>`;
}
function Versus({ slide, ctx }) {
  return html`
    <div className="main">
      <${H2} text=${slide.title} />
      <${Note} side=${slide.a} cls="a" ctx=${ctx} />
      <span className="vs-mark" data-qa="block" data-free>vs</span>
      <${Note} side=${slide.b} cls="b" ctx=${ctx} />
      ${slide.note && html`<${Marker} text=${slide.note} />`}
    </div>`;
}

// --- Phone demo ---------------------------------------------------------------------------------
function Phone({ slide, ctx }) {
  const { screen } = slide;
  return html`
    <div className="main">
      <${H2} text=${slide.title} />
      <div className="phone-row">
        <div className="phone" data-free><div className="screen" id="phone-screen" data-qa-bg="#FFFFFF" data-ui>
          <span className="island"></span>
          ${screen.image
            ? html`<img src=${ctx.asset(screen.image)} alt="" />`
            : html`<div className="mock">
                <div className="head" data-qa="block">${tidy(screen.mock.header)}</div>
                ${screen.mock.items.map((it, i) => html`
                  <div className="item" key=${i}>
                    <b data-qa="block">${tidy(it.title)}</b>
                    <span data-qa="block">${tidy(it.meta)}</span>
                    ${it.tag && html`<em className=${`tag ${['red', 'yellow', 'white'][i % 3]}`} data-qa="block">${it.tag}</em>`}
                  </div>`)}
              </div>`}
        </div></div>
        ${slide.callouts.length > 0 && html`
          <div className="callouts">
            ${slide.callouts.map((c, i) => html`<${Marker} key=${i} text=${c} tilt=${i % 2 ? 'r' : 'l'} data-arrow-to="#phone-screen" />`)}
          </div>`}
      </div>
      ${slide.note && html`<${Marker} text=${slide.note} />`}
    </div>`;
}

// --- Badge (announcement) ------------------------------------------------------------------------
function Badge({ slide, ctx }) {
  return html`
    <div className="main">
      <${Hero} text=${slide.title} cls="h2" />
      <div className="badge-wrap" data-free>
        <div className="reel" aria-hidden="true">✨</div>
        <div className="cord"></div>
        <div className="badge">
          <div className="strip" data-qa="block">${ctx.spec.brand.name}</div>
          <div className="slot"></div>
          <div className="bodyrow">
            <div className="photo" aria-hidden="true">${slide.emoji ?? '🩺'}</div>
            <div>
              <div className="name" data-qa="block" data-fitw>${tidy(slide.name, { heading: true })}</div>
              ${slide.role && html`<div className="role" data-qa="block">${tidy(slide.role)}</div>`}
            </div>
          </div>
        </div>
      </div>
      ${slide.body && html`<${Boxes} lines=${[slide.body]} />`}
      ${slide.note && html`<${Marker} text=${slide.note} />`}
    </div>`;
}

// --- Receipts ----------------------------------------------------------------------------------------
function Receipts({ slide, ctx }) {
  const used = [];
  for (const f of ctx.spec.facts) for (const sid of f.sources) if (!used.includes(sid)) used.push(sid);
  const sources = used.map((id) => ctx.sources.get(id)).filter(Boolean);
  const checked = ctx.spec.facts.map((f) => f.verifiedAt).sort().at(-1);
  return html`
    <div className="main">
      <div className="receipt" data-qa-bg="#FFFFFF" data-free>
        <h2 className="rtitle" data-qa="block">${tidy(slide.title)} 🧾</h2>
        <div className="rsub" data-qa="block">${ctx.demo ? 'sample data. these postings are not real.' : 'every claim in this post, and where it came from'}</div>
        ${sources.map((s) => html`
          <div className="item" key=${s.id}>
            <div className="pub" data-qa="block">${s.publisher}</div>
            <div className="ttl" data-qa="block">${tidy(s.title).split(' ').map((w, i) => (/\d-\d/.test(w) ? html`<span key=${i} className="nowrap">${w} </span>` : `${w} `))}</div>
            <div className="meta" data-qa="block"><span>${s.published ? `published ${longDate(s.published)}` : ''}</span><span>checked ${longDate(s.accessedAt)}</span></div>
            <div className="url" data-qa="block">${displayUrl(s.url).split(/(?<=[/.])/).map((part, i) => html`<${Fragment} key=${i}><span className="nowrap">${part}</span><wbr /></${Fragment}>`)}</div>
          </div>`)}
        <div className="total" data-qa="block"><span>claims checked</span><span>${ctx.spec.facts.length}</span></div>
        ${checked && html`<div className="meta" data-qa="block"><span>last check</span><span>${longDate(checked)}</span></div>`}
      </div>
    </div>`;
}

// --- CTA ----------------------------------------------------------------------------------------------
function Cta({ slide, ctx }) {
  const [tx, ty] = ctx.platform.targets[slide.action];
  const brandRight = tx < ctx.platform.width / 2 && ty >= ctx.platform.height - 1;
  return html`
    <div className="main" key="main">
      <div className="stack" style=${{ gap: 'calc(40px * var(--s))' }} data-arrow-to=${`target:${slide.action}`}>
        <h1 className="hero cta-title" data-qa="block" data-role="heading" data-fitw>${tidy(slide.title, { heading: true })}</h1>
        ${slide.sub && html`<${Boxes} lines=${[slide.sub]} />`}
      </div>
      ${slide.note && html`<${Marker} text=${slide.note} />`}
    </div>
    <div className=${brandRight ? 'brand right' : 'brand'} data-qa="block" key="brand">${ctx.spec.brand.name}${ctx.spec.brand.handle && html`<span className="handle">${ctx.spec.brand.handle}</span>`}</div>`;
}

export const LAYOUT_COMPONENTS = {
  hook: Hook,
  text_stack: TextStack,
  big_stat: BigStat,
  board: Board,
  checklist: Checklist,
  wristbands: Wristbands,
  deadline: Deadline,
  versus: Versus,
  phone: Phone,
  badge: Badge,
  receipts: Receipts,
  cta: Cta,
};

