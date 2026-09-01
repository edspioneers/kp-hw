// Right-rail companion for the quick-edit style switcher.
//
// A DA library plugin, shown in the editor's right rail. The in-canvas detector
// (tools/style-switcher/quick-edit-style-switcher.js) broadcasts the selected block + section
// and the styles each supports on a same-origin BroadcastChannel; this plugin renders them as
// chips (active styles highlighted). Clicking a chip sends a `toggle` command back to the
// canvas, which applies it to the live element.
//
// For the channel to reach the canvas, this plugin must be registered on the SAME host as the
// editing canvas (e.g. main--kp-hw--edspioneers.preview.da.live) — the browser blocks it across
// origins.

const CHANNEL = 'kp-style-switcher';
const VERSION = 'v6';
const channel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(CHANNEL) : null;
let msgCount = 0;

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[c]));
}

function group(title, scope, data) {
  if (!data) return '';
  const active = new Set(data.active);
  const available = Array.isArray(data.available) ? data.available : [];
  const chips = available.length
    ? available.map((v) => `<button class="ss-chip${active.has(v) ? ' ss-on' : ''}" data-scope="${scope}" data-variant="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('')
    : '<span class="ss-empty">no styles defined</span>';
  return `
    <div class="ss-group">
      <p class="ss-lbl">${escapeHtml(title)}: ${escapeHtml(data.name)}</p>
      <div class="ss-chips">${chips}</div>
    </div>`;
}

function render(data) {
  const app = document.getElementById('app');
  if (!app) return;
  const body = (!data || (!data.block && !data.section))
    ? '<p class="ss-empty">Click inside a block in the page.</p>'
    : group('Block', 'block', data.block) + group('Section', 'section', data.section);
  app.innerHTML = `${body}<p class="ss-foot">${VERSION} · msgs ${msgCount}</p>`;
}

if (channel) {
  // Render any state message the canvas sends. We intentionally don't require a `type`
  // field: a cached older canvas may post a bare { block, section }, and this still renders
  // it rather than leaving the panel blank on a version skew.
  channel.onmessage = (e) => {
    msgCount += 1;
    render(e.data);
  };
}

document.addEventListener('click', (e) => {
  const chip = e.target.closest('.ss-chip');
  if (!chip || !channel) return;
  channel.postMessage({ type: 'toggle', scope: chip.dataset.scope, variant: chip.dataset.variant });
});

render(null);
