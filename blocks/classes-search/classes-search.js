import {
  DEFAULT_ROP, zipToRop, latToRop, fetchTopics,
} from '../../utils/kp-api.js';

// Reads the results-page path authored in the block (a link or a plain-text
// cell), e.g. "northern-california/health-wellness/classes-programs/search-results".
function readResultsPath(block) {
  const link = block.querySelector('a[href]');
  if (link) return link.getAttribute('href').trim();
  const cell = block.querySelector(':scope > div > div') || block;
  return cell.textContent.trim();
}

// Builds the results-page URL: the authored path + the user's search as query
// params, matching the param names the live KP site uses:
//   ?user_zip=94110&health_topic=Diabetes
function buildResultsUrl(path, state, topicLabel) {
  const normalized = /^https?:\/\//i.test(path) ? path : `/${path.replace(/^\/+/, '')}`;
  const base = new URL(normalized, window.location.origin);
  const params = [];
  if (state.zip) {
    params.push(`user_zip=${encodeURIComponent(state.zip)}`);
  } else if (state.lat && state.lon) {
    params.push(`user_lat=${encodeURIComponent(state.lat)}`);
    params.push(`user_lon=${encodeURIComponent(state.lon)}`);
  }
  params.push(`health_topic=${encodeURIComponent(topicLabel)}`);
  // encodeURIComponent encodes spaces as %20 to match the live KP URLs
  // (URLSearchParams would use "+").
  return `${base.origin}${base.pathname}?${params.join('&')}`;
}

// Inline SVG icons (kept tiny; colored via currentColor where possible).
const ICON_PIN = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>';
const ICON_CLEAR = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/></svg>';
// Filled circle + "!" — colored red via the wrapper's `color`.
const ICON_ALERT = '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="11" fill="currentColor"/><rect x="11" y="6" width="2" height="7.5" rx="1" fill="#fff"/><circle cx="12" cy="17" r="1.4" fill="#fff"/></svg>';

export default function init(el) {
  // The authored block holds the results-page path (a link or plain-text cell).
  // Read and store it, then remove the authored content before building the UI.
  const resultsPath = readResultsPath(el);
  el.textContent = '';

  // --- Build the markup ---------------------------------------------------
  const form = document.createElement('form');
  form.className = 'cs-form';
  form.noValidate = true;

  // Location field
  const locField = document.createElement('div');
  locField.className = 'cs-field cs-location';
  locField.innerHTML = `
    <div class="cs-label-row">
      <label class="cs-label" for="cs-zip">Location</label>
      <button type="button" class="cs-use-location">${ICON_PIN}<span>Use my location</span></button>
    </div>
    <div class="cs-input-wrap">
      <input id="cs-zip" class="cs-input" type="text" inputmode="numeric" autocomplete="postal-code"
        maxlength="5" placeholder="Enter your city or ZIP code" aria-describedby="cs-zip-error" />
      <button type="button" class="cs-clear" aria-label="Clear location" hidden>${ICON_CLEAR}</button>
    </div>
    <p class="cs-field-error" id="cs-zip-error" hidden>
      <span class="cs-field-error-icon">${ICON_ALERT}</span><span class="cs-field-error-text"></span>
    </p>`;

  // Topic field
  const topicField = document.createElement('div');
  topicField.className = 'cs-field cs-topic';
  topicField.innerHTML = `
    <div class="cs-label-row">
      <label class="cs-label" for="cs-topic">Topic</label>
    </div>
    <div class="cs-topic-control">
      <select id="cs-topic" class="cs-select" disabled aria-busy="false" aria-describedby="cs-topic-error">
        <option value="">Select topic</option>
      </select>
      <div class="cs-spinner" role="status" aria-label="Loading topics" hidden></div>
    </div>
    <p class="cs-field-error" id="cs-topic-error" hidden>
      <span class="cs-field-error-icon">${ICON_ALERT}</span><span class="cs-field-error-text"></span>
    </p>`;

  // Submit
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'cs-submit';
  submit.textContent = 'Find programs';

  form.append(locField, topicField, submit);

  // Validation error summary (shown above the form on a failed submit)
  const summary = document.createElement('div');
  summary.className = 'cs-error-summary';
  summary.setAttribute('role', 'alert');
  summary.tabIndex = -1;
  summary.hidden = true;
  summary.innerHTML = `
    <span class="cs-error-summary-icon">${ICON_ALERT}</span>
    <div class="cs-error-summary-body">
      <p class="cs-error-summary-title">Choose at least one search option and try again.</p>
      <ul class="cs-error-summary-list"></ul>
    </div>`;

  el.append(summary, form);

  const input = locField.querySelector('.cs-input');
  const clearBtn = locField.querySelector('.cs-clear');
  const geoBtn = locField.querySelector('.cs-use-location');
  const select = topicField.querySelector('.cs-select');
  const spinner = topicField.querySelector('.cs-spinner');
  const zipError = locField.querySelector('#cs-zip-error');
  const topicError = topicField.querySelector('#cs-topic-error');
  const summaryList = summary.querySelector('.cs-error-summary-list');

  // --- State --------------------------------------------------------------
  let state = {
    zip: '', lat: '', lon: '', rop: DEFAULT_ROP,
  };
  let reqToken = 0; // guards against out-of-order responses

  // --- Topic dropdown rendering ------------------------------------------
  function resetTopics() {
    spinner.hidden = true;
    select.hidden = false;
    select.setAttribute('aria-busy', 'false');
    select.disabled = true;
    select.innerHTML = '<option value="">Select topic</option>';
  }

  function showTopicsLoading() {
    select.hidden = true;
    spinner.hidden = false;
    select.setAttribute('aria-busy', 'true');
  }

  function renderTopics(topics) {
    spinner.hidden = true;
    select.hidden = false;
    select.setAttribute('aria-busy', 'false');
    select.innerHTML = '<option value="">Select topic</option>';
    if (!topics.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No topics found';
      opt.disabled = true;
      select.append(opt);
      select.disabled = true;
      return;
    }
    topics.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.label;
      opt.textContent = t.label;
      select.append(opt);
    });
    select.disabled = false;
  }

  async function loadTopics(rop) {
    reqToken += 1;
    const token = reqToken;
    state.rop = rop;
    showTopicsLoading();
    try {
      const topics = await fetchTopics({ rop });
      if (token !== reqToken) return; // a newer request superseded this one
      renderTopics(topics);
    } catch (err) {
      if (token !== reqToken) return;
      // eslint-disable-next-line no-console
      console.error('[classes-search] failed to load topics:', err);
      resetTopics();
    }
  }

  // --- Location input -----------------------------------------------------
  let debounce;
  input.addEventListener('input', () => {
    // The user is entering a location — dismiss any validation errors.
    clearAllErrors();
    // keep digits only, max 5
    const zip = input.value.replace(/\D/g, '').slice(0, 5);
    if (zip !== input.value) input.value = zip;
    clearBtn.hidden = zip.length === 0;

    clearTimeout(debounce);
    if (zip.length === 5) {
      state = {
        zip, lat: '', lon: '', rop: zipToRop(zip),
      };
      debounce = setTimeout(() => loadTopics(state.rop), 400);
    } else {
      state = {
        zip: '', lat: '', lon: '', rop: DEFAULT_ROP,
      };
      resetTopics();
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    state = {
      zip: '', lat: '', lon: '', rop: DEFAULT_ROP,
    };
    resetTopics();
    clearFieldError('zip');
    input.focus();
  });

  // --- Use my location ----------------------------------------------------
  geoBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      // eslint-disable-next-line no-console
      console.warn('[classes-search] geolocation not supported');
      return;
    }
    showTopicsLoading();
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      // Try to resolve a ZIP so the field mirrors manual entry. Free, key-less,
      // CORS-enabled reverse geocoder; falls back to lat/lon on any failure.
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
        clearBtn.hidden = false;
        state = {
          zip, lat: '', lon: '', rop: zipToRop(zip),
        };
      } else {
        state = {
          zip: '', lat: latitude, lon: longitude, rop: latToRop(latitude),
        };
      }
      loadTopics(state.rop);
    }, (err) => {
      // eslint-disable-next-line no-console
      console.error('[classes-search] geolocation failed:', err);
      resetTopics();
    });
  });

  // --- Validation ---------------------------------------------------------
  function setFieldError(controlEl, errorEl, message) {
    controlEl.setAttribute('aria-invalid', 'true');
    errorEl.querySelector('.cs-field-error-text').textContent = message;
    errorEl.hidden = false;
  }

  function clearFieldError(field) {
    const control = field === 'zip' ? input : select;
    const errorEl = field === 'zip' ? zipError : topicError;
    control.removeAttribute('aria-invalid');
    errorEl.hidden = true;
    const li = summaryList.querySelector(`li[data-field="${field}"]`);
    if (li) li.remove();
    if (!summaryList.children.length) summary.hidden = true;
  }

  // Dismiss the whole error UI (summary + both field errors).
  function clearAllErrors() {
    summary.hidden = true;
    summaryList.innerHTML = '';
    input.removeAttribute('aria-invalid');
    select.removeAttribute('aria-invalid');
    zipError.hidden = true;
    topicError.hidden = true;
  }

  function addSummaryLink(field, targetId, text) {
    const li = document.createElement('li');
    li.dataset.field = field;
    const a = document.createElement('a');
    a.href = `#${targetId}`;
    a.textContent = text;
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      document.getElementById(targetId).focus();
    });
    li.append(a);
    summaryList.append(li);
  }

  // Returns true when valid; otherwise renders the summary + field errors.
  function validate() {
    summaryList.innerHTML = '';
    let valid = true;

    const zipValid = /^\d{5}$/.test(state.zip) || (state.lat && state.lon);
    if (!zipValid) {
      valid = false;
      setFieldError(input, zipError, 'ZIP code must be 5 digits');
      addSummaryLink('zip', 'cs-zip', 'Please enter a valid ZIP code');
    } else {
      input.removeAttribute('aria-invalid');
      zipError.hidden = true;
    }

    if (!select.value) {
      valid = false;
      const noTopics = select.disabled || select.options.length <= 1;
      setFieldError(select, topicError, noTopics ? 'No topics available' : 'Please select a topic');
      addSummaryLink('topic', 'cs-topic', 'Please select a valid topic');
    } else {
      select.removeAttribute('aria-invalid');
      topicError.hidden = true;
    }

    summary.hidden = valid;
    return valid;
  }

  // Clear the topic error as soon as a topic is chosen
  select.addEventListener('change', () => { if (select.value) clearFieldError('topic'); });

  // --- Submit -------------------------------------------------------------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validate()) {
      summary.focus();
      return;
    }
    if (!resultsPath) {
      // eslint-disable-next-line no-console
      console.warn('[classes-search] no results-page path authored in the block');
      return;
    }
    // Navigate to the authored results page, carrying the search as query
    // params (health_topic uses the topic label, e.g. "Diabetes").
    window.location.assign(buildResultsUrl(resultsPath, state, select.value));
  });
}
