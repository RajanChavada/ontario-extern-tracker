// Analytics wrapper (Umami). OFF until a website id is set in config.js, so nothing is sent locally.
// Privacy rules:
// - never send the student's program, year, BCLS answer or any combination of them;
// - no identifiers; Umami is cookieless;
// - "return visit" is an estimate from a localStorage date flag, never an ID.
import { CONFIG } from './config.js';

const enabled = Boolean(CONFIG.UMAMI_WEBSITE_ID && CONFIG.UMAMI_SRC);

export function initAnalytics() {
  if (!enabled) {
    if (CONFIG.DEBUG) console.info('[analytics] disabled: no website id set. Events are logged to the console only.');
    return;
  }
  // The production build puts a static Umami <script> tag in each page's <head>. Don't add a second one.
  if (document.querySelector('script[data-website-id]')) return;
  const s = document.createElement('script');
  s.defer = true;
  s.src = CONFIG.UMAMI_SRC;
  s.dataset.websiteId = CONFIG.UMAMI_WEBSITE_ID;
  s.dataset.doNotTrack = 'true';             // respect browser Do Not Track
  if (CONFIG.UMAMI_DOMAINS) s.dataset.domains = CONFIG.UMAMI_DOMAINS; // only count on the real domain
  document.head.appendChild(s);
}

// The allow-list keeps sensitive properties out even if a caller passes them.
const ALLOWED = {
  filter_used: ['field'],                // which control was touched, never its value
  posting_click: ['hospital', 'status'],
  calendar_add: ['hospital', 'via'],      // via = ics | google
  feedback: ['helped'],
  guide_click: [],
  return_visit_estimate: [],
};

export function track(name, props = {}) {
  if (!(name in ALLOWED)) return;
  const clean = {};
  for (const k of ALLOWED[name]) if (props[k] != null) clean[k] = String(props[k]).slice(0, 40);
  if (!enabled) { if (CONFIG.DEBUG) console.info('[analytics]', name, clean); return; }
  const send = () => window.umami && window.umami.track(name, clean);
  if (window.umami) send(); else setTimeout(send, 1500);
}

/** At most one event per day, only if this browser visited on an earlier date. */
export function markVisit(todayIso) {
  try {
    const last = localStorage.getItem('et_last_visit_day');
    if (last && last !== todayIso) track('return_visit_estimate');
    localStorage.setItem('et_last_visit_day', todayIso);
  } catch { /* private mode: ignore */ }
}
