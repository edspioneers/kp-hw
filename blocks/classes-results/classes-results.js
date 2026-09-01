import {
  DEFAULT_ROP, zipToRop, latToRop, fetchTopics, fetchResults,
} from '../../utils/kp-api.js';

const DISTANCE_OPTIONS = [5, 10, 25, 50, 75, 100];
const DEFAULT_DISTANCE = 50;
const FACET_VISIBLE = 6; // facet options shown before "Show More"
const FEE_TOKEN = 'fee_required==No';
const FEE_LABEL = 'No fee classes & programs';

// Sidebar filter groups (curated subset of binning-set, in this order).
const FILTER_GROUPS = [
  { key: 'facility', bsId: 'facility', label: 'Facility' },
  { key: 'format', bsId: 'format_label', label: 'Format' },
  { key: 'language', bsId: 'languages', label: 'Language' },
];

// "distance_label" arrives as "50" or "Within 50 miles" — pull the mileage out.
function parseDistance(distanceLabel) {
  const n = parseInt((String(distanceLabel || '').match(/\d+/) || [])[0], 10);
  return DISTANCE_OPTIONS.includes(n) ? n : DEFAULT_DISTANCE;
}

// --- HTML helpers (pure) -------------------------------------------------
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function regionLabel(rop) {
  if (rop === 'SCA') return 'S. California';
  if (rop === 'NCA') return 'N. California';
  return rop || '';
}

function cleanAttendee(arr) {
  if (Array.isArray(arr)) return arr.join(' ').replace(/\s+/g, ' ').trim();
  return String(arr || '').replace(/\s+/g, ' ').trim();
}

function joinLangs(langs) {
  if (Array.isArray(langs)) return langs.join(', ');
  return langs || '';
}

// Group offerings that share a title into one program section. The topic-first
// API no longer returns per-location address/distance, so each entry is a
// facility + how to reach it.
function groupByTitle(docs) {
  const map = new Map();
  docs.forEach((doc) => {
    const c = doc.contents || {};
    const key = c.title || '';
    if (!map.has(key)) {
      map.set(key, {
        title: c.title || '',
        format: c.format_label || '',
        description: c.class_description || '',
        attendee: cleanAttendee(c.attendee),
        fee: c.fee || '',
        language: joinLangs(c.languages),
        referral: c.referral || '',
        locations: [],
      });
    }
    const group = map.get(key);
    // Fill in any meta missing on the first offering from later ones.
    if (!group.description && c.class_description) group.description = c.class_description;
    if (!group.fee && c.fee) group.fee = c.fee;
    group.locations.push({
      facility: c.facility || '',
      city: c.city && c.city !== 'None' ? c.city : '',
      phone: c.phone_number || '',
      detailsUrl: c.p_url || c.url || '',
    });
  });
  return [...map.values()];
}

function buildCountHtml(ctx) {
  const region = ctx.region ? ` in <strong>${esc(ctx.region)}</strong>` : '';
  return `${esc(ctx.num)} results for <strong>${esc(ctx.topicLabel)}</strong>${region}`;
}

function buildLocationHtml(loc) {
  if (!loc.facility && !loc.phone && !loc.detailsUrl) return '';
  const lines = [
    loc.city ? esc(loc.city) : '',
    loc.phone ? esc(loc.phone) : '',
  ].filter(Boolean).join('<br>');
  return `
    <div class="cr-loc">
      <div class="cr-loc-info">
        ${loc.facility ? `<p class="cr-loc-head"><span class="cr-facility">${esc(loc.facility)}</span></p>` : ''}
        ${lines ? `<p class="cr-loc-address">${lines}</p>` : ''}
        ${loc.detailsUrl ? `<a class="cr-loc-link" href="${esc(loc.detailsUrl)}">More program details for this location</a>` : ''}
      </div>
      <div class="cr-loc-dates">
        <p class="cr-dates-label">Dates and times</p>
        <p class="cr-dates-value">Call for dates and times</p>
      </div>
    </div>`;
}

function buildSectionHtml(group) {
  const meta = [
    group.attendee ? `<p><strong>Who can attend:</strong> ${esc(group.attendee)}</p>` : '',
    group.fee ? `<p><strong>Fee(s):</strong> ${esc(group.fee)}</p>` : '',
    group.language ? `<p><strong>Language:</strong> ${esc(group.language)}</p>` : '',
    group.referral ? `<p><strong>Referral:</strong> ${esc(group.referral)}</p>` : '',
  ].join('');
  return `
    <section class="cr-program">
      <h3 class="cr-program-title">${esc(group.title)}</h3>
      <p class="cr-program-type">${esc(group.format)}</p>
      ${group.description ? `<p class="cr-program-desc">${esc(group.description)}</p>` : ''}
      <div class="cr-program-meta">${meta}</div>
      <div class="cr-locations">${group.locations.map(buildLocationHtml).join('')}</div>
    </section>`;
}

function buildListingHtml(docs) {
  if (!docs.length) return '<p class="cr-empty">No classes or programs found.</p>';
  return groupByTitle(docs).map(buildSectionHtml).join('');
}

const ICON_PIN = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>';

export default function init(el) {
  // --- Read the incoming search from the URL -----------------------------
  const params = new URLSearchParams(window.location.search);
  const initialZip = (params.get('user_zip') || '').replace(/\D/g, '').slice(0, 5);
  const initialLat = params.get('user_lat') || '';
  const initialLon = params.get('user_lon') || '';
  const initialMiles = parseDistance(params.get('distance_label'));
  const initialTopic = params.get('health_topic') || '';

  el.textContent = '';

  // --- Search controls (top bar): location + distance + topic ------------
  const form = document.createElement('form');
  form.className = 'cr-form';
  form.noValidate = true;

  const locField = document.createElement('div');
  locField.className = 'cr-field cr-location';
  locField.innerHTML = `
    <div class="cr-label-row">
      <label class="cr-label" for="cr-zip">Location</label>
      <button type="button" class="cr-use-location">${ICON_PIN}<span>Use my location</span></button>
    </div>
    <input id="cr-zip" class="cr-input" type="text" inputmode="numeric" autocomplete="postal-code"
      maxlength="5" placeholder="Enter your city or ZIP code" />
    <p class="cr-help">Enter city or ZIP code</p>`;

  const distField = document.createElement('div');
  distField.className = 'cr-field cr-distance';
  distField.innerHTML = `
    <div class="cr-label-row"><label class="cr-label" for="cr-distance">Distance</label></div>
    <select id="cr-distance" class="cr-select">
      ${DISTANCE_OPTIONS.map((m) => `<option value="${m}"${m === initialMiles ? ' selected' : ''}>Within ${m} miles</option>`).join('')}
    </select>`;

  const topicField = document.createElement('div');
  topicField.className = 'cr-field cr-topic';
  topicField.innerHTML = `
    <div class="cr-label-row"><label class="cr-label" for="cr-topic">Topic</label></div>
    <div class="cr-topic-control">
      <select id="cr-topic" class="cr-select" disabled aria-busy="false">
        <option value="">Select topic</option>
      </select>
      <div class="cr-spinner" role="status" aria-label="Loading topics" hidden></div>
    </div>`;

  const search = document.createElement('button');
  search.type = 'submit';
  search.className = 'cr-submit';
  search.textContent = 'Search';

  form.append(locField, distField, topicField, search);
  el.append(form);

  // --- Results region: filter sidebar + main column ----------------------
  const results = document.createElement('div');
  results.className = 'cr-results';
  results.innerHTML = `
    <aside class="cr-filters">
      <div class="cr-filters-head">
        <span class="cr-filters-title">Filter</span>
        <button type="button" class="cr-reset">Reset</button>
      </div>
      <div class="cr-groups"></div>
      <div class="cr-fee">
        <button type="button" class="cr-toggle" role="switch" aria-checked="false" aria-label="${FEE_LABEL}"></button>
        <span class="cr-fee-label">${FEE_LABEL}</span>
      </div>
    </aside>
    <div class="cr-main">
      <p class="cr-count" aria-live="polite"></p>
      <div class="cr-chips"></div>
      <div class="cr-listing"></div>
      <div class="cr-view-more-wrap">
        <button type="button" class="cr-view-more" hidden>View more programs</button>
      </div>
    </div>`;
  el.append(results);

  const input = locField.querySelector('.cr-input');
  const geoBtn = locField.querySelector('.cr-use-location');
  const distSelect = distField.querySelector('.cr-select');
  const topicSelect = topicField.querySelector('.cr-select');
  const spinner = topicField.querySelector('.cr-spinner');
  const groupsEl = results.querySelector('.cr-groups');
  const feeToggle = results.querySelector('.cr-toggle');
  const resetBtn = results.querySelector('.cr-reset');
  const countEl = results.querySelector('.cr-count');
  const chipsEl = results.querySelector('.cr-chips');
  const listingEl = results.querySelector('.cr-listing');
  const viewMoreBtn = results.querySelector('.cr-view-more');

  input.value = initialZip;

  // --- State --------------------------------------------------------------
  let state = {
    zip: initialZip,
    lat: initialLat,
    lon: initialLon,
    rop: initialZip ? zipToRop(initialZip) : DEFAULT_ROP,
  };
  let reqToken = 0;
  const resultsState = { docs: [], num: 0 };
  let resultsToken = 0;
  let lastBinningSet = [];

  // Sidebar filter state: each group holds the selected token (or null); fee is bool.
  const filters = {
    facility: null, format: null, language: null, fee: false,
  };
  const expanded = { facility: false, format: false, language: false };
  const showAll = { facility: false, format: false, language: false };

  // ===================== Topic dropdown (search bar) =====================
  function resetTopics() {
    spinner.hidden = true;
    topicSelect.hidden = false;
    topicSelect.setAttribute('aria-busy', 'false');
    topicSelect.disabled = true;
    topicSelect.innerHTML = '<option value="">Select topic</option>';
  }

  function showTopicsLoading() {
    topicSelect.hidden = true;
    spinner.hidden = false;
    topicSelect.setAttribute('aria-busy', 'true');
  }

  function renderTopics(topics, preselectLabel) {
    spinner.hidden = true;
    topicSelect.hidden = false;
    topicSelect.setAttribute('aria-busy', 'false');
    topicSelect.innerHTML = '<option value="">Select topic</option>';
    topics.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.label;
      opt.textContent = t.label;
      if (preselectLabel && t.label === preselectLabel) opt.selected = true;
      topicSelect.append(opt);
    });
    topicSelect.disabled = topics.length === 0;
  }

  async function loadTopics() {
    const current = topicSelect.value || initialTopic;
    reqToken += 1;
    const token = reqToken;
    showTopicsLoading();
    try {
      const topics = await fetchTopics({ rop: state.rop });
      if (token !== reqToken) return;
      renderTopics(topics, current);
    } catch (err) {
      if (token !== reqToken) return;
      // eslint-disable-next-line no-console
      console.error('[classes-results] failed to load topics:', err);
      resetTopics();
    }
  }

  const currentTopicLabel = () => topicSelect.value || initialTopic;

  // ===================== Sidebar filters =====================
  function activeFilterTokens() {
    const tokens = [];
    FILTER_GROUPS.forEach((g) => { if (filters[g.key]) tokens.push(filters[g.key]); });
    if (filters.fee) tokens.push(FEE_TOKEN);
    return tokens;
  }

  // Build the static group containers once.
  FILTER_GROUPS.forEach((g) => {
    const group = document.createElement('div');
    group.className = 'cr-group';
    group.dataset.key = g.key;
    group.innerHTML = `
      <button type="button" class="cr-group-head" aria-expanded="false">
        <span class="cr-group-icon" aria-hidden="true">+</span>
        <span class="cr-group-name">${esc(g.label)}</span>
      </button>
      <div class="cr-group-body" hidden></div>`;
    groupsEl.append(group);
  });

  function renderGroup(g) {
    const group = groupsEl.querySelector(`.cr-group[data-key="${g.key}"]`);
    const body = group.querySelector('.cr-group-body');
    const set = lastBinningSet.find((s) => s['bs-id'] === g.bsId);
    const bins = set?.bins || [];
    // Hide a filter group entirely when the current search has no options for it
    // (e.g. Facility for online-only topics).
    group.hidden = bins.length === 0;
    if (!bins.length) {
      body.innerHTML = '';
      return;
    }
    const selected = filters[g.key] || '';
    // Auto-expand the list if the selected option is hidden behind "Show More".
    const selIdx = bins.findIndex((b) => b.token === selected);
    if (selIdx >= FACET_VISIBLE) showAll[g.key] = true;
    const visible = showAll[g.key] ? bins : bins.slice(0, FACET_VISIBLE);
    const allLabel = `All ${g.label.toLowerCase()}`;

    const radio = (token, label, checked) => `
      <label class="cr-radio">
        <input type="radio" name="cr-f-${g.key}" value="${esc(token)}"${checked ? ' checked' : ''} />
        <span>${esc(label)}</span>
      </label>`;

    let html = radio('', allLabel, selected === '');
    html += visible.map((b) => radio(b.token, `${b.label} (${b.ndocs})`, selected === b.token)).join('');
    if (bins.length > FACET_VISIBLE) {
      html += showAll[g.key]
        ? '<button type="button" class="cr-show-more">Show Less</button>'
        : `<button type="button" class="cr-show-more">Show More (${bins.length - FACET_VISIBLE})</button>`;
    }
    body.innerHTML = html;
  }

  function renderFacets() {
    FILTER_GROUPS.forEach(renderGroup);
  }

  function renderChips() {
    const chips = [];
    FILTER_GROUPS.forEach((g) => {
      if (filters[g.key]) chips.push({ key: g.key, label: filters[g.key].split('==').slice(1).join('==') });
    });
    if (filters.fee) chips.push({ key: 'fee', label: FEE_LABEL });
    chipsEl.innerHTML = chips.map((c) => `
      <button type="button" class="cr-chip" data-key="${c.key}">
        <span>${esc(c.label)}</span><span class="cr-chip-x" aria-hidden="true">✕</span>
      </button>`).join('');
  }

  // Expand/collapse group headers
  groupsEl.addEventListener('click', (e) => {
    const head = e.target.closest('.cr-group-head');
    if (head) {
      const group = head.closest('.cr-group');
      const { key } = group.dataset;
      expanded[key] = !expanded[key];
      head.setAttribute('aria-expanded', String(expanded[key]));
      group.querySelector('.cr-group-icon').textContent = expanded[key] ? '−' : '+';
      group.querySelector('.cr-group-body').hidden = !expanded[key];
      return;
    }
    const showMore = e.target.closest('.cr-show-more');
    if (showMore) {
      const { key } = showMore.closest('.cr-group').dataset;
      showAll[key] = !showAll[key];
      renderGroup(FILTER_GROUPS.find((g) => g.key === key));
    }
  });

  // Radio selection
  groupsEl.addEventListener('change', (e) => {
    const radio = e.target.closest('input[type="radio"]');
    if (!radio) return;
    const { key } = radio.closest('.cr-group').dataset;
    filters[key] = radio.value || null;
    loadResults();
  });

  // Fee toggle
  feeToggle.addEventListener('click', () => {
    filters.fee = !filters.fee;
    feeToggle.setAttribute('aria-checked', String(filters.fee));
    loadResults();
  });

  // Chip removal
  chipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.cr-chip');
    if (!chip) return;
    const { key } = chip.dataset;
    if (key === 'fee') {
      filters.fee = false;
      feeToggle.setAttribute('aria-checked', 'false');
    } else {
      filters[key] = null;
    }
    loadResults();
  });

  // Reset all sidebar filters back to their default state: clear selections,
  // collapse every group, and reset the "Show More" expansion.
  resetBtn.addEventListener('click', () => {
    FILTER_GROUPS.forEach((g) => {
      filters[g.key] = null;
      expanded[g.key] = false;
      showAll[g.key] = false;
      const group = groupsEl.querySelector(`.cr-group[data-key="${g.key}"]`);
      group.querySelector('.cr-group-head').setAttribute('aria-expanded', 'false');
      group.querySelector('.cr-group-icon').textContent = '+';
      group.querySelector('.cr-group-body').hidden = true;
    });
    filters.fee = false;
    feeToggle.setAttribute('aria-checked', 'false');
    loadResults();
  });

  // ===================== Results listing =====================
  async function loadResults({ append = false } = {}) {
    const topicLabel = currentTopicLabel();
    if (!topicLabel) return;
    const offset = append ? resultsState.docs.length : 0;
    resultsToken += 1;
    const token = resultsToken;

    if (append) {
      viewMoreBtn.disabled = true;
      viewMoreBtn.textContent = 'Loading…';
    } else {
      listingEl.innerHTML = '<div class="cr-results-spinner" role="status" aria-label="Loading results"></div>';
      countEl.textContent = '';
      viewMoreBtn.hidden = true;
    }

    try {
      const data = await fetchResults({
        rop: state.rop,
        topicLabel,
        offset,
        filterTokens: activeFilterTokens(),
      });
      if (token !== resultsToken) return;
      const docs = data.list?.document || [];
      const num = Number(data.list?.num || data['added-sources']?.[0]?.['total-results'] || 0);
      resultsState.docs = append ? resultsState.docs.concat(docs) : docs;
      resultsState.num = num;
      countEl.innerHTML = buildCountHtml({ num, topicLabel, region: regionLabel(state.rop) });
      listingEl.innerHTML = buildListingHtml(resultsState.docs);
      viewMoreBtn.hidden = resultsState.docs.length >= num;
      if (!append) {
        lastBinningSet = data.binning?.['binning-set'] || [];
        renderFacets();
        renderChips();
      }
    } catch (err) {
      if (token !== resultsToken) return;
      // eslint-disable-next-line no-console
      console.error('[classes-results] failed to load results:', err);
      if (!append) listingEl.innerHTML = '<p class="cr-empty">Something went wrong loading results.</p>';
    } finally {
      viewMoreBtn.disabled = false;
      viewMoreBtn.textContent = 'View more programs';
    }
  }

  viewMoreBtn.addEventListener('click', () => loadResults({ append: true }));

  // ===================== Search bar behavior =====================
  let debounce;
  input.addEventListener('input', () => {
    const zip = input.value.replace(/\D/g, '').slice(0, 5);
    if (zip !== input.value) input.value = zip;
    clearTimeout(debounce);
    if (zip.length === 5) {
      state = {
        zip, lat: '', lon: '', rop: zipToRop(zip),
      };
      debounce = setTimeout(loadTopics, 400);
    } else {
      state = {
        zip: '', lat: '', lon: '', rop: DEFAULT_ROP,
      };
      resetTopics();
    }
  });

  geoBtn.addEventListener('click', () => {
    if (!navigator.geolocation) return;
    showTopicsLoading();
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      let zip = '';
      try {
        const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`);
        if (r.ok) {
          const g = await r.json();
          zip = String(g.postcode || '').replace(/\D/g, '').slice(0, 5);
        }
      } catch (e) { /* ignore — fall back to coordinates */ }

      if (/^\d{5}$/.test(zip)) {
        input.value = zip;
        state = {
          zip, lat: '', lon: '', rop: zipToRop(zip),
        };
      } else {
        state = {
          zip: '', lat: latitude, lon: longitude, rop: latToRop(latitude),
        };
      }
      loadTopics();
    }, (err) => {
      // eslint-disable-next-line no-console
      console.error('[classes-results] geolocation failed:', err);
      resetTopics();
    });
  });

  function buildResultsUrl() {
    const parts = [];
    if (state.zip) {
      parts.push(`user_zip=${encodeURIComponent(state.zip)}`);
    } else if (state.lat && state.lon) {
      parts.push(`user_lat=${encodeURIComponent(state.lat)}`);
      parts.push(`user_lon=${encodeURIComponent(state.lon)}`);
    }
    parts.push(`distance_label=${encodeURIComponent(`Within ${distSelect.value} miles`)}`);
    parts.push(`health_topic=${encodeURIComponent(topicSelect.value)}`);
    return `${window.location.origin}${window.location.pathname}?${parts.join('&')}`;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!topicSelect.value) {
      topicSelect.focus();
      return;
    }
    // A new base search resets the sidebar filters.
    FILTER_GROUPS.forEach((g) => { filters[g.key] = null; });
    filters.fee = false;
    feeToggle.setAttribute('aria-checked', 'false');
    window.history.pushState({}, '', buildResultsUrl());
    loadResults();
  });

  // --- Initial load (prefilled from the incoming URL) ---------------------
  loadTopics();
  if (initialTopic) loadResults();
}
