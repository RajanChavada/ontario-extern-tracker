import { ontarioToday, formatDate, status, deadlineInfo, eligibility, sortEntries, googleCalendarUrl, countHospitals, openSummary, shownDeadline } from './logic.js';
import { initAnalytics, track, markVisit } from './analytics.js';
import { CONFIG } from './config.js';

const DEFAULTS = { program: '', year: null, finalYear: false, bcls: '', region: 'all', hideUnmet: false };
const state = { ...DEFAULTS };
const ui = { closedOpen: false };
let DATA = null;
const today = ontarioToday();
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const isoParts = iso => iso.split('-').map(Number);
const fmt = (iso, opts) => { const [y, m, d] = isoParts(iso); return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, m - 1, d))); };
const shortDate = iso => fmt(iso, { month: 'short', day: 'numeric' });                  // "Nov 30"
const longDate = iso => fmt(iso, { month: 'long', day: 'numeric', year: 'numeric' });   // "November 9, 2026"
const st = e => status(e, today, DATA.stale_after_days);

async function main() {
  initAnalytics();
  markVisit(today);
  try {
    const res = await fetch('data/hospitals.json', { cache: 'no-cache' });
    DATA = await res.json();
  } catch {
    $('#results').innerHTML = '<p class="err">Could not load the hospital list. Please refresh.</p>';
    return;
  }
  wireFilters();
  render();
}

/* ---------- Status wording: one label, one plain note ---------- */
function statusText(e, s) {
  switch (s.key) {
    case 'open_vacancies': return { cls: 'st-positive', label: Number.isInteger(e.positions_listed) ? `${e.positions_listed} position${e.positions_listed === 1 ? '' : 's'} listed` : 'Positions listed', note: Number.isInteger(e.positions_listed) ? '' : (e.short || '') };
    case 'open_unspecified': return { cls: 'st-neutral', label: 'Posting live', note: e.short || 'Vacancy count not stated' };
    case 'open_talent_pool': return { cls: 'st-caution', label: 'Talent pool', note: e.short || 'Not a current vacancy' };
    case 'typical_window': return { cls: 'st-quiet', label: 'Not open now', note: e.short || '' };
    case 'check_employer': return { cls: 'st-quiet', label: 'No live posting linked', note: e.short || '' };
    case 'unconfirmed': return { cls: 'st-caution', label: 'Unconfirmed', note: e.posting_type === 'unconfirmed' ? (e.short || '') : 'Not re-checked recently' };
    default: return { cls: 'st-quiet', label: 'Closed', note: e.deadline ? 'Closing date has passed' : (e.short || '') };
  }
}
const profileSet = () => !!(state.program && (state.program === 'IEN' || state.year || state.finalYear));
const MARK = { ok: '✓', no: '✕', check: '?', info: '·' };

function row(e) {
  const s = st(e), t = statusText(e, s), el = eligibility(e, state);
  const live = s.group === 0, closed = s.key === 'closed';
  const dl = shownDeadline(e, today); // never a date for an Unconfirmed listing
  const close = dl
    ? `<p class="close-date ${dl.daysAway <= 7 && dl.daysAway >= 0 ? 'soon' : ''}"><span class="lbl">Closes </span><b>${esc(shortDate(dl.date))}</b><span class="meta">${esc(dl.when)}</span></p>`
    : (live ? `<p class="close-date none">No closing date</p>`
      : s.key === 'unconfirmed' && e.deadline ? `<p class="close-date none">Closing date not confirmed</p>`
      : `<p class="close-date none dash" aria-hidden="true">—</p>`);
  const pay = e.pay_text ? `<p class="pay">${esc(e.pay_text)}</p>` : `<p class="pay none">${live ? 'Pay not listed' : ''}</p>`;
  const fit = profileSet() && !closed
    ? `<p class="fit fit-${el.verdict} ${live ? '' : 'fit-quiet'}">${esc(el.label)}</p>` : '';
  const id = esc(e.id);
  // Several distinct live postings (e.g. one per unit): the primary action lists them all, each a direct link.
  const multi = live && Array.isArray(e.postings) && e.postings.length > 1;
  const primary = multi
    ? `<button type="button" class="btn" aria-expanded="false" aria-controls="pst-${id}" data-toggle="pst-${id}">${e.postings.length} postings</button>`
    : live
    ? `<a class="btn" href="${esc(e.source_url)}" target="_blank" rel="noopener" data-src="${id}" data-status="${esc(s.key)}">View posting</a>`
    : `<a class="sec" href="${esc(e.source_url)}" target="_blank" rel="noopener" data-src="${id}" data-status="${esc(s.key)}">${e.source_kind !== 'posting' ? 'Hospital page' : closed ? 'Expired posting' : 'View posting'}</a>`;
  const canSave = live && dl && dl.daysAway >= 0;
  const reqs = el.items.map(i => `<li class="${i.state}"><span class="mk" aria-hidden="true">${MARK[i.state]}</span><span>${esc(i.text)}</span></li>`).join('');
  return `
  <article class="row ${closed ? 'is-closed' : ''}" data-id="${id}">
    <div class="c-hosp"><h3 class="name">${esc(e.hospital)}</h3><p class="meta">${esc(e.location)} · ${esc(e.program_name)}</p></div>
    <div class="c-status"><p class="status ${t.cls}">${esc(t.label)}</p>${t.note ? `<p class="meta">${esc(t.note)}</p>` : ''}<p class="meta checked">Checked ${esc(shortDate(e.last_verified))}</p></div>
    <div class="c-when"><div class="c-close">${close}</div><div class="c-pay">${pay}</div></div>
    <div class="c-fit">${fit}</div>
    <div class="c-actions"><div class="c-act">${primary}</div>
    <div class="c-links">
      ${closed ? '' : `<button type="button" class="tlink" aria-expanded="false" aria-controls="req-${id}" data-toggle="req-${id}">Requirements</button>`}
      ${canSave ? `<button type="button" class="tlink" aria-expanded="false" aria-controls="cal-${id}" data-toggle="cal-${id}">Add to calendar</button>` : ''}
    </div></div>
    <div class="c-panel">
      ${multi ? `
      <div class="panel" id="pst-${id}" hidden>
        <ul class="plist" aria-label="Separate postings">${e.postings.map(q => `<li><a href="${esc(q.url)}" target="_blank" rel="noopener" data-src="${id}" data-status="${esc(s.key)}">${esc(q.label)}</a>${q.note ? ` <span class="meta">${esc(q.note)}</span>` : ''}</li>`).join('')}</ul>
        <p class="src">All listed on <a href="${esc(e.source_url)}" target="_blank" rel="noopener">${esc(host(e.source_url))}</a>, checked ${esc(longDate(e.last_verified))}</p>
      </div>` : ''}
      <div class="panel" id="req-${id}" hidden>
        <ul class="reqs" aria-label="Listed requirements">${reqs}</ul>
        ${s.detail ? `<p>${esc(s.detail)}</p>` : ''}
        <p class="src">Source: <a href="${esc(e.source_url)}" target="_blank" rel="noopener">${esc(host(e.source_url))}</a>, checked ${esc(longDate(e.last_verified))}</p>
      </div>
      ${canSave ? `
      <div class="panel" id="cal-${id}" hidden>
        <p>All-day event on ${esc(longDate(dl.date))}, with a reminder three days before. The closing time isn't published, so apply early.</p>
        <p><a href="cal/${id}.ics" data-cal="${id}" data-via="ics">Apple or Outlook (.ics)</a> &nbsp;·&nbsp; <a href="${esc(googleCalendarUrl(e))}" target="_blank" rel="noopener" data-cal="${id}" data-via="google">Google Calendar</a></p>
      </div>` : ''}
    </div>
  </article>`;
}

const COLHEAD = `<div class="colhead" aria-hidden="true"><span>Hospital</span><span>Listing</span><span>Closes</span><span>Pay</span><span>${'Your criteria'}</span><span></span></div>`;

/* ---------- Render ---------- */
function render() {
  let list = sortEntries(DATA.entries, today).filter(e => state.region === 'all' || e.region === state.region);
  if (state.hideUnmet) list = list.filter(e => eligibility(e, state).verdict !== 'not_met');
  const rank = { meets: 0, check: 1, incomplete: 1, not_met: 2 };
  const byFit = arr => arr.sort((a, b) => rank[eligibility(a, state).verdict] - rank[eligibility(b, state).verdict]);
  const live = byFit(list.filter(e => st(e).group === 0));
  const notOpen = byFit(list.filter(e => [1, 2, 3].includes(st(e).group)));
  const closed = list.filter(e => st(e).group === 4);

  // Intro facts come from the full dataset, so they don't move with filters.
  const sum = openSummary(DATA.entries, today); // Unconfirmed listings are never counted as taking applications
  const nLive = sum.listings, nPos = sum.positions, nPool = sum.pools, nOther = sum.other, nLiveHosp = sum.hospitals, next = sum.nextDeadline;
  const parts = [nPos && `${nPos} ${nPos === 1 ? 'lists' : 'list'} positions`, nPool && `${nPool} ${nPool === 1 ? 'is a talent pool' : 'are talent pools'}`, nOther && `${nOther} ${nOther === 1 ? "doesn't" : "don't"} say`].filter(Boolean);
  $('#standfirst').innerHTML = `<strong>${nLiveHosp} ${nLiveHosp === 1 ? 'hospital is' : 'hospitals are'} taking applications</strong>${nLiveHosp !== nLive ? ` (${nLive} listings)` : ''}${parts.length ? `: ${esc(parts.join(', '))}` : ''}.${next ? ` Next closing date: ${esc(shortDate(next))}.` : ''}`;
  // dataset_checked = last day ALL listings were checked (never later than the oldest listing's check); each row shows its own date.
  $('#dateline').textContent = `Last full check of all ${countHospitals(DATA.entries)} hospitals' own career pages: ${shortDate(DATA.dataset_checked)}. Each listing shows the date we last checked it.`;

  const meets = live.filter(e => eligibility(e, state).verdict === 'meets').length;
  $('#summary').innerHTML = profileSet()
    ? `You meet the listed criteria for <strong>${meets} of ${live.length}</strong> open listing${live.length === 1 ? '' : 's'}${state.region !== 'all' ? ' in this region' : ''}.`
    : '';
  $('#summary').hidden = !profileSet();

  const section = (title, items, opts = {}) => items.length ? `
    <section class="section">
      <h2 class="section-h">${title} <span class="n">${items.length}</span>${opts.toggle ? `<button type="button" class="tlink" id="closed-toggle" aria-expanded="${ui.closedOpen}">${ui.closedOpen ? 'Hide' : 'Show'}</button>` : ''}</h2>
      ${opts.head ? COLHEAD : ''}
      <div class="rows" ${opts.toggle && !ui.closedOpen ? 'hidden' : ''}>${items.map(row).join('')}</div>
    </section>` : '';
  $('#results').innerHTML = (section('Taking applications', live, { head: true }) +
    section('Not taking applications now', notOpen, { head: !live.length }) +
    section('Closed', closed, { toggle: true })) || '<p class="resultline">No hospitals match these filters.</p>';
  syncControls();
}

/* ---------- Filters ---------- */
function secondaryCount() { return (state.bcls ? 1 : 0) + (state.finalYear ? 1 : 0) + (state.region !== 'all' ? 1 : 0) + (state.hideUnmet ? 1 : 0); }
function syncControls() {
  document.querySelectorAll('.seg').forEach(g => {
    const f = g.dataset.field; const cur = f === 'year' ? String(state.year ?? '') : state[f];
    g.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === cur)));
  });
  $('#year-row').classList.toggle('dim', state.program === 'IEN');
  $('#final').checked = state.finalYear; $('#region').value = state.region; $('#hide-unmet').checked = state.hideUnmet;
  const c = secondaryCount();
  $('#more-count').textContent = c ? ` (${c})` : '';
  $('#reset').hidden = JSON.stringify(state) === JSON.stringify(DEFAULTS);
}
function wireFilters() {
  document.querySelectorAll('.seg').forEach(g => g.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    const f = g.dataset.field; const cur = f === 'year' ? String(state.year ?? '') : state[f];
    const next = cur === b.dataset.v ? '' : b.dataset.v;   // tap again to clear
    if (f === 'year') state.year = next ? Number(next) : null; else state[f] = next;
    track('filter_used', { field: f }); render();
  }));
  $('#final').addEventListener('change', e => { state.finalYear = e.target.checked; track('filter_used', { field: 'final_year' }); render(); });
  $('#region').addEventListener('change', e => { state.region = e.target.value; track('filter_used', { field: 'region' }); render(); });
  $('#hide-unmet').addEventListener('change', e => { state.hideUnmet = e.target.checked; track('filter_used', { field: 'hide_unmet' }); render(); });
  $('#more-btn').addEventListener('click', () => {
    const open = !$('#more').classList.contains('open');
    $('#more').classList.toggle('open', open); $('#more-btn').setAttribute('aria-expanded', String(open));
    $('#more-btn').firstChild.textContent = open ? 'Fewer options' : 'More options';
  });
  $('#reset').addEventListener('click', () => { Object.assign(state, DEFAULTS); track('filter_used', { field: 'reset' }); render(); });
  $('#guide-link').addEventListener('click', () => track('guide_click'));
}

/* ---------- Clicks: posting, calendar, panels ---------- */
document.addEventListener('click', ev => {
  const a = ev.target.closest('a[data-src]');
  if (a) { track('posting_click', { hospital: a.dataset.src, status: a.dataset.status }); showFeedback(); return; }
  const c = ev.target.closest('a[data-cal]');
  if (c) { track('calendar_add', { hospital: c.dataset.cal, via: c.dataset.via }); showFeedback(); return; }
  const t = ev.target.closest('button[data-toggle]');
  if (t) {
    const panel = document.getElementById(t.dataset.toggle);
    const open = panel.hidden;
    t.closest('.row').querySelectorAll('button[data-toggle]').forEach(o => { o.setAttribute('aria-expanded', 'false'); document.getElementById(o.dataset.toggle).hidden = true; });
    panel.hidden = !open; t.setAttribute('aria-expanded', String(open));
    return;
  }
  if (ev.target.closest('#closed-toggle')) { ui.closedOpen = !ui.closedOpen; render(); }
});

function showFeedback() {
  try { if (sessionStorage.getItem('et_fb')) return; } catch {}
  const f = $('#feedback'); f.hidden = false;
  f.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    try { sessionStorage.setItem('et_fb', '1'); } catch {}
    if (b.classList.contains('toast-close')) { f.hidden = true; return; }
    track('feedback', { helped: b.dataset.helped });
    f.querySelector('.toast-actions').hidden = true;
    f.querySelector('.toast-q').hidden = true;
    f.querySelector('.toast-thanks').hidden = false;
    if (CONFIG.FEEDBACK_EMAIL) { const m = $('#fb-mail'); m.href = `mailto:${CONFIG.FEEDBACK_EMAIL}?subject=Extern%20tracker%20feedback`; m.hidden = false; }
    setTimeout(() => { f.hidden = true; }, 5000);
  };
}

main();
