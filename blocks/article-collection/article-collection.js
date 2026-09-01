import { callProxy } from '../../utils/kp-api.js';

// KP Lucid Search — articles source (consumernet / AEM DHO articles).
const KP_SEARCH_BASE = 'https://apims.kaiserpermanente.org/kp/care/api/sda/kp-search-api/v1/api/kporg/search/v1';
const V_PROJECT = 'kp-consumernet';
const V_SOURCES = 'kp-aem-dho-articles';
const KP_HOST = 'https://healthy.kaiserpermanente.org'; // image + article-link host
const PER_PAGE = 10;

const SORT_OPTIONS = [
  { label: 'Default', value: '' },
  { label: 'Newest', value: 'date' },
  { label: 'A to Z', value: 'title' },
];

// Interim hardcoded filter groups (real source still TBD). Each checked option
// is OR-joined within its group and AND-ed with the topic in the `query` param.
const FILTER_GROUPS = [
  {
    label: 'Category',
    options: [
      'Appropriate for diabetes',
      'Blood sugar',
      'Diabetes basics',
      'Diabetes care at Kaiser Permanente',
      'Diabetes self-care',
      'Managing diabetes medication',
    ],
  },
];

const DEFAULTS = { topic: 'Diabetes', region: 'NCA', language: 'English' };

const ICON_FILTER = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M7 5v6M7 15v4M17 5v4M17 13v6M3 13h8M13 9h8"/><circle cx="7" cy="13" r="2" fill="currentColor"/><circle cx="17" cy="11" r="2" fill="currentColor"/></svg>';
const ICON_CHEVRON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>';

// --- helpers -------------------------------------------------------------
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

// Strip HTML tags + decode entities from teaser markup.
function toText(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return d.textContent.replace(/\s+/g, ' ').trim();
}

function absUrl(path) {
  if (!path) return '';
  return /^https?:\/\//i.test(path) ? path : `${KP_HOST}${path}`;
}

// Reads optional authored config (key/value rows) with sensible defaults.
function readConfig(block) {
  const cfg = { ...DEFAULTS };
  block.querySelectorAll(':scope > div').forEach((row) => {
    const cells = row.querySelectorAll(':scope > div');
    if (cells.length >= 2) {
      const key = cells[0].textContent.trim().toLowerCase();
      const val = cells[1].textContent.trim();
      if (key && val && key in cfg) cfg[key] = val;
    }
  });
  return cfg;
}

// query: topic alone, or ((opt OR opt…)) AND ("topic") when categories selected.
function buildQuery(topic, selected) {
  if (!selected.length) return `"${topic}"`;
  const group = selected.map((s) => `"${s}"`).join(' OR ');
  return `((${group})) AND ("${topic}")`;
}

function buildArticleUrl({
  topic, region, language, selected, sortby, offset,
}) {
  const params = [
    `v:project=${V_PROJECT}`,
    `v:sources=${V_SOURCES}`,
    `query=${encodeURIComponent(buildQuery(topic, selected))}`,
    // %0A (literal) survives the proxy URL parse; a real "\n" would be stripped.
    `binning-state=kp_language==${language}%0Aregion==${region}`,
    `sortby=${sortby}`,
    'content-type=application/json',
    'render.function=json-feed-display-document',
    `render.list-show=${PER_PAGE}`,
    `v:state=root|root-${offset}-${PER_PAGE}|0`,
  ];
  return `${KP_SEARCH_BASE}?${params.join('&')}`;
}

function mapArticle(doc) {
  const c = doc.contents || {};
  return {
    title: c.title || c['data-article-title'] || '',
    label: c.categorytype || '',
    teaser: toText(c['data-article-teaser'] || c['data-fragment-description'] || ''),
    image: absUrl(c['data-article-image']),
    imageAlt: c['data-article-imagealttext'] || '',
    href: absUrl(c.p_url || ''),
  };
}

// --- card markup ---------------------------------------------------------
function cardHtml(article, featured) {
  const media = article.image
    ? `<div class="ac-card__media"><img src="${esc(article.image)}" alt="${esc(article.imageAlt)}" loading="lazy"></div>`
    : '';
  return `
    <a class="ac-card${featured ? ' ac-card--featured' : ''}" href="${esc(article.href)}">
      ${media}
      <div class="ac-card__body">
        ${article.label ? `<span class="ac-card__label">${esc(article.label)}</span>` : ''}
        <h3 class="ac-card__title">${esc(article.title)}</h3>
        ${article.teaser ? `<p class="ac-card__teaser">${esc(article.teaser)}</p>` : ''}
      </div>
    </a>`;
}

function listingHtml(articles) {
  if (!articles.length) return '<p class="ac-empty">No articles found.</p>';
  const last = articles.length - 1;
  // First and last item of each page render as featured (desktop only).
  return articles.map((a, i) => cardHtml(a, articles.length > 1 && (i === 0 || i === last))).join('');
}

function paginationHtml(page, totalPages) {
  if (totalPages <= 1) return '';
  const win = new Set([1, totalPages, page, page + 1, page + 2]);
  for (let p = 1; p <= 5 && p <= totalPages; p += 1) win.add(p); // early window like the design
  const pages = [...win].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  let html = `<button type="button" class="ac-page-arrow" data-page="${page - 1}" ${page === 0 ? 'disabled' : ''} aria-label="Previous page">‹</button>`;
  let prev = 0;
  pages.forEach((p) => {
    if (p - prev > 1) html += '<span class="ac-page-gap">…</span>';
    html += `<button type="button" class="ac-page${p - 1 === page ? ' is-active' : ''}" data-page="${p - 1}" aria-current="${p - 1 === page ? 'page' : 'false'}">${p}</button>`;
    prev = p;
  });
  html += `<button type="button" class="ac-page-arrow" data-page="${page + 1}" ${page >= totalPages - 1 ? 'disabled' : ''} aria-label="Next page">›</button>`;
  return html;
}

export default async function init(el) {
  const cfg = readConfig(el);
  el.textContent = '';

  // --- shell ------------------------------------------------------------
  el.innerHTML = `
    <p class="ac-heading">Filter and sort resources</p>
    <div class="ac-controls">
      <button type="button" class="ac-filter-btn">${ICON_FILTER}<span>Filter resources</span></button>
      <div class="ac-sort">
        <button type="button" class="ac-sort-btn" aria-haspopup="listbox" aria-expanded="false">
          <span>Sort by: <span class="ac-sort-current">Default</span></span>${ICON_CHEVRON}
        </button>
        <ul class="ac-sort-menu" role="listbox" hidden></ul>
      </div>
    </div>
    <div class="ac-chips" hidden></div>
    <div class="ac-listing" aria-live="polite"></div>
    <div class="ac-footer">
      <p class="ac-count"></p>
      <nav class="ac-pagination" aria-label="Pagination"></nav>
    </div>
    <div class="ac-modal" role="dialog" aria-modal="true" aria-label="Filter resources" hidden>
      <div class="ac-modal__panel">
        <div class="ac-modal__head">
          <h2 class="ac-modal__title">Filter ${esc(cfg.topic.toLowerCase())} resources</h2>
          <button type="button" class="ac-modal__close"><span class="ac-modal__close-x" aria-hidden="true">✕</span><span class="ac-modal__close-text">Close</span></button>
        </div>
        <div class="ac-modal__body">
          <p class="ac-modal__note">All fields are optional</p>
          <div class="ac-modal__groups"></div>
        </div>
        <div class="ac-modal__foot">
          <button type="button" class="ac-modal__clear">Clear all filters</button>
          <button type="button" class="ac-modal__apply">Apply filters</button>
        </div>
      </div>
    </div>`;

  const filterBtn = el.querySelector('.ac-filter-btn');
  const sortBtn = el.querySelector('.ac-sort-btn');
  const sortMenu = el.querySelector('.ac-sort-menu');
  const sortCurrent = el.querySelector('.ac-sort-current');
  const chipsEl = el.querySelector('.ac-chips');
  const listingEl = el.querySelector('.ac-listing');
  const countEl = el.querySelector('.ac-count');
  const pagEl = el.querySelector('.ac-pagination');
  const modal = el.querySelector('.ac-modal');
  const modalGroups = el.querySelector('.ac-modal__groups');

  // --- state ------------------------------------------------------------
  const state = { selected: [], sortby: '', page: 0 };
  let reqToken = 0;

  // --- sort dropdown ----------------------------------------------------
  sortMenu.innerHTML = SORT_OPTIONS.map((o) => `<li role="option" class="ac-sort-opt${o.value === '' ? ' is-active' : ''}" data-value="${o.value}" data-label="${o.label}">${o.label}</li>`).join('');

  function closeSort() {
    sortMenu.hidden = true;
    sortBtn.setAttribute('aria-expanded', 'false');
  }
  sortBtn.addEventListener('click', () => {
    const open = sortMenu.hidden;
    sortMenu.hidden = !open;
    sortBtn.setAttribute('aria-expanded', String(open));
  });
  sortMenu.addEventListener('click', (e) => {
    const opt = e.target.closest('.ac-sort-opt');
    if (!opt) return;
    state.sortby = opt.dataset.value;
    sortCurrent.textContent = opt.dataset.label;
    sortMenu.querySelectorAll('.ac-sort-opt').forEach((o) => o.classList.toggle('is-active', o === opt));
    closeSort();
    state.page = 0;
    load();
  });
  document.addEventListener('click', (e) => {
    if (!el.querySelector('.ac-sort').contains(e.target)) closeSort();
  });

  // --- filter modal -----------------------------------------------------
  function renderModalGroups() {
    modalGroups.innerHTML = FILTER_GROUPS.map((g) => `
      <div class="ac-group">
        <p class="ac-group__label">${esc(g.label)}:</p>
        ${g.options.map((o) => `
          <label class="ac-check">
            <input type="checkbox" value="${esc(o)}" ${state.selected.includes(o) ? 'checked' : ''}>
            <span>${esc(o)}</span>
          </label>`).join('')}
      </div>`).join('');
  }
  function openModal() {
    renderModalGroups();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
  }
  filterBtn.addEventListener('click', openModal);
  modal.querySelector('.ac-modal__close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  modal.querySelector('.ac-modal__clear').addEventListener('click', () => {
    modalGroups.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = false; });
  });
  modal.querySelector('.ac-modal__apply').addEventListener('click', () => {
    state.selected = [...modalGroups.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
    closeModal();
    state.page = 0;
    renderChips();
    load();
  });

  // --- active-filter chips ----------------------------------------------
  function renderChips() {
    if (!state.selected.length) {
      chipsEl.hidden = true;
      chipsEl.innerHTML = '';
      return;
    }
    chipsEl.hidden = false;
    chipsEl.innerHTML = `${state.selected.map((s) => `
      <button type="button" class="ac-chip" data-value="${esc(s)}"><span>${esc(s)}</span><span class="ac-chip__x" aria-hidden="true">✕</span></button>`).join('')
       }<button type="button" class="ac-chip-clear">Clear all</button>`;
  }
  chipsEl.addEventListener('click', (e) => {
    if (e.target.closest('.ac-chip-clear')) {
      state.selected = [];
    } else {
      const chip = e.target.closest('.ac-chip');
      if (!chip) return;
      state.selected = state.selected.filter((s) => s !== chip.dataset.value);
    }
    state.page = 0;
    renderChips();
    load();
  });

  // --- pagination -------------------------------------------------------
  pagEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    const p = Number(btn.dataset.page);
    if (p === state.page || p < 0) return;
    state.page = p;
    load();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // --- load + render ----------------------------------------------------
  async function load() {
    reqToken += 1;
    const token = reqToken;
    listingEl.innerHTML = '<div class="ac-spinner" role="status" aria-label="Loading articles"></div>';
    try {
      const data = await callProxy(buildArticleUrl({
        topic: cfg.topic,
        region: cfg.region,
        language: cfg.language,
        selected: state.selected,
        sortby: state.sortby,
        offset: state.page * PER_PAGE,
      }));
      if (token !== reqToken) return;
      const num = Number(data.list?.num || data['added-sources']?.[0]?.['total-results'] || 0);
      const docs = (data.list?.document || []).map(mapArticle);
      const totalPages = Math.max(1, Math.ceil(num / PER_PAGE));
      listingEl.innerHTML = listingHtml(docs);
      const start = state.page * PER_PAGE;
      countEl.textContent = num
        ? `${start + 1} - ${Math.min(start + PER_PAGE, num)} of ${num} items`
        : '0 items';
      pagEl.innerHTML = paginationHtml(state.page, totalPages);
    } catch (err) {
      if (token !== reqToken) return;
      // eslint-disable-next-line no-console
      console.error('[article-collection] failed to load:', err);
      listingEl.innerHTML = '<p class="ac-empty">Something went wrong loading articles.</p>';
    }
  }

  load();
}
